// ── Mobile freshness ─────────────────────────────────────────────────────────
// The one derivation of how fresh the Mobile picture is, read by Summary (the
// Data status chip and popover, the Earned column), Health (the Mobile chip
// and headline), the map legend and the detail. Never re-derived in a
// section, so a "Live" can't sit next to frozen numbers on one surface and
// not another. Pure: evaluated at the hook's clock (`activity.asOf`).
import { fmtAgo } from "./format.js";
import { fmtClock } from "./mobileFormat.js";
import { SLIDING_TABLES } from "./mobile/tableMeta.js";

const DOT = { live: "", checking: "checking", saved: "checking", updating: "checking", paused: "paused", error: "error", frozen: "error", none: "" };

// The tables Mobile health reads, per fleet, and what a note calls them.
const HEALTH_TABLES_WIFI = ["bans", "heartbeats", "invalidHeartbeats", "speedtests"];
const HEALTH_TABLES_DATA_ONLY = ["bans"];
const TABLE_WORD = { bans: "bans", heartbeats: "heartbeats", invalidHeartbeats: "rejected heartbeats", speedtests: "speedtests" };
// The tables Earnings reads (HNT per day and Rewarded data, Users served),
// and what Earnings' own note calls them.
const EARNINGS_TABLES = ["rewards", "usage"];
const EARNINGS_WORD = { rewards: "earnings", usage: "users served" };

/** "heartbeats", "heartbeats and speedtests", "bans, heartbeats and speedtests". */
function joinWords(words) {
  return words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * @param {object} activity  useMobileActivity's contract
 * @param {object} mobile    aggregateMobile(hotspots, activity, activity.asOf)
 * @returns {{
 *   state: "none"|"checking"|"saved"|"live"|"updating"|"paused"|"error"|"frozen",
 *   word: string|null,       "Live", "Checking", "Saved from 3:42 PM, checking", "Updating",
 *                            "Paused while hidden", "Couldn't check"
 *   showChecked: boolean,    follow the word with "· checked {TimeAgo of checkedAt}"
 *   dotClass: string,        the `.wd-live` modifier: "" | "checking" | "paused" | "error"
 *   checkedAt: number|null,  newest successful table check (okAt), never a failed attempt
 *   dataAt: number|null,     what the figures are from when frozen or failed (the oldest
 *                            frozen window's end or failed table's last good check)
 *   savedAt: number|null,    the saved paint's check, while sections show from it
 *   asOf: string|null,       "As of 3:42 PM" beside figures shown from the saved paint, else null
 *   from: string|null,       "Showing data from 3:42 PM." whenever the figures are older than
 *                            live (saved, frozen, error), the one wording of that fact
 *   note: string|null,       the one sentence every surface shows when Mobile data couldn't
 *                            update ("Couldn't check the latest Mobile data. Showing data from
 *                            7:42 PM.", "Couldn't update bans. Showing data from 1:11 PM.",
 *                            "Couldn't load speedtests."), null when nothing failed
 *   failedTables: string[],  the Mobile health tables whose latest check failed
 *   earningsNote: string|null  Earnings' own note (Summary's Earned column, "HNT per day")
 *                            when the earnings or users-served figures on screen couldn't
 *                            update: "Couldn't update earnings and users served. Showing
 *                            data from 5:38 PM.", null otherwise (a table that never
 *                            loaded shows its own failed state instead)
 *   line: string|null,       the whole chip text at derivation time ("Live · checked 1m ago",
 *                            "Couldn't check · data from 7:42 PM")
 *   srLine: string|null      the same for screen readers (the time is visible on desktop only)
 * }}
 *   none     no Mobile Hotspots (nothing to say)
 *   checking the first check is running and nothing is painted
 *   saved    sections show from the saved paint and no check has finished on this page
 *   live     a check finished within the freshness window
 *   updating a check is running after the data went stale (a long-hidden tab coming back,
 *            sliding windows overdue while the check that renews them runs)
 *   paused   the page is hidden (no checks run)
 *   error    the worker failed or every table failed
 *   frozen   a table's latest check failed while its last good data is on screen, or a
 *            sliding window is overdue with no check running: it ends at its last good check
 */
export function mobileFreshness(activity, mobile) {
  const now = activity?.asOf || Date.now();
  if (!activity || !mobile || mobile.mobileTotal === 0) {
    return {
      state: "none",
      word: null,
      showChecked: false,
      dotClass: "",
      checkedAt: null,
      dataAt: null,
      savedAt: null,
      asOf: null,
      from: null,
      note: null,
      failedTables: [],
      earningsNote: null,
      line: null,
      srLine: null,
    };
  }
  const tables = activity.tables || {};
  let checkedAt = null;
  for (const t of Object.values(tables)) if (t?.okAt && (!checkedAt || t.okAt > checkedAt)) checkedAt = t.okAt;
  const savedAt = activity.cachedSections?.length ? (activity.cachedAt ?? null) : null;
  const frozenWindows = SLIDING_TABLES.map((s) => mobile.windows?.[s]).filter((w) => w && w.current === false && w.until != null);
  const frozenWindow = SLIDING_TABLES.some((s) => mobile.windows?.[s] && mobile.windows[s].current === false && activity[s] != null);
  // A table whose latest check failed while its last good data is on screen
  // (bans for a data-only fleet has no sliding window to freeze).
  const failedShown = Object.entries(tables).filter(([name, t]) => t?.state === "error" && activity[name] != null);
  // A check running now renews overdue windows: "Updating", not a failure.
  const running = Boolean(activity.stale) || activity.phase === "loading";

  let state;
  if (activity.phase === "error") state = "error";
  else if (!activity.checked) state = savedAt ? "saved" : "checking";
  else if (activity.paused) state = "paused";
  else if (failedShown.length || (frozenWindow && !running)) state = "frozen";
  else if (frozenWindow || running) state = "updating";
  else state = "live";

  // Frozen: what the oldest frozen figures are from (a frozen window's end, a failed table's last good check).
  const frozenAt = [...frozenWindows.map((w) => w.until), ...failedShown.map(([, t]) => t.okAt).filter(Boolean)];
  const dataAt =
    state === "error"
      ? (checkedAt ?? savedAt)
      : state === "frozen"
        ? frozenAt.length
          ? Math.min(...frozenAt)
          : (checkedAt ?? savedAt)
        : null;
  const ago = checkedAt ? fmtAgo(checkedAt, Math.max(now, checkedAt)) : null;
  let word;
  let showChecked = false;
  if (state === "checking") word = "Checking";
  else if (state === "saved") word = `Saved from ${fmtClock(savedAt, now)}, checking`;
  else if (state === "error" || state === "frozen") word = "Couldn't check";
  else {
    word = state === "live" ? "Live" : state === "updating" ? "Updating" : "Paused while hidden";
    showChecked = Boolean(checkedAt);
  }
  const line =
    showChecked && ago
      ? `${word} · checked ${ago}`
      : dataAt
        ? `${word} · data from ${fmtClock(dataAt, now)}`
        : word;

  const fromAt = state === "saved" ? savedAt : dataAt;
  const from = fromAt ? `Showing data from ${fmtClock(fromAt, now)}.` : null;

  // The note: what couldn't update, and what's shown instead.
  const relevant = mobile.wifiTotal > 0 ? HEALTH_TABLES_WIFI : HEALTH_TABLES_DATA_ONLY;
  const failing = relevant.filter((t) => tables[t]?.state === "error");
  const anyShown = Boolean(activity.rewards || activity.heartbeats || activity.bans || activity.usage);
  let note = null;
  if (state === "error") {
    note = anyShown && from ? `Couldn't check the latest Mobile data. ${from}` : "Couldn't check Mobile data.";
  } else if (failing.length) {
    const shown = failing.filter((t) => activity[t] != null);
    const missing = failing.filter((t) => activity[t] == null);
    const at = shown.map((t) => tables[t].okAt).filter(Boolean).sort((a, b) => a - b)[0] ?? dataAt ?? savedAt;
    const parts = [];
    if (shown.length) parts.push(`Couldn't update ${joinWords(shown.map((t) => TABLE_WORD[t]))}.${at ? ` Showing data from ${fmtClock(at, now)}.` : ""}`);
    if (missing.length) parts.push(`Couldn't load ${joinWords(missing.map((t) => TABLE_WORD[t]))}.`);
    note = parts.join(" ");
  } else if (state === "frozen") {
    note = from ? `Couldn't check the latest Mobile data. ${from}` : "Couldn't check the latest Mobile data.";
  }

  // Earnings' note: the earnings tables whose figures are on screen but
  // couldn't update (every table, when the whole check failed).
  const earningsStale = EARNINGS_TABLES.filter(
    (t) => activity[t] != null && (state === "error" || tables[t]?.state === "error"),
  );
  let earningsNote = null;
  if (earningsStale.length) {
    const at =
      earningsStale.map((t) => tables[t]?.okAt).filter(Boolean).sort((a, b) => a - b)[0] ?? dataAt ?? savedAt;
    earningsNote = `Couldn't update ${joinWords(earningsStale.map((t) => EARNINGS_WORD[t]))}.${at ? ` Showing data from ${fmtClock(at, now)}.` : ""}`;
  }

  return {
    state,
    word,
    showChecked,
    dotClass: DOT[state],
    checkedAt,
    dataAt,
    savedAt,
    asOf: state === "saved" && savedAt ? `As of ${fmtClock(savedAt, now)}` : null,
    from,
    note,
    failedTables: failing,
    earningsNote,
    line,
    srLine: line,
  };
}
