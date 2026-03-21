/**
 * Joins class names, filtering out falsy values
 * @param {...(string|boolean|undefined|null)} classes
 * @returns {string}
 */
export const classNames = (...classes) => classes.filter(Boolean).join(" ");

/** Format as USD currency (e.g. "$1,234.56") */
export const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

/** Format plain numbers with commas (e.g. "1,234,567") */
export const numberFormatter = new Intl.NumberFormat("en-US");

/** Truncate a long string with ellipsis (e.g. "AABBCCDD...0011") */
export function truncateString(str, head = 6, tail = 4) {
  if (!str || str.length <= head + tail + 3) return str || "";
  return `${str.slice(0, head)}...${str.slice(-tail)}`;
}

/** Format a duration in seconds to a human-readable string (e.g. "2h 15m") */
export function formatDuration(seconds) {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Format a Unix ms timestamp to a relative time string (e.g. "3m ago") */
export function formatTimeAgo(timestampMs) {
  if (!timestampMs) return "-";
  const diff = Math.floor((Date.now() - timestampMs) / 1000);
  if (diff < 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

/**
 * Safe localStorage helpers to handle private browsing mode
 * where localStorage may throw exceptions
 */

/**
 * Safely get an item from localStorage
 * @param {string} key - The key to retrieve
 * @returns {string|null} The value or null if not found or error occurs
 */
export const getLocalStorageItem = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Safely set an item in localStorage
 * @param {string} key - The key to set
 * @param {string} value - The value to store
 */
export const setLocalStorageItem = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore errors in private browsing mode
  }
};

/**
 * Safely remove an item from localStorage
 * @param {string} key - The key to remove
 */
export const removeLocalStorageItem = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore errors in private browsing mode
  }
};
