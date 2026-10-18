import { useEffect, useMemo, useRef, useState } from "react";
import { createMobileClient } from "./mobileClient.js";
import { readPaint } from "./paintCache.js";
import { FRESH_MS, SLIDING_TABLES, TABLE_NAMES, WIFI_TABLES, isWindowCurrent } from "./tableMeta.js";
import { isHeartbeatEligible, isMobileHotspot, nextWindowFlip } from "../mobileFormat.js";

const EMPTY_ARRIVALS = Object.freeze({ seq: 0, byTable: Object.freeze({}) });
// One wallet's run: its saved paint, the worker's latest state, whether the
// page is hidden, when the last check finished (`finalAt`), and `asOf`, the
// time the window labels and `stale` are evaluated at.
const IDLE_RUN = {
  wallet: null,
  paint: null,
  live: null,
  paused: false,
  started: false,
  failed: null,
  finalAt: null,
  asOf: 0,
};

/** A fleet's Mobile Hotspots: their keys, and how many (WiFi ones too); null while it loads. */
export function mobileFleetOf(hotspots) {
  if (!Array.isArray(hotspots)) return null;
  const mobile = hotspots.filter(isMobileHotspot);
  return {
    keys: mobile.map((h) => h.entityKey),
    mobileTotal: mobile.length,
    wifiTotal: mobile.filter(isHeartbeatEligible).length,
  };
}

function idle(wallet, asOf) {
  return {
    wallet: wallet || null,
    phase: "idle",
    paused: false,
    checked: false,
    stale: false,
    asOf,
    cachedAt: null,
    cachedSections: [],
    checkedAt: null,
    tables: {},
    rewards: null,
    usage: null,
    heartbeats: null,
    invalidHeartbeats: null,
    speedtests: null,
    bans: null,
    arrivals: EMPTY_ARRIVALS,
  };
}

// Where a section shows from: the live state once it has the section, else
// the saved paint (its WiFi sections only while the fleet may have WiFi
// Hotspots).
function sourceOf(run, fleet, name) {
  if (run.live?.[name] != null) return run.live;
  if (run.paint?.[name] == null || (fleet?.wifiTotal === 0 && WIFI_TABLES.includes(name))) return null;
  return run.paint;
}

// What the window labels read at `t`: a current window reads the same at any
// end, a frozen one by its end.
function windowsKey(run, fleet, t) {
  return SLIDING_TABLES.map((s) => {
    const until = sourceOf(run, fleet, s)?.tables?.[s]?.until;
    return until == null || isWindowCurrent(until, t) ? "" : until;
  }).join();
}

function phaseOf(run, fleet, stale) {
  // A loaded fleet's check starts after this render.
  if (!run.started) return fleet ? "loading" : "idle";
  if (run.failed) return "error";
  if (run.paused) return "paused";
  if (!run.live?.live || stale) return "loading";
  const states = Object.values(run.live.tables);
  return states.length && states.every((t) => t.state === "error") ? "error" : "live";
}

// The contract, from the latest worker state for this wallet layered over the
// saved paint: a section the live state doesn't have yet (or couldn't load)
// shows the saved one, and `cachedSections` / `cachedAt` say so. A saved
// sliding section keeps its saved window end (`tables[name].until`), so it is
// labeled by when it ended (see isWindowCurrent in tables.js).
function toActivity(wallet, fleet, run) {
  const out = idle(wallet, run.asOf);
  if (!wallet || run.wallet !== wallet || (fleet && fleet.mobileTotal === 0)) {
    // A loaded Mobile fleet whose check starts after this render.
    if (wallet && fleet?.mobileTotal > 0) out.phase = "loading";
    return out;
  }
  const { paint, live } = run;
  out.tables = live?.tables ?? paint?.tables ?? {};
  for (const s of TABLE_NAMES) {
    const from = sourceOf(run, fleet, s);
    if (!from) continue;
    out[s] = from[s];
    if (from === live) continue;
    out.cachedSections.push(s);
    if (live && SLIDING_TABLES.includes(s)) {
      out.tables = { ...out.tables, [s]: { ...out.tables[s], until: paint.tables?.[s]?.until } };
    }
  }
  out.cachedAt = out.cachedSections.length ? (paint?.checkedAt ?? null) : null;
  out.checkedAt = live?.checkedAt ?? out.cachedAt;
  out.arrivals = live?.arrivals ?? EMPTY_ARRIVALS;
  out.paused = run.paused;
  out.checked = run.finalAt != null;
  out.stale = run.finalAt != null && run.asOf - run.finalAt > FRESH_MS;
  out.phase = phaseOf(run, fleet, out.stale);
  return out;
}

// When a window label or `stale` next changes with no update to say so.
function nextFlip(activity, finalAt) {
  const windows = nextWindowFlip(activity, activity.asOf);
  const stale = finalAt != null && !activity.stale ? finalAt + FRESH_MS + 1 : null;
  if (windows == null || stale == null) return windows ?? stale;
  return Math.min(windows, stale);
}

/**
 * The wallet's Mobile Hotspots' recent network activity, read in a Web
 * Worker from Helium's public Mobile network tables and kept live while the
 * page is visible (see mobile/engine.js). `hotspots` is the fleet: undefined
 * while it loads, [] when empty. Nothing runs unless the fleet has a Mobile
 * Hotspot; a saved state paints immediately (`cachedSections`) until the
 * first live check. Derive per-Hotspot verdicts with
 * `aggregateMobile(hotspots, activity, activity.asOf)` (mobileFormat.js); the
 * contract is documented in worker/src/tools/wallet-dashboard/CLAUDE.md. A
 * section unchanged by an update keeps its object identity.
 *
 * One clock: `asOf` moves only when a window label or `stale` could change
 * (a timer for the next flip, a window frozen or thawed by an update, the
 * page shown or hidden), so a derivation keyed on the sections and `asOf`
 * re-runs exactly when its output can change. `stale`: the last finished
 * check is older than FRESH_MS. `checked`: a check for this wallet has
 * finished on this page (the saved paint doesn't count). `paused`: the page
 * is hidden.
 *
 * `refreshRef` (optional): the hook sets `refreshRef.current` to a function
 * that checks now (mobileClient's `refresh()`: every Mobile "Retry"). The
 * returned contract is unchanged.
 *
 * @returns {{ wallet, phase: "idle"|"loading"|"live"|"paused"|"error", paused, checked, stale, asOf,
 *   cachedAt, cachedSections, checkedAt, tables, rewards, usage, heartbeats, invalidHeartbeats,
 *   speedtests, bans, arrivals }}
 */
export default function useMobileActivity(wallet, hotspots, { refreshRef } = {}) {
  const fleet = useMemo(() => mobileFleetOf(hotspots), [hotspots]);
  const clientRef = useRef(null);
  const [run, setRun] = useState(IDLE_RUN);
  if (refreshRef) refreshRef.current = refreshNow;

  function refreshNow() {
    clientRef.current?.refresh();
  }

  // One worker for the page; gone with the page.
  useEffect(
    () => () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!wallet) {
      setRun(IDLE_RUN);
      return;
    }
    const runnable = Boolean(fleet && fleet.mobileTotal > 0);
    setRun({
      ...IDLE_RUN,
      wallet,
      // Paint while the fleet loads too; a loaded fleet without Mobile
      // Hotspots has nothing to paint.
      paint: !fleet || runnable ? readPaint(wallet) : null,
      started: runnable,
      asOf: Date.now(),
    });
    if (!runnable) return;
    const client = (clientRef.current ??= createMobileClient());
    return client.start({ wallet, keys: fleet.keys, wifi: fleet.wifiTotal > 0 }, (update) => {
      const now = Date.now();
      setRun((r) => {
        if (r.wallet !== wallet) return r;
        const next = { ...r };
        if (update.state) {
          next.live = update.state;
          next.failed = null;
          if (update.final) next.finalAt = now;
        }
        if ("paused" in update) next.paused = update.paused;
        if (update.failed) next.failed = update.failed;
        // A window frozen or thawed by this update, or a page back from
        // hidden (its timers may have slept): evaluate the labels now.
        if ("paused" in update || windowsKey(next, fleet, now) !== windowsKey(r, fleet, now)) next.asOf = now;
        return next;
      });
    });
  }, [wallet, fleet]);

  const activity = useMemo(() => toActivity(wallet, fleet, run), [wallet, fleet, run]);
  const flipAt = nextFlip(activity, run.finalAt);
  useEffect(() => {
    if (flipAt == null) return undefined;
    // A little late rather than early: an early tick would evaluate the same
    // labels and never re-arm.
    const id = setTimeout(() => setRun((r) => ({ ...r, asOf: Date.now() })), Math.max(0, flipAt - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [flipAt]);
  return activity;
}
