import React, { useState } from "react";

// "Who shares with whom": per portal agency, an expandable list of the Wisconsin
// agencies it actively shares Flock data with. Plain <details>/<summary>, no libraries.
export default function SharingList({ agencies, edges }) {
  const [q, setQ] = useState("");
  const byCanonical = new Map(agencies.map((a) => [a.canonical, a]));
  const portalAgencies = agencies.filter((a) => a.portal && edges[a.canonical]);
  const t = q.trim().toLowerCase();
  // Match the portal agency, or any partner it lists: "who shares with Wausau?"
  const shown = portalAgencies.filter(
    (a) => !t || a.name.toLowerCase().includes(t) || edges[a.canonical].some((c) => (byCanonical.get(c)?.name || c).toLowerCase().includes(t))
  );

  return (
    <div className="sharing-wrap">
      <div className="sharing-tools">
        <input
          type="search"
          className="table-search"
          placeholder="Find a portal, or an agency named as a partner…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter sharing lists"
        />
        <span className="table-count">{shown.length} of {portalAgencies.length} portals{t ? " match" : ""}</span>
      </div>
    <div className="sharing-list">
      {shown.map((a) => {
        const partners = edges[a.canonical];
        const hit = t && !a.name.toLowerCase().includes(t);
        return (
          <details key={a.canonical} className="sharing-row" open={hit || undefined}>
            <summary>
              <span className="sharing-name">
                {a.name}
                {a.status.value === "dropped" && <span className="badge badge-dropped">dropped</span>}
              </span>
              <span className="sharing-count">
                {partners.length === 0
                  ? "no Wisconsin partners listed"
                  : `${partners.length} Wisconsin partner${partners.length === 1 ? "" : "s"}`}
              </span>
            </summary>
            {a.portal.prohibited_uses && (
              <p className="sharing-prohibited">
                Self-declared prohibited uses: {a.portal.prohibited_uses}
              </p>
            )}
            {partners.length > 0 && (
              <ul className="sharing-partners">
                {partners.map((c) => {
                  const partner = byCanonical.get(c);
                  const name = partner ? partner.name : c;
                  return (
                    <li key={c} className={hit && name.toLowerCase().includes(t) ? "partner-hit" : undefined}>
                      {name}
                      {partner && partner.status.value === "dropped" && (
                        <span className="badge badge-dropped">dropped</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </details>
        );
      })}
    </div>
    </div>
  );
}
