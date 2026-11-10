import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerWebMcpTools } from "../webmcp/webmcp.js";
import { TOOL_CATALOG } from "../webmcp/catalog.js";
import { normalizeTrafficPoints, ouiTrafficUrl } from "../lib/iotStatusApi.js";
import { makeLorawanTrafficTools } from "./webmcpTools.js";
import { buildOuiRows, clampRange, countShown, assignHotspotIds } from "./data.js";

// One network read serves every test: the client keeps the index for 30 s and
// the per-operator files for the session, as it does on the page.
const INDEX = {
  dataThrough: "2026-11-09",
  version: "build-1",
  windows: {
    "1d": { start: "2026-11-09", end: "2026-11-09" },
    "7d": { start: "2026-11-03", end: "2026-11-09" },
    "30d": { start: "2026-10-11", end: "2026-11-09" },
  },
  window: { days: 30, daysComplete: 30, missingDays: [] },
  totals: { gateways: { "1d": 3, "7d": 4, "30d": 5 }, packets: { "1d": 16, "7d": 115, "30d": 911 } },
  maxPackets: { "1d": 9, "7d": 60, "30d": 500 },
  ouis: [
    { oui: 44, gateways1d: 1, gateways7d: 2, gateways30d: 2, packets1d: 9, packets7d: 60, packets30d: 300 },
    { oui: 12, gateways1d: 2, gateways7d: 3, gateways30d: 4, packets1d: 7, packets7d: 55, packets30d: 611 },
    { oui: 7, gateways1d: 0, gateways7d: 0, gateways30d: 1, packets1d: 0, packets7d: 0, packets30d: 0 },
  ],
  files: { gateways: "/v1/iot/utilization/gateways.geojson", oui: "/v1/iot/utilization/oui/{oui}.geojson", ouis: [12, 44] },
};
const feature = (address, lng, lat, d1, d7, d30) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lng, lat] },
  properties: { address, packets1d: d1, packets7d: d7, packets30d: d30 },
});
const FILES = {
  12: [feature("hsA", 1, 2, 5, 40, 500), feature("hsB", 3, 4, 2, 15, 100), feature("hsC", 5, 6, 0, 0, 11)],
  44: [feature("hsA", 1, 2, 9, 60, 300)],
};
const WELL_KNOWN = [{ id: 12, name: "LoneStar Tracking" }, { id: null, name: "A Mobile escrow" }];

const originalFetch = globalThis.fetch;
let requests;
let cleanups;
let registered;

beforeEach(() => {
  requests = [];
  cleanups = [];
  registered = new Map();
  globalThis.document = {
    modelContext: {
      registerTool(tool, { signal }) {
        registered.set(tool.name, tool);
        signal.addEventListener("abort", () => registered.delete(tool.name), { once: true });
        return Promise.resolve();
      },
    },
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    const json = (data, type = "application/json") => new Response(JSON.stringify(data), { headers: { "Content-Type": type } });
    if (url.endsWith("/v1/iot/utilization")) return json(INDEX);
    if (url.includes("well-known")) return json(WELL_KNOWN, "text/plain");
    const file = url.match(/\/oui\/(\d+)\.geojson\?v=build-1$/);
    if (file && FILES[file[1]]) return json({ type: "FeatureCollection", features: FILES[file[1]] }, "application/geo+json");
    return new Response("Not found", { status: 404 });
  };
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  delete globalThis.document;
  globalThis.fetch = originalFetch;
});

function expose(name, callbacks = {}) {
  cleanups.push(registerWebMcpTools(makeLorawanTrafficTools({ showTraffic() {}, ...callbacks })));
  const found = registered.get(name);
  assert.ok(found, `Missing tool ${name}`);
  return found;
}
const read = (result) => {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
};

// First, while the client's caches are empty: the read below must reach fetch.
test("cancelling a read aborts its request and stays an abort", async () => {
  let requestSignal;
  let begin;
  const started = new Promise((resolve) => { begin = resolve; });
  globalThis.fetch = (_url, { signal } = {}) => {
    requestSignal = signal;
    begin();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  const controller = new AbortController();
  const execution = expose("get-lorawan-traffic-summary").execute({}, { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(execution, { name: "AbortError" });
  assert.equal(requestSignal.aborted, true);
});

test("the page's tools are the ones the catalog promises", () => {
  const names = makeLorawanTrafficTools({ showTraffic() {} }).map((t) => t.name);
  assert.deepEqual(TOOL_CATALOG.find((t) => t.path === "/lorawan-traffic")?.tools, names);
});

test("the summary lists operators busiest first for the window, named where well-known", async () => {
  const day = read(await expose("get-lorawan-traffic-summary").execute({ window: "1d" }));
  assert.deepEqual(day.dates, { start: "2026-11-09", end: "2026-11-09" });
  assert.deepEqual(day.network, { hotspots: 3, packets: 16 });
  assert.deepEqual(day.ouis, [
    { oui: 44, name: null, hotspots: 1, packets: 9 },
    { oui: 12, name: "LoneStar Tracking", hotspots: 2, packets: 7 },
    { oui: 7, name: null, hotspots: 0, packets: 0 },
  ]);
  // The default window is 30 days, where OUI 12 leads.
  const month = read(await expose("get-lorawan-traffic-summary").execute({}));
  assert.equal(month.window, "30d");
  assert.deepEqual(month.ouis.map((o) => o.oui), [12, 44, 7]);
});

test("an operator's Hotspots are paged busiest first, without the ones silent in the window", async () => {
  const tool = expose("get-operator-hotspots");
  const first = read(await tool.execute({ oui: 12, window: "7d", limit: 1 }));
  assert.equal(first.name, "LoneStar Tracking");
  assert.equal(first.hotspotsInWindow, 3);
  assert.deepEqual(first.hotspots.map((h) => [h.address, h.lat, h.lng, h.packets]), [["hsA", 2, 1, 40]]);
  assert.equal(typeof first.hotspots[0].name, "string");
  assert.deepEqual(first.pagination, { offset: 0, limit: 1, total: 2, returned: 1, nextOffset: 1 });
  const second = read(await tool.execute({ oui: 12, window: "7d", limit: 1, offset: 1 }));
  assert.deepEqual(second.hotspots.map((h) => h.address), ["hsB"]);
  assert.equal(second.pagination.nextOffset, null);
  // One file read serves both pages.
  assert.equal(requests.filter((u) => u.includes("/oui/12.geojson")).length <= 1, true);
});

test("an operator with no file has no located Hotspots; an unknown OUI is an error", async () => {
  const tool = expose("get-operator-hotspots");
  const quiet = read(await tool.execute({ oui: 7 }));
  assert.deepEqual(quiet.hotspots, []);
  assert.equal(quiet.pagination.total, 0);
  const unknown = await tool.execute({ oui: 999 });
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /no operator with OUI 999/);
  const bad = await tool.execute({ oui: "twelve" });
  assert.equal(bad.isError, true);
});

test("show-lorawan-traffic hands the page a full set of filters and reports what it shows", async () => {
  const calls = [];
  const showTraffic = async (filters) => {
    calls.push(filters);
    const index = {
      dataThrough: "2026-11-09",
      windows: INDEX.windows,
      missingDays: [],
      totals: { hotspots: INDEX.totals.gateways, packets: INDEX.totals.packets },
      maxPackets: INDEX.maxPackets,
      ouis: INDEX.ouis.map((o) => ({
        oui: o.oui,
        hotspots: { "1d": o.gateways1d, "7d": o.gateways7d, "30d": o.gateways30d },
        packets: { "1d": o.packets1d, "7d": o.packets7d, "30d": o.packets30d },
      })),
    };
    const rows = buildOuiRows(index, new Map([[12, "LoneStar Tracking"]]));
    const registry = new Map();
    const layers = new Map(
      Object.entries(FILES).map(([oui, features]) => {
        const points = normalizeTrafficPoints({ features });
        return [Number(oui), { points, ids: assignHotspotIds(points, registry) }];
      }),
    );
    const enabled = new Set(filters.ouis || rows.map((r) => r.oui));
    const range = clampRange({ lo: filters.minPackets, hi: filters.maxPackets ?? 1, open: filters.maxPackets == null }, index.maxPackets[filters.window]);
    const counts = countShown({ rows, layers, enabled, win: filters.window, range, scratch: { seen: new Uint32Array(registry.size), epoch: 0 } });
    return { index, rows, enabled, win: filters.window, range, counts, failed: [] };
  };

  const tool = expose("show-lorawan-traffic", { showTraffic });
  const all = read(await tool.execute({}));
  assert.deepEqual(calls[0], { ouis: null, window: "30d", minPackets: 1, maxPackets: undefined });
  assert.equal(all.hotspotsShown, 3); // hsA delivers for both operators and counts once
  assert.equal(all.packetsShown, 911);
  assert.equal(all.url, "/lorawan-traffic");
  assert.deepEqual(all.packetRange, { min: 1, max: null });

  const one = read(await tool.execute({ ouis: [12, 12], window: "7d", min_packets: 20, max_packets: 50 }));
  assert.deepEqual(calls[1], { ouis: [12], window: "7d", minPackets: 20, maxPackets: 50 });
  assert.deepEqual(one.ouis, [{ oui: 12, name: "LoneStar Tracking", hotspotsShown: 1, hotspotsInWindow: 3, packetsShown: 40 }]);
  assert.equal(one.operatorsShown, 1);
  assert.equal(one.url, "/lorawan-traffic?window=7d&ouis=12&min=20&max=50");

  const inverted = await tool.execute({ min_packets: 50, max_packets: 20 });
  assert.equal(inverted.isError, true);
  assert.equal(calls.length, 2, "an invalid range never reaches the page");
});

test("per-operator points keep only located, addressed Hotspots", () => {
  const points = normalizeTrafficPoints({
    features: [
      feature("ok", 10.5, -3.25, 1, 2, 3),
      { type: "Feature", geometry: null, properties: { address: "nowhere" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [NaN, 1] }, properties: { address: "nan" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: {} },
      { type: "Feature", geometry: { type: "LineString", coordinates: [[1, 1]] }, properties: { address: "line" } },
      feature("odd", 1, 1, -4, "7", undefined),
    ],
  });
  assert.deepEqual(points, [
    { address: "ok", lng: 10.5, lat: -3.25, p1: 1, p7: 2, p30: 3 },
    { address: "odd", lng: 1, lat: 1, p1: 0, p7: 0, p30: 0 },
  ]);
  assert.deepEqual(normalizeTrafficPoints(null), []);
  assert.deepEqual(normalizeTrafficPoints({ features: "nope" }), []);
});

test("a per-operator file URL stays on the API's origin and carries the build", () => {
  assert.equal(
    ouiTrafficUrl("/v1/iot/utilization/oui/{oui}.geojson", 12, "build-1"),
    "https://api-iot.heliumtools.org/v1/iot/utilization/oui/12.geojson?v=build-1",
  );
  assert.equal(ouiTrafficUrl("/v1/x/{oui}.geojson", 7, ""), "https://api-iot.heliumtools.org/v1/x/7.geojson");
  assert.throws(() => ouiTrafficUrl("https://elsewhere.example/{oui}.geojson", 12, "b"), /Unexpected utilization file location/);
});
