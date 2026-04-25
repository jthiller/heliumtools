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
//   in memory. There is no DO storage; subscribers are only tracked while the
//   DO is alive.
//
// Hibernation:
//   Client websockets use the WebSocket Hibernation API (acceptWebSocket).
//   When all clients leave, the upstream is closed and the DO can hibernate
//   normally; we don't pin it open with timers when idle.
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

// Cool-down before we retry a failed upstream region.
const REGION_RETRY_MS = 15000;

export class MultiGatewayHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // region -> { reader, controller, status: "connecting"|"open"|"down" }
    this.upstreams = new Map();
    // region -> timeout handle for retry
    this.retryTimers = new Map();
    this.teardownTimer = null;
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

    // Hibernation API — Cloudflare evicts us between events but resumes the
    // websockets when upstream data arrives. We re-open upstreams on
    // resume via ensureUpstreams() inside handleUpstreamEvent.
    this.state.acceptWebSocket(server);

    // Bring up upstreams (no-op if already running) and replay the current
    // upstream-health status to this fresh client so it knows whether to
    // show "connected" or "unavailable" immediately.
    this.ensureUpstreams();
    this.cancelTeardown();
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
  // ---------------------------------------------------------------------------

  // Inbound messages from clients are unused today; keep the hook so we can
  // add region filters / heartbeats without changing the wire later.
  async webSocketMessage(_ws, _message) {
    // no-op
  }

  async webSocketClose(_ws, _code, _reason, _wasClean) {
    this.checkIdle();
  }

  async webSocketError(_ws, _err) {
    this.checkIdle();
  }

  // ---------------------------------------------------------------------------
  // Subscriber accounting
  // ---------------------------------------------------------------------------

  countSubscribers() {
    return this.state.getWebSockets().length;
  }

  checkIdle() {
    if (this.countSubscribers() > 0) return;
    // Last subscriber dropped — close upstreams to free the per-region cap
    // slot. Use a short delay so a quick reconnect (page nav) doesn't churn
    // the upstream socket.
    if (this.teardownTimer) return;
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      if (this.countSubscribers() === 0) this.shutdownAllUpstreams();
    }, IDLE_TEARDOWN_MS);
  }

  cancelTeardown() {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Upstream lifecycle (one fetch per region, shared across all clients)
  // ---------------------------------------------------------------------------

  ensureUpstreams() {
    for (const region of REGIONS) {
      if (this.upstreams.has(region.region)) continue;
      if (this.retryTimers.has(region.region)) continue;
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
      this.scheduleRetry(region);
      this.broadcastStatusIfChanged();
      return;
    }
    if (!res.ok || !res.body) {
      console.warn("multi-gateway hub: upstream non-OK", region.region, res.status);
      try { controller.abort(); } catch { /* ignore */ }
      this.upstreams.delete(region.region);
      this.scheduleRetry(region);
      this.broadcastStatusIfChanged();
      return;
    }

    entry.reader = res.body.getReader();
    entry.status = "open";
    this.broadcastStatusIfChanged();

    // Pump in the background. waitUntil keeps the DO alive between client
    // events while we have an open upstream.
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
          if (this.countSubscribers() === 0) {
            // Everyone left while data was in flight; stop here.
            this.shutdownUpstream(region.region);
            return;
          }
          const payload = parseSseEvent(raw);
          if (payload === null) continue;
          this.broadcast(payload);
        }
      }
      // Upstream ended cleanly. Treat as down and retry.
      console.warn("multi-gateway hub: upstream ended", region.region);
    } catch (err) {
      // Aborted on intentional teardown — quiet; otherwise log.
      if (entry.controller.signal.aborted) return;
      console.warn("multi-gateway hub: upstream pump errored", region.region, err?.message);
    } finally {
      this.upstreams.delete(region.region);
    }
    // If we still have subscribers, schedule a retry so traffic resumes.
    if (this.countSubscribers() > 0) this.scheduleRetry(region);
    this.broadcastStatusIfChanged();
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
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
    this.lastBroadcastStatus = null;
  }

  recordUpstreamDown(regionName) {
    this.upstreams.delete(regionName);
    this.broadcastStatusIfChanged();
  }

  scheduleRetry(region) {
    if (this.retryTimers.has(region.region)) return;
    const handle = setTimeout(() => {
      this.retryTimers.delete(region.region);
      // Only retry if anyone is still listening.
      if (this.countSubscribers() === 0) return;
      this.openUpstream(region);
    }, REGION_RETRY_MS);
    this.retryTimers.set(region.region, handle);
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
