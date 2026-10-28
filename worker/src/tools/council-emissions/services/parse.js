// Turn a jsonParsed (v0-aware) getTransaction result into the compact record the
// tracer replays. Pure: no I/O. Records are stored in D1 (ce_tx) so a rule
// change can re-derive everything without touching the RPC.
//
// Amounts stay integer base-unit strings; callers sum them as BigInt.

import { HNT_MINT, PROGRAMS, SUB_DAOS } from "../config.js";

export const RECORD_VERSION = 1;

const TRANSFER_TYPES = new Set(["transfer", "transferChecked"]);
const MINT_TYPES = new Set(["mintTo", "mintToChecked"]);
const BURN_TYPES = new Set(["burn", "burnChecked"]);

function amountOf(info) {
  return info.tokenAmount?.amount ?? info.amount ?? "0";
}

/** Top-level instructions with their inner (CPI) instructions, in execution order. */
function flattenInstructions(tx) {
  const top = tx.transaction?.message?.instructions || [];
  const innerByIndex = new Map();
  for (const group of tx.meta?.innerInstructions || []) innerByIndex.set(group.index, group.instructions || []);
  const out = [];
  top.forEach((ix, i) => {
    out.push(ix);
    for (const inner of innerByIndex.get(i) || []) out.push(inner);
  });
  return out;
}

/**
 * @returns {object|null} the compact record, or null for a missing/failed tx
 * (failed txs move nothing; the indexer records failed distribution runs from the
 * signature list instead).
 */
export function parseTransaction(signature, tx) {
  if (!tx || tx.meta?.err) return null;
  const keys = (tx.transaction?.message?.accountKeys || []).map((k) => (typeof k === "string" ? { pubkey: k } : k));
  const pubkeyAt = (i) => keys[i]?.pubkey;

  // Every token account whose balance the tx reports, by address.
  const tokens = new Map();
  const note = (entry, field) => {
    const address = pubkeyAt(entry.accountIndex);
    if (!address) return;
    const cur = tokens.get(address) || { mint: entry.mint, owner: entry.owner || null, pre: "0", post: "0" };
    cur[field] = entry.uiTokenAmount?.amount ?? "0";
    if (!cur.owner && entry.owner) cur.owner = entry.owner;
    tokens.set(address, cur);
  };
  for (const e of tx.meta?.preTokenBalances || []) note(e, "pre");
  for (const e of tx.meta?.postTokenBalances || []) note(e, "post");

  const hnt = {};
  const other = {};
  for (const [address, t] of tokens) {
    if (t.mint === HNT_MINT) {
      hnt[address] = { owner: t.owner, pre: t.pre, post: t.post };
      continue;
    }
    const delta = BigInt(t.post) - BigInt(t.pre);
    if (delta === 0n || !t.owner) continue;
    const byMint = (other[t.owner] ||= {});
    byMint[t.mint] = (BigInt(byMint[t.mint] || "0") + delta).toString();
  }

  const sol = {};
  const pre = tx.meta?.preBalances || [];
  const post = tx.meta?.postBalances || [];
  keys.forEach((k, i) => {
    const delta = (post[i] ?? 0) - (pre[i] ?? 0);
    if (delta !== 0) sol[k.pubkey] = delta;
  });

  const isHnt = (address, mint) => mint === HNT_MINT || hnt[address] !== undefined;
  const programs = new Set();
  const moves = [];
  let subDao = null;
  for (const ix of flattenInstructions(tx)) {
    if (ix.programId) programs.add(ix.programId);
    // issue_rewards_v0 names its sub-DAO as account 1; the council mint that
    // follows inside it is attributed to that sub-DAO.
    if (ix.programId === PROGRAMS.heliumSubDaos && SUB_DAOS[ix.accounts?.[1]]) subDao = SUB_DAOS[ix.accounts[1]];
    const type = ix.parsed?.type;
    const info = ix.parsed?.info;
    if (!type || !info) continue;
    if (TRANSFER_TYPES.has(type) && isHnt(info.source, info.mint)) {
      moves.push({ type: "transfer", from: info.source, to: info.destination, amount: amountOf(info) });
    } else if (MINT_TYPES.has(type) && info.mint === HNT_MINT) {
      moves.push({ type: "mint", from: null, to: info.account, amount: amountOf(info), subDao });
    } else if (BURN_TYPES.has(type) && isHnt(info.account, info.mint)) {
      moves.push({ type: "burn", from: info.account, to: null, amount: amountOf(info) });
    }
  }

  // Anchor programs log their instruction names; the tracer uses this to see
  // distribution runs that found the fanout empty (they move no HNT).
  const instructions = [];
  for (const line of tx.meta?.logMessages || []) {
    const m = /^Program log: Instruction: (\w+)$/.exec(line);
    if (m && !instructions.includes(m[1])) instructions.push(m[1]);
  }

  return {
    v: RECORD_VERSION,
    sig: signature,
    slot: tx.slot,
    t: tx.blockTime ?? null,
    feePayer: pubkeyAt(0) || null,
    signers: keys.filter((k) => k.signer).map((k) => k.pubkey),
    programs: [...programs],
    instructions,
    hnt,
    moves,
    other,
    sol,
  };
}
