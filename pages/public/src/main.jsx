import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import { registerSW } from "./lib/registerSW.js";
import "../fonts/inter.css";
import "./index.css";

registerSW();

// Lazy-imported chunks can fail after a deploy purges old hashed files —
// the user gets "Failed to fetch dynamically imported module" or, if Pages
// rewrites the missing asset to index.html, "'text/html' is not a valid
// JavaScript MIME type". Reload once to pick up the fresh index.html and
// its new chunk URLs. Keyed by pathname so a later deploy mid-session can
// recover too, but a non-chunk error doesn't trap us in a reload loop.
function isChunkLoadError(error) {
  const msg = String(error?.message ?? "");
  return (
    error?.name === "ChunkLoadError" ||
    /Loading chunk/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /is not a valid JavaScript MIME type/i.test(msg)
  );
}

// Returns true if we haven't tried reloading this path yet. Marks the
// attempt in sessionStorage so a persistent error doesn't loop. Fails
// closed if storage isn't available (private mode, embedded WebView) —
// we'd rather render the recovery UI than risk an infinite reload.
function shouldAttemptChunkReload() {
  const key = `ht-chunk-reload:${window.location.pathname}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

function ChunkReloadPrompt() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "1rem",
      padding: "2rem",
      fontFamily: "system-ui, sans-serif",
      textAlign: "center",
    }}>
      <h2 style={{ margin: 0 }}>Couldn't load the page</h2>
      <p style={{ margin: 0, color: "#666", maxWidth: "32rem" }}>
        The site may have just updated. Reloading usually fixes this.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "0.5rem 1.25rem",
          fontSize: "1rem",
          cursor: "pointer",
          border: "1px solid #ccc",
          borderRadius: "0.375rem",
          background: "white",
        }}
      >
        Reload
      </button>
    </div>
  );
}

class ChunkLoadBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (!isChunkLoadError(error)) return;
    if (!shouldAttemptChunkReload()) return;
    window.location.reload();
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (!isChunkLoadError(error)) throw error;
    // Chunk-load error. componentDidCatch may be about to reload us; if it
    // can't (already tried, or storage unavailable), this UI lets the user
    // trigger the reload manually instead of staring at a blank page.
    return <ChunkReloadPrompt />;
  }
}

// Lazy-load tool pages — each becomes its own chunk
const L1MigrationTool = lazy(() => import("./l1-migration/L1MigrationTool.jsx"));
const DcPurchaseTool = lazy(() => import("./dc-purchase/DcPurchaseTool.jsx"));
const OrderStatus = lazy(() => import("./dc-purchase/OrderStatus.jsx"));
const HotspotClaimer = lazy(() => import("./hotspot-claimer/HotspotClaimer.jsx"));
const HotspotMap = lazy(() => import("./hotspot-map/HotspotMap.jsx"));
const MultiGateway = lazy(() => import("./multi-gateway/MultiGateway.jsx"));
const DcMintTool = lazy(() => import("./dc-mint/DcMintTool.jsx"));
const IotOnboard = lazy(() => import("./iot-onboard/IotOnboard.jsx"));
const VeHnt = lazy(() => import("./ve-hnt/VeHnt.jsx"));
const SolanaProvider = lazy(() => import("./multi-gateway/SolanaProvider.jsx"));

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ChunkLoadBoundary>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/l1-migration" element={<L1MigrationTool />} />
            <Route path="/dc-purchase" element={<DcPurchaseTool />} />
            <Route path="/dc-purchase/order/:orderId" element={<OrderStatus />} />
            <Route path="/hotspot-claimer" element={<HotspotClaimer />} />
            <Route path="/hotspot-map" element={<HotspotMap />} />
            <Route path="/multi-gateway" element={<SolanaProvider><MultiGateway /></SolanaProvider>} />
            <Route path="/dc-mint" element={<SolanaProvider><DcMintTool /></SolanaProvider>} />
            <Route path="/iot-onboard" element={<SolanaProvider><IotOnboard /></SolanaProvider>} />
            <Route path="/ve-hnt" element={<SolanaProvider><VeHnt /></SolanaProvider>} />
          </Routes>
        </Suspense>
      </ChunkLoadBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
