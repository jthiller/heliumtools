import { useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { signAndBroadcast } from "../dc-mint/solanaUtils.js";
import DcMintModal from "../dc-mint/DcMintModal.jsx";
import { requestOnboard } from "../lib/mobileOnboardApi.js";
import { latLngToH3 } from "../lib/h3.js";
import LocationPicker from "./LocationPicker.jsx";
import { dcToUsd } from "./format.js";

/**
 * Step 3: pick the network's location and onboard it to the Mobile network
 * (onboard_data_only_mobile_hotspot_v0). Burns the DC onboarding + location
 * fees from the connected wallet; a DC-short wallet is routed through
 * DcMintModal before signing. One pin covers the whole network — place it on
 * the building the access points serve.
 */
export default function OnboardStep({ gateway, fees, location, onLocationChange, onOnboarded }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [submitState, setSubmitState] = useState("idle"); // idle | building | signing
  const [error, setError] = useState(null);
  const [dcInfo, setDcInfo] = useState(null);
  const [showDcModal, setShowDcModal] = useState(false);

  const h3Cell = useMemo(() => latLngToH3(location.lat, location.lng), [location.lat, location.lng]);
  const wifiFees = fees?.wifiDataOnly;
  const totalFee = wifiFees ? wifiFees.dc_onboarding_fee + wifiFees.location_staking_fee : null;

  const handleSubmit = async () => {
    if (!h3Cell || !publicKey) return;
    setError(null);
    setSubmitState("building");
    try {
      const result = await requestOnboard(publicKey.toBase58(), gateway.b58, h3Cell);
      if (result.already_onboarded) {
        onOnboarded();
        return;
      }
      if (result.dc_needed) {
        setDcInfo(result);
        setSubmitState("idle");
        setShowDcModal(true);
        return;
      }
      setSubmitState("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      await signAndBroadcast(txn, publicKey, sendTransaction, connection);
      onOnboarded();
    } catch (err) {
      setError(err.data?.not_indexed
        ? "The Hotspot isn't indexed yet. Wait a few seconds and try again."
        : err.message);
      setSubmitState("idle");
    }
  };

  const busy = submitState !== "idle";

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-secondary">
        Where is <span className="font-medium text-content">{gateway.name}</span>? A converted
        network gets one pin on the coverage map. Place it on the building your access points
        serve, dragging the map to position the pin.
      </p>

      <LocationPicker lat={location.lat} lng={location.lng} onChange={onLocationChange} />

      <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
        <div className="flex justify-between text-content-secondary">
          <span>Onboarding fee</span>
          <span className="font-mono">
            {wifiFees ? `${wifiFees.dc_onboarding_fee.toLocaleString()} DC` : "…"}
          </span>
        </div>
        <div className="flex justify-between text-content-secondary">
          <span>Location assert fee</span>
          <span className="font-mono">
            {wifiFees ? `${wifiFees.location_staking_fee.toLocaleString()} DC` : "…"}
          </span>
        </div>
        <div className="flex justify-between font-medium text-content">
          <span>Total</span>
          <span className="font-mono">
            {totalFee != null ? `${totalFee.toLocaleString()} DC ($${dcToUsd(totalFee)}) + network fee` : "…"}
          </span>
        </div>
        {dcInfo?.dc_needed && (
          <p className="text-amber-700 dark:text-amber-300">
            Your wallet has {dcInfo.current_dc.toLocaleString()} DC. {dcInfo.required_dc.toLocaleString()} DC needed.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={busy || !h3Cell || !publicKey}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitState === "building" ? "Building transaction…"
          : submitState === "signing" ? "Confirm in wallet…"
          : dcInfo?.dc_needed ? "Top up Data Credits"
          : h3Cell ? "Onboard to the Mobile network" : "Pick a location first"}
      </button>

      {showDcModal && (
        <DcMintModal
          defaultDcAmount={dcInfo?.required_dc || totalFee || 200_000}
          onClose={() => setShowDcModal(false)}
          onSuccess={() => {
            setShowDcModal(false);
            setDcInfo(null);
          }}
        />
      )}
    </div>
  );
}
