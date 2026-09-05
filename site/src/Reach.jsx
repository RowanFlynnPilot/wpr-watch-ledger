import React, { useState } from "react";

const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia" };
const HOME = "Marathon County";

// How far the data travels: the portals that disclose which agencies can search
// THEIR cameras (the inbound list), split Wisconsin vs out-of-state. Most portals
// publish only the outbound list, so this is the minority that show the full reach.

const fmt = (n) => n.toLocaleString("en-US");

export default function Reach({ agencies }) {
  const [open, setOpen] = useState(null);
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
        <div className="reach-row reach-head" aria-hidden="true">
          <span />
          <span />
          <span className="reach-figs">
            <span>can search</span><span>out of state</span><span>states</span>
          </span>
        </div>
        {shown.map((a) => {
          const r = a.portal.reach.received;
          const isOpen = open === a.canonical;
          const outStates = r.states.filter((s) => s !== "WI");
          return (
            <React.Fragment key={a.canonical}>
              <button
                type="button"
                className={`reach-row${a.county === HOME ? " reach-home" : ""}${isOpen ? " open" : ""}`}
                onClick={() => setOpen(isOpen ? null : a.canonical)}
                aria-expanded={isOpen}
                title={isOpen ? "Hide the states" : `Show the ${outStates.length} states`}
              >
                <span className="reach-name">
                  {a.name}
                  {a.status.value === "dropped" && <span className="badge badge-dropped">dropped</span>}
                  {a.ice_287g && <span className="flag flag-ice" title={`ICE 287(g): ${a.ice_287g.models.join(" + ")}`}>287(g)</span>}
                </span>
                <span
                  className="reach-bar"
                  role="img"
                  aria-label={`${a.name}: searchable by ${fmt(r.total)} agencies, ${fmt(r.out_of_state)} out of state, in ${outStates.length} states`}
                >
                  <span className="reach-wi" style={{ width: `${(100 * r.wi) / max}%` }} />
                  <span className="reach-out" style={{ width: `${(100 * r.out_of_state) / max}%` }} />
                </span>
                <span className="reach-figs">
                  <span>{fmt(r.total)}</span>
                  <span>{fmt(r.out_of_state)}</span>
                  <span>{outStates.length}</span>
                </span>
              </button>
              {isOpen && (
                <div className="reach-states">
                  {outStates.length === 0
                    ? "Every agency on the inbound list is in Wisconsin."
                    : outStates.map((s) => (
                        <span className="state-chip" key={s} title={STATE_NAMES[s] || s}>{s}</span>
                      ))}
                </div>
              )}
            </React.Fragment>
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
