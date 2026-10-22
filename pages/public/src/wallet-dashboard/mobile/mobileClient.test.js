import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

const workers = [];
class FakeWorker {
  constructor() { this.messages = []; this.terminated = false; workers.push(this); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(message) { this.onmessage({ data: message }); }
}
mock.module("./mobileWorkerFactory.js", { exports: { default: FakeWorker } });
const { checkMobileOnce } = await import("./mobileClient.js");
const request = { wallet: "wallet", keys: ["key"], wifi: false };
beforeEach(() => { workers.length = 0; });

test("pre-cancelled checks never create or start a worker", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(checkMobileOnce(request, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(workers.length, 0);
});

test("cancelling a running check rejects at once, stops it, and lets its cache writes land", async () => {
  const controller = new AbortController();
  const pending = checkMobileOnce(request, { signal: controller.signal });
  const worker = workers[0];
  assert.equal(worker.messages[0].type, "start");
  const reason = new DOMException("Caller left", "AbortError");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(worker.messages.at(-1).type, "stop");
  assert.equal(worker.terminated, false);
  worker.emit({ type: "state", state: { tables: {} }, final: true });
  worker.emit({ type: "settled" });
  assert.equal(worker.terminated, true);
});

test("time limit returns the latest partial state and stops the check", async () => {
  const pending = checkMobileOnce(request, { timeoutMs: 5 });
  const worker = workers[0];
  const state = { tables: { rewards: { state: "loading" } } };
  worker.emit({ type: "state", state });
  assert.deepEqual(await pending, { state, timedOut: true });
  assert.equal(worker.messages.at(-1).type, "stop");
  worker.emit({ type: "settled" });
  assert.equal(worker.terminated, true);
});

test("successful checks preserve patch assembly and release the worker after settling", async () => {
  const pending = checkMobileOnce(request);
  const worker = workers[0];
  worker.emit({ type: "state", state: { tables: {}, rewards: { days: [] } } });
  worker.emit({ type: "state", patch: true, state: { checkedAt: 123 }, final: true });
  const result = await pending;
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.state, { tables: {}, rewards: { days: [] }, checkedAt: 123 });
  worker.emit({ type: "settled" });
  assert.equal(worker.terminated, true);
});
