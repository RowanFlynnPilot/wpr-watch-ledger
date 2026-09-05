import React, { useLayoutEffect, useRef, useState } from "react";

// The transparency-gap tick bar: one tick per network agency, sorted into three
// bands (audit log, portal only, nothing), with a card tooltip on hover, focus or
// tap and a click that finds the agency in the roster.

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

const tier = (a) => (a.portal?.public_search_audit ? 0 : a.portal ? 1 : 2);
const discloses = (a) =>
  a.portal
    ? a.portal.public_search_audit
      ? "Publishes usage data and a search audit log"
      : "Publishes usage data"
    : "Discloses nothing";

export default function GapBar({ agencies, onPick }) {
  const ordered = [...agencies].sort(
    (x, y) => tier(x) - tier(y) || (y.portal?.cameras ?? -1) - (x.portal?.cameras ?? -1) || x.name.localeCompare(y.name)
  );
  const wrapRef = useRef(null);
  const [active, setActive] = useState(null); // { a, el }
  const [pos, setPos] = useState(null);
  // On touch, the first tap only shows the card; the second tap goes to the roster.
  // Mouse and keyboard already have the card up (hover/focus) when they click.
  const lastPointer = useRef({ type: "mouse", wasActive: true });

  useLayoutEffect(() => {
    if (!active || !wrapRef.current) return setPos(null);
    const wrap = wrapRef.current.getBoundingClientRect();
    const t = active.el.getBoundingClientRect();
    const x = t.left - wrap.left + t.width / 2;
    const flip = x > wrap.width * 0.6;
    setPos({ x, y: t.bottom - wrap.top + 8, flip });
  }, [active]);

  const counts = [0, 0, 0];
  for (const a of ordered) counts[tier(a)]++;

  return (
    <div
      className="gap-bar-wrap"
      ref={wrapRef}
      onMouseLeave={() => setActive(null)}
    >
      <div
        className="gap-bar"
        role="img"
        aria-label={`${counts[0] + counts[1]} of ${ordered.length} network agencies publish a transparency portal, ${counts[0]} of those also publish a search audit log; ${ordered.filter((a) => a.status.value === "dropped").length} have announced dropping Flock`}
      >
        {ordered.map((a) => (
          <button
            key={a.canonical}
            type="button"
            className={`tick${a.portal ? " filled" : ""}${a.portal?.public_search_audit ? " audit" : ""}${a.status.value === "dropped" ? " tick-dropped" : ""}${active?.a === a ? " active" : ""}`}
            aria-label={`${a.name}: ${discloses(a).toLowerCase()}${a.status.value === "dropped" ? ", announced dropping Flock" : ""}`}
            onMouseEnter={(e) => setActive({ a, el: e.currentTarget })}
            onFocus={(e) => { lastPointer.current = { type: "keyboard", wasActive: true }; setActive({ a, el: e.currentTarget }); }}
            onBlur={() => setActive(null)}
            onPointerDown={(e) => { lastPointer.current = { type: e.pointerType, wasActive: active?.a === a }; }}
            onClick={(e) => {
              const lp = lastPointer.current;
              if (lp.type === "touch" && !lp.wasActive) { setActive({ a, el: e.currentTarget }); return; }
              if (onPick) onPick(a);
            }}
          />
        ))}
      </div>
      {active && pos && (
        <div
          className={`tip${active.a.status.value === "dropped" ? " tip-dropped" : ""}${pos.flip ? " tip-flip" : ""}`}
          style={{ left: pos.x, top: pos.y }}
          role="tooltip"
        >
          <div className="tip-name">{active.a.name}</div>
          <div className="tip-meta">
            {active.a.county || "County unresolved"} ·{" "}
            <span className={`badge badge-${active.a.status.value}`}>
              {active.a.status.value === "unknown" ? "unverified" : active.a.status.value}
            </span>
          </div>
          <div className={`tip-tier tier-${tier(active.a)}`}>{discloses(active.a)}</div>
          <dl className="tip-stats">
            {active.a.portal && (
              <>
                <dt>Cameras</dt><dd>{fmt(active.a.portal.cameras)}</dd>
                <dt>Searches, 30d</dt><dd>{fmt(active.a.portal.searches_30d)}</dd>
              </>
            )}
            {active.a.usatoday?.searches > 0 && (
              <>
                <dt>On record</dt><dd>{fmt(active.a.usatoday.searches)} <span className="tip-src">USA TODAY</span></dd>
              </>
            )}
            {active.a.wisdot && (
              <>
                <dt>Hwy cams</dt><dd>{fmt(active.a.wisdot.cameras)}</dd>
              </>
            )}
          </dl>
          {active.a.ice_287g && (
            <div className="tip-ice">ICE 287(g): {active.a.ice_287g.models.join(" + ")}{active.a.ice_287g.first_signed ? `, since ${active.a.ice_287g.first_signed.slice(0, 4)}` : ""}</div>
          )}
          {active.a.status.note && <div className="tip-note">{active.a.status.note.length > 140 ? active.a.status.note.slice(0, 137) + "…" : active.a.status.note}</div>}
          <div className="tip-hint">Click to find in the roster</div>
        </div>
      )}
    </div>
  );
}
