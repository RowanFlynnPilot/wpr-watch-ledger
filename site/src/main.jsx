import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(<App />);

// iframe auto-height: report the document height to the embedding page whenever it
// changes (data load, table filtering, expanding a sharing list). The matching
// listener for the WordPress side is documented in the README. Only the height is
// sent, so "*" as target origin is fine; the parent verifies the origin instead.
if (window.parent !== window) {
  const report = () =>
    window.parent.postMessage(
      { source: "wpr-watch-ledger", height: document.documentElement.scrollHeight },
      "*"
    );
  const observer = new ResizeObserver(report);
  observer.observe(document.documentElement);
  observer.observe(document.body);
  window.addEventListener("load", report);
}
