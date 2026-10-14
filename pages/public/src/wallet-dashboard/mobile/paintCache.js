// Instant paint for the Mobile activity card: the last assembled state per
// wallet in localStorage (the worker can't reach it, so the main thread
// writes it, once per finished check). Painted state is marked `cached` until
// the first live check. Each entry stays ≤ 50 KB and only the five most
// recently checked wallets stay. To fit, entity keys (366 chars for WiFi
// Hotspots, repeated in every `byKey` map) are stored once in a dictionary,
// and larger fleets are saved progressively lighter. Sliding sections keep
// their own `until`, so a saved window is labeled by when it ended.
import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem } from "../../lib/utils.js";

const PREFIX = "heliumtools:wallet-dashboard:mobile:v1:";
// Not a valid wallet address, so it can't collide with one.
const RECENT_KEY = `${PREFIX}recent`;
const MAX_WALLETS = 5;
const MAX_CHARS = 50_000;

export const PAINT_SECTIONS = ["rewards", "usage", "heartbeats", "invalidHeartbeats", "speedtests", "bans"];
const SLIDING_SECTIONS = ["heartbeats", "invalidHeartbeats", "speedtests"];

const mapValues = (obj, fn) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [k, fn(v)]));
const withByKey = (section, fn) => section && { ...section, byKey: fn(section.byKey) };

// Applied in turn until the entry fits, each step keeping the contract's shape
// (emptied arrays, not missing fields; a null section is "not loaded"): the
// full state; without map points, single speedtests and the per-carrier
// split; without per-Hotspot daily HNT; then the 7 daily fleet HNT totals alone.
// A step returns the sections it doesn't change as they were, so each one is
// serialized once.
const TRIMS = [
  (s) => s,
  (s) => ({
    ...s,
    heartbeats: withByKey(s.heartbeats, (m) => mapValues(m, (v) => ({ ...v, points: [] }))),
    speedtests: withByKey(s.speedtests, (m) => mapValues(m, (v) => ({ ...v, tests: [] }))),
    usage: withByKey(s.usage, (m) => mapValues(m, (v) => ({ ...v, carriers: [] }))),
  }),
  (s) => ({ ...s, rewards: withByKey(s.rewards, () => ({})) }),
  (s) => ({
    ...s,
    tables: s.rewards ? { rewards: s.tables.rewards } : {},
    usage: null,
    heartbeats: null,
    invalidHeartbeats: null,
    speedtests: null,
    bans: null,
  }),
];

function decodeKeys(saved) {
  const keys = saved.keys || [];
  const out = { ...saved };
  delete out.keys;
  for (const s of PAINT_SECTIONS) {
    out[s] = withByKey(saved[s], (m) => Object.fromEntries(Object.entries(m || {}).map(([i, v]) => [keys[i], v])));
  }
  // Saved before every sliding section carried its window's end.
  for (const s of SLIDING_SECTIONS) {
    if (out[s] && out[s].until == null) {
      out[s] = { ...out[s], until: out.tables?.[s]?.okAt ?? out.tables?.[s]?.checkedAt ?? out.checkedAt ?? null };
    }
  }
  return out;
}

/** The saved state for `wallet`, or null. */
export function readPaint(wallet) {
  if (!wallet) return null;
  const raw = getLocalStorageItem(PREFIX + wallet);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    return saved?.wallet === wallet && Array.isArray(saved.keys) ? decodeKeys(saved) : null;
  } catch {
    return null;
  }
}

function touchRecent(wallet) {
  let list = [];
  try {
    list = JSON.parse(getLocalStorageItem(RECENT_KEY) || "[]");
  } catch {
    // start over
  }
  if (!Array.isArray(list)) list = [];
  list = [wallet, ...list.filter((w) => w !== wallet)];
  for (const w of list.slice(MAX_WALLETS)) removeLocalStorageItem(PREFIX + w);
  setLocalStorageItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_WALLETS)));
}

/**
 * Save a finished check for `wallet`. `totals`: { mobileTotal, wifiTotal }.
 * A section whose table failed this check keeps its saved copy (with that
 * copy's table entry); a check with nothing to paint keeps the older entry.
 * Each section variant is serialized at most once, and a trim whose key
 * dictionary alone can't fit is skipped unserialized.
 */
export function writePaint(wallet, state, totals) {
  if (!wallet || !state) return false;
  const tables = { ...(state.tables || {}) };
  if (!Object.values(tables).some((t) => t.state === "ok")) return false;
  const sections = {};
  let prev;
  for (const s of PAINT_SECTIONS) {
    sections[s] = state[s] ?? null;
    if (sections[s] == null && tables[s]?.state === "error") {
      prev ??= readPaint(wallet) ?? {};
      if (prev[s] != null) {
        sections[s] = prev[s];
        if (prev.tables?.[s]) tables[s] = prev.tables[s];
      }
    }
  }
  if (PAINT_SECTIONS.every((s) => sections[s] == null)) return false;

  // byKey maps are keyed by dictionary index ("0", "1", …): every key any
  // section names, once. Trims empty byKey maps but share this dictionary.
  const index = new Map();
  for (const s of PAINT_SECTIONS) {
    for (const k of Object.keys(sections[s]?.byKey || {})) if (!index.has(k)) index.set(k, index.size);
  }
  let dictChars = 2;
  for (const k of index.keys()) dictChars += k.length + 3; // quotes and comma
  const serialized = new Map();
  const json = (section) => {
    if (section == null) return "null";
    let out = serialized.get(section);
    if (out == null) {
      const encoded = withByKey(section, (m) =>
        Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [String(index.get(k)), v])),
      );
      out = JSON.stringify(encoded);
      serialized.set(section, out);
    }
    return out;
  };
  const head = JSON.stringify({
    wallet,
    savedAt: Date.now(),
    mobileTotal: totals?.mobileTotal ?? 0,
    wifiTotal: totals?.wifiTotal ?? 0,
    checkedAt: state.checkedAt ?? null,
  }).slice(0, -1);

  let entry = { tables, ...sections };
  for (const trim of TRIMS) {
    entry = trim(entry);
    const keyed = PAINT_SECTIONS.some((s) => entry[s]?.byKey && Object.keys(entry[s].byKey).length > 0);
    if (keyed && dictChars > MAX_CHARS) continue;
    const parts = PAINT_SECTIONS.map((s) => `${JSON.stringify(s)}:${json(entry[s])}`);
    const keys = keyed ? JSON.stringify([...index.keys()]) : "[]";
    const out = `${head},"tables":${JSON.stringify(entry.tables)},${parts.join(",")},"keys":${keys}}`;
    if (out.length <= MAX_CHARS) {
      setLocalStorageItem(PREFIX + wallet, out);
      touchRecent(wallet);
      return true;
    }
  }
  // Too large even trimmed: don't leave an older paint behind.
  removeLocalStorageItem(PREFIX + wallet);
  return false;
}
