import { Btn2 } from "./Controls.jsx";
import { Disclosure } from "./Disclosure.jsx";
import { StatusMark } from "./StatusMark.jsx";

/**
 * The one presentation of a failed Hotspot list, in every section that needs
 * it (Hotspots, Health, Map, About): the Serious mark, "Couldn't load
 * Hotspots.", what that means for the section (`line`), Retry ("Retry
 * loading Hotspots", the fleet's retry) and Details with the error. Summary's
 * status line is the page's one `role="alert"` for this failure, so these
 * copies stay quiet for assistive tech (`alert` overrides).
 */
export function FleetError({ fleetState, line, alert = false, className = "" }) {
  const error = fleetState?.error;
  const msg = error?.message ?? (error ? String(error) : null);
  return (
    <div
      role={alert ? "alert" : undefined}
      className={`flex min-w-0 items-start gap-3 rounded-2xl bg-surface-raised p-4 shadow-soft md:px-6 md:py-5 ${className}`}
    >
      <StatusMark tier="serious" sr={false} className="mt-1 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
        <p className="m-0 text-sm text-wd-ink">
          <span className="font-semibold">Couldn&apos;t load Hotspots.</span>
          {line ? <span className="text-wd-ink-2"> {line}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Btn2 onClick={fleetState?.retry} aria-label="Retry loading Hotspots">
            Retry
          </Btn2>
          {msg && (
            <Disclosure summary="Details" className="text-wd-cap">
              <span className="mt-1 block break-words font-mono text-wd-cap text-wd-ink-2">{msg}</span>
            </Disclosure>
          )}
        </div>
      </div>
    </div>
  );
}

export default FleetError;
