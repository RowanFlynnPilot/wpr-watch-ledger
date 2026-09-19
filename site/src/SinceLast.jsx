import React from "react";
import Sparkline from "./Sparkline.jsx";

// What moved since the previous refresh, from data/changes.json: the pipeline diffs each
// run against the data it is about to replace. A reason to come back next week.

const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const list = (names, max = 3) => names.slice(0, max).join(", ") + (names.length > max ? ` and ${names.length - max} more` : "");

function extras(run) {
  const parts = [];
  if (run.portals.new.length) parts.push(`new portal${run.portals.new.length === 1 ? "" : "s"}: ${list(run.portals.new)}`);
  if (run.portals.gone.length) parts.push(`portal${run.portals.gone.length === 1 ? "" : "s"} gone: ${list(run.portals.gone)}`);
  if (run.status.length) parts.push(run.status.map((s) => `${s.name} now ${s.to}`).slice(0, 2).join("; "));
  if (run.agencies.added.length) parts.push(`joined the roster: ${list(run.agencies.added)}`);
  return parts;
}

function line(run) {
  const c = run.cameras;
  const cams = c.added || c.removed ? `${c.added} camera${c.added === 1 ? "" : "s"} added to the map, ${c.removed} removed` : "no change to the map";
  return [cams, ...extras(run)].join(" · ");
}

export default function SinceLast({ changes, history }) {
  const runs = changes?.runs || [];
  if (runs.length === 0) return null;
  const last = runs[runs.length - 1];
  const movers = last.cameras.by_county.filter((c) => c.county !== "Unplaced").slice(0, 4);
  const quiet = extras(last).length === 0;
  const camPoints = (history?.snapshots || []).filter((s) => s.cameras).map((s) => ({ date: s.date, value: s.cameras.total }));
  const earlier = runs.slice(0, -1).reverse().slice(0, 8);

  return (
    <section className="since" aria-label="What changed since the last refresh">
      <div className="since-main">
        <p className="since-eyebrow">Since {day(last.since)}</p>
        <p className="since-line">
          <strong className="since-up">+{last.cameras.added}</strong> cameras mapped,{" "}
          <strong className="since-down">−{last.cameras.removed}</strong> removed by volunteers
          {movers.length > 0 && (
            <>
              {" "}· most activity in{" "}
              {movers.map((m, i) => (
                <React.Fragment key={m.county}>
                  {i > 0 && ", "}
                  {m.county.replace(/ County$/, "")}{" "}
                  <span className="since-delta">
                    {m.added > 0 && `+${m.added}`}
                    {m.added > 0 && m.removed > 0 && " / "}
                    {m.removed > 0 && `−${m.removed}`}
                  </span>
                </React.Fragment>
              ))}
            </>
          )}
          .
        </p>
        <p className="since-sub">
          {quiet
            ? "No new transparency portals, no status changes and no new agencies on the roster this time."
            : extras(last).join(" · ").replace(/^./, (c) => c.toUpperCase()) + "."}
        </p>
      </div>
      {camPoints.length >= 2 && (
        <div className="since-spark" title="Cameras on the volunteer map at each refresh">
          <Sparkline points={camPoints} width={120} height={34} label="Cameras mapped" />
          <span className="since-spark-label">cameras mapped, {day(camPoints[0].date)} to {day(camPoints[camPoints.length - 1].date)}</span>
        </div>
      )}
      {earlier.length > 0 && (
        <details className="since-earlier">
          <summary>Earlier refreshes</summary>
          <ul>
            {earlier.map((r) => (
              <li key={r.date}>
                <span className="since-date">{day(r.date)}</span> {line(r)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
