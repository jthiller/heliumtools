import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import L1MigrationTool from "./l1-migration/L1MigrationTool.jsx";
import DcPurchaseTool from "./dc-purchase/DcPurchaseTool.jsx";
import OrderStatus from "./dc-purchase/OrderStatus.jsx";
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
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
