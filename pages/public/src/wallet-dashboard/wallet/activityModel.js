// ── Wallet activity: plain labels and day groups ────────────────────────────
// Turns the worker's transaction page (Helius enhanced types and English
// descriptions, or bare signatures when only the basic listing answered)
// into what the Activity card shows: one plain label per transaction
// ("Rewards distributed", "Sent 0.00001 SOL", "Swapped …"), grouped by local
// day, then by what happened (label, detail and source). A failed
// transaction never folds into a group. Pure: no React, no fetch. Times are
// the viewer's local time.
import { shortAddress } from "../format.js";

// Source programs worth naming; SYSTEM_PROGRAM and UNKNOWN say nothing.
const SOURCE_LABEL = {
  NOVA: "Nova",
  SOLANA_PROGRAM_LIBRARY: "SPL",
  JUPITER: "Jupiter",
  HELIUM: "Helium",
  MAGIC_EDEN: "Magic Eden",
  TENSOR: "Tensor",
  RAYDIUM: "Raydium",
  ORCA: "Orca",
  METEORA: "Meteora",
  PHANTOM: "Phantom",
};
const HIDDEN_SOURCES = new Set(["SYSTEM_PROGRAM", "UNKNOWN"]);
// Words that keep their capitals when a raw enum is humanized.
const ACRONYMS = new Set(["NFT", "NFTS", "SOL", "SPL", "DAO", "DC", "HNT", "IOT", "ATA", "DEX", "LP", "AMM", "OTC"]);
// Descriptions name some tokens by mint: the ones a Helium wallet holds read as symbols.
const MINT_SYMBOL = {
  hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux: "HNT",
  mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6: "MOBILE",
  iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns: "IOT",
  dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm: "DC",
  So11111111111111111111111111111111111111112: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
};
const TRANSFER_RE = /^(\S+) transferred (?:a total )?([\d.]+) (\S+) to (.+?)\.?$/;
const SWAP_RE = /swapped ([\d.]+) (\S+) for ([\d.]+) (\S+)/;
const DAY_MS = 86_400_000;
/** Days up to this many ago read "{n} days ago"; older ones carry their year. */
export const RECENT_DAYS = 30;
// The first group of this many or fewer opens by default, to show the pattern.
const OPEN_FIRST_MAX = 4;

const wordOf = (w, first) => {
  const up = w.toUpperCase();
  if (ACRONYMS.has(up)) return up === "NFTS" ? "NFTs" : up;
  const lower = w.toLowerCase();
  return first ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
};

/** A raw enum in sentence case with its acronyms kept: "COMPRESSED_NFT_MINT" → "Compressed NFT mint". */
function humanize(raw) {
  return String(raw)
    .split("_")
    .filter(Boolean)
    .map((w, i) => wordOf(w, i === 0))
    .join(" ");
}

/** The tag for a transaction's source program, or null when it says nothing. */
export function sourceLabel(source) {
  if (!source || HIDDEN_SOURCES.has(source)) return null;
  return SOURCE_LABEL[source] ?? String(source).split("_").map((w) => wordOf(w, true)).join(" ");
}

/** A token as a description names it: a symbol, or a mint ("hntyVP…" → "HNT"; an unknown one shortened). */
const tokenName = (t) => MINT_SYMBOL[t] ?? (t.length >= 32 ? shortAddress(t, 4, 4) : t);

/** "12680.85265975" → "12,680.85265975": thousands separators, every decimal kept. */
function amountText(s) {
  const [int, frac] = s.split(".");
  return Number(int).toLocaleString("en-US") + (frac ? `.${frac}` : "");
}

/**
 * One transaction's plain label.
 * @returns {{ label, detail: string|null, typed: boolean, fullLead: string|null, full: string|null }}
 *   `typed` is false for a transaction with no known type (it groups as "12 transactions");
 *   `full` is the whole counterparty address, shown when its group opens.
 */
export function parseTransaction(tx, wallet) {
  const type = tx?.type;
  const desc = tx?.description || "";
  const plain = (label) => ({ label, detail: null, typed: true, fullLead: null, full: null });
  if (type === "DISTRIBUTE_COMPRESSION_REWARDS") return plain("Rewards distributed");
  if (type === "TRANSFER") {
    const m = TRANSFER_RE.exec(desc);
    if (!m) return plain("Transfer");
    const [, from, amt, token, to] = m;
    const amount = `${amountText(amt)} ${tokenName(token)}`;
    const multi = to === "multiple accounts";
    if (from === wallet) {
      return { label: `Sent ${amount}`, detail: multi ? "to multiple accounts" : `to ${shortAddress(to)}`, typed: true, fullLead: multi ? null : "To", full: multi ? null : to };
    }
    if (to === wallet) return { label: `Received ${amount}`, detail: `from ${shortAddress(from)}`, typed: true, fullLead: "From", full: from };
    return {
      label: `Transfer of ${amount}`,
      detail: `from ${shortAddress(from)}${multi ? " to multiple accounts" : ""}`,
      typed: true,
      fullLead: "From",
      full: from,
    };
  }
  if (type === "SWAP") {
    const m = SWAP_RE.exec(desc);
    return plain(m ? `Swapped ${amountText(m[1])} ${tokenName(m[2])} for ${amountText(m[3])} ${tokenName(m[4])}` : "Swap");
  }
  if (!type || type === "UNKNOWN") return { label: "Transaction", detail: null, typed: false, fullLead: null, full: null };
  return plain(humanize(type));
}

const midnight = (ms) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/**
 * The loaded transactions (newest first) grouped by local day, then by what
 * happened. Each group: { id, label, detail, typed, source, ok, multi, count,
 * at (newest ms), fullLead, full, txs: [{ signature, at, ok, fee, label, detail }] }.
 * A transaction the chain gave no block time (`timestamp` null) has `at`
 * null and lands in one day of its own, keyed "unknown" (never Jan 1, 1970).
 * `defaultOpen` is the id of the first multi group of 4 or fewer, which the
 * card opens until the viewer toggles it.
 * @returns {{ days: [{ key, at, ago, groups }], count, defaultOpen }}
 *   `ago` is whole local days before `now` (0 = today), null for the unknown day.
 */
export function groupActivity(transactions, wallet, now = Date.now()) {
  const today = midnight(now);
  const days = [];
  const byDay = new Map();
  let count = 0;
  for (const tx of transactions || []) {
    if (!tx?.signature) continue;
    count++;
    const at = Number(tx.timestamp) > 0 ? Number(tx.timestamp) * 1000 : null;
    const dayStart = at == null ? "unknown" : midnight(at);
    let day = byDay.get(dayStart);
    if (!day) {
      const ago = at == null ? null : Math.round((today - dayStart) / DAY_MS);
      day = { key: String(dayStart), at, ago, groups: [], index: new Map() };
      byDay.set(dayStart, day);
      days.push(day);
    }
    const p = parseTransaction(tx, wallet);
    const ok = tx.success !== false;
    const source = sourceLabel(tx.source);
    const groupKey = ok ? `${p.label}|${p.detail ?? ""}|${source ?? ""}` : `failed|${tx.signature}`;
    let group = day.index.get(groupKey);
    if (!group) {
      group = {
        id: `${day.key}-${day.groups.length}`,
        label: p.label,
        detail: p.detail,
        typed: p.typed,
        source,
        ok,
        at,
        fullLead: p.fullLead,
        full: p.full,
        txs: [],
      };
      day.index.set(groupKey, group);
      day.groups.push(group);
    }
    group.txs.push({ signature: tx.signature, at, ok, fee: Number.isFinite(tx.fee) ? tx.fee : null, label: p.label, detail: p.detail });
  }
  let defaultOpen = null;
  for (const day of days) {
    delete day.index;
    for (const g of day.groups) {
      g.count = g.txs.length;
      g.multi = g.count > 1;
      if (g.multi && g.count <= OPEN_FIRST_MAX && defaultOpen == null) defaultOpen = g.id;
    }
  }
  return { days, count, defaultOpen };
}
