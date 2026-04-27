import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/multi-gateway"
  : "https://api.heliumtools.org/multi-gateway";

// The worker now fans events out via a WebSocket-backed Durable Object so a
// single upstream SSE per region serves every connected dashboard. We still
// expose an EventSource-shaped object so the rest of the client doesn't care
// about the wire change. See worker/src/tools/multi-gateway/hub.js for the
// upstream side and the SseLikeSocket wrapper below for the shape.
const EVENTS_WS_URL = (() => {
  // Build the absolute WS URL from API_BASE so the dev proxy can forward it.
  // Use globalThis.location so this works in both the main thread and inside
  // packetWorker.js (Web Workers have `self`/`globalThis`, not `window`).
  const u = new URL(`${API_BASE}/events`, globalThis.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
})();

export async function fetchGateways() {
  const res = await fetch(`${API_BASE}/gateways`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch gateways");
  return data;
}

export async function fetchGatewayPackets(mac) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/packets`);
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || "Failed to fetch packets");
  return data;
}

// Wrap the WebSocket in an EventSource-like surface so the existing
// packetWorker.js consumer (onopen/onerror/onmessage + close + readyState +
// CLOSED constant) needs no behavioural changes. Each WS text frame is
// re-emitted as a MessageEvent whose `data` is the JSON string the server
// sent, matching what EventSource used to deliver as `event.data`.
class SseLikeSocket {
  static get CLOSED() { return 3; }
  constructor(url) {
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this._ws = new WebSocket(url);
    this._closed = false;
    // Distinguish a consumer-initiated close() from a server/network drop so
    // the legacy "No upstream available" path (which calls close() and sets
    // status to "unavailable") doesn't get its status flipped to "reconnecting"
    // by a stray onerror right after.
    this._intentionallyClosed = false;
    this._ws.addEventListener("open", (e) => this.onopen?.(e));
    this._ws.addEventListener("error", (e) => {
      if (this._intentionallyClosed) return;
      this.onerror?.(e);
    });
    this._ws.addEventListener("close", (e) => {
      this._closed = true;
      if (this._intentionallyClosed) return;
      // Surface unexpected disconnects as an error so the consumer's reconnect
      // path runs (matches EventSource behaviour, which also fires `error`
      // — not a separate `close` — on unexpected disconnect).
      this.onerror?.(e);
    });
    this._ws.addEventListener("message", (e) => {
      // The server sends raw JSON envelopes per frame; mirror EventSource's
      // shape where event.data is a string.
      this.onmessage?.({ data: e.data });
    });
  }
  get readyState() {
    if (this._closed || this._ws.readyState === WebSocket.CLOSED) return SseLikeSocket.CLOSED;
    return this._ws.readyState;
  }
  close() {
    this._intentionallyClosed = true;
    this._closed = true;
    try { this._ws.close(); } catch { /* already closed */ }
  }
}

export function createEventSource() {
  return new SseLikeSocket(EVENTS_WS_URL);
}

export async function fetchOuis() {
  const res = await fetch(`${API_BASE}/ouis`);
  const data = await parseJson(res);
  if (!res.ok) return null;
  return data;
}

export async function checkOnchainStatus(pubkeys) {
  const res = await fetch(`${API_BASE}/onchain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkeys }),
  });
  const data = await parseJson(res);
  if (!res.ok) return {};
  return data?.results || {};
}

export async function requestIssueTxns(mac, owner) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  if (!data) throw new Error("Empty response from server");
  return data;
}

export async function requestOnboardTxn(mac, owner, { location, elevation, gain } = {}) {
  const res = await fetch(`${API_BASE}/gateways/${mac}/onboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, location, elevation, gain }),
  });
  const data = await parseJson(res);
  if (!res.ok) throw new Error(data?.error || `Server returned ${res.status}`);
  if (!data) throw new Error("Empty response from server");
  return data;
}
