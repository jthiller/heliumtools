// Segments LoRaWAN uplink packets seen at one gateway into "tracks" that
// estimate individual physical devices. Two devices can share a DevAddr, so
// identity comes from fcnt continuity; RSSI is only a loose cross-device guard.
//
// Pure module: no React deps. Callers hold the returned state in a ref.

import { devAddrToNetId } from "../lib/lorawan.js";

const FCNT_GAP_MAX = 64;          // max jump in fcnt to stay on the same track
const FCNT_WRAP_WINDOW = 16;      // accept wrap only when old fcnt is near 16-bit top
const FCNT_MAX = 65536;
const RSSI_HARD_LIMIT_DBM = 30;   // reject cross-device merges across huge RSSI gaps
const RSSI_WEIGHT = 0.05;         // tie-breaker: 20 dB ≈ 1 fcnt slot of score
const DUP_WINDOW_MS = 2000;       // same (D,F) within this delta is multi-channel duplicate
const MAX_TRACKS_PER_DEVADDR = 4;
const DEDUPE_CAP = 500;

const JOIN_FRAMES = new Set([
  "JoinRequest",
  "JoinAccept",
  "RejoinRequest",
  "Proprietary",
]);
const DOWNLINK_FRAMES = new Set(["UnconfirmedDown", "ConfirmedDown"]);

const JOINS_ID = "joins";
const DOWNLINKS_ID = "downlinks";

export function createSegmenter() {
  return {
    tracks: new Map(),
    byDevAddr: new Map(),
    joins: makeBucket(JOINS_ID),
    downlinks: makeBucket(DOWNLINKS_ID),
    dedupe: new Map(),
    nextId: 1,
  };
}

function makeBucket(id) {
  return {
    id,
    devAddr: null,
    netId: null,
    firstTs: 0,
    lastTs: 0,
    firstFcnt: null,
    lastFcnt: null,
    rssiMean: 0,
    rssiMin: Infinity,
    rssiMax: -Infinity,
    sfMode: new Map(),
    count: 0,
  };
}

function newTrack(state, pkt) {
  const id = `T${state.nextId++}`;
  const netIdInfo = devAddrToNetId(pkt.dev_addr);
  const t = makeBucket(id);
  t.devAddr = pkt.dev_addr;
  t.netId = netIdInfo?.netId ?? null;
  t.firstTs = pkt.timestamp;
  t.firstFcnt = pkt.fcnt;
  state.tracks.set(id, t);
  return t;
}

function updateTrack(t, pkt) {
  t.count += 1;
  t.rssiMean += (pkt.rssi - t.rssiMean) / t.count;
  if (pkt.rssi < t.rssiMin) t.rssiMin = pkt.rssi;
  if (pkt.rssi > t.rssiMax) t.rssiMax = pkt.rssi;
  t.lastTs = pkt.timestamp;
  t.lastFcnt = pkt.fcnt;
  if (pkt.spreading_factor) {
    t.sfMode.set(pkt.spreading_factor, (t.sfMode.get(pkt.spreading_factor) ?? 0) + 1);
  }
}

function wrappedGap(lastFcnt, newFcnt) {
  if (lastFcnt == null) return 1;
  if (newFcnt > lastFcnt) return newFcnt - lastFcnt;
  if (newFcnt < lastFcnt && lastFcnt > FCNT_MAX - FCNT_WRAP_WINDOW) {
    return FCNT_MAX - lastFcnt + newFcnt;
  }
  return -1;
}

function scoreTrack(track, pkt, gap) {
  return gap + RSSI_WEIGHT * Math.abs(pkt.rssi - track.rssiMean);
}

function pickTrack(state, pkt) {
  const candidates = state.byDevAddr.get(pkt.dev_addr);
  if (!candidates || candidates.length === 0) return null;
  let best = null;
  let bestScore = Infinity;
  for (const t of candidates) {
    const gap = wrappedGap(t.lastFcnt, pkt.fcnt);
    if (gap < 1 || gap > FCNT_GAP_MAX) continue;
    if (Math.abs(pkt.rssi - t.rssiMean) > RSSI_HARD_LIMIT_DBM) continue;
    const s = scoreTrack(t, pkt, gap);
    if (s < bestScore) {
      bestScore = s;
      best = t;
    }
  }
  return best;
}

function attachToDevAddr(state, track) {
  let list = state.byDevAddr.get(track.devAddr);
  if (!list) {
    list = [];
    state.byDevAddr.set(track.devAddr, list);
  }
  if (list.length >= MAX_TRACKS_PER_DEVADDR) {
    // Evict track with lowest count — least evidence it's a real device.
    let victimIdx = 0;
    for (let i = 1; i < list.length; i++) {
      if (list[i].count < list[victimIdx].count) victimIdx = i;
    }
    const victim = list[victimIdx];
    state.tracks.delete(victim.id);
    list.splice(victimIdx, 1);
  }
  list.push(track);
}

function trimDedupe(state) {
  if (state.dedupe.size <= DEDUPE_CAP) return;
  // Maps preserve insertion order; drop the oldest entries.
  const drop = state.dedupe.size - DEDUPE_CAP;
  const it = state.dedupe.keys();
  for (let i = 0; i < drop; i++) {
    state.dedupe.delete(it.next().value);
  }
}

export function ingest(state, pkt) {
  if (JOIN_FRAMES.has(pkt.frame_type)) {
    updateTrack(state.joins, pkt);
    return { trackId: JOINS_ID, duplicate: false };
  }
  if (DOWNLINK_FRAMES.has(pkt.frame_type)) {
    updateTrack(state.downlinks, pkt);
    return { trackId: DOWNLINKS_ID, duplicate: false };
  }
  if (!pkt.dev_addr || pkt.fcnt == null) {
    return { trackId: null, duplicate: false };
  }

  const dupKey = `${pkt.dev_addr}:${pkt.fcnt}`;
  const recent = state.dedupe.get(dupKey);
  if (recent && pkt.timestamp - recent.ts < DUP_WINDOW_MS) {
    if (pkt.rssi > recent.rssi) {
      // Keep the stronger copy — update recorded RSSI so further dupes compare against it.
      state.dedupe.set(dupKey, { ts: pkt.timestamp, rssi: pkt.rssi, trackId: recent.trackId });
    }
    return { trackId: recent.trackId, duplicate: true };
  }

  const matched = pickTrack(state, pkt);
  let track;
  if (matched) {
    track = matched;
    updateTrack(track, pkt);
  } else {
    track = newTrack(state, pkt);
    attachToDevAddr(state, track);
    updateTrack(track, pkt);
  }
  state.dedupe.set(dupKey, { ts: pkt.timestamp, rssi: pkt.rssi, trackId: track.id });
  trimDedupe(state);
  return { trackId: track.id, duplicate: false };
}

export function ingestBatch(state, pkts) {
  const sorted = [...pkts].sort((a, b) => a.timestamp - b.timestamp);
  for (const pkt of sorted) {
    const res = ingest(state, pkt);
    pkt._trackId = res.trackId;
  }
  return sorted;
}

export function listTracks(state) {
  return [...state.tracks.values()];
}

// djb2 → hue. Deterministic, stable across renders.
function hashHue(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

const JOINS_COLOR = "#8b5cf6";       // violet
const DOWNLINKS_COLOR = "#0ea5e9";   // sky

export function colorForTrack(id, isDark = false) {
  if (id === JOINS_ID) return JOINS_COLOR;
  if (id === DOWNLINKS_ID) return DOWNLINKS_COLOR;
  const h = hashHue(id);
  const l = isDark ? 60 : 50;
  return `hsl(${h}, 65%, ${l}%)`;
}

export const BUCKET_IDS = { joins: JOINS_ID, downlinks: DOWNLINKS_ID };
