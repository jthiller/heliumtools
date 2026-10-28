import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import CopyButton from "../components/CopyButton.jsx";
import useDarkMode from "../lib/useDarkMode.js";
import { readChartColors } from "../lib/chartColors.js";
import { PatternSheet, Swatch } from "./patterns.jsx";
import {
  NOT_TRACED_REASON, accountUrl, daysBetween, destinationText, fateColor, outflowFate, fmtDateTime, fmtDay, fmtDays,
  fmtHnt, fmtShortDay, fmtSwapOut, seatTitle, shortAddress, toHnt, txUrl,
} from "./format.js";

function ExtLink({ href, children, className = "" }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 hover:text-accent-text ${className}`}>
      {children}
      <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">, opens in a new tab</span>
    </a>
  );
}

function fateText(f) {
  const org = f.label?.org || f.nodeLabel?.org || f.label?.name || "an exchange";
  switch (f.kind) {
    case "held": return "Still in the seat's wallet";
    case "held_by_seat": return `Moved to another council seat (${shortAddress(f.node)})`;
    case "held_downstream": return `Held in ${f.nodeLabel?.name || "another wallet"} (${shortAddress(f.node)})`;
    case "vehnt": return "Locked in veHNT";
    case "swapped": return `Swapped${f.venue && f.venue !== "Swap" ? ` on ${f.venue}` : ""}`;
    case "exchange": return f.unswept ? `At a ${org} deposit address (no sweep seen yet)` : `Sent to ${org}`;
    case "dc_burn": return "Burned for Data Credits";
    case "program_other": return "Moved into a program";
    case "following": return `Still being traced (${shortAddress(f.node)})`;
    case "not_traced": return `Not traced further: ${NOT_TRACED_REASON[f.reason] || "the trace stopped here"}`;
    default: return f.kind;
  }
}

function hopName(h) {
  return h.label?.name || shortAddress(h.to) || "Burned";
}

const SETTLED = new Set(["swapped", "exchange", "vehnt", "dc_burn", "program_other", "not_traced"]);

const TX_LABEL = { swapped: "Swap tx", dc_burn: "Burn tx", vehnt: "Lock tx", program_other: "Transaction" };

// Opens a transaction on Solscan in a new tab.
function TxLink({ sig, children, className = "" }) {
  return (
    <a href={txUrl(sig)} target="_blank" rel="noopener noreferrer" className={`underline decoration-dotted underline-offset-2 hover:text-accent-text ${className}`}>
      {children}
      <span className="sr-only"> (transaction, opens in a new tab)</span>
    </a>
  );
}

function FateLine({ fate, lot, outflowsBySig, split, dark }) {
  const swap = fate.kind === "swapped" ? outflowsBySig.get(fate.sig) : null;
  const left = fate.leftAt && fate.kind !== "held";
  // The link goes where the text points: a settled fate (swapped, sent to an
  // exchange, locked, burned, stopped) links the transaction that settled it;
  // HNT still sitting somewhere links the move that took it out of the seat.
  // The path below links every hop.
  const settled = SETTLED.has(fate.kind) && !fate.unswept;
  const linkSig = fate.kind === "held" ? null : settled ? fate.sig ?? fate.path[0]?.sig : fate.path[0]?.sig ?? fate.sig;
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5"><Swatch kind={fate.kind} dark={dark} size={11} /></span>
      <div className="min-w-0">
        <p className="text-content">
          {split && <span className="font-mono tabular-nums">{fmtHnt(fate.amount, { unit: false })}: </span>}
          {linkSig ? <TxLink sig={linkSig}>{fateText(fate)}</TxLink> : fateText(fate)}
          {left && <span className="text-content-tertiary">, {fmtDay(fate.leftAt)} ({fmtDays(daysBetween(lot.t, fate.leftAt))})</span>}
        </p>
        {swap?.swapOut?.length > 0 && (
          <p className="text-content-tertiary">
            Part of a <TxLink sig={swap.sig}>{fmtHnt(swap.amount)} swap</TxLink> for {swap.swapOut.map(fmtSwapOut).join(" + ")}
          </p>
        )}
        {fate.path.length > 1 && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-content-tertiary">
            <span>Seat</span>
            {fate.path.map((h) => (
              <span key={h.sig} className="inline-flex items-center gap-1">
                <span aria-hidden="true">→</span>
                <TxLink sig={h.sig}>{hopName(h)}</TxLink>
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function SeatChart({ detail, dark }) {
  const colors = useMemo(() => readChartColors(), [dark]);
  const data = useMemo(() => {
    const events = [];
    for (const lot of detail.lots) {
      events.push({ t: lot.t, emitted: toHnt(lot.amount), held: toHnt(lot.amount) });
      for (const f of lot.fates) if (f.kind !== "held" && f.leftAt) events.push({ t: f.leftAt, emitted: 0, held: -toHnt(f.amount) });
    }
    events.sort((a, b) => a.t - b.t);
    const out = [];
    let emitted = 0;
    let held = 0;
    for (const e of events) {
      emitted += e.emitted;
      held += e.held;
      // Float sums of many lots can land a hair under zero; held never goes negative.
      const point = { t: e.t, emitted, held: Math.max(0, held) };
      const last = out[out.length - 1];
      if (last && last.t === e.t) Object.assign(last, point);
      else out.push(point);
    }
    if (out.length) out.push({ ...out[out.length - 1], t: Math.floor(Date.now() / 1000) });
    return out;
  }, [detail]);
  if (data.length < 2) return null;
  const heldColor = fateColor("held", dark);
  return (
    <div className="h-56 w-full" role="img" aria-label="Cumulative HNT emitted to this seat and the part still held by it, over time">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colors?.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={fmtShortDay} tick={{ fill: colors?.tickText, fontSize: 11 }} stroke={colors?.grid} minTickGap={40} />
          <YAxis domain={[0, "auto"]} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} tick={{ fill: colors?.tickText, fontSize: 11 }} stroke={colors?.grid} width={44} />
          <RechartsTooltip
            labelFormatter={(t) => fmtDateTime(t)}
            formatter={(v, name) => [`${Math.round(v).toLocaleString("en-US")} HNT`, name === "emitted" ? "Emitted to the seat" : "Still held by the seat"]}
            contentStyle={{ background: colors?.tooltipBg, border: `1px solid ${colors?.tooltipBorder}`, borderRadius: 12, fontSize: 12 }}
            labelStyle={{ color: colors?.tooltipText }}
          />
          <Line type="stepAfter" dataKey="emitted" stroke={colors?.stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="held" stroke={heldColor} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const INFLOW_LABEL = {
  vehnt_rewards: "veHNT delegation rewards",
  vehnt_unlock: "Released from veHNT",
  bought: "Bought in a swap",
  helium_ops: "From a Helium operations wallet",
  received: "Received from another wallet",
};

/** One seat: every emission with where it went, every outflow, other HNT received. */
function SeatDetail({ detail, focusLot, focusTx, onBack }) {
  const dark = useDarkMode();
  const seat = detail.seat;
  const [filter, setFilter] = useState("all");
  // First outflow per tx (a swap is one outflow; repeats in one tx share the swap output).
  const outflowsBySig = useMemo(() => {
    const m = new Map();
    for (const o of detail.outflows) if (!m.has(o.sig)) m.set(o.sig, o);
    return m;
  }, [detail]);
  const lotDates = useMemo(() => new Map(detail.lots.map((l) => [l.sig, l.t])), [detail]);
  const lots = useMemo(() => {
    const all = [...detail.lots].reverse();
    return filter === "left" ? all.filter((l) => l.fates.some((f) => f.kind !== "held")) : all;
  }, [detail, filter]);
  const focusRef = useRef(null);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLot, focusTx]);

  // veHNT reward claims arrive in bursts; fold them per UTC day.
  const otherInflows = useMemo(() => {
    const byKey = new Map();
    for (const i of detail.otherInflows) {
      const day = Math.floor(i.t / 86_400);
      const key = i.kind === "vehnt_rewards" ? `${i.kind}:${day}` : i.sig;
      const cur = byKey.get(key);
      if (cur) {
        cur.amount = (BigInt(cur.amount) + BigInt(i.amount)).toString();
        cur.count += 1;
      } else byKey.set(key, { ...i, count: 1 });
    }
    return [...byKey.values()].sort((a, b) => b.t - a.t);
  }, [detail]);

  const left = BigInt(seat.left);
  return (
    <div className="space-y-6">
      <PatternSheet dark={dark} />
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-content-secondary hover:text-content">
        <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
        All seats
      </button>

      <section className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-content">{seatTitle(seat)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-content-secondary">
              <span className="break-all font-mono text-xs">{seat.wallet}</span>
              <CopyButton text={seat.wallet} label="Copy wallet address" />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
              <ExtLink href={accountUrl(seat.wallet)}>Solscan</ExtLink>
              <Link to={`/wallet-dashboard/${seat.wallet}`} className="hover:text-accent-text">Open in Wallet Dashboard</Link>
              {seat.nameSource && <ExtLink href={seat.nameSource}>Source for this name</ExtLink>}
            </div>
          </div>
        </div>

        {seat.label?.custodial && (
          <p className="mt-4 rounded-xl bg-surface-inset px-4 py-3 text-sm text-content-secondary">
            This seat's receiving address is a {seat.label.org || "exchange"} deposit address. Each emission lands on the exchange, and the exchange sweeps it into its own wallets.
          </p>
        )}

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs text-content-tertiary">Emitted to this seat</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums text-content">{fmtHnt(seat.received)}</dd>
            <dd className="text-xs text-content-tertiary">{seat.lots} emissions</dd>
          </div>
          <div>
            <dt className="text-xs text-content-tertiary">Still held by the seat</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums text-content">{fmtHnt(seat.byKind.held || "0")}</dd>
          </div>
          <div>
            <dt className="text-xs text-content-tertiary">Left the wallet</dt>
            <dd className="mt-1 font-mono text-lg tabular-nums text-content">{fmtHnt(seat.left)}</dd>
            <dd className="text-xs text-content-tertiary">{seat.outflows} outgoing {seat.outflows === 1 ? "transfer" : "transfers"}</dd>
          </div>
          <div>
            <dt className="text-xs text-content-tertiary">First moved out</dt>
            <dd className="mt-1 text-sm text-content">{seat.firstOutflowAt ? fmtDay(seat.firstOutflowAt) : "Never"}</dd>
          </div>
        </dl>
        {BigInt(seat.priorRaw) > 0n && (
          <p className="mt-4 text-xs text-content-tertiary">
            This wallet held {fmtHnt(seat.priorRaw)} before the first emission. That HNT isn't an emission. Oldest HNT counts as leaving first, so it leaves before any emission does.
          </p>
        )}
        <div className="mt-5">
          <SeatChart detail={detail} dark={dark} />
          <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-content-tertiary">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-4 bg-accent-text" aria-hidden="true" />Emitted to the seat</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: fateColor("held", dark) }} aria-hidden="true" />Still held by the seat</span>
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-content">Every emission and where it went</h3>
          {left > 0n && (
            <div className="inline-flex rounded-lg border border-border p-0.5 text-xs" role="group" aria-label="Filter emissions">
              {[["all", "All emissions"], ["left", "Only ones that left"]].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                  className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-surface-inset text-content" : "text-content-tertiary hover:text-content"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-content-tertiary">Newest first. Dates are UTC. Each emission's HNT is followed until it is swapped, locked, burned or reaches an exchange.</p>
        <ol className="mt-4 divide-y divide-border">
          {lots.map((lot) => {
            const focused = lot.sig === focusLot;
            const split = lot.fates.length > 1;
            return (
              <li key={lot.sig} ref={focused ? focusRef : undefined} className={`grid grid-cols-1 gap-2 py-3 text-sm sm:grid-cols-[9rem_7rem_1fr] ${focused ? "-mx-3 rounded-xl bg-accent-surface px-3" : ""}`}>
                <div>
                  <p className="text-content">{fmtDay(lot.t)}</p>
                  <p className="flex gap-3 text-xs text-content-tertiary">
                    <TxLink sig={lot.sig}>Emission tx</TxLink>
                    <Link to={`/council-emissions?seat=${seat.wallet}&lot=${lot.sig}`} className="hover:text-accent-text">Link here</Link>
                  </p>
                </div>
                <div>
                  <p className="font-mono tabular-nums text-content">{fmtHnt(lot.amount)}</p>
                  {lot.epochs.length > 1 && <p className="text-xs text-content-tertiary">{lot.epochs.length} days of mints</p>}
                </div>
                <div className="space-y-1.5 text-xs">
                  {lot.fates.map((f, i) => (
                    <FateLine key={`${f.kind}-${f.sig}-${i}`} fate={f} lot={lot} outflowsBySig={outflowsBySig} split={split} dark={dark} />
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {detail.outflows.length > 0 && (
        <section className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
          <h3 className="font-display text-lg font-semibold text-content">HNT sent out of this wallet</h3>
          <p className="mt-1 text-xs text-content-tertiary">Each transfer carries the oldest HNT first, so it lists the emissions it used up.</p>
          <ol className="mt-4 divide-y divide-border">
            {detail.outflows.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => {
              const focused = o.sig === focusTx;
              const dates = o.lots.map((l) => lotDates.get(l.sig)).filter(Boolean).sort((a, b) => a - b);
              return (
                <li key={`${o.sig}:${i}`} ref={focused ? focusRef : undefined} className={`grid grid-cols-1 gap-2 py-3 text-sm sm:grid-cols-[11rem_8rem_1fr] ${focused ? "-mx-3 rounded-xl bg-accent-surface px-3" : ""}`}>
                  <div>
                    <p className="text-content">{fmtDateTime(o.t)}</p>
                    <p className="flex gap-3 text-xs text-content-tertiary">
                      <TxLink sig={o.sig}>{TX_LABEL[o.kind] ?? "Transfer tx"}</TxLink>
                      <Link to={`/council-emissions?seat=${seat.wallet}&tx=${o.sig}`} className="hover:text-accent-text">Link here</Link>
                    </p>
                  </div>
                  <p className="font-mono tabular-nums text-content">{fmtHnt(o.amount)}</p>
                  <div className="text-xs">
                    <p className="flex items-center gap-2 text-content">
                      <Swatch kind={outflowFate(o.kind)} dark={dark} size={11} />
                      {destinationText(o)}
                      {o.to && <a href={accountUrl(o.to)} target="_blank" rel="noopener noreferrer" className="font-mono text-content-tertiary hover:text-accent-text">{shortAddress(o.to)}<span className="sr-only"> (opens in a new tab)</span></a>}
                    </p>
                    <p className="mt-0.5 text-content-tertiary">
                      {o.lots.length
                        ? `Carried ${o.lots.length} ${o.lots.length === 1 ? "emission" : "emissions"}${dates.length ? `, received ${fmtShortDay(dates[0])}${dates.length > 1 ? ` to ${fmtShortDay(dates[dates.length - 1])}` : ""}` : ""}`
                        : "Carried no council emissions"}
                      {BigInt(o.priorAmount) > 0n && `, plus ${fmtHnt(o.priorAmount)} held before emissions began`}
                      {BigInt(o.otherAmount) > 0n && `, plus ${fmtHnt(o.otherAmount)} from other sources`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {otherInflows.length > 0 && (
        <details className="rounded-2xl bg-surface-raised p-5 shadow-soft sm:p-6">
          <summary className="cursor-pointer font-display text-lg font-semibold text-content">Other HNT this wallet received</summary>
          <p className="mt-1 text-xs text-content-tertiary">Not council emissions. Counted in the wallet's balance, never as an emission.</p>
          <ul className="mt-3 divide-y divide-border text-xs">
            {otherInflows.map((i) => (
              <li key={`${i.kind}-${i.sig}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-content-secondary">
                  {fmtDay(i.t)} · {INFLOW_LABEL[i.kind] || i.kind}
                  {i.count > 1 ? ` (${i.count} claims)` : ""}
                </span>
                <span className="font-mono tabular-nums text-content">{fmtHnt(i.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default memo(SeatDetail);
