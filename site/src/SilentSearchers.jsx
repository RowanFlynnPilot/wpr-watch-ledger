import React from "react";

// The silent searchers: the Wisconsin agencies that ran the most Flock searches in
// the audit logs USA TODAY obtained, marked by whether they publish a portal. The
// cleanest statement of the transparency gap the ledger can make: most of the
// heaviest users disclose nothing.

const fmt = (n) => n.toLocaleString("en-US");
const TOP = 20;

export default function SilentSearchers({ agencies, usat }) {
  const withRecords = agencies.filter((a) => a.usatoday && a.usatoday.searches > 0);
  const ice = withRecords.filter((a) => a.ice_287g);
  const iceSearches = ice.reduce((n, a) => n + a.usatoday.searches, 0);
  if (withRecords.length === 0) return null;
  const ranked = [...withRecords].sort((x, y) => y.usatoday.searches - x.usatoday.searches);
  const top = ranked.slice(0, TOP);
  const max = top[0].usatoday.searches;
  const topSilent = top.filter((a) => !a.portal).length;
  const totalSearches = withRecords.reduce((n, a) => n + a.usatoday.searches, 0);
  const silentSearches = withRecords.filter((a) => !a.portal).reduce((n, a) => n + a.usatoday.searches, 0);
  const silentPct = Math.round((100 * silentSearches) / totalSearches);
  const cov = usat.coverage;
  const yr = (d) => d.slice(0, 4);
  const lead = top[0];

  return (
    <section className="silent" aria-label="The silent searchers">
      <h2>The silent searchers</h2>
      <p className="silent-dek">
        Transparency portals show only what {agencies.filter((a) => a.portal).length} agencies
        choose to publish. Flock's own usage audit logs, obtained under public-records laws by
        USA TODAY, show who actually ran searches: <strong>{fmt(cov.searches)}</strong> in
        Wisconsin between {yr(cov.first_seen)} and {yr(cov.last_seen)}, by {cov.agencies}{" "}
        agencies and {fmt(cov.users)} known users. <strong>{silentPct}%</strong> of those
        searches were run by agencies that publish no portal at all. Of the {TOP} heaviest
        users, <strong>{topSilent}</strong> disclose nothing; <strong>{lead.name}</strong> alone
        ran {fmt(lead.usatoday.searches)}.
        {ice.length > 0 && (
          <>
            {" "}<strong>{ice.length}</strong> of the agencies in these records are sheriff's offices
            with ICE 287(g) agreements; between them they ran {fmt(iceSearches)} searches.
          </>
        )}
      </p>
      <div className="silent-key" aria-hidden="true">
        <span className="silent-key-item"><span className="silent-swatch silent-yes" /> Publishes no transparency portal</span>
        <span className="silent-key-item"><span className="silent-swatch silent-no" /> Publishes a portal</span>
      </div>
      <div className="silent-rows">
        {top.map((a, i) => (
          <div className="silent-row" key={a.canonical}>
            <span className="silent-rank">{i + 1}</span>
            <span className="silent-name">
              {a.name}
              {a.status.value === "dropped" && <span className="badge badge-dropped">dropped</span>}
              {a.ice_287g && <span className="flag flag-ice" title={`ICE 287(g): ${a.ice_287g.models.join(" + ")}`}>287(g)</span>}
            </span>
            <div>
              <span
                className={`silent-bar${a.portal ? " has-portal" : ""}`}
                role="img"
                aria-label={`${a.name}: ${fmt(a.usatoday.searches)} searches on record, ${a.portal ? "publishes a portal" : "publishes no portal"}`}
              >
                <span style={{ width: `${(100 * a.usatoday.searches) / max}%` }} />
              </span>
              <span className="silent-fact">
                {fmt(a.usatoday.searches)} searches
                {a.portal ? " · publishes a portal" : " · no portal"}
                {a.usatoday.flagged_rows > 0 && ` · ${a.usatoday.flagged_rows} high-frequency plate search${a.usatoday.flagged_rows === 1 ? "" : "es"} flagged`}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="gap-caption">
        Cumulative individual searches from audit logs, {cov.first_seen} to {cov.last_seen}; a
        different measure from the portals' 30-day session counts, and an agency's total reflects
        the logs USA TODAY obtained. Flagged rows are among the 5,000 highest-frequency plate
        searches nationally by USA TODAY's score, which the paper says is not an accusation of
        wrongdoing. Every agency's figure is in the roster below.
      </p>
    </section>
  );
}
