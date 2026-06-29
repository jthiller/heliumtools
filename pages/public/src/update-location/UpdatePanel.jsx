import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { latLngToCell, cellToBoundary } from "h3-js";
import MapGL, { Source, Layer } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowLeftIcon,
  ViewfinderCircleIcon,
  CheckCircleIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import useDarkMode from "../lib/useDarkMode.js";
import { h3ToLatLng } from "../lib/h3.js";
import { confirmAndVerify } from "../dc-mint/solanaUtils.js";
import { DC_MINT } from "../dc-mint/constants.js";
import DcMintModal from "../dc-mint/DcMintModal.jsx";
import { fetchHotspotStatus, buildUpdate } from "../lib/updateLocationApi.js";

const BASEMAP_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const BASEMAP_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

const dcToUsd = (dc) => (dc / 100_000).toFixed(2);

/**
 * Sign + broadcast a transaction. The wallet is always a required signer for an
 * owner-paid location update, so this takes the wallet-adapter path; the
 * raw-broadcast branch is kept for parity with the onboarding flow.
 */
async function signAndBroadcast(txn, walletPubkey, sendTransaction, connection) {
  const msg = txn.message;
  const staticKeys = msg.staticAccountKeys || msg.accountKeys || [];
  const numSigners = msg.header?.numRequiredSignatures ?? txn.signatures.length;
  const signerKeys = staticKeys.slice(0, numSigners);
  const walletStr = walletPubkey.toBase58();
  const walletIsSigner = signerKeys.some((k) => k.toBase58() === walletStr);

  let sig;
  if (walletIsSigner) {
    sig = await sendTransaction(txn, connection, { skipPreflight: true });
  } else {
    sig = await connection.sendRawTransaction(txn.serialize(), { skipPreflight: true });
  }
  await confirmAndVerify(connection, sig);
  return sig;
}

/**
 * Editor for one Hotspot: seeds the map + fields from the current on-chain
 * values, lets the owner change location / elevation / gain, and submits an
 * update_iot_info_v0 transaction signing with the connected wallet. Only changed
 * fields are sent; a location change incurs the DC location-assert fee.
 */
export default function UpdatePanel({ hotspot, onBack }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const isDark = useDarkMode();

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(null);

  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [elevation, setElevation] = useState("");
  const [gain, setGain] = useState("");
  const [viewState, setViewState] = useState({ latitude: 37.77, longitude: -122.42, zoom: 16 });

  const [dcBalance, setDcBalance] = useState(null);
  const [submitState, setSubmitState] = useState("idle"); // idle | building | signing | done | error
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);
  const [showDcModal, setShowDcModal] = useState(false);

  // Seed the form from the Hotspot's current on-chain state.
  const loadStatus = useCallback(() => {
    let cancelled = false;
    setStatusLoading(true);
    setStatusError(null);
    fetchHotspotStatus(hotspot.entityKey)
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        if (data.location_dec) {
          const ll = h3ToLatLng(data.location_dec);
          if (ll) {
            setLat(ll[0].toFixed(6));
            setLng(ll[1].toFixed(6));
            setViewState((v) => ({ ...v, latitude: ll[0], longitude: ll[1] }));
          }
        }
        setElevation(data.elevation != null ? String(data.elevation) : "");
        setGain(data.gain != null ? String(data.gain / 10) : "");
      })
      .catch((err) => !cancelled && setStatusError(err.message))
      .finally(() => !cancelled && setStatusLoading(false));
    return () => { cancelled = true; };
  }, [hotspot.entityKey]);

  useEffect(() => loadStatus(), [loadStatus]);

  // Read the wallet's DC balance (to gate the location-fee path).
  useEffect(() => {
    if (!walletPubkey || !connection) return;
    let cancelled = false;
    connection
      .getParsedTokenAccountsByOwner(walletPubkey, { mint: DC_MINT })
      .then((accs) => {
        if (cancelled) return;
        const acc = accs.value[0];
        setDcBalance(acc ? Number(acc.account.data.parsed.info.tokenAmount.amount) : 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [walletPubkey, connection, submitState]);

  // Auto-fill ground elevation only when it's never been set (don't clobber the
  // on-chain value or a manual edit).
  useEffect(() => {
    if (elevation !== "" || !lat || !lng) return;
    if (isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) return;
    let cancelled = false;
    fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`)
      .then((r) => r.json())
      .then((data) => {
        const g = data?.results?.[0]?.elevation;
        if (!cancelled && g != null) setElevation(String(Math.round(g)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lat, lng, elevation]);

  const h3Cell = useMemo(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (isNaN(la) || isNaN(lo)) return null;
    try { return latLngToCell(la, lo, 12); }
    catch { return null; }
  }, [lat, lng]);

  const hexGeoJSON = useMemo(() => {
    if (!h3Cell) return null;
    const boundary = cellToBoundary(h3Cell, true);
    return { type: "Feature", geometry: { type: "Polygon", coordinates: [boundary.concat([boundary[0]])] } };
  }, [h3Cell]);

  const handleMove = useCallback((evt) => setViewState(evt.viewState), []);
  const handleMoveEnd = useCallback((evt) => {
    setLat(evt.viewState.latitude.toFixed(6));
    setLng(evt.viewState.longitude.toFixed(6));
  }, []);
  const handleLatLngBlur = useCallback(() => {
    const la = parseFloat(lat);
    const lo = parseFloat(lng);
    if (!isNaN(la) && !isNaN(lo)) setViewState((v) => ({ ...v, latitude: la, longitude: lo }));
  }, [lat, lng]);

  const [geolocating, setGeolocating] = useState(false);
  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const la = pos.coords.latitude;
        const lo = pos.coords.longitude;
        setLat(la.toFixed(6));
        setLng(lo.toFixed(6));
        setViewState((v) => ({ ...v, latitude: la, longitude: lo, zoom: 17 }));
        setGeolocating(false);
      },
      () => setGeolocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  // --- Dirty-field tracking: only send what changed ---
  const locationDirty = useMemo(() => {
    if (!h3Cell) return false;
    if (!status?.location_hex) return true; // never asserted → any cell is a change
    try { return BigInt("0x" + h3Cell) !== BigInt("0x" + status.location_hex); }
    catch { return true; }
  }, [h3Cell, status]);

  const elevationNum = elevation !== "" && Number.isFinite(parseInt(elevation, 10)) ? parseInt(elevation, 10) : null;
  const gainTimes10 = gain !== "" && Number.isFinite(parseFloat(gain)) ? Math.round(parseFloat(gain) * 10) : null;
  const elevationDirty = elevationNum != null && elevationNum !== status?.elevation;
  const gainDirty = gainTimes10 != null && gainTimes10 !== status?.gain;
  const anyDirty = locationDirty || elevationDirty || gainDirty;

  const deviceType = status?.device_type || "data_only";
  const locationFee = status?.fees?.[deviceType]?.location ?? 0;
  const dcShort = locationDirty && dcBalance != null && dcBalance < locationFee;

  const handleSubmit = async () => {
    if (!connected || !anyDirty) return;
    if (dcShort) { setShowDcModal(true); return; }
    setError(null);
    setSubmitState("building");
    try {
      const payload = {
        location: locationDirty ? h3Cell : null,
        elevation: elevationDirty ? elevationNum : null,
        gain: gainDirty ? gainTimes10 : null,
      };
      const result = await buildUpdate(walletPubkey.toBase58(), hotspot.entityKey, payload);
      if (result.dc_needed) {
        setSubmitState("idle");
        setShowDcModal(true);
        return;
      }
      setSubmitState("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await signAndBroadcast(txn, walletPubkey, sendTransaction, connection);
      setTxSignature(sig);
      setSubmitState("done");
      loadStatus(); // refresh to show the new on-chain values
    } catch (err) {
      setError(err.message);
      setSubmitState("error");
    }
  };

  const busy = submitState === "building" || submitState === "signing";

  return (
    <div className="mx-auto max-w-2xl">
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-content-tertiary hover:text-content-secondary"
      >
        <ArrowLeftIcon className="h-4 w-4" /> All Hotspots
      </button>

      <div className="rounded-2xl bg-surface-raised p-5 shadow-soft">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-content">
          {hotspot.name || hotspot.entityKey}
        </h2>
        <p className="mt-0.5 break-all font-mono text-xs text-content-tertiary">{hotspot.entityKey}</p>

        {statusLoading && (
          <p className="mt-4 text-sm text-content-tertiary">Reading on-chain state…</p>
        )}
        {statusError && (
          <p className="mt-4 text-sm text-rose-500">{statusError}</p>
        )}

        {!statusLoading && status && !status.onboarded && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
            This Hotspot isn’t onboarded to the IoT network yet. Onboard it first with{" "}
            <a href="/iot-onboard" className="underline">IoT Hotspot Setup</a>.
          </div>
        )}

        {!statusLoading && status?.onboarded && submitState !== "done" && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-content-tertiary">
              Drag the map to position the pin. The highlighted hex is the H3 cell that will be asserted.
              {status.num_location_asserts > 0 && ` Asserted ${status.num_location_asserts} time(s) so far.`}
            </p>

            {/* Map */}
            <div className="relative h-56 overflow-hidden rounded-lg border border-border">
              <MapGL
                {...viewState}
                onMove={handleMove}
                onMoveEnd={handleMoveEnd}
                mapStyle={isDark ? BASEMAP_DARK : BASEMAP_LIGHT}
                attributionControl={false}
              >
                {hexGeoJSON && (
                  <Source type="geojson" data={hexGeoJSON}>
                    <Layer id="h3-hex-fill" type="fill" paint={{ "fill-color": "#8b5cf6", "fill-opacity": 0.25 }} />
                    <Layer id="h3-hex-outline" type="line" paint={{ "line-color": "#8b5cf6", "line-width": 2 }} />
                  </Source>
                )}
              </MapGL>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative -mt-5">
                  <svg width="24" height="36" viewBox="0 0 24 36" className="drop-shadow-lg">
                    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#8b5cf6" />
                    <circle cx="12" cy="12" r="5" fill="white" />
                  </svg>
                </div>
              </div>
              <button
                type="button"
                onClick={handleGeolocate}
                disabled={geolocating}
                title="Use my location"
                aria-label="Use my location"
                className="absolute right-2 top-2 rounded-md border border-border bg-surface-raised p-2 text-content-secondary shadow-sm transition hover:border-accent hover:text-accent-text disabled:opacity-50"
              >
                <ViewfinderCircleIcon className={`h-4 w-4 ${geolocating ? "animate-pulse" : ""}`} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-content-secondary">Latitude</label>
                <input type="text" value={lat} onChange={(e) => setLat(e.target.value)}
                  onBlur={handleLatLngBlur} placeholder="e.g. 37.7749" className={INPUT_CLASS} />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary">Longitude</label>
                <input type="text" value={lng} onChange={(e) => setLng(e.target.value)}
                  onBlur={handleLatLngBlur} placeholder="e.g. -122.4194" className={INPUT_CLASS} />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary">Elevation (m)</label>
                <input type="text" value={elevation} onChange={(e) => setElevation(e.target.value)}
                  placeholder="above ground level" className={INPUT_CLASS} />
              </div>
              <div>
                <label className="text-xs font-medium text-content-secondary">Gain (dBi)</label>
                <input type="text" value={gain} onChange={(e) => setGain(e.target.value)}
                  placeholder="e.g. 1.2" className={INPUT_CLASS} />
              </div>
            </div>

            {/* Cost card */}
            <div className="rounded-lg bg-surface-inset p-3 text-xs space-y-1.5">
              <div className="flex justify-between text-content-secondary">
                <span>Hotspot type</span>
                <span className="font-mono">{deviceType === "full" ? "Full (PoC eligible)" : "Data-Only"}</span>
              </div>
              <div className="flex justify-between text-content-secondary">
                <span>Cost</span>
                <span className="font-mono">
                  {locationDirty
                    ? `${locationFee.toLocaleString()} DC ($${dcToUsd(locationFee)}) + network fee`
                    : anyDirty
                      ? "No DC fee (metadata-only change)"
                      : "—"}
                </span>
              </div>
              {dcShort && (
                <p className="text-amber-700 dark:text-amber-300">
                  Your wallet has {dcBalance.toLocaleString()} DC — {locationFee.toLocaleString()} DC needed to assert location.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <div className="flex items-center gap-3">
              {!connected && <WalletMultiButton className="!h-9 !rounded-lg !text-sm" />}
              {dcShort ? (
                <button
                  onClick={() => setShowDcModal(true)}
                  disabled={!connected}
                  className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  Top up Data Credits
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={busy || !connected || !anyDirty}
                  className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {submitState === "building" ? "Building…"
                    : submitState === "signing" ? "Confirm in wallet…"
                    : anyDirty ? "Update Hotspot" : "No changes"}
                </button>
              )}
            </div>
          </div>
        )}

        {submitState === "done" && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <CheckCircleIcon className="h-6 w-6 shrink-0 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Hotspot updated on-chain.
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
              <a
                href={`/hotspot-map?keys=${hotspot.entityKey}`}
                className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
              >
                View on map <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSubmitState("idle")}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-content hover:bg-surface-inset"
              >
                Make another change
              </button>
              <button
                onClick={onBack}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
              >
                Back to Hotspots
              </button>
            </div>
          </div>
        )}
      </div>

      {showDcModal && (
        <DcMintModal
          defaultDcAmount={locationFee || 100000}
          onClose={() => setShowDcModal(false)}
          onSuccess={() => {
            setShowDcModal(false);
            setSubmitState("idle");
          }}
        />
      )}
    </div>
  );
}
