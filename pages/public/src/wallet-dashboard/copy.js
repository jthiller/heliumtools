// Strings more than one section shows, worded once so they never drift.
//
// Link rule: only external links (Solscan, heliumvote, the terrain tiles
// attribution) get "↗" and open a new tab, with NEW_TAB_SR in their
// accessible name (ui/ExtLink.jsx is the only renderer). Internal tool links
// (/hotspot-map, /hotspot-claimer, /update-location) open in the same tab
// without "↗".
import { fmtCount, fmtDataDay, plural, ONBOARDED_NOTE } from "./format.js";

export { ONBOARDED_NOTE };

/** The Unclaimed InfoTip (list header and detail). */
export const UNCLAIMED_NOTE = "HNT this Hotspot has earned and not yet claimed. Claim from Unclaimed at the top of the page.";

/** Appended to an external link's accessible name. */
export const NEW_TAB_SR = ", opens in a new tab";

/**
 * How many need a look, the one wording for every surface:
 *   needsLine(0, 10)                     "No issues"
 *   needsLine(0, 10, { partial: true })  "0 of 10 need a look" (a source failed or
 *                                        froze, so "No issues" would be a claim)
 *   needsLine(1, 10)                     "1 of 10 needs a look"
 *   needsLine(3, 10, { noun: true })     "3 of 10 Hotspots need a look"
 *   needsLine(1)                         "1 needs a look" (a group: a map site)
 *   needsLine(0)                         "none need a look"
 */
export function needsLine(n, total, { partial = false, noun = false } = {}) {
  const verb = n === 1 ? "needs" : "need";
  if (total == null) return n === 0 ? "none need a look" : `${fmtCount(n)} ${verb} a look`;
  if (n === 0 && !partial) return "No issues";
  return `${fmtCount(n)} of ${noun ? plural(total, "Hotspot") : fmtCount(total)} ${verb} a look`;
}

/**
 * The one failure sentence for a per-Hotspot check, on every surface:
 * couldntCheck("rewards", 3) "Couldn't check rewards for 3 Hotspots."
 * (`what`: "rewards", "IoT status", "Mobile activity").
 */
export const couldntCheck = (what, n) => `Couldn't check ${what} for ${plural(n, "Hotspot")}.`;

/** A rewards figure over the Hotspots that answered: "From 800 of 2,172 Hotspots. 1,372 couldn't be checked." */
export const rewardsFromScope = (total, failed) =>
  `From ${fmtCount(total - failed)} of ${plural(total, "Hotspot")}. ${fmtCount(failed)} couldn't be checked.`;

/** Why a lifetime total is a lower bound: "A lower bound: 176 couldn't be confirmed right now." */
export const lowerBoundClause = (n) => `A lower bound: ${fmtCount(n)} couldn't be confirmed right now.`;

/** Why one Hotspot's lifetime figure is a lower bound (its unclaimed amount couldn't be confirmed). */
export const LOWER_BOUND_NOTE = "Couldn't confirm unclaimed HNT right now, so this is the HNT claimed so far, a lower bound.";

/** Users served (Earnings and the detail InfoTips). */
export const USERS_NOTE = "Counted per Hotspot, so a user served by two of your Hotspots counts twice.";

/**
 * Why there's no daily HNT for a Hotspot type, the one sentence on every
 * surface (Summary, Earnings, the detail, the list's band InfoTip):
 * noDailyNote("IoT Hotspots") "Daily HNT is published only for Mobile data
 * transfer. IoT Hotspots' HNT is in Unclaimed and Lifetime earned."
 */
export const noDailyNote = (subject = "IoT Hotspots") => `Daily HNT is published only for Mobile data transfer. ${hntWhere(subject)}`;

/** Where a Hotspot type's HNT is instead: "IoT Hotspots' HNT is in Unclaimed and Lifetime earned." */
export const hntWhere = (subject = "IoT Hotspots") =>
  `${subject}${subject.endsWith("s") ? "'" : "'s"} HNT is in Unclaimed and Lifetime earned.`;

/** Data-only Hotspots, wherever WiFi signals are named. */
export const DATA_ONLY_NOTE = "Data-only Hotspots don't send heartbeats or speedtests.";

/** WiFi health signals vs earnings, wherever heartbeats are named. */
export const WIFI_SIGNALS_NOTE =
  "Heartbeats, location trust and speedtests are WiFi health signals. HNT from data transfer doesn't depend on them.";

/** A reward day not published yet, in the 7-day charts' readouts. */
export const DAY_MISSING_NOTE = "Not published yet. Left out of the total.";

/** The Hotspot list's Unclaimed total while veHNT rewards are pending too
 * (the table's footer and the phone list's total strip). */
export const HOTSPOTS_ONLY_NOTE = "Hotspots only. Unclaimed at the top includes veHNT.";

/** Nothing to claim (Summary and Earnings). */
export const NOTHING_TO_CLAIM = "Nothing to claim right now.";

/** The claim actions' labels, one per destination, on every surface. */
export const CLAIM_LABEL = { hotspots: "Claim Hotspot rewards", veHnt: "Claim veHNT rewards" };

/** The one label for clearing every list filter (status, network, device, search, month). */
export const CLEAR_FILTERS = "Clear filters";

/**
 * Health's section caption, by what each module covers:
 * "IoT for Oct 14 (UTC). Mobile WiFi for the last 60 min and 24 h."
 *   iotDay       the IoT data day (YYYY-MM-DD), null while unknown or failed
 *   hasIot       the wallet has IoT Hotspots
 *   windows      aggregateMobile's windows (null without Mobile Hotspots)
 *   wifi         the fleet has WiFi Hotspots (else Mobile is bans only)
 */
export function healthScope({ iotDay, hasIot, windows, wifi }) {
  const iot = !hasIot ? null : iotDay ? `IoT for ${fmtDataDay(iotDay)} (UTC).` : "IoT by latest reported UTC day.";
  let mob = null;
  if (windows) {
    const hb = windows.heartbeats;
    const sp = windows.speedtests;
    const hbFrozen = hb?.current === false;
    const spFrozen = sp?.current === false;
    if (!wifi) mob = "Mobile bans, latest record per Hotspot.";
    else if (!hbFrozen && !spFrozen) mob = "Mobile WiFi for the last 60 min and 24 h.";
    else if (hbFrozen && spFrozen && hb.until === sp.until) mob = `Mobile WiFi for the 60 min and ${sp.short}.`;
    else mob = `Mobile WiFi heartbeats for the ${hbFrozen ? hb.short : "last 60 min"}, speedtests for the ${spFrozen ? sp.short : "last 24 h"}.`;
  }
  return [iot, mob].filter(Boolean).join(" ");
}

/** The fleet-failed lines of the sections that need the Hotspot list. */
export const FLEET_UNAVAILABLE = {
  health: "Hotspot health is unavailable until the Hotspot list loads.",
  about: "Fleet facts are unavailable until the Hotspot list loads.",
  map: "The map is unavailable until the Hotspot list loads.",
};
