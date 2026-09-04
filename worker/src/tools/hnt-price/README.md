# HNT Price API

A small, free, keyless API for the current price of HNT, over plain HTTP, a
WebSocket, or Server-Sent Events.

There is an interactive version of this page, with a live ticker running on the
stream described below, at <https://heliumtools.org/hnt-price>.

## Overview

Two prices matter for HNT, and they are not the same number:

1. **The market price**, `spot.usd`. What HNT trades at right now. Use it for
   display.
2. **The price a burn actually pays**, `oracle.mint_price_usd`. What the Helium
   Data Credits program computes when it converts burned HNT into Data Credits.
   Use it to size a transaction, or read the `dc_per_hnt` we derive from it.

This service returns both in one payload, on every surface, so you never have to
guess which one you are looking at.

> **Building a Data Credits calculator?** Read **`dc_per_hnt`**. That is the
> whole integration: it is the DC a user receives for burning one HNT, already
> computed at the conservative price the program pays. Do not derive DC from
> `spot.usd`, and do not derive it from `oracle.usd` either. Both sit above what
> a burn yields, so both over-promise DC. See
> [the three prices](#spotusd-vs-oracleusd-vs-oraclemint_price_usd).

It exists because Pyth's unauthenticated Hermes endpoint
(`hermes.pyth.network`) stopped serving public traffic on 2026-08-18. Anything
that was reading HNT prices from Hermes without an API key needed a new source.
This API is that source: it reads the price oracle account directly from the
Solana chain, adds a market quote from Jupiter, caches the result, and hands it
out over a plain HTTP request or a live stream.

No API key, no registration, no CORS restrictions.

## Base URL

```
https://api.heliumtools.org/hnt-price
```

Every endpoint needs a trailing path segment. `https://api.heliumtools.org/hnt-price`
on its own does not route and returns a bare 404, so always request one of
`/current`, `/instant`, `/ws`, or `/sse`.

## Endpoints

### `GET /current`

The cheap, everyday endpoint. Returns the most recently cached snapshot and
triggers a background refresh when that snapshot is older than 30 seconds.
In steady state it never reads the chain on your behalf, so it is fast and safe
to poll. The one exception is a cold start (nothing cached yet), where the first
request builds the snapshot live and takes a couple of seconds.

Rate limit: **60 requests per minute per IP**.

```bash
curl "https://api.heliumtools.org/hnt-price/current"
```

A stale snapshot is served immediately while the refresh runs behind it, so it
is the caller *after* you who gets the fresh one. Under steady traffic (or with
anyone on `/ws` or `/sse`, which refresh the shared cache every 15 seconds)
responses stay within roughly 30 seconds of live. After a quiet stretch, though, the
first response can be older — the floor is a background cron that rebuilds the
snapshot every 15 minutes, so that is the worst-case age. `snapshot_at` tells
you exactly how old what you received is; check it if freshness matters, or use
`/instant`.

Polling `/current` once every 15 to 30 seconds is the intended usage pattern for
a dashboard or a docs page. If you want lower latency than that, use `/ws`.

### `GET /instant`

The live endpoint. Reads the Solana chain and Jupiter on every single call and
returns the result without consulting the cache first.

Rate limit: **15 requests per minute per IP**.

```bash
curl "https://api.heliumtools.org/hnt-price/instant"
```

Use it for a one-off price display, and use it when you are about to build a
`mint_data_credits_v0` transaction and want the oracle state the program will
actually see.

**What "instant" does and does not mean.** The call reads the oracle account
right now, but the oracle account is only as fresh as the last time a crank
posted to it, which is roughly every 5 minutes. So `oracle` in an `/instant`
response can legitimately carry a `publish_time` several minutes in the past.
That is not staleness on our side; it is the exact account state
`mint_data_credits_v0` reads, which is what you want when sizing a burn. The
`spot` block in the same response carries the fresh market price.

An `/instant` call also refreshes the shared cache, so calling it warms
`/current` for everyone.

### `GET /ws`

A WebSocket stream. Connect and you receive:

- One snapshot frame immediately on connect, so you have a price without waiting.
- A new snapshot frame when the price changes, checked about every 15 seconds.

Every frame is a complete snapshot payload as JSON text, identical in shape to
the `/current` response. There are no other frame types, no envelopes, and no
message ids.

**What "changes" means in practice.** Change detection keys on the market price
together with the oracle's `publish_time`. The market price is a continuously
moving float, so while trading is active almost every 15-second check produces a
frame. Expect a roughly 15-second cadence rather than rare bursts, and do not
read the arrival of a frame as "the oracle moved" — the oracle advances only
every ~5 minutes, so consecutive frames often carry a byte-identical `oracle`
block. If you only care about the on-chain price, de-duplicate on
`oracle.publish_time`.

```
wss://api.heliumtools.org/hnt-price/ws
```

Two things to know:

- **Silence is legal but uncommon.** Nothing is sent when the price has not
  moved, so a gap is not a fault by itself. In practice, though, the market price
  moves on most checks, so a socket that has been silent for many minutes is more
  likely dead than stable.
- **The server does not send pings.** This surface has no liveness signal of its
  own: reconnect when the socket closes, and optionally after silence far longer
  than you would expect. Intermediate proxies and mobile radios can drop a socket
  without either end noticing. If you want a guaranteed heartbeat, use `/sse`,
  which sends a comment frame on any check that produced no data.

Browser example with reconnect and backoff:

```js
let ws;
let backoff = 1000;

function connect() {
  ws = new WebSocket("wss://api.heliumtools.org/hnt-price/ws");

  ws.onopen = () => {
    backoff = 1000; // reset once a connection actually sticks
  };

  ws.onmessage = (event) => {
    const snapshot = JSON.parse(event.data);
    // Market price for display.
    console.log("HNT", snapshot.spot?.usd);
    // Conservative price the DC mint pays, and the DC yield per HNT burned.
    console.log("mint price", snapshot.oracle?.mint_price_usd, "dc/hnt", snapshot.dc_per_hnt);
  };

  ws.onclose = () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };

  ws.onerror = () => ws.close();
}

connect();
```

The stream caps out at 500 concurrent subscribers, a ceiling it shares with
`/sse`. Past that, the upgrade is refused with a 503 and you should fall back to
polling `/current`.

### `GET /sse`

The same stream over Server-Sent Events. This is the shortest integration on
offer: `EventSource` is built into every browser, and it reconnects on its own.

```js
new EventSource("https://api.heliumtools.org/hnt-price/sse").onmessage = (e) => {
  const snapshot = JSON.parse(e.data);
  console.log("HNT", snapshot.spot?.usd, "dc/hnt", snapshot.dc_per_hnt);
};
```

Every message is a complete snapshot payload as JSON, identical in shape to the
`/current` response. There are no named event types, so `onmessage` receives all
of them.

What arrives on the stream:

- One snapshot immediately on connect, so you have a price without waiting.
- A new snapshot when the price changes, checked about every 15 seconds. As on
  `/ws`, change detection keys on the market price, which moves on most checks,
  so expect a frame at roughly that cadence while trading is active. A frame does
  not mean the oracle advanced; de-duplicate on `oracle.publish_time` if that is
  all you care about.
- A comment line (`: ping`) on any 15-second check that produced no snapshot.
  `EventSource` discards comments, so you never see it in your handler. Between
  the two, something reaches you roughly every 15 seconds for as long as you are
  connected. That is what keeps proxies and mobile networks from culling a stream
  that has gone quiet. A gap much longer than that means the stream is broken,
  not that the price is stable.
- A `retry: 3000` hint on connect. Reconnection is native to `EventSource`, and
  that hint just tells it how long to wait. You write none of it yourself.

The 500-subscriber ceiling is **shared with `/ws`**. Both surfaces are fed by the
same instance and counted together. Past the ceiling the request is refused with
a 503, and you should fall back to polling `/current`.

## Payload schema

Every surface returns the same object.

```json
{
  "symbol": "HNT",
  "spot": {
    "usd": 0.6057272,
    "source": "jupiter",
    "updated_at": 1788544200
  },
  "oracle": {
    "usd": 0.6049048,
    "conf_usd": 0.0005952,
    "mint_price_usd": 0.6045032,
    "publish_time": 1788543930,
    "account": "He5mhwVQQNvjFxqjEjFDb7enJWFwFJ7Rq7zknqBz89A5"
  },
  "dc_per_hnt": 60450,
  "dc_per_usd": 100000,
  "snapshot_at": 1788544204512
}
```

| Field | Type | Meaning |
|---|---|---|
| `symbol` | string | Always `"HNT"`. |
| `spot` | object or null | Market price. `null` if the market source was unreachable for this snapshot. |
| `spot.usd` | number | USD per HNT, aggregated across Solana venues. |
| `spot.source` | string | Which market source produced it. Currently always `"jupiter"`. |
| `spot.updated_at` | number | Unix seconds when we fetched it. |
| `oracle` | object or null | On-chain price oracle state. `null` if the chain read failed for this snapshot. |
| `oracle.usd` | number | The oracle's headline posted price, decoded from the feed account. Not what a burn pays: use `mint_price_usd` or `dc_per_hnt` for that. |
| `oracle.conf_usd` | number | The oracle's confidence interval, in USD. |
| `oracle.mint_price_usd` | number | **The price the Data Credits program pays.** See below. |
| `oracle.publish_time` | number | Unix seconds the oracle price was posted on-chain. Advances only when a crank posts, roughly every 5 minutes. |
| `oracle.account` | string | Base58 address of the oracle feed account we read. Resolved from chain, not hardcoded, so it follows governance rotations. |
| `dc_per_hnt` | integer or null | Data Credits you receive per 1 HNT burned, at `mint_price_usd`. `null` when `oracle` is null. |
| `dc_per_usd` | integer | Always `100000`. DC is pegged at 100,000 DC = $1. |
| `snapshot_at` | number | Unix **milliseconds** when this snapshot was assembled. Note the unit differs from the second-based timestamps above. |

### `spot.usd` vs `oracle.usd` vs `oracle.mint_price_usd`

These three numbers will differ, always, and each is correct for a different job.

- **`spot.usd`** is the live market. It moves continuously. It is what a person
  means by "the price of HNT". Nothing on-chain reads it.
- **`oracle.usd`** is the headline price currently posted to the oracle account
  on Solana. It lags the market by up to one crank interval (~5 minutes). **It is
  not what a burn pays.** It is the posted `price` field, not the moving average
  the program actually computes with, so sizing a burn from it over-promises DC
  by `(price − ema_price) + 2 × ema_conf`. That gap is small but not stable: in
  live sampling across a single 5-minute crank it ranged from 0.07% to 0.55%,
  because most of it is EMA lag that widens whenever the market moves.
- **`oracle.mint_price_usd`** is the conservative price the Data Credits program
  computes for a burn: the oracle's exponentially-weighted moving average with
  two confidence intervals subtracted (`ema_price − 2 × ema_conf`). It is
  deliberately lower than the headline price, because the program will not pay
  out DC at the optimistic end of an uncertain quote.

If you are showing a price to a human, use `spot.usd`. If you are telling a user
how much DC a burn will yield, use `dc_per_hnt`, or `mint_price_usd` if you need
the price itself. Previewing a burn from either `spot.usd` or `oracle.usd`
over-promises the yield, and always in the direction of promising more DC than
the user will receive.

A fully honest display shows both: `spot.usd` labelled as the market price, and
`mint_price_usd` or `dc_per_hnt` labelled as what the burn pays. That is what the
[interactive page](https://heliumtools.org/hnt-price) does.

### `dc_per_hnt` and `dc_per_usd`

DC is pegged: `dc_per_usd` is always exactly 100,000, meaning 100,000 DC costs $1.
`dc_per_hnt` is just `round(mint_price_usd × 100000)`, provided so callers do not
have to re-derive it. It is the DC you get for burning one whole HNT, at the
conservative program price.

### Partial snapshots

`spot` and `oracle` are fetched independently, and a snapshot is published if
**either** succeeds. A response with one of them `null` is a real, usable
response, not an error, and you will get a 200. Always null-check both blocks
before reading into them. Only a total failure of both sources produces an error
status.

## Errors

Errors are JSON with an `error` string.

| Status | When | Body |
|---|---|---|
| 429 | Over the per-IP rate limit | `{ "error": "Too many requests. Please try again later.", "rateLimited": true, "retryAfterSeconds": 60 }` |
| 404 | Unknown path under `/hnt-price/` | `{ "error": "Not found" }` |
| 500 | `/current` had nothing cached and could not build a snapshot | `{"error": "HNT price temporarily unavailable"}` |
| 502 | `/instant` could reach neither the chain nor the market source | `{"error": "HNT price temporarily unavailable"}` |
| 503 | `/ws` and `/sse` are at their shared 500-subscriber ceiling | plain text |

On a 429, back off for `retryAfterSeconds` before retrying. The limit is a
fixed-window counter per IP per endpoint, so `/current` and `/instant` have
separate budgets.

## Notes for integrators

- The oracle feed account is **never hardcoded** in this service. It is read from
  the Data Credits program's own configuration account on every chain read, so
  when Helium governance rotates the oracle, this API follows automatically and
  `oracle.account` in the payload changes to match. Do not hardcode it on your
  side either.
- Timestamp units are mixed on purpose to match their sources: `spot.updated_at`
  and `oracle.publish_time` are Unix **seconds**, `snapshot_at` is Unix
  **milliseconds**.
- Prefer `/current` for anything that polls, a stream for anything live, and
  `/instant` only where you genuinely need a fresh read. The rate limits reflect
  the relative cost of each.
- Between the two streams, `/sse` is the lowest-effort integration. It is one
  line, and reconnection is handled for you. `/ws` is the leaner of the two on
  our side, and it is the better pick if you already have a WebSocket client or
  want to control reconnect behavior yourself. Both carry the identical payload
  on the identical schedule, so the choice is purely about your side.
