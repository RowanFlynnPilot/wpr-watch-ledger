import React, { useEffect, useMemo, useState } from "react";
import CameraMap from "./CameraMap.jsx";
import AgencyTable from "./AgencyTable.jsx";
import SharingList from "./SharingList.jsx";

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all(
      ["meta", "cameras", "agencies", "history", "edges"].map((f) =>
        fetch(`${import.meta.env.BASE_URL}data/${f}.json`).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${f}.json (${r.status})`);
          return r.json();
        })
      )
    )
      .then(([meta, cameras, agencies, history, edges]) =>
        setData({ meta, cameras, agencies: agencies.agencies, history, edges: edges.edges })
      )
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="load-error">Data failed to load: {error}. Refresh to try again.</div>;
  if (!data) return <div className="loading">Loading the ledger…</div>;

  const { meta, cameras, agencies, history, edges } = data;

  // Week-over-week search deltas from the last two history snapshots.
  // Null until two snapshots exist; per-agency null when either week lacks a figure.
  let searchDeltas = null;
  if (history.snapshots.length >= 2) {
    const [prev, latest] = history.snapshots.slice(-2);
    searchDeltas = {};
    for (const [key, stats] of Object.entries(latest.portals)) {
      const before = prev.portals[key];
      if (before && stats.searches_30d != null && before.searches_30d != null) {
        searchDeltas[key] = stats.searches_30d - before.searches_30d;
      }
    }
  }

  const inNetwork = agencies.filter((a) => a.in_network);
  const withPortal = agencies.filter((a) => a.portal);

  // 30-day activity totals across the agencies that publish a portal. These cover
  // ONLY the publishers — the real statewide totals are higher, and the copy says so.
  const sightings30d = withPortal.reduce((n, a) => n + (a.portal.vehicles_captured_30d || 0), 0);
  const searches30d = withPortal.reduce((n, a) => n + (a.portal.searches_30d || 0), 0);
  const perDay = Math.round(sightings30d / 30);
  const silentCount = inNetwork.length - withPortal.length;
  const dropped = agencies.filter((a) => a.status.value === "dropped");
  const marathon = agencies.filter((a) => a.county === "Marathon County");
  const updated = new Date(meta.generated).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">A Wausau Pilot &amp; Review data project</p>
        <h1>The Watch Ledger</h1>
        <p className="dek">
          Automated license plate readers photograph every passing vehicle and log it in databases
          searchable by police statewide. This ledger tracks every community-mapped camera in
          Wisconsin, every agency in the Flock Safety network, and — critically — which agencies
          let the public see how the system is used.
        </p>
        <p className="updated">Data refreshed {updated}</p>
      </header>

      <section className="stat-strip" aria-label="Key figures">
        <div className="stat"><span className="stat-num">{fmt(cameras.count)}</span><span className="stat-label">ALPR cameras mapped in Wisconsin</span></div>
        <div className="stat"><span className="stat-num">{fmt(cameras.flock_count)}</span><span className="stat-label">made by Flock Safety</span></div>
        <div className="stat"><span className="stat-num">{fmt(inNetwork.length)}</span><span className="stat-label">agencies in the Flock sharing network</span></div>
        <div className="stat"><span className="stat-num">{fmt(dropped.length)}</span><span className="stat-label">agencies have dropped Flock</span></div>
      </section>

      {sightings30d > 0 && (
        <section className="ledger-line" aria-label="Thirty-day surveillance volume">
          <h2 className="ledger-eyebrow">The 30-day ledger</h2>
          <div className="ledger-figures">
            <div className="ledger-figure">
              <span className="ledger-num">{fmt(sightings30d)}</span>
              <span className="ledger-label">vehicle sightings logged</span>
            </div>
            <div className="ledger-figure">
              <span className="ledger-num">≈{fmt(perDay)}</span>
              <span className="ledger-label">every day</span>
            </div>
            <div className="ledger-figure">
              <span className="ledger-num">{fmt(searches30d)}</span>
              <span className="ledger-label">police searches against them</span>
            </div>
          </div>
          <p className="ledger-kicker">
            That is the past 30 days from just the <strong>{withPortal.length}</strong> Wisconsin
            agencies that publish usage data. The other <strong>{silentCount}</strong> agencies in
            the sharing network disclose nothing, so the true totals are higher.
          </p>
        </section>
      )}

      <section className="gap" aria-label="Transparency gap">
        <h2>The transparency gap</h2>
        <p className="gap-line">
          Of the <strong>{inNetwork.length}</strong> Wisconsin agencies participating in Flock's
          data-sharing network, only <strong>{withPortal.length}</strong> publish a public
          transparency portal showing how they use it.
        </p>
        <div className="gap-bar" role="img" aria-label={`${withPortal.length} of ${inNetwork.length} network agencies publish a transparency portal`}>
          {inNetwork.map((a) => (
            <span key={a.canonical} className={a.portal ? "tick filled" : "tick"} title={a.name} />
          ))}
        </div>
        <p className="gap-caption">Each mark is one agency. Filled marks publish their usage data.</p>
      </section>

      <section className="map-section" aria-label="Camera map">
        <h2>Every mapped camera</h2>
        <CameraMap cameras={cameras.cameras} />
        <div className="map-legend">
          <span className="legend-item"><span className="legend-dot legend-flock" aria-hidden="true" />Flock Safety</span>
          <span className="legend-item"><span className="legend-dot legend-other" aria-hidden="true" />Other ALPR vendors</span>
        </div>
        <p className="map-caption">
          Locations are community-reported by volunteers to OpenStreetMap via the DeFlock project
          and are incomplete — the true number of cameras is higher.
        </p>
      </section>

      <section className="spotlight" aria-label="Marathon County">
        <h2>Marathon County</h2>
        <div className="spotlight-cards">
          {marathon.map((a) => (
            <article key={a.canonical} className="card">
              <h3>{a.name}</h3>
              <p className="card-status">
                <span className={`badge badge-${a.status.value}`}>{a.status.value}</span>
                {a.status.as_of && <span className="asof"> as of {a.status.as_of}</span>}
              </p>
              {a.status.note && <p className="card-note">{a.status.note}</p>}
              <p className="card-facts">
                {a.portal
                  ? `Publishes a transparency portal · ${fmt(a.portal.cameras)} cameras · ${fmt(a.portal.searches_30d)} searches in 30 days`
                  : "Does not publish a Flock transparency portal"}
                {a.network_mentions > 0 && ` · named in ${a.network_mentions} other agencies' sharing lists`}
              </p>
              {a.status.source && (
                <a className="card-source" href={a.status.source} target="_blank" rel="noreferrer">Source</a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="roster" aria-label="Agency roster">
        <h2>The agency roster</h2>
        <p className="roster-dek">
          Every Wisconsin agency documented using ALPRs or appearing in the Flock network's
          data-sharing lists. Camera and search figures come from each agency's own transparency
          portal; a dash means the agency publishes nothing.
        </p>
        <AgencyTable agencies={agencies} searchDeltas={searchDeltas} />
      </section>

      <section className="sharing" aria-label="Who shares with whom">
        <h2>Who shares with whom</h2>
        <p className="sharing-dek">
          Agencies that publish a transparency portal also disclose which other agencies can
          search their camera data. These are the Wisconsin partners each portal currently
          lists — out-of-state partners are not shown.
        </p>
        <SharingList agencies={agencies} edges={edges} />
      </section>

      <footer className="methodology">
        <h2>Methodology &amp; sources</h2>
        <p>{meta.attribution.cameras}.</p>
        <p>{meta.attribution.portals}.</p>
        <p>{meta.attribution.atlas}.</p>
        <p>
          Contract status for {meta.curated_count} agencies is hand-verified against published
          reporting, linked per row. All other statuses are derived automatically: an agency is
          marked active if it publishes a live portal or currently appears in other agencies'
          sharing lists, and unverified otherwise. Data refreshes weekly. Corrections:{" "}
          <a href="https://wausaupilotandreview.com">contact the newsroom</a>.
          {/* TODO(rowan): point this at the real corrections contact */}
        </p>
        <p>
          This ledger holds itself to the standard it asks of police agencies: every dataset
          behind this page — agencies, cameras, sharing edges, and weekly history snapshots —
          is <a href="https://github.com/RowanFlynnPilot/wpr-watch-ledger/tree/main/data">public
          and versioned on GitHub</a>, refreshed every Monday.
        </p>
      </footer>
    </div>
  );
}
