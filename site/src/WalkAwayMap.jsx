import React, { useEffect, useMemo, useRef, useState } from "react";
import { apDate } from "./dates.js";

// The walk-away, county by county: Wisconsin's 72 counties fill in rust as the first agency in
// each ends (or suspends) its use of Flock, stepping through the decision dates in the overlay.
// It shows the FINAL state until it is actually seen, then replays once from the first
// decision, so hidden iframes, crawlers and reduced-motion readers always get the full picture.

const W = 300;
const STEP_MS = 420;
const LAT0 = 44.7;
const KX = Math.cos((LAT0 * Math.PI) / 180);

function project(shapes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of shapes.features)
    for (const poly of f.geometry.coordinates)
      for (const ring of poly)
        for (const [lon, lat] of ring) {
          const x = lon * KX, y = -lat;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
  const k = W / (maxX - minX);
  const H = Math.ceil((maxY - minY) * k);
  const paths = shapes.features.map((f) => ({
    name: f.properties.name,
    d: f.geometry.coordinates
      .map((poly) =>
        poly
          .map((ring) => "M" + ring.map(([lon, lat]) => `${((lon * KX - minX) * k).toFixed(1)},${((-lat - minY) * k).toFixed(1)}`).join("L") + "Z")
          .join("")
      )
      .join(""),
  }));
  return { paths, H };
}

const short = (n) => n.replace(/ Police Department$/, " PD").replace(/ Sheriff's Office$/, " Sheriff");

export default function WalkAwayMap({ agencies, shapes, home = "Marathon County" }) {
  const geo = useMemo(() => project(shapes), [shapes]);
  const acted = useMemo(
    () =>
      agencies
        .filter((a) => (a.status.value === "dropped" || a.status.value === "suspended") && a.status.as_of)
        .sort((x, y) => x.status.as_of.localeCompare(y.status.as_of)),
    [agencies]
  );
  const dates = useMemo(() => [...new Set(acted.map((a) => a.status.as_of))], [acted]);
  const last = dates.length - 1;
  const [idx, setIdx] = useState(last);
  const [playing, setPlaying] = useState(false);
  const ref = useRef(null);
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => setIdx(dates.length - 1), [dates.length]);

  useEffect(() => {
    if (reduced || !ref.current || dates.length < 2) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setIdx(0);
        setPlaying(true);
      },
      { threshold: 0.5 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced, dates.length]);

  useEffect(() => {
    if (!playing) return;
    if (idx >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setIdx((i) => Math.min(i + 1, last)), STEP_MS);
    return () => clearTimeout(id);
  }, [playing, idx, last]);

  if (dates.length === 0) return null;
  const cutoff = dates[idx];
  const upTo = acted.filter((a) => a.status.as_of <= cutoff);
  const byCounty = new Map();
  for (const a of upTo) {
    if (!a.county) continue;
    if (!byCounty.has(a.county)) byCounty.set(a.county, []);
    byCounty.get(a.county).push(a);
  }
  const flipped = new Set(
    [...byCounty].filter(([, list]) => list[0].status.as_of === cutoff).map(([c]) => c)
  );
  const nDropped = upTo.filter((a) => a.status.value === "dropped").length;
  const nSuspended = upTo.length - nDropped;
  const today = upTo.filter((a) => a.status.as_of === cutoff);

  // Cumulative step chart under the map: ended (solid) and ended + suspended (tint).
  const t0 = Date.parse(dates[0]), t1 = Math.max(Date.parse(dates[last]), t0 + 86400000);
  const CW = 300, CH = 64, total = acted.length || 1;
  const xOf = (iso) => ((Date.parse(iso) - t0) / (t1 - t0)) * CW;
  const yOf = (n) => CH - (n / total) * (CH - 4);
  const steps = (pred) => {
    let n = 0, d = `M0,${CH}`;
    for (const iso of dates) {
      const x = xOf(iso).toFixed(1);
      d += `L${x},${yOf(n).toFixed(1)}`;
      n += acted.filter((a) => a.status.as_of === iso && pred(a)).length;
      d += `L${x},${yOf(n).toFixed(1)}`;
    }
    return d + `L${CW},${yOf(n).toFixed(1)}`;
  };
  const allPath = steps(() => true);
  const droppedPath = steps((a) => a.status.value === "dropped");
  // Month ticks on the 1st, skipping any that would crowd the chart's left edge.
  const months = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso.endsWith("-01") && xOf(iso) > 14) months.push(iso);
  }

  const play = () => {
    if (playing) return setPlaying(false);
    if (idx >= last) setIdx(0);
    setPlaying(true);
  };

  return (
    <div className="walkaway" ref={ref}>
      <div className="walkaway-map">
        <svg
          viewBox={`0 0 ${W} ${geo.H}`}
          role="img"
          aria-label={`Map of Wisconsin counties. As of ${apDate(cutoff)}, agencies in ${byCounty.size} counties had ended or suspended their use of Flock.`}
        >
          {[...geo.paths.filter((p) => p.name !== home), ...geo.paths.filter((p) => p.name === home)].map((p) => {
            const list = byCounty.get(p.name);
            const state = !list ? "" : list.some((a) => a.status.value === "dropped") ? " is-ended" : " is-suspended";
            return (
              <path
                key={p.name}
                d={p.d}
                className={`wa-county${state}${flipped.has(p.name) ? " is-new" : ""}${p.name === home ? " is-home" : ""}`}
              >
                <title>
                  {p.name}
                  {list ? `: ${list.map((a) => `${short(a.name)} (${a.status.value === "dropped" ? "ended" : "suspended"} ${apDate(a.status.as_of, { year: false })})`).join(", ")}` : ""}
                </title>
              </path>
            );
          })}
        </svg>
      </div>
      <div className="walkaway-side">
        <p className="walkaway-date" aria-live="polite">
          <time dateTime={cutoff}>{apDate(cutoff)}</time>
        </p>
        <p className="walkaway-tally">
          <span className="wa-num">{nDropped}</span> ended
          {nSuspended > 0 && (
            <>
              {" "}· <span className="wa-num wa-num-soft">{nSuspended}</span> suspended
            </>
          )}
          <span className="walkaway-counties">across {byCounty.size} of 72 counties</span>
        </p>
        <p className="walkaway-latest">
          {today.slice(0, 4).map((a) => short(a.name)).join(", ")}
          {today.length > 4 ? ` and ${today.length - 4} more` : ""}
        </p>
        <svg className="walkaway-chart" viewBox={`0 -2 ${CW} ${CH + 16}`} aria-hidden="true">
          <path d={allPath + `L${CW},${CH}Z`} className="wa-area-all" />
          <path d={droppedPath + `L${CW},${CH}Z`} className="wa-area-ended" />
          <line x1={xOf(cutoff)} x2={xOf(cutoff)} y1="0" y2={CH} className="wa-playhead" />
          {months.map((m) => (
            <text key={m} x={xOf(m)} y={CH + 13} className="wa-month">
              {apDate(m, { year: false }).replace(/ 1$/, "")}
            </text>
          ))}
        </svg>
        <div className="walkaway-controls">
          <button type="button" className="dl" onClick={play} aria-pressed={playing}>
            {playing ? "❚❚ Pause" : idx >= last ? "↻ Replay" : "▶ Play"}
          </button>
          <input
            type="range"
            min="0"
            max={last}
            value={idx}
            onChange={(e) => {
              setPlaying(false);
              setIdx(Number(e.target.value));
            }}
            aria-label="Decision date"
            aria-valuetext={apDate(cutoff)}
          />
        </div>
        <div className="walkaway-key" aria-hidden="true">
          <span><span className="wa-swatch is-ended" /> an agency ended Flock</span>
          <span><span className="wa-swatch is-suspended" /> use suspended only</span>
          <span><span className="wa-swatch is-home" /> {home.replace(/ County$/, "")}, home of this newsroom</span>
        </div>
      </div>
    </div>
  );
}
