// Web Worker that owns the multi-gateway tool's entire ingest pipeline:
// the SSE EventSource, the per-mac LoRaWAN segmenters, and (phase 3) an
// IndexedDB cache of recent packets. Pulling all of this off the main
// thread means a backgrounded tab still absorbs SSE; segmentation never
// jams the UI; and reload hydrates from IDB before the network fetch lands.

import { createSegmenter, ingest, ingestBatch, listTracks } from "./segmentation.js";
import { fetchGatewayPackets, createEventSource } from "../lib/multiGatewayApi.js";
import { hydrateCache, writePackets, readPackets } from "./packetCache.js";

const segmenters = new Map();      // mac -> segmenter state, only for subscribed macs
const subscribedMacs = new Set();  // chart-active macs we ingest into
let eventSource = null;
let sseStatus = "disconnected";

function summarizeTrack(t) {
  return {
    id: t.id,
    devAddr: t.devAddr,
    netId: t.netId,
    count: t.count,
    firstTs: t.firstTs,
    lastTs: t.lastTs,
    rssiMean: t.rssiMean,
  };
}

function summariesFor(mac) {
  const seg = segmenters.get(mac);
  return seg ? listTracks(seg).map(summarizeTrack) : [];
}

function getOrCreateSegmenter(mac) {
  let seg = segmenters.get(mac);
  if (!seg) {
    seg = createSegmenter();
    segmenters.set(mac, seg);
  }
  return seg;
}

function broadcast(event) {
  self.postMessage(event); // requestId-less ⇒ broadcast on the client side
}

function setSseStatus(status) {
  if (sseStatus === status) return;
  sseStatus = status;
  broadcast({ type: "sse_status", status });
}

function handleSseMessage(data) {
  // The router worker emits a single error payload + closes the stream when
  // it can't reach any upstream LNS. Surface that as a distinct "unavailable"
  // status (vs. transient reconnecting) and back off so we stop strobing
  // every 3s.
  if (data?.error === "No upstream available") {
    setSseStatus("unavailable");
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clearStaleTimer();
    clearUpstreamDownTimer();
    upstreamDownTimer = setTimeout(() => {
      upstreamDownTimer = null;
      ensureSse();
    }, UPSTREAM_DOWN_BACKOFF_MS);
    return;
  }
  switch (data.type) {
    case "gateway_connect":
    case "gateway_disconnect":
      // Forward verbatim — main thread maintains the gateways[] list.
      broadcast(data);
      return;
    case "uplink":
    case "downlink": {
      broadcast({ type: data.type === "uplink" ? "sse_uplink" : "sse_downlink", mac: data.mac });
      if (!subscribedMacs.has(data.mac) || !data.metadata) return;
      const seg = getOrCreateSegmenter(data.mac);
      const packet = { ...data.metadata, _new: true };
      const result = ingest(seg, packet);
      if (result.duplicate) return;
      packet._trackId = result.trackId;
      broadcast({
        type: "subscribed_packet",
        mac: data.mac,
        packet,
        tracks: summariesFor(data.mac),
      });
      writePackets(data.mac, [packet]).catch(() => {});
      return;
    }
  }
}

// Once EventSource enters CLOSED (server returned non-2xx, e.g. a CF gateway
// timeout) it stops auto-retrying. We rebuild manually after a short delay so
// status doesn't stick at "reconnecting" forever. Also covers the case where
// a transient blip keeps firing onerror without ever firing onopen — we
// schedule an unconditional rebuild as a safety net while still letting the
// EventSource's own retry win first.
const RECONNECT_AFTER_CLOSED_MS = 2000;
const STALE_RECONNECT_MS = 15000;
// When the server tells us the upstream LNS is unreachable, EventSource's
// 3s auto-retry would just hammer the same dead path. Back off to 30s
// instead so the page doesn't strobe "Reconnecting" while the operator
// fixes the upstream.
const UPSTREAM_DOWN_BACKOFF_MS = 30000;
let staleTimer = null;
let upstreamDownTimer = null;

function clearStaleTimer() {
  if (staleTimer) {
    clearTimeout(staleTimer);
    staleTimer = null;
  }
}

function clearUpstreamDownTimer() {
  if (upstreamDownTimer) {
    clearTimeout(upstreamDownTimer);
    upstreamDownTimer = null;
  }
}

function armStaleTimer() {
  clearStaleTimer();
  staleTimer = setTimeout(() => {
    // If we've been stuck in not-connected this long, the built-in retry
    // isn't going to recover. Rebuild from scratch.
    if (sseStatus !== "connected") reconnectSse();
  }, STALE_RECONNECT_MS);
}

function ensureSse() {
  if (eventSource) return;
  setSseStatus("connecting");
  armStaleTimer();
  const es = createEventSource();
  eventSource = es;
  es.onopen = () => {
    clearStaleTimer();
    setSseStatus("connected");
  };
  es.onerror = () => {
    setSseStatus("reconnecting");
    if (es.readyState === EventSource.CLOSED) {
      // Auto-retry has given up. Schedule a manual rebuild.
      clearStaleTimer();
      setTimeout(() => {
        if (eventSource === es) reconnectSse();
      }, RECONNECT_AFTER_CLOSED_MS);
    } else {
      armStaleTimer();
    }
  };
  es.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    handleSseMessage(data);
  };
}

// Force a fresh SSE connection. Called from the page's visibility listener
// and from our own CLOSED/stale-retry recovery paths — EventSource's
// built-in auto-reconnect gives up once the server returns a non-2xx, and
// can also silently stall after a tab suspension on mobile.
function reconnectSse() {
  clearStaleTimer();
  clearUpstreamDownTimer();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  ensureSse();
}

async function subscribePackets(mac) {
  // Replace any stale state for this mac so a switch can't bleed across.
  segmenters.set(mac, createSegmenter());
  subscribedMacs.add(mac);

  // Hydrate from IDB cache first so the chart can show something instant
  // while the network fetch is in flight. Cached packets are ingested into
  // the fresh segmenter, then we send a `cached` event with the result.
  const cached = await readPackets(mac).catch(() => []);
  if (cached.length > 0) {
    const kept = ingestBatch(segmenters.get(mac), cached.map((p) => ({ ...p, _new: false })));
    broadcast({ type: "cached_packets", mac, packets: kept, tracks: summariesFor(mac) });
  }

  let packets = [];
  try {
    packets = await fetchGatewayPackets(mac);
  } catch (err) {
    broadcast({ type: "subscribe_error", mac, message: err?.message ?? "fetch failed" });
    return { packets: [], tracks: summariesFor(mac) };
  }

  // Reset segmenter again before the authoritative ingest so any SSE packet
  // delivered during the fetch window doesn't get mixed in.
  segmenters.set(mac, createSegmenter());
  const tagged = packets.map((p) => ({ ...p, _new: false }));
  const kept = ingestBatch(segmenters.get(mac), tagged);
  writePackets(mac, kept).catch(() => {});
  return { packets: kept, tracks: summariesFor(mac) };
}

function unsubscribePackets(mac) {
  subscribedMacs.delete(mac);
  segmenters.delete(mac);
}

self.onmessage = async (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "connect_sse":
      ensureSse();
      break;
    case "subscribe_packets": {
      const result = await subscribePackets(msg.mac);
      self.postMessage({
        type: "subscribe_packets_done",
        requestId: msg.requestId,
        mac: msg.mac,
        packets: result.packets,
        tracks: result.tracks,
      });
      break;
    }
    case "unsubscribe_packets":
      unsubscribePackets(msg.mac);
      self.postMessage({ type: "unsubscribe_packets_done", requestId: msg.requestId, mac: msg.mac });
      break;
    case "reconnect_sse":
      reconnectSse();
      break;
  }
};

// Warm the IDB cache early so the first subscribe_packets doesn't pay
// connection-open cost in line with the user's first chart render.
hydrateCache().catch(() => {});
