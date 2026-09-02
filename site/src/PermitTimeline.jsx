import React from "react";

// When the highway cameras arrived: WisDOT right-of-way permit approvals by year.
// Straight from the committed records snapshot; the current year is partial.

const fmt = (n) => n.toLocaleString("en-US");

export default function PermitTimeline({ byYear, snapshotDate }) {
  const years = Object.keys(byYear).filter((y) => y !== "unknown").sort();
  if (years.length === 0) return null;
  const unknown = byYear.unknown || 0;
  const max = Math.max(...years.map((y) => byYear[y]));
  const currentYear = snapshotDate.slice(0, 4);
  const peak = years.reduce((best, y) => (byYear[y] > byYear[best] ? y : best), years[0]);
  return (
    <div className="permits-wrap">
      <h3 className="permits-title">When the highway cameras were permitted</h3>
      <div className="permits" role="img" aria-label={`WisDOT permit approvals by year: ${years.map((y) => `${y} ${byYear[y]}`).join(", ")}`}>
        {years.map((y) => (
          <div className="permit-year" key={y}>
            <span className="permit-n">{fmt(byYear[y])}</span>
            <span
              className={`permit-bar${y === currentYear ? " partial" : ""}`}
              style={{ height: `${(100 * byYear[y]) / max}%` }}
              title={`${y}: ${fmt(byYear[y])} cameras approved${y === currentYear ? ` (through ${snapshotDate})` : ""}`}
            />
            <span className="permit-label">{y}</span>
          </div>
        ))}
      </div>
      <p className="gap-caption">
        Cameras by WisDOT approval date. {peak} was the peak year so far; {currentYear} covers
        only the months through the {snapshotDate} records snapshot
        {unknown > 0 ? `, and ${unknown} cameras carry no approval date in the registry` : ""}.
      </p>
    </div>
  );
}
