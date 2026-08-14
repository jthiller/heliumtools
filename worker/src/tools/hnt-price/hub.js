// HntPriceHub — Durable Object that polls the HNT price once and fans the
// result out to every connected WebSocket client.
//
// Why this exists:
//   Each price poll is a chain read (DataCreditsV0 → the Pyth feed account) plus
//   a Jupiter request. Letting every streaming client poll on its own would
//   multiply that by the subscriber count against our own RPC quota. This DO
//   collapses it: one poll every ALARM_HEARTBEAT_MS, broadcast to all.
//
// Single-instance contract:
//   The DO is addressed with a fixed name ("hub") so all clients land on the
//   same instance. Subscriber state is not persisted; the runtime tracks
//   attached websockets via the Hibernation API (`state.getWebSockets()`).
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
//   The hibernation entry points (`webSocketMessage`/`webSocketClose`/
//   `webSocketError`) each ENSURE the alarm is armed while subscribers remain
//   (see armHeartbeat — a DO has one alarm and setAlarm replaces it, so
//   "ensure", never "reset"), so any client signal kicks a wedged DO back into
//   polling without client churn being able to postpone the poll.
//
// Wire protocol (client ↔ DO):
//   - Client connects via WebSocket to /hnt-price/ws.
//   - On connect the DO immediately sends the freshest snapshot it has (from
//     memory, else from KV) as one text frame, so a client never waits a full
//     poll interval for its first price.
//   - Thereafter the DO sends the snapshot JSON only when the price actually
//     CHANGED (edge-triggered on `spot.usd` + `oracle.publish_time`). A quiet
//     socket means a stable price, not a broken stream.
//   - The DO sends no pings and consumes no client messages today; the message
//     hook is kept so control frames can ride the same socket later.

import { buildSnapshot, SNAPSHOT_KEY } from "./services/price.js";
import { kvGetJson } from "../../lib/kv.js";

// Poll/broadcast cadence while subscribers exist. Matches the perceived
// "pseudo-realtime" promise without out-running the ~5-minute oracle crank or
// hammering Jupiter.
const ALARM_HEARTBEAT_MS = 15_000;

// Idle window before we stop polling after the last client leaves. Short —
// clients reconnect within a couple of seconds during a nav, and there is no
// reason to keep spending RPC reads with nobody listening.
const IDLE_TEARDOWN_MS = 2_000;

// Ceiling on concurrent subscribers for one DO instance. A single instance fans
// out serially, so an unbounded roster would make each broadcast slower for
// everyone. Past this we refuse the upgrade instead of degrading the stream.
const MAX_SUBSCRIBERS = 500;

export class HntPriceHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // { key, json } of the last frame we sent. In-memory only — re-initialised
    // to null on wake, which is harmless (worst case one duplicate frame).
    this.lastBroadcast = null;
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

  async handleWebSocket(request) {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }
    // Check the ceiling BEFORE upgrading — a 503 the client can read beats an
    // accepted socket that then behaves badly for everyone on the instance.
    if (this.countSubscribers() >= MAX_SUBSCRIBERS) {
      return new Response("Too many subscribers", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API — Cloudflare may evict the DO between alarms but the
    // websockets stay attached. Every hibernation handler ensures the alarm is
    // armed (see webSocketMessage/Close/Error and alarm()).
    this.state.acceptWebSocket(server);
    await this.armHeartbeat();

    // Replay the freshest snapshot to this fresh client so it has a price
    // immediately rather than after a full poll interval. Memory first (the
    // common case), KV second (post-hibernation, or the first client after a
    // cold start).
    let json = this.lastBroadcast ? this.lastBroadcast.json : null;
    if (!json) {
      const stored = await kvGetJson(this.env, SNAPSHOT_KEY);
      if (stored) {
        json = JSON.stringify(stored);
        // Seed the change-detection cache with the same { key, json } shape the
        // broadcast path stores. Two payoffs: a post-hibernation connect burst
        // costs one KV read total rather than one per client, and the next alarm
        // has a real key to compare against, so an unchanged price does not
        // produce a redundant broadcast to everyone.
        this.lastBroadcast = { key: changeKey(stored), json };
      }
    }
    if (json) {
      try {
        server.send(json);
      } catch {
        // ignore — the client will get the next poll's frame
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------------------
  // WebSocket lifecycle (Hibernation API)
  //
  // These are the only signals (besides `alarm()` and an inbound fetch) that
  // wake the DO from hibernation, so each one ensures the poll is armed while
  // subscribers remain and schedules teardown once they're gone. Each awaits its
  // arming call — these entry points are async, and a floating storage write can
  // be cut off when the DO goes back to sleep.
  // ---------------------------------------------------------------------------

  // Inbound messages from clients are unused today; keep the hook so control
  // frames (e.g. a cadence request) can be added without changing the wire.
  async webSocketMessage(_ws, _message) {
    if (this.countSubscribers() > 0) {
      await this.armHeartbeat();
    }
  }

  async webSocketClose(_ws, _code, _reason, _wasClean) {
    // `getWebSockets()` already excludes the closing socket by the time this
    // fires. If others remain, keep polling; otherwise schedule teardown after
    // a short grace window so a quick reconnect doesn't churn.
    if (this.countSubscribers() > 0) {
      await this.armHeartbeat();
    } else {
      await this.armTeardown();
    }
  }

  async webSocketError(_ws, _err) {
    if (this.countSubscribers() > 0) {
      await this.armHeartbeat();
    } else {
      await this.armTeardown();
    }
  }

  // The alarm is the only timer that survives hibernation. It serves two jobs:
  //   1. Heartbeat — while subscribers remain, refresh the snapshot and
  //      broadcast it if the price changed, then re-arm.
  //   2. Teardown — if no subscribers remain, stop polling and drop the cached
  //      frame so the next client's replay comes from KV.
  async alarm() {
    if (this.countSubscribers() === 0) {
      this.lastBroadcast = null;
      // No reschedule — the DO can hibernate cleanly until the next client
      // fetch lands.
      return;
    }

    try {
      // buildSnapshot, not refreshSnapshot: this singleton DO already
      // serializes its own polls, so the KV single-flight lock would only add
      // three KV writes per tick for nothing.
      const payload = await buildSnapshot(this.env);
      this.broadcastIfChanged(payload);
    } catch (err) {
      // Both price sources were down. Say nothing on the wire (clients keep
      // their last price and their own staleness check) and try again next tick.
      console.error("hnt-price hub: snapshot refresh failed", err?.message);
    }

    // Re-check: a client may have left while the refresh was in flight.
    if (this.countSubscribers() > 0) {
      await this.armHeartbeat();
    } else {
      this.armTeardown();
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriber accounting
  // ---------------------------------------------------------------------------

  countSubscribers() {
    return this.state.getWebSockets().length;
  }

  // Ensure a heartbeat poll is scheduled. A DO has ONE alarm and setAlarm()
  // REPLACES it, so an unconditional set from every wake path (connect, close,
  // message, error) would let steady client churn postpone the poll forever.
  // Only arm when nothing is pending or the pending alarm is later than our
  // target — keeping an earlier alarm (e.g. a pending teardown) is always
  // safe, because alarm() re-checks the live subscriber count when it fires.
  async armHeartbeat() {
    const target = Date.now() + ALARM_HEARTBEAT_MS;
    const pending = await this.state.storage.getAlarm();
    if (pending === null || pending > target) {
      this.state.storage.setAlarm(target);
    }
  }

  // Schedule a teardown pass after the idle grace. Unlike armHeartbeat this
  // sets unconditionally: pulling the alarm EARLIER is always safe (alarm()
  // decides by live subscriber count), and teardown only runs when the last
  // client just left, so there is no churn path through here.
  armTeardown() {
    this.state.storage.setAlarm(Date.now() + IDLE_TEARDOWN_MS);
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

  // Edge-triggered: only send when the price actually moved. `snapshot_at`
  // changes on every poll and is deliberately NOT part of the change key —
  // keying on it would turn this into an unconditional 15s ping.
  broadcastIfChanged(payload) {
    const key = changeKey(payload);
    if (this.lastBroadcast && this.lastBroadcast.key === key) return;
    const json = JSON.stringify(payload);
    this.lastBroadcast = { key, json };
    this.broadcast(json);
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
