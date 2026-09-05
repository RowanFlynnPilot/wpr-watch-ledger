import React, { useEffect, useMemo, useRef, useState } from "react";

// Multi-select county picker for the map: a button that opens a searchable
// checklist, selected counties shown as removable chips. Plain React, no library.

const short = (n) => n.replace(/ County$/, "");

export default function CountyPicker({ counties, selected, onChange, counts }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) { setQ(""); return; }
    const onDoc = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return counties.filter((c) => !t || c.toLowerCase().includes(t));
  }, [counties, q]);

  const toggle = (c) => onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div className="cp" ref={wrap}>
      <div className="cp-row">
        <button type="button" className="dl cp-btn" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((o) => !o)}>
          {selected.length === 0 ? "All 72 counties" : `${selected.length} ${selected.length === 1 ? "county" : "counties"}`} ▾
        </button>
        <span className="cp-chips">
          {selected.map((c) => (
            <button type="button" className="cp-chip" key={c} onClick={() => toggle(c)} title={`Remove ${c}`}>
              {short(c)} <span aria-hidden="true">×</span>
            </button>
          ))}
          {selected.length > 0 && (
            <button type="button" className="link-btn" onClick={() => onChange([])}>clear</button>
          )}
        </span>
      </div>
      {open && (
        <div className="cp-panel">
          <input
            type="search"
            className="cp-search"
            placeholder="Type a county…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
            aria-label="Search counties"
          />
          <ul className="cp-list" role="listbox" aria-multiselectable="true">
            {list.map((c) => {
              const n = counts[c] || { dots: 0, rings: 0 };
              return (
                <li key={c} role="option" aria-selected={selected.includes(c)}>
                  <label className="cp-item">
                    <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} />
                    <span className="cp-name">{short(c)}</span>
                    <span className="cp-n" title={`${n.dots} volunteer-mapped · ${n.rings} WisDOT-permitted`}>
                      {n.dots} · {n.rings}
                    </span>
                  </label>
                </li>
              );
            })}
            {list.length === 0 && <li className="cp-empty">No county matches.</li>}
          </ul>
          <p className="cp-foot">dots · rings per county. Pick as many as you like.</p>
        </div>
      )}
    </div>
  );
}
