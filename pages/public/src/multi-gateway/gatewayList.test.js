import assert from "node:assert/strict";
import { test } from "node:test";
import { REFRESH_DELAY_MS, createListRefresher } from "./gatewayList.js";

/** A refresher over requests the test settles by hand, in any order. */
function harness(options = {}) {
  const requests = [];
  const applied = [];
  const errors = [];
  let settled = 0;
  const list = createListRefresher({
    load: () =>
      new Promise((resolve, reject) => {
        requests.push({ resolve, reject });
      }),
    apply: (data) => applied.push(data),
    onError: (err) => errors.push(err.message),
    onSettled: () => settled++,
    ...options,
  });
  return { list, requests, applied, errors, settled: () => settled };
}

/** Let promise callbacks run. setImmediate is never mocked here. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("an older answer that lands last does not replace a newer one", async () => {
  const { list, requests, applied, settled } = harness();
  list.refresh(); // read before gateway Y connected
  list.refresh(); // read after

  requests[1].resolve(["X", "Y"]);
  await flush();
  requests[0].resolve(["X"]);
  await flush();

  assert.deepEqual(applied, [["X", "Y"]]);
  assert.equal(settled(), 1);
});

test("answers that land in order: only the newest request's is applied", async () => {
  const { list, requests, applied, settled } = harness();
  list.refresh();
  list.refresh();

  requests[0].resolve(["X"]);
  await flush();
  assert.deepEqual(applied, []);
  assert.equal(settled(), 0);

  requests[1].resolve(["X", "Y"]);
  await flush();
  assert.deepEqual(applied, [["X", "Y"]]);
  assert.equal(settled(), 1);
});

test("refreshSoon makes one request for a burst, after the delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { list, requests } = harness();

  list.refreshSoon();
  t.mock.timers.tick(REFRESH_DELAY_MS - 1);
  list.refreshSoon();
  list.refreshSoon();
  assert.equal(requests.length, 0);

  t.mock.timers.tick(1);
  assert.equal(requests.length, 1);

  // The burst is spent: a later call asks for a fetch of its own.
  list.refreshSoon();
  t.mock.timers.tick(REFRESH_DELAY_MS);
  assert.equal(requests.length, 2);
});

test("a refresh started meanwhile covers the pending one", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { list, requests } = harness();

  list.refreshSoon();
  list.refresh();
  assert.equal(requests.length, 1);

  t.mock.timers.tick(REFRESH_DELAY_MS * 2);
  assert.equal(requests.length, 1);
});

test("cancel drops a pending fetch and ignores an answer on its way", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { list, requests, applied, settled } = harness();

  list.refreshSoon();
  list.cancel();
  t.mock.timers.tick(REFRESH_DELAY_MS * 2);
  assert.equal(requests.length, 0);

  list.refresh();
  list.cancel();
  requests[0].resolve(["X"]);
  await flush();
  assert.deepEqual(applied, []);
  assert.equal(settled(), 0);

  // Still usable afterwards (React StrictMode mounts, unmounts and mounts).
  list.refresh();
  requests[1].resolve(["X"]);
  await flush();
  assert.deepEqual(applied, [["X"]]);
});

test("a failed request is reported, settles, and leaves the list alone", async () => {
  const { list, requests, applied, errors, settled } = harness();
  list.refresh();

  requests[0].reject(new Error("Failed to fetch gateways"));
  await flush();

  assert.deepEqual(applied, []);
  assert.deepEqual(errors, ["Failed to fetch gateways"]);
  assert.equal(settled(), 1);
});
