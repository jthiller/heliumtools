import { useEffect, useMemo, useRef, useState } from "react";
import { createMobileClient } from "./mobileClient.js";
import { PAINT_SECTIONS, readPaint } from "./paintCache.js";
import { isHeartbeatEligible, isMobileHotspot } from "../mobileFormat.js";

const EMPTY_ARRIVALS = Object.freeze({ seq: 0, at: 0, byTable: Object.freeze({}) });
const WIFI_SECTIONS = new Set(["heartbeats", "invalidHeartbeats", "speedtests"]);
const IDLE_RUN = { wallet: null, paint: null, live: null, paused: false, stale: false, started: false, failed: null };

function mobileFleetOf(hotspots) {
  if (!Array.isArray(hotspots)) return null;
  const mobile = hotspots.filter(isMobileHotspot);
  return {
    keys: mobile.map((h) => h.entityKey),
    mobileTotal: mobile.length,
    wifiTotal: mobile.filter(isHeartbeatEligible).length,
  };
}

function idle(wallet, fleet) {
  return {
    wallet: wallet || null,
    mobileTotal: fleet?.mobileTotal ?? 0,
    wifiTotal: fleet?.wifiTotal ?? 0,
    phase: "idle",
    cached: false,
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

// The contract, from the latest worker state for this wallet layered over the
// saved paint: a section the live state doesn't have yet (or couldn't load)
// shows the saved one, and `cached` / `cachedSections` / `cachedAt` say so.
// Saved sliding sections keep their own `until`, so a saved window is labeled
// by when it ended (see isWindowCurrent in tables.js).
function toActivity(wallet, fleet, run) {
  if (!wallet || run.wallet !== wallet || (fleet && fleet.mobileTotal === 0)) {
    const out = idle(wallet, fleet);
    // A loaded Mobile fleet whose check starts after this render.
    if (wallet && fleet?.mobileTotal > 0) out.phase = "loading";
    return out;
  }
  const { paint, live } = run;
  const out = idle(wallet, fleet);
  out.mobileTotal = fleet?.mobileTotal ?? paint?.mobileTotal ?? 0;
  out.wifiTotal = fleet?.wifiTotal ?? paint?.wifiTotal ?? 0;
  for (const s of PAINT_SECTIONS) {
    if (live?.[s] != null) out[s] = live[s];
    else if (paint?.[s] != null && !(WIFI_SECTIONS.has(s) && out.wifiTotal === 0)) {
      out[s] = paint[s];
      out.cachedSections.push(s);
    }
  }
  out.cached = out.cachedSections.length > 0;
  out.cachedAt = out.cached ? (paint?.checkedAt ?? null) : null;
  out.tables = live?.tables ?? paint?.tables ?? {};
  out.checkedAt = live?.checkedAt ?? (out.cached ? (paint?.checkedAt ?? null) : null);
  out.arrivals = live?.arrivals ?? EMPTY_ARRIVALS;
  const states = Object.values(live?.tables ?? {});
  out.phase = !run.started
    ? fleet
      ? "loading" // the check starts after this render
      : "idle"
    : run.failed
      ? "error"
      : run.paused
        ? "paused"
        : !live?.live || run.stale
          ? "loading"
          : states.length && states.every((t) => t.state === "error")
            ? "error"
            : "live";
  return out;
}

/**
 * The wallet's Mobile Hotspots' recent network activity, read in a Web
 * Worker from Helium's public Mobile network tables and kept live while the
 * page is visible (see mobile/engine.js). `hotspots` is the fleet: undefined
 * while it loads, [] when empty. Nothing runs unless the fleet has a Mobile
 * Hotspot; a saved state paints immediately (`cached: true`) until the first
 * live check. Derive per-Hotspot verdicts with `aggregateMobile`
 * (mobileFormat.js); the contract is documented in
 * worker/src/tools/wallet-dashboard/CLAUDE.md. A section unchanged by an
 * update keeps its object identity.
 *
 * @returns {{ wallet, mobileTotal, wifiTotal, phase: "idle"|"loading"|"live"|"paused"|"error",
 *   cached, cachedAt, cachedSections, checkedAt, tables, rewards, usage, heartbeats,
 *   invalidHeartbeats, speedtests, bans, arrivals }}
 */
export default function useMobileActivity(wallet, hotspots) {
  const fleet = useMemo(() => mobileFleetOf(hotspots), [hotspots]);
  const clientRef = useRef(null);
  const [run, setRun] = useState(IDLE_RUN);

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
    });
    if (!runnable) return;
    const client = (clientRef.current ??= createMobileClient());
    return client.start(
      {
        wallet,
        keys: fleet.keys,
        wifi: fleet.wifiTotal > 0,
        totals: { mobileTotal: fleet.mobileTotal, wifiTotal: fleet.wifiTotal },
      },
      (update) =>
        setRun((r) => {
          if (r.wallet !== wallet) return r;
          const next = { ...r };
          if (update.state) {
            next.live = update.state;
            next.failed = null;
            if (update.final) next.stale = false;
          }
          if ("paused" in update) next.paused = update.paused;
          if (update.stale) next.stale = true;
          if (update.failed) next.failed = update.failed;
          return next;
        }),
    );
  }, [wallet, fleet]);

  return useMemo(() => toActivity(wallet, fleet, run), [wallet, fleet, run]);
}
