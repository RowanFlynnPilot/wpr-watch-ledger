import React from "react";

// Week by week: statewide portal totals across every weekly snapshot on record,
// plus the agencies whose 30-day search counts moved most since the first one.
// Figures are as each portal published them that week.

const fmt = (n) => n.toLocaleString("en-US");
const day = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Chart({ series, label }) {
  const W = 320, H = 110, padL = 6, padR = 6, padT = 10, padB = 22;
  const t0 = new Date(series[0].date).getTime();
  const t1 = new Date(series[series.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const vals = series.map((p) => p.value);
  // Zero baseline: these are totals, and a 2% dip must not look like a cliff.
  const lo = 0, hi = Math.max(...vals);
  const x = (d) => padL + ((new Date(d).getTime() - t0) / span) * (W - padL - padR);
  const y = (v) => (hi === lo ? H / 2 : padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB));
  const pts = series.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`);
  const area = `${x(series[0].date).toFixed(1)},${H - padB} ${pts.join(" ")} ${x(series[series.length - 1].date).toFixed(1)},${H - padB}`;
  const first = series[0], last = series[series.length - 1];
  return (
    <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${fmt(first.value)} on ${day(first.date)}, ${fmt(last.value)} on ${day(last.date)}`}>
      <polygon className="trend-area" points={area} />
      <polyline className="trend-path" points={pts.join(" ")} />
      {series.map((p) => (
        <circle key={p.date} className="trend-pt" cx={x(p.date)} cy={y(p.value)} r={2.5}>
          <title>{`${day(p.date)}: ${fmt(p.value)} (${p.portals} portals)`}</title>
        </circle>
      ))}
      <text className="trend-axis" x={padL} y={H - 6}>{day(first.date)}</text>
      <text className="trend-axis" x={W - padR} y={H - 6} textAnchor="end">{day(last.date)}</text>
      <text className="trend-val" x={x(last.date)} y={y(last.value) - 6} textAnchor="end">{fmt(last.value)}</text>
    </svg>
  );
}

export default function Trend({ history, agencies }) {
  const snaps = history.snapshots;
  if (snaps.length < 2) return null;
  const total = (snap, key) => Object.values(snap.portals).reduce((n, p) => n + (p[key] || 0), 0);
  const series = (key) => snaps.map((s) => ({ date: s.date, value: total(s, key), portals: Object.keys(s.portals).length }));
  const byCanonical = new Map(agencies.map((a) => [a.canonical, a.name]));
  const first = snaps[0], last = snaps[snaps.length - 1];
  const movers = Object.keys(last.portals)
    .filter((k) => first.portals[k] && first.portals[k].searches_30d != null && last.portals[k].searches_30d != null)
    .map((k) => ({ key: k, name: byCanonical.get(k) || k, delta: last.portals[k].searches_30d - first.portals[k].searches_30d, now: last.portals[k].searches_30d }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
  const weeks = Math.round((new Date(last.date) - new Date(first.date)) / 604800000);

  return (
    <section className="trend" aria-label="Week by week">
      <h2>Week by week</h2>
      <p className="trend-dek">
        The ledger has snapshotted every Wisconsin portal weekly since {day(first.date)}. Each
        point is the statewide total as published that week; hover for the portal count behind it.
      </p>
      <div className="trend-grid">
        <div className="trend-card">
          <h3>Vehicle sightings, trailing 30 days</h3>
          <Chart series={series("vehicles_captured_30d")} label="Vehicle sightings" />
        </div>
        <div className="trend-card">
          <h3>Police searches, trailing 30 days</h3>
          <Chart series={series("searches_30d")} label="Police searches" />
        </div>
        {movers.length > 0 && (
          <div className="trend-card">
            <h3>Biggest search movers, {weeks} week{weeks === 1 ? "" : "s"}</h3>
            <ul className="movers">
              {movers.map((m) => (
                <li key={m.key}>
                  <span>{m.name}</span>
                  <span className={m.delta > 0 ? "up" : "down"}>
                    {m.delta > 0 ? "▲" : "▼"}{fmt(Math.abs(m.delta))} <span className="movers-now">→ {fmt(m.now)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
