// ── About this fleet: view models ───────────────────────────────────────────
// Pure derivations for the About section's cards (Composition, Places,
// Onboarding over time, Onboarding fees). Counts come from the unified list's
// rows (aggregateHotspotList), so a row here and the Hotspot list's result
// line agree; recorded spellings come from deriveFleetPlaces; onboard months
// from onboardingStats (the `onboardMonthOf` rule the list's `month` filter
// uses). Shares are of the whole fleet, never of the top entry. Pure.
import { DC_PER_USD, deviceLabelOf, fmtCount, fmtUsd, fmtUtcDate, fmtUtcMonth, plural } from "../format.js";
import { filterRows } from "../hotspotList.js";

export const NET = {
  mobile: { label: "Mobile", fill: "bg-wd-mobile" },
  iot: { label: "IoT", fill: "bg-wd-iot" },
  none: { label: "Not on IoT or Mobile", fill: "wd-hatch" },
};
const NET_OF_DEVICE = {
  iotFull: "iot",
  iotDataOnly: "iot",
  iot: "iot",
  mobile: "mobile",
  cbrs: "mobile",
  wifiIndoor: "mobile",
  wifiOutdoor: "mobile",
  wifiDataOnly: "mobile",
};
const TOP_PLACES = 8;
// Up to this many Hotspots, names show under their city and beside the
// first and latest onboard dates; Places can list every city.
const NAMES_MAX = 10;
const DATE_NAMES_MAX = 200;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A share of the fleet: whole shares whole ("80%"), else one decimal ("47.0%"), "<0.1%" and ">99.9%" at the ends. */
export function shareOf(n, total) {
  if (!total) return "0%";
  if ((n * 100) % total === 0) return `${(n * 100) / total}%`;
  const v = (n / total) * 100;
  if (v < 0.05) return "<0.1%";
  if (v >= 99.95) return ">99.9%";
  return `${v.toFixed(1)}%`;
}

/** A bar width as a share of the fleet (any nonzero count keeps a 2 px mark in CSS). */
export const widthOf = (n, total) => `${total ? ((n / total) * 100).toFixed(2) : 0}%`;

/** "A", "A and B", "A, B and C". */
export function joinAnd(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const nameOf = (row) => row.name || "Unnamed Hotspot";
const byName = new Intl.Collator("en-US").compare;

/**
 * Composition: the network split (each Hotspot once: on IoT counts under IoT,
 * as its onboarding fee does), devices, rewarded and location.
 */
export function compositionOf(list) {
  const total = list.counts.total;
  const counts = { mobile: 0, iot: 0, none: 0 };
  let dual = 0;
  let unasserted = 0;
  const rew = { rewarded: 0, never: 0, failed: 0, unavailable: 0, loading: 0 };
  for (const r of list.rows) {
    if (r.nets.iot) counts.iot++;
    else if (r.nets.mobile) counts.mobile++;
    else counts.none++;
    if (r.nets.dual) dual++;
    if (!r.asserted) unasserted++;
    const l = r.lifetime;
    if (l.state === "ok") {
      if (l.never) rew.never++;
      else rew.rewarded++;
    } else if (l.state === "failed") rew.failed++;
    else if (l.state === "unavailable") rew.unavailable++;
    else rew.loading++;
  }
  const parts = ["mobile", "iot"]
    .filter((k) => counts[k] > 0)
    .sort((a, b) => counts[b] - counts[a])
    .concat(counts.none > 0 ? ["none"] : [])
    .map((key) => ({ key, label: NET[key].label, fill: NET[key].fill, count: counts[key], share: shareOf(counts[key], total) }));
  const splitLabel = `Network split: ${parts.map((p) => `${p.label} ${fmtCount(p.count)}, ${p.share}`).join("; ")}`;
  let dualNote = null;
  if (dual > 0) {
    const lead =
      dual === counts.iot
        ? counts.iot === 1
          ? "The IoT Hotspot is also on Mobile."
          : `All ${fmtCount(dual)} IoT Hotspots are also on Mobile.`
        : `${plural(dual, "IoT Hotspot")} ${dual === 1 ? "is" : "are"} also on Mobile.`;
    dualNote = `${lead} Each Hotspot counts once, under IoT.`;
  }

  const devices = Object.entries(list.counts.devices)
    .map(([key, n]) => ({ key, label: deviceLabelOf(key), net: NET_OF_DEVICE[key] ?? null, count: n, share: shareOf(n, total), width: widthOf(n, total) }))
    .sort((a, b) => b.count - a.count || byName(a.label, b.label));

  const checked = rew.rewarded + rew.never;
  const unchecked = rew.failed + rew.unavailable;
  const scanning = !list.settled.rewards;
  const rewardedState = scanning ? (checked === 0 ? "checking" : "scanning") : checked === 0 && unchecked > 0 ? "failed" : "ready";

  return {
    total,
    parts,
    splitLabel,
    dualNote,
    devices,
    rewarded: { state: rewardedState, ...rew, checked, unchecked, total },
    unasserted,
  };
}

const cityLabelOf = (place) => (place.city && place.state ? `${place.city}, ${place.state}` : place.city);

/**
 * Places, as recorded: every asserted Hotspot under its city label ("Lutz,
 * FL"), a state with no city ("Florida (no city)") or "Place not reported";
 * unasserted Hotspots on their own line, so the parts sum to the fleet.
 * Duplicate spellings come from deriveFleetPlaces (`aliasOf`).
 * @param {object} list  aggregateHotspotList result
 * @param {object} places  deriveFleetPlaces result
 * @param {{ expanded?: boolean }} [opts]  show every city of a fleet of 200 or fewer
 */
export function placesOf(list, places, { expanded = false } = {}) {
  const total = list.counts.total;
  const groups = new Map();
  const unassertedRows = [];
  for (const r of list.rows) {
    if (!r.asserted) {
      unassertedRows.push(r);
      continue;
    }
    const city = cityLabelOf(r.place);
    const kind = city ? "city" : r.place.state ? "state" : "none";
    const label = kind === "city" ? city : kind === "state" ? `${r.place.state} (no city)` : "Place not reported";
    const key = `${kind}|${label}`;
    let g = groups.get(key);
    if (!g) {
      // The list's search matches entity keys too, so a query of 3 letters
      // or fewer ("FL") could match keys at random: those rows stay static.
      const query = kind === "city" ? r.place.city : kind === "state" ? r.place.state : null;
      g = { key, kind, label, query: query && query.length > 3 ? query : null, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(r);
  }

  // Spellings: a city label belongs to its canonical spelling's group.
  const canonicalCity = new Map((places?.cities || []).map((c) => [c.label, c.aliasOf ?? c.label]));
  const spellings = new Map();
  for (const [label, canon] of canonicalCity) spellings.set(canon, [...(spellings.get(canon) || []), label]);
  const cities = [...groups.values()].filter((g) => g.kind === "city");
  const cityCount = new Map(cities.map((g) => [g.label, g.rows.length]));
  const decorate = (g) => {
    const canon = canonicalCity.get(g.label) ?? g.label;
    const spelled = g.kind === "city" ? (spellings.get(canon) || []).filter((l) => cityCount.has(l)).length : 1;
    return {
      key: g.key,
      kind: g.kind,
      label: g.label,
      query: g.query,
      // What the list shows for that query, by its own search rule: the same
      // city under another state spelling ("Stockton, California") or another
      // state ("New York, NJ") widens it past this row's count.
      matches: g.query ? filterRows(list, { q: g.query }).count : null,
      count: g.rows.length,
      share: shareOf(g.rows.length, total),
      width: widthOf(g.rows.length, total),
      spellings: spelled > 1 ? spelled : 0,
      names:
        total <= NAMES_MAX
          ? [...g.rows].sort((a, b) => byName(nameOf(a), nameOf(b))).map((r) => ({ key: r.key, param: r.param, name: nameOf(r) }))
          : null,
    };
  };
  const bySize = (a, b) => b.rows.length - a.rows.length || byName(a.label, b.label);
  cities.sort(bySize);
  const others = [...groups.values()].filter((g) => g.kind !== "city").sort(bySize);
  const aliasCities = cities.some((g) => (spellings.get(canonicalCity.get(g.label) ?? g.label) || []).filter((l) => cityCount.has(l)).length > 1);
  const cityWord = (n, other = false) => `${other ? "other " : ""}${n === 1 ? (aliasCities ? "city label" : "city") : aliasCities ? "city labels" : "cities"}`;

  const all = cities.length <= TOP_PLACES || (expanded && total <= DATE_NAMES_MAX);
  const shown = all ? [...cities, ...others] : cities.slice(0, TOP_PLACES);
  const restCities = all ? [] : cities.slice(TOP_PLACES);
  const restNoCity = all ? 0 : others.reduce((s, g) => s + g.rows.length, 0);
  const restCount = restCities.reduce((s, g) => s + g.rows.length, 0) + restNoCity;
  const canExpand = total <= DATE_NAMES_MAX && cities.length > TOP_PLACES;

  let rest = null;
  if (restCount > 0) {
    const eachOne = restNoCity === 0 && restCities.every((g) => g.rows.length === 1);
    const where = restCities.length
      ? `in ${fmtCount(restCities.length)} ${cityWord(restCities.length, true)}${restNoCity ? ", or with no city" : ""}`
      : "with no city";
    rest = { text: `${fmtCount(restCount)} more ${where}${eachOne && restCities.length > 1 ? ", 1 Hotspot each" : ""}`, share: shareOf(restCount, total) };
  }

  // The note for the biggest city recorded two ways.
  let cityNote = null;
  let best = null;
  for (const [, labels] of spellings) {
    const present = labels.filter((l) => cityCount.has(l));
    if (present.length < 2) continue;
    const n = present.reduce((s, l) => s + cityCount.get(l), 0);
    if (!best || n > best.n) best = { labels: present.sort((a, b) => cityCount.get(b) - cityCount.get(a)), n };
  }
  if (best) {
    cityNote = `Places are shown as recorded. ${joinAnd(best.labels)} are one city: ${plural(best.n, "Hotspot")}, ${shareOf(best.n, total)} of the fleet.`;
  }

  // States: shown when the city rows don't already say where every Hotspot is.
  const stateLabels = (places?.states || []).filter((s) => s.label);
  const showStates = stateLabels.length > 1 && (!all || others.length > 0);
  const stateGroups = new Map();
  for (const s of stateLabels) {
    const canon = s.aliasOf ?? s.label;
    const g = stateGroups.get(canon) ?? { labels: [], n: 0 };
    g.labels.push(s.label);
    g.n += s.count;
    stateGroups.set(canon, g);
  }
  const statePair = [...stateGroups.values()].filter((g) => g.labels.length > 1).sort((a, b) => b.n - a.n)[0] ?? null;
  const stateNote = statePair ? `Places are shown as recorded. ${joinAnd(statePair.labels)} are one state.` : null;
  let states = null;
  if (showStates) {
    const aliasStates = Boolean(statePair);
    const top = stateLabels.slice(0, TOP_PLACES);
    const word = (n) => (n === 1 ? (aliasStates ? "state label" : "state") : aliasStates ? "state labels" : "states");
    states = {
      eyebrow: stateLabels.length > TOP_PLACES ? "Top states" : "States",
      caption:
        stateLabels.length > TOP_PLACES
          ? `${fmtCount(top.length)} of ${fmtCount(stateLabels.length)} ${word(stateLabels.length)}`
          : `${fmtCount(stateLabels.length)} ${word(stateLabels.length)}`,
      chips: top.map((s) => ({ label: s.label, count: s.count })),
      note: !statePair
        ? null
        : cityNote
          ? `${joinAnd(statePair.labels)} are one state recorded two ways: ${plural(statePair.n, "Hotspot")} between them.`
          : stateNote,
    };
  }

  const countries = (places?.countries || []).filter((c) => !c.aliasOf);
  const caption =
    places?.region && stateLabels.length === 1
      ? places.region
      : countries.length === 0
        ? null
        : countries.length <= 3
          ? countries.map((c) => c.label).join(", ")
          : `${fmtCount(countries.length)} countries`;

  return {
    caption,
    eyebrow: all ? "Cities" : "Top cities",
    citiesCaption: all
      ? cities.length > 1
        ? `${fmtCount(cities.length)} ${cityWord(cities.length)}`
        : null
      : `${fmtCount(shown.length)} of ${fmtCount(cities.length)} ${cityWord(cities.length)}`,
    rows: shown.map(decorate),
    rest,
    unasserted: unassertedRows.length ? { count: unassertedRows.length, share: shareOf(unassertedRows.length, total) } : null,
    canExpand,
    expanded: all && canExpand,
    cityTotal: cities.length,
    // Under the cities: the city recorded two ways, else (with no States
    // block to say it) the state recorded two ways.
    note: cityNote ?? (showStates ? null : stateNote),
    states,
  };
}

/** Onboarding fees: the total and one line per network and fee amount. */
export function feesOf(list) {
  const groups = new Map();
  let dc = 0;
  let noFee = 0;
  let dual = 0;
  for (const r of list.rows) {
    if (r.nets.dual) dual++;
    const fee = Number(r.hotspot?.dcOnboardingFeePaid);
    if (!Number.isFinite(fee) || r.hotspot?.dcOnboardingFeePaid == null) {
      noFee++;
      continue;
    }
    dc += fee;
    const net = r.nets.iot ? "iot" : r.nets.mobile ? "mobile" : null;
    const key = `${net}|${fee}`;
    const g = groups.get(key) ?? { net, each: fee, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  const lines = [...groups.values()]
    .sort((a, b) => b.count - a.count || b.each * b.count - a.each * a.count)
    .map((g) => ({
      key: `${g.net}|${g.each}`,
      net: g.net,
      label: `${fmtCount(g.count)} ${g.net ? `${NET[g.net].label} ` : ""}${g.count === 1 ? "Hotspot" : "Hotspots"} · ${fmtCount(g.each)} DC each`,
      value: `${fmtCount(g.count * g.each)} DC`,
    }));
  if (noFee > 0) lines.push({ key: "none", net: null, label: `${plural(noFee, "Hotspot")} · no fee on record`, value: "None" });
  const note =
    dual > 0
      ? dual === 1
        ? "For the Hotspot on both networks, only the IoT fee is counted."
        : `For the ${fmtCount(dual)} Hotspots on both networks, only the IoT fee is counted.`
      : null;
  return { dc, dcText: fmtCount(dc), usd: fmtUsd(dc / DC_PER_USD), lines, note, anyFee: groups.size > 0 };
}

/** "Mobile" / "IoT" counts of one month, for the readout and the table. */
export function monthSplit(m) {
  const parts = [];
  if (m.mobile) parts.push(`${fmtCount(m.mobile)} Mobile`);
  if (m.iot) parts.push(`${fmtCount(m.iot)} IoT`);
  return parts.join(", ");
}

const monthAxis = (month) => {
  const [y, m] = month.split("-");
  return `${MONTH_SHORT[Number(m) - 1]} ’${y.slice(2)}`;
};

// The chart's top line: a round number at or above the busiest month.
function niceMax(max) {
  if (max <= 5) return Math.max(max, 1);
  const p = 10 ** Math.floor(Math.log10(max));
  const f = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x * p >= max);
  return f * p;
}

/**
 * Onboarding over time from onboardingStats: a continuous monthly axis (zero
 * months included), each month stacked Mobile over IoT, a top tick, direct
 * labels on the busiest and the latest month, year marks on the axis.
 * @returns {null | { months, top, axis, range, single, dated, legend }}
 */
export function timelineOf(stats, total) {
  const timeline = stats?.timeline || [];
  if (!timeline.length) return null;
  const max = Math.max(...timeline.map((m) => m.count));
  const top = niceMax(max);
  const maxIdx = timeline.findIndex((m) => m.count === max);
  const last = timeline.length - 1;
  const n = timeline.length;
  const months = timeline.map((m, i) => ({
    ...m,
    full: fmtUtcMonth(m.month),
    height: m.count > 0 ? (m.count / top) * 100 : 0,
    label: (i === maxIdx || i === last) && m.count > 0 ? fmtCount(m.count) : null,
  }));
  const axis = [{ key: "first", text: monthAxis(timeline[0].month), style: { left: 0 } }];
  timeline.forEach((m, i) => {
    if (m.month.endsWith("-01") && i > 3 && i < n - 4) {
      axis.push({ key: m.month, text: m.month.slice(0, 4), style: { left: `${(((i + 0.5) / n) * 100).toFixed(2)}%`, transform: "translateX(-50%)" } });
    }
  });
  if (n > 1) axis.push({ key: "last", text: monthAxis(timeline[last].month), style: { right: 0 } });
  const hasIot = timeline.some((m) => m.iot > 0);
  const hasMobile = timeline.some((m) => m.mobile > 0);
  return {
    months,
    top,
    axis,
    range: `${months[0].full} to ${months[last].full} (UTC)`,
    single: n === 1,
    dated: stats.dated ?? timeline.reduce((s, m) => s + m.count, 0),
    total,
    legend: [hasIot && "iot", hasMobile && "mobile"].filter(Boolean),
  };
}

/** "All 10 Hotspots dated", or "1,656 of 1,659 Hotspots dated · 3 without an onboard date". */
export function datedText(dated, total) {
  if (dated >= total) return total === 2 ? "Both Hotspots dated" : `All ${plural(total, "Hotspot")} dated`;
  return `${fmtCount(dated)} of ${plural(total, "Hotspot")} dated · ${fmtCount(total - dated)} without an onboard date`;
}

const utcTime = (iso) => iso.slice(11, 16);
const utcDayShort = (iso) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** The one-month fleet's sentence: "All 26 onboarded in Aug 2025 (UTC)" and when within it. */
export function singleMonthText(stats, total) {
  const dated = stats.dated ?? 0;
  const month = fmtUtcMonth(stats.timeline[0].month);
  const head = dated >= total ? `All ${fmtCount(dated)} onboarded in ${month} (UTC)` : `${fmtCount(dated)} onboarded in ${month} (UTC)`;
  const { oldest, newest } = stats;
  let sub = null;
  if (oldest && newest) {
    const who = dated >= total ? "Every one" : "Each";
    if (oldest.slice(0, 10) === newest.slice(0, 10)) {
      sub =
        utcTime(oldest) === utcTime(newest)
          ? `${who} on ${fmtUtcDate(oldest)} at ${utcTime(oldest)} UTC.`
          : `${who} on ${fmtUtcDate(oldest)}, between ${utcTime(oldest)} and ${utcTime(newest)} UTC.`;
    } else {
      sub = `From ${utcDayShort(oldest)} to ${fmtUtcDate(newest)} (UTC).`;
    }
  }
  return { head, sub };
}

/** The Hotspot (row) whose earliest onboard date is `iso`, for fleets small enough to name it. */
export function hotspotOnboardedAt(list, iso) {
  if (!iso || list.counts.total > DATE_NAMES_MAX) return null;
  const row = list.rows.find((r) => r.onboarded.at === iso);
  return row ? { key: row.key, param: row.param, name: nameOf(row) } : null;
}
