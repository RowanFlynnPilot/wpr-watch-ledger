import React from "react";

// Week by week: statewide portal totals across every weekly snapshot on record,
// plus the agencies whose 30-day search counts moved most since the first one.
// Figures are as each portal published them that week.

const fmt = (n) => n.toLocaleString("en-US");
const day = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Chart({ series, label }) {
  const W = 320, H = 96, padL = 6, padR = 6, padT = 12, padB = 20;
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
      <text className="trend-val start" x={x(first.date)} y={y(first.value) - 6} textAnchor="start">{fmt(first.value)}</text>
      <text className="trend-axis" x={padL} y={H - 6}>{day(first.date)}</text>
      <text className="trend-axis" x={W - padR} y={H - 6} textAnchor="end">{day(last.date)}</text>
      <text className="trend-val" x={x(last.date)} y={y(last.value) - 6} textAnchor="end">{fmt(last.value)}</text>
    </svg>
  );
}

function Change({ series, unit, portals = true }) {
  const first = series[0], last = series[series.length - 1];
  const delta = last.value - first.value;
  const pct = first.value ? (100 * delta) / first.value : 0;
  const cls = delta > 0 ? "up" : delta < 0 ? "down" : "";
  return (
    <p className="trend-change">
      <span className={cls}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "="} {fmt(Math.abs(delta))} {unit}</span>{" "}
      ({pct > 0 ? "+" : ""}{pct.toFixed(1)}%) since {day(first.date)}
      {portals && first.portals !== last.portals && ` · ${first.portals} → ${last.portals} portals reporting`}
    </p>
  );
}

export default function Trend({ history, agencies }) {
  const snaps = history.snapshots;
  if (snaps.length < 2) return null;
  const total = (snap, key) => Object.values(snap.portals).reduce((n, p) => n + (p[key] || 0), 0);
  const series = (key) => snaps.map((s) => ({ date: s.date, value: total(s, key), portals: Object.keys(s.portals).length }));
  // Per reporting portal, so a week when new portals appear is not read as a surge in
  // surveillance. Divides by the portals in that week's snapshot that carry the figure.
  const perPortal = (key) =>
    snaps.map((s) => {
      const vals = Object.values(s.portals).map((p) => p[key]).filter((v) => v != null);
      return { date: s.date, value: vals.length ? Math.round(vals.reduce((n, v) => n + v, 0) / vals.length) : 0, portals: vals.length };
    });
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
        The ledger has snapshotted every Wisconsin portal weekly since {day(first.date)}. The
        statewide total moves whenever a new portal appears as much as when police activity
        changes, so each figure is also shown as an average per reporting portal.
      </p>
      <div className="trend-grid">
        <div className="trend-card">
          <h3>Sightings, trailing 30 days</h3>
          <p className="trend-sub">Statewide total, all reporting portals</p>
          <Chart series={series("vehicles_captured_30d")} label="Vehicle sightings, statewide total" />
          <Change series={series("vehicles_captured_30d")} unit="sightings" />
          <p className="trend-sub">Average per reporting portal</p>
          <Chart series={perPortal("vehicles_captured_30d")} label="Vehicle sightings per portal" />
          <Change series={perPortal("vehicles_captured_30d")} unit="per portal" portals={false} />
        </div>
        <div className="trend-card">
          <h3>Searches, trailing 30 days</h3>
          <p className="trend-sub">Statewide total, all reporting portals</p>
          <Chart series={series("searches_30d")} label="Police searches, statewide total" />
          <Change series={series("searches_30d")} unit="searches" />
          <p className="trend-sub">Average per reporting portal</p>
          <Chart series={perPortal("searches_30d")} label="Police searches per portal" />
          <Change series={perPortal("searches_30d")} unit="per portal" portals={false} />
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
