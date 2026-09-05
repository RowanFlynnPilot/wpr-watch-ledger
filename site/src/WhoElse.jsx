import React from "react";

// Roster entities that aren't police or sheriff's offices, plus the private
// operators volunteers have tagged on mapped cameras. Pattern-based grouping with
// explicit overrides for today's known cases; anything new lands in "Other" so it
// is never silently hidden.
const LE_PATTERN = /\b(pd|so|police|sheriffs?|patrol|dtf|marshal)\b/;
const BARE_MUNIS = new Set(["dodgeville", "richfield", "somers", "lomira", "maxville", "nelson"]);

const GROUPS = [
  {
    label: "Private & institutional",
    blurb: "Retailers, universities and tribal gaming that police sharing lists name as partners",
    test: (n) => /gaming|casino|\bbid\b|university|college|parking|farm and fleet|commons/.test(n),
  },
  {
    label: "Municipal & county government",
    blurb: "Towns, villages and highway departments holding cameras or permits in their own name",
    test: (n, c) => /^(city|town|village) of /.test(n) || /\b(co\.?|county) hwy|highway/.test(n) || BARE_MUNIS.has(c),
  },
  {
    label: "Law-enforcement support & state agencies",
    blurb: "Dispatch centers, prosecutors and state bodies with access to the network",
    test: (n) => /communications|joint services|department of justice|da'?s office|district attorney|dtf|task force/.test(n),
  },
];

const fmt = (n) => n.toLocaleString("en-US");

// Compact metric chips instead of a sentence per row; the full wording sits in the title.
function chips(a) {
  const out = [];
  if (a.network_mentions > 0)
    out.push({ n: a.network_mentions, unit: a.network_mentions === 1 ? "list" : "lists", title: `Named in ${fmt(a.network_mentions)} ${a.network_mentions === 1 ? "agency's" : "agencies'"} Flock sharing lists` });
  if (a.usatoday?.searches > 0)
    out.push({ n: a.usatoday.searches, unit: "searches", title: `${fmt(a.usatoday.searches)} searches on record with USA TODAY, 2023–2026`, cls: "chip-usat" });
  if (a.wisdot)
    out.push({ n: a.wisdot.cameras, unit: a.wisdot.cameras === 1 ? "hwy cam" : "hwy cams", title: `${fmt(a.wisdot.cameras)} camera${a.wisdot.cameras === 1 ? "" : "s"} permitted on state highways (WisDOT)` });
  if (a.osm_cameras > 0)
    out.push({ n: a.osm_cameras, unit: "mapped", title: `${fmt(a.osm_cameras)} camera${a.osm_cameras === 1 ? "" : "s"} tagged with this operator by volunteers` });
  if (a.atlas)
    out.push({ n: null, unit: "Atlas", title: "Documented in EFF's Atlas of Surveillance" });
  if (a.portal)
    out.push({ n: null, unit: "portal", title: "Publishes a Flock transparency portal", cls: "chip-portal" });
  return out;
}

const Chips = ({ items }) => (
  <span className="we-chips">
    {items.map((c, i) => (
      <span className={`we-chip${c.cls ? ` ${c.cls}` : ""}`} key={i} title={c.title}>
        {c.n != null && <strong>{fmt(c.n)}</strong>}{c.n != null ? " " : ""}{c.unit}
      </span>
    ))}
  </span>
);

export default function WhoElse({ agencies, operators }) {
  const nonPolice = agencies.filter((a) => !LE_PATTERN.test(a.canonical));
  const grouped = GROUPS.map((g) => ({
    label: g.label,
    blurb: g.blurb,
    members: nonPolice.filter((a) => g.test(a.name.toLowerCase(), a.canonical)),
  }));
  const claimed = new Set(grouped.flatMap((g) => g.members.map((a) => a.canonical)));
  const other = nonPolice.filter((a) => !claimed.has(a.canonical));
  if (other.length) grouped.push({ label: "Other", blurb: "Documented, but fitting none of the groups above", members: other });
  const weight = (a) => (a.network_mentions || 0) * 10 + (a.usatoday?.searches || 0) / 100 + (a.wisdot?.cameras || 0) + (a.osm_cameras || 0);

  return (
    <div className="who-else">
      {grouped.filter((g) => g.members.length > 0).map((g) => (
        <div key={g.label} className="who-else-group">
          <h3>{g.label} <span className="we-count">{g.members.length}</span></h3>
          {g.blurb && <p className="we-blurb">{g.blurb}</p>}
          <ul>
            {g.members
              .sort((x, y) => weight(y) - weight(x))
              .map((a) => (
                <li key={a.canonical} className="we-row">
                  <span className="who-else-name">{a.name}</span>
                  <Chips items={chips(a)} />
                </li>
              ))}
          </ul>
        </div>
      ))}
      {operators.length > 0 && (
        <div className="who-else-group">
          <h3>Other operators on the volunteer map <span className="we-count">{operators.length}</span></h3>
          <p className="we-blurb">Names exactly as volunteers tagged them on OpenStreetMap; none matched a roster agency</p>
          <ul>
            {operators.map((o) => (
              <li key={o.operator} className="we-row">
                <span className="who-else-name">{o.operator}</span>
                <Chips items={[{ n: o.cameras, unit: "mapped", title: `${fmt(o.cameras)} camera${o.cameras === 1 ? "" : "s"} tagged with this operator by volunteers` }]} />
              </li>
            ))}
          </ul>
          <p className="who-else-note">
            Typos and joint tags included. These cameras appear on the map above; most are
            retailers, hospitals and resorts running their own readers.
          </p>
        </div>
      )}
    </div>
  );
}
