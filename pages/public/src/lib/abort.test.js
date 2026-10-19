import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { abortableDelay, withTimeout } from "./abort.js";

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
