import React from "react";
import { slug } from "./share.js";

// The agencies that have ended Flock, and those that have stopped using the cameras without
// (yet) ending the contract, in order. Dates are when the newsroom's source reported the
// decision (the overlay's as_of), so agencies named in one report share a date and a note.

const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const short = (n) => n.replace(/ Police Department$/, " PD").replace(/ Sheriff's Office$/, " Sheriff");

export default function Decisions({ agencies, onPick }) {
  const acted = agencies.filter((a) => (a.status.value === "dropped" || a.status.value === "suspended") && a.status.as_of);
  if (acted.length === 0) return null;
  const dropped = acted.filter((a) => a.status.value === "dropped");
  const suspended = acted.filter((a) => a.status.value === "suspended");
  const groups = new Map();
  for (const a of [...acted].sort((x, y) => x.status.as_of.localeCompare(y.status.as_of) || x.name.localeCompare(y.name))) {
    const k = `${a.status.as_of}|${a.status.value}|${a.status.note || ""}|${a.status.source || ""}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const counties = new Set(acted.map((a) => a.county).filter(Boolean));
  const first = day(acted.map((a) => a.status.as_of).sort()[0]);

  return (
    <section className="decisions" aria-label="Agencies that have dropped or suspended Flock">
      <h2>Who has walked away</h2>
      <p className="decisions-dek">
        Since {first}, <strong>{dropped.length}</strong> Wisconsin agencies have ended or decided to end their use
        of Flock{suspended.length > 0 && (
          <>
            , and <strong>{suspended.length}</strong> more have stopped using the cameras while they review the
            program, without ending the contract
          </>
        )}
        . They span {counties.size} counties. Dates are when each decision was reported; an agency that decided not
        to renew may still run its cameras until the contract expires.
      </p>
      <div className="decisions-key" aria-hidden="true">
        <span><span className="decision-dot" /> Ended, or voted to end</span>
        {suspended.length > 0 && <span><span className="decision-dot is-suspended" /> Use suspended, contract in place</span>}
      </div>
      <ol className="decisions-line">
        {[...groups.values()].map((group) => {
          const s = group[0].status;
          return (
            <li key={`${s.as_of}-${group[0].canonical}`} className={`decision${s.value === "suspended" ? " is-suspended" : ""}`}>
              <time className="decision-date" dateTime={s.as_of}>{day(s.as_of)}</time>
              <div className="decision-body">
                <p className="decision-names">
                  {group.map((a, i) => (
                    <React.Fragment key={a.canonical}>
                      {i > 0 && <span className="decision-sep"> · </span>}
                      <button type="button" className="decision-name" onClick={() => onPick({ type: "agency", id: slug(a.canonical) })}>
                        {short(a.name)}
                      </button>
                    </React.Fragment>
                  ))}
                </p>
                <p className="decision-note">
                  <span className="decision-count">
                    {s.value === "suspended" ? "suspended" : "ended"}{group.length > 1 ? ` · ${group.length} agencies` : ""}
                  </span>
                  {s.note}
                  {s.note && s.source && " "}
                  {s.source && <a className="decision-src" href={s.source} target="_blank" rel="noreferrer">Reporting ↗</a>}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
