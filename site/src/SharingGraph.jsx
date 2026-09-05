import React, { useMemo, useState } from "react";

// The inner circle: the portal-publishing agencies arranged on a ring, with a
// chord wherever one names another among its Wisconsin sharing partners.
// Hand-rolled SVG — no graph library. Labels run along their spokes so the ring
// stays legible past ~50 agencies.

const short = (name) =>
  name
    .replace("University of Wisconsin-Madison Police Department", "UW-Madison PD")
    .replace("Concordia University Wisconsin", "Concordia Univ.")
    .replace(" Police Department", " PD")
    .replace(" Sheriff's Office", " SO")
    .replace(" County", " Co.")
    .replace("City of ", "");

const W = 760, H = 700, CX = W / 2, CY = H / 2, R = 205;

// A chord bent gently toward the center: the two agencies stay identifiable at
// the rim while the bundle of lines separates instead of piling through the middle.
const chord = (a, b) => {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const qx = mx + (CX - mx) * 0.45, qy = my + (CY - my) * 0.45;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
};

export default function SharingGraph({ agencies, edges }) {
  const portals = agencies.filter((a) => a.portal);
  const { nodes, links, mutualCount } = useMemo(() => {
    const inRing = new Set(portals.map((p) => p.canonical));
    const idx = new Map(portals.map((p, i) => [p.canonical, i]));
    const n = portals.length;
    const nodes = portals.map((p, i) => {
      const ang = (2 * Math.PI * i) / n - Math.PI / 2;
      const deg = (ang * 180) / Math.PI;
      const partners = (edges[p.canonical] || []).length;
      return {
        i,
        canonical: p.canonical,
        name: p.name,
        partners,
        dropped: p.status.value === "dropped",
        x: CX + R * Math.cos(ang),
        y: CY + R * Math.sin(ang),
        deg,
        flip: Math.cos(ang) < 0,
        r: 2.5 + Math.sqrt(partners) * 0.42,
      };
    });
    const seen = new Set();
    const links = [];
    for (const p of portals) {
      for (const target of edges[p.canonical] || []) {
        if (!inRing.has(target)) continue;
        const a = idx.get(p.canonical), b = idx.get(target);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ a, b, mutual: (edges[target] || []).includes(p.canonical) });
      }
    }
    return { nodes, links, mutualCount: links.filter((l) => l.mutual).length };
  }, [agencies, edges]);

  const [hover, setHover] = useState(null);
  const adjacent =
    hover == null
      ? null
      : new Set(links.filter((l) => l.a === hover || l.b === hover).flatMap((l) => [l.a, l.b]));
  const nodeActive = (i) => adjacent == null || adjacent.has(i) || i === hover;
  const linkActive = (l) => hover == null || l.a === hover || l.b === hover;
  const hovered = hover == null ? null : nodes[hover];

  return (
    <>
      <div className="graph-scroll">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="sharing-graph"
          role="img"
          aria-label={`Sharing between the ${portals.length} portal agencies: ${links.length} connections, ${mutualCount} of them mutual`}
        >
          <circle cx={CX} cy={CY} r={R} className="sg-ring" />
          {links.map((l) => (
            <path
              key={`${l.a}:${l.b}`}
              d={chord(nodes[l.a], nodes[l.b])}
              className={`sg-link${l.mutual ? " mutual" : ""}${linkActive(l) ? (hover != null ? " hot" : "") : " dim"}`}
            />
          ))}
          {nodes.map((nd) => (
            <g
              key={nd.canonical}
              onMouseEnter={() => setHover(nd.i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === nd.i ? null : nd.i)}
            >
              <circle
                cx={nd.x}
                cy={nd.y}
                r={nd.r}
                className={`sg-node${nd.dropped ? " dropped" : ""}${nodeActive(nd.i) ? "" : " dim"}`}
              >
                <title>{`${nd.name} — ${nd.partners} Wisconsin partners${nd.dropped ? " · announced dropping Flock" : ""}`}</title>
              </circle>
              <g transform={`translate(${CX} ${CY}) rotate(${nd.deg})`}>
                <text
                  x={nd.flip ? -(R + nd.r + 6) : R + nd.r + 6}
                  y={0}
                  transform={nd.flip ? "rotate(180)" : undefined}
                  textAnchor={nd.flip ? "end" : "start"}
                  dominantBaseline="middle"
                  className={`sg-label${nodeActive(nd.i) ? "" : " dim"}${hover === nd.i ? " hot" : ""}`}
                >
                  {short(nd.name)}
                </text>
              </g>
            </g>
          ))}
          <text x={CX} y={CY - 8} textAnchor="middle" className="sg-center">
            {hovered ? short(hovered.name) : `${portals.length} portal agencies`}
          </text>
          <text x={CX} y={CY + 10} textAnchor="middle" className="sg-center sub">
            {hovered
              ? `${hovered.partners} Wisconsin partners · ${links.filter((l) => l.a === hover || l.b === hover).length} inside the circle`
              : `${links.length} connections · ${mutualCount} mutual`}
          </text>
        </svg>
      </div>
      <p className="gap-caption">
        Each dot is a portal agency, sized by how many Wisconsin partners it lists. A teal
        line means both agencies name each other; a gray line is one-way; a rust ring marks an
        agency that has announced dropping Flock. {links.length} connections among the{" "}
        {portals.length}, {mutualCount} mutual. Hover or tap a dot to isolate its connections.
      </p>
    </>
  );
}
