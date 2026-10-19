import test from "node:test";
import assert from "node:assert/strict";
import { dedupeAsync } from "./requestDedupe.js";

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
