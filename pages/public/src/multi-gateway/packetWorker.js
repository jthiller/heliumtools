// Web Worker that owns the LoRaWAN packet segmenter per Hotspot mac so
// segmentation runs off the main thread — keeps the UI responsive even when
// a backgrounded tab regains focus and floods us with buffered SSE packets.

import { createSegmenter, ingest, ingestBatch, listTracks } from "./segmentation.js";

const segmenters = new Map();

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

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      // Replace any existing segmenter for this mac so a Hotspot switch
      // can't bleed track ids from the previous selection.
      segmenters.set(msg.mac, createSegmenter());
      const kept = ingestBatch(segmenters.get(msg.mac), msg.packets);
      self.postMessage({
        type: "init_done",
        requestId: msg.requestId,
        mac: msg.mac,
        packets: kept,
        tracks: summariesFor(msg.mac),
      });
      break;
    }
    case "ingest": {
      const seg = getOrCreateSegmenter(msg.mac);
      const result = ingest(seg, msg.packet);
      const packet = { ...msg.packet, _trackId: result.trackId };
      self.postMessage({
        type: "ingest_done",
        requestId: msg.requestId,
        mac: msg.mac,
        packet,
        duplicate: result.duplicate,
        tracks: summariesFor(msg.mac),
      });
      break;
    }
    case "reset": {
      segmenters.delete(msg.mac);
      self.postMessage({ type: "reset_done", requestId: msg.requestId, mac: msg.mac });
      break;
    }
  }
};
