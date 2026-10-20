import { memo } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { NO_DAILY_TEXT } from "../copy.js";
import { fmtElevationM, fmtGainDbi, fmtHnt } from "../format.js";
import { COVERAGE_GATE_NOTE, CoverageNotes, CoverageToggle, IconBtn, NetDot, Pending, StatusMark, TimeAgo } from "../ui/index.js";
import {
  alsoLine,
  deviceText,
  earnedDayLabel,
  messagesLine,
  positionText,
  rewardedSub,
  tierTextClass,
} from "./mapEncoding.js";

const KEY = "text-wd-cap text-wd-ink-2";
const VALUE = "font-display text-wd-s font-semibold tracking-[-0.02em] text-wd-ink";

function Money({ k, v, s }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={KEY}>{k}</span>
      <span className={VALUE}>{v}</span>
      <span className={KEY}>{s}</span>
    </div>
  );
}

const WORD = { failed: "Couldn't load", missing: "No data", unavailable: "Unavailable", unconfirmed: "Couldn't confirm" };
const value = (state, hnt) =>
  state === "ok" ? `${fmtHnt(hnt, "list")} HNT` : state === "loading" ? <Pending /> : (WORD[state] ?? <Pending />);

/** The leading state: mark, spoken tier, label (a heartbeat's age ticks), window. */
function StatusLine({ state }) {
  const heartbeat = state.key === "heartbeatOk" && state.at;
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-wd-sm">
      {/* "Checking…" already says it: no spoken tier word before it. */}
      <StatusMark tier={state.tier} sr={state.tier !== "checking"} className="self-center" />
      <span className={`font-semibold ${state.tier === "serious" || state.tier === "check" ? tierTextClass(state.tier) : "text-wd-ink"}`}>
        {heartbeat ? (
          <>
            {state.label} <TimeAgo at={state.at} fallback="received" />
          </>
        ) : (
          state.label
        )}
      </span>
      {state.window && <span className="text-wd-ink-2">{state.window}</span>}
    </p>
  );
}

/** The reported positions line for a WiFi Hotspot (the overlay's groups). */
function PositionsLine({ row, overlay, hbWindow, mobileTables }) {
  if (!row.wifi || !row.mobile) return null;
  let text;
  if (row.mobile.heartbeating == null) {
    text = mobileTables?.failed?.heartbeats ? "Couldn't load reported positions." : <Pending label="Loading reported positions" />;
  } else if (!overlay?.groups?.length) {
    text = `No reported positions ${hbWindow?.long ?? "in the last 60 min"}.`;
  } else {
    const [g] = overlay.groups;
    text = positionText(g, hbWindow);
    if (overlay.groups.length > 1) text += `. ${overlay.groups.length - 1} more ${overlay.groups.length === 2 ? "position" : "positions"} on the map`;
  }
  return (
    <p className="m-0 flex items-start gap-2 text-wd-cap text-wd-ink-2">
      <span aria-hidden="true" className="mt-0.5 block h-3 w-3 shrink-0 rounded-full border-2 border-wd-mobile bg-surface-raised" />
      <span>{text}</span>
    </p>
  );
}

/**
 * The selected Hotspot's summary on the map (WdMap `panel()`): name, device
 * and place, a money pair (a Mobile Hotspot's latest UTC day and Unclaimed;
 * anything else Lifetime earned and Unclaimed), the leading state with its
 * window, the IoT messages line or "Also: …", reported positions for WiFi,
 * the opt-in modeled coverage for an active IoT Hotspot, and "Open Hotspot
 * details" (the full detail; every fact here is also there). Desktop: over
 * the map's right side; phone: below the preview. Escape or "Clear
 * selection" clears the selection and hands focus back to the map.
 * `data-map-panel` marks it for the camera (kept clear of it) and
 * the landing capture.
 */
export const MapPanel = memo(function MapPanel({
  row,
  ctx,
  wallet,
  overlay,
  hbWindow,
  mobileTables,
  coverage,
  onClose,
  onOpenDetail,
  placement = "float",
  headingId,
  headingRef,
  rootRef,
}) {
  const name = row.name || "Unnamed Hotspot";
  const u = row.unclaimed;
  const unclaimedSub =
    u.state === "ok" && u.reason === "no_ata" ? (
      <span className="inline-flex items-center gap-1 text-wd-caution-text">
        <StatusMark tier="check" sr={false} />
        Can&apos;t claim yet
      </span>
    ) : u.destination && u.destination !== wallet ? (
      "Pays another wallet"
    ) : (
      "Since last claim"
    );
  const l = row.lifetime;
  const lifetimeValue =
    l.state === "ok" ? (l.never ? "Never rewarded" : `${l.lowerBound ? "≥ " : ""}${fmtHnt(l.hnt, "list")} HNT`) : value(l.state, null);
  const noDaily = NO_DAILY_TEXT[row.noDaily] ?? NO_DAILY_TEXT.none;
  const extra = alsoLine(row) ?? messagesLine(row);
  const isIot = Boolean(row.nets.iot);
  const elevation = Number.isFinite(row.hotspot.elevation) ? row.hotspot.elevation : null;
  const elevNote =
    elevation === null || elevation === 0
      ? "0 m is the on-chain default; the model may understate this Hotspot's reach."
      : elevation <= 2
        ? "Low asserted elevation; the model may understate this Hotspot's reach."
        : null;
  const floating = placement === "float";

  return (
    <div
      ref={rootRef}
      data-map-panel=""
      role="group"
      aria-labelledby={headingId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // Clears the selection only (inside the phone map dialog, the dialog stays open).
          e.preventDefault();
          e.stopPropagation();
          onClose({ focusMap: true });
        }
      }}
      className={
        floating
          ? "absolute right-[62px] top-3.5 z-[8] flex max-h-[calc(100%-28px)] w-[300px] flex-col gap-2.5 overflow-auto overscroll-contain rounded-xl bg-surface-raised px-4 pb-3 pt-3.5 shadow-soft-lg xl:w-[340px]"
          : "flex flex-col gap-2.5 border-t border-wd-line-2 px-4 pb-4 pt-3.5"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <h3
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          data-wd-anchor=""
          className="m-0 min-w-0 font-display text-wd-title font-semibold text-wd-ink"
        >
          {name}
        </h3>
        <IconBtn aria-label="Clear selection" onClick={() => onClose({ focusMap: true })} className="-mr-2 -mt-1.5 max-md:-mr-3.5 max-md:-mt-3">
          <XMarkIcon aria-hidden="true" className="h-5 w-5" />
        </IconBtn>
      </div>
      <p className="-mt-1.5 mb-0 flex items-center gap-1.5 text-wd-cap text-wd-ink-2">
        <NetDot net={row.nets.iot ? "iot" : row.nets.mobile && !row.nets.cbrs ? "mobile" : null} second={row.nets.dual ? "mobile" : null} />
        <span>
          {deviceText(row)} · {row.placeText}
        </span>
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-wd-line-2 py-2.5">
        {row.mobile ? (
          <Money k={`Earned ${earnedDayLabel(row, ctx)}`} v={value(row.day.state, row.day.hnt)} s={rewardedSub(row)} />
        ) : (
          <Money k="Lifetime earned" v={lifetimeValue} s={noDaily} />
        )}
        <Money k="Unclaimed" v={value(u.state, u.hnt)} s={unclaimedSub} />
      </div>
      <StatusLine state={row.top} />
      {extra && <p className="m-0 text-wd-cap text-wd-ink-2">{extra}.</p>}
      {row.netLine && <p className="m-0 text-wd-cap text-wd-ink-2">{row.netLine}.</p>}
      <PositionsLine row={row} overlay={overlay} hbWindow={hbWindow} mobileTables={mobileTables} />
      {coverage ? (
        <div className="flex flex-col gap-1.5 pt-0.5">
          <CoverageToggle coverage={coverage} />
          <CoverageNotes coverage={coverage} hotspot={row.hotspot} />
          {!coverage.shown && (
            <>
              <p className="m-0 text-xs leading-[17px] text-wd-ink-2">
                Currently asserted: gain {fmtGainDbi(row.hotspot.gain)} · elevation {fmtElevationM(row.hotspot.elevation)}
              </p>
              {elevNote && <p className="m-0 text-xs leading-[17px] text-wd-ink-2">{elevNote}</p>}
            </>
          )}
        </div>
      ) : (
        isIot && <p className="m-0 text-wd-cap text-wd-ink-2">{COVERAGE_GATE_NOTE}</p>
      )}
      <a
        href={`?hotspot=${encodeURIComponent(row.param)}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpenDetail(row.param, e.currentTarget);
        }}
        className="inline-flex min-h-6 items-center self-start text-[13px] font-medium text-accent-text hover:underline max-md:min-h-11"
      >
        Open Hotspot details
      </a>
    </div>
  );
});

export default MapPanel;
