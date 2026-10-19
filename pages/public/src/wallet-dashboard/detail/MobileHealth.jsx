import { memo } from "react";
import { fmtCount, plural } from "../format.js";
import { fmtClock, fmtLocationSource, fmtMbps, fmtMeters, fmtMultiplier, fmtReason } from "../mobileFormat.js";
import { Pending } from "../ui/Pending.jsx";
import { TimeAgo } from "../ui/TimeAgo.jsx";
import { banLine } from "./DetailHeader.jsx";
import { DList, DRow, DSection, Foot, MarkedValue, RetryBtn, Well } from "./parts.jsx";
import { DATA_ONLY_NOTE, WIFI_SIGNALS_NOTE } from "../copy.js";

const WIFI_SIGNALS = WIFI_SIGNALS_NOTE;

const Quiet = ({ children }) => <span className="text-wd-ink-2">{children}</span>;
const Caution = ({ on, children }) => <span className={on ? "text-wd-caution-text" : undefined}>{children}</span>;
const Loading = () => (
  <span className="text-wd-ink-3">
    <Pending />
  </span>
);

/**
 * A value whose table may still be loading or have failed: "…" while it
 * loads, "Couldn't load" (with Retry where it helps) when its check failed
 * with nothing to show, never a false zero.
 */
function tableState(mobile, table) {
  if (mobile?.loaded?.[table]) return "ok";
  return mobile?.failed?.[table] ? "failed" : "loading";
}

/** The Ban row, shared by WiFi and data-only Hotspots. */
function BanRow({ m, mobile }) {
  const st = tableState(mobile, "bans");
  if (st !== "ok") {
    return <DRow label="Ban">{st === "failed" ? <Quiet>Couldn&apos;t load</Quiet> : <Loading />}</DRow>;
  }
  if (m.banned && m.ban) {
    return (
      <DRow label="Ban" sub={m.ban.message || null}>
        <MarkedValue tier="serious" className="text-wd-critical-text">
          {banLine(m.ban)}
        </MarkedValue>
      </DRow>
    );
  }
  return <DRow label="Ban">No ban on record</DRow>;
}

/**
 * Mobile WiFi health (WiFi indoor and outdoor Hotspots): the last heartbeat
 * and how many in the window, location trust and distance, the 24-h
 * speedtest average, rejected heartbeats with every reason, and the ban
 * record. Windows are named as aggregateMobile names them (a frozen one by
 * its end); each table that failed says so, with Retry.
 */
export const WifiHealth = memo(function WifiHealth({ row, mobile, onRetry }) {
  const m = row.mobile;
  const w = mobile?.windows || {};
  const hb = w.heartbeats ?? { long: "in the last 60 min", span: "last 60 min", current: true };
  const inv = w.invalidHeartbeats ?? hb;
  const sp = w.speedtests ?? { long: "in the last 24 h", span: "last 24 h", current: true };
  const hbState = tableState(mobile, "heartbeats");
  const spState = tableState(mobile, "speedtests");
  const invState = tableState(mobile, "invalidHeartbeats");
  const retry = onRetry ? <RetryBtn onClick={onRetry} label="Retry Mobile data" /> : null;

  let last;
  let location;
  if (hbState === "failed") {
    last = (
      <DRow label="Last heartbeat" action={retry}>
        <MarkedValue tier="unknown" mark="x" className="text-wd-ink-2">
          Couldn&apos;t load heartbeats.
        </MarkedValue>
      </DRow>
    );
    location = (
      <DRow label="Location">
        <Quiet>Couldn&apos;t load</Quiet>
      </DRow>
    );
  } else if (hbState === "loading") {
    last = (
      <DRow label="Last heartbeat">
        <Loading />
      </DRow>
    );
    location = (
      <DRow label="Location">
        <Loading />
      </DRow>
    );
  } else if (m.heartbeating) {
    const count = `${plural(m.heartbeats ?? 0, "heartbeat")} ${hb.long}`;
    last = (
      <DRow label="Last heartbeat">
        {hb.current === false || !m.lastHeartbeatAt ? (
          `${m.lastHeartbeatAt ? `${fmtClock(m.lastHeartbeatAt)} · ` : ""}${count}`
        ) : (
          <>
            <TimeAgo at={m.lastHeartbeatAt} fallback="Unknown" /> · {count}
          </>
        )}
      </DRow>
    );
    location = (
      <DRow label="Location">
        <Caution on={m.trust != null && m.trust < 1}>
          {[
            `Trust ${fmtMultiplier(m.trust)}`,
            m.distance != null ? `${fmtMeters(m.distance)} from asserted` : null,
            m.locationSource ? fmtLocationSource(m.locationSource) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Caution>
      </DRow>
    );
  } else {
    last = (
      <DRow label="Last heartbeat">
        <MarkedValue tier="check" className="text-wd-caution-text">
          None {hb.long}
        </MarkedValue>
      </DRow>
    );
    location = (
      <DRow label="Location">
        <Quiet>Not reported {hb.long}</Quiet>
      </DRow>
    );
  }

  const s = m.speedtest;
  let speed;
  if (spState !== "ok") {
    speed = (
      <DRow label={`Speedtest, ${sp.span}`} action={spState === "failed" ? retry : null}>
        {spState === "failed" ? (
          <MarkedValue tier="unknown" mark="x" className="text-wd-ink-2">
            Couldn&apos;t load speedtests.
          </MarkedValue>
        ) : (
          <Loading />
        )}
      </DRow>
    );
  } else if (s) {
    const latency = Number.isFinite(s.latency) ? `${Math.round(s.latency)} ms` : "latency not reported";
    const sub =
      s.samples > 0
        ? `Average of ${plural(s.samples, "speedtest")}${s.at ? `, latest at ${fmtClock(s.at)}` : ""}`
        : null;
    speed = (
      <DRow label={`Speedtest, ${sp.span}`} sub={sub}>
        <Caution on={s.multiplier != null && s.multiplier < 1}>
          {fmtMbps(s.down)} down, {fmtMbps(s.up)} up · {latency} · ×{fmtMultiplier(s.multiplier)}
        </Caution>
      </DRow>
    );
  } else {
    speed = (
      <DRow label={`Speedtest, ${sp.span}`}>
        <Quiet>None</Quiet>
      </DRow>
    );
  }

  let rejected;
  if (invState !== "ok") {
    rejected = (
      <DRow label={`Rejected heartbeats, ${inv.span}`}>
        {invState === "failed" ? <Quiet>Couldn&apos;t load</Quiet> : <Loading />}
      </DRow>
    );
  } else if (m.rejectedHeartbeats > 0) {
    const reasons = Object.entries(m.rejectedReasons || {})
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `${fmtReason(r)} ${fmtCount(n)}`)
      .join(", ");
    rejected = (
      <DRow label={`Rejected heartbeats, ${inv.span}`} sub={reasons ? `By reason: ${reasons}` : null}>
        <MarkedValue tier="check" className="text-wd-caution-text">
          {fmtCount(m.rejectedHeartbeats)} rejected
        </MarkedValue>
      </DRow>
    );
  } else {
    rejected = (
      <DRow label={`Rejected heartbeats, ${inv.span}`}>
        <Quiet>None</Quiet>
      </DRow>
    );
  }

  return (
    <DSection id="wifi" title="Mobile WiFi health" right={`${hb.span} · ${sp.span}`}>
      <DList>
        {last}
        {location}
        {speed}
        {rejected}
        <BanRow m={m} mobile={mobile} />
      </DList>
      <Foot>{WIFI_SIGNALS}</Foot>
    </DSection>
  );
});

/** Mobile data-only Hotspots: the ban record, and why there's nothing else. */
export const DataOnlyHealth = memo(function DataOnlyHealth({ row, mobile }) {
  return (
    <DSection id="mobile" title="Mobile" right="Data-only">
      <DList>
        <BanRow m={row.mobile} mobile={mobile} />
      </DList>
      <Well>{DATA_ONLY_NOTE}</Well>
    </DSection>
  );
});

/** The Mobile section the Hotspot's type calls for (WiFi health, or data-only). */
export default function MobileHealth({ row, mobile, onRetry }) {
  if (!row.mobile) return null;
  if (row.wifi) return <WifiHealth row={row} mobile={mobile} onRetry={onRetry} />;
  return <DataOnlyHealth row={row} mobile={mobile} />;
}
