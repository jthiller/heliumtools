import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import "../fonts/inter.css";
import "./index.css";

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
    </BrowserRouter>
  </React.StrictMode>
);
