// MultiGatewayHub — Durable Object that fans out one upstream-per-region SSE
// subscription to many browser clients over WebSocket.
//
// Why this exists:
//   The Rust LNS caps each region at MAX_SSE_CONNECTIONS=20. Before this DO
//   landed, every browser tab opened 6 outbound SSE fetches (one per region),
//   so 4 active dashboards alone could saturate the cap. With this DO, the
//   worker holds at most 6 long-lived SSE streams globally — one per region —
//   and broadcasts events to every connected client.
//
// Single-instance contract:
//   The DO is addressed with a fixed name ("hub") so all clients land on the
//   same instance. That instance multiplexes upstream → many client websockets
//   in memory. We don't persist subscriber state; the runtime tracks attached
//   websockets via the Hibernation API (`state.getWebSockets()`).
//
// Hibernation:
//   Client websockets use the WebSocket Hibernation API (acceptWebSocket).
//   When `pumpUpstream` finishes (upstream EOF / error) and there are no
//   in-flight `waitUntil`s, Cloudflare may hibernate the DO even while client
//   websockets are still attached. On hibernation:
//     - In-memory state (this.upstreams / this.lastBroadcastStatus) is wiped;
//       on wake, the constructor reinitialises it to empty Maps.
//     - JS `setTimeout` handles are dropped — only `state.storage.setAlarm`
//       survives.
//   To recover, we run a self-rescheduling alarm whenever subscribers exist:
//   `alarm()` calls `ensureUpstreams()`, and the hibernation entry points
//   (`webSocketMessage`/`webSocketClose`/`webSocketError`) also re-ensure
//   upstreams so any client signal kicks the DO back into a healthy state.
//
// Wire protocol (client ↔ DO):
//   - Client connects via WebSocket to /multi-gateway/events.
//   - DO sends each upstream SSE event payload as one WS text frame containing
//     the JSON envelope verbatim (`{type:"uplink",mac,...}` etc).
//   - DO sends `{"type":"sse_status","status":"connected"|"unavailable"}`
//     status frames so the client can track upstream health. The "unavailable"
//     frame replaces the legacy `{"error":"No upstream available"}` payload —
//     the client maps both to the same backoff state.
//   - DO does not consume any client messages today; future control frames
//     (e.g. region filters) can ride the same socket.

import { REGIONS } from "./regions.js";

function getHost(env) {
  return env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
}

// Idle window before we tear down upstreams after the last client leaves.
// Short — clients reconnect within a couple of seconds during nav, and we
// don't want to keep an upstream slot warm with no subscribers.
const IDLE_TEARDOWN_MS = 2000;

// Heartbeat cadence for the rescue alarm. Fires while subscribers exist so
// we re-open any upstream that died between hibernation cycles. Long enough
// not to hammer the LNS on a sustained outage, short enough that recovery
// after CF hibernation feels live.
const ALARM_HEARTBEAT_MS = 15000;

export class MultiGatewayHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // region -> { reader, controller, status: "connecting"|"open"|"down" }
    // Re-initialised on wake. Authoritative-ness comes from runtime state +
    // the alarm; we don't persist this.
    this.upstreams = new Map();
    this.lastBroadcastStatus = null; // "connected" | "unavailable" | null
  }

  // ---------------------------------------------------------------------------
  // HTTP entry point
  // ---------------------------------------------------------------------------

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }
    return new Response("Not found", { status: 404 });
  }

  handleWebSocket(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API — Cloudflare may evict the DO between events but the
    // websockets stay attached. We bring upstreams back up on wake from any
    // hibernation handler (see webSocketMessage/Close/Error and alarm()).
    this.state.acceptWebSocket(server);

    // Bring up upstreams (no-op if already running) and replay the current
    // upstream-health status to this fresh client so it knows whether to
    // show "connected" or "unavailable" immediately.
    this.ensureUpstreams();
    this.armHeartbeat();
    if (this.lastBroadcastStatus) {
      try {
        server.send(JSON.stringify({ type: "sse_status", status: this.lastBroadcastStatus }));
      } catch {
        // ignore — the client will see status when the next event lands
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle (Hibernation API)
  //
  // These are the only signals (besides `alarm()` and an inbound fetch) that
  // wake the DO from hibernation, so each one re-ensures upstreams while
  // subscribers remain. The constructor clears in-memory state on wake;
  // ensureUpstreams() re-establishes anything that was running before.
  // ---------------------------------------------------------------------------

  // Inbound messages from clients are unused today; keep the hook so we can
  // add region filters / heartbeats without changing the wire later.
  async webSocketMessage(_ws, _message) {
    if (this.countSubscribers() > 0) {
      this.ensureUpstreams();
      this.armHeartbeat();
    }
  }

  async webSocketClose(_ws, _code, _reason, _wasClean) {
    // `getWebSockets()` already excludes the closing socket by the time this
    // fires. If others remain, keep the upstreams warm; otherwise schedule
    // teardown after a short grace window so a quick reconnect doesn't churn.
    if (this.countSubscribers() > 0) {
      this.ensureUpstreams();
      this.armHeartbeat();
    } else {
      this.armTeardown();
    }
  }

  async webSocketError(_ws, _err) {
    if (this.countSubscribers() > 0) {
      this.ensureUpstreams();
      this.armHeartbeat();
    } else {
      this.armTeardown();
    }
  }

  // The alarm is the only timer that survives hibernation. It serves two
  // jobs:
  //   1. Heartbeat — while subscribers remain, re-ensure upstreams so any
  //      that died (LNS bounce, EOF) come back; failed regions get retried
  //      on the next tick.
  //   2. Teardown — if no subscribers remain, close upstreams to free the
  //      per-region cap slot.
  async alarm() {
    if (this.countSubscribers() > 0) {
      this.ensureUpstreams();
      this.armHeartbeat();
    } else {
      this.shutdownAllUpstreams();
      // No reschedule — DO can hibernate cleanly until the next client
      // fetch lands.
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriber accounting
  // ---------------------------------------------------------------------------

  countSubscribers() {
    return this.state.getWebSockets().length;
  }

  // Schedule the heartbeat alarm. setAlarm() with an earlier time wins, so
  // we always set to (now + heartbeat) — overwriting any pending teardown.
  armHeartbeat() {
    this.state.storage.setAlarm(Date.now() + ALARM_HEARTBEAT_MS);
  }

  // Schedule a teardown pass after the idle grace. If clients reconnect
  // before then, armHeartbeat() pushes the alarm back out and the teardown
  // is skipped (alarm() re-checks subscriber count when it fires).
  armTeardown() {
    this.state.storage.setAlarm(Date.now() + IDLE_TEARDOWN_MS);
  }

  // ---------------------------------------------------------------------------
  // Upstream lifecycle (one fetch per region, shared across all clients)
  // ---------------------------------------------------------------------------

  ensureUpstreams() {
    for (const region of REGIONS) {
      if (this.upstreams.has(region.region)) continue;
      this.openUpstream(region);
    }
  }

  async openUpstream(region) {
    const apiKey = this.env.MULTI_GATEWAY_API_KEY;
    if (!apiKey) {
      // Without credentials there's nothing to do; let clients see the
      // unavailable state.
      this.recordUpstreamDown(region.region);
      return;
    }
    const host = getHost(this.env);
    const controller = new AbortController();
    const entry = { reader: null, controller, status: "connecting" };
    this.upstreams.set(region.region, entry);

    let res;
    try {
      res = await fetch(`http://${host}:${region.port}/events`, {
        headers: { "X-API-Key": apiKey },
        signal: controller.signal,
      });
    } catch (err) {
      console.warn("multi-gateway hub: upstream fetch failed", region.region, err?.message);
      this.upstreams.delete(region.region);
      this.broadcastStatusIfChanged();
      // Don't open-loop on a failing region — the heartbeat alarm will
      // retry on the next tick.
      return;
    }
    if (!res.ok || !res.body) {
      console.warn("multi-gateway hub: upstream non-OK", region.region, res.status);
      try { controller.abort(); } catch { /* ignore */ }
      this.upstreams.delete(region.region);
      this.broadcastStatusIfChanged();
      return;
    }

    entry.reader = res.body.getReader();
    entry.status = "open";
    this.broadcastStatusIfChanged();

    // Pump in the background. waitUntil keeps the DO alive while data flows;
    // once it resolves the DO can hibernate, and the heartbeat alarm picks
    // up from there.
    this.state.waitUntil(this.pumpUpstream(region, entry));
  }

  async pumpUpstream(region, entry) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await entry.reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        // SSE events are separated by blank lines (\n\n).
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const raw of events) {
          const payload = parseSseEvent(raw);
          if (payload === null) continue;
          // broadcast() no-ops on 0 subscribers; we don't tear down here so a
          // client that reconnects within IDLE_TEARDOWN_MS sees an unbroken
          // upstream. Final teardown comes from the alarm (armTeardown).
          this.broadcast(payload);
        }
      }
      // Upstream ended cleanly. Treat as down; heartbeat alarm will retry.
      console.warn("multi-gateway hub: upstream ended", region.region);
    } catch (err) {
      // Aborted on intentional teardown — quiet; otherwise log.
      if (entry.controller.signal.aborted) return;
      console.warn("multi-gateway hub: upstream pump errored", region.region, err?.message);
    } finally {
      this.upstreams.delete(region.region);
    }
    this.broadcastStatusIfChanged();
    // If subscribers remain, make sure the heartbeat alarm is armed so we
    // retry on the next tick (cheap idempotent set).
    if (this.countSubscribers() > 0) this.armHeartbeat();
  }

  shutdownUpstream(regionName) {
    const entry = this.upstreams.get(regionName);
    if (!entry) return;
    try { entry.controller.abort(); } catch { /* ignore */ }
    try { entry.reader?.cancel(); } catch { /* ignore */ }
    this.upstreams.delete(regionName);
  }

  shutdownAllUpstreams() {
    for (const regionName of [...this.upstreams.keys()]) {
      this.shutdownUpstream(regionName);
    }
    this.lastBroadcastStatus = null;
  }

  recordUpstreamDown(regionName) {
    this.upstreams.delete(regionName);
    this.broadcastStatusIfChanged();
  }

  // ---------------------------------------------------------------------------
  // Fan-out
  // ---------------------------------------------------------------------------

  broadcast(payloadString) {
    const sockets = this.state.getWebSockets();
    if (sockets.length === 0) return;
    for (const ws of sockets) {
      try {
        ws.send(payloadString);
      } catch {
        // The socket is dead; Cloudflare will fire webSocketClose for it.
      }
    }
  }

  broadcastStatusIfChanged() {
    // Surface "connected" once at least one region is up; "unavailable" only
    // when every region is down. This preserves the client's existing
    // backoff: it treats "unavailable" as "stop hammering, wait 30s".
    const anyOpen = [...this.upstreams.values()].some((e) => e.status === "open");
    const status = anyOpen ? "connected" : "unavailable";
    if (status === this.lastBroadcastStatus) return;
    this.lastBroadcastStatus = status;
    this.broadcast(JSON.stringify({ type: "sse_status", status }));
  }
}

// SSE chunks look like:
//   data: {"type":"uplink",...}\n\n
// or with multiple data: lines that should be joined by \n. Returns the
// concatenated data payload as a string, or null for keep-alives / comments.
function parseSseEvent(raw) {
  const lines = raw.split("\n");
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    // ignore event:, id:, retry:, and comment lines — the upstream LNS only
    // emits unnamed `data:` events today.
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}
