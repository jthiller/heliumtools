// HntPriceHub — Durable Object that polls the HNT price once and fans the
// result out to every connected client, over WebSocket or Server-Sent Events.
//
// Why this exists:
//   Each price poll is a chain read (DataCreditsV0 → the Pyth feed account) plus
//   a Jupiter request. Letting every streaming client poll on its own would
//   multiply that by the subscriber count against our own RPC quota. This DO
//   collapses it: one poll every ALARM_HEARTBEAT_MS, broadcast to all.
//
// Single-instance contract:
//   The DO is addressed with a fixed name ("hub") so all clients land on the
//   same instance. Subscriber state is not persisted: the runtime tracks
//   attached websockets via the Hibernation API (`state.getWebSockets()`), and
//   SSE clients live in an in-memory Set (`this.sseWriters`). `countSubscribers`
//   is the sum, and every ceiling and lifecycle decision reads it, so the two
//   transports share one roster.
//
// No upstream pump:
//   Unlike multi-gateway's hub there is nothing to hold open — the poll is
//   entirely self-contained inside `alarm()`. That makes the alarm the only
//   moving part, and it does double duty: heartbeat while subscribers exist,
//   teardown once the last one leaves.
//
// Hibernation:
//   Client websockets use the WebSocket Hibernation API (acceptWebSocket), so
//   Cloudflare may evict the DO between alarms even while sockets stay attached.
//   On hibernation:
//     - In-memory state (this.lastBroadcast) is wiped; the constructor
//       reinitialises it to null on wake. The cost is at most one redundant
//       broadcast of an unchanged price, and only on a wake that no connect-time
//       replay primed first (the replay repopulates it from KV).
//     - JS `setTimeout` handles are dropped — only `state.storage.setAlarm`
//       survives, which is why the poll cadence is an alarm and not a timer.
//   The hibernation entry points that signal a roster change (`webSocketClose`/
//   `webSocketError`) each ENSURE the alarm matches the live subscriber count
//   (see ensureScheduled/armHeartbeat — a DO has one alarm and setAlarm replaces
//   it, so "ensure", never "reset"), so a departing client can neither strand a
//   live roster unpolled nor, through churn, postpone the poll.
//
//   SSE connections are the exception: an open response stream pins the DO
//   awake, and its registry does not survive eviction. See the `this.sseWriters`
//   note in the constructor for the mechanism and its cost.
//
// Wire protocol (client ↔ DO):
//   Both transports carry the same stream of snapshots. Both replay the freshest
//   snapshot the DO has (memory, else KV) the moment a client attaches, so
//   nobody waits a full poll interval for a first price, and both then carry the
//   snapshot JSON only when the price actually CHANGED (edge-triggered on
//   `spot.usd` + `oracle.publish_time`). What differs is the liveness story.
//
//   WebSocket (/hnt-price/ws):
//     - One text frame per change, and nothing else on the wire: no pings, no
//       envelopes, no message ids. A quiet socket means a stable price, not a
//       broken stream — the runtime keeps the connection live underneath it.
//     - Client messages carry no meaning; an inbound frame only re-ensures the
//       poll alarm (see webSocketMessage).
//
//   SSE (/hnt-price/sse):
//     - `data: <json>\n\n` per change, the same payload.
//     - Opens with a `retry: 3000` hint, so a reconnecting EventSource waits a
//       known interval instead of a browser-specific default.
//     - Plus a `: ping\n\n` comment frame on any tick that carried no data. An
//       SSE stream is an ordinary HTTP response: idle ones get culled by proxies
//       and mobile networks, and EventSource has no ping of its own to notice. A
//       data frame already proves the stream is alive, so the comment covers
//       exactly the quiet ticks — a failed poll among them. Either way a client
//       sees something every tick, so unlike on WS, silence much past a tick on
//       SSE does mean something is wrong.

import { corsHeaders } from "../../lib/response.js";
import { buildSnapshot, getStoredSnapshot } from "./services/price.js";

// Poll/broadcast cadence while subscribers exist. Matches the perceived
// "pseudo-realtime" promise without out-running the ~5-minute oracle crank or
// hammering Jupiter.
const ALARM_HEARTBEAT_MS = 15_000;

// Idle window before we stop polling after the last client leaves. Short —
// clients reconnect within a couple of seconds during a nav, and there is no
// reason to keep spending RPC reads with nobody listening.
const IDLE_TEARDOWN_MS = 2_000;

// Ceiling on concurrent subscribers for one DO instance, counted across BOTH
// transports. A single instance fans out serially, so an unbounded roster would
// make each broadcast slower for everyone. Past this we refuse the connection
// instead of degrading the stream.
const MAX_SUBSCRIBERS = 500;

// SSE framing. A `retry:` field tells EventSource how long to wait before
// reconnecting; browsers default to roughly this anyway, but the default is not
// specified, so state it. A line opening with ":" is a comment — ignored by
// every EventSource implementation, which is what makes it usable as a
// keepalive.
const SSE_RETRY_HINT = "retry: 3000\n\n";
const SSE_ENCODER = new TextEncoder();
// The keepalive never varies, so encode it once at module load rather than per
// tick.
const SSE_PING_CHUNK = SSE_ENCODER.encode(": ping\n\n");

// One `data:` line per frame. Safe because the payload is JSON.stringify output,
// which never contains a raw newline — the character that would otherwise need
// the multi-line `data:` form.
function sseData(json) {
  return `data: ${json}\n\n`;
}

export class HntPriceHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // { key, json } of the last frame we sent. In-memory only — re-initialised
    // to null on wake, which is harmless (worst case one duplicate frame).
    this.lastBroadcast = null;
    // Open SSE response streams, keyed by their writer. NOT hibernatable: an
    // open response stream pins the DO in memory, so unlike the websocket roster
    // (which the runtime owns and hands back through `state.getWebSockets()`)
    // this registry is plain memory and dies with the isolate. EventSource
    // reconnects by itself and re-registers, so an eviction costs a client one
    // reconnect. The flip side is the accepted cost profile: one pinned DO for
    // as long as any SSE client is connected — decided against real billing
    // data, see CLAUDE.md.
    this.sseWriters = new Set();
  }

  // ---------------------------------------------------------------------------
  // HTTP entry point
  // ---------------------------------------------------------------------------

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      return this.handleWebSocket(request);
    }
    if (url.pathname === "/sse") {
      return this.handleSse(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async handleWebSocket(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }
    // Before upgrading: a 503 the client can read beats an accepted socket.
    if (this.countSubscribers() >= MAX_SUBSCRIBERS) return this.refuseOverCeiling();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API — Cloudflare may evict the DO between alarms but the
    // websockets stay attached. Every hibernation handler ensures the alarm
    // matches the live roster (see webSocketClose/Error and alarm()).
    this.state.acceptWebSocket(server);
    await this.armHeartbeat();

    const json = await this.replaySnapshotJson();
    if (json) {
      try {
        server.send(json);
      } catch {
        // ignore — the client will get the next poll's frame
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Server-Sent Events: the same stream for clients that would rather write one
  // line of EventSource than a WebSocket with its own reconnect loop.
  async handleSse(request) {
    // Soft by however many connects are in flight across the awaits below — a
    // fan-out comfort limit, not an invariant.
    if (this.countSubscribers() >= MAX_SUBSCRIBERS) return this.refuseOverCeiling();

    // The replay await runs with nothing registered, so a throw or a client
    // abort here simply propagates with nothing to clean up.
    const json = await this.replaySnapshotJson();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    this.sseWriters.add(writer);

    // Register first, THEN arm — the same order the WS path uses (accept, then
    // arm). Because the writer is already a term in countSubscribers() when the
    // arming storage ops run (and the input gate serializes around them), a
    // pending teardown alarm can never observe an empty roster and strip the
    // poll out from under a live client.
    await this.ensureScheduled();

    // A client going away is the only way an SSE stream ends, and the runtime
    // aborts the request signal when it does. A failing write is the backstop
    // for the cases where that signal never arrives — the alarm writes to a
    // quiet stream at least once a tick, so a departed client is reaped within
    // one interval either way.
    request.signal?.addEventListener("abort", () => this.releaseSse(writer));
    // A signal that fired during the awaits above never calls a listener added
    // after the fact — release immediately instead of waiting a tick.
    if (request.signal?.aborted) this.releaseSse(writer);

    // Reconnect hint first, then the freshest snapshot we have, so the client
    // has a price immediately rather than after a full poll interval. One write:
    // both are opening boilerplate and there is nothing to gain from two chunks.
    const opening = json ? SSE_RETRY_HINT + sseData(json) : SSE_RETRY_HINT;
    this.writeSse(writer, SSE_ENCODER.encode(opening));

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        // The stream is live by definition; nothing in it may be replayed from
        // any cache between us and the client.
        "Cache-Control": "no-store",
        ...corsHeaders,
      },
    });
  }

  // The one over-ceiling refusal, shared by both connect paths so they are
  // byte-identical. It carries `corsHeaders` unconditionally: /sse is an
  // ordinary cross-origin fetch, and without them a browser reports an opaque
  // CORS failure instead of the 503 that explains itself. On a WebSocket
  // handshake the same headers are simply inert.
  refuseOverCeiling() {
    return new Response("Too many subscribers", { status: 503, headers: corsHeaders });
  }

  // The freshest snapshot JSON available without polling: memory first (the
  // common case), KV second (post-hibernation, or the first client after a cold
  // start), null when the cache is cold — then the client simply waits for the
  // next change.
  //
  // Shared by both connect paths so /ws and /sse replay identically; a client
  // must not be able to tell which transport it chose from the first frame.
  async replaySnapshotJson() {
    if (this.lastBroadcast) return this.lastBroadcast.json;

    const stored = await getStoredSnapshot(this.env);
    // An alarm tick can broadcast (and seed lastBroadcast) while the KV read is
    // in flight; its frame is newer than what we just read, so it wins — both
    // as this client's first frame and as the change key, which must never move
    // backwards or the next tick re-sends an unchanged price to everyone.
    if (this.lastBroadcast) return this.lastBroadcast.json;
    if (!stored) return null;

    const json = JSON.stringify(stored);
    // Seed the change-detection cache with the same { key, json } shape the
    // broadcast path stores. Two payoffs: a post-hibernation connect burst costs
    // one KV read total rather than one per client, and the next alarm has a
    // real key to compare against, so an unchanged price does not produce a
    // redundant broadcast to everyone.
    this.lastBroadcast = { key: changeKey(stored), json };
    return json;
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle (Hibernation API)
  //
  // A close or an error is a roster change; together with `alarm()`, an inbound
  // fetch, and an inbound frame these are the signals that wake the DO from
  // hibernation — so each re-points the alarm at whatever the roster now is.
  // Each returns its arming call and the async entry points await it — not for
  // lifetime (pending storage I/O keeps a DO active on its own; state.waitUntil
  // is documented as a no-op here), but so a storage failure surfaces at the
  // call site that can act on it instead of vanishing into a floating promise.
  // ---------------------------------------------------------------------------

  // The wire protocol is broadcast-only — clients send nothing — so an inbound
  // frame carries no meaning. It still re-ensures the alarm as a self-heal
  // backstop: if a storage failure ever exhausted the alarm retries, the roster
  // would be live with no alarm and no other wake signal until a connect or
  // close, and the protocol's "silence means a stable price" makes stranded
  // clients unable to tell. ensureScheduled is ensure-style (one read, write
  // only when nothing suitable is pending), so a junk frame costs at most one
  // storage read.
  async webSocketMessage(_ws, _message) {
    await this.ensureScheduled();
  }

  async webSocketClose(_ws, _code, _reason, _wasClean) {
    // `getWebSockets()` already excludes the closing socket by the time this
    // fires, so ensureScheduled sees the post-close roster: if others remain,
    // keep polling; otherwise schedule teardown after a short grace window so a
    // quick reconnect doesn't churn.
    return this.ensureScheduled();
  }

  async webSocketError(_ws, _err) {
    return this.ensureScheduled();
  }

  // The alarm is the only timer that survives hibernation. It serves two jobs:
  //   1. Heartbeat — while subscribers remain, refresh the snapshot, broadcast
  //      it if the price changed, keep the SSE streams alive, then re-arm.
  //   2. Teardown — if no subscribers remain, stop polling and drop the cached
  //      frame so the next client's replay comes from KV.
  async alarm() {
    if (this.countSubscribers() === 0) {
      this.lastBroadcast = null;
      // No reschedule — the DO can hibernate cleanly until the next client
      // fetch lands.
      return;
    }

    let sent = false;
    try {
      // buildSnapshot, not refreshSnapshot: this singleton DO already
      // serializes its own polls, so the KV single-flight lock would only add
      // three KV writes per tick for nothing.
      const payload = await buildSnapshot(this.env);
      sent = this.broadcastIfChanged(payload);
    } catch (err) {
      // Both price sources were down. Say nothing on the wire (clients keep
      // their last price and their own staleness check) and try again next
      // tick. `sent` stays false, so the keepalive below still fires — a failed
      // poll is exactly when a client most needs to know the stream is there.
      console.error("hnt-price hub: snapshot refresh failed", err?.message);
    }

    // Keepalive, SSE only, and only on a tick that put nothing on the wire — a
    // data frame is its own proof of liveness. WS clients need nothing
    // equivalent: the runtime keeps the socket alive and the protocol documents
    // silence as healthy.
    if (!sent) this.sendSse(SSE_PING_CHUNK);

    // Re-check: a client may have left while the refresh was in flight.
    await this.ensureScheduled();
  }

  // ---------------------------------------------------------------------------
  // Subscriber accounting
  // ---------------------------------------------------------------------------

  // One roster across both transports. Every consumer wants the combined figure:
  // the connect ceiling (the SAME ceiling for /ws and /sse, because a subscriber
  // costs the instance the same fan-out work whichever transport carried it),
  // the alarm's heartbeat-vs-teardown branch (an SSE-only audience must keep the
  // poll running), and the roster checks on close/error/release (the last client
  // to leave is the last one of EITHER kind).
  //
  // SSE writers being a term in the sum is also a structural guarantee: a total
  // of zero means the SSE registry is empty, so the alarm's teardown branch has
  // no response stream left to close.
  countSubscribers() {
    return this.state.getWebSockets().length + this.sseWriters.size;
  }

  // Point the alarm at whatever the live roster is: heartbeat while anyone is
  // listening, teardown once the last client is gone. The single place that
  // decision is made, so close/error/release/alarm can't drift apart.
  async ensureScheduled() {
    return this.countSubscribers() > 0 ? this.armHeartbeat() : this.armTeardown();
  }

  // Ensure a heartbeat poll is scheduled. A DO has ONE alarm and setAlarm()
  // REPLACES it, so an unconditional set from every wake path (connect, close,
  // error) would let steady client churn postpone the poll forever. Only arm
  // when nothing is pending or the pending alarm is later than our target —
  // keeping an earlier alarm (e.g. a pending teardown) is always safe, because
  // alarm() re-checks the live subscriber count when it fires.
  async armHeartbeat() {
    const target = Date.now() + ALARM_HEARTBEAT_MS;
    const pending = await this.state.storage.getAlarm();
    if (pending === null || pending > target) {
      return this.state.storage.setAlarm(target);
    }
  }

  // Schedule a teardown pass after the idle grace. Unlike armHeartbeat this
  // sets unconditionally: pulling the alarm EARLIER is always safe (alarm()
  // decides by live subscriber count), and teardown only runs when the last
  // client just left, so there is no churn path through here.
  armTeardown() {
    return this.state.storage.setAlarm(Date.now() + IDLE_TEARDOWN_MS);
  }

  // ---------------------------------------------------------------------------
  // Fan-out
  // ---------------------------------------------------------------------------

  broadcast(payloadString) {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payloadString);
      } catch {
        // The socket is dead; Cloudflare will fire webSocketClose for it.
      }
    }
    // Frame for SSE only when someone is actually on that transport — in the
    // WS-only steady state the framed copy is never built.
    if (this.sseWriters.size > 0) this.sendSse(SSE_ENCODER.encode(sseData(payloadString)));
  }

  // Fan one already-encoded SSE chunk out to every SSE client. A loop over an
  // empty registry is already a no-op, so there is nothing to guard.
  sendSse(chunk) {
    for (const writer of this.sseWriters) this.writeSse(writer, chunk);
  }

  // Push one encoded chunk to a single SSE client.
  //
  // Fired, not awaited. Awaiting inside `alarm()` would let a single subscriber
  // that has stopped reading apply backpressure and hold the poll up for
  // everyone, and nothing is gained by waiting: a writer queues its chunks in
  // order regardless.
  //
  // A rejection is how a departed client usually announces itself (cancelling
  // the response errors the stream), so a failure routes into the same release
  // path the abort listener uses.
  writeSse(writer, chunk) {
    writer.write(chunk).catch(() => this.releaseSse(writer));
  }

  // Detach one SSE client: drop it from the roster, close its stream, and run
  // the same heartbeat-or-teardown decision every other roster change runs.
  // Idempotent — the abort listener and a failed write can both fire for the
  // same client, and only the first does any work.
  releaseSse(writer) {
    if (!this.sseWriters.delete(writer)) return;
    // A writer whose stream already errored (the usual way an SSE client leaves)
    // rejects on close. There is nothing to do about it and an unhandled
    // rejection is just noise in the DO's logs.
    writer.close().catch(() => {});
    this.ensureScheduled().catch((err) =>
      console.error("hnt-price hub: re-arm after sse release failed", err?.message),
    );
  }

  // Edge-triggered: only send when the price actually moved. `snapshot_at`
  // changes on every poll and is deliberately NOT part of the change key —
  // keying on it would turn this into an unconditional 15s ping.
  //
  // Returns whether a frame went out, which is what tells `alarm()` whether the
  // tick still owes the SSE clients a keepalive.
  broadcastIfChanged(payload) {
    const key = changeKey(payload);
    if (this.lastBroadcast && this.lastBroadcast.key === key) return false;
    const json = JSON.stringify(payload);
    this.lastBroadcast = { key, json };
    this.broadcast(json);
    return true;
  }
}

// Cheap identity for "the price as far as a consumer is concerned": the spot
// quote, and the oracle's own publish timestamp (which advances only when the
// crank posts a new price, ~every 5 minutes).
function changeKey(payload) {
  const spot = payload?.spot?.usd ?? "";
  const publishTime = payload?.oracle?.publish_time ?? "";
  return `${spot}|${publishTime}`;
}
