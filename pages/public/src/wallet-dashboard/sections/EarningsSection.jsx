import { memo } from "react";
import { fmtDataDay, fmtHnt } from "../format.js";

/**
 * Earnings: HNT per day, the facts beside it, Unclaimed and Lifetime earned.
 * STUB (U0a): the final props, a placeholder body; U1 replaces it.
 *
 * Props: wallet, money, list, mobile, activity, freshness, prices,
 * governance ({ data, loading, error, retry }), onRetryRewards, onRetryMobile.
 */
export default memo(function EarningsSection({ money }) {
  const e = money.earned;
  return (
    <section id="earnings" aria-labelledby="earnings-title" data-wd-section="earnings">
      <h2 id="earnings-title" className="m-0 font-display text-wd-h2-sm font-semibold md:text-wd-h2">
        Earnings
      </h2>
      <p className="mt-2 text-wd-sm text-wd-ink-2">
        {e.kind === "mobile"
          ? e.latest.state === "ok"
            ? `${fmtHnt(e.latest.hnt, "stat")} HNT on ${fmtDataDay(e.latest.day)} (UTC). ${fmtHnt(e.weekHnt, "stat")} HNT in the 7 days to ${fmtDataDay(e.latest.day)} (UTC).`
            : "Checking Mobile earnings…"
          : e.kind === "iot"
            ? "Daily HNT isn't available for IoT Hotspots."
            : "No Hotspots in this wallet."}
      </p>
    </section>
  );
});
