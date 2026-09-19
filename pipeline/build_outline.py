"""Build data/wi_outline.json: Wisconsin's outline, dissolved from the 72 county shapes.

Run by hand when data/wi_counties.json changes (it rarely will):
    pip install shapely
    python pipeline/build_outline.py

The map uses it to mask everything outside the state and to draw the state border. The county
file is simplified, so neighbouring counties do not meet exactly: a small buffer out and back
in closes those slivers before the union, otherwise the mask leaks along every county line.
"""
from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping, shape
from shapely.ops import unary_union

DATA = Path(__file__).resolve().parent.parent / "data"
CLOSE = 0.004        # degrees, about 400 m: closes slivers between simplified counties
SIMPLIFY = 0.003     # about 300 m: invisible at the zooms where the mask matters
MIN_ISLAND = 0.0004  # square degrees, about 3.5 sq km: keeps the Apostles and Washington Island


def main() -> None:
    counties = json.loads((DATA / "wi_counties.json").read_text(encoding="utf-8"))
    merged = unary_union([shape(f["geometry"]).buffer(CLOSE) for f in counties["features"]]).buffer(-CLOSE)
    merged = merged.simplify(SIMPLIFY, preserve_topology=True)
    parts = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
    parts = sorted((p for p in parts if p.area >= MIN_ISLAND), key=lambda p: -p.area)
    # interior holes would be sliver artefacts (Wisconsin has no enclaves), so drop them
    rings = [[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords] for p in parts]
    west, south, east, north = merged.bounds
    out = {
        "source": "Dissolved from data/wi_counties.json (U.S. Census Bureau cartographic boundaries) by pipeline/build_outline.py",
        "bounds": [[round(south, 3), round(west, 3)], [round(north, 3), round(east, 3)]],
        "polygons": rings,  # [ [ [lon, lat], ... ] ], mainland first, then islands
    }
    (DATA / "wi_outline.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{len(rings)} polygon(s), {sum(len(r) for r in rings)} points, bounds {out['bounds']}, "
          f"{(DATA / 'wi_outline.json').stat().st_size / 1024:.1f} KB")
    print("mainland is", round(100 * parts[0].area / sum(p.area for p in parts), 2), "% of the area;",
          "shape check:", mapping(parts[0])["type"])


if __name__ == "__main__":
    main()
