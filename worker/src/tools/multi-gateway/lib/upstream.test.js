import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllGateways, fetchRegions } from "./upstream.js";

const env = { MULTI_GATEWAY_API_KEY: "test-key", MULTI_GATEWAY_HOST: "aggregator.test" };

/** One canned response per port; a port with none refuses the connection. */
function mockPorts(t, byPort) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, key: init.headers["X-API-Key"] });
    const reply = byPort[new URL(url).port];
    if (!reply) throw new Error("connect ECONNREFUSED");
    return new Response(reply.body, { status: reply.status ?? 200 });
  });
  return calls;
}

test("fetchRegions returns the ok bodies in region order and skips the rest", async (t) => {
  const calls = mockPorts(t, {
    4468: { status: 404, body: JSON.stringify({ error: "not found" }) },
    4469: { body: JSON.stringify({ region: "EU868" }) },
    4470: { body: "<html>bad gateway</html>" },
    4472: { body: JSON.stringify({ region: "KR920" }) },
  });

  const found = await fetchRegions(env, "/gateways/AABBCCDDEEFF0011/packets");

  assert.deepEqual(found, [{ region: "EU868" }, { region: "KR920" }]);
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c.key === "test-key"));
  assert.equal(calls[0].url, "http://aggregator.test:4468/gateways/AABBCCDDEEFF0011/packets");
});

test("fetchRegions is empty when no region answers", async (t) => {
  mockPorts(t, {});
  assert.deepEqual(await fetchRegions(env, "/gateways"), []);
});

test("fetchAllGateways concatenates the regions' lists", async (t) => {
  mockPorts(t, {
    4468: { body: JSON.stringify({ gateways: [{ mac: "A" }, { mac: "B" }] }) },
    4469: { body: JSON.stringify({ total: 0 }) },
    4471: { body: JSON.stringify({ gateways: [{ mac: "C" }] }) },
  });
  assert.deepEqual(await fetchAllGateways(env), [{ mac: "A" }, { mac: "B" }, { mac: "C" }]);
});
