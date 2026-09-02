import React, { useEffect, useState } from "react";
import CameraMap from "./CameraMap.jsx";
import AgencyTable from "./AgencyTable.jsx";
import SharingList from "./SharingList.jsx";
import CountyTable from "./CountyTable.jsx";
import WhoElse from "./WhoElse.jsx";
import SharingGraph from "./SharingGraph.jsx";
import LedgerBand from "./LedgerBand.jsx";
import Trend from "./Trend.jsx";
import Reach from "./Reach.jsx";
import PermitTimeline from "./PermitTimeline.jsx";

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all(
      ["meta", "cameras", "agencies", "history", "edges", "wisdot_permits", "counties"].map((f) =>
        fetch(`${import.meta.env.BASE_URL}data/${f}.json`).then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${f}.json (${r.status})`);
          return r.json();
        })
      )
    )
      .then(([meta, cameras, agencies, history, edges, wisdot, counties]) =>
        setData({
          meta, cameras, agencies: agencies.agencies, operators: agencies.unmatched_operators || [],
          history, edges: edges.edges, wisdot, counties,
        })
      )
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="load-error">Data failed to load: {error}. Refresh to try again.</div>;
  if (!data) return <div className="loading">Loading the ledger…</div>;

  const { meta, cameras, agencies, operators, history, edges, wisdot, counties } = data;
  const coveredPct = Math.round((100 * counties.covered_population) / counties.state_population);
  const staleThreshold = meta.stale_days_threshold ?? 45;
  const isStale = (a) => a.portal?.stale_days != null && a.portal.stale_days > staleThreshold;

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
  const withAudit = withPortal.filter((a) => a.portal.public_search_audit);
  const stalePortals = withPortal.filter(isStale);
  const livePortals = withPortal.filter((a) => !isStale(a));

  // 30-day activity totals across the agencies whose portals are current. These cover
  // ONLY the publishers — the real statewide totals are higher, and the copy says so.
  const sightings30d = livePortals.reduce((n, a) => n + (a.portal.vehicles_captured_30d || 0), 0);
  const searches30d = livePortals.reduce((n, a) => n + (a.portal.searches_30d || 0), 0);
  const hits30d = livePortals.reduce((n, a) => n + (a.portal.hotlist_hits_30d || 0), 0);
  const perDay = Math.round(sightings30d / 30);
  const silentCount = inNetwork.length - withPortal.length;
  const dropped = agencies.filter((a) => a.status.value === "dropped");
  const droppedSince = new Date(
    Math.min(...dropped.map((a) => new Date(a.status.as_of || Date.now()).getTime()))
  ).toLocaleDateString("en-US", { year: "numeric", month: "long", timeZone: "UTC" });
  const marathon = agencies.filter((a) => a.county === "Marathon County");
  const mappedAttributed = agencies.reduce((n, a) => n + (a.osm_cameras || 0), 0);
  // UTC, so the masthead date always agrees with the snapshot dates in the charts.
  const updated = new Date(meta.generated).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });

  const tickClass = (a) =>
    `tick${a.portal ? " filled" : ""}${a.portal?.public_search_audit ? " audit" : ""}${a.status.value === "dropped" ? " tick-dropped" : ""}`;
  const tickTitle = (a) =>
    `${a.name}${a.portal ? (a.portal.public_search_audit ? " — publishes usage data and a search audit log" : " — publishes usage data") : " — discloses nothing"}${a.status.value === "dropped" ? " · announced dropping Flock" : ""}`;

  return (
    <div className="page">
      <header className="masthead">
        <a className="brand" href="https://wausaupilotandreview.com" target="_blank" rel="noreferrer">
          <span
            className="brand-badge"
            aria-hidden="true"
            style={{ backgroundImage: `url(${import.meta.env.BASE_URL}wpr-badge.jpg)` }}
          />
          <span className="brand-wordmark">
            Wausau Pilot <span className="amp">&amp;</span> Review
          </span>
        </a>
        <div className="rule-double" aria-hidden="true" />
        <p className="eyebrow">A newsroom data project</p>
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
        <div className="stat">
          <span className="stat-num">{fmt(cameras.count)}</span>
          <span className="stat-label">ALPR cameras mapped by volunteers</span>
          <span className="stat-sub">{fmt(cameras.flock_count)} made by Flock Safety</span>
        </div>
        <div className="stat">
          <span className="stat-num">{fmt(wisdot.camera_count)}</span>
          <span className="stat-label">cameras permitted on state highways</span>
          <span className="stat-sub">WisDOT records · {fmt(agencies.filter((a) => a.wisdot).length)} agencies</span>
        </div>
        <div className="stat">
          <span className="stat-num">{fmt(inNetwork.length)}</span>
          <span className="stat-label">agencies in the Flock sharing network</span>
          <span className="stat-sub">only {fmt(withPortal.length)} publish usage data · {fmt(withAudit.length)} a search log</span>
        </div>
        <div className="stat stat-dropped">
          <span className="stat-num">{fmt(dropped.length)}</span>
          <span className="stat-label">agencies have dropped Flock</span>
          <span className="stat-sub">all since {droppedSince}</span>
        </div>
      </section>

      {sightings30d > 0 && (
        <LedgerBand
          sightings={sightings30d}
          perDay={Math.round(perDay / 100) * 100}
          searches={searches30d}
          hits={hits30d}
          publisherCount={livePortals.length}
          silentCount={silentCount}
          stale={stalePortals}
          staleThreshold={staleThreshold}
        />
      )}

      <Trend history={history} agencies={agencies} />

      <section className="gap" aria-label="Transparency gap">
        <h2>The transparency gap</h2>
        <p className="gap-line">
          Of the <strong>{inNetwork.length}</strong> Wisconsin agencies participating in Flock's
          data-sharing network, only <strong>{withPortal.length}</strong> publish a public
          transparency portal showing how they use it — and just{" "}
          <strong>{withAudit.length}</strong> go further and publish a log of every search run
          against their cameras.
        </p>
        <p className="gap-line">
          Agencies in the network operate in <strong>{counties.covered_counties}</strong> of
          Wisconsin's 72 counties — home to <strong>{coveredPct}%</strong> of the state's{" "}
          {fmt(counties.state_population)} residents.
        </p>
        <div className="gap-key" aria-hidden="true">
          <span className="gap-key-item">
            <span className="tick filled audit key-swatch" /> {withAudit.length} publish usage data and a search audit log
          </span>
          <span className="gap-key-item">
            <span className="tick filled key-swatch" /> {withPortal.length - withAudit.length} publish usage data only
          </span>
          <span className="gap-key-item">
            <span className="tick key-swatch" /> {inNetwork.length - withPortal.length} disclose nothing
          </span>
          <span className="gap-key-item">
            <span className="tick tick-dropped key-swatch" />{" "}
            {inNetwork.filter((a) => a.status.value === "dropped").length} outlined in rust have
            announced dropping Flock
          </span>
        </div>
        <div
          className="gap-bar"
          role="img"
          aria-label={`${withPortal.length} of ${inNetwork.length} network agencies publish a transparency portal, ${withAudit.length} of those also publish a search audit log; ${inNetwork.filter((a) => a.status.value === "dropped").length} have announced dropping Flock`}
        >
          {inNetwork.map((a) => (
            <span key={a.canonical} className={tickClass(a)} title={tickTitle(a)} />
          ))}
        </div>
        <p className="gap-caption">
          Each mark is one agency — {withPortal.length} of {inNetwork.length} (
          {Math.round((100 * withPortal.length) / inNetwork.length)}%) let the public see how
          the system is used; {withAudit.length} ({Math.round((100 * withAudit.length) / inNetwork.length)}%)
          let the public see each individual search.
        </p>
        {meta.national && (
          <p className="gap-line gap-national">
            For national context: Wisconsin's {meta.national.wi_portal_count} transparency
            portals rank <strong>#{meta.national.wi_rank_by_portals}</strong> among the{" "}
            {meta.national.states_with_portals} states where any agency publishes one
            ({meta.national.us_portal_count.toLocaleString("en-US")} portals nationwide).
          </p>
        )}
      </section>

      <section className="map-section" aria-label="Camera map">
        <h2>Every mapped camera</h2>
        <CameraMap cameras={cameras.cameras} wisdotCameras={wisdot.cameras} />
        <p className="map-caption">
          Dots are community-reported by volunteers to OpenStreetMap via the DeFlock project and
          are incomplete — the true number of cameras is higher. Rings are official: cameras
          permitted by the Wisconsin DOT on state-highway right-of-way, from records released
          under the state Open Records Law. A ring with no dot inside it is a camera the
          volunteers haven't found yet. Volunteers tagged an operator on{" "}
          {fmt(cameras.cameras.filter((c) => c.operator).length)} of the dots; {fmt(mappedAttributed)}{" "}
          of those resolve to a roster agency and show in its "Mapped" column below.
        </p>
        {meta.wisdot_permits_by_year && (
          <PermitTimeline byYear={meta.wisdot_permits_by_year} snapshotDate={wisdot.snapshot_date} />
        )}
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
                  ? `Publishes a transparency portal${a.portal.hand_read ? " (not indexed by Eyes On Flock)" : ""} · ${fmt(a.portal.cameras)} cameras · ${fmt(a.portal.searches_30d)} searches in 30 days · shares with ${fmt(a.portal.shared_with_count)} agencies`
                  : "Does not publish a Flock transparency portal"}
                {a.wisdot && ` · ${fmt(a.wisdot.cameras)} highway cameras permitted`}
                {a.osm_cameras > 0 && ` · ${fmt(a.osm_cameras)} cameras mapped by volunteers`}
                {a.network_mentions > 0 && ` · named in ${a.network_mentions} other agencies' sharing lists`}
              </p>
              {a.status.source && (
                <a className="card-source" href={a.status.source} target="_blank" rel="noreferrer">Source</a>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="county-rollup" aria-label="County by county">
        <h2>County by county</h2>
        <p className="county-dek">
          Where the cameras, the agencies, and the transparency are — and aren't. Population
          figures are Wisconsin DOA official estimates as of January 1, 2025.
        </p>
        <CountyTable counties={counties.counties} />
        <p className="table-count">
          {counties.unresolved_agencies} statewide or unresolved agencies and{" "}
          {counties.unlocated_cameras} cameras without a usable county are not shown.
        </p>
      </section>

      <section className="roster" aria-label="Agency roster">
        <h2>The agency roster</h2>
        <p className="roster-dek">
          Every Wisconsin agency documented using ALPRs or appearing in the Flock network's
          data-sharing lists. Camera, search, hit-rate and reach figures come from each agency's
          own transparency portal; a dash means the agency publishes nothing. The sparkline is
          the agency's 30-day search count across every weekly snapshot on record.
        </p>
        <AgencyTable agencies={agencies} searchDeltas={searchDeltas} history={history} staleThreshold={staleThreshold} />
      </section>

      <section className="sharing" aria-label="Who shares with whom">
        <h2>Who shares with whom</h2>
        <p className="sharing-dek">
          Agencies that publish a transparency portal also disclose which other agencies can
          search their camera data. These are the Wisconsin partners each portal currently
          lists — out-of-state partners are not shown.
        </p>
        <SharingList agencies={agencies} edges={edges} />
        <h3 className="inner-circle-title">The inner circle</h3>
        <p className="sharing-dek">
          Among the {withPortal.length} agencies transparent enough to publish a portal, who
          names whom as a data-sharing partner:
        </p>
        <SharingGraph agencies={agencies} edges={edges} />
      </section>

      <Reach agencies={agencies} />

      <section className="who-else-section" aria-label="Who else is in the network">
        <h2>Who else is in the network</h2>
        <p className="who-else-dek">
          A plate-reader network is not only police. These entities appear in Wisconsin
          agencies' Flock sharing lists, hold state-highway camera permits of their own, run
          cameras volunteers have mapped, or are otherwise documented operating ALPRs.
        </p>
        <WhoElse agencies={agencies} operators={operators} />
      </section>

      <footer className="methodology">
        <h2>Methodology &amp; sources</h2>
        <p>{meta.attribution.cameras}. Where volunteers tagged an operator, cameras are matched to
          the roster by name; unmatched operators are listed as written, never guessed.</p>
        <p>{meta.attribution.portals}. Flock stamps each portal with the date its figures last
          changed; a portal frozen for more than {staleThreshold} days is flagged in the roster and
          left out of the statewide 30-day totals.
          {meta.hand_read_portal_count > 0 && (
            <>
              {" "}{meta.hand_read_portal_count === 1 ? "One portal" : `${meta.hand_read_portal_count} portals`} that Eyes On
              Flock does not index ({withPortal.filter((a) => a.portal.hand_read).map((a) => a.name).join(", ")}) were
              read by hand from Flock's site; they are marked with an asterisk in the roster and age out of the
              totals on the same {staleThreshold}-day rule unless re-read.
            </>
          )} Inbound reach (who can search an agency's
          cameras) is shown only for portals that publish that list, with Flock's own demo and
          deactivated placeholders removed.</p>
        <p>{meta.attribution.atlas}.</p>
        <p>
          {meta.attribution.wisdot ||
            "State-highway camera permits from Wisconsin DOT records, obtained under the Wisconsin Open Records Law and mapped by Deflock Dane (deflockdane.org)"}
          . Snapshot dated {wisdot.snapshot_date}; refreshed when WisDOT releases new records.
        </p>
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
        <a className="foot-brand" href="https://wausaupilotandreview.com" target="_blank" rel="noreferrer">
          <span>
            <span className="foot-wordmark">
              Wausau Pilot <span className="amp">&amp;</span> Review
            </span>
            <span className="foot-url">wausaupilotandreview.com</span>
          </span>
          <span
            className="brand-badge foot-badge"
            aria-hidden="true"
            style={{ backgroundImage: `url(${import.meta.env.BASE_URL}wpr-badge.jpg)` }}
          />
        </a>
      </footer>
    </div>
  );
}
