import React, { useMemo, useState } from "react";
import { downloadCsv } from "./csv.js";

const perK = (r) => (r.usat_searches && r.population ? (1000 * r.usat_searches) / r.population : 0);

const COLS = [
  { key: "name", label: "County", get: (r) => r.name },
  { key: "population", label: "Population", get: (r) => r.population, numeric: true },
  { key: "agencies", label: "Agencies", get: (r) => r.agencies, numeric: true },
  { key: "in_network", label: "In network", get: (r) => r.in_network, numeric: true },
  { key: "portals", label: "Portals", title: "Agencies publishing a Flock transparency portal", get: (r) => r.portals, numeric: true },
  { key: "audits", label: "Audit logs", title: "Agencies also publishing a redacted log of every search", get: (r) => r.audits ?? 0, numeric: true },
  { key: "usat", label: "Searches on record", title: "Flock searches by the county's agencies in audit logs obtained by USA TODAY, Jan 2023 to Apr 2026", get: (r) => r.usat_searches ?? 0, numeric: true, usat: true },
  { key: "perk", label: "Per 1,000 residents", title: "Searches on record divided by county population, per 1,000 residents", get: perK, numeric: true, usat: true },
  { key: "wisdot_cameras", label: "Hwy cams", title: "Cameras permitted on state-highway right-of-way (WisDOT records)", get: (r) => r.wisdot_cameras, numeric: true },
  { key: "dropped", label: "Dropped", get: (r) => r.dropped, numeric: true },
];

const CSV_COLS = [
  ...COLS.filter((c) => c.key !== "perk").map((c) => ({ label: c.label, get: c.get })),
  { label: "Searches on record per 1,000 residents", get: (r) => perK(r).toFixed(1) },
];

const fmt = (n) => n.toLocaleString("en-US");
const Num = ({ n, dec }) => (
  <span className={n ? "" : "zero"}>{dec != null ? n.toFixed(dec) : fmt(n)}</span>
);

export default function CountyTable({ counties, home = "Marathon County", generated }) {
  const [sort, setSort] = useState({ key: "population", dir: -1 });
  const maxUsat = Math.max(...counties.map((r) => r.usat_searches ?? 0), 1);

  const rows = useMemo(() => {
    const col = COLS.find((c) => c.key === sort.key);
    return [...counties].sort((x, y) => {
      const a = col.get(x), b = col.get(y);
      if (col.numeric) return (a - b) * sort.dir;
      return String(a).localeCompare(String(b)) * sort.dir;
    });
  }, [counties, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <>
      <div className="table-scroll">
        <table className="county-table">
          <caption className="visually-hidden">
            Per-county rollup of agencies, Flock network membership, transparency portals,
            search audit logs, USA TODAY searches on record, WisDOT-permitted highway cameras,
            and dropped contracts
          </caption>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={c.usat ? "th-usat" : undefined}
                  aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                >
                  <button className="th-sort" title={c.title} onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className={r.name === home ? "row-home" : undefined}>
                <td className="cell-name">
                  {r.name.replace(/ County$/, "")}
                  {r.name === home && <span className="home-mark" title="Wausau Pilot & Review's home county">●</span>}
                </td>
                <td className="cell-num"><Num n={r.population} /></td>
                <td className="cell-num"><Num n={r.agencies} /></td>
                <td className="cell-num"><Num n={r.in_network} /></td>
                <td className="cell-num"><Num n={r.portals} /></td>
                <td className="cell-num"><Num n={r.audits ?? 0} /></td>
                <td className="cell-num cell-usat cell-bar">
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${(100 * (r.usat_searches ?? 0)) / maxUsat}%` }} />
                  </span>
                  <Num n={r.usat_searches ?? 0} />
                </td>
                <td className="cell-num cell-usat"><Num n={perK(r)} dec={0} /></td>
                <td className="cell-num"><Num n={r.wisdot_cameras} /></td>
                <td className={`cell-num${r.dropped ? " cell-dropped" : ""}`}><Num n={r.dropped} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-tools">
        <button
          type="button"
          className="dl"
          onClick={() => downloadCsv(`watch-ledger-counties-${(generated || "").slice(0, 10)}.csv`, rows, CSV_COLS)}
        >
          ↓ Download CSV
        </button>
        <span className="table-count">{counties.length} counties · sorted by {COLS.find((c) => c.key === sort.key).label.toLowerCase()}</span>
      </div>
    </>
  );
}
