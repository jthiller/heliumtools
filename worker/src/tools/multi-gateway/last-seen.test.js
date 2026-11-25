import test from "node:test";
import assert from "node:assert/strict";
import {
  LAST_SEEN_KV_KEY,
  fetchListedGateways,
  isStale,
  lastSeenOf,
  mergeLastSeen,
  recordGatewayLastSeen,
} from "./last-seen.js";

const DAY_S = 86400;
const DAY_MS = DAY_S * 1000;
const NOW = Date.UTC(2026, 10, 24);

const gw = (mac, fields = {}) => ({
  mac,
  connected: false,
  last_uplink_seconds_ago: null,
  ...fields,
});

// --- the rule ---------------------------------------------------------------

test("a connected gateway is always listed", () => {
  assert.equal(isStale(gw("A", { connected: true }), null, NOW), false);
  // Even with no uplink for longer than the window.
  assert.equal(
    isStale(gw("A", { connected: true, last_uplink_seconds_ago: 90 * DAY_S }), null, NOW),
    false,
  );
});

test("an offline gateway is listed until its last uplink is 30 days old", () => {
  const offlineFor = (seconds) => gw("A", { last_uplink_seconds_ago: seconds });
  assert.equal(isStale(offlineFor(1 * DAY_S), null, NOW), false);
  assert.equal(isStale(offlineFor(30 * DAY_S - 1), null, NOW), false);
  assert.equal(isStale(offlineFor(30 * DAY_S), null, NOW), true);
  assert.equal(isStale(offlineFor(38.5 * DAY_S), null, NOW), true);
});

test("an offline gateway with no uplink and no record is not listed", () => {
  assert.equal(isStale(gw("A"), null, NOW), true);
  assert.equal(isStale(gw("A"), {}, NOW), true);
  assert.equal(isStale(gw("A"), { B: NOW }, NOW), true);
});

test("the record stands in after the aggregator restarts and forgets", () => {
  // Restart: every gateway reports no uplink at all.
  const record = { RECENT: NOW - 1 * DAY_MS, OLD: NOW - 38 * DAY_MS };
  assert.equal(isStale(gw("RECENT"), record, NOW), false);
  assert.equal(isStale(gw("OLD"), record, NOW), true);
});

test("the later of record and report wins", () => {
  const record = { A: NOW - 40 * DAY_MS };
  const fresher = gw("A", { last_uplink_seconds_ago: 2 * DAY_S });
  assert.equal(lastSeenOf(fresher, record, NOW), NOW - 2 * DAY_MS);
  assert.equal(isStale(fresher, record, NOW), false);

  // A gateway seen connected at the last poll, whose last uplink is older.
  const quiet = gw("B", { last_uplink_seconds_ago: 45 * DAY_S });
  assert.equal(lastSeenOf(quiet, { B: NOW - 3 * DAY_MS }, NOW), NOW - 3 * DAY_MS);
});

test("a malformed record entry is ignored", () => {
  assert.equal(isStale(gw("A"), { A: "yesterday" }, NOW), true);
  assert.equal(lastSeenOf(gw("A", { last_uplink_seconds_ago: 60 }), { A: null }, NOW), NOW - 60_000);
});

test("mergeLastSeen records what it can and never moves a time back", () => {
  const record = { KEPT: NOW - 5 * DAY_MS, ELSEWHERE: NOW - 9 * DAY_MS };
  const next = mergeLastSeen(
    record,
    [
      gw("ONLINE", { connected: true }),
      gw("UPLINKED", { last_uplink_seconds_ago: 2 * DAY_S }),
      // Restarted aggregator: no uplink reported, the record is all there is.
      gw("KEPT"),
      // Never seen by either: nothing to record.
      gw("NEVER"),
      { connected: true },
    ],
    NOW,
  );
  assert.deepEqual(next, {
    KEPT: NOW - 5 * DAY_MS,
    // Not in this fetch (its region was down): untouched.
    ELSEWHERE: NOW - 9 * DAY_MS,
    ONLINE: NOW,
    UPLINKED: NOW - 2 * DAY_MS,
  });
  // The input is not mutated.
  assert.deepEqual(record, { KEPT: NOW - 5 * DAY_MS, ELSEWHERE: NOW - 9 * DAY_MS });
});

// --- the request path and the cron ------------------------------------------

function fakeKv(record = null) {
  const puts = [];
  return {
    puts,
    get: async () => record,
    put: async (key, value, options) => void puts.push({ key, value, options }),
  };
}

const failingKv = () => ({
  ...fakeKv(),
  get: async () => {
    throw new Error("KV GET failed: 503");
  },
});

/** Serve `byPort[port]` as that region's gateway list; other regions fail. */
function mockRegions(t, byPort) {
  t.mock.method(globalThis, "fetch", async (url) => {
    const port = new URL(url).port;
    if (!(port in byPort)) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify({ gateways: byPort[port] }));
  });
}

const envWith = (kv) => ({ KV: kv, MULTI_GATEWAY_API_KEY: "test-key" });

const TWO_REGIONS = {
  4468: [gw("ONLINE", { connected: true }), gw("RESTARTED")],
  4469: [
    gw("OILY_BIRD", { last_uplink_seconds_ago: 1 * DAY_S }),
    gw("RACCOON", { last_uplink_seconds_ago: 38.5 * DAY_S }),
    gw("NEVER"),
  ],
};

test("/gateways lists every reachable region's gateways, minus the stale", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  mockRegions(t, TWO_REGIONS);
  const kv = fakeKv({ RESTARTED: NOW - 5 * DAY_MS });

  const listed = await fetchListedGateways(envWith(kv));

  assert.deepEqual(listed.map((g) => g.mac), ["ONLINE", "RESTARTED", "OILY_BIRD"]);
  assert.equal(kv.puts.length, 0);
});

test("/gateways runs on the aggregator's report when KV can't be read", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  mockRegions(t, TWO_REGIONS);

  const listed = await fetchListedGateways(envWith(failingKv()));

  // RESTARTED has no reported uplink, and its record is out of reach.
  assert.deepEqual(listed.map((g) => g.mac), ["ONLINE", "OILY_BIRD"]);
});

test("the cron folds every reachable region into the record, with no TTL", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  mockRegions(t, {
    4468: [gw("ONLINE", { connected: true })],
    4469: [gw("UPLINKED", { last_uplink_seconds_ago: 2 * DAY_S })],
  });
  const kv = fakeKv({ DOWN_REGION: NOW - 9 * DAY_MS });

  await recordGatewayLastSeen(envWith(kv));

  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, LAST_SEEN_KV_KEY);
  assert.equal(kv.puts[0].options, undefined);
  assert.deepEqual(JSON.parse(kv.puts[0].value), {
    DOWN_REGION: NOW - 9 * DAY_MS,
    ONLINE: NOW,
    UPLINKED: NOW - 2 * DAY_MS,
  });
});

test("the cron starts a record when there is none", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  mockRegions(t, { 4468: [gw("ONLINE", { connected: true })] });
  const kv = fakeKv();

  await recordGatewayLastSeen(envWith(kv));

  assert.deepEqual(JSON.parse(kv.puts[0].value), { ONLINE: NOW });
});

test("the cron writes nothing when KV can't be read", async (t) => {
  mockRegions(t, { 4468: [gw("ONLINE", { connected: true })] });
  const kv = failingKv();

  await assert.rejects(recordGatewayLastSeen(envWith(kv)), /KV GET failed/);
  assert.equal(kv.puts.length, 0);
});

test("the cron writes nothing when no region answers", async (t) => {
  mockRegions(t, {});
  const kv = fakeKv({ OFFLINE: NOW - 5 * DAY_MS });

  await recordGatewayLastSeen(envWith(kv));

  assert.equal(kv.puts.length, 0);
});
