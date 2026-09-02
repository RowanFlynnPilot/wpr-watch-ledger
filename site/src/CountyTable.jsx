import React, { useMemo, useState } from "react";

const COLS = [
  { key: "name", label: "County", get: (r) => r.name },
  { key: "population", label: "Population", get: (r) => r.population, numeric: true },
  { key: "agencies", label: "Agencies", get: (r) => r.agencies, numeric: true },
  { key: "in_network", label: "In network", get: (r) => r.in_network, numeric: true },
  { key: "portals", label: "Portals", title: "Agencies publishing a Flock transparency portal", get: (r) => r.portals, numeric: true },
  { key: "audits", label: "Audit logs", title: "Agencies also publishing a redacted log of every search", get: (r) => r.audits ?? 0, numeric: true },
  { key: "wisdot_cameras", label: "Hwy cams", title: "Cameras permitted on state-highway right-of-way (WisDOT records)", get: (r) => r.wisdot_cameras, numeric: true },
  { key: "dropped", label: "Dropped", get: (r) => r.dropped, numeric: true },
];

const fmt = (n) => n.toLocaleString("en-US");

export default function CountyTable({ counties }) {
  const [sort, setSort] = useState({ key: "population", dir: -1 });

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
    <div className="table-scroll">
      <table className="county-table">
        <caption className="visually-hidden">
          Per-county rollup of agencies, Flock network membership, transparency portals,
          search audit logs, WisDOT-permitted highway cameras, and dropped contracts
        </caption>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c.key}
                scope="col"
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
            <tr key={r.name}>
              <td className="cell-name">{r.name.replace(/ County$/, "")}</td>
              <td className="cell-num">{fmt(r.population)}</td>
              <td className="cell-num">{fmt(r.agencies)}</td>
              <td className="cell-num">{fmt(r.in_network)}</td>
              <td className="cell-num">{fmt(r.portals)}</td>
              <td className="cell-num">{fmt(r.audits ?? 0)}</td>
              <td className="cell-num">{fmt(r.wisdot_cameras)}</td>
              <td className="cell-num">{fmt(r.dropped)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
