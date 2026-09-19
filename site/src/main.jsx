import React from "react";
import { createRoot } from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App.jsx";

// A render error must never leave a blank frame inside a news article.
class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { console.error("Watch Ledger render error", error); }
  render() {
    return this.state.failed
      ? <div className="load-error">The Watch Ledger hit an error and could not display. Refresh the page to try again.</div>
      : this.props.children;
  }
}

createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);

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

  // A frame cannot resize itself: if the host page never installed the listener (WordPress
  // strips scripts from many editors, and did on the newsroom's own page), the tool sits in
  // a fixed window and the reader scrolls inside it. Detect that, and switch to a layout
  // built for it: section tabs pinned to the top of the window. If a listener turns up
  // later and the frame grows to fit, switch back.
  const FIXED = "fixed-frame";
  const judge = () => {
    const content = root.getBoundingClientRect().height;
    const unresized = content > 0 && content - window.innerHeight > 600;
    document.documentElement.classList.toggle(FIXED, unresized);
  };
  for (const ms of [2000, 4000, 8000]) setTimeout(judge, ms);
  window.addEventListener("resize", judge);
}
