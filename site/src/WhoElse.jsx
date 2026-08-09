import React from "react";

// Roster entities that aren't police or sheriff's offices. Pattern-based grouping
// with explicit overrides for today's known cases; anything new lands in "Other"
// so it is never silently hidden.
const LE_PATTERN = /\b(pd|so|police|sheriffs?|patrol|dtf|marshal)\b/;
const BARE_MUNIS = new Set(["dodgeville"]);

const GROUPS = [
  {
    label: "Private & institutional",
    test: (c) => /gaming|casino|\bbid\b|university|college|parking/.test(c),
  },
  {
    label: "Municipal & county government",
    test: (c) => /^(city|town|village) of /.test(c) || /county hwy|highway/.test(c) || BARE_MUNIS.has(c),
  },
  {
    label: "Law-enforcement support & state agencies",
    test: (c) => /communications|joint services|department of justice/.test(c),
  },
];

const fmt = (n) => n.toLocaleString("en-US");

function facts(a) {
  const parts = [];
  if (a.network_mentions > 0)
    parts.push(`named in ${fmt(a.network_mentions)} ${a.network_mentions === 1 ? "agency's" : "agencies'"} Flock sharing lists`);
  if (a.wisdot) parts.push(`${fmt(a.wisdot.cameras)} camera${a.wisdot.cameras === 1 ? "" : "s"} permitted on state highways`);
  if (a.atlas) parts.push("documented in the Atlas of Surveillance");
  return parts.join(" · ");
}

export default function WhoElse({ agencies }) {
  const nonPolice = agencies.filter((a) => !LE_PATTERN.test(a.canonical));
  const grouped = GROUPS.map((g) => ({
    label: g.label,
    members: nonPolice.filter((a) => g.test(a.canonical)),
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
    </div>
  );
}
