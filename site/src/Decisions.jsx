import React from "react";
import { slug } from "./share.js";

// The agencies that have dropped Flock, in order. Dates are when the newsroom's source
// reported the decision (the overlay's as_of), so agencies named in one report share a date.

const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function Decisions({ agencies, onPick }) {
  const dropped = agencies.filter((a) => a.status.value === "dropped" && a.status.as_of);
  if (dropped.length === 0) return null;
  const groups = new Map();
  for (const a of [...dropped].sort((x, y) => x.status.as_of.localeCompare(y.status.as_of) || x.name.localeCompare(y.name))) {
    const k = `${a.status.as_of}|${a.status.note || ""}|${a.status.source || ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const counties = new Set(dropped.map((a) => a.county).filter(Boolean));

  return (
    <section className="decisions" aria-label="Agencies that have dropped Flock">
      <h2>Who has walked away</h2>
      <p className="decisions-dek">
        <strong>{dropped.length}</strong> Wisconsin agencies in {counties.size} counties have announced they are
        ending their use of Flock, all within a few months of each other. Dates are when the decision was reported.
      </p>
      <ol className="decisions-line">
        {[...groups.values()].map((group) => {
          const s = group[0].status;
          return (
            <li key={`${s.as_of}-${group[0].canonical}`} className="decision">
              <time className="decision-date" dateTime={s.as_of}>{day(s.as_of)}</time>
              <div className="decision-body">
                <p className="decision-names">
                  {group.map((a, i) => (
                    <React.Fragment key={a.canonical}>
                      {i > 0 && <span className="decision-sep"> · </span>}
                      <button type="button" className="decision-name" onClick={() => onPick({ type: "agency", id: slug(a.canonical) })}>
                        {a.name.replace(/ Police Department$/, " PD").replace(/ Sheriff's Office$/, " Sheriff")}
                      </button>
                    </React.Fragment>
                  ))}
                </p>
                {s.note && <p className="decision-note">{s.note}</p>}
                {s.source && <a className="decision-src" href={s.source} target="_blank" rel="noreferrer">Reporting ↗</a>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
