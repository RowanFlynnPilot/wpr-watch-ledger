import React from "react";

// How far the data travels: the portals that disclose which agencies can search
// THEIR cameras (the inbound list), split Wisconsin vs out-of-state. Most portals
// publish only the outbound list, so this is the minority that show the full reach.

const fmt = (n) => n.toLocaleString("en-US");

export default function Reach({ agencies }) {
  const withPortal = agencies.filter((a) => a.portal);
  const disclosing = withPortal
    .filter((a) => a.portal.reach && a.portal.reach.received)
    .sort((x, y) => y.portal.reach.received.total - x.portal.reach.received.total);
  if (disclosing.length === 0) return null;
  const SHOW = 16;
  const shown = disclosing.slice(0, SHOW);
  const rest = disclosing.slice(SHOW);
  const max = disclosing[0].portal.reach.received.total;
  const top = disclosing[0];
  const outboundOutOfState = withPortal.filter((a) => a.portal.reach?.shared && a.portal.reach.shared.out_of_state > 0);
  const states = new Set();
  for (const a of disclosing) for (const s of a.portal.reach.received.states) states.add(s);

  return (
    <section className="reach" aria-label="How far the data travels">
      <h2>How far the data travels</h2>
      <p className="reach-dek">
        A sharing list runs both ways. {disclosing.length} of the {withPortal.length} Wisconsin
        portals also disclose the <em>inbound</em> side: every agency, anywhere in the country,
        whose searches can reach their cameras. <strong>{top.name}</strong> tops the list at{" "}
        <strong>{fmt(top.portal.reach.received.total)}</strong> agencies,{" "}
        {fmt(top.portal.reach.received.out_of_state)} of them outside Wisconsin. Across the{" "}
        {disclosing.length}, the inbound lists name agencies in {states.size} states.
      </p>
      <div className="reach-key" aria-hidden="true">
        <span className="reach-key-item"><span className="reach-swatch reach-wi" /> Wisconsin agencies</span>
        <span className="reach-key-item"><span className="reach-swatch reach-out" /> Out-of-state agencies</span>
      </div>
      <div className="reach-rows">
        {shown.map((a) => {
          const r = a.portal.reach.received;
          return (
            <div className="reach-row" key={a.canonical}>
              <span className="reach-name">
                {a.name}
                {a.status.value === "dropped" && <span className="badge badge-dropped">dropped</span>}
              </span>
              <div>
                <div
                  className="reach-bar"
                  role="img"
                  aria-label={`${a.name}: searchable by ${fmt(r.total)} agencies, ${fmt(r.out_of_state)} out of state, in ${r.states.length} states`}
                >
                  <span className="reach-wi" style={{ width: `${(100 * r.wi) / max}%` }} />
                  <span className="reach-out" style={{ width: `${(100 * r.out_of_state) / max}%` }} />
                </div>
                <span className="reach-fact">
                  {fmt(r.total)} agencies can search · {fmt(r.out_of_state)} out of state · {r.states.length} states
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <p className="reach-rest">
          Also disclosing, in the roster below:{" "}
          {rest.map((a, i) => `${a.name} (${fmt(a.portal.reach.received.total)})`).join(", ")}.
        </p>
      )}
      <p className="gap-caption">
        The other {withPortal.length - disclosing.length} portals publish only whom they share
        with, not who can reach them. Outbound, {outboundOutOfState.length} of the{" "}
        {withPortal.length} portals list at least one out-of-state partner. Flock's own demo and
        deactivated placeholder entries are excluded from every count.
      </p>
    </section>
  );
}
