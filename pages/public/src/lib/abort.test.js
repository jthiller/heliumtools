import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { abortableDelay, raceAbort, withTimeout } from "./abort.js";

/** Run `body` with AbortSignal[name] removed, as on older browsers. */
function without(t, name, body) {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, name);
  delete AbortSignal[name];
  t.after(() => Object.defineProperty(AbortSignal, name, descriptor));
  return body();
}

test("withTimeout keeps caller cancellation where AbortSignal.any is missing", (t) => {
  const controller = new AbortController();
  const signal = without(t, "any", () => withTimeout(controller.signal, 10_000));
  assert.equal(signal.aborted, false);
  const reason = new Error("user stopped the call");
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
});

test("withTimeout keeps its deadline where AbortSignal.timeout is missing", async (t) => {
  const signal = without(t, "timeout", () => withTimeout(new AbortController().signal, 1));
  await delay(10);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "TimeoutError");
});

test("raceAbort stops the wait without cancelling the work behind it", async () => {
  const controller = new AbortController();
  let finish;
  const work = new Promise((resolve) => { finish = resolve; });
  const waiting = raceAbort(work, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  finish("rendered");
  assert.equal(await work, "rendered");
  assert.equal(await raceAbort(Promise.resolve(7), new AbortController().signal), 7);
  assert.equal(await raceAbort(Promise.resolve(8)), 8);
  await assert.rejects(raceAbort(Promise.resolve(9), AbortSignal.abort()), { name: "AbortError" });
});

test("withTimeout preserves caller cancellation and its reason", () => {
  const controller = new AbortController();
  const signal = withTimeout(controller.signal, 10_000);
  const reason = new Error("user stopped the call");
  controller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
});

test("withTimeout still enforces a request deadline", async () => {
  const signal = withTimeout(undefined, 1);
  await delay(10);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, "TimeoutError");
});

test("cancelling a delay rejects promptly with the caller's reason", async () => {
  const controller = new AbortController();
  const pending = abortableDelay(60_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("a completed delay removes its abort listener", async () => {
  const controller = new AbortController();
  let removes = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (...args) => { removes++; remove(...args); };
  await abortableDelay(0, controller.signal);
  assert.equal(removes, 1);
  controller.abort();
});

test("an already cancelled delay never schedules work", () => {
  assert.throws(() => abortableDelay(60_000, AbortSignal.abort()), { name: "AbortError" });
});
