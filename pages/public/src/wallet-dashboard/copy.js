// Strings more than one section shows, worded once so they never drift.
//
// Link rule: only external links (Solscan, heliumvote, the terrain tiles
// attribution) get "↗" and open a new tab, with NEW_TAB_SR in their
// accessible name (ui/ExtLink.jsx is the only renderer). Internal tool links
// (/hotspot-map, /hotspot-claimer, /update-location) open in the same tab
// without "↗".
import { fmtCount, fmtDataDay, ONBOARDED_NOTE } from "./format.js";

export { ONBOARDED_NOTE };

/** The Unclaimed InfoTip (list header and detail). */
export const UNCLAIMED_NOTE = "HNT this Hotspot has earned and not yet claimed. Claim from Unclaimed at the top of the page.";

/** Appended to an external link's accessible name. */
export const NEW_TAB_SR = ", opens in a new tab";

/** "No issues" when nothing needs a look, else "{n} of {total} need a look". */
export function needsLine(n, total) {
  return n === 0 ? "No issues" : `${fmtCount(n)} of ${fmtCount(total)} need a look`;
}

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
};
