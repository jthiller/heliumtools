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

class ChunkLoadBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    if (!isChunkLoadError(error)) return;
    const key = `ht-chunk-reload:${window.location.pathname}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
  render() {
    if (this.state.error && !isChunkLoadError(this.state.error)) throw this.state.error;
    return this.state.error ? null : this.props.children;
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
