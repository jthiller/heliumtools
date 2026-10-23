import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAsync } from "./requestDedupe.js";
import { fetchBalanceForOui } from "./api.js";
import { lookupHotspot } from "./hotspotClaimerApi.js";
import { fetchOnboardDates } from "./hotspotMapApi.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("ordinary callers share requests and successful cache entries", async () => {
  const pending = deferred();
  let calls = 0;
  const read = dedupeAsync(() => { calls++; return pending.promise; });
  const a = read("key");
  const b = read("key");
  assert.equal(a, b);
  pending.resolve(42);
  assert.equal(await a, 42);
  assert.equal(await read("key"), 42);
  assert.equal(calls, 1);
});

test("one consumer cancelling does not interrupt another agent or the page", async () => {
  const pending = deferred();
  let requestSignal;
  let calls = 0;
  const read = dedupeAsync((key, { signal }) => {
    calls++;
    requestSignal = signal;
    return pending.promise;
  }, 3_000, { signalIndex: 1 });
  const controller = new AbortController();
  const agent = read("key", { signal: controller.signal });
  const page = read("key");
  await Promise.resolve();
  controller.abort();
  await assert.rejects(agent, { name: "AbortError" });
  assert.equal(requestSignal.aborted, false);
  pending.resolve("shared data");
  assert.equal(await page, "shared data");
  assert.equal(await read("key", {}), "shared data");
  assert.equal(calls, 1);
});

test("the last cancelled consumer aborts the fetch and a retry gets a new request", async () => {
  const signals = [];
  const read = dedupeAsync((key, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      if (signals.length === 2) resolve("retry");
    });
  }, 3_000, { signalIndex: 1 });
  const a = new AbortController();
  const b = new AbortController();
  const first = read("key", { signal: a.signal });
  const second = read("key", { signal: b.signal });
  await Promise.resolve();
  a.abort();
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(signals[0].aborted, false);
  b.abort();
  await assert.rejects(second, { name: "AbortError" });
  assert.equal(signals[0].aborted, true);
  assert.equal(await read("key"), "retry");
  assert.equal(signals.length, 2);
});

test("a pre-aborted caller never starts a request or disrupts a cached result", async () => {
  let calls = 0;
  const read = dedupeAsync(async () => ++calls, 3_000, { signalIndex: 0 });
  const signal = AbortSignal.abort(new Error("cancelled"));
  await assert.rejects(read({ signal }), /cancelled/);
  assert.equal(calls, 0);
  assert.equal(await read(), 1);
  await assert.rejects(read({ signal }), /cancelled/);
  assert.equal(await read({}), 1);
});

test("request options apart from the signal remain part of the cache key", async () => {
  let calls = 0;
  const read = dedupeAsync(async (key, { limit }) => ({ limit, call: ++calls }), 3_000, { signalIndex: 1 });
  assert.deepEqual(await read("key", { limit: 1 }), { limit: 1, call: 1 });
  assert.deepEqual(await read("key", { limit: 2 }), { limit: 2, call: 2 });
  assert.deepEqual(await read("key", { limit: 1, signal: new AbortController().signal }), { limit: 1, call: 1 });
});

test("rejected and deliberately uncacheable results are retried", async () => {
  let calls = 0;
  const read = dedupeAsync(async () => {
    calls++;
    if (calls === 1) throw new Error("offline");
    return { ready: calls > 2 };
  }, 3_000, { signalIndex: 0, keep: (v) => v.ready });
  await assert.rejects(read(), /offline/);
  assert.deepEqual(await read(), { ready: false });
  assert.deepEqual(await read(), { ready: true });
  assert.deepEqual(await read(), { ready: true });
  assert.equal(calls, 3);
});

test("cancellation before the request microtask prevents network work", async () => {
  let calls = 0;
  const read = dedupeAsync(async () => ++calls, 3_000, { signalIndex: 0 });
  const controller = new AbortController();
  const pending = read({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 0);
  assert.equal(await read(), 1);
});

test("a shared read still returns a promise where Array.prototype.at is missing", async () => {
  const read = dedupeAsync(async (key) => `value for ${key}`, 3_000, { signalIndex: 1 });
  const at = Object.getOwnPropertyDescriptor(Array.prototype, "at");
  let pending;
  delete Array.prototype.at;
  try {
    pending = read("key");
  } finally {
    Object.defineProperty(Array.prototype, "at", at);
  }
  assert.equal(await pending, "value for key");
});

test("expired results are dropped before a live one is evicted for room", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  let finishSlow;
  let calls = 0;
  const read = dedupeAsync((key) => {
    calls++;
    return key === "slow" ? new Promise((resolve) => { finishSlow = resolve; }) : Promise.resolve(key);
  }, 1_000, { signalIndex: 1, max: 2 });
  const slow = read("slow");
  assert.equal(await read("fast"), "fast"); // cached from t=0
  t.mock.timers.tick(900);
  finishSlow("slow");
  assert.equal(await slow, "slow"); // cached from t=900
  t.mock.timers.tick(200); // t=1100: "fast" has expired, "slow" hasn't
  assert.equal(await read("third"), "third");
  assert.equal(await read("slow"), "slow");
  assert.equal(calls, 3);
});


/** Simulate the abort APIs absent on the older browsers shared UI reads support. */
function olderAbortApis(t) {
  for (const [owner, name] of [[AbortSignal.prototype, "throwIfAborted"], [AbortSignal, "any"], [AbortSignal, "timeout"]]) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, name);
    delete owner[name];
    t.after(() => Object.defineProperty(owner, name, descriptor));
  }
  // Fallback request deadlines use timers; keep 30-second deadlines from
  // holding this test process open after mocked reads finish immediately.
  t.mock.timers.enable({ apis: ["setTimeout"] });
}

test("real shared UI reads fetch successfully without native abort convenience APIs", async (t) => {
  olderAbortApis(t);
  const urls = [];
  t.mock.method(globalThis, "fetch", async (url, { signal }) => {
    urls.push(url);
    assert.equal(signal.aborted, false);
    return new Response(JSON.stringify({ ok: true, onboarded: { iot: "2024-01-01T00:00:00.000Z" } }), {
      headers: { "Content-Type": "application/json" },
    });
  });
  assert.equal((await fetchBalanceForOui(420001)).ok, true);
  assert.equal((await lookupHotspot("old-browser-shared-success")).ok, true);
  assert.deepEqual(await fetchOnboardDates("old-browser-onboard-success", "iot"), { iot: "2024-01-01T00:00:00.000Z" });
  assert.equal(urls.length, 3);
});

test("real pre-aborted shared reads never fetch on older abort APIs", async (t) => {
  olderAbortApis(t);
  const fetchMock = t.mock.method(globalThis, "fetch", () => assert.fail("pre-aborted reads must not fetch"));
  const controller = new AbortController();
  const reason = new Error("caller stopped before fetch");
  controller.abort(reason);
  await assert.rejects(lookupHotspot("old-browser-pre-aborted", { signal: controller.signal }), (error) => error === reason);
  const oldSignal = { aborted: true };
  await assert.rejects(fetchBalanceForOui(420002, { signal: oldSignal }), { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("real shared read cancellation preserves its reason without native abort APIs", async (t) => {
  olderAbortApis(t);
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let requestSignal;
  t.mock.method(globalThis, "fetch", (url, { signal }) => {
    requestSignal = signal;
    started();
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  const controller = new AbortController();
  const pending = lookupHotspot("old-browser-cancelled-in-flight", { signal: controller.signal });
  await ready;
  const reason = new Error("caller stopped during fetch");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(requestSignal.aborted, true);
  assert.equal(requestSignal.reason, reason);
});
