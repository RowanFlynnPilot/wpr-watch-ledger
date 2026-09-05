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
  const running = [];
  years.reduce((sum, y) => { running.push(sum + byYear[y]); return sum + byYear[y]; }, 0);
  const dated = running[running.length - 1];
  return (
    <div className="permits-wrap">
      <h3 className="permits-title">When the highway cameras were permitted</h3>
      <p className="permits-lede">
        From <strong>{fmt(byYear[years[0]])}</strong> camera{byYear[years[0]] === 1 ? "" : "s"} approved in {years[0]} to{" "}
        <strong>{fmt(dated)}</strong> by {snapshotDate.slice(0, 4)}
      </p>
      <div className="permits" role="img" aria-label={`WisDOT permit approvals by year: ${years.map((y) => `${y} ${byYear[y]}`).join(", ")}`}>
        {years.map((y, i) => (
          <div className="permit-year" key={y}>
            <span className="permit-n">{fmt(byYear[y])}</span>
            <span
              className={`permit-bar${y === currentYear ? " partial" : ""}`}
              style={{ height: `${(100 * byYear[y]) / max}%` }}
              title={`${y}: ${fmt(byYear[y])} cameras approved${y === currentYear ? ` (through ${snapshotDate})` : ""} · ${fmt(running[i])} in total by then`}
            />
            <span className="permit-label">{y}{y === currentYear ? "*" : ""}</span>
            <span className="permit-cum">{fmt(running[i])}</span>
          </div>
        ))}
      </div>
      <p className="gap-caption">
        Bars are cameras by WisDOT approval date; the small figure under each year is the
        running total. {peak} was the peak year so far; *{currentYear} covers only the months
        through the {snapshotDate} records snapshot
        {unknown > 0 ? `, and ${unknown} cameras carry no approval date in the registry` : ""}.
      </p>
    </div>
  );
}
