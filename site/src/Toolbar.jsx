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
  // Which section is in view, so its tab reads as current while the reader scrolls.
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY + 140;
      let hit = null;
      for (const [, sel] of SECTIONS) {
        const el = document.querySelector(sel);
        if (el && el.getBoundingClientRect().top + window.scrollY <= y) hit = sel;
      }
      setCurrent(hit);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
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
      <div className="jump" role="tablist" aria-label="Sections">
        {SECTIONS.map(([label, sel]) => (
          <button
            type="button"
            className={`jump-link${current === sel ? " current" : ""}`}
            key={sel}
            onClick={() => jump(sel)}
            role="tab"
            aria-selected={current === sel}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar-actions">
        <a className="dl dl-plate" href="https://data.usatoday.com/projects/flock-search/" target="_blank" rel="noreferrer" title="USA TODAY's search of Flock audit logs: see whether your plate was searched, and by whom">
          Check your plate ↗
        </a>
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
