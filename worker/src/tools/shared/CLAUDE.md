# Shared

Cross-tool worker utilities under the `/shared` route prefix. It holds
tool-agnostic endpoints. Today that's a single endpoint: `/shared/geo`, which
returns the requester's coarse Cloudflare-derived location and is currently
consumed by one tool (multi-gateway).

## Architecture

### Worker (API) — prefix `/shared`

Entry point: `index.js`. The shared router is registered in the top-level
prefix router (`worker/src/index.js`, `{ prefix: "/shared", handler: handleSharedRequest }`)
like any other tool — there is no ad-hoc top-level route. `handleSharedRequest`
short-circuits `OPTIONS` with `corsHeaders` and otherwise dispatches by exact
pathname, returning `404` for anything unmatched.

**Endpoints:**
- `GET /geo` — returns `{ latitude, longitude, city }` derived from `request.cf`
  (Cloudflare's geo-IP on the incoming request). Returns `{ latitude: null,
  longitude: null, city: null }` when CF didn't populate usable coordinates.
  Sent with `Cache-Control: no-store` — the response is keyed to the requester's
  IP, so caching it at any intermediary would risk serving one user another
  user's coarse location.

**Handlers:**
- `handlers/geo.js` — `handleGeo(request)`. Reads `request.cf.latitude` /
  `.longitude` / `.city`, coerces lat/lng with `parseFloat`, and only emits them
  when both are finite. No external calls, no bindings — pure read off the request
  object Cloudflare populates at the edge.

### Frontend client

`pages/public/src/lib/sharedApi.js` mirrors the `/shared` prefix on the client:
- `API_BASE` is `/api/shared` in dev (Vite proxies `/api/*` to the local worker,
  see `pages/public/vite.config.js`) and `https://api.heliumtools.org/shared` in
  production.
- `fetchGeo()` — calls `GET /geo`, returns `{ latitude, longitude }` or `null`
  (it intentionally drops the `city` field the worker returns, keeping only
  lat/lng). The promise is **memoized only on success**: a failed/null result clears the
  cached promise (guarded by an identity check so a later successful retry isn't
  clobbered), so transient failures don't permanently poison the call for the
  page session. Network errors and non-OK responses resolve to `null` rather than
  throwing, so callers can treat geo as best-effort.

## Related tools

- **multi-gateway** (`pages/public/src/multi-gateway/MultiGateway.jsx`) — the only
  current consumer. Calls `fetchGeo()` to seed a default map center / requester
  location. See `pages/public/src/multi-gateway/` and the root `CLAUDE.md`
  Multi-Gateway section.

## When to put something in `shared/` vs a tool

Restated from the root `CLAUDE.md` so contributors apply the same bar before
hoisting anything new here. Default to the consuming tool's own directory. Hoist
to `shared/` only when **all three** hold:

1. **The code is not tool-specific** — it has no knowledge of any one tool's
   domain (gateways, OUIs, L1 migration, etc.). Reading `request.cf` or validating
   a Solana address qualifies; fetching gateway packets does not.
2. **Two tools actually consume it** (or one has a concrete imminent need).
   Speculative "might reuse this someday" doesn't count — one caller isn't enough.
   Leave the utility with its single caller until a second tool has code that
   wants it. Hoisting on a hunch creates a bucket that accumulates dead code.
3. **The shape is stable.** If the API is still being iterated on, let it bake
   inside the tool first. Hoisting signals "don't change this casually."

When hoisting, mirror the path on both sides:
`worker/src/tools/shared/handlers/<handler>` ↔ `pages/public/src/lib/sharedApi.js`
↔ route prefix `/shared`. Don't add a top-level worker route outside `tools/` —
the prefix router in `worker/src/index.js` is the single dispatch point.

## Gotchas

- `/geo` is **never cached** (`Cache-Control: no-store`). Don't add edge/KV
  caching here — the response is per-requester by design.
- When `request.cf` is absent or lacks usable coordinates, `/geo` returns nulls
  and `fetchGeo()` resolves to `null` — callers must tolerate a missing location.
- No bindings (no D1/KV/R2) and no secrets are used by anything under `shared/`
  today. Keep it that way unless a genuinely tool-agnostic utility needs them.
