import React, { useEffect, useMemo, useRef, useState } from "react";
import Sparkline from "./Sparkline.jsx";
import { downloadCsv } from "./csv.js";

const CSV_COLS = [
  { label: "Agency", get: (a) => a.name },
  { label: "County", get: (a) => a.county },
  { label: "Status", get: (a) => (a.status.value === "unknown" ? "unverified" : a.status.value) },
  { label: "Status as of", get: (a) => a.status.as_of },
  { label: "In Flock network", get: (a) => (a.in_network ? "yes" : "no") },
  { label: "Publishes portal", get: (a) => (a.portal ? "yes" : "no") },
  { label: "Publishes audit log", get: (a) => (a.portal?.public_search_audit ? "yes" : "no") },
  { label: "Portal cameras", get: (a) => a.portal?.cameras },
  { label: "Portal searches 30d", get: (a) => a.portal?.searches_30d },
  { label: "Portal vehicles 30d", get: (a) => a.portal?.vehicles_captured_30d },
  { label: "Portal hotlist hits 30d", get: (a) => a.portal?.hotlist_hits_30d },
  { label: "Portal hit rate %", get: (a) => a.portal?.hit_rate },
  { label: "Portal last updated", get: (a) => a.portal?.updated },
  { label: "Shares with", get: (a) => a.portal?.shared_with_count },
  { label: "Searchable by", get: (a) => a.portal?.reach?.received?.total },
  { label: "USA TODAY searches on record 2023-2026", get: (a) => a.usatoday?.searches },
  { label: "USA TODAY high-frequency rows", get: (a) => a.usatoday?.flagged_rows },
  { label: "WisDOT highway cameras", get: (a) => a.wisdot?.cameras },
  { label: "Volunteer-mapped cameras", get: (a) => a.osm_cameras || null },
  { label: "Sharing lists naming it", get: (a) => a.network_mentions || null },
  { label: "Portal URL", get: (a) => a.portal?.portal_url },
  { label: "Status source", get: (a) => a.status.source },
  { label: "Status note", get: (a) => a.status.note },
];

const rate = (a) => (a.portal?.hit_rate == null ? -1 : parseFloat(a.portal.hit_rate));

const COLUMNS = [
  { key: "name", label: "Agency", get: (a) => a.name },
  { key: "county", label: "County", get: (a) => a.county || "" },
  { key: "status", label: "Status", get: (a) => a.status.value },
  { key: "cameras", label: "Cameras", title: "Cameras the agency reports on its own transparency portal", get: (a) => a.portal?.cameras ?? -1, numeric: true },
  { key: "searches", label: "Searches, 30d", title: "Search sessions in the last 30 days, per the agency's transparency portal", get: (a) => a.portal?.searches_30d ?? -1, numeric: true },
  { key: "usat", label: "Searches on record", title: "Individual searches in Flock audit logs obtained by USA TODAY, cumulative Jan 2023 to Apr 2026. Not comparable to the 30-day portal figure.", get: (a) => a.usatoday?.searches ?? -1, numeric: true },
  { key: "hwy", label: "Hwy cams", secondary: true, title: "Cameras permitted on state-highway right-of-way (WisDOT records)", get: (a) => a.wisdot?.cameras ?? -1, numeric: true },
  { key: "mapped", label: "Mapped", secondary: true, title: "Cameras volunteers have tagged with this operator on OpenStreetMap", get: (a) => a.osm_cameras || -1, numeric: true },
  { key: "hit", label: "Hit rate", secondary: true, title: "Hot-list hits as a percentage of vehicles sighted, per the portal", get: rate, numeric: true },
  { key: "reach", label: "Searchable by", secondary: true, title: "Agencies nationwide whose searches can reach this agency's cameras (only some portals disclose this)", get: (a) => a.portal?.reach?.received?.total ?? -1, numeric: true },
  { key: "shared", label: "Shares with", secondary: true, get: (a) => a.portal?.shared_with_count ?? -1, numeric: true },
];

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const fmtZero = (n) => (n ? n.toLocaleString("en-US") : "—");

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "network", label: "In network", test: (a) => a.in_network },
  { key: "portal", label: "Publish data", test: (a) => !!a.portal },
  { key: "audit", label: "Publish audit log", test: (a) => !!a.portal?.public_search_audit },
  { key: "hwy", label: "Hwy permits", test: (a) => !!a.wisdot },
  { key: "dropped", label: "Dropped", test: (a) => a.status.value === "dropped" },
  { key: "unverified", label: "Unverified", test: (a) => a.status.value === "unknown" },
  { key: "silent", label: "Searches, no portal", test: (a) => a.usatoday?.searches > 0 && !a.portal },
];

export default function AgencyTable({ agencies, searchDeltas, history, staleThreshold, externalQuery, generated }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState({ key: null, dir: 1 });
  // Secondary columns hide by default on narrow screens; a toggle brings them back.
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches
  );
  const visible = COLUMNS.filter((c) => !compact || !c.secondary);
  const isFiltered = query.trim() !== "" || filter !== "all";

  // Another section asked for one agency (a click on the gap bar): show just that row.
  useEffect(() => {
    if (!externalQuery) return;
    setQuery(externalQuery.text);
    setFilter("all");
  }, [externalQuery]);

  // Per-agency weekly search series for the sparklines.
  const series = useMemo(() => {
    const out = {};
    for (const snap of history.snapshots) {
      for (const [key, stats] of Object.entries(snap.portals)) {
        (out[key] ||= []).push({ date: snap.date, value: stats.searches_30d });
      }
    }
    return out;
  }, [history]);

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
    const active = FILTERS.find((f) => f.key === filter);
    let out = agencies.filter(
      (a) =>
        active.test(a) &&
        (!q || a.name.toLowerCase().includes(q) || (a.county || "").toLowerCase().includes(q))
    );
    if (sort.key) {
      const col = COLUMNS.find((c) => c.key === sort.key);
      out.sort((x, y) => {
        const a = col.get(x), b = col.get(y);
        if (col.numeric) return (a - b) * sort.dir;
        return String(a).localeCompare(String(b)) * sort.dir;
      });
    }
    return out;
  }, [agencies, query, filter, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" || key === "county" ? 1 : -1 }));

  const isStale = (a) => a.portal?.stale_days != null && a.portal.stale_days > staleThreshold;

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
      <div className="table-filters" role="group" aria-label="Quick filters">
        {FILTERS.map((f) => {
          const count = f.key === "all" ? agencies.length : agencies.filter(f.test).length;
          return (
            <button
              key={f.key}
              className={`chip${filter === f.key ? " active" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className="chip-count">{count.toLocaleString("en-US")}</span>
            </button>
          );
        })}
      </div>
      <div className="table-tools table-tools-top">
        <span className="table-count">
          {rows.length === agencies.length ? `${agencies.length} agencies` : `${rows.length} of ${agencies.length} agencies`}
          {isFiltered && (
            <button type="button" className="link-btn" onClick={() => { setQuery(""); setFilter("all"); }}>clear</button>
          )}
        </span>
        <span className="table-tools-right">
          <button type="button" className="dl dl-quiet" onClick={() => setCompact((c) => !c)} aria-pressed={!compact}>
            {compact ? `+ ${COLUMNS.filter((c) => c.secondary).length} more columns` : "− fewer columns"}
          </button>
          <button
            type="button"
            className="dl"
            onClick={() => downloadCsv(`watch-ledger-agencies-${(generated || "").slice(0, 10)}${rows.length < agencies.length ? "-filtered" : ""}.csv`, rows, CSV_COLS)}
          >
            ↓ Download CSV{rows.length < agencies.length ? ` (${rows.length} rows)` : ""}
          </button>
        </span>
      </div>
      {overflow.right && <p className="table-hint">Swipe sideways for more columns →</p>}
      <div className={`table-viewport${overflow.left ? " overflow-left" : ""}${overflow.right ? " overflow-right" : ""}`}>
        <div className="table-scroll" ref={scrollRef}>
          <table>
          <caption className="visually-hidden">
            Wisconsin agencies documented using automated license plate readers, with
            transparency portal statistics where the agency publishes them
          </caption>
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.key === "usat" ? "th-usat" : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  <button className="th-sort" title={c.title} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
                  </button>
                </th>
              ))}
              <th scope="col">Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.canonical}>
                <td className="cell-name">{a.name}</td>
                <td>{a.county || "—"}</td>
                <td className="cell-status">
                  <span
                    className={`badge badge-${a.status.value}`}
                    title={a.status.note || (a.status.value === "unknown" ? "Documented ALPR use, but current Flock network participation is unverified" : "")}
                  >
                    {a.status.value === "unknown" ? "unverified" : a.status.value}
                  </span>
                  {!a.status.derived && a.status.as_of && <span className="asof"> {a.status.as_of}</span>}
                  {(a.status.value === "dropped" && a.portal) || isStale(a) ? (
                  <span className="flags">
                  {a.status.value === "dropped" && a.portal && (
                    <span
                      className="flag"
                      title={`Announced dropping Flock, but Flock still lists a portal for this agency${a.portal.updated ? ` last updated ${a.portal.updated}` : ""}`}
                    >
                      portal still up
                    </span>
                  )}
                  {isStale(a) && (
                    <span
                      className="flag flag-stale"
                      title={`Portal figures last changed ${a.portal.updated}, ${a.portal.stale_days} days before this refresh. Excluded from the statewide 30-day totals.`}
                    >
                      frozen {a.portal.stale_days}d
                    </span>
                  )}
                  </span>
                  ) : null}
                </td>
                <td className="cell-num">{fmt(a.portal?.cameras)}</td>
                <td className="cell-num cell-searches">
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
                  {series[a.canonical] && (
                    <Sparkline points={series[a.canonical]} label={`Weekly search counts for ${a.name}`} />
                  )}
                </td>
                <td className="cell-num cell-usat">
                  {fmt(a.usatoday?.searches)}
                  {a.usatoday?.flagged_rows > 0 && (
                    <span
                      className="flag flag-freq"
                      title={`${a.usatoday.flagged_rows} of the 5,000 highest-frequency plate searches nationally in USA TODAY's records, across ${a.usatoday.flagged_users} user${a.usatoday.flagged_users === 1 ? "" : "s"}; one plate searched ${a.usatoday.max_plate_count.toLocaleString("en-US")} times. Not an accusation of wrongdoing.`}
                    >
                      {a.usatoday.flagged_rows} flagged
                    </span>
                  )}
                </td>
                {!compact && <td className="cell-num">{fmt(a.wisdot?.cameras)}</td>}
                {!compact && <td className="cell-num">{fmtZero(a.osm_cameras)}</td>}
                {!compact && <td className="cell-num">{a.portal?.hit_rate == null ? "—" : `${a.portal.hit_rate}%`}</td>}
                {!compact && <td className="cell-num">{fmt(a.portal?.reach?.received?.total)}</td>}
                {!compact && <td className="cell-num">{fmt(a.portal?.shared_with_count)}</td>}
                <td className="cell-sources">
                  {a.portal && (
                    <a
                      href={a.portal.portal_url}
                      target="_blank"
                      rel="noreferrer"
                      title={a.portal.hand_read ? `Portal figures read by hand on ${a.portal.updated}; Eyes On Flock does not index this portal` : undefined}
                    >
                      portal{a.portal.hand_read ? "*" : ""}
                    </a>
                  )}
                  {a.portal?.public_search_audit && (
                    <a
                      href={a.portal.portal_url}
                      target="_blank"
                      rel="noreferrer"
                      className="src-audit"
                      title="This agency also publishes a redacted log of every search run against its cameras"
                    >
                      audit log
                    </a>
                  )}
                  {!a.status.derived && a.status.source && (
                    <a href={a.status.source} target="_blank" rel="noreferrer">reporting</a>
                  )}
                  {a.atlas?.links?.[0] && (
                    <a href={a.atlas.links[0]} target="_blank" rel="noreferrer">atlas</a>
                  )}
                  {a.usatoday && (
                    <a href="https://data.usatoday.com/projects/flock-search/" target="_blank" rel="noreferrer" title="USA TODAY's Flock search-records tool">USA TODAY</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
      <p className="table-count">{rows.length} of {agencies.length} agencies shown · every dataset behind this table is on GitHub</p>
    </div>
  );
}
