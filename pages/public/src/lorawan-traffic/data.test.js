import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PALETTE,
  SLIDER_MAX,
  assignHotspotIds,
  boundsOf,
  buildOuiRows,
  clampRange,
  countShown,
  fmtWindow,
  groupHits,
  hitsNear,
  inRange,
  ouiLabel,
  radiusFor,
  rangeLabel,
  readUrlState,
  sliderToThreshold,
  thresholdToSlider,
  writeUrlState,
} from "./data.js";

const w = (d1, d7, d30) => ({ "1d": d1, "7d": d7, "30d": d30 });
const INDEX = {
  ouis: [
    { oui: 44, hotspots: w(1, 2, 3), packets: w(10, 70, 300) },
    { oui: 12, hotspots: w(5, 8, 9), packets: w(100, 700, 3000) },
    { oui: 492, hotspots: w(0, 1, 1), packets: w(0, 5, 300) },
  ],
};
const NAMES = new Map([[12, "LoneStar Tracking"], [492, "LoneStar Tracking"]]);
const point = (address, lng, lat, p1, p7, p30) => ({ address, lng, lat, p1, p7, p30 });

function fixture() {
  const rows = buildOuiRows(INDEX, NAMES);
  const registry = new Map();
  const layers = new Map();
  const add = (oui, points) => layers.set(oui, { points, ids: assignHotspotIds(points, registry) });
  add(12, [point("a", 0, 0, 5, 50, 500), point("b", 10, 10, 0, 0, 20), point("c", 0, 0, 1, 2, 3)]);
  add(44, [point("a", 0, 0, 0, 9, 90), point("d", -20, 5, 2, 4, 8)]);
  add(492, []);
  return { rows, layers, scratch: { seen: new Uint32Array(registry.size), epoch: 0 } };
}

test("operators are ordered by 30-day packets, ties by OUI, and colored by that rank", () => {
  const rows = buildOuiRows(INDEX, NAMES);
  assert.deepEqual(rows.map((r) => r.oui), [12, 44, 492]);
  assert.deepEqual(rows.map((r) => r.color), PALETTE.slice(0, 3));
  assert.deepEqual(rows[0].rgb, [0xe7, 0x40, 0x40]);
  assert.deepEqual(rows.map((r) => r.rank), [0, 1, 2]);
});

test("an operator is named from the well-known list and keeps its OUI number", () => {
  const rows = buildOuiRows(INDEX, NAMES);
  assert.deepEqual(rows.map((r) => r.name), ["LoneStar Tracking", null, "LoneStar Tracking"]);
  assert.equal(ouiLabel(rows[0]), "LoneStar Tracking (OUI 12)");
  assert.equal(ouiLabel(rows[1]), "OUI 44");
  assert.ok(rows[0].search.includes("lonestar") && rows[0].search.includes("oui 12"));
});

test("without the well-known list every operator reads by OUI number", () => {
  assert.deepEqual(buildOuiRows(INDEX, null).map((r) => r.name), [null, null, null]);
});

test("an open range has no upper bound", () => {
  assert.equal(inRange(5000, 10, 100, true), true);
  assert.equal(inRange(5000, 10, 100, false), false);
  assert.equal(inRange(9, 10, 100, true), false);
});

test("the slider is a log scale from 1 to the busiest count", () => {
  const max = 7_902_167;
  assert.equal(sliderToThreshold(0, max), 1);
  assert.equal(sliderToThreshold(SLIDER_MAX, max), max);
  assert.equal(thresholdToSlider(1, max), 0);
  assert.equal(thresholdToSlider(max, max), SLIDER_MAX);
  for (const t of [10, 1000, 250_000]) {
    const back = sliderToThreshold(thresholdToSlider(t, max), max);
    assert.ok(Math.abs(back - t) / t < 0.02, `${t} came back as ${back}`);
  }
  assert.equal(thresholdToSlider(5, 1), 0);
});

test("a stored range is fitted to the window's maximum", () => {
  assert.deepEqual(clampRange({ lo: 1, hi: 1, open: true }, 500), { lo: 1, hi: 500, open: true });
  assert.deepEqual(clampRange({ lo: 900, hi: 2000, open: false }, 500), { lo: 500, hi: 500, open: true });
  assert.deepEqual(clampRange({ lo: 10, hi: 5, open: false }, 500), { lo: 10, hi: 10, open: false });
  assert.deepEqual(clampRange({ lo: 0, hi: 40, open: false }, 500), { lo: 1, hi: 40, open: false });
});

test("the range reads in plain words", () => {
  assert.equal(rangeLabel({ lo: 1, hi: 9, open: true }), "any number of packets");
  assert.equal(rangeLabel({ lo: 1000, hi: 9, open: true }), "at least 1,000 packets");
  assert.equal(rangeLabel({ lo: 1000, hi: 50000, open: false }), "1,000 to 50,000 packets");
});

test("dot radius follows the log of the packet count between its stops", () => {
  assert.equal(radiusFor(0), 2.5);
  assert.equal(radiusFor(1), 2.5);
  assert.equal(radiusFor(100), 4);
  assert.equal(radiusFor(10_000), 7);
  assert.equal(radiusFor(1_000_000), 11);
  assert.equal(radiusFor(50_000_000), 11);
  assert.ok(radiusFor(1000) > 4 && radiusFor(1000) < 7);
});

test("shown counts: per operator in range, unique Hotspots across the enabled ones", () => {
  const { rows, layers, scratch } = fixture();
  const all = new Set([12, 44, 492]);
  const full = countShown({ rows, layers, enabled: all, win: "30d", range: { lo: 1, hi: 1, open: true }, scratch });
  assert.deepEqual(full.perOui.get(12), { pass: 3, passPackets: 523, loaded: true });
  assert.deepEqual(full.perOui.get(44), { pass: 2, passPackets: 98, loaded: true });
  // "a" delivers for both operators and counts once.
  assert.equal(full.unique, 4);
  assert.equal(full.packets, 621);

  // The same scratch is reused: a fresh epoch, not stale marks.
  const day = countShown({ rows, layers, enabled: new Set([12]), win: "1d", range: { lo: 1, hi: 1, open: true }, scratch });
  assert.equal(day.unique, 2); // "b" delivered nothing that day
  assert.equal(day.packets, 6);
  assert.equal(day.perOui.get(44).pass, 1, "a switched-off operator still gets its own counts");

  const ranged = countShown({ rows, layers, enabled: all, win: "30d", range: { lo: 10, hi: 100, open: false }, scratch });
  assert.equal(ranged.unique, 2); // b (20) and a via OUI 44 (90)
  assert.equal(ranged.packets, 110);
});

test("an operator whose file hasn't arrived reads as not loaded", () => {
  const { rows, scratch } = fixture();
  const counts = countShown({ rows, layers: new Map(), enabled: new Set([12]), win: "30d", range: { lo: 1, hi: 1, open: true }, scratch });
  assert.deepEqual(counts.perOui.get(12), { pass: 0, passPackets: 0, loaded: false });
});

test("bounds cover the given operators' points", () => {
  const { layers } = fixture();
  assert.deepEqual(boundsOf(layers, [12, 44]), [-20, 0, 10, 10]);
  assert.deepEqual(boundsOf(layers, [44]), [-20, 0, 0, 5]);
  assert.equal(boundsOf(layers, [492]), null);
});

// 10 px per degree, north up.
const project = ([lng, lat]) => [lng * 10, -lat * 10];
const unproject = ([x, y]) => [x / 10, -y / 10];

test("a click lists every shown dot under it, across operators", () => {
  const { layers } = fixture();
  const at = (x, y, extra) =>
    hitsNear({ layers, enabled: new Set([12, 44]), win: "30d", range: { lo: 1, hi: 1, open: true }, x, y, project, unproject, ...extra });

  const stack = at(0, 0);
  assert.deepEqual(stack.map((h) => `${h.oui}:${h.point.address}`).sort(), ["12:a", "12:c", "44:a"]);
  assert.equal(at(50, -50).length, 0, "empty map");
  // "b" has a 20-packet dot (~3.5 px) at (100, -100): 9 px away is within the click pad, 12 is not.
  assert.equal(at(109, -100).length, 1);
  assert.equal(at(112, -100).length, 0);
  // Switched-off operators and out-of-range dots can't be clicked.
  assert.deepEqual(at(0, 0, { enabled: new Set([44]) }).map((h) => h.oui), [44]);
  assert.deepEqual(at(0, 0, { range: { lo: 100, hi: 1, open: true } }).map((h) => h.point.address), ["a"]);
  assert.equal(at(100, -100, { win: "7d" }).length, 0, "no packets in that window, no dot");
});

test("clicked dots group into one row per Hotspot, busiest first", () => {
  const { layers } = fixture();
  const hits = hitsNear({ layers, enabled: new Set([12, 44]), win: "30d", range: { lo: 1, hi: 1, open: true }, x: 0, y: 0, project, unproject });
  const { rows, sameSpot } = groupHits(hits, "30d");
  assert.equal(sameSpot, true);
  assert.deepEqual(rows.map((r) => [r.address, r.total]), [["a", 590], ["c", 3]]);
  assert.deepEqual(rows[0].per, [{ oui: 12, packets: 500 }, { oui: 44, packets: 90 }]);
  // The same dots read in another window.
  assert.deepEqual(groupHits(hits, "7d").rows[0].per, [{ oui: 12, packets: 50 }, { oui: 44, packets: 9 }]);
  const spread = groupHits([...hits, { oui: 12, point: layers.get(12).points[1] }], "30d");
  assert.equal(spread.sameSpot, false);
});

test("URL filters round-trip and fall back to defaults", () => {
  const read = (qs) => readUrlState(new URLSearchParams(qs));
  assert.deepEqual(read(""), { win: "30d", ouis: null, min: null, max: null });
  assert.deepEqual(read("window=7d&ouis=12,492,12&min=100&max=5000"), { win: "7d", ouis: [12, 492], min: 100, max: 5000 });
  assert.deepEqual(read("window=2y&ouis=abc,-4&min=-3&max=1e9"), { win: "30d", ouis: null, min: null, max: null });
  assert.deepEqual(read("ouis=none").ouis, []);

  const allOuis = [12, 44, 492];
  const open = { lo: 1, hi: 900, open: true };
  assert.equal(writeUrlState({ win: "30d", enabled: new Set(allOuis), allOuis, range: open }), "");
  assert.equal(
    writeUrlState({ win: "7d", enabled: new Set([492, 12]), allOuis, range: { lo: 100, hi: 5000, open: false } }),
    "window=7d&ouis=12,492&min=100&max=5000",
  );
  assert.equal(writeUrlState({ win: "30d", enabled: new Set(), allOuis, range: open }), "ouis=none");
});

test("a window reads as one day or a span, in UTC", () => {
  assert.equal(fmtWindow({ start: "2026-11-09", end: "2026-11-09" }), "Nov 9");
  assert.equal(fmtWindow({ start: "2026-10-11", end: "2026-11-09" }), "Oct 11 to Nov 9");
});
