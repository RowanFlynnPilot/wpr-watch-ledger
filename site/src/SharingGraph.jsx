import React, { useMemo, useState } from "react";

// The inner circle: the portal-publishing agencies arranged on a ring, with a
// chord wherever one names another among its Wisconsin sharing partners.
// Hand-rolled SVG — no graph library.

const short = (name) =>
  name
    .replace("University of Wisconsin-Madison Police Department", "UW-Madison PD")
    .replace(" Police Department", " PD")
    .replace(" Sheriff's Office", " SO");

export default function SharingGraph({ agencies, edges }) {
  const portals = agencies.filter((a) => a.portal);
  const { nodes, links, mutualCount } = useMemo(() => {
    const inRing = new Set(portals.map((p) => p.canonical));
    const idx = new Map(portals.map((p, i) => [p.canonical, i]));
    const n = portals.length;
    const cx = 350, cy = 250, R = 168;
    const nodes = portals.map((p, i) => {
      const ang = (2 * Math.PI * i) / n - Math.PI / 2;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      return {
        i,
        canonical: p.canonical,
        name: p.name,
        partners: (edges[p.canonical] || []).length,
        x: cx + R * cos,
        y: cy + R * sin,
        labelX: cx + (R + 13) * cos,
        labelY: cy + (R + 13) * sin + (Math.abs(cos) < 0.25 ? (sin < 0 ? -3 : 9) : 3),
        anchor: cos > 0.25 ? "start" : cos < -0.25 ? "end" : "middle",
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

  return (
    <>
      <div className="graph-scroll">
        <svg
          viewBox="0 0 700 500"
          className="sharing-graph"
          role="img"
          aria-label={`Sharing between the ${portals.length} portal agencies: ${links.length} connections, ${mutualCount} of them mutual`}
        >
          {links.map((l) => (
            <line
              key={`${l.a}:${l.b}`}
              x1={nodes[l.a].x}
              y1={nodes[l.a].y}
              x2={nodes[l.b].x}
              y2={nodes[l.b].y}
              className={`sg-link${l.mutual ? " mutual" : ""}${linkActive(l) ? "" : " dim"}`}
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
                r={3 + Math.sqrt(nd.partners) * 0.55}
                className={`sg-node${nodeActive(nd.i) ? "" : " dim"}`}
              >
                <title>{`${nd.name} — ${nd.partners} Wisconsin partners`}</title>
              </circle>
              <text
                x={nd.labelX}
                y={nd.labelY}
                textAnchor={nd.anchor}
                className={`sg-label${nodeActive(nd.i) ? "" : " dim"}`}
              >
                {short(nd.name)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="gap-caption">
        Each dot is a portal agency, sized by how many Wisconsin partners it lists. A teal
        line means both agencies name each other; a gray line is one-way. {links.length}{" "}
        connections among the {portals.length}, {mutualCount} mutual. Hover or tap a dot to
        isolate its connections.
      </p>
    </>
  );
}
