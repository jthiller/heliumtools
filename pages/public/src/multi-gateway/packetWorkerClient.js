// Main-thread API for packetWorker.js.
//
// Two channels go through the same worker port:
//   - request/response — promise-based, matched by an internal `requestId`.
//     Used for one-shot operations (subscribePackets, unsubscribePackets).
//   - broadcasts — events with no requestId. Listeners registered via
//     `onWorkerEvent` receive every broadcast; consumers filter by `type`.
//
// The worker is spawned lazily on first use and lives for the page
// lifetime. Per-mac state inside the worker is keyed by mac, so a single
// worker instance handles every Hotspot the user opens.

import PacketWorker from "./packetWorker.js?worker";

let worker = null;
let nextRequestId = 1;
const pending = new Map();
const listeners = new Set();

function ensureWorker() {
  if (worker) return worker;
  worker = new PacketWorker();
  worker.onmessage = (e) => {
    const data = e.data;
    if (data.requestId != null) {
      const resolver = pending.get(data.requestId);
      if (!resolver) return;
      pending.delete(data.requestId);
      resolver(data);
      return;
    }
    for (const fn of listeners) fn(data);
  };
  // Drain pending and listeners on a fatal worker error so the page doesn't
  // hang. State stays empty (safe poison-pill shape).
  const fail = (msg) => {
    console.error("[multi-gateway worker]", msg);
    for (const [id, resolve] of pending) resolve({ error: msg, packets: [], tracks: [] });
    pending.clear();
    for (const fn of listeners) fn({ type: "worker_error", message: msg });
  };
  worker.onerror = (e) => fail(e.message || "worker error");
  worker.onmessageerror = () => fail("worker message error");
  return worker;
}

function call(message) {
  const w = ensureWorker();
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    w.postMessage({ ...message, requestId });
  });
}

// One-shot: ask the worker to start its SSE connection. Idempotent.
export function connectSse() {
  ensureWorker().postMessage({ type: "connect_sse" });
}

// Force the worker to drop its current EventSource and open a fresh one.
// Called from the page's visibility listener — mobile browsers occasionally
// suspend the worker mid-SSE, and the resumed connection is dead without
// firing an error event. This pokes the worker to rebuild from scratch.
export function reconnectSse() {
  ensureWorker().postMessage({ type: "reconnect_sse" });
}

// Register interest in a specific mac. Worker fetches the initial batch,
// runs it through the segmenter, and resolves with the kept packets +
// tracks summary. Live SSE packets for the same mac follow as broadcasts
// (`type: "subscribed_packet"`). May also broadcast `cached_packets` first
// if the IDB cache has a stale snapshot we can paint immediately.
export function subscribePackets(mac) {
  return call({ type: "subscribe_packets", mac });
}

export function unsubscribePackets(mac) {
  return call({ type: "unsubscribe_packets", mac });
}

// Subscribe to all worker broadcasts. Returns an unsubscribe fn. Consumers
// switch on `event.type` — see worker source for the wire types.
export function onWorkerEvent(handler) {
  ensureWorker();
  listeners.add(handler);
  return () => listeners.delete(handler);
}
