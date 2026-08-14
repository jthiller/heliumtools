# HNT Price API

A small, free, keyless HTTP and WebSocket API for the current price of HNT.

## Overview

Two prices matter for HNT, and they are not the same number:

1. **The market price.** What HNT trades at right now. Use it for display.
2. **The on-chain oracle price.** What the Helium Data Credits program reads when
   it converts burned HNT into Data Credits. Use it to size a transaction.

This service returns both in one payload, on every surface, so you never have to
guess which one you are looking at.

It exists because Pyth's unauthenticated Hermes endpoint
(`hermes.pyth.network`) stops serving public traffic on 2026-08-18. Anything that
was reading HNT prices from Hermes without an API key needs a new source. This
API is that source: it reads the price oracle account directly from the Solana
chain, adds a market quote from Jupiter, caches the result, and hands it out over
plain HTTP or a WebSocket stream.

No API key, no registration, no CORS restrictions.

## Base URL

```
https://api.heliumtools.org/hnt-price
```

Every endpoint needs a trailing path segment. `https://api.heliumtools.org/hnt-price`
on its own does not route and returns a bare 404, so always request one of
`/current`, `/instant`, or `/ws`.

## Endpoints

### `GET /current`

The cheap, everyday endpoint. Serves a cached snapshot, at most 30 seconds old.
In steady state it never reads the chain on your behalf, so it is fast and safe
to poll. The one exception is a cold start (nothing cached yet), where the first
request builds the snapshot live and takes a couple of seconds.

Rate limit: **60 requests per minute per IP**.

```bash
curl "https://api.heliumtools.org/hnt-price/current"
```

If the cached snapshot happens to be older than 30 seconds, you still get it
immediately and a refresh runs in the background, so the next caller gets the
fresh one. This means a `/current` response can be a few seconds past its
nominal 30-second window during quiet periods. Check `snapshot_at` if that
matters to you.

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
- A new snapshot frame **only when the price changes**, checked about every 15
  seconds.

Every frame is a complete snapshot payload as JSON text, identical in shape to
the `/current` response. There are no other frame types, no envelopes, and no
message ids.

```
wss://api.heliumtools.org/hnt-price/ws
```

Two things to know:

- **A quiet socket is a healthy socket.** Frames are sent only on a change, so
  silence means the price has not moved. Do not treat a gap between frames as a
  fault on its own.
- **The server does not send pings.** Reconnect when the socket closes, and
  optionally when you have had no frame for far longer than you would expect
  (several minutes). Intermediate proxies and mobile radios can drop a socket
  without either end noticing.

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

The stream caps out at 500 concurrent subscribers. Past that, the upgrade is
refused with a 503 and you should fall back to polling `/current`.

## Payload schema

Every surface returns the same object.

```json
{
  "symbol": "HNT",
  "spot": {
    "usd": 2.4137,
    "source": "jupiter",
    "updated_at": 1755187200
  },
  "oracle": {
    "usd": 2.41,
    "conf_usd": 0.0021,
    "mint_price_usd": 2.4058,
    "publish_time": 1755186930,
    "account": "He5mhwVQQNvjFxqjEjFDb7enJWFwFJ7Rq7zknqBz89A5"
  },
  "dc_per_hnt": 240580,
  "dc_per_usd": 100000,
  "snapshot_at": 1755187204512
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
| `oracle.usd` | number | The oracle's current price, decoded from the feed account. |
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
- **`oracle.usd`** is the price currently posted to the oracle account on Solana.
  It lags the market by up to one crank interval (~5 minutes).
- **`oracle.mint_price_usd`** is the conservative price the Data Credits program
  computes for a burn: the oracle's exponentially-weighted moving average with
  two confidence intervals subtracted (`ema_price − 2 × ema_conf`). It is
  deliberately lower than the headline price, because the program will not pay
  out DC at the optimistic end of an uncertain quote.

If you are showing a price to a human, use `spot.usd`. If you are telling a user
how much DC a burn will yield, use `mint_price_usd` or the `dc_per_hnt` derived
from it. Using `spot.usd` to preview a burn will over-promise the DC yield.

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
| 503 | `/ws` is at its 500-subscriber ceiling | plain text |

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
- Prefer `/current` for anything that polls, `/ws` for anything live, and
  `/instant` only where you genuinely need a fresh read. The rate limits reflect
  the relative cost of each.
