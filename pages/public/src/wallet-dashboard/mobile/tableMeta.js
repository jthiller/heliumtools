// What the page itself needs to know about the Mobile tables: their names,
// which windows slide (and how long), which only WiFi Hotspots appear in, and
// how fresh a window must be. Kept apart from tables.js, whose column lists
// and row functions only the worker runs, so the dashboard bundle doesn't
// carry them.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** How often a visible page checks every table (mobileClient.js). */
export const CHECK_INTERVAL_MS = 2 * MINUTE_MS;
/**
 * A sliding window ends at "now" only while its table is fresh: its last
 * check succeeded within two check intervals plus a minute. Otherwise (a
 * failed or overdue check, a hidden or sleeping page) it stays frozen at the
 * last successful check, and the table's `until` says so.
 */
export const FRESH_MS = 2 * CHECK_INTERVAL_MS + MINUTE_MS;

/** Whether a sliding window (its table's `until`) still ends at about now. */
export function isWindowCurrent(until, now = Date.now()) {
  return until != null && now - until <= FRESH_MS;
}

/**
 * Per table (tables.js defines the same names, in this order): `window`, the
 * length of a window that slides with the clock ({ minutes } or { hours }),
 * null otherwise; `wifiOnly`, only WiFi indoor/outdoor Hotspots appear, so a
 * fleet without any skips the table.
 */
export const TABLE_META = {
  rewards: { window: null, wifiOnly: false },
  usage: { window: null, wifiOnly: false },
  bans: { window: null, wifiOnly: false },
  heartbeats: { window: { minutes: 60 }, wifiOnly: true },
  invalidHeartbeats: { window: { minutes: 60 }, wifiOnly: true },
  speedtests: { window: { hours: 24 }, wifiOnly: true },
};

export const TABLE_NAMES = Object.keys(TABLE_META);
/** Tables whose window slides with the clock; each reports its window's end as `until`. */
export const SLIDING_TABLES = TABLE_NAMES.filter((name) => TABLE_META[name].window);
/** Tables only WiFi indoor/outdoor Hotspots appear in. */
export const WIFI_TABLES = TABLE_NAMES.filter((name) => TABLE_META[name].wifiOnly);
/** A sliding table's window length, { minutes } or { hours }; null for other tables. */
export const windowLength = (name) => TABLE_META[name]?.window ?? null;
/** A window length in ms. */
export const windowMs = ({ minutes = 0, hours = 0 }) => minutes * MINUTE_MS + hours * HOUR_MS;

/** Great-circle distance in meters. */
export function metersBetween(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
