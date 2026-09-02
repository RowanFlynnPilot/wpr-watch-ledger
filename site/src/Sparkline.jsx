import React from "react";

// Inline sparkline: one value per weekly snapshot, x spaced by real date so a
// two-week gap looks like one. Null weeks break the line rather than being guessed.
export default function Sparkline({ points, width = 64, height = 18, label }) {
  const valid = points.filter((p) => p.value != null);
  if (valid.length < 2) return null;
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const vals = valid.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = 2;
  const x = (d) => pad + ((new Date(d).getTime() - t0) / span) * (width - 2 * pad);
  const y = (v) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad));
  const segments = [];
  let cur = [];
  for (const p of points) {
    if (p.value == null) { if (cur.length) segments.push(cur); cur = []; continue; }
    cur.push(`${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`);
  }
  if (cur.length) segments.push(cur);
  const last = valid[valid.length - 1];
  const summary = `${valid[0].value.toLocaleString("en-US")} → ${last.value.toLocaleString("en-US")} across ${valid.length} weekly snapshots`;
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${summary}`}>
      <title>{summary}</title>
      {segments.map((s, i) => (
        <polyline key={i} className="spark-line" points={s.join(" ")} />
      ))}
      <circle className="spark-dot" cx={x(last.date)} cy={y(last.value)} r={1.8} />
    </svg>
  );
}
