import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import {
  SignalIcon,
  WifiIcon,
  MapPinIcon,
  WalletIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import CopyButton from "../components/CopyButton.jsx";
import {
  lookupHotspot,
  fetchRewards,
  claimRewards,
  fetchWalletHotspots,
} from "../lib/hotspotClaimerApi.js";

const inputClassName =
  "block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function isValidEntityKey(key) {
  if (!key || typeof key !== "string") return false;
  if (key.length < 20 || key.length > 500) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(key);
}

function isValidWalletAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (addr.length < 32 || addr.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr);
}

function Spinner({ className = "h-4 w-4" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function NetworkBadge({ network }) {
  if (!network) return null;
  const isIot = network === "iot";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        isIot
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-800/50"
          : "bg-violet-50 text-violet-700 ring-1 ring-violet-100 dark:bg-violet-950/40 dark:text-violet-400 dark:ring-violet-800/50"
      }`}
    >
      {isIot ? (
        <SignalIcon className="h-3 w-3" />
      ) : (
        <WifiIcon className="h-3 w-3" />
      )}
      {network.toUpperCase()}
    </span>
  );
}

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTokenAmount(raw, decimals) {
  if (!raw || raw === "0") return "0";
  const num = Number(raw) / Math.pow(10, decimals);
  if (num < 0.01) return "<0.01";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Tab Toggle ───────────────────────────────────────────────────────────────

function TabToggle({ mode, onChange }) {
  return (
    <div className="flex rounded-lg bg-surface-inset p-1 mb-6">
      {[
        { key: "hotspot", label: "Hotspot" },
        { key: "wallet", label: "Wallet" },
      ].map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition ${
            mode === tab.key
              ? "bg-surface-raised text-content shadow-sm"
              : "text-content-secondary hover:text-content"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ─── Single Hotspot Mode Components ───────────────────────────────────────────

function RewardRow({ tokenKey, reward, initsAvailable }) {
  const label = reward.label || tokenKey.toUpperCase();
  const amount = formatTokenAmount(reward.pending, reward.decimals || 6);
  const hasPending = reward.pending && reward.pending !== "0";

  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm font-medium text-content-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`text-sm font-mono ${
            hasPending ? "text-content" : "text-content-tertiary"
          }`}
        >
          {amount}
        </span>
        {hasPending && !reward.claimable && reward.reason === "no_ata" && (
          <span className="text-xs text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40 rounded px-1.5 py-0.5">
            No token account
          </span>
        )}
        {hasPending && reward.claimable && reward.recipientExists === false && !initsAvailable && (
          <span className="text-xs text-accent-text bg-accent-surface dark:text-sky-400 dark:bg-sky-950/40 rounded px-1.5 py-0.5">
            Needs setup
          </span>
        )}
        {hasPending && reward.claimable && (reward.recipientExists !== false || initsAvailable) && (
          <span className="text-xs text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40 rounded px-1.5 py-0.5">
            Claimable
          </span>
        )}
      </div>
    </div>
  );
}

function ClaimResult({ claim }) {
  if (claim.error) {
    return (
      <div className="flex items-start gap-2 py-2 text-sm">
        <ExclamationTriangleIcon className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
        <div>
          <span className="font-medium text-content-secondary">{claim.token}</span>
          <span className="text-rose-600 dark:text-rose-400 ml-2">{claim.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 py-2 text-sm">
      <CheckCircleIcon className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-content-secondary">{claim.token}</span>
          <span className="font-mono text-content">
            {formatTokenAmount(claim.amount, claim.decimals || 6)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <a
            href={claim.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-xs text-accent-text hover:opacity-80 font-mono"
          >
            {truncateAddress(claim.txSignature)}
            <ArrowTopRightOnSquareIcon className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function LastClaimCard({ lastClaim }) {
  const claimedAt = new Date(lastClaim.claimedAt);
  const successClaims = lastClaim.claims.filter((c) => c.txSignature);

  if (successClaims.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6 mt-4">
      <h3 className="text-sm font-semibold text-content mb-1">
        Recent Claim
      </h3>
      <p className="text-xs text-content-secondary mb-3">
        {claimedAt.toLocaleString()} — next claim in{" "}
        {Math.max(
          0,
          Math.ceil(
            (lastClaim.cooldownHours * 3600000 -
              (Date.now() - claimedAt.getTime())) /
              3600000
          )
        )}h
      </p>
      <div className="divide-y divide-border-muted">
        {successClaims.map((claim, i) => (
          <ClaimResult key={i} claim={claim} />
        ))}
      </div>
    </div>
  );
}

function RewardsCard({
  rewards,
  loading,
  onClaim,
  claiming,
  claimResult,
  claimError,
  lastClaim,
  initsAvailable,
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-surface-raised p-6 mt-4">
        <div className="flex items-center gap-2 text-sm text-content-secondary">
          <Spinner />
          Querying oracles for pending rewards...
        </div>
      </div>
    );
  }

  if (!rewards) return null;

  const anyClaimable = Object.values(rewards).some((r) => r.claimable);

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6 mt-4">
      <h3 className="text-sm font-semibold text-content mb-3">
        Pending Rewards
      </h3>
      <div className="divide-y divide-border-muted">
        {Object.entries(rewards).map(([key, reward]) => (
          <RewardRow key={key} tokenKey={key} reward={reward} initsAvailable={initsAvailable} />
        ))}
      </div>

      {anyClaimable && !claimResult && !initsAvailable && Object.values(rewards).some(
        (r) => r.claimable && r.recipientExists === false
      ) && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
          Some rewards require a one-time on-chain setup before claim transactions can be issued here.
          The Hotspot owner can set this up by claiming once via the{" "}
          <a
            href="https://wallet.helium.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
          >
            Helium wallet app
          </a>.
        </p>
      )}

      {lastClaim && !claimResult && (
        <LastClaimCard lastClaim={lastClaim} />
      )}

      {anyClaimable && !claimResult && !lastClaim && (
        <button
          onClick={onClaim}
          disabled={claiming}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {claiming ? (
            <>
              <Spinner />
              Issuing claim...
            </>
          ) : (
            "Claim Rewards"
          )}
        </button>
      )}

      {claimResult && (
        <div className="mt-4 pt-4 border-t border-border">
          <h4 className="text-sm font-semibold text-content mb-2">
            {claimResult.success ? "Claim Submitted" : "Claim Results"}
          </h4>
          <div className="divide-y divide-border-muted">
            {claimResult.claims.map((claim, i) => (
              <ClaimResult key={i} claim={claim} />
            ))}
          </div>
        </div>
      )}

      {claimError && !claimResult && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300">
          {claimError}
        </div>
      )}

      {!anyClaimable && !claimResult && (() => {
        const hasNoAta = Object.values(rewards).some(
          (r) => r.pending && r.pending !== "0" && r.reason === "no_ata"
        );
        return (
          <div className="mt-3 text-xs text-content-secondary space-y-1.5">
            {hasNoAta && (
              <p className="text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
                The reward recipient does not have a token account for one or more reward types.
                The owner must create the token account before claim transactions can be issued.
              </p>
            )}
            {!hasNoAta && (
              <p>No pending rewards to claim for this Hotspot.</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function SolanaAddress({ address }) {
  return (
    <dd className="flex items-center gap-1 min-w-0">
      <a
        href={`https://orbmarkets.io/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-accent-text hover:opacity-80 truncate"
      >
        {truncateAddress(address)}
      </a>
      <CopyButton text={address} size="h-3.5 w-3.5" />
    </dd>
  );
}

function HotspotCard({ hotspot, destination, rewardsLoaded, onNavigateToWallet }) {
  const locationParts = [hotspot.city, hotspot.state, hotspot.country].filter(Boolean);
  const hasCustomRecipient = destination && destination !== hotspot.owner;
  const recipientAddress = hasCustomRecipient ? destination : hotspot.owner;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-content truncate">
            {hotspot.name || "Unknown"}
          </h3>
          <p className="text-xs text-content-secondary font-mono mt-0.5 truncate">
            Asset: {truncateAddress(hotspot.assetId)}
          </p>
        </div>
        <NetworkBadge network={hotspot.network} />
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="flex items-start gap-2">
          <WalletIcon className="h-4 w-4 text-content-tertiary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <dt className="text-xs text-content-secondary">Owner</dt>
            <dd className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => onNavigateToWallet(hotspot.owner)}
                className="font-mono text-accent-text hover:opacity-80 hover:underline truncate"
                title="View wallet Hotspots"
              >
                {truncateAddress(hotspot.owner)}
              </button>
              <CopyButton text={hotspot.owner} size="h-3.5 w-3.5" />
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <WalletIcon className="h-4 w-4 text-content-tertiary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <dt className="text-xs text-content-secondary">Rewards Recipient</dt>
            {rewardsLoaded ? (
              <dd className="flex items-center gap-1 min-w-0">
                <a
                  href={`https://orbmarkets.io/address/${recipientAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-accent-text hover:opacity-80 truncate"
                >
                  {truncateAddress(recipientAddress)}
                </a>
                <CopyButton text={recipientAddress} size="h-3.5 w-3.5" />
                {!hasCustomRecipient && (
                  <span className="text-xs text-content-tertiary font-sans">(owner)</span>
                )}
              </dd>
            ) : (
              <dd className="text-content-tertiary text-xs">Loading...</dd>
            )}
          </div>
        </div>
        {locationParts.length > 0 && (
          <div className="flex items-start gap-2">
            <MapPinIcon className="h-4 w-4 text-content-tertiary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <dt className="text-xs text-content-secondary">Location</dt>
              <dd className="text-content truncate">
                {locationParts.join(", ")}
              </dd>
            </div>
          </div>
        )}
      </dl>
    </div>
  );
}

// ─── Single Hotspot Mode ──────────────────────────────────────────────────────

function HotspotMode({ initialKey, onKeyChange, onNavigateToWallet }) {
  const [entityKey, setEntityKey] = useState(initialKey || "");
  const [hotspot, setHotspot] = useState(null);
  const [rewards, setRewards] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingRewards, setLoadingRewards] = useState(false);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [claimError, setClaimError] = useState("");
  const [lastClaim, setLastClaim] = useState(null);
  const [initsAvailable, setInitsAvailable] = useState(true);
  const debounceRef = useRef(null);
  const prevInitialKeyRef = useRef(initialKey);

  // Sync entityKey to URL params
  useEffect(() => {
    onKeyChange(entityKey.trim());
  }, [entityKey, onKeyChange]);

  // If initialKey changes externally (e.g., navigating from wallet tab), update local state
  useEffect(() => {
    if (initialKey !== prevInitialKeyRef.current) {
      prevInitialKeyRef.current = initialKey;
      if (initialKey && initialKey !== entityKey.trim()) {
        setEntityKey(initialKey);
      }
    }
  }, [initialKey]);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const key = entityKey.trim();

    if (!isValidEntityKey(key)) {
      if (hotspot) {
        setHotspot(null);
        setRewards(null);
        setClaimResult(null);
        setClaimError("");
        setLastClaim(null);
        setInitsAvailable(true);
        setError("");
      }
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      setHotspot(null);
      setRewards(null);
      setClaimResult(null);
      setClaimError("");
      setLastClaim(null);
      setInitsAvailable(true);

      try {
        const result = await lookupHotspot(key);
        if (key !== entityKey.trim()) return;
        setHotspot(result);

        setLoadingRewards(true);
        try {
          const rewardsResult = await fetchRewards(key);
          if (key !== entityKey.trim()) return;
          setRewards(rewardsResult.rewards);
          if (rewardsResult.initsAvailable !== undefined) {
            setInitsAvailable(rewardsResult.initsAvailable);
          }
          if (rewardsResult.lastClaim) {
            setLastClaim(rewardsResult.lastClaim);
          }
        } catch (err) {
          console.error("Rewards fetch failed:", err.message);
        } finally {
          setLoadingRewards(false);
        }
      } catch (err) {
        if (key === entityKey.trim()) {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [entityKey]);

  async function handleClaim() {
    setClaiming(true);
    setClaimError("");
    setClaimResult(null);

    try {
      const result = await claimRewards(entityKey.trim());
      setClaimResult(result);

      // Refresh rewards after 20s to reflect the claim on-chain
      if (result.success) {
        const key = entityKey.trim();
        setTimeout(async () => {
          try {
            const fresh = await fetchRewards(key);
            if (key === entityKey.trim()) {
              setRewards(fresh.rewards);
              if (fresh.lastClaim) setLastClaim(fresh.lastClaim);
            }
          } catch {}
        }, 10000);
      }
    } catch (err) {
      setClaimError(err.message);
    } finally {
      setClaiming(false);
    }
  }

  const destination = rewards
    ? Object.values(rewards).find((r) => r.destination)?.destination || null
    : null;

  return (
    <>
      <div className="mb-6">
        <label
          htmlFor="entityKey"
          className="block text-sm font-medium text-content-secondary mb-1.5"
        >
          Hotspot Entity Key
        </label>
        <div className="relative">
          <input
            id="entityKey"
            type="text"
            value={entityKey}
            onChange={(e) => setEntityKey(e.target.value)}
            placeholder="Enter Hotspot ECC compact key or entity key..."
            className={`${inputClassName} font-mono text-xs pr-10`}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Spinner className="h-4 w-4 text-content-tertiary" />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300 mb-6">
          {error}
        </div>
      )}

      {hotspot && (
        <HotspotCard
          hotspot={hotspot}
          destination={destination}
          rewardsLoaded={rewards !== null}
          onNavigateToWallet={onNavigateToWallet}
        />
      )}

      {hotspot && (
        <RewardsCard
          rewards={rewards}
          loading={loadingRewards}
          onClaim={handleClaim}
          claiming={claiming}
          claimResult={claimResult}
          claimError={claimError}
          lastClaim={lastClaim}
          initsAvailable={initsAvailable}
        />
      )}
    </>
  );
}

// ─── Wallet Mode Components ───────────────────────────────────────────────────

const REWARD_BATCH_SIZE = 10;
const DEFAULT_DECIMALS = { iot: 6, mobile: 6, hnt: 8 };

function getTokenDecimals(rewards, tokenKey) {
  return rewards?.[tokenKey]?.decimals ?? DEFAULT_DECIMALS[tokenKey] ?? 6;
}

function getTokenAmount(rewards, tokenKey) {
  const r = rewards?.[tokenKey];
  if (!r || !r.pending || r.pending === "0") return 0;
  return Number(r.pending) / Math.pow(10, getTokenDecimals(rewards, tokenKey));
}

function isHotspotClaimable(rewards) {
  if (!rewards) return false;
  return Object.values(rewards).some((r) => r.claimable && r.pending !== "0");
}

function WalletRewardCells({ entityKey, walletRewards, rewardsLoading }) {
  const rewards = walletRewards[entityKey];
  const loading = !rewards && rewardsLoading;
  return (
    <>
      {["iot", "mobile", "hnt"].map((token) => (
        <td key={token} className="py-3 text-right">
          {loading ? (
            <Spinner className="h-3 w-3 text-content-tertiary ml-auto" />
          ) : (
            <span className={`text-xs font-mono ${getTokenAmount(rewards, token) > 0 ? "text-content" : "text-content-tertiary"}`}>
              {rewards ? formatTokenAmount(rewards[token]?.pending, getTokenDecimals(rewards, token)) : "—"}
            </span>
          )}
        </td>
      ))}
    </>
  );
}

function WalletActionCell({ entityKey, claimStates, claimResults, claimErrors, walletRewards, claimAllActive, onClaim, mobile }) {
  const claimState = claimStates[entityKey];
  const claimable = isHotspotClaimable(walletRewards[entityKey]);
  const Tag = mobile ? "div" : "td";
  const className = mobile ? "shrink-0" : "py-3 pr-6 text-right";

  return (
    <Tag className={className}>
      {claimState === "claiming" && (
        <span className="inline-flex items-center gap-1 text-xs text-accent-text">
          <Spinner className="h-3 w-3" /> Claiming...
        </span>
      )}
      {claimState === "claimed" && (() => {
        const result = claimResults.get(entityKey);
        const txClaim = result?.claims?.find((c) => c.txSignature);
        return (
          <div className="text-right">
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircleIcon className="h-3.5 w-3.5" /> Claimed
            </span>
            {txClaim && (
              <a
                href={txClaim.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-accent-text hover:opacity-80 font-mono mt-0.5"
              >
                {truncateAddress(txClaim.txSignature)}
              </a>
            )}
          </div>
        );
      })()}
      {claimState === "error" && (
        <div className="text-right max-w-[180px] ml-auto">
          <span className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
            <ExclamationTriangleIcon className="h-3.5 w-3.5 shrink-0" /> Failed
          </span>
          {claimErrors[entityKey] && (
            <p className="text-xs text-rose-500 dark:text-rose-400 mt-0.5 truncate" title={claimErrors[entityKey]}>
              {claimErrors[entityKey]}
            </p>
          )}
        </div>
      )}
      {claimState === "cooldown" && (
        <span className="text-xs text-content-tertiary">On Cooldown</span>
      )}
      {claimState === "rate_limited" && (
        <div className="text-right max-w-[180px] ml-auto">
          <span className="text-xs text-amber-600">Rate Limited</span>
          {claimErrors[entityKey] && (
            <p className="text-xs text-amber-500 mt-0.5 truncate" title={claimErrors[entityKey]}>
              {claimErrors[entityKey]}
            </p>
          )}
        </div>
      )}
      {!claimState && claimable && (
        <button
          onClick={() => onClaim(entityKey)}
          disabled={claimAllActive}
          className="text-xs font-medium text-accent-text hover:opacity-80 disabled:opacity-50"
        >
          Claim
        </button>
      )}
      {!claimState && !claimable && walletRewards[entityKey] && (
        <span className="text-xs text-content-tertiary">—</span>
      )}
    </Tag>
  );
}


function WalletClaimSummary({ claimResults, claimErrors, claimStates }) {
  const allClaims = [];
  for (const [, result] of claimResults) {
    if (result?.claims) {
      allClaims.push(...result.claims);
    }
  }

  const successClaims = allClaims.filter((c) => c.txSignature);
  const failedClaims = allClaims.filter((c) => c.error);

  // Count errors from thrown exceptions (not in claimResults)
  const thrownErrors = Object.entries(claimStates)
    .filter(([, state]) => state === "error" || state === "rate_limited")
    .filter(([key]) => !claimResults.has(key))
    .map(([key]) => ({ entityKey: key, error: claimErrors[key] || "Unknown error" }));

  const totalErrors = failedClaims.length + thrownErrors.length;
  if (successClaims.length === 0 && totalErrors === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-6 mt-4">
      <h3 className="text-sm font-semibold text-content mb-3">
        Claim Results
        {successClaims.length > 0 && (
          <span className="text-emerald-600 font-normal ml-2">
            {successClaims.length} succeeded
          </span>
        )}
        {totalErrors > 0 && (
          <span className="text-rose-600 dark:text-rose-400 font-normal ml-2">
            {totalErrors} failed
          </span>
        )}
      </h3>
      <div className="divide-y divide-border-muted">
        {successClaims.map((claim, i) => (
          <ClaimResult key={`s-${i}`} claim={claim} />
        ))}
        {failedClaims.map((claim, i) => (
          <ClaimResult key={`f-${i}`} claim={claim} />
        ))}
        {thrownErrors.map((err, i) => (
          <div key={`e-${i}`} className="flex items-start gap-2 py-2 text-sm">
            <ExclamationTriangleIcon className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-rose-600 dark:text-rose-400">{err.error}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WalletMode({ initialAddress, onAddressChange, onNavigateToHotspot }) {
  const [walletAddress, setWalletAddress] = useState(initialAddress || "");
  const [hotspots, setHotspots] = useState([]);
  const [hotspotsCount, setHotspotsCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [initsAvailable, setInitsAvailable] = useState(true);

  // Rewards: Map<entityKey, rewardsObj>
  const [walletRewards, setWalletRewards] = useState({});
  const [rewardsProgress, setRewardsProgress] = useState({ loaded: 0, total: 0 });
  const [rewardsLoading, setRewardsLoading] = useState(false);

  // Claim state per hotspot: Map<entityKey, "claiming"|"claimed"|"error"|"cooldown"|"rate_limited">
  const [claimStates, setClaimStates] = useState({});
  // Error messages per hotspot: Map<entityKey, string>
  const [claimErrors, setClaimErrors] = useState({});
  // Claim results per hotspot: Map<entityKey, claimResult>
  const [claimResults, setClaimResults] = useState(new Map());
  // Claim All state
  const [claimAllActive, setClaimAllActive] = useState(false);
  const [claimAllProgress, setClaimAllProgress] = useState({ current: 0, total: 0 });
  const [claimAllError, setClaimAllError] = useState("");
  const claimAllAbortRef = useRef(false);

  const debounceRef = useRef(null);

  // Sync wallet address to URL params
  useEffect(() => {
    onAddressChange(walletAddress.trim());
  }, [walletAddress, onAddressChange]);

  // Auto-lookup wallet
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    const addr = walletAddress.trim();

    if (!isValidWalletAddress(addr)) {
      if (hotspots.length > 0) {
        setHotspots([]);
        setHotspotsCount(0);
        setWalletRewards({});
        setRewardsProgress({ loaded: 0, total: 0 });
        setClaimStates({});
        setClaimErrors({});
        setClaimResults(new Map());
        setClaimAllActive(false);
        setClaimAllError("");
        setError("");
      }
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      setHotspots([]);
      setHotspotsCount(0);
      setWalletRewards({});
      setRewardsProgress({ loaded: 0, total: 0 });
      setClaimStates({});
      setClaimErrors({});
      setClaimResults(new Map());
      setClaimAllActive(false);
      setClaimAllError("");

      try {
        const result = await fetchWalletHotspots(addr);
        if (addr !== walletAddress.trim()) return;
        setHotspots(result.hotspots || []);
        setHotspotsCount(result.hotspots_count || result.hotspots?.length || 0);
        if (result.initsAvailable !== undefined) {
          setInitsAvailable(result.initsAvailable);
        }

        // Start progressive rewards fetch
        if (result.hotspots?.length > 0) {
          loadRewardsProgressively(result.hotspots, addr);
        }
      } catch (err) {
        if (addr === walletAddress.trim()) {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [walletAddress]);

  async function loadRewardsProgressively(hotspotList, expectedAddr) {
    setRewardsLoading(true);
    setRewardsProgress({ loaded: 0, total: hotspotList.length });

    let loaded = 0;

    for (let i = 0; i < hotspotList.length; i += REWARD_BATCH_SIZE) {
      if (expectedAddr !== walletAddress.trim()) return;

      const batch = hotspotList.slice(i, i + REWARD_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (h) => {
          try {
            const result = await fetchRewards(h.entityKey);
            return { entityKey: h.entityKey, rewards: result.rewards, lastClaim: result.lastClaim };
          } catch {
            return { entityKey: h.entityKey, rewards: null };
          }
        })
      );

      if (expectedAddr !== walletAddress.trim()) return;

      setWalletRewards((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            next[r.value.entityKey] = r.value.rewards;
            // Mark cooldown if applicable
            if (r.value.lastClaim) {
              setClaimStates((prevStates) => ({
                ...prevStates,
                [r.value.entityKey]: "cooldown",
              }));
            }
          }
        }
        return next;
      });

      loaded += batch.length;
      setRewardsProgress({ loaded: Math.min(loaded, hotspotList.length), total: hotspotList.length });
    }

    setRewardsLoading(false);
  }

  const handleClaimSingle = useCallback(async (entityKey) => {
    setClaimStates((prev) => ({ ...prev, [entityKey]: "claiming" }));
    try {
      const result = await claimRewards(entityKey);
      setClaimResults((prev) => new Map(prev).set(entityKey, result));
      if (result.success) {
        setClaimStates((prev) => ({ ...prev, [entityKey]: "claimed" }));

        // Refresh rewards after delay to reflect the claim on-chain
        setTimeout(async () => {
          try {
            const fresh = await fetchRewards(entityKey);
            if (fresh.rewards) {
              setWalletRewards((prev) => ({ ...prev, [entityKey]: fresh.rewards }));
            }
          } catch {}
        }, 10000);
      } else {
        // API returned success:false with per-token claim errors
        const errorMsg = result.claims
          ?.filter((c) => c.error)
          .map((c) => `${c.token}: ${c.error}`)
          .join("; ") || "Claim failed";
        setClaimErrors((prev) => ({ ...prev, [entityKey]: errorMsg }));
        setClaimStates((prev) => ({ ...prev, [entityKey]: "error" }));
      }
      return result;
    } catch (err) {
      const msg = err.message || "Claim failed";
      const isRateLimit = /rate|too many|429|cooldown|recently|daily.*limit|limit.*reached/i.test(msg);
      setClaimErrors((prev) => ({ ...prev, [entityKey]: msg }));
      setClaimStates((prev) => ({
        ...prev,
        [entityKey]: isRateLimit ? "rate_limited" : "error",
      }));
      return { success: false, rateLimited: isRateLimit, error: msg };
    }
  }, []);

  async function handleClaimAll() {
    const eligible = hotspots.filter((h) => {
      const rewards = walletRewards[h.entityKey];
      const state = claimStates[h.entityKey];
      return isHotspotClaimable(rewards) && !state;
    });

    if (eligible.length === 0) return;

    setClaimAllActive(true);
    setClaimAllError("");
    setClaimAllProgress({ current: 0, total: eligible.length });
    claimAllAbortRef.current = false;

    for (let i = 0; i < eligible.length; i++) {
      if (claimAllAbortRef.current) break;

      setClaimAllProgress({ current: i + 1, total: eligible.length });
      const result = await handleClaimSingle(eligible[i].entityKey);

      if (result.rateLimited) {
        setClaimAllError(
          `Rate limit reached. ${i} of ${eligible.length} Hotspots claimed.`
        );
        break;
      }
    }

    setClaimAllActive(false);
  }

  function handleStopClaimAll() {
    claimAllAbortRef.current = true;
  }

  // Compute totals
  const totals = { iot: 0, mobile: 0, hnt: 0 };
  for (const rewards of Object.values(walletRewards)) {
    if (!rewards) continue;
    totals.iot += getTokenAmount(rewards, "iot");
    totals.mobile += getTokenAmount(rewards, "mobile");
    totals.hnt += getTokenAmount(rewards, "hnt");
  }

  const anyClaimable = hotspots.some((h) => {
    const rewards = walletRewards[h.entityKey];
    const state = claimStates[h.entityKey];
    return isHotspotClaimable(rewards) && !state;
  });

  const hasClaimResults = claimResults.size > 0 || Object.keys(claimErrors).length > 0;

  return (
    <>
      <div className="mb-6">
        <label
          htmlFor="walletAddr"
          className="block text-sm font-medium text-content-secondary mb-1.5"
        >
          Wallet Address
        </label>
        <div className="relative">
          <input
            id="walletAddr"
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="Enter Solana wallet address..."
            className={`${inputClassName} font-mono text-xs pr-10`}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Spinner className="h-4 w-4 text-content-tertiary" />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-300 mb-6">
          {error}
        </div>
      )}

      {/* Hotspot List */}
      {hotspots.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-raised overflow-hidden">
          {/* Header */}
          <div className="px-4 sm:px-6 py-4 border-b border-border-muted flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-content">
                {hotspotsCount} Hotspot{hotspotsCount !== 1 ? "s" : ""}
              </h3>
              {rewardsLoading && (
                <p className="text-xs text-content-secondary mt-0.5">
                  Loading rewards {rewardsProgress.loaded}/{rewardsProgress.total}...
                </p>
              )}
            </div>
            {claimAllActive && (
              <div className="flex items-center gap-3">
                <span className="text-xs text-accent-text">
                  Claiming {claimAllProgress.current} of {claimAllProgress.total} Hotspots...
                </span>
                <button
                  onClick={handleStopClaimAll}
                  className="text-xs text-rose-600 dark:text-rose-400 hover:text-rose-500 dark:hover:text-rose-300 font-medium"
                >
                  Stop
                </button>
              </div>
            )}
          </div>

          {/* Desktop table (hidden on mobile) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-muted text-xs text-content-secondary uppercase tracking-wider">
                  <th className="px-6 py-2.5 font-medium">Hotspot</th>
                  <th className="px-0 py-2.5 font-medium">Entity Key</th>
                  <th className="px-0 py-2.5 font-medium text-right">IOT</th>
                  <th className="px-0 py-2.5 font-medium text-right">MOBILE</th>
                  <th className="px-0 py-2.5 font-medium text-right">HNT</th>
                  <th className="px-0 py-2.5 pr-6 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {hotspots.map((h) => (
                  <tr key={h.entityKey} className="border-b border-border-muted last:border-0">
                    <td className="px-6 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-content truncate max-w-[200px]">
                            {h.name || "Unknown"}
                          </span>
                          <NetworkBadge network={h.network} />
                        </div>
                        {[h.city, h.state, h.country].filter(Boolean).length > 0 && (
                          <p className="text-xs text-content-secondary truncate mt-0.5">
                            {[h.city, h.state, h.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onNavigateToHotspot(h.entityKey)}
                          className="font-mono text-xs text-accent-text hover:opacity-80 hover:underline"
                          title="View Hotspot details"
                        >
                          {truncateAddress(h.entityKey)}
                        </button>
                        <CopyButton text={h.entityKey} size="h-3 w-3" />
                      </div>
                    </td>
                    <WalletRewardCells entityKey={h.entityKey} walletRewards={walletRewards} rewardsLoading={rewardsLoading} />
                    <WalletActionCell
                      entityKey={h.entityKey}
                      claimStates={claimStates}
                      claimResults={claimResults}
                      claimErrors={claimErrors}
                      walletRewards={walletRewards}
                      claimAllActive={claimAllActive}
                      onClaim={handleClaimSingle}
                    />
                  </tr>
                ))}
              </tbody>

              {/* Totals row */}
              {!rewardsLoading && Object.keys(walletRewards).length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-surface-inset">
                    <td className="px-6 py-3 text-sm font-semibold text-content" colSpan={2}>
                      Total
                    </td>
                    <td className="py-3 text-right text-xs font-mono font-semibold text-content">
                      {totals.iot > 0 ? totals.iot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}
                    </td>
                    <td className="py-3 text-right text-xs font-mono font-semibold text-content">
                      {totals.mobile > 0 ? totals.mobile.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}
                    </td>
                    <td className="py-3 text-right text-xs font-mono font-semibold text-content">
                      {totals.hnt > 0 ? totals.hnt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0"}
                    </td>
                    <td className="py-3 pr-6"></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile card list (hidden on desktop) */}
          <div className="md:hidden divide-y divide-border-muted">
            {hotspots.map((h) => {
              const rewards = walletRewards[h.entityKey];
              const loading = !rewards && rewardsLoading;
              const hnt = rewards ? getTokenAmount(rewards, "hnt") : 0;
              const iot = rewards ? getTokenAmount(rewards, "iot") : 0;
              const mobile = rewards ? getTokenAmount(rewards, "mobile") : 0;
              return (
                <div key={h.entityKey} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-content truncate">
                          {h.name || "Unknown"}
                        </span>
                        <NetworkBadge network={h.network} />
                      </div>
                      {[h.city, h.state, h.country].filter(Boolean).length > 0 && (
                        <p className="text-xs text-content-secondary truncate mt-0.5">
                          {[h.city, h.state, h.country].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                    <WalletActionCell
                      entityKey={h.entityKey}
                      claimStates={claimStates}
                      claimResults={claimResults}
                      claimErrors={claimErrors}
                      walletRewards={walletRewards}
                      claimAllActive={claimAllActive}
                      onClaim={handleClaimSingle}
                      mobile
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => onNavigateToHotspot(h.entityKey)}
                      className="font-mono text-xs text-accent-text hover:opacity-80 hover:underline"
                    >
                      {truncateAddress(h.entityKey)}
                    </button>
                    <CopyButton text={h.entityKey} size="h-3 w-3" />
                  </div>
                  {loading ? (
                    <div className="mt-2"><Spinner className="h-3 w-3 text-content-tertiary" /></div>
                  ) : rewards ? (
                    <div className="mt-2 flex gap-4 text-xs font-mono">
                      {iot > 0 && <span className="text-content-secondary">IOT <span className="font-semibold">{formatTokenAmount(rewards.iot?.pending, getTokenDecimals(rewards, "iot"))}</span></span>}
                      {mobile > 0 && <span className="text-content-secondary">MOBILE <span className="font-semibold">{formatTokenAmount(rewards.mobile?.pending, getTokenDecimals(rewards, "mobile"))}</span></span>}
                      {hnt > 0 && <span className="text-content-secondary">HNT <span className="font-semibold">{formatTokenAmount(rewards.hnt?.pending, getTokenDecimals(rewards, "hnt"))}</span></span>}
                      {iot === 0 && mobile === 0 && hnt === 0 && <span className="text-content-tertiary">No rewards</span>}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Mobile totals */}
            {!rewardsLoading && Object.keys(walletRewards).length > 0 && (
              <div className="px-4 py-3 bg-surface-inset flex items-center justify-between">
                <span className="text-sm font-semibold text-content">Total</span>
                <div className="flex gap-4 text-xs font-mono font-semibold text-content">
                  {totals.iot > 0 && <span>IOT {totals.iot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                  {totals.mobile > 0 && <span>MOBILE {totals.mobile.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                  {totals.hnt > 0 && <span>HNT {totals.hnt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Claim All button */}
          {anyClaimable && !claimAllActive && (
            <div className="px-4 sm:px-6 py-4 border-t border-border-muted">
              <button
                onClick={handleClaimAll}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition"
              >
                Claim All
              </button>
            </div>
          )}

          {claimAllActive && (
            <div className="px-4 sm:px-6 py-4 border-t border-border-muted">
              <div className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-accent-surface px-4 py-2.5 text-sm text-accent-text">
                <Spinner className="h-4 w-4" />
                Claiming {claimAllProgress.current} of {claimAllProgress.total} Hotspots...
              </div>
            </div>
          )}

          {claimAllError && (
            <div className="px-4 sm:px-6 pb-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
                {claimAllError}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Claim Results Summary */}
      {hasClaimResults && (
        <WalletClaimSummary
          claimResults={claimResults}
          claimErrors={claimErrors}
          claimStates={claimStates}
        />
      )}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HotspotClaimer() {
  const [searchParams, setSearchParams] = useSearchParams();

  const mode = searchParams.get("mode") === "wallet" ? "wallet" : "hotspot";
  const urlKey = searchParams.get("key") || "";
  const urlWallet = searchParams.get("wallet") || "";

  const setMode = useCallback((newMode) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("mode", newMode);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleKeyChange = useCallback((key) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (key) {
        next.set("key", key);
      } else {
        next.delete("key");
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleWalletChange = useCallback((addr) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (addr) {
        next.set("wallet", addr);
      } else {
        next.delete("wallet");
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleNavigateToHotspot = useCallback((entityKey) => {
    setSearchParams({ mode: "hotspot", key: entityKey, ...(urlWallet ? { wallet: urlWallet } : {}) }, { replace: true });
  }, [setSearchParams, urlWallet]);

  const handleNavigateToWallet = useCallback((walletAddress) => {
    setSearchParams({ mode: "wallet", wallet: walletAddress, ...(urlKey ? { key: urlKey } : {}) }, { replace: true });
  }, [setSearchParams, urlKey]);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Reward Claimer" />
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8">
          <p className="text-[13px] font-mono font-medium uppercase tracking-[0.08em] text-accent-text mb-2">
            Hotspot Tools
          </p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-content tracking-[-0.03em] mb-2">
            Reward Claimer
          </h1>
          <p className="text-base text-content-secondary">
            Look up a Hotspot or wallet, view pending rewards, and issue
            permissionless claim transactions.
          </p>
          <p className="text-xs text-content-tertiary mt-1">
            This tool is provided for demonstration purposes. Rate limits are applied.
          </p>
        </div>

        <TabToggle mode={mode} onChange={setMode} />

        {mode === "hotspot" ? (
          <HotspotMode initialKey={urlKey} onKeyChange={handleKeyChange} onNavigateToWallet={handleNavigateToWallet} />
        ) : (
          <WalletMode
            initialAddress={urlWallet}
            onAddressChange={handleWalletChange}
            onNavigateToHotspot={handleNavigateToHotspot}
          />
        )}
      </main>
    </div>
  );
}
