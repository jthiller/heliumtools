import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import L1MigrationTool from "./l1-migration/L1MigrationTool.jsx";
import "../fonts/inter.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/l1-migration" element={<L1MigrationTool />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
