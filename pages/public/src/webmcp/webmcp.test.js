import assert from "node:assert/strict";
import test from "node:test";
import {
  getModelContext,
  normalizeInput,
  registerWebMcpTools,
  toolError,
  toolResult,
  validateAgainstSchema,
} from "./webmcp.js";

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const descriptor = (name, execute = () => "ok", extra = {}) => ({
  name,
  description: name,
  inputSchema: emptySchema,
  execute,
  ...extra,
});
const flush = () => new Promise((resolve) => setImmediate(resolve));

function surfaces(t, documentContext, navigatorContext) {
  for (const [name, context] of [["document", documentContext], ["navigator", navigatorContext]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: context ? { modelContext: context } : undefined });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
}

function modernContext() {
  const tools = new Map();
  const signals = [];
  return {
    tools,
    signals,
    registerTool(tool, { signal }) {
      if (tools.has(tool.name)) return Promise.reject(new Error("duplicate tool"));
      tools.set(tool.name, tool);
      signals.push(signal);
      signal.addEventListener("abort", () => tools.delete(tool.name), { once: true });
      return Promise.resolve();
    },
  };
}

function wrappedTool(t, tool) {
  const context = modernContext();
  surfaces(t, context);
  t.after(registerWebMcpTools([tool]));
  return context.tools.get(tool.name);
}

test("unsupported browsers no-op, and document takes precedence over navigator", (t) => {
  surfaces(t);
  assert.equal(getModelContext(), null);
  assert.doesNotThrow(registerWebMcpTools([descriptor("unsupported")]));
  const current = {};
  const legacy = {};
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { modelContext: legacy } });
  assert.equal(getModelContext(), legacy);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: current } });
  assert.equal(getModelContext(), current);
});

test("normalization fills defaults and coerces scalar strings without mutating input", () => {
  const schema = {
    type: "object",
    properties: {
      count: { type: "integer", default: 25 },
      enabled: { type: "boolean" },
      amount: { type: "number" },
    },
  };
  const input = { enabled: "false", amount: "1.25" };
  assert.deepEqual(normalizeInput(schema, input), { count: 25, enabled: false, amount: 1.25 });
  assert.deepEqual(input, { enabled: "false", amount: "1.25" });
  assert.equal(normalizeInput(schema, { amount: " " }).amount, " ");
  assert.equal(normalizeInput(schema, { count: "2" }).count, 2);
});

test("validation enforces nested bounds, required fields, and unknown keys", () => {
  const schema = {
    type: "object",
    properties: {
      keys: { type: "array", minItems: 1, maxItems: 2, items: { type: "string", pattern: "^[a-z]+$", maxLength: 3 } },
      count: { type: "integer", minimum: 1, maximum: 5 },
      kind: { type: "string", enum: ["iot", "mobile"] },
    },
    required: ["keys"],
    additionalProperties: false,
  };
  assert.deepEqual(validateAgainstSchema(schema, { keys: ["abc"], count: 2, kind: "iot" }), []);
  for (const value of [null, [], {}, { keys: [] }, { keys: ["a", "b", "c"] }, { keys: ["123"] }, { keys: ["abcd"] }, { keys: ["a"], count: 6 }, { keys: ["a"], count: 1.5 }, { keys: ["a"], kind: "unknown" }, { keys: ["a"], extra: 1 }]) {
    assert.ok(validateAgainstSchema(schema, value).length, JSON.stringify(value));
  }
  assert.ok(validateAgainstSchema({ type: "number", exclusiveMinimum: 0 }, 0).length);
  assert.ok(validateAgainstSchema({ type: "number", exclusiveMaximum: 1 }, 1).length);
  assert.ok(validateAgainstSchema({ type: "number" }, Infinity).length);
  assert.ok(validateAgainstSchema({ const: "expected" }, "other").length);
});

test("prototype member names cannot bypass additionalProperties or required checks", () => {
  for (const key of ["__proto__", "constructor", "toString"]) {
    const value = JSON.parse(`{"${key}":"unexpected"}`);
    assert.match(validateAgainstSchema(emptySchema, value)[0], /unknown property/);
    assert.match(validateAgainstSchema({ type: "object", required: [key] }, {})[0], /required/);
  }
  const schema = { type: "object", properties: { toString: { type: "string", default: "own value" } } };
  assert.deepEqual(normalizeInput(schema, {}), { toString: "own value" });
  assert.deepEqual(validateAgainstSchema(schema, { toString: "allowed" }), []);
});

test("wrapped tools reject invalid arguments and domain checks before executing", async (t) => {
  let executions = 0;
  const tool = wrappedTool(t, descriptor("validation", () => { executions++; }, {
    inputSchema: { type: "object", properties: { count: { type: "integer", default: 2 } }, additionalProperties: false },
    validate: ({ count }) => count === 3 ? "count unavailable" : null,
  }));
  assert.match((await tool.execute({ wrong: 1 })).content[0].text, /unknown property/);
  const result = await tool.execute({ count: "3" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /count unavailable/);
  assert.equal(executions, 0);
});

test("wrapped tools apply defaults and preserve MCP results and execution options", async (t) => {
  const result = toolError("custom result");
  const options = { signal: new AbortController().signal };
  const tool = wrappedTool(t, descriptor("defaults", (input, receivedOptions) => {
    assert.deepEqual(input, { count: 5 });
    assert.equal(receivedOptions, options);
    return result;
  }, { inputSchema: { type: "object", properties: { count: { type: "integer", default: 5 } } } }));
  assert.equal(await tool.execute(undefined, options), result);
});

test("execution failures preserve rate limits and per-token failure details", async (t) => {
  const data = { success: false, claims: [{ token: "HNT", error: "upstream unavailable" }] };
  const tool = wrappedTool(t, descriptor("failure", () => {
    throw Object.assign(new Error("claim failed"), { rateLimited: true, retryAfterSeconds: 12, data });
  }));
  const result = await tool.execute({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /failure failed: claim failed.*retry after 12s/);
  assert.deepEqual(JSON.parse(result.content[1].text), data);
  assert.deepEqual(toolError("message"), { content: [{ type: "text", text: "message" }], isError: true });
});

test("result serialization handles bigint, undefined, and circular values", () => {
  assert.equal(toolResult({ amount: 10n }).content[0].text, '{"amount":"10"}');
  assert.equal(toolResult(undefined).content[0].text, "undefined");
  const circular = {};
  circular.self = circular;
  assert.equal(toolResult(circular).content[0].text, "[object Object]");
});

test("pre-aborted execution cannot validate or act, preserving its custom reason", async (t) => {
  const controller = new AbortController();
  const reason = new Error("user cancelled");
  controller.abort(reason);
  const tool = wrappedTool(t, descriptor("pre-aborted", () => assert.fail("must not execute"), {
    validate: () => assert.fail("must not validate"),
  }));
  await assert.rejects(tool.execute({}, { signal: controller.signal }), (err) => err === reason);
});

test("wrapped executions work and honour cancellation without native throwIfAborted", async (t) => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "throwIfAborted");
  delete AbortSignal.prototype.throwIfAborted;
  t.after(() => Object.defineProperty(AbortSignal.prototype, "throwIfAborted", original));
  let executions = 0;
  const tool = wrappedTool(t, descriptor("portable-abort", () => ++executions));
  assert.equal((await tool.execute({}, { signal: new AbortController().signal })).content[0].text, "1");
  const reason = new Error("cancelled on an older browser");
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(tool.execute({}, { signal: controller.signal }), (err) => err === reason);
  assert.equal(executions, 1);
  await assert.rejects(tool.execute({}, { signal: { aborted: true } }), { name: "AbortError" });
});

test("cancellation during async validation cannot start execution", async (t) => {
  const controller = new AbortController();
  let finishValidation;
  const tool = wrappedTool(t, descriptor("async-validation", () => assert.fail("must not execute"), {
    validate: () => new Promise((resolve) => { finishValidation = resolve; }),
  }));
  const pending = tool.execute({}, { signal: controller.signal });
  const reason = new Error("cancelled while validating");
  controller.abort(reason);
  finishValidation(null);
  await assert.rejects(pending, (err) => err === reason);
});

test("cancellation after execution starts does not become a success or MCP error", async (t) => {
  const controller = new AbortController();
  let finishExecution;
  const tool = wrappedTool(t, descriptor("async-execution", () => new Promise((resolve) => { finishExecution = resolve; })));
  const pending = tool.execute({}, { signal: controller.signal });
  controller.abort();
  finishExecution("finished late");
  await assert.rejects(pending, { name: "AbortError" });
});

test("modern registration cleanup is immediate and idempotent, including pending registration", async (t) => {
  const context = modernContext();
  surfaces(t, context);
  const cleanup = registerWebMcpTools([descriptor("modern-one"), descriptor("modern-two")]);
  assert.equal(context.tools.size, 2);
  cleanup();
  cleanup();
  await flush();
  assert.equal(context.tools.size, 0);
  assert.ok(context.signals.every((signal) => signal.aborted));
  const nextCleanup = registerWebMcpTools([descriptor("modern-one")]);
  assert.equal(context.tools.size, 1);
  nextCleanup();
});

test("legacy navigator registration removes tools by name across remounts", (t) => {
  const tools = new Map();
  const removed = [];
  const context = {
    registerTool(tool) {
      if (tools.has(tool.name)) throw new Error("duplicate tool");
      tools.set(tool.name, tool);
    },
    unregisterTool(name) { removed.push(name); tools.delete(name); },
  };
  surfaces(t, undefined, context);
  const cleanup = registerWebMcpTools([descriptor("legacy")]);
  cleanup();
  cleanup();
  assert.deepEqual(removed, ["legacy"]);
  const nextCleanup = registerWebMcpTools([descriptor("legacy")]);
  assert.equal(tools.size, 1);
  nextCleanup();
  assert.equal(tools.size, 0);
});

test("late legacy registration success after cleanup is removed", async (t) => {
  const tools = new Map();
  let finishRegistration;
  const context = {
    registerTool(tool) {
      return new Promise((resolve) => {
        finishRegistration = () => { tools.set(tool.name, tool); resolve(); };
      });
    },
    unregisterTool(name) { tools.delete(name); },
  };
  surfaces(t, context);
  const cleanup = registerWebMcpTools([descriptor("late-legacy")]);
  cleanup();
  finishRegistration();
  await flush();
  assert.equal(tools.size, 0);
});

test("a registration that resolves after its page unmounted never removes a newer one by name", async (t) => {
  // A host between the old API and the draft: promise-returning registerTool
  // that honors the signal, yet still exposes unregisterTool(name).
  const tools = new Map();
  const pending = [];
  surfaces(t, {
    registerTool(tool, { signal }) {
      return new Promise((resolve) => {
        pending.push(() => {
          if (!signal.aborted) {
            tools.set(tool.name, tool);
            signal.addEventListener("abort", () => { if (tools.get(tool.name) === tool) tools.delete(tool.name); }, { once: true });
          }
          resolve();
        });
      });
    },
    unregisterTool(name) { tools.delete(name); },
  });
  const votes = registerWebMcpTools([descriptor("list-vote-proposals")]);
  votes(); // /votes unmounts while its registration is still pending
  const vote = registerWebMcpTools([descriptor("list-vote-proposals")]);
  pending[1](); // /vote's registration lands first
  pending[0](); // then the stale one resolves
  await flush();
  assert.equal(tools.size, 1);
  vote();
  assert.equal(tools.size, 0);
});

test("synchronous registration failure rolls back earlier modern and legacy registrations", (t) => {
  surfaces(t);
  for (const legacy of [false, true]) {
    const context = modernContext();
    const register = context.registerTool.bind(context);
    context.registerTool = (tool, options) => {
      if (tool.name === "refused") throw new Error("registration refused");
      if (legacy) { context.tools.set(tool.name, tool); return; }
      return register(tool, options);
    };
    if (legacy) context.unregisterTool = (name) => context.tools.delete(name);
    Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: context } });
    assert.throws(() => registerWebMcpTools([descriptor("prior"), descriptor("refused")]), /registration refused/);
    assert.equal(context.tools.size, 0);
  }
});

test("async registration and legacy removal rejections are observed", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  surfaces(t, {
    registerTool: () => Promise.reject(new DOMException("blocked", "NotAllowedError")),
  });
  const cleanup = registerWebMcpTools([descriptor("blocked")]);
  await flush();
  assert.equal(warning.mock.callCount(), 1);
  cleanup();
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: {
    registerTool() {},
    unregisterTool: () => Promise.reject(new DOMException("removal failed", "OperationError")),
  } } });
  registerWebMcpTools([descriptor("remove-rejected")])();
  await flush();
  assert.equal(warning.mock.callCount(), 2);
});

test("provideContext fallback maintains the union and cleans up independently", (t) => {
  const snapshots = [];
  surfaces(t, { provideContext: ({ tools }) => snapshots.push(tools.map((tool) => tool.name)) });
  const first = registerWebMcpTools([descriptor("site")]);
  const second = registerWebMcpTools([descriptor("page")]);
  first();
  first();
  second();
  assert.deepEqual(snapshots, [["site"], ["site", "page"], ["page"], []]);
});

test("provideContext cleanup preserves a newer tool with the same name", async (t) => {
  let current;
  surfaces(t, { provideContext: ({ tools }) => { current = tools; } });
  const first = registerWebMcpTools([descriptor("shared-fallback", () => "old")]);
  const second = registerWebMcpTools([descriptor("shared-fallback", () => "replacement")]);
  first();
  assert.equal(current.length, 1);
  assert.equal((await current[0].execute({})).content[0].text, "replacement");
  second();
  assert.equal(current.length, 0);
});
