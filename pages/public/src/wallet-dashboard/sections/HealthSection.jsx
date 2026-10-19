import { memo, useMemo, useRef } from "react";
import { CountUp, useArrivalFlashes } from "../arrivalMotion.jsx";
import { fmtCount } from "../format.js";
import { FLEET_UNAVAILABLE, healthScope } from "../copy.js";
import { Chip, FleetError, LiveChip, Section } from "../ui/index.js";
import { HealthModule, ReservedModule } from "../health/HealthModule.jsx";
import { iotModule } from "../health/iotModule.js";
import { mobileModule } from "../health/mobileModule.js";

const fmtWhole = (v) => fmtCount(Math.round(v));
// On phones a long freshness line ("Saved from Oct 13, 3:42 PM, checking")
// wraps inside the chip instead of running past a 320 px screen.
const LIVE_CHIP_WRAP = "max-md:!h-auto max-md:min-h-7 max-md:max-w-full max-md:!shrink max-md:py-1 max-md:!whitespace-normal";

/** The IoT module. Mounted per wallet (keyed), so "final once" is this wallet's. */
const IotHealth = memo(function IotHealth({ iotStatus, done, walletTotal, utilizationIndex, onRetry, onShowStatus, onOpenHotspot }) {
  // Once the scan has settled for this wallet, a later `done` false is a
  // Retry of failed lookups: its progress shows over the data, not a skeleton.
  const everDone = useRef(false);
  if (done) everDone.current = true;
  const retrying = !done && everDone.current;
  const vm = useMemo(
    () => iotModule({ iotStatus, done, retrying, walletTotal, utilizationIndex }),
    [iotStatus, done, retrying, walletTotal, utilizationIndex],
  );
  const { chip } = vm;
  const chipNode =
    chip.kind === "checking" ? (
      <Chip pending>Checking</Chip>
    ) : chip.kind === "failed" ? (
      <Chip>
        <span aria-hidden="true" className="wd-live error" />
        Couldn&apos;t check
      </Chip>
    ) : chip.text ? (
      // Wraps to its own line, then within itself when even that is too
      // narrow (the split "Connectivity … · Messages to …" at 320 px).
      <span className="inline-flex min-h-7 max-w-full items-center rounded-[14px] bg-wd-well px-2.5 py-1 text-wd-cap font-medium text-wd-ink-2">
        {chip.text}
      </span>
    ) : null;
  return <HealthModule vm={vm} chip={chipNode} onShowStatus={onShowStatus} onOpenHotspot={onOpenHotspot} onRetry={onRetry} />;
});

/** The Mobile module ("WiFi health", or "Bans" for a data-only fleet).
 * Mounted per wallet (keyed): arrival baselines and count-ups start fresh. */
const MobileHealth = memo(function MobileHealth({
  mobile,
  activity,
  freshness,
  walletTotal,
  noRewarded,
  rewardsWindow,
  onRetry,
  onShowStatus,
  onOpenHotspot,
}) {
  // Live arrivals only: the headline counts up and washes, issue rows wash,
  // the Live dot pings once (all off under reduced motion).
  const flashes = useArrivalFlashes(activity.arrivals, mobile);
  const vm = useMemo(
    () => mobileModule({ mobile, activity, freshness, walletTotal, noRewarded, rewardsWindow }),
    [mobile, activity, freshness, walletTotal, noRewarded, rewardsWindow],
  );
  const headFlash = vm.headline ? flashes.tables[vm.headline.flash] : undefined;
  return (
    <HealthModule
      vm={vm}
      chip={<LiveChip freshness={freshness} ping={flashes.any} className={LIVE_CHIP_WRAP} />}
      headValue={vm.headline ? <CountUp value={vm.headline.a} trigger={headFlash} format={fmtWhole} /> : null}
      headFlash={headFlash}
      rowFlashes={flashes.issues}
      onShowStatus={onShowStatus}
      onOpenHotspot={onOpenHotspot}
      onRetry={onRetry}
    />
  );
});

/**
 * Health: how the wallet's Hotspots are doing, one module per network that
 * the wallet has (IoT "Connectivity and traffic", Mobile "WiFi health" or,
 * for data-only fleets, "Bans"), side by side from 1024 px, stacked below.
 * Every row links to the Hotspot list filtered by the same predicate
 * (`onShowStatus`), and names up to 10 Hotspots that open their detail
 * (`onOpenHotspot`). While the Hotspot list loads, the modules the summary's
 * network counts promise are reserved at their final size; when the list
 * failed, one line with its Retry.
 *
 * Props: wallet, list, iotStatus, iotDone, onRetryIot, utilizationIndex,
 * mobile, activity, freshness, onRetryMobile, fleetState ({ state, error,
 * retry }), byNetwork (summary.fleet.byNetwork), onShowStatus(key),
 * onOpenHotspot(param, el).
 */
export default memo(function HealthSection({
  wallet,
  list,
  iotStatus,
  iotDone,
  onRetryIot,
  utilizationIndex,
  mobile,
  activity,
  freshness,
  onRetryMobile,
  fleetState,
  byNetwork,
  onShowStatus,
  onOpenHotspot,
}) {
  if (fleetState.state === "failed") {
    return (
      <Section id="health" title="Health" data-wd-section="health">
        <FleetError fleetState={fleetState} line={FLEET_UNAVAILABLE.health} />
      </Section>
    );
  }

  const ready = fleetState.state === "ready";
  const walletTotal = list.counts.total;
  const hasIot = ready ? iotStatus.iotTotal > 0 : (byNetwork?.iot ?? 0) > 0;
  const hasMobile = ready ? mobile.mobileTotal > 0 : (byNetwork?.mobile ?? 0) > 0;
  // The caption names IoT's day once the scan settled with data, else "by latest reported UTC day".
  const iotDay = ready && iotDone && iotStatus.failed < iotStatus.iotTotal ? (iotStatus.livenessRange?.max ?? null) : null;
  // "No rewarded data" once its sources settled, like the page's "need a
  // look" (a count that grows with the rewards scan isn't one yet).
  const noRewarded = list.settled.rewards && list.settled.mobile ? (list.counts.byState.noRewardedData ?? 0) : 0;
  const caption = healthScope({ iotDay, hasIot, windows: ready && hasMobile ? mobile.windows : null, wifi: mobile.wifiTotal > 0 });

  let body;
  if (ready && walletTotal === 0) {
    body = <p className="m-0 text-sm text-wd-ink-2">No Hotspots in this wallet.</p>;
  } else if (ready && !hasIot && !hasMobile) {
    // Only CBRS radios or Hotspots on no network: the list's "No status reported".
    body = <p className="m-0 text-sm text-wd-ink-2">No status reported for this wallet&apos;s Hotspots.</p>;
  } else {
    body = (
      <div className={`grid gap-4 ${hasIot && hasMobile ? "lg:grid-cols-2" : ""}`}>
        {!ready && !hasIot && !hasMobile && <ReservedModule />}
        {hasIot &&
          (ready ? (
            <IotHealth
              key={`iot-${wallet}`}
              iotStatus={iotStatus}
              done={iotDone}
              walletTotal={walletTotal}
              utilizationIndex={utilizationIndex}
              onRetry={onRetryIot}
              onShowStatus={onShowStatus}
              onOpenHotspot={onOpenHotspot}
            />
          ) : (
            <ReservedModule net="iot" />
          ))}
        {hasMobile &&
          (ready ? (
            <MobileHealth
              key={`mobile-${wallet}`}
              mobile={mobile}
              activity={activity}
              freshness={freshness}
              walletTotal={walletTotal}
              noRewarded={noRewarded}
              rewardsWindow={list.ctx.rewardsWindow}
              onRetry={onRetryMobile}
              onShowStatus={onShowStatus}
              onOpenHotspot={onOpenHotspot}
            />
          ) : (
            <ReservedModule net="mobile" />
          ))}
      </div>
    );
  }

  return (
    <Section id="health" title="Health" caption={caption || null} busy={!ready} data-wd-section="health">
      {body}
    </Section>
  );
});
