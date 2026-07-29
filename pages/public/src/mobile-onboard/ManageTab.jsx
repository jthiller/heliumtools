import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MagnifyingGlassIcon, MapPinIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { fetchFleet } from "../lib/walletDashboardApi.js";
import ManageDetail from "./ManageDetail.jsx";
import { isBrownfield, mobileDeviceLabel } from "./deviceTypes.js";

const SEARCH_CLASS =
  "w-full rounded-lg border border-border bg-surface-inset py-2 pl-9 pr-3 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function place(h) {
  const parts = [h.city, h.state || h.country].filter(Boolean);
  return parts.join(", ");
}

/**
 * Manage previously onboarded networks: the connected wallet's Mobile
 * Hotspots (via the wallet-dashboard fleet, filtered like update-location
 * filters IoT), each opening a detail panel for certificate retrieval and
 * location updates.
 */
export default function ManageTab() {
  const { connected, publicKey } = useWallet();
  const [searchParams] = useSearchParams();
  // Agents send operators here to regenerate an expired link, so `?hotspot=`
  // must land directly on that Hotspot instead of an unfiltered list.
  const requestedHotspot = searchParams.get("hotspot");

  const [hotspots, setHotspots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!connected || !publicKey) {
      setHotspots(null);
      setSelected(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    fetchFleet(publicKey.toBase58())
      .then((data) => {
        if (cancelled) return;
        const mobile = (data.hotspots || []).filter((h) => (h.networks || []).includes("mobile"));
        setHotspots(mobile);
        // Auto-open the Hotspot an expired-link recovery pointed the operator
        // at. If it isn't in this wallet's fleet, say so rather than silently
        // showing an unfiltered list the operator has to search by hand.
        if (requestedHotspot) {
          const match = mobile.find((h) => h.entityKey === requestedHotspot);
          if (match) setSelected(match);
          else setNotFound(requestedHotspot);
        }
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [connected, publicKey, requestedHotspot]);

  const rows = useMemo(() => {
    if (!hotspots) return [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? hotspots.filter((h) => {
          const hay = [h.name, h.entityKey, h.city, h.state, h.country]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : hotspots;
    // Converted WiFi (brownfield) networks are this tool's focus — sort them
    // to the top; Helium Indoor/Outdoor and other types render muted below.
    return [...filtered].sort((a, b) => isBrownfield(b.deviceType) - isBrownfield(a.deviceType));
  }, [hotspots, query]);

  const convertibleCount = useMemo(
    () => (hotspots || []).filter((h) => isBrownfield(h.deviceType)).length,
    [hotspots],
  );

  if (!connected) {
    return (
      <div className="rounded-2xl bg-surface-raised p-8 text-center shadow-soft">
        <p className="mb-4 text-sm text-content-secondary">
          Connect the Solana wallet that owns your Mobile Hotspots to manage them.
        </p>
        <div className="flex justify-center">
          <WalletMultiButton className="!rounded-lg !text-sm" />
        </div>
      </div>
    );
  }

  if (selected) {
    return <ManageDetail hotspot={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-content-tertiary">
          {loading
            ? "Loading your Hotspots…"
            : hotspots
              ? `${convertibleCount} converted WiFi network${convertibleCount === 1 ? "" : "s"}` +
                (hotspots.length > convertibleCount ? ` · ${hotspots.length - convertibleCount} other Mobile Hotspot(s)` : "")
              : ""}
        </p>
        <WalletMultiButton className="!h-8 !rounded-lg !text-xs" />
      </div>

      {error && (
        <div className="rounded-2xl bg-surface-raised p-6 text-center text-sm text-rose-500 shadow-soft">
          {error}
        </div>
      )}

      {!error && !loading && hotspots && hotspots.length === 0 && (
        <div className="rounded-2xl bg-surface-raised p-8 text-center text-sm text-content-tertiary shadow-soft">
          This wallet doesn't own any Mobile Hotspots yet. Onboard one from the Onboard tab.
        </div>
      )}

      {!error && hotspots && hotspots.length > 0 && (
        <>
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, address, or location"
              className={SEARCH_CLASS}
            />
          </div>

          {notFound && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
              The Hotspot in that link (<span className="font-mono">{notFound.slice(0, 12)}…</span>)
              isn't owned by this wallet. Connect the wallet that owns it, or pick it from the list
              below.
            </div>
          )}

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-content-tertiary">No Mobile Hotspots match.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface-raised shadow-soft">
              {rows.map((h) => {
                const brownfield = isBrownfield(h.deviceType);
                return (
                  <li key={h.entityKey}>
                    <button
                      onClick={() => setSelected(h)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-inset ${brownfield ? "" : "opacity-55"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-content">
                            {h.name || h.entityKey}
                          </span>
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-content-secondary">
                            {mobileDeviceLabel(h.deviceType)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-content-tertiary">
                          {!brownfield ? (
                            <span>No retrievable certificates</span>
                          ) : h.location ? (
                            <>
                              <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{place(h) || "Location asserted"}</span>
                            </>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">No location asserted</span>
                          )}
                        </div>
                      </div>
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-content-tertiary" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
