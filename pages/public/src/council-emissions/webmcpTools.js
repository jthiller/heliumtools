import { fetchCouncilRuns, fetchCouncilSeat, fetchCouncilSummary } from "../lib/councilEmissionsApi.js";
import { BASE58_PATTERN, SOLANA_ADDRESS_SCHEMA, capListField } from "../webmcp/helpers.js";

const SEAT_SCHEMA = {
  ...SOLANA_ADDRESS_SCHEMA,
  description: "A council seat's wallet (Solana base58), as listed by get-council-emissions.",
};

const SIG_SCHEMA = { type: "string", pattern: BASE58_PATTERN, minLength: 64, maxLength: 90 };

// Amounts arrive as base-unit strings (HNT has 8 decimals); agents get HNT numbers.
const hnt = (raw) => (raw == null ? null : Number(raw) / 1e8);
const iso = (t) => (t == null ? null : new Date(t * 1000).toISOString());
const hntMap = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, hnt(v)]));

function seatRow(s) {
  return {
    seat: s.seat,
    wallet: s.wallet,
    name: s.name,
    nameSource: s.nameSource,
    custodialExchangeAddress: !!s.label?.custodial,
    emissions: s.lots,
    receivedHnt: hnt(s.received),
    stillHeldHnt: hnt(s.byKind?.held ?? "0"),
    leftWalletHnt: hnt(s.left),
    byFateHnt: hntMap(s.byKind),
    outgoingTransfers: s.outflows,
    firstOutflowAt: iso(s.firstOutflowAt),
    heldBeforeEmissionsHnt: hnt(s.priorRaw),
    balanceMatchesChain: s.reconciled,
  };
}

/**
 * WebMCP tools for /council-emissions. All reads come from the worker's
 * cron-built snapshot, so agent traffic adds no RPC load. `navigate` drives
 * the page the user is looking at.
 */
export function makeCouncilEmissionsTools(navigate) {
  return [
    {
      name: "get-council-emissions",
      title: "Get HIP-149 council emissions",
      description:
        "HIP-149 Advisory Council emissions: HNT minted to the council mini-fanout, distributed to each of the five seat wallets, still waiting, and where each seat's HNT went (still held, swapped, sent to an exchange, locked in veHNT, burned for Data Credits, held in another wallet, not traced further). Fates use FIFO: a wallet's oldest HNT is counted as leaving first. Seat names appear only when a public source ties a wallet to a member. Set includeTimeline for every emission and outgoing transfer per seat.",
      inputSchema: {
        type: "object",
        properties: {
          includeTimeline: { type: "boolean", default: false, description: "Include each seat's emissions (date, amount, fate mix) and outgoing transfers, newest first." },
          timelineLimit: { type: "integer", minimum: 1, maximum: 400, default: 100, description: "Most recent emissions and transfers to return per seat when includeTimeline is set." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ includeTimeline, timelineLimit }, { signal } = {}) {
        const s = await fetchCouncilSummary({ signal });
        if (s?.warming) return { warming: true, message: s.message };
        const t = s.totals;
        const result = {
          updatedAt: new Date(s.builtAt).toISOString(),
          indexedThrough: iso(s.indexedThrough?.t),
          historyComplete: s.backfill?.done ?? false,
          fanout: { address: s.fanout.pda, tokenAccount: s.fanout.tokenAccount, schedule: s.fanout.schedule, exists: s.fanout.exists, seats: t.seats },
          totals: {
            mintedHnt: hnt(t.minted), epochs: t.epochs, emittedHnt: hnt(t.emitted), waitingHnt: hnt(t.waiting),
            perSeatPerDayHnt: hnt(t.perSeatPerDay), distributionRuns: t.runs, runsWithHnt: t.distributedRuns, emptyRuns: t.emptyRuns,
            failedAttempts: t.failedAttempts, lastEmissionAt: iso(t.lastEmissionAt),
          },
          seats: s.seats.map(seatRow),
          drift: s.drift,
        };
        if (includeTimeline) {
          result.timeline = s.lanes.map((lane) => capListField(capListField({
            wallet: lane.wallet,
            emissions: [...lane.lots].reverse().map((l) => ({ at: iso(l.t), hnt: hnt(l.amount), fateHnt: hntMap(l.mix), tx: l.sig })),
            outgoing: [...lane.outflows].reverse().map((o) => ({ at: iso(o.t), hnt: hnt(o.amount), kind: o.kind, destination: o.label?.name ?? null, to: o.to, tx: o.sig, emissionsCarried: o.lotIdx.length })),
          }, "emissions", timelineLimit), "outgoing", timelineLimit));
        }
        return result;
      },
    },
    {
      name: "get-council-seat-emissions",
      title: "Get one council seat's emissions and where they went",
      description:
        "Every emission to one HIP-149 council seat wallet (newest first) with each part's fate: where it went, when it left, days held, and the wallet-to-wallet path with transaction signatures. Also every outgoing transfer with the emissions it carried (oldest first) and other HNT the wallet received.",
      inputSchema: {
        type: "object",
        properties: {
          wallet: SEAT_SCHEMA,
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50, description: "Emissions to return." },
          offset: { type: "integer", minimum: 0, default: 0, description: "Emissions to skip (newest first)." },
          listLimit: { type: "integer", minimum: 1, maximum: 200, default: 50, description: "Most recent outgoing transfers and other inflows to return." },
        },
        required: ["wallet"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ wallet, limit, offset, listLimit }, { signal } = {}) {
        const d = await fetchCouncilSeat(wallet, { signal });
        if (d?.warming) return { warming: true, message: d.message };
        const lots = [...d.lots].reverse();
        const page = lots.slice(offset, offset + limit).map((l) => ({
          receivedAt: iso(l.t),
          hnt: hnt(l.amount),
          mintDays: l.epochs.map((e) => iso(e).slice(0, 10)),
          tx: l.sig,
          fates: l.fates.map((f) => ({
            kind: f.kind,
            hnt: hnt(f.amount),
            leftSeatAt: iso(f.leftAt),
            settledAt: iso(f.at),
            destination: f.label?.name ?? f.nodeLabel?.name ?? null,
            wallet: f.node,
            reason: f.reason,
            tx: f.sig,
            path: f.path.map((h) => ({ at: iso(h.t), to: h.to, toLabel: h.label?.name ?? null, kind: h.kind, tx: h.sig })),
          })),
        }));
        // veHNT reward claims arrive in bursts; fold them per UTC day, as the page does.
        const folded = new Map();
        for (const i of d.otherInflows) {
          const key = i.kind === "vehnt_rewards" ? `${i.kind}:${Math.floor(i.t / 86_400)}` : i.sig;
          const cur = folded.get(key);
          if (cur) {
            cur.hnt += hnt(i.amount);
            cur.count += 1;
          } else folded.set(key, { at: iso(i.t), hnt: hnt(i.amount), kind: i.kind, from: i.from, tx: i.sig, count: 1 });
        }
        const result = {
          seat: seatRow(d.seat),
          emissions: page,
          pagination: { offset, limit, total: lots.length, nextOffset: offset + limit < lots.length ? offset + limit : null },
          outgoing: [...d.outflows].reverse().map((o) => ({
            at: iso(o.t), hnt: hnt(o.amount), kind: o.kind, destination: o.label?.name ?? null, to: o.to, venue: o.venue,
            swapOut: o.swapOut, tx: o.sig, emissionsCarried: o.lots.length,
            heldBeforeEmissionsHnt: hnt(o.priorAmount), otherHnt: hnt(o.otherAmount),
          })),
          otherInflows: [...folded.values()].reverse(),
        };
        return capListField(capListField(result, "outgoing", listLimit), "otherInflows", listLimit);
      },
    },
    {
      name: "get-council-distribution-runs",
      title: "Get council distribution runs",
      description:
        "The council fanout's daily distribution runs (newest first): when each ran, HNT per seat and which days' mints it distributed, plus counts of council mints and failed distribution attempts. A run that finds the fanout empty distributes nothing, and the next distributes two days at once.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 30, description: "Runs to return." } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      async execute({ limit }, { signal } = {}) {
        const r = await fetchCouncilRuns({ signal });
        if (r?.warming) return { warming: true, message: r.message };
        const result = {
          runs: [...r.runs].reverse().map((x) => ({
            at: iso(x.t), totalHnt: hnt(x.total), perSeatHnt: hntMap(x.perSeat),
            mintDays: x.epochs.map((e) => iso(e).slice(0, 10)), minutesAfterMidnightUtc: x.minutesAfterMidnight, tx: x.sig,
          })),
          mints: r.mints.length,
          failedAttempts: r.failed.length,
        };
        return capListField(result, "runs", limit);
      },
    },
    {
      name: "open-council-emissions",
      title: "Open the council emissions page",
      description:
        "Show the HIP-149 council emissions page. With a seat wallet, open that seat's emissions; add an emission or transfer signature to scroll to it.",
      inputSchema: {
        type: "object",
        properties: {
          wallet: SEAT_SCHEMA,
          lot: { ...SIG_SCHEMA, description: "An emission transaction signature to highlight (needs wallet)." },
          tx: { ...SIG_SCHEMA, description: "An outgoing transfer signature to highlight (needs wallet)." },
        },
        additionalProperties: false,
      },
      validate({ wallet, lot, tx }) {
        if ((lot || tx) && !wallet) return "lot and tx need a seat wallet.";
        return null;
      },
      execute({ wallet, lot, tx }) {
        const q = new URLSearchParams();
        if (wallet) q.set("seat", wallet);
        if (lot) q.set("lot", lot);
        if (tx) q.set("tx", tx);
        const qs = q.toString();
        navigate(`/council-emissions${qs ? `?${qs}` : ""}`);
        return wallet ? `Now showing seat ${wallet} on the council emissions page.` : "Now showing the council emissions page.";
      },
    },
  ];
}
