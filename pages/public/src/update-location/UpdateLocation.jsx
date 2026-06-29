import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MapPinIcon } from "@heroicons/react/24/outline";
import Header from "../components/Header.jsx";
import { fetchFleet } from "../lib/walletDashboardApi.js";
import HotspotList from "./HotspotList.jsx";
import UpdatePanel from "./UpdatePanel.jsx";

export default function UpdateLocation() {
  const { connected, publicKey } = useWallet();

  const [hotspots, setHotspots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  // Load the connected wallet's IoT Hotspots.
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
        const iot = (data.hotspots || []).filter((h) => (h.networks || []).includes("iot"));
        setHotspots(iot);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [connected, publicKey]);

  return (
    <div className="min-h-screen bg-surface">
      <Header breadcrumb="Update Hotspot Location" />

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-lime-50 text-lime-600 dark:bg-lime-950/40 dark:text-lime-400">
              <MapPinIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold tracking-[-0.02em] text-content">
                Update Hotspot Location
              </h1>
              <p className="text-sm text-content-tertiary">
                Connect your Solana wallet to re-assert the location, elevation, or antenna gain of your IoT Hotspots.
              </p>
            </div>
          </div>
        </div>

        {!connected ? (
          <div className="rounded-2xl bg-surface-raised p-8 text-center shadow-soft">
            <p className="mb-4 text-sm text-content-secondary">
              Connect a Solana wallet (Phantom, Brave, Solflare, …) that owns your Hotspots to get started.
            </p>
            <div className="flex justify-center">
              <WalletMultiButton className="!rounded-lg !text-sm" />
            </div>
          </div>
        ) : selected ? (
          <UpdatePanel hotspot={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs text-content-tertiary">
                {loading ? "Loading your Hotspots…" : hotspots ? `${hotspots.length} IoT Hotspot(s)` : ""}
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
                This wallet doesn’t own any IoT Hotspots.
              </div>
            )}

            {!error && hotspots && hotspots.length > 0 && (
              <HotspotList hotspots={hotspots} onSelect={setSelected} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
