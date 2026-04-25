// Thin promise-based wrapper around packetWorker.js. The worker is spawned
// lazily on first use and lives for the page lifetime — same identity across
// Hotspot switches, segmenters keyed by mac inside the worker.

import PacketWorker from "./packetWorker.js?worker";

let worker = null;
let nextRequestId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new PacketWorker();
  worker.onmessage = (e) => {
    const { requestId } = e.data;
    const resolver = pending.get(requestId);
    if (!resolver) return;
    pending.delete(requestId);
    resolver(e.data);
  };
  // If the worker faults, drain pending callers with an empty error result
  // rather than letting them hang forever. Callers downstream guard on the
  // shape of the response (`packets` / `tracks` arrays), so an empty object
  // is a safe poison pill: state stays empty, no crash.
  const fail = (msg) => {
    console.error("[multi-gateway worker]", msg);
    for (const [id, resolve] of pending) resolve({ error: msg, packets: [], tracks: [] });
    pending.clear();
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

// Initialize segmenter state for `mac` from a freshly fetched packet batch.
// Replaces any existing state. Returns the kept (deduped) packets with
// `_trackId` filled in plus a compact tracks summary.
export function initPackets(mac, packets) {
  return call({ type: "init", mac, packets });
}

// Ingest a single SSE-delivered packet. Returns the annotated packet (with
// `_trackId`), whether it was a duplicate, and the updated tracks summary.
export function ingestPacket(mac, packet) {
  return call({ type: "ingest", mac, packet });
}

// Drop the segmenter state for `mac`. Useful if we ever evict mac state on
// the client side (currently unused — the worker hangs onto state for the
// page lifetime).
export function resetPackets(mac) {
  return call({ type: "reset", mac });
}
