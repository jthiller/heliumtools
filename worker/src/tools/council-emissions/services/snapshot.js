// Shape the trace result into the API views stored in KV: the page summary
// (with the timeline lanes), one detail document per seat, the distribution runs and
// the label set. Pure. Amounts are integer base-unit strings (HNT has 8
// decimals); times are unix seconds.

import { EXPECTED_SEATS, FANOUT, HNT_DECIMALS, SEAT_NAMES } from "../config.js";
import { LABEL_REGISTRY } from "../labels.js";

const DAY = 86_400;

// Fates that leave the HNT with the seat (or the council); everything else has left.
const STAYING = new Set(["held", "held_by_seat"]);

const ERROR_NAMES = { 6009: "PreTaskNotRun", 3012: "AccountNotInitialized" };

const plain = (value) => JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const add = (map, key, amount) => {
  map[key] = (map[key] || 0n) + amount;
};

function labelView(l) {
  if (!l) return null;
  return { name: l.name, kind: l.kind, org: l.org ?? null, source: l.source ?? null, confidence: l.confidence ?? null, custodial: l.custodial ?? false };
}

function errorOf(raw) {
  try {
    const err = JSON.parse(raw);
    const custom = err?.InstructionError?.[1]?.Custom;
    if (custom != null) return { code: custom, name: ERROR_NAMES[custom] ?? null };
    return { code: null, name: typeof err === "string" ? err : Object.keys(err || {})[0] ?? null };
  } catch {
    return { code: null, name: null };
  }
}

function fateView(f, label) {
  return {
    kind: f.kind,
    amount: f.amount,
    leftAt: f.leftAt,
    at: f.at,
    sig: f.sig,
    venue: f.venue,
    reason: f.reason,
    unswept: f.unswept,
    node: f.node,
    label: labelView(f.label),
    nodeLabel: f.node ? labelView(label(f.node)) : null,
    path: f.path.map((h) => ({ sig: h.sig, t: h.t, from: h.from, to: h.to, toAccount: h.toAccount, kind: h.kind, label: h.to ? labelView(label(h.to)) : null })),
  };
}

/**
 * @param {object} input
 * @param {object} input.trace     replayTrace() result
 * @param {object[]} input.cursors ce_cursors rows
 * @param {object[]} input.failed  ce_failed rows
 * @param {object|null} input.fanoutState  decoded MiniFanoutV0 (null if missing)
 * @param {object} input.learned   cached identities
 * @param {(a: string) => object|null} input.label
 * @param {object} input.meta      { builtAt, pending, indexedThrough }
 */
export function buildViews({ trace, cursors, failed, fanoutState, fanoutExists, learned, label, meta }) {
  const cursorBy = Object.fromEntries(cursors.map((c) => [c.address, c]));
  const seatCount = fanoutState?.shares?.length || EXPECTED_SEATS.length;

  // Emission totals, and the recent per-seat rate from the last 7 epochs minted.
  const minted = trace.inflows.reduce((acc, i) => acc + i.amount, 0n);
  const byEpoch = new Map();
  for (const i of trace.inflows) byEpoch.set(i.epoch, (byEpoch.get(i.epoch) || 0n) + i.amount);
  const recent = [...byEpoch.keys()].sort((a, b) => b - a).slice(0, 7);
  const recentTotal = recent.reduce((acc, e) => acc + byEpoch.get(e), 0n);
  const perSeatPerDay = recent.length ? recentTotal / BigInt(recent.length) / BigInt(seatCount) : null;
  const distributedRuns = trace.runs.filter((r) => r.total > 0n);
  const emitted = distributedRuns.reduce((acc, r) => acc + r.total, 0n);
  const lastMint = trace.inflows.at(-1) ?? null;
  const lastDistributed = distributedRuns.at(-1) ?? null;

  const failedRuns = failed.map((f) => ({ sig: f.signature, t: f.block_time, slot: f.slot, error: errorOf(f.error) }));

  const seats = trace.seats.map((s) => {
    const byKind = {};
    let received = 0n;
    let held = 0n;
    for (const lot of s.lots) {
      received += lot.amount;
      for (const f of lot.fates) {
        add(byKind, f.kind, f.amount);
        if (f.kind === "held") held += f.amount;
      }
    }
    const otherIn = s.otherInflows.reduce((acc, i) => acc + i.amount, 0n);
    const named = SEAT_NAMES[s.wallet] ?? null;
    return {
      wallet: s.wallet,
      seat: s.index + 1,
      expected: s.expected,
      name: named?.name ?? null,
      nameSource: named?.sourceUrl ?? null,
      label: labelView(label(s.wallet)),
      accounts: s.accounts,
      received,
      lots: s.lots.length,
      byKind,
      held,
      // Everything that left this seat's wallet, including to another seat.
      left: received - held,
      outflows: s.outflows.length,
      firstOutflowAt: s.outflows[0]?.t ?? null,
      lastOutflowAt: s.outflows.at(-1)?.t ?? null,
      priorRaw: s.priorRaw,
      otherInRaw: otherIn,
      balanceRaw: s.balanceRaw,
      liveRaw: s.liveRaw,
      reconciled: s.reconciled,
    };
  });

  // Timeline lanes: every emission with where it went, every outflow marker.
  const lanes = trace.seats.map((s) => {
    const lotIndex = new Map(s.lots.map((lot, i) => [lot.id, i]));
    return {
    wallet: s.wallet,
    lots: s.lots.map((lot) => {
      const mix = {};
      for (const f of lot.fates) add(mix, f.kind, f.amount);
      const left = lot.fates.filter((f) => !STAYING.has(f.kind) && f.leftAt).map((f) => f.leftAt);
      return { sig: lot.sig, t: lot.t, amount: lot.amount, mix, firstLeftAt: left.length ? Math.min(...left) : null };
    }),
    outflows: s.outflows.map((o) => ({
      sig: o.sig, t: o.t, amount: o.amount, kind: o.kind, venue: o.venue,
      label: labelView(o.label ?? label(o.to)), to: o.to,
      // Which of this lane's emissions (by index) the outflow carried.
      lotIdx: o.lots.map((l) => lotIndex.get(l.lot)).filter((i) => i != null),
    })),
    };
  });

  const drift = {
    unexpectedSeats: trace.drift.unexpectedSeats,
    // Only a confirmed missing account (getAccountInfo null), never a decode failure.
    fanoutMissing: fanoutExists === false,
    sharesChanged: fanoutState
      ? fanoutState.shares.length !== EXPECTED_SEATS.length ||
        fanoutState.shares.some((sh, i) => sh.wallet !== EXPECTED_SEATS[i]?.wallet || sh.delegate || sh.share.kind !== "share" || sh.share.amount !== 1)
      : false,
  };

  const indexedCursors = cursors.filter((c) => c.backfill_done).length;
  const summary = {
    v: 1,
    builtAt: meta.builtAt,
    decimals: HNT_DECIMALS,
    indexedThrough: meta.indexedThrough,
    backfill: {
      done: cursors.length > 0 && indexedCursors === cursors.length && meta.pending === 0,
      pending: meta.pending,
      cursors: cursors.length,
      indexed: indexedCursors,
    },
    fanout: {
      pda: FANOUT.pda,
      tokenAccount: FANOUT.tokenAccount,
      owner: FANOUT.owner,
      seed: FANOUT.seed,
      schedule: fanoutState?.schedule ?? FANOUT.schedule,
      createdAt: FANOUT.createdAt,
      exists: fanoutExists !== false,
      shares: fanoutState?.shares ?? null,
      liveRaw: cursorBy[FANOUT.tokenAccount]?.live_raw ?? null,
    },
    totals: {
      minted,
      mints: trace.inflows.length,
      epochs: byEpoch.size,
      manualMints: trace.inflows.filter((i) => i.manual).length,
      emitted,
      waiting: trace.waitingRaw,
      runs: trace.runs.length,
      distributedRuns: distributedRuns.length,
      emptyRuns: trace.runs.length - distributedRuns.length,
      failedAttempts: failedRuns.length,
      perSeatPerDay,
      recentEpochs: recent.length,
      lastMintAt: lastMint?.t ?? null,
      lastEmissionAt: lastDistributed?.t ?? null,
      seats: seatCount,
    },
    seats,
    lanes,
    downstream: trace.downstream.map((d) => ({ owner: d.owner, depth: d.depth, label: labelView(d.label), pending: d.pending, busy: d.busy, tracedRaw: d.tracedRaw })),
    drift,
  };

  const seatDetails = {};
  for (const s of trace.seats) {
    seatDetails[s.wallet] = {
      v: 1,
      builtAt: meta.builtAt,
      decimals: HNT_DECIMALS,
      seat: summary.seats.find((x) => x.wallet === s.wallet),
      lots: s.lots.map((lot) => ({
        sig: lot.sig, t: lot.t, amount: lot.amount,
        epochs: lot.epochs,
        fates: lot.fates.map((f) => fateView(f, label)),
      })),
      outflows: s.outflows.map((o) => ({
        sig: o.sig, t: o.t, amount: o.amount, kind: o.kind, to: o.to, toAccount: o.toAccount,
        label: labelView(o.label ?? label(o.to)), venue: o.venue, swapOut: o.swapOut,
        lots: o.lots.map((l) => ({ sig: l.lot.split(":")[0], amount: l.amount })),
        priorAmount: o.priorAmount, otherAmount: o.otherAmount,
      })),
      otherInflows: s.otherInflows.map((i) => ({ sig: i.sig, t: i.t, amount: i.amount, kind: i.kind, from: i.from, label: labelView(label(i.from)) })),
    };
  }

  const runs = {
    v: 1,
    builtAt: meta.builtAt,
    decimals: HNT_DECIMALS,
    runs: trace.runs.map((r) => ({
      sig: r.sig, t: r.t, total: r.total, perSeat: r.perSeat, epochs: r.epochs,
      minutesAfterMidnight: r.t != null ? Math.floor((r.t % DAY) / 60) : null,
    })),
    mints: trace.inflows.map((i) => ({ sig: i.sig, t: i.t, amount: i.amount, subDao: i.subDao, epoch: i.epoch, manual: i.manual })),
    failed: failedRuns,
  };

  const labels = {
    v: 1,
    builtAt: meta.builtAt,
    registry: Object.entries(LABEL_REGISTRY).map(([address, l]) => ({ address, ...l })),
    learned: Object.entries(learned)
      .filter(([, id]) => !id.none)
      .map(([address, id]) => ({ address, identity: { type: id.type, name: id.name, category: id.category, tags: id.tags }, fetchedAt: id.fetchedAt ?? null, label: labelView(label(address)) })),
  };

  return {
    summary: plain(summary),
    seats: Object.fromEntries(Object.entries(seatDetails).map(([k, v]) => [k, plain(v)])),
    runs: plain(runs),
    labels: plain(labels),
  };
}
