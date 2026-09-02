import React from "react";

// "Who shares with whom": per portal agency, an expandable list of the Wisconsin
// agencies it actively shares Flock data with. Plain <details>/<summary>, no libraries.
export default function SharingList({ agencies, edges }) {
  const byCanonical = new Map(agencies.map((a) => [a.canonical, a]));
  const portalAgencies = agencies.filter((a) => a.portal && edges[a.canonical]);

  return (
    <div className="sharing-list">
      {portalAgencies.map((a) => {
        const partners = edges[a.canonical];
        return (
          <details key={a.canonical} className="sharing-row">
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
                  return (
                    <li key={c}>
                      {partner ? partner.name : c}
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
  );
}
