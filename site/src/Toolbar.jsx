import React, { useEffect, useState } from "react";

// Under the masthead: jump links to every section, a bookmark button, and share.
// Browsers do not let a page add itself to bookmarks, so the button copies the
// link and shows the keyboard shortcut; the Web Share sheet is offered where it exists.

const SECTIONS = [
  ["Ledger", ".ledger-line"],
  ["Week by week", ".trend"],
  ["Transparency gap", ".gap"],
  ["Silent searchers", ".silent"],
  ["Map", ".map-section"],
  ["Marathon County", ".spotlight"],
  ["Counties", ".county-rollup"],
  ["Roster", ".roster"],
  ["Sharing", ".sharing"],
  ["Reach", ".reach"],
  ["Who else", ".who-else-section"],
  ["Sources", ".methodology"],
];

export default function Toolbar({ title }) {
  const [note, setNote] = useState(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  const pageUrl = () => {
    // Inside the WordPress iframe, the parent page is the address readers should keep.
    try { return window.top !== window ? document.referrer || window.location.href : window.location.href; }
    catch { return window.location.href; }
  };

  const bookmark = async () => {
    const url = pageUrl();
    try { await navigator.clipboard.writeText(url); } catch { /* clipboard blocked: the hint still helps */ }
    setNote(`Link copied · press ${isMac ? "⌘ D" : "Ctrl+D"} to bookmark this page`);
  };

  const share = async () => {
    try { await navigator.share({ title, url: pageUrl() }); } catch { /* user dismissed the sheet */ }
  };

  const jump = (sel) => document.querySelector(sel)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <nav className="toolbar" aria-label="Page tools">
      <div className="jump" role="list">
        {SECTIONS.map(([label, sel]) => (
          <button type="button" className="jump-link" key={sel} onClick={() => jump(sel)} role="listitem">
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <button type="button" className="dl" onClick={bookmark} title="Copy the link and show the bookmark shortcut">
          ☆ Bookmark
        </button>
        {canShare && (
          <button type="button" className="dl dl-quiet" onClick={share}>
            Share
          </button>
        )}
      </div>
      {note && <p className="toolbar-note" role="status">{note}</p>}
    </nav>
  );
}
