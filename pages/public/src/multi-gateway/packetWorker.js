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

function ensureSse() {
  if (eventSource) return;
  setSseStatus("connecting");
  const es = createEventSource();
  eventSource = es;
  es.onopen = () => setSseStatus("connected");
  es.onerror = () => setSseStatus("reconnecting");
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

// Force a fresh SSE connection. Called when the page returns to focus —
// EventSource's built-in auto-reconnect occasionally gets stuck on mobile
// (the socket is dead but no error event fires after the tab was
// backgrounded), so the main thread's visibility listener pokes us to
// rebuild the connection from scratch.
function reconnectSse() {
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
