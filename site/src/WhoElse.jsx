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
    test: (n) => /gaming|casino|\bbid\b|university|college|parking|farm and fleet|commons/.test(n),
  },
  {
    label: "Municipal & county government",
    test: (n, c) => /^(city|town|village) of /.test(n) || /\b(co\.?|county) hwy|highway/.test(n) || BARE_MUNIS.has(c),
  },
  {
    label: "Law-enforcement support & state agencies",
    test: (n) => /communications|joint services|department of justice|da'?s office|district attorney|dtf|task force/.test(n),
  },
];

const fmt = (n) => n.toLocaleString("en-US");

function facts(a) {
  const parts = [];
  if (a.network_mentions > 0)
    parts.push(`named in ${fmt(a.network_mentions)} ${a.network_mentions === 1 ? "agency's" : "agencies'"} Flock sharing lists`);
  if (a.wisdot) parts.push(`${fmt(a.wisdot.cameras)} camera${a.wisdot.cameras === 1 ? "" : "s"} permitted on state highways`);
  if (a.osm_cameras > 0) parts.push(`${fmt(a.osm_cameras)} mapped camera${a.osm_cameras === 1 ? "" : "s"} tagged by volunteers`);
  if (a.usatoday?.searches > 0) parts.push(`${fmt(a.usatoday.searches)} searches on record with USA TODAY`);
  if (a.atlas) parts.push("documented in the Atlas of Surveillance");
  return parts.join(" · ");
}

export default function WhoElse({ agencies, operators }) {
  const nonPolice = agencies.filter((a) => !LE_PATTERN.test(a.canonical));
  const grouped = GROUPS.map((g) => ({
    label: g.label,
    members: nonPolice.filter((a) => g.test(a.name.toLowerCase(), a.canonical)),
  }));
  const claimed = new Set(grouped.flatMap((g) => g.members.map((a) => a.canonical)));
  const other = nonPolice.filter((a) => !claimed.has(a.canonical));
  if (other.length) grouped.push({ label: "Other", members: other });

  return (
    <div className="who-else">
      {grouped.filter((g) => g.members.length > 0).map((g) => (
        <div key={g.label} className="who-else-group">
          <h3>{g.label}</h3>
          <ul>
            {g.members
              .sort((x, y) => y.network_mentions - x.network_mentions)
              .map((a) => (
                <li key={a.canonical}>
                  <span className="who-else-name">{a.name}</span>
                  {facts(a) && <span className="who-else-facts"> — {facts(a)}</span>}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {operators.length > 0 && (
        <div className="who-else-group">
          <h3>Other operators on the volunteer map</h3>
          <ul>
            {operators.map((o) => (
              <li key={o.operator}>
                <span className="who-else-name">{o.operator}</span>
                <span className="who-else-facts"> — {fmt(o.cameras)} mapped camera{o.cameras === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
          <p className="who-else-note">
            Operator names exactly as volunteers recorded them on OpenStreetMap, typos and
            joint tags included. These cameras appear on the map above but matched no agency
            in the roster — most are retailers, hospitals and resorts running their own readers.
          </p>
        </div>
      )}
    </div>
  );
}
