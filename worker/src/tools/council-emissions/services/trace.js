// The FIFO emission tracer. Pure and replayable: it reads parsed records (see
// parse.js) and cursor state, never the RPC, so a rule change re-derives
// everything from D1.
//
// Model
// - Every emission from the fanout to a seat is one "lot".
// - Each traced wallet ("node") holds a FIFO queue of segments: HNT it held
//   when tracing began ("prior"), emission lots, and other inflows. HNT is
//   fungible, so the oldest HNT is taken to leave first.
// - An outflow consumes the queue front. Each consumed piece of a lot gets a
//   fate when the HNT's use is settled (exchange, swap, veHNT lock, DC burn,
//   other program); a move to another wallet carries the piece into that
//   wallet's queue and keeps following it, up to the caps.
// - Records are replayed in slot order; within a slot, mints, then emissions,
//   then everything else (a wallet can't spend HNT before it arrives).

import {
  EXPECTED_SEATS,
  FANOUT,
  MAX_HOPS,
  MAX_TRACKED_NODES,
  MIN_TRACE_RAW,
  PROGRAMS,
} from "../config.js";
import { classifyInflow, classifyOutflow } from "./classify.js";

const DAY = 86_400;

function orderKey(record) {
  let rank = 2;
  for (const m of record.moves) {
    if (m.type === "mint" && m.to === FANOUT.tokenAccount) rank = Math.min(rank, 0);
    else if (m.type === "transfer" && m.from === FANOUT.tokenAccount) rank = Math.min(rank, 1);
  }
  return rank;
}

// Within one slot the RPC gives no cross-account order, so a record that
// credits an account goes before one that debits it (a wallet can't spend HNT
// before it arrives). Cycles keep the base order.
function orderWithinSlot(group) {
  const credits = group.map((r) => new Set(r.moves.filter((m) => m.to).map((m) => m.to)));
  const debits = group.map((r) => new Set(r.moves.filter((m) => m.from).map((m) => m.from)));
  const remaining = group.map((_, k) => k);
  const out = [];
  while (remaining.length) {
    let pick = remaining.find((k) => !remaining.some((o) => o !== k && [...credits[o]].some((acct) => debits[k].has(acct))));
    if (pick === undefined) pick = remaining[0];
    out.push(group[pick]);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return out;
}

export function sortRecords(records) {
  const base = [...records].sort((a, b) => (a.slot - b.slot) || (orderKey(a) - orderKey(b)) || (a.sig < b.sig ? -1 : a.sig > b.sig ? 1 : 0));
  const out = [];
  for (let i = 0; i < base.length;) {
    let j = i;
    while (j < base.length && base[j].slot === base[i].slot) j++;
    if (j - i > 1) out.push(...orderWithinSlot(base.slice(i, j)));
    else out.push(base[i]);
    i = j;
  }
  return out;
}

const sum = (pieces, pred = () => true) => pieces.reduce((acc, p) => (pred(p) ? acc + p.amount : acc), 0n);

/**
 * @param {object} input
 * @param {object[]} input.records   parsed records (any order)
 * @param {object}   input.cursors   { [tokenAccount]: { role, owner, depth, busy, backfillDone, liveRaw, fromSlot } }
 * @param {(address: string) => object|null} input.label  label resolver
 * @param {number}   input.pendingCount  signatures still queued for fetching (history incomplete)
 * @returns {object} trace result (see snapshot.js for how it is presented)
 */
export function replayTrace({ records, cursors = {}, label, pendingCount = 0 }) {
  const expected = new Map(EXPECTED_SEATS.map((s, i) => [s.wallet, i]));
  const nodes = new Map(); // owner -> node
  const accountOwner = new Map(); // token account -> owner
  for (const [address, c] of Object.entries(cursors)) if (c.owner) accountOwner.set(address, c.owner);

  const lots = new Map(); // lot id -> lot
  const seatOrder = [];
  const fanoutQueue = []; // [{ epoch, amount }]
  const inflows = [];
  const runs = new Map();
  const fetchRequests = new Map(); // token account -> request
  const widenRequests = new Map(); // followed account -> earlier slot to backfill from
  const needLabels = new Set();
  const drift = { unexpectedSeats: [] };
  let downstreamCount = 0;

  const isSeat = (owner) => nodes.get(owner)?.isSeat === true;
  const isTraced = (owner) => nodes.has(owner);

  function makeNode(owner, { isSeat: seat = false, depth = 0, firstSig = null } = {}) {
    const node = {
      owner, isSeat: seat, depth, queue: [], accounts: new Set(), priorRaw: 0n, shortfallRaw: 0n,
      pending: false, busy: false, firstSig, outflows: [], otherInflows: [],
    };
    nodes.set(owner, node);
    return node;
  }

  function ensureSeat(owner, sig) {
    let node = nodes.get(owner);
    if (node?.isSeat) return node;
    if (node) {
      // A wallet we were following turned out to receive emissions itself.
      node.isSeat = true;
      node.depth = 0;
    } else {
      node = makeNode(owner, { isSeat: true, depth: 0, firstSig: sig });
    }
    seatOrder.push(owner);
    if (!expected.has(owner)) drift.unexpectedSeats.push({ owner, firstSig: sig });
    return node;
  }

  // Seed the expected seats so an idle seat still appears, in share order.
  for (const s of EXPECTED_SEATS) {
    ensureSeat(s.wallet, null);
    accountOwner.set(s.ata, s.wallet);
  }

  function initAccount(node, account, record) {
    if (!account || node.accounts.has(account)) return;
    node.accounts.add(account);
    accountOwner.set(account, node.owner);
    const pre = BigInt(record.hnt?.[account]?.pre || "0");
    if (pre > 0n) {
      // HNT the account already held when tracing began is the oldest HNT.
      node.queue.unshift({ lot: null, src: "prior", amount: pre, arrivedAt: record.t, path: [] });
      node.priorRaw += pre;
    }
  }

  function consume(node, amount, record) {
    const pieces = [];
    let rem = amount;
    while (rem > 0n && node.queue.length) {
      const seg = node.queue[0];
      const take = seg.amount < rem ? seg.amount : rem;
      pieces.push({ ...seg, amount: take });
      seg.amount -= take;
      rem -= take;
      if (seg.amount === 0n) node.queue.shift();
    }
    if (rem > 0n) {
      // More left than the trace knows arrived: a gap in indexed history.
      pieces.push({ lot: null, src: "shortfall", amount: rem, arrivedAt: record.t, path: [] });
      node.shortfallRaw += rem;
    }
    return pieces;
  }

  function addFate(piece, fate) {
    const lot = lots.get(piece.lot);
    if (!lot) return;
    lot.fates.push({
      kind: fate.kind,
      amount: piece.amount,
      leftAt: piece.leftSeatAt ?? fate.at ?? null,
      at: fate.at ?? null,
      sig: fate.sig ?? null,
      path: piece.path,
      label: fate.label ?? null,
      venue: fate.venue ?? null,
      reason: fate.reason ?? null,
      node: fate.node ?? null,
      unswept: fate.unswept ?? false,
    });
  }

  function requestFetch(account, owner, depth, record) {
    if (!fetchRequests.has(account)) {
      fetchRequests.set(account, { account, owner, depth, role: "node_token", fromSlot: record.slot, fromTime: record.t });
    }
  }

  // Carry pieces into a downstream wallet and keep following them, or settle
  // them as "not traced further" when a cap stops the trace.
  function follow(pieces, toOwner, toAccount, depth, cls, record) {
    const traced = sum(pieces, (p) => p.lot);
    // A wallet already being followed still receives the HNT (as untraced), so
    // its queue keeps matching its real balance.
    const keepUntraced = () => {
      const node = nodes.get(toOwner);
      if (!node) return;
      initAccount(node, toAccount, record);
      for (const p of pieces) node.queue.push({ lot: null, src: "other", amount: p.amount, arrivedAt: record.t, path: [] });
    };
    if (traced === 0n) return keepUntraced(); // nothing of the council's in this move
    const stop = (reason) => {
      for (const p of pieces) if (p.lot) addFate(p, { kind: "not_traced", at: record.t, sig: record.sig, reason });
      keepUntraced();
    };
    if (depth > MAX_HOPS) return stop("hop_limit");
    if (traced < MIN_TRACE_RAW) return stop("dust");
    // A wallet too busy to index has no complete history to replay; following
    // it would pin the lot on whatever it sent HNT to next.
    if (cursors[toAccount]?.busy) return stop("busy");
    let node = nodes.get(toOwner);
    if (!node) {
      if (downstreamCount >= MAX_TRACKED_NODES) return stop("limit");
      downstreamCount += 1;
      node = makeNode(toOwner, { depth, firstSig: record.sig });
    }
    node.depth = Math.min(node.depth, depth);
    if (cls.label) node.label = cls.label;
    const cursor = cursors[toAccount];
    if (!cursor) {
      requestFetch(toAccount, toOwner, depth, record);
      node.pending = true;
    } else {
      if (!cursor.backfillDone) node.pending = true;
      // Indexed from a later receipt than this one: backfill further back.
      if (cursor.fromSlot != null && record.slot < cursor.fromSlot) {
        const prev = widenRequests.get(toAccount);
        if (!prev || record.slot < prev.fromSlot) widenRequests.set(toAccount, { account: toAccount, fromSlot: record.slot });
        node.pending = true;
      }
    }
    initAccount(node, toAccount, record);
    for (const p of pieces) node.queue.push({ ...p, arrivedAt: record.t });
  }

  // Spend a run's total from the fanout's epoch queue, oldest mint first. Every
  // seat's lot in the run covers the same epochs (the shares are equal).
  function runEpochs(total) {
    let rem = total;
    const epochs = [];
    while (rem > 0n && fanoutQueue.length) {
      const seg = fanoutQueue[0];
      const take = seg.amount < rem ? seg.amount : rem;
      if (!epochs.includes(seg.epoch)) epochs.push(seg.epoch);
      seg.amount -= take;
      rem -= take;
      if (seg.amount === 0n) fanoutQueue.shift();
    }
    return epochs;
  }

  for (const record of sortRecords(records)) {
    const ownerOf = (account) => record.hnt?.[account]?.owner ?? accountOwner.get(account) ?? null;
    const emissionMoves = record.moves.filter((m) => m.type === "transfer" && m.from === FANOUT.tokenAccount);
    // An empty run moves no HNT but still lists the fanout's token account; any
    // other mini-fanout's DistributeV0 (Hotspot reward splits) is not a council run.
    if (emissionMoves.length || ((record.instructions || []).includes("DistributeV0") && record.hnt?.[FANOUT.tokenAccount] !== undefined)) {
      const total = emissionMoves.reduce((acc, m) => acc + BigInt(m.amount || "0"), 0n);
      runs.set(record.sig, { sig: record.sig, t: record.t, slot: record.slot, perSeat: {}, total, epochs: runEpochs(total) });
    }

    for (const [moveIndex, move] of record.moves.entries()) {
      const amount = BigInt(move.amount || "0");

      // HNT minted into the fanout: the council's emission for an epoch.
      if (move.type === "mint" && move.to === FANOUT.tokenAccount) {
        const epoch = Math.floor((record.t ?? 0) / DAY) * DAY;
        inflows.push({ sig: record.sig, t: record.t, amount, subDao: move.subDao ?? null, epoch, manual: !record.programs.includes(PROGRAMS.tuktuk) });
        fanoutQueue.push({ epoch, amount });
        continue;
      }

      // An emission from the fanout to a seat: one lot.
      if (move.type === "transfer" && move.from === FANOUT.tokenAccount) {
        const seatOwner = ownerOf(move.to);
        if (!seatOwner) continue;
        const run = runs.get(record.sig);
        run.perSeat[seatOwner] = (run.perSeat[seatOwner] || 0n) + amount;
        const seat = ensureSeat(seatOwner, record.sig);
        initAccount(seat, move.to, record);
        if (amount === 0n) continue;
        const id = `${record.sig}:${seatOwner}:${moveIndex}`;
        lots.set(id, { id, seat: seatOwner, sig: record.sig, t: record.t, amount, epochs: run.epochs, fates: [] });
        seat.queue.push({ lot: id, seat: seatOwner, src: "emission", amount, arrivedAt: record.t, leftSeatAt: null, path: [] });
        continue;
      }

      const fromOwner = move.from ? ownerOf(move.from) : null;
      const toOwner = move.to ? ownerOf(move.to) : null;
      const fromNode = fromOwner ? nodes.get(fromOwner) : null;
      const toNode = toOwner ? nodes.get(toOwner) : null;

      if (fromNode) {
        if (cursors[move.from]?.busy) fromNode.busy = true;
        initAccount(fromNode, move.from, record);
        if (toOwner && toOwner === fromOwner) {
          // Moving between its own accounts. A followed wallet's other account
          // gets indexed too, so its onward moves stay visible.
          if (!fromNode.isSeat && move.to && !cursors[move.to]) {
            requestFetch(move.to, fromOwner, fromNode.depth, record);
            fromNode.pending = true;
          }
          initAccount(fromNode, move.to, record);
          continue;
        }
        if (amount === 0n) continue;
        const cls = classifyOutflow({ move, fromOwner, toOwner, record, label, isSeat, isTraced });
        // Identity matters only where it decides whether to keep following.
        if (!cls.terminal && toOwner && !cls.label && !isSeat(toOwner) && !label(toOwner)) needLabels.add(toOwner);
        const pieces = consume(fromNode, amount, record);
        const hop = { sig: record.sig, t: record.t, from: fromOwner, to: toOwner, toAccount: move.to, kind: cls.kind, label: cls.label?.name ?? null };
        for (const p of pieces) {
          p.path = [...p.path, hop];
          if (p.lot && p.leftSeatAt == null && p.seat === fromOwner) p.leftSeatAt = record.t;
        }
        if (fromNode.isSeat) {
          fromNode.outflows.push({
            sig: record.sig, t: record.t, amount, kind: cls.kind, to: toOwner, toAccount: move.to,
            label: cls.label ?? null, venue: cls.venue ?? null, swapOut: cls.swapOut ?? null,
            lots: pieces.filter((p) => p.lot).map((p) => ({ lot: p.lot, amount: p.amount })),
            priorAmount: sum(pieces, (p) => p.src === "prior"),
            otherAmount: sum(pieces, (p) => p.src === "other" || p.src === "shortfall"),
          });
        }
        if (fromNode.busy) {
          for (const p of pieces) if (p.lot) addFate(p, { kind: "not_traced", at: record.t, sig: record.sig, reason: "busy" });
        } else if (cls.terminal) {
          for (const p of pieces) {
            if (p.lot) addFate(p, { kind: cls.kind, at: record.t, sig: record.sig, label: cls.label ?? null, venue: cls.venue ?? null });
          }
        } else if (cls.kind === "council") {
          const seat = nodes.get(toOwner);
          initAccount(seat, move.to, record);
          for (const p of pieces) seat.queue.push({ ...p, arrivedAt: record.t });
        } else {
          follow(pieces, toOwner, move.to, fromNode.depth + 1, cls, record);
        }
        continue;
      }

      if (toNode && amount > 0n) {
        initAccount(toNode, move.to, record);
        const kind = classifyInflow({ move, fromOwner, toOwner, record, label });
        toNode.queue.push({ lot: null, src: "other", kind, amount, arrivedAt: record.t, path: [] });
        if (toNode.isSeat) toNode.otherInflows.push({ sig: record.sig, t: record.t, amount, kind, from: fromOwner });
      } else if (toNode) {
        initAccount(toNode, move.to, record);
      }
    }
  }

  // Whatever is still sitting in a queue is held there.
  for (const node of nodes.values()) {
    const custodial = node.isSeat && label(node.owner)?.kind === "exchange_deposit";
    for (const seg of node.queue) {
      if (!seg.lot || seg.amount === 0n) continue;
      if (node.isSeat && !custodial) {
        addFate(seg, { kind: node.owner === seg.seat ? "held" : "held_by_seat", node: node.owner });
      } else if (custodial || node.label?.kind === "exchange_deposit") {
        // An exchange deposit address is already the exchange's custody.
        addFate(seg, { kind: "exchange", label: label(node.owner) ?? node.label, node: node.owner, unswept: true });
      } else if (node.busy) {
        addFate(seg, { kind: "not_traced", node: node.owner, reason: "busy" });
      } else if (node.pending || pendingCount > 0) {
        addFate(seg, { kind: "following", node: node.owner });
      } else {
        addFate(seg, { kind: "held_downstream", node: node.owner, label: label(node.owner) ?? null });
      }
    }
  }

  const seats = seatOrder.map((owner, index) => {
    const node = nodes.get(owner);
    const seatLots = [...lots.values()].filter((l) => l.seat === owner).sort((a, b) => a.t - b.t);
    const queueTotal = sum(node.queue);
    const accounts = [...node.accounts];
    const liveKnown = accounts.length > 0 && accounts.every((a) => cursors[a]?.liveRaw != null);
    const live = liveKnown ? accounts.reduce((acc, a) => acc + BigInt(cursors[a].liveRaw), 0n) : null;
    // A seat account the trace met without a cursor (a non-ATA HNT account)
    // gets indexed from the window start.
    for (const a of accounts) {
      if (!cursors[a] && !fetchRequests.has(a)) {
        fetchRequests.set(a, { account: a, owner, depth: 0, role: "seat_token", fromSlot: null, fromTime: FANOUT.createdAt });
      }
    }
    const indexed = accounts.every((a) => cursors[a]?.backfillDone);
    return {
      wallet: owner,
      index,
      expected: expected.has(owner),
      accounts,
      lots: seatLots,
      outflows: node.outflows,
      otherInflows: node.otherInflows,
      priorRaw: node.priorRaw,
      shortfallRaw: node.shortfallRaw,
      balanceRaw: queueTotal,
      liveRaw: live,
      reconciled: !indexed || pendingCount > 0 ? "indexing" : live == null ? "unknown" : live === queueTotal ? "ok" : "mismatch",
    };
  });

  const downstream = [...nodes.values()]
    .filter((n) => !n.isSeat)
    .map((n) => ({
      owner: n.owner, depth: n.depth, accounts: [...n.accounts], pending: n.pending, busy: n.busy,
      label: label(n.owner) ?? n.label ?? null, tracedRaw: sum(n.queue, (p) => p.lot),
    }));

  return {
    inflows,
    runs: [...runs.values()].sort((a, b) => a.t - b.t),
    waitingRaw: fanoutQueue.reduce((acc, s) => acc + s.amount, 0n),
    seats,
    downstream,
    fetchRequests: [...fetchRequests.values()],
    widenRequests: [...widenRequests.values()],
    needLabels: [...needLabels],
    drift,
  };
}
