import React from "react";
import Sparkline from "./Sparkline.jsx";
import { apDate } from "./dates.js";

// What moved since the previous refresh, from data/changes.json: the pipeline diffs each
// run against the data it is about to replace. A reason to come back next week.

const day = (d) => apDate(d, { year: false });
const list = (names, max = 3) => names.slice(0, max).join(", ") + (names.length > max ? ` and ${names.length - max} more` : "");

// "unverified" becoming "active" is the pipeline learning something, not an agency acting.
const NEWS = new Set(["dropped", "suspended"]);

function extras(run0) {
  const run = { ...run0, status: run0.status.filter((s) => NEWS.has(s.to) || NEWS.has(s.from)) };
  const parts = [];
  if (run.portals.new.length) parts.push(`new portal${run.portals.new.length === 1 ? "" : "s"}: ${list(run.portals.new)}`);
  if (run.portals.gone.length) parts.push(`portal${run.portals.gone.length === 1 ? "" : "s"} gone: ${list(run.portals.gone)}`);
  if (run.status.length > 0 && run.status.length <= 2) parts.push(run.status.map((s) => `${s.name} now ${s.to}`).join("; "));
  if (run.status.length > 2) {
    // A wave of decisions reads better as counts; the timeline below names each agency.
    const by = {};
    for (const s of run.status) by[s.to] = (by[s.to] || 0) + 1;
    parts.push(Object.entries(by).map(([to, n]) => `${n} agencies now ${to}`).join(", "));
  }
  if (run.agencies.added.length) parts.push(`joined the roster: ${list(run.agencies.added)}`);
  return parts;
}

export default function SinceLast({ changes, history }) {
  const runs = changes?.runs || [];
  if (runs.length === 0) return null;
  const last = runs[runs.length - 1];
  const movers = last.cameras.by_county.filter((c) => c.county !== "Unplaced").slice(0, 4);
  const notes = extras(last);
  const camPoints = (history?.snapshots || []).filter((s) => s.cameras).map((s) => ({ date: s.date, value: s.cameras.total }));
  // Runs where nothing moved (a second refresh in the same week) carry no news.
  const earlier = runs.slice(0, -1).reverse()
    .filter((r) => r.cameras.added || r.cameras.removed || extras(r).length)
    .slice(0, 8);
  const anyNotes = earlier.some((r) => extras(r).length > 0);
  const scale = Math.max(1, ...earlier.map((r) => Math.max(r.cameras.added, r.cameras.removed)));

  return (
    <section className="since" aria-label="What changed since the last refresh">
      <div className="since-main">
        <p className="since-eyebrow">Since {day(last.since)}</p>
        <p className="since-line">
          <strong className="since-up">+{last.cameras.added}</strong> cameras mapped,{" "}
          <strong className="since-down">−{last.cameras.removed}</strong> removed by volunteers
        </p>
        {movers.length > 0 && (
          <ul className="since-movers" aria-label="Counties with the most map activity">
            {movers.map((m) => (
              <li key={m.county}>
                {m.county.replace(/ County$/, "")}
                {m.added > 0 && <span className="since-chip-up">+{m.added}</span>}
                {m.removed > 0 && <span className="since-chip-down">−{m.removed}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="since-sub">
          {notes.length === 0
            ? "No new transparency portals, status changes or roster additions this time."
            : notes.join(" · ").replace(/^./, (c) => c.toUpperCase()) + "."}
        </p>
      </div>
      {camPoints.length >= 2 && (
        <div className="since-spark" title="Cameras on the volunteer map at each refresh">
          <span className="since-spark-num">{camPoints[camPoints.length - 1].value.toLocaleString("en-US")}</span>
          <Sparkline points={camPoints} width={132} height={36} label="Cameras mapped" />
          <span className="since-spark-label">on the map · since {day(camPoints[0].date)}</span>
        </div>
      )}
      {earlier.length > 0 && (
        <details className="since-earlier">
          <summary>Earlier refreshes</summary>
          <table className="since-table">
            <thead>
              <tr><th scope="col">Refresh</th><th scope="col">Added</th><th scope="col">Removed</th><th scope="col"><span className="visually-hidden">Scale</span></th>{anyNotes && <th scope="col" className="since-t-note">Also</th>}</tr>
            </thead>
            <tbody>
              {earlier.map((r) => (
                <tr key={r.date}>
                  <th scope="row">{day(r.date)}</th>
                  <td className="since-t-up">+{r.cameras.added}</td>
                  <td className="since-t-down">−{r.cameras.removed}</td>
                  <td className="since-t-bars" aria-hidden="true">
                    <span className="since-bar up" style={{ width: `${(100 * r.cameras.added) / scale}%` }} />
                    <span className="since-bar down" style={{ width: `${(100 * r.cameras.removed) / scale}%` }} />
                  </td>
                  {anyNotes && <td className="since-t-note">{extras(r).join(" · ") || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
