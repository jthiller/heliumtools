# WebMCP integration

Site-wide implementation of **WebMCP** (the W3C Web Model Context API,
https://webmachinelearning.github.io/webmcp/): every tool page registers
MCP-style tools that AI agents — browser-integrated agents, ChatGPT's in-app
browser, extensions — can discover and invoke, with all arguments validated
before any action runs. In browsers without WebMCP everything no-ops.

## Standard status (as of Aug 2026)

- Draft Community Group Report from the W3C Web Machine Learning CG
  (Microsoft + Google), announced Feb 2026. Not yet on the standards track.
- Entry point moved `navigator.modelContext` → `document.modelContext` in the
  May 2026 draft; Chromium 150 deprecates the navigator alias. Origin trials:
  Chrome 149+, Edge 150+. ChatGPT's in-app browser supports it natively;
  Brave Leo experimental. Official TS types: `webmcp-types` on npm.
- Core surface: `document.modelContext.registerTool(tool, { signal })`
  (unregister by aborting), `getTools()`, `executeTool()`, `toolchange`
  event. A tool is `{ name, title?, description, inputSchema, execute,
  annotations? }`; `execute` resolves with an MCP CallToolResult
  (`{ content: [{ type: "text", text }], isError? }`).

## Files

- `webmcp.js` — the core: `getModelContext()` feature detection (document →
  navigator fallback), `registerWebMcpTools(tools)` (handles the legacy
  `provideContext()`-only shape too), the JSON-Schema-subset validator,
  `normalizeInput` (defaults + numeric-string coercion), result helpers,
  and DEV-only drift warnings (invalid/duplicate names, and names missing
  from `catalog.js`).
- `helpers.js` — tiny, dependency-free schema fragments
  (`BASE58_PATTERN`, `SOLANA_ADDRESS_SCHEMA`, `WALLET_ADDRESS_SCHEMA`,
  `ENTITY_KEY_SCHEMA` — spread and override `description` per field) and
  `capListField` (result truncation). This is the ONLY webmcp module
  per-page `webmcpTools.js` files may import statically.
- `useWebMcpTools.js` — React hook: register on mount, unregister on
  unmount (StrictMode-safe). Keep `deps` `[]` and read live values via
  refs. **Bundle discipline lives here**: the hook feature-detects first
  and dynamically imports `webmcp.js` only when the browser exposes
  WebMCP, so human visitors never download or parse the core. The factory
  may return a Promise — site-tool registrations use that to lazy-load
  `siteTools.js` (and the catalog it carries) too.
- `catalog.js` — agent-facing catalog of every tool page (path, summary,
  the WebMCP tools it registers) plus `SITE_TOOL_NAMES`. Separate from
  Landing's marketing copy on purpose; includes the unlisted /vote pages.
  **Update it when adding a page or renaming a page's tools** — in dev,
  registering a name the catalog doesn't list logs a console warning.
- `siteTools.js` — the three tools registered on every page:
  `list-helium-tools`, `open-helium-tool` (SPA navigate or full page load
  cross-entry), `get-hnt-price`.
- `SiteTools.jsx` — mounts the site tools inside the SPA router
  (`main.jsx`), outside `<Routes>` so 404 paths keep them. The
  oui-notifier entry (no router) registers them from `oui-notifier/
  Home.jsx` and `VerifyPage.jsx` with `makeSiteTools(null)`.

## Per-page pattern

Each tool page has a colocated `webmcpTools.js` next to its component
(inside the page's lazy chunk — the main bundle only carries the core).
Pure API tools export an array; tools that drive the page export a
`make*Tools(callbacks)` factory and the component passes its own handlers:

- **URL-canonical pages** (wallet-dashboard, vote, hotspot-claimer,
  mobile-onboard): tools navigate/set search params — the page's own
  effects do the loading, so the user watches the agent work.
- **URL-seeded-once pages** (ve-hnt, multi-gateway): tools call the page's
  setter (`setInput`, `selectMac`) — a later URL change would not propagate.
- **Local-state pages** (oui-notifier, l1-migration, hotspot-map): tools
  call setters/handlers passed in from the component.

Register with one `useWebMcpTools(() => makeXTools(...), [])` call in the
page component. Handlers that close over only stable setters can be
passed directly; handlers that read changing state go through a ref (see
MultiGateway's `gatewaysRef`).

Tools that also fetch after driving the page: the page's own debounced
effect repeats the same request moments later, so those read fetchers are
wrapped in `lib/requestDedupe.js` `dedupeAsync` (short-TTL in-flight
sharing). Never wrap mutations or reads that must reflect a mutation
immediately (the claimer's rewards reads stay live).

## Coverage

**The per-page tool lists live in `catalog.js`** — the single source,
served live to agents by `list-helium-tools`; don't duplicate them here.
Every reachable page registers at least the site-wide tools: the SPA
mounts `SiteTools` outside `<Routes>` (so unmatched 404 paths keep them),
and both oui-notifier entry pages register them locally.

Pages with deliberately no page tools: `/` (landing), `/oui-notifier/
verify/` (terminal confirmation page), and `/dc-purchase` + its order
page (tool is disabled "Coming Soon" — add tools when it ships).

Intentionally not exposed: BLE flows (iot-onboard scanning/connecting —
Web Bluetooth requires a user gesture), every wallet-signing action, and
iot-onboard's `/lookup` (its inputs come from mid-BLE-flow reads).

## Checklist: adding or changing tools

**Adding a tool page** (do all four, same commit):
1. Create `src/<tool>/webmcpTools.js` — an exported array for pure API
   tools, a `make*Tools(callbacks)` factory when tools drive page state.
   Import only `../webmcp/helpers.js` statically.
2. Register it with one `useWebMcpTools(...)` call in the page component.
3. Add the page to `catalog.js` (path, entry, agent-facing summary, tool
   names). The DEV drift warning flags registered names the catalog
   doesn't list.
4. Add a `## WebMCP` section to the tool's own CLAUDE.md.

**Changing an existing tool** (endpoints, params, response shape, flows):
- Update its `webmcpTools.js` in the same commit — the descriptions and
  `inputSchema` are the agent's API docs, so a stale schema is a bug, not
  a doc nit.
- Mirror renamed/added/removed tool names in `catalog.js` and the tool's
  CLAUDE.md `## WebMCP` section.
- Removing a page: delete its catalog entry too.

## Validation contract

`registerWebMcpTools` wraps every `execute`: arguments are normalized
(defaults, `"5"` → 5) and validated against the tool's `inputSchema`
(type/required/enum/pattern/min/max/items/additionalProperties). An
optional per-tool `validate(input)` hook adds domain checks (e.g. "is this
MAC in the gateway list"). Failures and thrown errors (incl. rate-limit
info from `ApiError`) come back as `isError: true` MCP results the agent
can read and retry — never as exceptions. Browsers do NOT validate agent
arguments against `inputSchema`; this wrapper is the enforcement point.

Error convention inside tools: reject bad arguments via the `validate`
hook; `throw` for everything else (the wrapper renders it as
"<name> failed: <message>"). Don't hand-build `{ content, isError }`
literals — `toolError` in webmcp.js exists only for custom shaping.

## Safety rules

- Read-only tools carry `annotations: { readOnlyHint: true }`.
- Wallet-signature actions (dc-mint burn, veHNT claim, location assert,
  onboarding) are **never** exposed — agents quote/prefill, humans sign.
- Forms with external side effects are prefilled, not submitted
  (oui-notifier subscribe → verification email stays a human click).
- Exposed state-changing tools are the permissionless ones the pages
  already offer anyone: `claim-hotspot-rewards` (treasury-subsidized;
  description tells agents to check pending rewards first) and
  `migrate-l1-wallet` (idempotent, official pre-signed txns).
- Tool results are capped (fleet 200 rows, packets 25 by default) so a big
  wallet can't blow out an agent's context.

## Testing

No WebMCP browser at hand: `document.modelContext` is undefined and
everything no-ops — verify with the console. With Chrome 149+ (origin
trial or `chrome://flags` WebMCP flag) or ChatGPT's in-app browser:
`await document.modelContext.getTools()` on any page should list the site
tools plus the page's own; `executeTool` one and check the UI follows.
Invalid args (wrong type, unknown key, bad base58) must return
`isError: true` with a readable message, not throw.
