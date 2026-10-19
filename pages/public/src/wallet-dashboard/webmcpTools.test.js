import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

let fleet;
let rewardRequest;
let onboardRequest;
let gatewayScan;
let mobileCheck;
const calls = [];
const cancelWait = (signal) => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

mock.module("../lib/walletDashboardApi.js", {
  exports: {
    fetchSummary: async (wallet, options) => { calls.push(["summary", options]); return { wallet }; },
    fetchFleet: async (wallet, options) => { options?.signal?.throwIfAborted(); calls.push(["fleet", options]); return { wallet, hotspots: fleet, stats: { total: fleet.length } }; },
    fetchRewards: (...args) => rewardRequest(...args),
    scanOnboardDates: (...args) => onboardRequest(...args),
    fetchTransactions: async (wallet, options) => { calls.push(["transactions", options]); return { wallet }; },
  },
});
mock.module("../lib/iotStatusApi.js", {
  exports: {
    DATA_DAY_RE: /^\d{4}-\d{2}-\d{2}$/,
    scanGatewayStatuses: (...args) => gatewayScan(...args),
    fetchUtilizationIndex: async ({ signal } = {}) => { signal?.throwIfAborted(); return null; },
    fetchGatewayUtilizationDetail: async () => ({ unpublished: true }),
  },
});
// Hooks import React and the browser Worker; these tests exercise tool logic
// with the hook contracts supplied at their boundary.
mock.module("./useFleetRewards.js", {
  exports: {
    REWARDS_BATCH_SIZE: 50,
    eligibleRewardHotspots: (rows = []) => rows.filter((h) => h.entityKey && h.assetId)
      .sort((a, b) => a.entityKey < b.entityKey ? -1 : a.entityKey > b.entityKey ? 1 : 0)
      .map(({ entityKey, assetId }) => ({ entityKey, assetId })),
  },
});
mock.module("./mobile/mobileClient.js", { exports: { checkMobileOnce: (...args) => mobileCheck(...args) } });
mock.module("./mobile/useMobileActivity.js", {
  exports: { mobileFleetOf: (rows) => {
    const mobile = rows.filter((h) => h.networks.includes("mobile"));
    return { keys: mobile.map((h) => h.entityKey), mobileTotal: mobile.length, wifiTotal: 0 };
  } },
});
const { makeWalletDashboardTools } = await import("./webmcpTools.js");
const { aggregateIotStatus } = await import("./format.js");
const { aggregateMobile } = await import("./mobileFormat.js");

const hotspots = (length, networks = ["iot"]) => Array.from({ length }, (_, i) => ({
  entityKey: `key${String(i).padStart(4, "0")}`, assetId: `asset${i}`, name: "same name", networks,
})).reverse();
const tools = ({ current = null, iot = null, mobile = null } = {}) => Object.fromEntries(
  makeWalletDashboardTools(() => {}, () => current, () => iot, () => mobile).map((t) => [t.name, t]),
);
const onboardDate = (key) => new Date(Date.UTC(2024, 0, 1 + Number(key.slice(3)))).toISOString();
const entriesFor = (keys) => Object.fromEntries(keys.map((key) => [key, {
  status: 0, dataThrough: "2026-10-18T00:00:00.000Z", utilizationState: "ok",
  utilization: { packets30d: 1, ouis: [], dataThrough: "2026-10-17" },
}]));

beforeEach(() => {
  fleet = hotspots(205);
  calls.length = 0;
  rewardRequest = async (wallet, rows, options) => {
    calls.push(["rewards", rows, options]);
    return Object.fromEntries(rows.map(({ entityKey }) => [entityKey, { rewards: { IOT: { pending: "1000000", decimals: 6 } } }]));
  };
  onboardRequest = async (rows, options) => {
    calls.push(["onboard", rows, options]);
    return { onboardedByKey: Object.fromEntries(rows.map((h) => [h.entityKey, { iot: onboardDate(h.entityKey) }])), failedBatches: 0, batchCount: Math.ceil(rows.length / 50) };
  };
  gatewayScan = async (keys, options) => { calls.push(["gateway", keys, options]); return { statusByKey: entriesFor(keys), dataThrough: "2026-10-18T00:00:00.000Z" }; };
  mobileCheck = async () => ({ state: { tables: {}, checkedAt: Date.now() }, timedOut: false });
});

test("fleet pagination reaches every entity in stable order without changing fleet stats", async () => {
  const tool = tools()["get-wallet-fleet"];
  const seen = [];
  let offset = 0;
  do {
    const result = await tool.execute({ address: "wallet", offset });
    assert.equal(result.aggregateScope, "fleet");
    assert.equal(result.stats.total, 205);
    assert.equal(result.pagination.total, 205);
    seen.push(...result.hotspots.map((h) => h.entityKey));
    offset = result.pagination.nextOffset;
    fleet.reverse(); // Upstream list order must not move page membership.
  } while (offset !== null);
  assert.equal(seen.length, 205);
  assert.equal(new Set(seen).size, 205);
  assert.deepEqual(seen, [...seen].sort());
  const empty = await tool.execute({ address: "wallet", offset: 999 });
  assert.equal(empty.pagination.nextOffset, null);
  assert.deepEqual(empty.hotspots, []);
});

test("rewards pages bound requests and mark totals as page-only", async () => {
  const tool = tools()["get-wallet-rewards"];
  const first = await tool.execute({ address: "wallet" });
  const second = await tool.execute({ address: "wallet", offset: first.pagination.nextOffset });
  assert.equal(first.aggregateScope, "page");
  assert.equal(first.hotspotsCounted, 100);
  assert.deepEqual(first.totalPending, { IOT: "100" });
  assert.deepEqual(second.totalPending, { IOT: "100" });
  assert.equal(second.pagination.nextOffset, 200);
  const third = await tool.execute({ address: "wallet", offset: second.pagination.nextOffset });
  assert.deepEqual(third.totalPending, { IOT: "5" });
  assert.equal(third.pagination.nextOffset, null);
  assert.equal(new Set([first, second, third].flatMap((p) => p.hotspotsWithPending.map((h) => h.entityKey))).size, 205);
  assert(calls.filter(([type]) => type === "rewards").every(([, batch]) => batch.length <= 50));
});

test("missing reward responses are partial, not known-zero rewards", async () => {
  rewardRequest = async () => ({});
  const result = await tools()["get-wallet-rewards"].execute({ address: "wallet", limit: 2 });
  assert.equal(result.partial, true);
  assert.equal(result.lookupErrors, 2);
});

test("onboard dates and monthly aggregates apply only to the selected page", async () => {
  const tool = tools()["get-wallet-onboarding"];
  const first = await tool.execute({ address: "wallet" });
  const second = await tool.execute({ address: "wallet", offset: first.pagination.nextOffset });
  assert.equal(second.aggregateScope, "page");
  assert.equal(second.hotspotsCounted, 5);
  assert.equal(second.pagination.nextOffset, null);
  assert.equal(second.firstOnboarded, onboardDate("key0200"));
  assert.equal(second.latestOnboarded, onboardDate("key0204"));
  assert.equal(second.byMonth.reduce((n, row) => n + row.count, 0), 5);
});

test("IoT page membership stays the same when dashboard data replaces own scans", async () => {
  const offscreen = await tools()["get-wallet-iot-status"].execute({ address: "wallet", offset: 200 });
  const status = entriesFor(fleet.map((h) => h.entityKey));
  const iot = { wallet: "wallet", done: true, hotspots: fleet, iotStatus: aggregateIotStatus(fleet, status, "2026-10-18T00:00:00.000Z", {}) };
  const onscreen = await tools({ current: "wallet", iot })["get-wallet-iot-status"].execute({ offset: 200 });
  assert.equal(offscreen.aggregateScope, "page");
  assert.equal(offscreen.counts.active, 5);
  assert.equal(onscreen.aggregateScope, "fleet");
  assert.equal(onscreen.counts.active, 205);
  assert.deepEqual(onscreen.hotspots.map((h) => h.entityKey), offscreen.hotspots.map((h) => h.entityKey));
  assert.equal(onscreen.pagination.nextOffset, null);
});

test("Mobile rows beyond 200 remain reachable with deterministic ties and fleet counts", async () => {
  fleet = hotspots(205, ["mobile"]);
  const activity = { checked: true, stale: false, tables: {}, checkedAt: Date.now() };
  const mobile = { wallet: "wallet", hotspots: fleet, activity, mobile: aggregateMobile(fleet, activity, Date.now()) };
  const tool = tools({ current: "wallet", mobile })["get-wallet-mobile-activity"];
  const result = await tool.execute({ offset: 200 });
  assert.equal(result.mobileHotspots, 205);
  assert.equal(result.aggregateScope, "fleet");
  assert.equal(result.pagination.total, 205);
  assert.equal(result.pagination.nextOffset, null);
  assert.deepEqual(result.hotspots.map((h) => h.entityKey), ["key0200", "key0201", "key0202", "key0203", "key0204"]);
});

test("cancelling rewards rejects instead of returning a partial success from allSettled", async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  rewardRequest = async (wallet, rows, { signal }) => { started(); return cancelWait(signal); };
  const pending = tools()["get-wallet-rewards"].execute({ address: "wallet" }, { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("cancelling a dashboard's initial Mobile wait stops before off-screen downloads", async () => {
  const controller = new AbortController();
  const pending = tools({ current: "wallet" })["get-wallet-mobile-activity"].execute({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.length, 0);
});

test("shared off-screen Mobile checks cancel only after their last caller leaves", async () => {
  fleet = hotspots(2, ["mobile"]);
  const first = new AbortController();
  const second = new AbortController();
  let started;
  let checkSignal;
  const ready = new Promise((resolve) => { started = resolve; });
  mobileCheck = async (request, { signal }) => { checkSignal = signal; started(); return cancelWait(signal); };
  const tool = tools()["get-wallet-mobile-activity"];
  const a = tool.execute({ address: "shared-wallet" }, { signal: first.signal });
  const b = tool.execute({ address: "shared-wallet" }, { signal: second.signal });
  await ready;
  first.abort();
  await assert.rejects(a, { name: "AbortError" });
  assert.equal(checkSignal.aborted, false);
  second.abort();
  await assert.rejects(b, { name: "AbortError" });
  assert.equal(checkSignal.aborted, true);
  assert.equal(calls.filter(([type]) => type === "fleet").length, 1);
});

test("summary and transaction reads forward caller signals", async () => {
  const { signal } = new AbortController();
  const api = tools();
  await api["get-wallet-summary"].execute({ address: "wallet" }, { signal });
  await api["get-wallet-transactions"].execute({ address: "wallet" }, { signal });
  assert.equal(calls.find(([type]) => type === "summary")[1].signal, signal);
  assert.equal(calls.find(([type]) => type === "transactions")[1].signal, signal);
});

// Import the real clients under separate module URLs, bypassing the tool-boundary
// mocks above, to check cancellation of in-flight and queued network requests.
const realWalletApi = await import("../lib/walletDashboardApi.js?client-cancellation");
const realIotApi = await import("../lib/iotStatusApi.js?client-cancellation");

test("onboard scan cancellation aborts both in-flight batches and never starts queued batches", async (t) => {
  const controller = new AbortController();
  const requestSignals = [];
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", (url, { signal }) => {
    requestSignals.push(signal);
    if (requestSignals.length === 2) started();
    return cancelWait(signal);
  });
  const pending = realWalletApi.scanOnboardDates(hotspots(125), { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestSignals.length, 2);
  assert(requestSignals.every((signal) => signal.aborted));
});

test("onboard retry waits are cancellable", async (t) => {
  const controller = new AbortController();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return new Response(JSON.stringify({ error: "Rate limited", retryAfterSeconds: 60 }), { status: 429, headers: { "Content-Type": "application/json" } });
  });
  const pending = realWalletApi.scanOnboardDates(hotspots(1), { signal: controller.signal, waitOutRateLimit: true });
  // Let the response body parse and the retry wait begin.
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requests, 1);
});

test("IoT scan cancellation aborts its bounded in-flight requests without reporting unknown rows", async (t) => {
  const controller = new AbortController();
  const requestSignals = [];
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  t.mock.method(globalThis, "fetch", (url, { signal }) => {
    requestSignals.push(signal);
    if (requestSignals.length === 8) started();
    return cancelWait(signal);
  });
  const pending = realIotApi.scanGatewayStatuses(hotspots(20).map((h) => h.entityKey), { signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(requestSignals.length, 8);
  assert(requestSignals.every((signal) => signal.aborted));
});
