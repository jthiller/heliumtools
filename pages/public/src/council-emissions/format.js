// Council Emissions: formatting and the fate vocabulary shared by the page,
// the timeline and the agent tools. Amounts arrive as integer base-unit
// strings (HNT has 8 decimals); times as unix seconds, shown in UTC.

export { txUrl, accountUrl } from "../wallet-dashboard/format.js";

export const DECIMALS = 8;
const DAY = 86_400;

/** Base units (string/BigInt) → HNT as a Number (display only). */
export function toHnt(raw) {
  if (raw == null) return null;
  return Number(raw) / 10 ** DECIMALS;
}

/** "11,599.87 HNT"-style amount; whole numbers keep no decimals. */
export function fmtHnt(raw, { unit = true, empty = "Not known" } = {}) {
  const n = toHnt(raw);
  if (n == null || Number.isNaN(n)) return empty;
  const digits = Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2;
  const text = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? `${text} HNT` : text;
}

/** Compact amount for tight labels: 490, 9.1k, 40.7k. */
export function fmtHntCompact(raw) {
  const n = toHnt(raw);
  if (n == null) return "";
  if (n >= 1000) return `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: n >= 10_000 ? 1 : 2 })}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function fmtUsd(n) {
  if (n == null || Number.isNaN(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

export function fmtDay(t) {
  return t == null ? "Not known" : dayFmt.format(new Date(t * 1000));
}

export function fmtShortDay(t) {
  return t == null ? "" : shortDayFmt.format(new Date(t * 1000));
}

/** "Oct 27, 2026, 15:11 UTC" */
export function fmtDateTime(t) {
  if (t == null) return "Not known";
  const d = new Date(t * 1000);
  return `${dayFmt.format(d)}, ${timeFmt.format(d)} UTC`;
}

/** Whole UTC calendar days between two times, matching the UTC dates shown beside it. */
export function daysBetween(from, to) {
  if (from == null || to == null) return null;
  return Math.max(0, Math.floor(to / DAY) - Math.floor(from / DAY));
}

export function fmtDays(n) {
  if (n == null) return "";
  if (n === 0) return "the same day";
  return n === 1 ? "1 day later" : `${n} days later`;
}

export function fmtAgo(ms, now = Date.now()) {
  if (!ms) return null;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function shortAddress(a, head = 4, tail = 4) {
  if (!a) return "";
  return a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** The next 00:00 UTC after `nowMs` (the fanout's daily distribution). */
export function nextDistributionAt(nowMs = Date.now()) {
  const t = Math.floor(nowMs / 1000);
  return (Math.floor(t / DAY) + 1) * DAY;
}

const MINTS = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
  SOL: { symbol: "SOL", decimals: 9 },
  iotEVVZLEywoTn1QdwNPddxPWszn3zFhEot3MfL9fns: { symbol: "IOT", decimals: 6 },
  mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6: { symbol: "MOBILE", decimals: 6 },
};

/** "4,950.93 USDC" for a swap output entry; unknown mints show a short address. */
export function fmtSwapOut(out) {
  const meta = MINTS[out.mint];
  if (!meta) return `${shortAddress(out.mint)} (token)`;
  const n = Number(out.amount) / 10 ** meta.decimals;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${meta.symbol}`;
}

// What happened to (part of) an emission. Fixed order, used everywhere.
// Hues follow the Okabe-Ito palette (built to stay distinct with common color
// vision deficiencies), and each kind has its own fill pattern (patterns.jsx).
export const FATES = [
  { kind: "held", label: "Still held by the seat", short: "Held", light: "#64748b", dark: "#94a3b8", pattern: "solid", staying: true },
  { kind: "held_by_seat", label: "Held by another seat", short: "Other seat", light: "#a8a29e", dark: "#78716c", pattern: "hstripes", staying: true },
  { kind: "held_downstream", label: "Held in another wallet", short: "Other wallet", light: "#56b4e9", dark: "#7cc4ef", pattern: "dots" },
  { kind: "vehnt", label: "Locked in veHNT", short: "veHNT", light: "#0072b2", dark: "#3b9ad9", pattern: "grid" },
  { kind: "swapped", label: "Swapped", short: "Swapped", light: "#cc79a7", dark: "#e0a2c6", pattern: "cross" },
  { kind: "exchange", label: "Sent to an exchange", short: "Exchange", light: "#e69f00", dark: "#f2b632", pattern: "stripes" },
  { kind: "dc_burn", label: "Burned for Data Credits", short: "DC burn", light: "#009e73", dark: "#2fc79a", pattern: "vstripes" },
  { kind: "program_other", label: "Other program", short: "Program", light: "#d55e00", dark: "#f07a2a", pattern: "rstripes" },
  { kind: "following", label: "Still being traced", short: "Tracing", light: "#c9bc1f", dark: "#f0e442", pattern: "bigdots" },
  { kind: "not_traced", label: "Not traced further", short: "Not traced", light: "#a1a1aa", dark: "#52525b", pattern: "checker" },
];
export const FATE = Object.fromEntries(FATES.map((f, i) => [f.kind, { ...f, order: i }]));

export const fateColor = (kind, dark) => (FATE[kind] ? (dark ? FATE[kind].dark : FATE[kind].light) : dark ? "#52525b" : "#a1a1aa");

export const NOT_TRACED_REASON = {
  hop_limit: "it moved through more wallets than the trace follows",
  dust: "the amount moved on was under 1 HNT",
  limit: "the trace reached its wallet limit",
  busy: "the next wallet is too busy to follow",
};

/** The fate an outflow's kind maps to (for markers and colors). */
export function outflowFate(kind) {
  if (kind === "exchange_deposit") return "exchange";
  if (kind === "transfer") return "held_downstream";
  if (kind === "council") return "held_by_seat";
  return FATE[kind] ? kind : "program_other";
}

/** Plain words for where an outflow went: "Coinbase", "Swapped on Jupiter RFQ", "Another wallet". */
export function destinationText(o) {
  const label = o.label;
  if (o.kind === "swapped") {
    const out = (o.swapOut || []).map(fmtSwapOut).join(" + ");
    return `Swapped${o.venue && o.venue !== "Swap" ? ` on ${o.venue}` : ""}${out ? ` for ${out}` : ""}`;
  }
  if (o.kind === "exchange" || o.kind === "exchange_deposit") {
    const org = label?.org || label?.name || "an exchange";
    return o.kind === "exchange_deposit" ? `${org} (deposit address)` : org;
  }
  if (o.kind === "vehnt") return "Locked in veHNT";
  if (o.kind === "dc_burn") return "Burned for Data Credits";
  if (o.kind === "council") return "Another council seat";
  if (o.kind === "program_other") return "A program";
  return label?.name || "Another wallet";
}

export function seatTitle(seat) {
  return seat.name ? seat.name : `Seat ${seat.seat}`;
}
