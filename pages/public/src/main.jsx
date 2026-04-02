import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import L1MigrationTool from "./l1-migration/L1MigrationTool.jsx";
import DcPurchaseTool from "./dc-purchase/DcPurchaseTool.jsx";
import OrderStatus from "./dc-purchase/OrderStatus.jsx";
import HotspotClaimer from "./hotspot-claimer/HotspotClaimer.jsx";
import HotspotMap from "./hotspot-map/HotspotMap.jsx";
import MultiGateway from "./multi-gateway/MultiGateway.jsx";
import DcMintTool from "./dc-mint/DcMintTool.jsx";
import SolanaProvider from "./multi-gateway/SolanaProvider.jsx";
import "../fonts/inter.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/l1-migration" element={<L1MigrationTool />} />
        <Route path="/dc-purchase" element={<DcPurchaseTool />} />
        <Route path="/dc-purchase/order/:orderId" element={<OrderStatus />} />
        <Route path="/hotspot-claimer" element={<HotspotClaimer />} />
        <Route path="/hotspot-map" element={<HotspotMap />} />
        <Route path="/multi-gateway" element={<SolanaProvider><MultiGateway /></SolanaProvider>} />
        <Route path="/dc-mint" element={<SolanaProvider><DcMintTool /></SolanaProvider>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
