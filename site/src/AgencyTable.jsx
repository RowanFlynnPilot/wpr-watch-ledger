import React, { useEffect, useMemo, useRef, useState } from "react";

const COLUMNS = [
  { key: "name", label: "Agency", get: (a) => a.name },
  { key: "county", label: "County", get: (a) => a.county || "" },
  { key: "status", label: "Status", get: (a) => a.status.value },
  { key: "cameras", label: "Cameras", get: (a) => a.portal?.cameras ?? -1, numeric: true },
  { key: "searches", label: "Searches / 30d", get: (a) => a.portal?.searches_30d ?? -1, numeric: true },
  { key: "shared", label: "Shares with", get: (a) => a.portal?.shared_with_count ?? -1, numeric: true },
];

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

export default function AgencyTable({ agencies, searchDeltas }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: null, dir: 1 });

  // Edge fades + swipe hint, shown only while there is actually more table to scroll to.
  const scrollRef = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scrollRef.current;
    const update = () =>
      setOverflow((prev) => {
        const left = el.scrollLeft > 4;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        return prev.left === left && prev.right === right ? prev : { left, right };
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? agencies.filter((a) => a.name.toLowerCase().includes(q) || (a.county || "").toLowerCase().includes(q))
      : [...agencies];
    if (sort.key) {
      const col = COLUMNS.find((c) => c.key === sort.key);
      out.sort((x, y) => {
        const a = col.get(x), b = col.get(y);
        if (col.numeric) return (a - b) * sort.dir;
        return String(a).localeCompare(String(b)) * sort.dir;
      });
    }
    return out;
  }, [agencies, query, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" || key === "county" ? 1 : -1 }));

  return (
    <div className="table-wrap">
      <input
        className="table-search"
        type="search"
        placeholder="Filter by agency or county…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter agencies"
      />
      {overflow.right && <p className="table-hint">Swipe sideways for more columns →</p>}
      <div className={`table-viewport${overflow.left ? " overflow-left" : ""}${overflow.right ? " overflow-right" : ""}`}>
        <div className="table-scroll" ref={scrollRef}>
          <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key}>
                  <button className="th-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
                  </button>
                </th>
              ))}
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.canonical}>
                <td className="cell-name">{a.name}</td>
                <td>{a.county || "—"}</td>
                <td>
                  <span
                    className={`badge badge-${a.status.value}`}
                    title={a.status.note || (a.status.value === "unknown" ? "Documented ALPR use, but current Flock network participation is unverified" : "")}
                  >
                    {a.status.value === "unknown" ? "unverified" : a.status.value}
                  </span>
                  {!a.status.derived && a.status.as_of && <span className="asof"> {a.status.as_of}</span>}
                </td>
                <td className="cell-num">{fmt(a.portal?.cameras)}</td>
                <td className="cell-num">
                  {fmt(a.portal?.searches_30d)}
                  {searchDeltas != null && searchDeltas[a.canonical] != null && searchDeltas[a.canonical] !== 0 && (
                    <span
                      className="delta"
                      title="Change since the previous weekly snapshot"
                      aria-label={`${searchDeltas[a.canonical] > 0 ? "up" : "down"} ${Math.abs(searchDeltas[a.canonical]).toLocaleString("en-US")} from last week`}
                    >
                      {searchDeltas[a.canonical] > 0 ? "▲" : "▼"}
                      {Math.abs(searchDeltas[a.canonical]).toLocaleString("en-US")}
                    </span>
                  )}
                </td>
                <td className="cell-num">{fmt(a.portal?.shared_with_count)}</td>
                <td className="cell-sources">
                  {a.portal && (
                    <a href={a.portal.portal_url} target="_blank" rel="noreferrer">portal</a>
                  )}
                  {!a.status.derived && a.status.source && (
                    <a href={a.status.source} target="_blank" rel="noreferrer">reporting</a>
                  )}
                  {a.atlas?.links?.[0] && (
                    <a href={a.atlas.links[0]} target="_blank" rel="noreferrer">atlas</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
      <p className="table-count">{rows.length} of {agencies.length} agencies shown</p>
    </div>
  );
}
