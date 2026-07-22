import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  MapPinIcon,
} from "@heroicons/react/24/outline";
import { h3ToLatLng, latLngToH3 } from "../lib/h3.js";
import { signAndBroadcast } from "../dc-mint/solanaUtils.js";
import DcMintModal from "../dc-mint/DcMintModal.jsx";
import { fetchGatewayStatus, requestUpdate } from "../lib/mobileOnboardApi.js";
import LocationPicker from "./LocationPicker.jsx";
import CertDownloads from "./CertDownloads.jsx";
import OffchainSignWarning from "./OffchainSignWarning.jsx";
import useCertRetrieval from "./useCertRetrieval.js";
import { isBrownfield, mobileDeviceLabel } from "./deviceTypes.js";
import { dcToUsd } from "./format.js";
import { SELF_SERVE_CARRIERS, PARTNER_CARRIERS } from "./vendors.js";

/**
 * Detail panel for one onboarded Mobile Hotspot: retrieve its RadSec
 * certificates (explicit action only — every fetch returns the private key,
 * so nothing is requested automatically) and re-assert its location.
 */
export default function ManageDetail({ hotspot, onBack }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(null);

  // Certificates (fetch existing — no address/NAS fields; the shared hook owns
  // the sign → request state machine).
  const {
    state: certState,
    error: certError,
    cert,
    busy: certBusy,
    canSign,
    submit: retrieveCerts,
  } = useCertRetrieval(hotspot.entityKey);

  // Location update
  const [editingLocation, setEditingLocation] = useState(false);
  const [location, setLocation] = useState({ lat: "", lng: "" });
  const [updateState, setUpdateState] = useState("idle"); // idle | building | signing | done
  const [updateError, setUpdateError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);
  const [dcInfo, setDcInfo] = useState(null);
  const [showDcModal, setShowDcModal] = useState(false);

  const loadStatus = useCallback(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusError(null);
    fetchGatewayStatus(hotspot.entityKey)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        if (data.location_dec) {
          const ll = h3ToLatLng(data.location_dec);
          if (ll) setLocation({ lat: ll[0].toFixed(6), lng: ll[1].toFixed(6) });
        }
      })
      .catch((err) => !cancelled && setStatusError(err.message))
      .finally(() => !cancelled && setStatusLoading(false));
    return () => { cancelled = true; };
  }, [hotspot.entityKey]);

  useEffect(() => loadStatus(), [loadStatus]);

  const h3Cell = useMemo(() => latLngToH3(location.lat, location.lng), [location.lat, location.lng]);
  const locationDirty = useMemo(() => {
    if (!h3Cell) return false;
    if (!status?.location_hex) return true;
    try { return BigInt("0x" + h3Cell) !== BigInt("0x" + status.location_hex); }
    catch { return true; }
  }, [h3Cell, status?.location_hex]);
  const locationFee =
    status?.fees?.[status?.device_type]?.location_staking_fee ??
    status?.fees?.wifiDataOnly?.location_staking_fee ??
    0;

  // Prefer the authoritative on-chain device type once /status lands; fall
  // back to the fleet row's while it loads. Only brownfield (converted WiFi)
  // networks have retrievable RadSec certificates.
  const deviceType = status?.device_type || hotspot.deviceType;
  const brownfield = isBrownfield(deviceType);

  const handleUpdateLocation = async () => {
    if (!locationDirty || !publicKey) return;
    setUpdateError(null);
    setUpdateState("building");
    try {
      const result = await requestUpdate(publicKey.toBase58(), hotspot.entityKey, h3Cell);
      if (result.dc_needed) {
        setDcInfo(result);
        setUpdateState("idle");
        setShowDcModal(true);
        return;
      }
      setUpdateState("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await signAndBroadcast(txn, publicKey, sendTransaction, connection);
      setTxSignature(sig);
      setUpdateState("done");
      loadStatus();
    } catch (err) {
      setUpdateError(err.message);
      setUpdateState("idle");
    }
  };

  const updateBusy = updateState === "building" || updateState === "signing";

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-content-tertiary hover:text-content-secondary"
      >
        <ArrowLeftIcon className="h-4 w-4" /> All Hotspots
      </button>

      <div className="space-y-4">
        <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-content">
            {hotspot.name || hotspot.entityKey}
          </h2>
          <p className="mt-0.5 break-all font-mono text-xs text-content-tertiary">{hotspot.entityKey}</p>

          {statusLoading && <p className="mt-3 text-sm text-content-tertiary">Reading on-chain state…</p>}
          {statusError && <p className="mt-3 text-sm text-rose-500">{statusError}</p>}
          {!statusLoading && status && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-content-secondary">
              <span>Type <span className="font-mono">{mobileDeviceLabel(status.device_type)}</span></span>
              <span>Location asserts <span className="font-mono">{status.num_location_asserts}</span></span>
              <a
                href={`/hotspot-map?keys=${hotspot.entityKey}`}
                className="inline-flex items-center gap-1 text-accent-text hover:underline"
              >
                View on map <ArrowTopRightOnSquareIcon className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Certificates */}
        <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
          <div className="flex items-center gap-2">
            <DocumentTextIcon className="h-4 w-4 text-content-tertiary" />
            <h3 className="font-display text-sm font-semibold text-content">RadSec certificates</h3>
          </div>

          {certState === "done" && cert ? (
            <div className="mt-3">
              <CertDownloads cert={cert} baseName={hotspot.name || hotspot.entityKey} />
            </div>
          ) : !brownfield ? (
            <p className="mt-3 text-xs text-content-tertiary">
              RadSec certificates are only issued for converted WiFi networks. This is a{" "}
              {mobileDeviceLabel(deviceType)} Hotspot, so its certificates are managed by the device
              and aren't retrievable here.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-content-tertiary">
                Re-download the certificates for this network. Your wallet signs the request
                offchain, with no transaction and no fee. The private key is fetched only when you ask.
              </p>
              {!canSign && <OffchainSignWarning />}
              {certError && <p className="text-sm text-rose-500">{certError}</p>}
              <button
                onClick={() => retrieveCerts()}
                disabled={certBusy || !canSign}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {certState === "signing" ? "Sign in wallet…"
                  : certState === "requesting" ? "Retrieving…"
                  : "Retrieve certificates"}
              </button>
            </div>
          )}
        </div>

        {/* Location */}
        <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPinIcon className="h-4 w-4 text-content-tertiary" />
              <h3 className="font-display text-sm font-semibold text-content">Location</h3>
            </div>
            {!editingLocation && updateState !== "done" && (
              <button
                onClick={() => setEditingLocation(true)}
                disabled={statusLoading}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-content hover:bg-surface-inset disabled:opacity-50"
              >
                {status?.has_location ? "Update location" : "Assert location"}
              </button>
            )}
          </div>

          {updateState === "done" ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <CheckCircleIcon className="h-5 w-5 shrink-0 text-emerald-500" />
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  Location updated on-chain.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <a
                  href={`https://solscan.io/tx/${txSignature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
                >
                  View transaction <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
                <button
                  onClick={() => { setUpdateState("idle"); setEditingLocation(false); }}
                  className="text-content-tertiary hover:text-content-secondary"
                >
                  Close
                </button>
              </div>
            </div>
          ) : editingLocation ? (
            <div className="mt-3 space-y-3">
              <LocationPicker
                key={status?.location_hex || "no-location"}
                lat={location.lat}
                lng={location.lng}
                onChange={setLocation}
              />
              <div className="rounded-lg bg-surface-inset p-3 text-xs">
                <div className="flex justify-between text-content-secondary">
                  <span>Cost</span>
                  <span className="font-mono">
                    {locationDirty
                      ? `${locationFee.toLocaleString()} DC ($${dcToUsd(locationFee)}) + network fee`
                      : "—"}
                  </span>
                </div>
                {dcInfo?.dc_needed && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    Your wallet has {dcInfo.current_dc.toLocaleString()} DC. {dcInfo.required_dc.toLocaleString()} DC needed.
                  </p>
                )}
              </div>
              {updateError && <p className="text-sm text-rose-500">{updateError}</p>}
              <div className="flex gap-3">
                <button
                  onClick={() => setEditingLocation(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-inset"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateLocation}
                  disabled={updateBusy || !locationDirty}
                  className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {updateState === "building" ? "Building…"
                    : updateState === "signing" ? "Confirm in wallet…"
                    : dcInfo?.dc_needed ? "Top up Data Credits"
                    : locationDirty ? "Update location" : "No change"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-content-tertiary">
              {statusLoading
                ? "…"
                : status?.has_location
                  ? `Asserted ${status.num_location_asserts} time(s). Re-asserting costs ${locationFee.toLocaleString()} DC.`
                  : "No location asserted yet."}
            </p>
          )}
        </div>

        {brownfield && (
          <p className="px-1 text-xs text-content-tertiary">
            Serving {SELF_SERVE_CARRIERS.join(", ")}. {PARTNER_CARRIERS.names.join(", ")} may be
            added on this Hotspot through{" "}
            <a
              href={PARTNER_CARRIERS.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-text hover:underline"
            >
              Helium Plus
            </a>.
          </p>
        )}
      </div>

      {showDcModal && (
        <DcMintModal
          defaultDcAmount={dcInfo?.required_dc || locationFee || 100_000}
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
