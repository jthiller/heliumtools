import { useMemo, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { signAndBroadcast } from "../dc-mint/solanaUtils.js";
import DcMintModal from "../dc-mint/DcMintModal.jsx";
import { requestOnboard } from "../lib/mobileOnboardApi.js";
import { latLngToH3 } from "../lib/h3.js";
import LocationPicker from "./LocationPicker.jsx";
import { geocodeAddress } from "./geocode.js";
import { dcToUsd } from "./format.js";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-surface-inset px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

/**
 * Step 3: pick the network's location and onboard it to the Mobile network
 * (onboard_data_only_mobile_hotspot_v0). Burns the DC onboarding + location
 * fees from the connected wallet; a DC-short wallet is routed through
 * DcMintModal before signing. One pin covers the whole network — place it on
 * the building the access points serve.
 *
 * Address-first: the operator types the street address, a geocode drops the
 * pin there (fine-tunable by dragging), and the same string rides
 * certForm.address so the certificate step opens pre-filled. The address is
 * optional here — the map alone still works (an untouched picker starts on
 * the CF-geo-seeded viewport), and the failure copy just says to place the
 * pin by hand rather than claiming where the map is centered, since the user
 * may have dragged it anywhere before searching.
 */
export default function OnboardStep({ gateway, fees, location, onLocationChange, address, onAddressChange, onOnboarded }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [submitState, setSubmitState] = useState("idle"); // idle | building | signing
  const [error, setError] = useState(null);
  const [dcInfo, setDcInfo] = useState(null);
  const [showDcModal, setShowDcModal] = useState(false);

  // Address search: null | "searching" | { label, zoom } | { error }.
  // The zoom rides the hit it describes (a city-level match must not land at
  // rooftop zoom), so it clears with the label when the address is edited
  // rather than outliving the search it came from.
  const [searchState, setSearchState] = useState(null);
  const searching = searchState === "searching";
  const query = address.trim();

  // The input stays editable during a search, so a resolving request must
  // check its query is still what the input says before describing it.
  const addressRef = useRef(address);
  addressRef.current = address;

  const handleFindOnMap = async () => {
    if (!query || searching) return;
    setSearchState("searching");
    try {
      const hit = await geocodeAddress(query);
      if (addressRef.current.trim() !== query) {
        // Superseded mid-flight: labeling the new text with the old result
        // would misdescribe it. Reset and let them search again.
        setSearchState(null);
        return;
      }
      if (!hit) {
        setSearchState({
          error:
            "Couldn't find that address. Try adding a city or postcode, or drag the map to place the pin by hand.",
        });
        return;
      }
      // The picker recenters itself on any location it didn't produce, so
      // setting the value is all a geocode hit needs to move the camera. The
      // zoom hint must land in the same commit, hence both before the await
      // boundary passes.
      setSearchState({ label: hit.label, zoom: hit.zoom });
      onLocationChange({ lat: hit.lat.toFixed(6), lng: hit.lng.toFixed(6) });
    } catch {
      setSearchState({
        error: "Address search is unavailable right now. Drag the map to place the pin by hand.",
      });
    }
  };

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
        network gets one pin on the coverage map. Enter the installation's street address to place
        the pin, then fine-tune it by dragging the map onto the building your access points serve.
      </p>

      <div>
        <label className="text-xs font-medium text-content-secondary" htmlFor="onboard-address">
          Street address
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="onboard-address"
            type="text"
            value={address}
            onChange={(e) => {
              onAddressChange(e.target.value);
              // A "Found: …" (or error) line describes the string that was
              // searched; once the text changes it would misdescribe the new
              // one, so it clears until the next explicit search.
              if (searchState && !searching) setSearchState(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleFindOnMap();
              }
            }}
            placeholder="Physical street address of the installation"
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={handleFindOnMap}
            disabled={searching || !query}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-content hover:bg-surface-inset disabled:opacity-50"
          >
            {searching ? "Searching…" : "Find on map"}
          </button>
        </div>
        {searchState?.label && (
          <p className="mt-1 text-[11px] text-content-tertiary">
            Found: {searchState.label}. Not quite right? Drag the map to fine-tune the pin.
          </p>
        )}
        {searchState?.error && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">{searchState.error}</p>
        )}
        <p className="mt-1 text-[11px] text-content-tertiary">
          Address search © OpenStreetMap contributors. The address carries into the certificate
          step, where you can still adjust it.
        </p>
      </div>

      <LocationPicker
        lat={location.lat}
        lng={location.lng}
        onChange={onLocationChange}
        recenterZoom={searchState?.zoom}
      />

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
