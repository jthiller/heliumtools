import { memo } from "react";
import { Card, Stat, Skeleton, CardEmpty, Badge } from "./primitives.jsx";
import { fmtToken } from "../format.js";

// memo: the dashboard shell re-renders on every rewards/IoT-status scan flush;
// this card's props are referentially stable across those, so skip the churn.
export default memo(function GovernanceCard({ positions, loading, error, wallet }) {
  const govHref = wallet ? `/ve-hnt?wallet=${encodeURIComponent(wallet)}` : "/ve-hnt";
  if (loading) {
    return (
      <Card title="Governance (veHNT)">
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </Card>
    );
  }

  const totals = positions?.totals;
  const count = totals ? Number(totals.positionCount) : 0;

  if (error || !totals || count === 0) {
    return (
      <Card
        title="Governance (veHNT)"
        action={<a href={govHref} className="text-xs font-medium text-accent-text hover:underline">Open →</a>}
      >
        <CardEmpty>{error ? "Couldn't load positions" : "No veHNT positions"}</CardEmpty>
      </Card>
    );
  }

  const split = { IOT: 0, MOBILE: 0, undelegated: 0, other: 0 };
  for (const p of positions.positions || []) {
    // Key on delegation presence first: a delegated position with an unrecognized
    // sub-DAO is "other", not "undelegated".
    if (!p.delegation) {
      split.undelegated++;
      continue;
    }
    const sd = p.delegation.subDao;
    if (sd === "IOT") split.IOT++;
    else if (sd === "MOBILE") split.MOBILE++;
    else split.other++;
  }
  const pendingHnt = Number(totals.pendingRewardsHnt || 0);

  return (
    <Card
      title="Governance (veHNT)"
      action={<a href={govHref} className="text-xs font-medium text-accent-text hover:underline">Open →</a>}
    >
      <div className="grid grid-cols-2 gap-4">
        <Stat label="HNT locked" value={fmtToken(Number(totals.hntLocked), { max: 2 })} />
        <Stat label="Voting power" value={fmtToken(Number(totals.veHnt), { max: 0 })} sub="veHNT" />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge>{count} position{count !== 1 ? "s" : ""}</Badge>
        {split.IOT > 0 && <Badge>IOT ×{split.IOT}</Badge>}
        {split.MOBILE > 0 && <Badge>MOBILE ×{split.MOBILE}</Badge>}
        {split.other > 0 && <Badge>Other ×{split.other}</Badge>}
        {split.undelegated > 0 && <Badge>Undelegated ×{split.undelegated}</Badge>}
      </div>
      {pendingHnt > 0 && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-sm">
          <span className="text-content-secondary">Pending rewards</span>
          <span className="tabular-nums text-content">{fmtToken(pendingHnt, { max: 2 })} HNT</span>
        </div>
      )}
    </Card>
  );
});
