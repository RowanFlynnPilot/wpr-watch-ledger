import React from "react";

// Marathon County: the newsroom's home county. The agencies that publish a
// portal or carry a hand-verified status get a full card with a stat grid, the
// curated note and any USA TODAY flag; the rest sit in a compact strip below.

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));

function Stat({ num, label, title }) {
  if (num == null) return null;
  return (
    <div className="cstat" title={title}>
      <span className="cstat-num">{fmt(num)}</span>
      <span className="cstat-label">{label}</span>
    </div>
  );
}

function Card({ a, usat }) {
  const p = a.portal;
  const flagged = a.usatoday?.flagged_rows > 0 ? a.usatoday.flagged[0] : null;
  const years = usat ? `${usat.coverage.first_seen.slice(0, 4)}–${usat.coverage.last_seen.slice(0, 4)}` : "";
  return (
    <article className={`card card-spot${a.status.value === "dropped" ? " card-dropped" : ""}`}>
      <header className="card-head">
        <h3>{a.name}</h3>
        <p className="card-status">
          <span className={`badge badge-${a.status.value}`}>{a.status.value === "unknown" ? "unverified" : a.status.value}</span>
          {a.status.as_of && <span className="asof"> as of {a.status.as_of}</span>}
        </p>
      </header>
      <p className={`card-tier${p ? (p.public_search_audit ? " tier-audit" : " tier-portal") : " tier-none"}`}>
        {p
          ? p.public_search_audit
            ? "Publishes usage data and a search audit log"
            : "Publishes a transparency portal"
          : "Publishes no transparency portal"}
        {p?.hand_read && " · read by hand, not indexed by Eyes On Flock"}
      </p>
      <div className="cstats">
        <Stat num={p?.cameras} label="cameras" title="Cameras reported on the agency's portal" />
        <Stat num={p?.searches_30d} label="searches, 30 days" title="Search sessions in the last 30 days, per the portal" />
        <Stat num={p?.shared_with_count} label="agencies it shares with" title="Agencies granted access to this agency's cameras" />
        <Stat num={p?.reach?.received?.total} label="agencies that can search it" title="Agencies whose searches can reach these cameras" />
        <Stat num={a.usatoday?.searches} label={`searches on record, ${years}`} title="Individual searches in Flock audit logs obtained by USA TODAY" />
        <Stat num={a.wisdot?.cameras} label="highway cameras permitted" title="WisDOT right-of-way permits" />
        <Stat num={a.osm_cameras || null} label="cameras mapped by volunteers" title="OpenStreetMap cameras tagged with this operator" />
        <Stat num={a.network_mentions || null} label="sharing lists naming it" title="Other agencies' Flock sharing lists that name this agency" />
      </div>
      {a.status.note && <p className="card-note">{a.status.note}</p>}
      {flagged && (
        <p className="card-flag">
          <strong>{a.usatoday.flagged_rows}</strong> of the nation's 5,000 highest-frequency plate searches in
          USA TODAY's records, across {a.usatoday.flagged_users} user{a.usatoday.flagged_users === 1 ? "" : "s"}:
          one plate searched <strong>{fmt(flagged.count)}</strong> times over {flagged.days_active} days
          (stated reason: {flagged.reasons.slice(0, 2).join(", ").toLowerCase() || "none given"}).
          USA TODAY notes a high score is not an accusation of wrongdoing.
        </p>
      )}
      <p className="card-links">
        {p && (
          <a href={p.portal_url} target="_blank" rel="noreferrer">Transparency portal ↗</a>
        )}
        {a.status.source && !a.status.derived && (
          <a href={a.status.source} target="_blank" rel="noreferrer">Reporting ↗</a>
        )}
        {a.usatoday && (
          <a href="https://data.usatoday.com/projects/flock-search/" target="_blank" rel="noreferrer">USA TODAY records ↗</a>
        )}
      </p>
    </article>
  );
}

export default function Spotlight({ agencies, usat }) {
  const featured = agencies.filter((a) => a.portal || !a.status.derived);
  const rest = agencies.filter((a) => !featured.includes(a));
  return (
    <section className="spotlight" aria-label="Marathon County">
      <h2>Marathon County</h2>
      <div className="spotlight-cards">
        {featured.map((a) => <Card key={a.canonical} a={a} usat={usat} />)}
      </div>
      {rest.length > 0 && (
        <div className="spotlight-rest">
          <h3>Also in the county</h3>
          <ul>
            {rest.map((a) => (
              <li key={a.canonical}>
                <span className="who-else-name">{a.name}</span>
                <span className="who-else-facts">
                  {" — "}
                  {[
                    a.status.value === "dropped" ? "announced dropping Flock" : null,
                    a.usatoday?.searches > 0 ? `${fmt(a.usatoday.searches)} searches on record` : null,
                    a.wisdot ? `${fmt(a.wisdot.cameras)} highway camera${a.wisdot.cameras === 1 ? "" : "s"} permitted` : null,
                    a.osm_cameras > 0 ? `${fmt(a.osm_cameras)} mapped by volunteers` : null,
                    a.network_mentions > 0 ? `named in ${fmt(a.network_mentions)} sharing list${a.network_mentions === 1 ? "" : "s"}` : null,
                  ].filter(Boolean).join(" · ") || "documented in the roster"}
                  {" · publishes no portal"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
