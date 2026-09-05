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
  // Measure the rendered root, not the document: a document's scrollHeight can never be
  // smaller than the frame it sits in, so measuring it lets the frame grow but never
  // shrink (a filtered roster would leave blank space below the tool).
  const root = document.getElementById("root");
  const report = () =>
    window.parent.postMessage(
      { source: "wpr-watch-ledger", height: Math.ceil(root.getBoundingClientRect().height) },
      "*"
    );
  const observer = new ResizeObserver(report);
  observer.observe(root);
  window.addEventListener("load", report);
  // Belt and braces for hosts that throttle rendering while the frame is off-screen:
  // report again when web fonts land and on a short schedule after load.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(report);
  for (const ms of [500, 1500, 3000, 6000]) setTimeout(report, ms);
}
