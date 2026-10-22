import { memo } from "react";
import { ONBOARDED_NOTE } from "../copy.js";
import { DC_PER_USD, fmtCount, fmtUsd, fmtUtcDate } from "../format.js";
import { CopyIconButton } from "../ui/CopyIconButton.jsx";
import { InfoTip } from "../ui/InfoTip.jsx";
import { Pending } from "../ui/Pending.jsx";
import { COPY_SM, DList, DRow, DSection, TIP } from "./parts.jsx";

// Hotspots from the Helium L1 carry the date they moved to Solana (April
// 2023); a date before this reads with the migration note.
const L1_BEFORE = "2023-05-01";
const L1_NOTE = "Hotspots from before Helium's April 2023 move to Solana show their migration date.";
const NETS = [
  ["iot", "IoT"],
  ["mobile", "Mobile"],
];

/** "Mobile Nov 22, 2024 (UTC)", or both networks for a dual-network Hotspot
 * ("IoT Jul 18, 2024 · Mobile Mar 2, 2025 (UTC)"); null while loading. */
function onboardedText(row) {
  const o = row.onboarded;
  if (o.at === undefined) return null;
  const nets = NETS.filter(([k]) => row.nets[k]);
  if (!nets.length) return o.at ? `${fmtUtcDate(o.at)} (UTC)` : "Unknown";
  const parts = nets.map(([k, label]) => (o[k] ? `${label} ${fmtUtcDate(o[k])}` : `${label} unknown`));
  return nets.some(([k]) => o[k]) ? `${parts.join(" · ")} (UTC)` : "Unknown";
}

/**
 * The detail's Details: when it was onboarded on each network (UTC, with the
 * onboard-date InfoTip and the L1 migration note), the onboarding fee in DC
 * at the $1 = 100,000 DC peg, and the asset ID with Copy.
 */
export default memo(function DetailFacts({ row }) {
  const onb = onboardedText(row);
  const l1 = Boolean(row.onboarded.at) && row.onboarded.at.slice(0, 10) < L1_BEFORE;
  const fee = row.hotspot?.dcOnboardingFeePaid;
  const asset = row.assetId;
  return (
    <DSection id="facts" title="Details">
      <DList>
        <DRow
          label="Onboarded"
          tip={
            <InfoTip label="Onboarded" className={TIP}>
              {ONBOARDED_NOTE}
            </InfoTip>
          }
          sub={l1 ? L1_NOTE : null}
        >
          {onb ?? (
            <span className="text-wd-ink-3">
              <Pending />
            </span>
          )}
        </DRow>
        <DRow label="Onboarding fee">
          {Number.isFinite(fee) ? `${fmtCount(fee)} DC (${fmtUsd(fee / DC_PER_USD)})` : <span className="text-wd-ink-2">No fee on record</span>}
        </DRow>
        <DRow
          label="Asset ID"
          action={
            asset ? (
              <CopyIconButton text={asset} label="Copy asset ID" copiedText="Copied asset ID" className={COPY_SM}>
                Copy asset ID
              </CopyIconButton>
            ) : null
          }
        >
          {asset ? (
            <span className="font-mono text-xs">
              <span aria-hidden="true">{`${asset.slice(0, 8)}…${asset.slice(-4)}`}</span>
              <span className="sr-only">{asset}</span>
            </span>
          ) : (
            <span className="text-wd-ink-2">Unavailable</span>
          )}
        </DRow>
      </DList>
    </DSection>
  );
});
