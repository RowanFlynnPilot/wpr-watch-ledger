import React from "react";

// Methodology & sources: one card per dataset (what it is, who made it, how it is
// used here, how fresh it is), then how statuses are decided, then the standard the
// ledger holds itself to. Every figure here comes from meta, so it cannot drift.

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

function Source({ eyebrow, name, href, cadence, children }) {
  return (
    <article className="src">
      <p className="src-eyebrow">{eyebrow}</p>
      <h3 className="src-name">
        <a href={href} target="_blank" rel="noreferrer">{name} ↗</a>
      </h3>
      <p className="src-cadence">{cadence}</p>
      <p className="src-body">{children}</p>
    </article>
  );
}

export default function Methodology({ meta, wisdot, counties, withPortal, staleThreshold }) {
  const handRead = withPortal.filter((a) => a.portal.hand_read);
  const u = meta.usatoday;
  return (
    <footer className="methodology">
      <h2>Methodology &amp; sources</h2>
      <p className="method-dek">
        Six datasets, none of them the ledger's own. Each is named, linked and dated here, and
        every merged file behind this page is published in full.
      </p>

      <div className="src-grid">
        <Source eyebrow="Camera locations" name="DeFlock community mapping on OpenStreetMap" href="https://deflock.org" cadence="Refreshed weekly · volunteer-reported, incomplete">
          Every node volunteers have tagged as an ALPR in Wisconsin. The true number of cameras is
          higher. Where a volunteer recorded an operator, the camera is matched to the roster by
          name; unmatched operators are listed as written, never guessed.
        </Source>
        <Source eyebrow="Transparency portals" name="Eyes On Flock" href="https://eyesonflock.com" cadence={`Refreshed weekly · stale after ${staleThreshold} days`}>
          Portal figures for every Wisconsin agency Eyes On Flock indexes, plus the sharing lists
          that build the network roster. Flock stamps each portal with the date its figures last
          changed; a portal frozen longer than {staleThreshold} days is flagged and left out of the
          statewide 30-day totals.
          {handRead.length > 0 && (
            <>
              {" "}{handRead.length === 1 ? "One portal" : `${handRead.length} portals`} Eyes On Flock does not
              index ({handRead.map((a) => a.name).join(", ")}) were read by hand from Flock's site, carry an
              asterisk in the roster, and age out on the same rule unless re-read.
            </>
          )}{" "}
          Inbound reach is shown only for portals that publish that list, with Flock's demo and
          deactivated placeholders removed.
        </Source>
        {u && (
          <Source eyebrow="Search records" name="USA TODAY, Flock Safety Records Search" href={u.url} cadence={`Snapshot ${u.retrieved} · covers ${u.coverage.first_seen} to ${u.coverage.last_seen}`}>
            Flock usage audit logs obtained under public-records laws and analyzed by USA TODAY:{" "}
            {fmt(u.coverage.searches)} searches by {u.coverage.agencies} Wisconsin agencies and{" "}
            {fmt(u.coverage.users)} known users. These are individual searches accumulated over the
            whole window, not comparable to the portals' 30-day session counts, and an agency's total
            reflects the logs USA TODAY obtained. Flock withdrew the audit view in December 2025.
            High-frequency flags use USA TODAY's own score, which in their words is not an accusation
            of wrongdoing.
          </Source>
        )}
        <Source eyebrow="Highway permits" name="Wisconsin DOT records, mapped by Deflock Dane" href="https://deflockdane.org/wisdot-alpr-map" cadence={`Snapshot ${wisdot.snapshot_date} · refreshed on each records release`}>
          State-highway right-of-way permits obtained under the Wisconsin Open Records Law. Official,
          and independent of the volunteer map: a ring with no dot inside it is a camera the
          volunteers have not found yet.
        </Source>
        <Source eyebrow="Agency records" name="EFF Atlas of Surveillance" href="https://atlasofsurveillance.org" cadence="Refreshed weekly">
          Sourced records of Wisconsin agencies documented using plate readers, with the formal
          agency names the roster prefers.
        </Source>
        <Source eyebrow="Population" name="Wisconsin Department of Administration estimates" href="https://doa.wi.gov/Pages/LocalGovtsGrants/Population_Estimates.aspx" cadence={`Official estimates as of ${counties.population_as_of}`}>
          County and municipal populations behind the coverage figure and the per-1,000-residents
          column. County spellings are validated against this list on every refresh.
        </Source>
      </div>

      <div className="method-notes">
        <div className="method-note">
          <h3>How a status is decided</h3>
          <p>
            Contract status for {meta.curated_count} agencies is hand-verified against published
            reporting, linked on each row. Every other status is derived: an agency is marked active
            if it publishes a live portal, currently appears in other agencies' sharing lists, or ran
            searches in USA TODAY's records, and unverified otherwise. Hand-verified status always
            wins over a derived one.
          </p>
        </div>
        <div className="method-note">
          <h3>Corrections</h3>
          <p>
            Spot an error, a stale status, or an agency that has dropped Flock?{" "}
            <a href="https://wausaupilotandreview.com">Contact the newsroom</a>. Every correction
            lands in the public overlay file with a source and a date.
            {/* TODO(rowan): point this at the real corrections contact */}
          </p>
        </div>
      </div>

      <p className="method-standard">
        This ledger holds itself to the standard it asks of police agencies: every dataset behind
        this page, agencies, cameras, sharing edges, county rollups and weekly history snapshots, is{" "}
        <a href="https://github.com/RowanFlynnPilot/wpr-watch-ledger/tree/main/data">public and
        versioned on GitHub</a>, refreshed every Monday. Both tables above export to CSV.
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
  );
}
