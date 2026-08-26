/**
 * WebMCP (Web Model Context API) core — framework-free.
 *
 * WebMCP lets a page expose its functionality as MCP-style "tools" that AI
 * agents (browser-integrated agents, ChatGPT's in-app browser, extensions)
 * can discover and invoke. Spec: https://webmachinelearning.github.io/webmcp/
 *
 * The W3C draft moved the entry point from `navigator.modelContext` to
 * `document.modelContext` (May 2026); Chromium 150 deprecates the navigator
 * alias, and some early builds only implement `provideContext()` instead of
 * `registerTool()`. `registerWebMcpTools()` papers over all three shapes.
 *
 * Every tool registered through this module gets its arguments validated
 * against the tool's `inputSchema` before `execute` runs — browsers pass
 * agent-supplied arguments through as-is, so validation is on us. Failures
 * come back as MCP error results (`isError: true`) with messages the agent
 * can act on, never as thrown exceptions.
 */

import { TOOL_CATALOG, SITE_TOOL_NAMES } from "./catalog.js";

/**
 * Feature-detect the Model Context entry point. Returns null when the
 * browser doesn't support WebMCP (the common case today — the API is in
 * origin trials in Chrome 149+/Edge 150+ and live in agentic browsers).
 */
export function getModelContext() {
  if (typeof document !== "undefined" && document.modelContext) {
    return document.modelContext;
  }
  if (typeof navigator !== "undefined" && navigator.modelContext) {
    return navigator.modelContext;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Result helpers — tools resolve with MCP CallToolResult shapes. Returning
// the explicit `{ content: [...] }` form (rather than a bare value) keeps us
// compatible across implementations that don't auto-wrap return values.
// ---------------------------------------------------------------------------

/** Wrap any value as a successful MCP text result. Always yields a string
 * `text`: JSON.stringify returns undefined for undefined and throws on
 * BigInt, either of which would corrupt the result of a tool that itself
 * succeeded. */
export function toolResult(value) {
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  let text;
  try {
    text = JSON.stringify(value, (key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    text = null;
  }
  return { content: [{ type: "text", text: typeof text === "string" ? text : String(value) }] };
}

/** Wrap a message as an MCP error result the agent can read and retry on. */
export function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(type, value) {
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "array") return Array.isArray(value);
  if (type === "null") return value === null;
  if (type === "object") return typeOf(value) === "object";
  return typeof value === type;
}

/**
 * Fill `default`s for missing properties and coerce numeric/boolean strings
 * for schemas that declare number/integer/boolean types. Agents sometimes
 * emit `"5"` where a schema says integer; being tolerant here saves a
 * round trip. Returns a copy — never mutates the agent's input.
 */
export function normalizeInput(schema, input) {
  if (!schema || schema.type !== "object" || typeOf(input) !== "object") return input;
  const out = { ...input };
  const props = schema.properties || {};
  for (const [key, propSchema] of Object.entries(props)) {
    if (out[key] === undefined) {
      if (propSchema.default !== undefined) out[key] = propSchema.default;
      continue;
    }
    const value = out[key];
    if (typeof value === "string") {
      if ((propSchema.type === "number" || propSchema.type === "integer") && value.trim() !== "" && !Number.isNaN(Number(value))) {
        out[key] = Number(value);
      } else if (propSchema.type === "boolean" && (value === "true" || value === "false")) {
        out[key] = value === "true";
      }
    }
  }
  return out;
}

/**
 * Validate `value` against a JSON Schema subset. Enforced keywords: type,
 * properties, required, additionalProperties, enum, const, pattern,
 * minLength/maxLength, minimum/maximum, exclusiveMinimum/exclusiveMaximum,
 * items, minItems/maxItems. Returns an array of human-readable error
 * strings; empty means valid. Unknown keywords are ignored, matching JSON
 * Schema semantics.
 */
export function validateAgainstSchema(schema, value, path = "input") {
  const errors = [];
  if (!schema) return errors;

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`);
    return errors;
  }
  if (schema.type && !matchesType(schema.type, value)) {
    errors.push(`${path}: expected ${schema.type}, got ${typeOf(value)}`);
    return errors;
  }

  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: does not match pattern ${schema.pattern}`);
    }
  }

  if ((schema.type === "number" || schema.type === "integer") && typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: must be <= ${schema.maximum}`);
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      errors.push(`${path}: must be > ${schema.exclusiveMinimum}`);
    }
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
      errors.push(`${path}: must be < ${schema.exclusiveMaximum}`);
    }
  }

  if (schema.type === "array" && Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: must have at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: must have at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        errors.push(...validateAgainstSchema(schema.items, item, `${path}[${i}]`));
      });
    }
  }

  if (schema.type === "object" && typeOf(value) === "object") {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key}: required`);
    }
    for (const [key, propValue] of Object.entries(value)) {
      if (props[key]) {
        if (propValue !== undefined) {
          errors.push(...validateAgainstSchema(props[key], propValue, `${path}.${key}`));
        }
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unknown property (allowed: ${Object.keys(props).join(", ")})`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// Names currently registered on this page, to catch collisions in dev, plus
// the full wrapped-tool map for the legacy provideContext() fallback (which
// replaces the whole tool set on every call, so we must re-provide the union).
const activeToolNames = new Set();
const providedTools = new Map();

const warned = new Set();
function warnOnce(key, ...args) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn("[webmcp]", ...args);
}

/**
 * Wrap a tool descriptor so its `execute`:
 *  1. normalizes then validates arguments against `inputSchema`,
 *  2. runs the optional async `validate(input)` domain check (return an
 *     error string to reject, anything falsy to accept),
 *  3. wraps return values / thrown errors as MCP results.
 */
function wrapTool(tool) {
  const { validate, execute, ...descriptor } = tool;
  return {
    ...descriptor,
    async execute(rawInput, options) {
      const input = normalizeInput(tool.inputSchema, rawInput ?? {});
      const schemaErrors = validateAgainstSchema(tool.inputSchema, input);
      if (schemaErrors.length > 0) {
        return toolError(`Invalid arguments for ${tool.name}:\n${schemaErrors.map((e) => `- ${e}`).join("\n")}`);
      }
      try {
        if (validate) {
          const message = await validate(input);
          if (message) return toolError(`Invalid arguments for ${tool.name}: ${message}`);
        }
        const value = await execute(input, options);
        // Pass through results that are already MCP-shaped.
        if (value && typeof value === "object" && Array.isArray(value.content)) return value;
        return toolResult(value);
      } catch (err) {
        if (err?.name === "AbortError") throw err;
        let message = err?.message || String(err);
        if (err?.rateLimited) {
          message += ` (rate limited — retry after ${err.retryAfterSeconds || 60}s)`;
        }
        return toolError(`${tool.name} failed: ${message}`);
      }
    },
  };
}

/**
 * Register tools with the browser's model context. Returns a cleanup
 * function that unregisters them (safe to call in any browser).
 *
 * Tool descriptor fields (superset of the spec's ModelContextTool):
 *   name         required; 1-128 chars of [a-zA-Z0-9_.-]
 *   title        optional human-readable label
 *   description  required; natural language, written for the agent
 *   inputSchema  JSON Schema for the arguments (see SUPPORTED_KEYWORDS)
 *   annotations  { readOnlyHint } etc.
 *   validate     optional async domain check run after schema validation —
 *                return an error string to reject the arguments
 *   execute      (input, { signal }) => result; may return any JSON value,
 *                a string, or a full MCP { content } object. Signal
 *                failures by throwing — thrown errors become isError
 *                results ("<name> failed: <message>").
 */
export function registerWebMcpTools(tools) {
  const mc = getModelContext();
  if (!mc || tools.length === 0) return () => {};

  if (import.meta.env.DEV) {
    // Names the catalog promises agents (per-page lists + the site tools).
    // Registering a name outside this set means catalog.js drifted from
    // the actual registrations — the checklist in CLAUDE.md was missed.
    const catalogNames = new Set([
      ...SITE_TOOL_NAMES,
      ...TOOL_CATALOG.flatMap((entry) => entry.tools),
    ]);
    for (const tool of tools) {
      if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name)) {
        warnOnce(`name:${tool.name}`, `tool name "${tool.name}" is not a valid MCP tool name`);
      }
      if (activeToolNames.has(tool.name)) {
        warnOnce(`dup:${tool.name}`, `tool "${tool.name}" is already registered on this page`);
      }
      if (!catalogNames.has(tool.name)) {
        warnOnce(`catalog:${tool.name}`, `tool "${tool.name}" is not listed in webmcp/catalog.js — update the catalog (see webmcp/CLAUDE.md checklist)`);
      }
    }
  }

  const wrapped = tools.map(wrapTool);
  wrapped.forEach((t) => activeToolNames.add(t.name));

  let unregister;
  if (typeof mc.registerTool === "function") {
    const controller = new AbortController();
    for (const tool of wrapped) {
      // Fire-and-forget: rejections mean the browser refused registration
      // (e.g. NotAllowedError under a restrictive Permissions-Policy).
      Promise.resolve(mc.registerTool(tool, { signal: controller.signal })).catch((err) => {
        warnOnce(`register:${err?.name}`, "registerTool failed:", err);
      });
    }
    unregister = () => controller.abort();
  } else if (typeof mc.provideContext === "function") {
    // Legacy early-preview shape: provideContext replaces the page-level
    // tool set wholesale, so maintain the union and re-provide on changes.
    wrapped.forEach((t) => providedTools.set(t.name, t));
    mc.provideContext({ tools: [...providedTools.values()] });
    unregister = () => {
      wrapped.forEach((t) => providedTools.delete(t.name));
      mc.provideContext({ tools: [...providedTools.values()] });
    };
  } else {
    warnOnce("shape", "model context exposes neither registerTool nor provideContext");
    unregister = () => {};
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    wrapped.forEach((t) => activeToolNames.delete(t.name));
    unregister();
  };
}
