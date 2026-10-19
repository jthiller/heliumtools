import test from "node:test";
import assert from "node:assert/strict";
import { lookupHotspot, fetchWalletHotspots } from "./hotspotClaimerApi.js";
import { fetchBalanceForOui, parseJson } from "./api.js";
import { fetchOnboardDates } from "./hotspotMapApi.js";

for (const [name, read, payload] of [
  ["Hotspot lookup", () => lookupHotspot("deadline-key"), { owner: "owner" }],
  ["Wallet lookup", () => fetchWalletHotspots("deadline-wallet"), { hotspots: [] }],
  ["OUI balance", () => fetchBalanceForOui(7654321), { balance: 0 }],
  ["Onboard dates", () => fetchOnboardDates("deadline-key", "iot"), { onboarded: { iot: null } }],
]) {
  test(`${name} has a deadline even for an uncancelled page consumer, then retries`, async (t) => {
    const deadline = new AbortController();
    const milliseconds = [];
    t.mock.method(AbortSignal, "timeout", (ms) => { milliseconds.push(ms); return deadline.signal; });
    let signal;
    let start;
    const started = new Promise((resolve) => { start = resolve; });
    t.mock.method(globalThis, "fetch", (_url, options) => {
      signal = options.signal;
      start();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const pending = read();
    await started;
    assert.deepEqual(milliseconds, [30_000]);
    const reason = new DOMException("Request deadline exceeded", "TimeoutError");
    deadline.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.equal(signal.aborted, true);
    t.mock.restoreAll();
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } }));
    assert.deepEqual(await read(), payload.onboarded ?? payload);
  });
}

test("a timed-out response body remains a failure instead of a cached null", async () => {
  const reason = new DOMException("Body timed out", "TimeoutError");
  await assert.rejects(parseJson({
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => { throw reason; },
  }), (error) => error === reason);
});
