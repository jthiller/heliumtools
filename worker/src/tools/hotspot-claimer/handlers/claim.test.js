import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

// The handler's services reach Solana, the reward oracles and the Entity API;
// these tests replace them at the module boundary and keep KV in memory. No
// transaction is built or sent.
let pendingRewards;
let claimToken;
mock.module("../../../lib/helium-solana.js", { exports: { MAX_HOTSPOT_ENTITY_KEY_LEN: 500 } });
mock.module("../services/rateLimit.js", { exports: { checkIpRateLimit: async () => null } });
mock.module("../services/entity.js", {
  exports: {
    resolveEntityKey: async () => ({ assetId: "asset", owner: "owner", keyToAssetKey: "kta", network: "iot", name: "Test Hotspot" }),
  },
});
mock.module("../services/oracle.js", { exports: { getPendingRewards: async () => pendingRewards } });
mock.module("../services/transaction.js", {
  exports: { claimRewardsForToken: (_env, tokenKey) => claimToken(tokenKey) },
});
mock.method(console, "log", () => {}); // the structured claim event
const { handleClaim } = await import("./claim.js");

const ENTITY_KEY = "11111111111111111111111111111111111111111111";
const today = new Date().toISOString().slice(0, 10);
const reward = (label) => ({ claimable: true, pending: "100", label, oracleRewards: [], destination: null, recipientExists: true });
const sent = (tokenKey) => ({ token: tokenKey.toUpperCase(), decimals: 6, txSignature: `sig-${tokenKey}` });
const claimRequest = () => new Request("https://worker.test/claim", { method: "POST", body: JSON.stringify({ entityKey: ENTITY_KEY }) });
let env;
let waited;
const ctx = { waitUntil: (promise) => waited.push(promise) };

beforeEach(() => {
  const store = new Map();
  env = {
    HOTSPOT_CLAIM_PAYER_WALLET_PRIVATE_KEY: "test-payer",
    KV: { store, get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); } },
  };
  waited = [];
  pendingRewards = { hnt: reward("HNT"), iot: reward("IOT") };
  claimToken = async (tokenKey) => sent(tokenKey);
});

test("the claim runs under waitUntil, so a client disconnect can't cut it short", async () => {
  const response = await handleClaim(claimRequest(), env, ctx);
  assert.equal(waited.length, 1);
  assert.equal(await waited[0], response);
  assert.equal((await response.json()).success, true);
});

test("the cooldown and daily count are recorded once the first token is broadcast", async () => {
  let started;
  const secondStarted = new Promise((resolve) => { started = resolve; });
  let finishSecond;
  claimToken = (tokenKey) => {
    if (tokenKey === "hnt") return Promise.resolve(sent(tokenKey));
    started();
    return new Promise((resolve) => { finishSecond = () => resolve(sent(tokenKey)); });
  };
  const pending = handleClaim(claimRequest(), env, ctx);
  await secondStarted;
  // A request cut off here, between tokens, has already started the cooldown.
  const early = JSON.parse(env.KV.store.get(`claim:hotspot:${ENTITY_KEY}`));
  assert.deepEqual(early.claims.map((c) => c.txSignature), ["sig-hnt"]);
  assert.equal(env.KV.store.get(`claims:daily:${today}`), "1");
  finishSecond();
  assert.equal((await (await pending).json()).success, true);
  const final = JSON.parse(env.KV.store.get(`claim:hotspot:${ENTITY_KEY}`));
  assert.deepEqual(final.claims.map((c) => c.txSignature), ["sig-hnt", "sig-iot"]);
  assert.equal(final.claimedAt, early.claimedAt);
  assert.equal(env.KV.store.get(`claims:daily:${today}`), "1");
});

test("a claim where every token fails records nothing", async (t) => {
  t.mock.method(console, "error", () => {});
  claimToken = async () => { throw new Error("oracle unavailable"); };
  const body = await (await handleClaim(claimRequest(), env, ctx)).json();
  assert.equal(body.success, false);
  assert.equal(env.KV.store.has(`claim:hotspot:${ENTITY_KEY}`), false);
  assert.equal(env.KV.store.has(`claims:daily:${today}`), false);
});

test("a recorded claim blocks the next one for the cooldown", async () => {
  await handleClaim(claimRequest(), env, ctx);
  const again = await handleClaim(claimRequest(), env, ctx);
  assert.equal(again.status, 429);
  assert.equal((await again.json()).type, "hotspot");
});
