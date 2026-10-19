import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";

const effects = [];
const registrations = [];
let cleanupCount = 0;
const reactMock = mock.module("react", {
  namedExports: { useEffect: (effect, deps) => effects.push({ effect, deps }) },
});
const coreMock = mock.module(new URL("./webmcp.js", import.meta.url).href, {
  namedExports: {
    registerWebMcpTools(tools) {
      registrations.push(tools);
      return () => { cleanupCount++; };
    },
  },
});
const { useWebMcpTools } = await import("./useWebMcpTools.js");
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  effects.length = 0;
  registrations.length = 0;
  cleanupCount = 0;
});
after(() => {
  reactMock.restore();
  coreMock.restore();
});

function surfaces(t, documentValue, navigatorValue) {
  for (const [name, value] of [["document", documentValue], ["navigator", navigatorValue]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
}

test("unsupported browsers never run the factory or register tools", async (t) => {
  surfaces(t, {}, undefined);
  useWebMcpTools(() => assert.fail("factory should stay lazy"));
  assert.equal(effects[0].effect(), undefined);
  await flush();
  assert.deepEqual(registrations, []);
});

test("mount registers asynchronously and unmount runs the returned cleanup", async (t) => {
  surfaces(t, { modelContext: {} }, undefined);
  const tools = [{ name: "mounted" }];
  const deps = [];
  useWebMcpTools(() => tools, deps);
  assert.equal(effects[0].deps, deps);
  const cleanup = effects[0].effect();
  await flush();
  assert.deepEqual(registrations, [tools]);
  cleanup();
  assert.equal(cleanupCount, 1);
});

test("unmount before an async factory resolves prevents late registration", async (t) => {
  surfaces(t, { modelContext: {} }, undefined);
  let finishFactory;
  const pendingTools = new Promise((resolve) => { finishFactory = resolve; });
  useWebMcpTools(() => pendingTools);
  const cleanup = effects[0].effect();
  cleanup();
  finishFactory([{ name: "too-late" }]);
  await flush();
  assert.deepEqual(registrations, []);
  assert.equal(cleanupCount, 0);
});

test("StrictMode effect replay registers only the surviving mount", async (t) => {
  surfaces(t, {}, { modelContext: {} });
  const tools = [{ name: "strict-mode" }];
  useWebMcpTools(() => tools);
  const effect = effects[0].effect;
  effect()();
  const cleanup = effect();
  await flush();
  assert.deepEqual(registrations, [tools]);
  cleanup();
  assert.equal(cleanupCount, 1);
});

test("synchronous factory failure is observed without crashing the mount", async (t) => {
  surfaces(t, { modelContext: {} }, undefined);
  const warning = t.mock.method(console, "warn", () => {});
  useWebMcpTools(() => { throw new Error("factory failed"); });
  const cleanup = effects[0].effect();
  await flush();
  assert.equal(warning.mock.callCount(), 1);
  assert.deepEqual(registrations, []);
  assert.doesNotThrow(cleanup);
});
