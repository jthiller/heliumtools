# WebMCP integration

Site-wide implementation of **WebMCP** (the W3C Web Model Context API,
https://webmachinelearning.github.io/webmcp/): every tool page registers
MCP-style tools that AI agents — browser-integrated agents, ChatGPT's in-app
browser, extensions — can discover and invoke, with all arguments validated
before any action runs. In browsers without WebMCP everything no-ops.

## Standard status (as of October 2026)

- Draft Community Group Report from the W3C Web Machine Learning CG
  (Microsoft + Google), announced Feb 2026. Not yet on the standards track.
- Entry point moved `navigator.modelContext` → `document.modelContext`;
  Chromium 150 deprecates the navigator alias. Origin trials:
  Chrome 149+, Edge 150+. ChatGPT's in-app browser supports it natively;
  Brave Leo experimental. Official TS types: `webmcp-types` on npm.
- Core surface: `document.modelContext.registerTool(tool, { signal })`
  (unregister by aborting), `getTools()`, `executeTool()`, `toolchange`
  event. A tool is `{ name, title?, description, inputSchema, execute,
  annotations? }`; the draft permits JSON-serializable results. This site
  resolves with an MCP CallToolResult (`{ content: [{ type: "text", text }],
  isError? }`) for compatibility across supporting agents.

## Files

- `webmcp.js` — the core: `getModelContext()` feature detection (document →
  navigator fallback), `registerWebMcpTools(tools)` (handles the legacy
  `provideContext()`-only shape too; for early hosts that need
  `unregisterTool(name)` it calls that only while no newer registration owns
  the name, since it removes by name), the JSON-Schema-subset validator,
  `normalizeInput` (defaults + numeric-string coercion), cancellation
  guards before actions and after asynchronous validation, result helpers,
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

Tools that also fetch after driving the page would pay the request twice
(the page's debounced effect repeats it). Two remedies, by situation:
where the page exposes its own loader, route the tool through it so one
fetch serves both the tool result and the render (ve-hnt's
`analyzeWallet`); otherwise wrap the read fetcher in
`lib/requestDedupe.js` `dedupeAsync` (short-TTL in-flight sharing — the
oui balance and the claimer's lookup/wallet fetchers). Never dedupe
mutations or reads that must reflect a mutation immediately (the
claimer's rewards reads and ve-hnt's post-claim positions refresh stay
live).

Cancellation is per execution. The wrapper rejects a call whose signal has
already aborted before `validate` or `execute` runs, and discards a result
that lands after an abort, so a tool needs no abort check on entry; check
again only after an await that comes before a side effect. Tools that do
I/O accept `(input, { signal } = {})` and pass the signal through to API
clients, scans and polling waits, except the two broadcast POSTs (see
Safety rules). Clients compose their own deadline with
`lib/abort.js`'s `withTimeout(signal, ms)`; every shared page read passes
through it, so it falls back where `AbortSignal.any` or
`AbortSignal.timeout` is missing. `throwIfAborted(signal)` checks cancellation
without requiring the native method and supplies an AbortError when an older
signal has no reason. Waits use `abortableDelay(ms, signal)`. A
tool that shares the page's own load ends only its wait with
`raceAbort(promise, signal)` (ve-hnt), so the page still renders. Do not
turn an abort into partial data or a normal error result. The Mobile tool
stops its one-shot worker on cancellation and lets it write what it already
downloaded; cancelling a tool waiting for the dashboard does not stop the
dashboard's own refresh.

For shared reads, `dedupeAsync(fn, ttlMs, { signalIndex })` identifies the
optional `{ signal }` argument of `fn`. Signals are excluded from the cache
key, and cancelling one consumer does not cancel another consumer's read.
The underlying request aborts only after its last consumer cancels. Other
request options remain part of the key. Never dedupe mutations.
Shared fetches must have their own deadline, because an uncancelled page
consumer keeps an in-flight request alive; a stalled request must fail and
leave the cache so a later call can retry. Expired results are swept (at
most once per TTL), so a long-lived page keeps only what it could still
serve.

## Coverage

**The per-page tool lists live in `catalog.js`** — the single source,
served live to agents by `list-helium-tools`; don't duplicate them here.
Every reachable page registers at least the site-wide tools: the SPA
mounts `SiteTools` outside `<Routes>` (so unmatched 404 paths keep them),
and both oui-notifier entry pages register them locally.

Pages with deliberately no page tools: `/` (landing), `/oui-notifier/
verify/` (terminal confirmation page), and `/dc-purchase` + its order
page (the tool is hidden from the landing page until it works — add tools when it ships).

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

A page listed on `/` also needs its landing card in the same commit (see
`../pages/landing/CLAUDE.md`, "Keeping cards current").

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
can read and retry. Cancellation rejects with the caller's abort reason.
Browsers do NOT validate agent
arguments against `inputSchema`; this wrapper is the enforcement point.

Error convention inside tools: reject bad arguments via the `validate`
hook; `throw` for everything else (the wrapper renders it as
"<name> failed: <message>"). Explicit transaction `success: false` results
throw with the original payload in `error.data`; the wrapper preserves it
as a second JSON text item alongside the error message. Partial successes
keep their per-token results. Don't hand-build `{ content, isError }`
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
  Both carry `annotations: { readOnlyHint: false, consequentialHint: true }`.
  Hints inform the browser/agent; they do not replace user authorization.
  Cancellation prevents starting a broadcast, but the broadcast POST never
  takes the call's signal: once sent it runs to completion, because when a
  client disconnects Cloudflare may cancel the Worker's remaining work (a
  claim cut off between tokens, a migration between batches). The
  cancelled call still rejects; a migration still reports its outcome on
  the page.
- Tool results are bounded (fleet pages 200 rows, rewards pages 100,
  packets 25 by default). Wallet fleet, rewards, onboarding, IoT and Mobile
  tools expose `offset`/`limit` and `pagination.nextOffset` so agents can
  retrieve the remainder. `aggregateScope` states whether summary counts
  cover the current page or the whole fleet. Page membership follows
  entityKey. Mobile `issue` narrows the fleet before paging; IoT `health`
  filters rows within each entityKey page, both during an own scan and after
  the dashboard scan completes, so its offsets never change meaning between
  those sources. IoT pagination counts all IoT Hotspots, including pages with
  no health matches. Offsets apply to the current live dataset,
  not a frozen snapshot.

## Testing

Run `cd pages/public && npm test` with Node.js 24+. The dependency-free
Node test runner uses experimental module mocks to isolate API and worker
boundaries. Tests cover schema validation, useful errors, registration and
hook cleanup (including late asynchronous factories), shared cancellation,
transaction metadata/failures, complete and stable fleet pagination, Mobile
worker stop and settle, and the abort helpers' fallbacks for browsers
without `AbortSignal.any`/`AbortSignal.timeout` or native `throwIfAborted`.
Ownership checks keep stale cleanup from removing replacement registrations
in both registerTool and provideContext hosts. No test sends on-chain
transactions. Frontend checks run
`npm ci`, `npm test`, and `npm run build` on pull requests and main pushes.

No WebMCP browser at hand: `document.modelContext` is undefined and
everything no-ops — verify with the console. With Chrome 149+ (origin
trial or `chrome://flags` WebMCP flag) or ChatGPT's in-app browser:
`await document.modelContext.getTools()` on any page should list the site
tools plus the page's own; `executeTool` one and check the UI follows.
Invalid args (wrong type, unknown key, bad base58) must return
`isError: true` with a readable message, not throw.
