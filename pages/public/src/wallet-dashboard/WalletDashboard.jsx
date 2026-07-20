import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import StatusBanner from "../components/StatusBanner.jsx";
import { fetchSummary, fetchFleet } from "../lib/walletDashboardApi.js";
import { fetchPositions } from "../lib/veHntApi.js";
import useFleetRewards from "./useFleetRewards.js";
import useFleetIotStatus from "./useFleetIotStatus.js";
import { aggregateRewards, aggregateIotStatus } from "./format.js";
import FleetMap from "./FleetMap.jsx";
import HeroCard from "./cards/HeroCard.jsx";
import BalancesCard from "./cards/BalancesCard.jsx";
import RewardsCard from "./cards/RewardsCard.jsx";
import GovernanceCard from "./cards/GovernanceCard.jsx";
import FleetCompositionCard from "./cards/FleetCompositionCard.jsx";
import GeoCard from "./cards/GeoCard.jsx";
import OperatorAnalyticsCard from "./cards/OperatorAnalyticsCard.jsx";
import DeploymentTimelineCard from "./cards/DeploymentTimelineCard.jsx";
import TransactionsCard from "./cards/TransactionsCard.jsx";
import FleetTableCard from "./cards/FleetTableCard.jsx";
import { SEARCH_INPUT_CLASS } from "./cards/primitives.jsx";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
const isValidWallet = (a) => typeof a === "string" && a.length >= 32 && a.length <= 44 && BASE58_RE.test(a);

function AddressForm({ initial = "", onSubmit, autoFocus, className = "" }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v) onSubmit(v);
      }}
      className={`flex gap-2 ${className}`}
    >
      <div className="relative flex-1">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-tertiary" />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={autoFocus}
          spellCheck={false}
          placeholder="Solana wallet address"
          className={SEARCH_INPUT_CLASS}
        />
      </div>
      <button
        type="submit"
        className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
      >
        View
      </button>
    </form>
  );
}

function DashboardHeader({ wallet, onSubmit }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface-raised/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <a href="/" className="flex shrink-0 items-center gap-2.5 text-content hover:opacity-80">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent text-sm font-semibold text-white">
            HT
          </div>
          <span className="font-display text-base font-semibold tracking-[-0.02em]">Wallet Dashboard</span>
        </a>
        {wallet && (
          <div className="sm:w-96">
            <AddressForm initial={wallet} onSubmit={onSubmit} />
          </div>
        )}
      </div>
    </header>
  );
}

function EmptyState({ onSubmit }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <DashboardHeader wallet={null} onSubmit={onSubmit} />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
        <p className="font-mono text-[13px] font-medium uppercase tracking-[0.08em] text-accent-text">
          Read-only overview
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-[-0.03em] text-content sm:text-4xl">
          Look up any Helium wallet.
        </h1>
        <p className="mt-3 text-content-secondary">
          Fleet map, token balances, unclaimed rewards, governance, recent activity, and an
          exportable Hotspot list. Paste a wallet address to begin.
        </p>
        <div className="mt-6">
          <AddressForm onSubmit={onSubmit} autoFocus />
        </div>
      </div>
    </div>
  );
}

export default function WalletDashboard() {
  const { address } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // URL is the source of truth: prefer the path param, accept ?wallet= as an alias.
  const queryWallet = searchParams.get("wallet");
  const wallet = address || queryWallet || null;

  const goToWallet = (addr) => navigate(`/wallet-dashboard/${addr.trim()}`);

  // Redirect the ?wallet= alias to the canonical path form.
  useEffect(() => {
    if (!address && queryWallet && isValidWallet(queryWallet)) {
      navigate(`/wallet-dashboard/${queryWallet}`, { replace: true });
    }
  }, [address, queryWallet, navigate]);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [fleet, setFleet] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState(null);
  const [governance, setGovernance] = useState(null);
  const [govLoading, setGovLoading] = useState(false);
  const [govError, setGovError] = useState(null);

  const valid = isValidWallet(wallet);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;

    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    fetchSummary(wallet)
      .then((d) => !cancelled && setSummary(d))
      .catch((e) => !cancelled && setSummaryError(e.message))
      .finally(() => !cancelled && setSummaryLoading(false));

    setFleetLoading(true);
    setFleetError(null);
    setFleet(null);
    fetchFleet(wallet)
      .then((d) => !cancelled && setFleet(d))
      .catch((e) => !cancelled && setFleetError(e.message))
      .finally(() => !cancelled && setFleetLoading(false));

    setGovLoading(true);
    setGovError(null);
    setGovernance(null);
    fetchPositions(wallet)
      .then((d) => !cancelled && setGovernance(d))
      .catch((e) => !cancelled && setGovError(e.message))
      .finally(() => !cancelled && setGovLoading(false));

    return () => {
      cancelled = true;
    };
  }, [wallet, valid]);

  const rewardsState = useFleetRewards(valid ? wallet : null, fleet?.hotspots);
  const rewardsAgg = useMemo(
    () => aggregateRewards(rewardsState.rewardsByKey),
    [rewardsState.rewardsByKey],
  );
  // IoT connectivity (active/inactive) from api-iot.heliumtools.org, fetched
  // directly from the browser — the service is CORS-open and edge-cached.
  const iotStatusState = useFleetIotStatus(fleet?.hotspots);
  const iotStatusAgg = useMemo(
    () =>
      aggregateIotStatus(fleet?.hotspots, iotStatusState.statusByKey, iotStatusState.dataThrough),
    [fleet?.hotspots, iotStatusState.statusByKey, iotStatusState.dataThrough],
  );
  const prices = summary?.prices;
  // Every reward batch failed (e.g. rate-limited) even though the wallet has
  // Hotspots — surface "unavailable" instead of a misleading $0.
  const rewardsUnavailable =
    rewardsState.done && rewardsAgg.counted === 0 && (summary?.fleet?.count || 0) > 0;

  if (!wallet) {
    return <EmptyState onSubmit={goToWallet} />;
  }

  if (!valid) {
    return (
      <div className="flex min-h-screen flex-col bg-surface">
        <DashboardHeader wallet="" onSubmit={goToWallet} />
        <div className="mx-auto w-full max-w-xl px-4 py-16">
          <StatusBanner tone="error" message="That doesn't look like a valid Solana wallet address." />
          <div className="mt-4">
            <AddressForm onSubmit={goToWallet} autoFocus />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-inset">
      <DashboardHeader wallet={wallet} onSubmit={goToWallet} />

      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        {summaryError && !summary && (
          <div className="mb-4">
            <StatusBanner tone="error" message={`Couldn't load this wallet: ${summaryError}`} />
          </div>
        )}

        <div className="wd-grid grid grid-cols-1 gap-4 lg:grid-cols-12">
          <HeroCard
            wallet={wallet}
            summary={summary}
            loading={summaryLoading}
            rewards={rewardsAgg}
            rewardsDone={rewardsState.done}
            rewardsUnavailable={rewardsUnavailable}
            iotStatus={iotStatusAgg}
            iotStatusDone={iotStatusState.done}
            prices={prices}
            governance={governance}
            govLoading={govLoading}
          />

          {/* Map + right-hand stack */}
          <div className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-soft lg:col-span-8">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="font-display text-[15px] font-semibold tracking-[-0.01em] text-content">Fleet map</h2>
              <a href="/hotspot-map" className="text-xs font-medium text-accent-text hover:underline">
                Open full map →
              </a>
            </div>
            <div className="min-h-[360px] flex-1 px-3 pb-3">
              {fleetError ? (
                <div className="flex h-full min-h-[320px] items-center justify-center rounded-2xl border border-border bg-surface-inset px-6 text-center text-sm text-content-tertiary">
                  Couldn&apos;t load Hotspots: {fleetError}
                </div>
              ) : (
                <FleetMap
                  hotspots={fleet?.hotspots || []}
                  rewardsByKey={rewardsState.rewardsByKey}
                  iotStatusByKey={iotStatusState.statusByKey}
                  iotDataThrough={iotStatusState.dataThrough}
                  wallet={wallet}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:col-span-4">
            <BalancesCard tokens={summary?.tokens} loading={summaryLoading} />
            <RewardsCard
              rewards={rewardsAgg}
              progress={rewardsState.progress}
              done={rewardsState.done}
              unavailable={rewardsUnavailable}
              prices={prices}
              governance={governance}
              govLoading={govLoading}
              wallet={wallet}
            />
          </div>

          {/* Fleet — list view, directly under the map (spatial + tabular pair) */}
          <div className="lg:col-span-8">
            <FleetTableCard
              hotspots={fleet?.hotspots || []}
              rewardsByKey={rewardsState.rewardsByKey}
              rewardsDone={rewardsState.done}
              iotStatusByKey={iotStatusState.statusByKey}
              iotDataThrough={iotStatusState.dataThrough}
              loading={fleetLoading}
            />
          </div>

          {/* Recent wallet activity — beside the Hotspot list */}
          <div className="lg:col-span-4">
            <TransactionsCard wallet={wallet} />
          </div>

          {/* Analytics gauges */}
          <div className="lg:col-span-4">
            <FleetCompositionCard
              stats={summary?.fleet}
              rewards={rewardsAgg}
              rewardsDone={rewardsState.done}
              iotStatus={iotStatusAgg}
              iotStatusDone={iotStatusState.done}
              iotDataThrough={iotStatusState.dataThrough}
            />
          </div>
          <div className="lg:col-span-4">
            <GeoCard regions={summary?.fleet?.regions} />
          </div>
          <div className="lg:col-span-4">
            <GovernanceCard positions={governance} loading={govLoading} error={govError} wallet={wallet} />
          </div>

          <div className="lg:col-span-6">
            <OperatorAnalyticsCard
              hotspots={fleet?.hotspots}
              rewardsByKey={rewardsState.rewardsByKey}
              rewardsDone={rewardsState.done}
              iotStatusByKey={iotStatusState.statusByKey}
              iotStatusDone={iotStatusState.done}
              iotDataThrough={iotStatusState.dataThrough}
              prices={prices}
              stats={summary?.fleet}
            />
          </div>
          <div className="lg:col-span-6">
            <DeploymentTimelineCard timeline={summary?.fleet?.timeline} />
          </div>
        </div>
      </main>
    </div>
  );
}
