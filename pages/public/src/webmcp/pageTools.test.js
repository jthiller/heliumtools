import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

// Page factories use real HTTP clients. Mock only address conversion so the
// tests do not depend on wallet libraries or any live chain/RPC service.
mock.module("../lib/solanaAddress.js", {
  exports: {
    resolveSolanaWallet: (address) => address ? { toBase58: () => address } : null,
    toHeliumB58: () => "legacy-address",
  },
});
globalThis.location = { href: "https://heliumtools.org/multi-gateway" };

const { registerWebMcpTools } = await import("./webmcp.js");
const { makeClaimerTools } = await import("../hotspot-claimer/webmcpTools.js");
const { makeL1MigrationTools } = await import("../l1-migration/webmcpTools.js");
const { makeHotspotMapTools } = await import("../hotspot-map/webmcpTools.js");
const { makeVeHntTools } = await import("../ve-hnt/webmcpTools.js");
const { makeVoteTools } = await import("../vote/webmcpTools.js");
const { makeMobileOnboardTools } = await import("../mobile-onboard/webmcpTools.js");
const { makeMultiGatewayTools } = await import("../multi-gateway/webmcpTools.js");
const { makeOuiNotifierTools } = await import("../oui-notifier/webmcpTools.js");
const { makeSiteTools } = await import("./siteTools.js");
const { dcMintTools } = await import("../dc-mint/webmcpTools.js");
const { hntPriceTools } = await import("../hnt-price/webmcpTools.js");
const { iotOnboardTools } = await import("../iot-onboard/webmcpTools.js");
const { updateLocationTools } = await import("../update-location/webmcpTools.js");
const { lookupHotspot } = await import("../lib/hotspotClaimerApi.js");
const { parseJson } = await import("../lib/api.js");

const ADDRESS = "11111111111111111111111111111111";
const ENTITY_KEY = "11111111111111111111111111111111111111111111";
const PAYER_KEY = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const originalFetch = globalThis.fetch;
let cleanups;
let registered;

beforeEach(() => {
  cleanups = [];
  registered = new Map();
  globalThis.document = {
    modelContext: {
      registerTool(tool, { signal }) {
        registered.set(tool.name, tool);
        signal.addEventListener("abort", () => registered.delete(tool.name), { once: true });
        return Promise.resolve();
      },
    },
  };
  globalThis.fetch = () => { throw new Error("Unexpected network request"); };
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  delete globalThis.document;
  globalThis.fetch = originalFetch;
});

function tool(tools, name) {
  const found = tools.find((entry) => entry.name === name);
  assert.ok(found, `Missing tool ${name}`);
  return found;
}
function expose(tools, name) {
  cleanups.push(registerWebMcpTools(tools));
  return tool([...registered.values()], name);
}
function claimer(callbacks = {}) {
  return makeClaimerTools({ showHotspot() {}, showWallet() {}, ...callbacks });
}
function migration(callbacks = {}) {
  return makeL1MigrationTools({ showWallet() {}, reportStatus() {}, ...callbacks });
}
function json(data) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
function deferredFetch() {
  let begin;
  const started = new Promise((resolve) => { begin = resolve; });
  let finish;
  let requestSignal;
  let calls = 0;
  globalThis.fetch = (_url, { signal } = {}) => {
    calls++;
    requestSignal = signal;
    begin();
    return new Promise((resolve, reject) => {
      finish = (payload) => resolve(json(payload));
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  return { started, finish: (payload) => finish(payload), get signal() { return requestSignal; }, get calls() { return calls; } };
}

for (const [name, factory, input] of [
  ["claim-hotspot-rewards", claimer, { entity_key: ENTITY_KEY }],
  ["migrate-l1-wallet", migration, { address: ADDRESS }],
]) {
  test(`${name} declares consequential execution`, () => {
    assert.deepEqual(tool(factory(), name).annotations, { readOnlyHint: false, consequentialHint: true });
  });
  test(`${name} does not broadcast an already-cancelled request`, async () => {
    const cancelled = AbortSignal.abort();
    const selected = expose(factory(), name);
    await assert.rejects(selected.execute(input, { signal: cancelled }), { name: "AbortError" });
  });
}

test("failed claim results retain every per-token error in the agent error", async () => {
  const payload = { success: false, claims: [{ token: "HNT", error: "oracle unavailable" }, { token: "IOT", error: "recipient missing" }] };
  globalThis.fetch = async () => json(payload);
  const selected = expose(claimer(), "claim-hotspot-rewards");
  const result = await selected.execute({ entity_key: ENTITY_KEY });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[1].text), payload);
});

test("partial claims remain successful and retain successful signatures and token errors", async () => {
  const payload = { success: true, claims: [{ token: "HNT", txSignature: "confirmed-signature" }, { token: "IOT", error: "oracle unavailable" }] };
  globalThis.fetch = async () => json(payload);
  const result = await expose(claimer(), "claim-hotspot-rewards").execute({ entity_key: ENTITY_KEY });
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
});

test("incomplete migration is an agent error retaining processed and remaining counts", async () => {
  const payload = { success: false, message: "Two transactions remain", transactionsProcessed: 3, remaining: 2 };
  const statuses = [];
  globalThis.fetch = async () => json(payload);
  const result = await expose(migration({ reportStatus: (status) => statuses.push(status) }), "migrate-l1-wallet").execute({ address: ADDRESS });
  assert.equal(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[1].text), payload);
  assert.deepEqual(statuses, [{ tone: "error", message: payload.message }]);
});

test("a sent migration runs to completion and reports its outcome when the call is cancelled", async () => {
  const request = deferredFetch();
  const statuses = [];
  const controller = new AbortController();
  const execution = expose(migration({ reportStatus: (status) => statuses.push(status) }), "migrate-l1-wallet")
    .execute({ address: ADDRESS }, { signal: controller.signal });
  await request.started;
  controller.abort();
  assert.equal(request.signal, undefined, "the broadcast POST isn't tied to the call's signal");
  request.finish({ success: true, message: "Migration successful!", transactionsProcessed: 3 });
  await assert.rejects(execution, { name: "AbortError" });
  assert.deepEqual(statuses, [{ tone: "success", message: "Migration successful!" }]);
});

test("a sent claim runs to completion when the call is cancelled", async () => {
  const request = deferredFetch();
  const controller = new AbortController();
  const execution = expose(claimer(), "claim-hotspot-rewards").execute({ entity_key: ENTITY_KEY }, { signal: controller.signal });
  await request.started;
  controller.abort();
  assert.equal(request.signal, undefined, "the broadcast POST isn't tied to the call's signal");
  request.finish({ success: true, claims: [{ token: "HNT", txSignature: "confirmed-signature" }] });
  await assert.rejects(execution, { name: "AbortError" });
  assert.equal(request.calls, 1);
});

test("cancelling an agent lookup preserves an overlapping page subscriber", async () => {
  const request = deferredFetch();
  const controller = new AbortController();
  const execution = expose(claimer(), "lookup-hotspot").execute({ entity_key: ENTITY_KEY }, { signal: controller.signal });
  await request.started;
  const pageRead = lookupHotspot(ENTITY_KEY);
  controller.abort();
  await assert.rejects(execution, { name: "AbortError" });
  assert.equal(request.signal.aborted, false);
  assert.equal(request.calls, 1);
  const payload = { entityKey: ENTITY_KEY, owner: ADDRESS };
  request.finish(payload);
  assert.deepEqual(await pageRead, payload);
});

test("cancelling the only lookup consumer aborts fetch and permits a fresh retry", async () => {
  const request = deferredFetch();
  const controller = new AbortController();
  const key = `${ENTITY_KEY}1`;
  const pending = lookupHotspot(key, { signal: controller.signal });
  await request.started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(request.signal.aborted, true);
  globalThis.fetch = async () => json({ retried: true });
  assert.deepEqual(await lookupHotspot(key), { retried: true });
});

for (const [name, tools, input] of [
  ["get-oui-balance", () => makeOuiNotifierTools({ getOuis: () => [], showOui() {}, prefillSubscription() {} }), { oui: 987654 }],
  ["get-hotspot-onboard-dates", () => makeHotspotMapTools({}), { entity_key: `${ENTITY_KEY}2` }],
]) {
  test(`${name} cancels its shared HTTP read without reporting an upstream failure`, async () => {
    const request = deferredFetch();
    const controller = new AbortController();
    const execution = expose(tools(), name).execute(input, { signal: controller.signal });
    await request.started;
    controller.abort();
    await assert.rejects(execution, { name: "AbortError" });
    assert.equal(request.signal.aborted, true);
  });
}

test("response-body cancellation stays an AbortError", async () => {
  const error = new DOMException("Response cancelled", "AbortError");
  await assert.rejects(parseJson({ headers: new Headers({ "Content-Type": "application/json" }), json: async () => { throw error; } }), error);
});

test("all fetch-backed read tools forward cancellation to their actual HTTP client", async () => {
  const reads = [
    [dcMintTools, "get-dc-mint-quote", { dc_amount: 1000 }, { dc_per_hnt: 200_000, dc_per_usd: 100_000 }],
    [dcMintTools, "resolve-oui", { target: "12" }, { oui: 12 }, "/dc-purchase/oui/12"],
    // A payer key with letters: an all-digit one would take the OUI-number path.
    [dcMintTools, "resolve-oui", { target: PAYER_KEY }, { payer: PAYER_KEY }, `/resolve-payer/${PAYER_KEY}`],
    [claimer(), "get-hotspot-rewards", { entity_key: ENTITY_KEY }, { rewards: [] }],
    [hntPriceTools, "get-hnt-price-instant", {}, { symbol: "HNT" }],
    [iotOnboardTools, "get-iot-onboard-fees", {}, { fee: 123 }],
    [makeMobileOnboardTools(() => {}), "get-mobile-onboard-fees", {}, { fee: 123 }],
    [updateLocationTools, "get-hotspot-onchain-info", { gateway: ENTITY_KEY }, { location: null }],
    [makeVoteTools(() => {}), "list-vote-proposals", {}, { proposals: [] }],
    [makeVoteTools(() => {}), "get-vote-details", { proposal: ADDRESS }, { proposal: ADDRESS }],
    [makeVoteTools(() => {}), "get-voter-history", { voter: ADDRESS }, { votes: [] }],
    [makeMultiGatewayTools(() => {}, () => []), "get-gateway-packets", { mac: "123456", limit: 25 }, { packets: [] }],
    [makeOuiNotifierTools({ getOuis: () => [], showOui() {}, prefillSubscription() {} }), "list-ouis", {}, { orgs: [] }],
    [makeSiteTools(() => {}), "get-hnt-price", {}, { symbol: "HNT" }],
  ];
  for (const [tools, name, input, payload, path] of reads) {
    const controller = new AbortController();
    let received;
    let requested;
    globalThis.fetch = async (url, { signal }) => { requested = String(url); received = signal; return json(payload); };
    await tool(tools, name).execute(input, { signal: controller.signal });
    assert.equal(received, controller.signal, `${name} did not forward its execution signal`);
    if (path) assert.ok(requested.endsWith(path), `${name} requested ${requested}, not …${path}`);
  }
});

test("map and veHNT callback tools pass the execution signal through to page loaders", async () => {
  const controller = new AbortController();
  const received = [];
  const callbacks = {
    addWalletToMap: async (address, options) => { received.push([address, options.signal]); return { hotspots: [] }; },
    addKeysToMap: async (keys, options) => { received.push([keys, options.signal]); return { plotted: keys.length }; },
  };
  const mapTools = makeHotspotMapTools(callbacks);
  await tool(mapTools, "map-wallet-hotspots").execute({ address: ADDRESS }, { signal: controller.signal });
  await tool(mapTools, "map-hotspots").execute({ entity_keys: [ENTITY_KEY] }, { signal: controller.signal });
  const veTools = makeVeHntTools(async (wallet, options) => received.push([wallet, options.signal]));
  await veTools[0].execute({ wallet: ADDRESS }, { signal: controller.signal });
  assert.deepEqual(received, [[ADDRESS, controller.signal], [[ENTITY_KEY], controller.signal], [ADDRESS, controller.signal]]);
  await assert.rejects(expose(mapTools, "map-wallet-hotspots").execute({ address: ADDRESS }, { signal: AbortSignal.abort() }), { name: "AbortError" });
  assert.equal(received.length, 3);
});

test("already-cancelled invocations do not drive navigation, tabs, lookup, or form callbacks", async () => {
  let callbacks = 0;
  const change = () => { callbacks++; };
  const factories = [
    [makeSiteTools(change), "open-helium-tool", { path: "/hnt-price" }],
    [makeVoteTools(change), "open-vote", { proposal: ADDRESS }],
    [makeMobileOnboardTools(change), "open-mobile-onboard-tab", { tab: "guide" }],
    [claimer({ showHotspot: change }), "lookup-hotspot", { entity_key: ENTITY_KEY }],
    [migration({ showWallet: change }), "migrate-l1-wallet", { address: ADDRESS }],
    [makeOuiNotifierTools({ getOuis: () => [], showOui: change, prefillSubscription: change }), "prefill-alert-subscription", { oui: 12, email: "operator@example.com" }],
    [makeMultiGatewayTools(change, () => [{ mac: "123456" }]), "select-gateway", { mac: "123456" }],
  ];
  // Through the wrapper, as agents call them: it rejects a cancelled call
  // before execute runs, so the tools need no check of their own.
  for (const [tools, name, input] of factories) {
    await assert.rejects(expose(tools, name).execute(input, { signal: AbortSignal.abort() }), { name: "AbortError" });
  }
  assert.equal(callbacks, 0);
});
