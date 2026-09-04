import { useCallback, useEffect, useState } from "react";
import { ArrowTopRightOnSquareIcon, PlayIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import StatusBanner from "../components/StatusBanner.jsx";
import { formatTimeAgo, numberFormatter } from "../lib/utils.js";
import { useWebMcpTools } from "../webmcp/useWebMcpTools.js";
import { hntPriceTools } from "./webmcpTools.js";
import {
  PUBLIC_API_BASE,
  PUBLIC_WS_BASE,
  SSE_URL,
  fetchCurrentPrice,
  fetchInstantPrice,
} from "../lib/hntPriceApi.js";

// Living documentation for the public HNT price API. The hero is not a mockup:
// it is an EventSource on the real /sse stream, so whatever this page shows is
// exactly what an integrator gets. worker/src/tools/hnt-price/README.md is the
// canonical reference; every claim here has to stay true to it.

// ─── Formatting ───────────────────────────────────────────────────────────────

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** USD string, or null when the value is absent so callers can placeholder it. */
function fmtUsd(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return null;
  return usdFormat.format(n);
}

/** Self-ticking relative timestamp, so one second of drift does not re-render the page. */
function RelativeTime({ atMs, fallback = "none yet" }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!atMs) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [atMs]);
  if (!atMs) return <span>{fallback}</span>;
  return <span className="tabular-nums">{formatTimeAgo(atMs)}</span>;
}

// ─── Live stream ──────────────────────────────────────────────────────────────

const STREAM_STATES = {
  connecting: { label: "Connecting", dot: "bg-amber-500", pulse: true },
  live: { label: "Live", dot: "bg-emerald-500", pulse: false },
  reconnecting: { label: "Reconnecting", dot: "bg-amber-500", pulse: true },
  offline: { label: "Offline", dot: "bg-rose-500", pulse: false },
};

/**
 * Subscribe to the real /sse stream.
 *
 * Reconnection is entirely native: the server opens with a retry: 3000 hint and
 * EventSource redials on its own, so there is no backoff logic here. The
 * cleanup close() is the part that matters. Every open stream pins the worker's
 * price hub Durable Object in memory, so navigating away has to drop it.
 */
function useHntPriceStream() {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [lastFrameAt, setLastFrameAt] = useState(null);

  useEffect(() => {
    let source;
    try {
      source = new EventSource(SSE_URL);
    } catch {
      setStatus("offline");
      return undefined;
    }

    source.onopen = () => setStatus("live");

    source.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return; // A frame we cannot parse is not a reason to drop the stream.
      }
      setSnapshot(data);
      setLastFrameAt(Date.now());
      setStatus("live");
    };

    source.onerror = () => {
      // CLOSED means EventSource has given up for good. Anything else is its
      // own redial already in flight.
      setStatus(source.readyState === EventSource.CLOSED ? "offline" : "reconnecting");
    };

    return () => source.close();
  }, []);

  return { snapshot, status, lastFrameAt };
}

function StreamPill({ status }) {
  const state = STREAM_STATES[status] || STREAM_STATES.connecting;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-content-secondary">
      <span className={`h-1.5 w-1.5 rounded-full ${state.dot} ${state.pulse ? "animate-pulse" : ""}`} />
      {state.label}
    </span>
  );
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="mb-4">
      {eyebrow && (
        <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          {eyebrow}
        </p>
      )}
      <h2 className="font-display text-[22px] font-semibold tracking-[-0.02em] text-content">
        {title}
      </h2>
      {children && <p className="mt-2 text-[15px] leading-relaxed text-content-secondary">{children}</p>}
    </div>
  );
}

function Card({ className = "", children }) {
  return <section className={`rounded-2xl bg-surface-raised shadow-soft ${className}`}>{children}</section>;
}

function Pill({ children, tone = "default" }) {
  const tones = {
    default: "border-border text-content-secondary",
    accent: "border-accent/30 bg-accent-surface text-accent-text",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Recessed code panel. Recessed surfaces keep their border; raised cards do not. */
function CodeBlock({ code, preClass = "overflow-x-auto" }) {
  return (
    <div className="relative rounded-lg border border-border bg-surface-inset">
      <div className="absolute right-2.5 top-2.5">
        <CopyButton text={code} />
      </div>
      <pre className={`${preClass} px-4 py-3.5 pr-12 font-mono text-[12px] leading-relaxed text-content-secondary`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const BUTTON_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-content transition hover:bg-surface-inset disabled:cursor-not-allowed disabled:opacity-60";

// ─── Live ticker hero ─────────────────────────────────────────────────────────

function TickerStat({ label, value, placeholder = "Unavailable", sub, big = false, divider = false }) {
  return (
    <div className={divider ? "sm:border-l sm:border-border-muted sm:pl-6" : ""}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-content-tertiary">{label}</div>
      <div
        className={`mt-1.5 font-display font-semibold tabular-nums ${
          big ? "text-4xl sm:text-[42px] leading-none" : "text-2xl"
        } ${value ? "text-content" : "text-content-tertiary"}`}
      >
        {value || placeholder}
      </div>
      {sub && <div className="mt-1.5 text-xs leading-relaxed text-content-tertiary">{sub}</div>}
    </div>
  );
}

function LiveTicker({ snapshot, status, lastFrameAt }) {
  // No snapshot yet is "still connecting", not "the source failed". Only once a
  // frame has landed does a null half mean that half was genuinely unavailable.
  const pending = !snapshot;
  const placeholder = pending ? "…" : "Unavailable";
  const waiting = "Waiting for the first frame on the stream.";
  const spot = snapshot?.spot || null;
  const oracle = snapshot?.oracle || null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
        <div className="flex items-center gap-2.5">
          <StreamPill status={status} />
          <span className="text-xs text-content-tertiary">
            Last frame <RelativeTime atMs={lastFrameAt} />
          </span>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-content-tertiary">
          GET /hnt-price/sse
        </span>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-3">
        <TickerStat
          big
          label="Market price"
          value={fmtUsd(spot?.usd)}
          placeholder={placeholder}
          sub={
            pending
              ? waiting
              : spot
                ? "Jupiter aggregate across Solana venues. This is the display price, nothing on-chain reads it."
                : "The market source was unreachable for this snapshot."
          }
        />
        <TickerStat
          divider
          label="DC mint price"
          value={fmtUsd(oracle?.mint_price_usd)}
          placeholder={placeholder}
          sub={
            pending
              ? waiting
              : oracle
                ? (
                  <>
                    What the Data Credits mint pays per HNT burned. Oracle posted{" "}
                    <RelativeTime atMs={oracle.publish_time ? oracle.publish_time * 1000 : null} />.
                  </>
                )
                : "The chain read failed for this snapshot."
          }
        />
        <TickerStat
          divider
          label="DC per HNT"
          value={snapshot?.dc_per_hnt == null ? null : numberFormatter.format(snapshot.dc_per_hnt)}
          placeholder={placeholder}
          sub={
            pending
              ? waiting
              : "Data Credits received for burning 1 HNT, derived from the mint price."
          }
        />
      </div>

      <div className="border-t border-border-muted px-6 py-4 text-xs leading-relaxed text-content-tertiary">
        Streaming live over Server-Sent Events. One snapshot arrives on connect, then a new
        frame when the price changes. Change detection tracks the market price, which moves on
        most checks, so frames land at roughly a 15 second cadence while trading is active. A
        frame does not mean the oracle advanced: that happens about every 5 minutes. The{" "}
        <span className="font-mono text-content-secondary">/ws</span> WebSocket carries identical
        frames on the identical schedule.
      </div>
    </Card>
  );
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

const CURL_CURRENT = `curl "${PUBLIC_API_BASE}/current"`;
const CURL_INSTANT = `curl "${PUBLIC_API_BASE}/instant"`;

const JS_SSE = `const stream = new EventSource("${PUBLIC_API_BASE}/sse");

stream.onmessage = (event) => {
  const snapshot = JSON.parse(event.data);
  // Market price for display.
  console.log("HNT", snapshot.spot?.usd);
  // Conservative price the DC mint pays, and the DC yield per HNT burned.
  console.log("mint", snapshot.oracle?.mint_price_usd, "dc/hnt", snapshot.dc_per_hnt);
};

// Reconnection is native to EventSource and the server opens with a
// retry: 3000 hint, so you write none of it. Call stream.close() when
// you are done: an open stream costs us a resident connection.`;

const JS_WS = `let ws;
let backoff = 1000;

function connect() {
  ws = new WebSocket("${PUBLIC_WS_BASE}/ws");

  ws.onopen = () => {
    backoff = 1000; // reset once a connection actually sticks
  };

  ws.onmessage = (event) => {
    const snapshot = JSON.parse(event.data);
    console.log("HNT", snapshot.spot?.usd, "dc/hnt", snapshot.dc_per_hnt);
  };

  ws.onclose = () => {
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30000);
  };

  ws.onerror = () => ws.close();
}

connect();`;

function TryItPanel({ label, run }) {
  const [state, setState] = useState({ phase: "idle" });

  const onClick = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const data = await run();
      setState({ phase: "done", body: JSON.stringify(data, null, 2) });
    } catch (err) {
      const message = err?.rateLimited
        ? `Rate limited. This endpoint allows a fixed number of requests per minute per IP. Try again in ${err.retryAfterSeconds} seconds.`
        : err?.message || "Request failed.";
      setState({ phase: "error", message });
    }
  }, [run]);

  return (
    <div className="space-y-3">
      <button type="button" onClick={onClick} disabled={state.phase === "loading"} className={BUTTON_CLASS}>
        <PlayIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {state.phase === "loading" ? "Calling…" : label}
      </button>

      {state.phase === "error" && <StatusBanner tone="warning" message={state.message} />}

      {state.phase === "done" && <CodeBlock code={state.body} preClass="max-h-80 overflow-auto" />}
    </div>
  );
}

function EndpointCard({ path, copyUrl, limit, description, snippet, children }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-content-secondary">
            GET
          </span>
          <span className="truncate font-mono text-sm font-medium text-content">/hnt-price{path}</span>
          <CopyButton text={copyUrl || `${PUBLIC_API_BASE}${path}`} />
        </div>
        <Pill>{limit}</Pill>
      </div>

      <p className="text-[15px] leading-relaxed text-content-secondary">{description}</p>

      <CodeBlock code={snippet} />

      {children}
    </Card>
  );
}

// ─── Payload schema ───────────────────────────────────────────────────────────

const SCHEMA_ROWS = [
  ["symbol", "string", 'Always "HNT".'],
  ["spot", "object or null", "Market price. Null if the market source was unreachable for this snapshot."],
  ["spot.usd", "number", "USD per HNT, aggregated across Solana venues."],
  ["spot.source", "string", 'Which market source produced it. Currently always "jupiter".'],
  ["spot.updated_at", "number", "Unix seconds when it was fetched."],
  ["oracle", "object or null", "On-chain price oracle state. Null if the chain read failed for this snapshot."],
  ["oracle.usd", "number", "The oracle's current price, decoded from the feed account."],
  ["oracle.conf_usd", "number", "The oracle's confidence interval, in USD."],
  ["oracle.mint_price_usd", "number", "The price the Data Credits program pays for a burn."],
  [
    "oracle.publish_time",
    "number",
    "Unix seconds the oracle price was posted on-chain. Advances only when a crank posts, roughly every 5 minutes.",
  ],
  [
    "oracle.account",
    "string",
    "Base58 address of the oracle feed account. Resolved from chain, not hardcoded, so it follows governance rotations.",
  ],
  ["dc_per_hnt", "integer or null", "Data Credits received per 1 HNT burned, at the mint price. Null when oracle is null."],
  ["dc_per_usd", "integer", "Always 100000. DC is pegged at 100,000 DC = $1."],
  ["snapshot_at", "number", "Unix milliseconds when the snapshot was assembled. Note the unit differs from the second-based timestamps above."],
];

function SchemaTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-6 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-content-tertiary">
              Field
            </th>
            <th className="px-6 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-content-tertiary">
              Type
            </th>
            <th className="px-6 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-content-tertiary">
              Meaning
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-muted">
          {SCHEMA_ROWS.map(([field, type, meaning]) => (
            <tr key={field}>
              <td className="whitespace-nowrap px-6 py-2.5 font-mono text-[12px] text-content">{field}</td>
              <td className="whitespace-nowrap px-6 py-2.5 text-xs text-content-tertiary">{type}</td>
              <td className="px-6 py-2.5 text-[13px] leading-relaxed text-content-secondary">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Two prices ───────────────────────────────────────────────────────────────

function PriceRow({ field, live, children }) {
  return (
    <div className="px-6 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-medium text-content">{field}</span>
        {live && <span className="font-display text-lg font-semibold tabular-nums text-content">{live}</span>}
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-content-secondary">{children}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HntPriceTool() {
  const { snapshot, status, lastFrameAt } = useHntPriceStream();
  useWebMcpTools(() => hntPriceTools, []);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="HNT Price API" />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-10">
          <p className="mb-2 font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-accent-text">
            Public API · No key required
          </p>
          <h1 className="mb-3 font-display text-4xl sm:text-[44px] font-bold leading-[1.05] tracking-[-0.035em] text-content">
            HNT Price API
          </h1>
          <p className="max-w-2xl text-[15px] leading-relaxed text-content-secondary">
            The current price of HNT over plain HTTP, a WebSocket, or Server-Sent Events. Every
            response carries both numbers that matter: the live market price for display, and the
            on-chain oracle price the Helium Data Credits program reads when it converts burned HNT
            into Data Credits.
          </p>
        </div>

        <div className="space-y-12">
          <LiveTicker snapshot={snapshot} status={status} lastFrameAt={lastFrameAt} />

          {/* Base URL */}
          <section>
            <SectionTitle title="Base URL" />
            <Card className="p-6 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm text-content">{PUBLIC_API_BASE}</span>
                <CopyButton text={PUBLIC_API_BASE} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Pill tone="accent">No API key</Pill>
                <Pill tone="accent">No registration</Pill>
                <Pill tone="accent">CORS open</Pill>
              </div>
              <p className="text-[14px] leading-relaxed text-content-secondary">
                Every request needs a trailing path segment. The bare base URL does not route and
                returns a 404, so always ask for one of{" "}
                <span className="font-mono text-content">/current</span>,{" "}
                <span className="font-mono text-content">/instant</span>,{" "}
                <span className="font-mono text-content">/ws</span>, or{" "}
                <span className="font-mono text-content">/sse</span>.
              </p>
            </Card>
          </section>

          {/* Endpoints */}
          <section>
            <SectionTitle eyebrow="Reference" title="Endpoints">
              Four surfaces over one payload. Poll the cheap one, stream the live one, and reach for
              the expensive one only when you are about to build a transaction.
            </SectionTitle>

            <div className="space-y-5">
              <EndpointCard
                path="/current"
                limit="60 req / min / IP"
                description="The cheap, everyday endpoint. Returns the most recently cached snapshot and kicks off a background refresh when that snapshot is older than 30 seconds, so a stale copy is served immediately while the fresh one is built behind it. Use it for polling, dashboards, and docs pages. Polling once every 15 to 30 seconds is the intended pattern."
                snippet={CURL_CURRENT}
              >
                <TryItPanel label="Try /current" run={fetchCurrentPrice} />
              </EndpointCard>

              <EndpointCard
                path="/instant"
                limit="15 req / min / IP"
                description="The live endpoint. Reads the Solana chain and the market source on every single call, without consulting the cache. Use it when you are sizing a mint_data_credits_v0 transaction and want the oracle state the program will actually see. The oracle account only advances when a crank posts to it, roughly every 5 minutes, so its publish_time can legitimately sit several minutes in the past. The spot half of the same response carries the fresh market quote."
                snippet={CURL_INSTANT}
              >
                <TryItPanel label="Try /instant" run={fetchInstantPrice} />
              </EndpointCard>

              <EndpointCard
                path="/sse"
                limit="500 subscribers, shared with /ws"
                description="The same stream over Server-Sent Events, and the shortest integration on offer. One snapshot arrives on connect, then a new snapshot when the price changes. Change detection tracks the market price, so in practice a frame lands about every 15 seconds while trading is active; de-duplicate on oracle.publish_time if you only care about the on-chain price. Checks that produce nothing send a comment line instead, so something reaches you roughly every 15 seconds for as long as you are connected. A much longer gap means the stream is broken, not that the price is stable. The server opens with a retry: 3000 hint and EventSource reconnects on its own."
                snippet={JS_SSE}
              />

              <EndpointCard
                path="/ws"
                limit="500 subscribers, shared with /sse"
                description={`The same stream over a WebSocket, at ${PUBLIC_WS_BASE}/ws. One snapshot frame on connect, then a frame when the price changes, which in practice is most 15 second checks. There are no pings and no heartbeat frames, so this surface carries no liveness signal of its own: silence is legal, but a socket quiet for many minutes is more likely dead than stable. Reconnect when the socket closes, and optionally after far longer silence than you would expect, since proxies and mobile radios can drop a socket without either end noticing. Use /sse if you want a guaranteed heartbeat.`}
                copyUrl={`${PUBLIC_WS_BASE}/ws`}
                snippet={JS_WS}
              />
            </div>
          </section>

          {/* Two prices */}
          <section>
            <SectionTitle eyebrow="Concepts" title="The two prices">
              Three numbers travel in every payload and they will always differ. Each is correct for
              a different job, and picking the wrong one is the mistake this API exists to prevent.
            </SectionTitle>
            <Card className="divide-y divide-border-muted">
              <PriceRow field="spot.usd" live={fmtUsd(snapshot?.spot?.usd)}>
                The live market, aggregated across Solana venues. It moves continuously and it is
                what a person means by "the price of HNT". Nothing on-chain reads it. Use it for
                display.
              </PriceRow>
              <PriceRow field="oracle.usd" live={fmtUsd(snapshot?.oracle?.usd)}>
                The price currently posted to the oracle account on Solana. A crank posts to that
                account roughly every 5 minutes, so it lags the market by up to one crank interval.
              </PriceRow>
              <PriceRow field="oracle.mint_price_usd" live={fmtUsd(snapshot?.oracle?.mint_price_usd)}>
                The conservative price the Data Credits program computes for a burn: the oracle's
                exponentially-weighted moving average with two confidence intervals subtracted. It
                sits deliberately below the headline price, because the program will not pay out DC
                at the optimistic end of an uncertain quote. Use it, or the{" "}
                <span className="font-mono text-content">dc_per_hnt</span> derived from it, whenever
                you tell someone how much DC a burn will yield.
              </PriceRow>
              <div className="px-6 py-4 text-[14px] leading-relaxed text-content-secondary">
                <span className="font-mono text-content">dc_per_usd</span> is always exactly 100,000,
                because DC is pegged at 100,000 DC to the dollar.{" "}
                <span className="font-mono text-content">dc_per_hnt</span> is the mint price times
                that peg, rounded, provided so you do not have to re-derive it. Showing a burn
                preview from <span className="font-mono text-content">spot.usd</span> will
                over-promise the DC yield.
              </div>
            </Card>
          </section>

          {/* Payload schema */}
          <section>
            <SectionTitle eyebrow="Reference" title="Payload schema">
              Every surface returns the same object. Both{" "}
              <span className="font-mono text-content">spot</span> and{" "}
              <span className="font-mono text-content">oracle</span> are nullable and are fetched
              independently, so a response with one of them null is a real 200 and not an error.
              Null-check both before reading into them.
            </SectionTitle>
            <Card className="overflow-hidden py-1">
              <SchemaTable />
            </Card>
            <p className="mt-3 text-[13px] leading-relaxed text-content-tertiary">
              Timestamp units are mixed on purpose to match their sources.{" "}
              <span className="font-mono">spot.updated_at</span> and{" "}
              <span className="font-mono">oracle.publish_time</span> are Unix seconds, while{" "}
              <span className="font-mono">snapshot_at</span> is Unix milliseconds.
            </p>
          </section>

          {/* Footer pointers */}
          <section>
            <SectionTitle title="Full reference" />
            <Card className="p-6 space-y-4">
              <p className="text-[15px] leading-relaxed text-content-secondary">
                This page is the tour. The README next to the worker code is the canonical reference,
                with the complete error table, rate-limit semantics, snapshot freshness guarantees,
                and integrator notes.
              </p>
              <a
                href="https://github.com/jthiller/heliumtools/blob/main/worker/src/tools/hnt-price/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:opacity-80"
              >
                Read the full API reference on GitHub
                <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
              </a>
              <p className="text-[14px] leading-relaxed text-content-secondary">
                No API key. No registration. CORS is open, so a browser can call it directly. The
                oracle feed account is resolved from the Data Credits program's own configuration on
                every chain read rather than hardcoded, which means this API follows governance
                rotations automatically. Do not hardcode it on your side either.
              </p>
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}
