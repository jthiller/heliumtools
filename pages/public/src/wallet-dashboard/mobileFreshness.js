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
 *   dataAt: number|null,     what the figures are from when frozen or failed
 *   savedAt: number|null,    the saved paint's check, while sections show from it
 *   asOf: string|null,       "As of 3:42 PM" beside figures shown from the saved paint, else null
 *   line: string|null,       the whole chip text at derivation time ("Live · checked 1m ago",
 *                            "Couldn't check · data from 7:42 PM")
 *   srLine: string|null      the same for screen readers (the time is visible on desktop only)
 * }}
 *   none     no Mobile Hotspots (nothing to say)
 *   checking the first check is running and nothing is painted
 *   saved    sections show from the saved paint and no check has finished on this page
 *   live     a check finished within the freshness window
 *   updating a later check is running after the data went stale (no sliding window to freeze)
 *   paused   the page is hidden (no checks run)
 *   error    the worker failed or every table failed
 *   frozen   live data older than the freshness window: a sliding window ends at its last good check
 */
export function mobileFreshness(activity, mobile) {
  const now = activity?.asOf || Date.now();
  if (!activity || !mobile || mobile.mobileTotal === 0) {
    return { state: "none", word: null, showChecked: false, dotClass: "", checkedAt: null, dataAt: null, savedAt: null, asOf: null, line: null, srLine: null };
  }
  let checkedAt = null;
  for (const t of Object.values(activity.tables || {})) if (t?.okAt && (!checkedAt || t.okAt > checkedAt)) checkedAt = t.okAt;
  const savedAt = activity.cachedSections?.length ? (activity.cachedAt ?? null) : null;
  const frozenWindow = SLIDING_TABLES.some((s) => mobile.windows?.[s] && mobile.windows[s].current === false && activity[s] != null);

  let state;
  if (activity.phase === "error") state = "error";
  else if (!activity.checked) state = savedAt ? "saved" : "checking";
  else if (activity.paused) state = "paused";
  else if (frozenWindow) state = "frozen";
  else if (activity.stale || activity.phase === "loading") state = "updating";
  else state = "live";

  const dataAt = state === "error" || state === "frozen" ? (checkedAt ?? savedAt) : null;
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
  return {
    state,
    word,
    showChecked,
    dotClass: DOT[state],
    checkedAt,
    dataAt,
    savedAt,
    asOf: state === "saved" && savedAt ? `As of ${fmtClock(savedAt, now)}` : null,
    line,
    srLine: line,
  };
}
