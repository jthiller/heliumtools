// Recently viewed wallets, kept in this browser's localStorage so the lookup
// screen can offer them again. Newest first, at most MAX_RECENT. Each entry is
// `{ address, viewedAt, hotspots }`: `hotspots` is the fleet count from the
// summary that recorded the view, or null when it had none. Nothing leaves the
// browser; the lookup screen can remove one entry or clear the list.
import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem } from "../lib/utils.js";

const KEY = "heliumtools:wallet-dashboard:recent:v1";
const MAX_RECENT = 8;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const isEntry = (e) =>
  e &&
  typeof e.address === "string" &&
  BASE58_RE.test(e.address) &&
  Number.isFinite(e.viewedAt) &&
  e.viewedAt > 0 &&
  (e.hotspots == null || Number.isInteger(e.hotspots));

/** The saved list, newest first; [] when storage is empty, unreadable or malformed. */
export function readRecentWallets() {
  try {
    const list = JSON.parse(getLocalStorageItem(KEY) || "[]");
    if (!Array.isArray(list)) return [];
    // A hand-edited list could repeat an address; keep its newest entry.
    const seen = new Set();
    return list
      .filter((e) => isEntry(e) && !seen.has(e.address) && seen.add(e.address))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function write(list) {
  if (list.length) setLocalStorageItem(KEY, JSON.stringify(list));
  else removeLocalStorageItem(KEY);
}

/**
 * Move `address` to the front, stamped now, with this view's Hotspot count
 * (null when the view had none, so an older count never reads as current).
 */
export function rememberWallet(address, { hotspots } = {}) {
  if (!BASE58_RE.test(address || "")) return;
  const entry = { address, viewedAt: Date.now(), hotspots: Number.isInteger(hotspots) ? hotspots : null };
  write([entry, ...readRecentWallets().filter((e) => e.address !== address)].slice(0, MAX_RECENT));
}

/** Drop one wallet from the list; returns the list that remains. */
export function forgetWallet(address) {
  const list = readRecentWallets().filter((e) => e.address !== address);
  write(list);
  return list;
}

/** Drop the whole list. */
export function clearRecentWallets() {
  removeLocalStorageItem(KEY);
}

/** True when a storage event (another tab) changed the list; a clear() reports key null. */
export const isRecentWalletsKey = (key) => key === KEY || key === null;
