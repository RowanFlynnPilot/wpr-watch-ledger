import React, { useEffect, useRef, useState } from "react";

const fmt = (n) => n.toLocaleString("en-US");

// The 30-day ledger band. Figures render at their final values by default —
// the count-up only replaces them once the band is actually seen and the
// visitor hasn't asked for reduced motion, so prerenders, crawlers, and
// hidden iframes always show real numbers.
export default function LedgerBand({ sightings, perDay, searches, publisherCount, silentCount }) {
  const ref = useRef(null);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [progress, setProgress] = useState(1);
  useEffect(() => {
    if (reduced || !ref.current) return;
    let raf;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const t0 = performance.now();
        const DURATION = 1400;
        const step = (t) => {
          const p = Math.min(1, (t - t0) / DURATION);
          setProgress(1 - Math.pow(1 - p, 3));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        setProgress(0);
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );
    io.observe(ref.current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  // Live pace, derived from the same disclosed 30-day total. Computed off the
  // clock (not tick counts) so background-tab timer throttling can't skew it.
  const perSecond = sightings / (30 * 86400);
  const opened = useRef(Date.now());
  const [sinceOpen, setSinceOpen] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(
      () => setSinceOpen(Math.floor(((Date.now() - opened.current) / 1000) * perSecond)),
      500
    );
    return () => clearInterval(id);
  }, [reduced, perSecond]);

  const gapSeconds = 1 / perSecond;
  const gapText =
    gapSeconds < 1 ? `${gapSeconds.toFixed(1)} seconds` : `${Math.round(gapSeconds)} seconds`;
  const show = (n) => fmt(Math.round(n * progress));

  return (
    <section className="ledger-line" aria-label="Thirty-day surveillance volume" ref={ref}>
      <h2 className="ledger-eyebrow">The 30-day ledger</h2>
      <div className="ledger-figures">
        <div className="ledger-figure ledger-hero">
          <span className="ledger-num">{show(sightings)}</span>
          <span className="ledger-label">vehicle sightings logged</span>
        </div>
        <div className="ledger-figure">
          <span className="ledger-num">≈{show(perDay)}</span>
          <span className="ledger-label">sightings a day</span>
        </div>
        <div className="ledger-figure">
          <span className="ledger-num">{show(searches)}</span>
          <span className="ledger-label">police searches against them</span>
        </div>
      </div>
      <p className="ledger-pace">
        At that pace, another plate is logged about every {gapText}
        {!reduced && sinceOpen >= 1 && (
          <>
            {" "}
            — ≈<span className="ledger-pace-count">{fmt(sinceOpen)}</span> since you opened this
            page
          </>
        )}
        .
      </p>
      <p className="ledger-kicker">
        That is the past 30 days from just the <strong>{publisherCount}</strong> Wisconsin
        agencies that publish usage data. The other <strong>{silentCount}</strong> agencies in
        the sharing network disclose nothing, so the true totals are higher.
      </p>
    </section>
  );
}
