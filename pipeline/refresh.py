"""The Watch Ledger — data refresh pipeline.

One entry point, one path: fetch three sources, merge, validate, write static JSON.
Any failure raises and kills the run; the site keeps serving the last committed data.

    python pipeline/refresh.py

Sources:
  1. OpenStreetMap via Overpass API (DeFlock community mapping) -> camera points
  2. Eyes On Flock aggregate (eyesonflock.com/api/v1/data)      -> transparency portal stats
  3. EFF Atlas of Surveillance CSV                              -> sourced agency records
  + data/status_overlay.json (hand-curated contract status; overlay always wins)
"""

import csv
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
UA = {"User-Agent": "WPR-WatchLedger/1.0 (Wausau Pilot & Review; data@wausaupilotandreview.com)"}

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_QUERY = """
[out:json][timeout:180];
area["name"="Wisconsin"]["admin_level"="4"]->.wi;
node["man_made"="surveillance"]["surveillance:type"="ALPR"](area.wi);
out body;
"""
EOF_URL = "https://eyesonflock.com/api/v1/data"
ATLAS_URL = "https://atlasofsurveillance.org/download"

VALID_STATUSES = {"active", "dropped", "never"}


# ---------------------------------------------------------------- name matching

SUFFIX_MAP = [
    (r"police department$", "pd"),
    (r"police dept$", "pd"),
    (r"sheriffs? office$", "so"),
    (r"sheriffs? department$", "so"),
    (r"sheriffs? dept$", "so"),
]


def canonicalize(name: str) -> str:
    """Collapse agency name variants to one key.

    'Wausau WI PD', 'Wausau Police Department' -> 'wausau pd'
    'Marathon County Sheriff's Office', 'Marathon County WI SO' -> 'marathon county so'
    """
    s = name.lower().replace("[inactive]", "")
    s = re.sub(r"['’.]", "", s)  # sheriff's -> sheriffs BEFORE punctuation becomes spaces
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\b(wi|wisconsin)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pattern, abbr in SUFFIX_MAP:
        s = re.sub(pattern, abbr, s)
    return s


# ---------------------------------------------------------------- fetchers

def fetch_cameras() -> dict:
    r = requests.post(OVERPASS_URL, data={"data": OVERPASS_QUERY}, headers=UA, timeout=300)
    r.raise_for_status()
    elements = r.json()["elements"]
    if len(elements) < 500:
        raise RuntimeError(f"Overpass returned only {len(elements)} nodes; expected 1500+. Aborting.")
    cameras = []
    for n in elements:
        t = n.get("tags", {})
        cameras.append({
            "id": n["id"],
            "lat": round(n["lat"], 6),
            "lon": round(n["lon"], 6),
            "manufacturer": t.get("manufacturer"),
            "operator": t.get("operator"),
            "direction": t.get("direction"),
            "zone": t.get("surveillance:zone"),
        })
    return {
        "source": "OpenStreetMap contributors via Overpass API (DeFlock community mapping)",
        "count": len(cameras),
        "flock_count": sum(1 for c in cameras if c["manufacturer"] == "Flock Safety"),
        "cameras": cameras,
    }


def portal_name_from_slug(slug: str) -> str:
    """'altoona-wi-pd' -> 'Altoona PD'; 'university-of-wisconsin-madison-wi-pd' -> 'University Of Wisconsin Madison PD'"""
    tokens = slug.split("-")
    if "wi" not in tokens:
        raise RuntimeError(f"Portal slug missing WI marker: {slug}")
    i = tokens.index("wi")
    base = " ".join(t.title() for t in tokens[:i])
    suffix = " ".join(t.upper() for t in tokens[i + 1:])
    return f"{base} {suffix}".strip()


def fetch_portals() -> tuple[list[dict], dict]:
    """Returns (WI portal records, WI network-edge roster derived from national sharing lists)."""
    r = requests.get(EOF_URL, headers=UA, timeout=120)
    r.raise_for_status()
    payload = r.json()
    if "portals" not in payload or "summary" not in payload:
        raise RuntimeError("Eyes On Flock payload shape changed; expected keys 'portals' and 'summary'.")
    portals = payload["portals"]

    required = {"slug", "state", "total_cameras", "total_searches", "organizations_shared_with"}
    missing = required - set(portals[0].keys())
    if missing:
        raise RuntimeError(f"Eyes On Flock portal record missing expected keys: {missing}")

    wi_portals = []
    for p in portals:
        if (p.get("state") or "").upper() != "WI":
            continue
        name = portal_name_from_slug(p["slug"])
        wi_portals.append({
            "name": name,
            "canonical": canonicalize(name),
            "portal_url": p.get("portal_url") or f"https://transparency.flocksafety.com/{p['slug']}",
            "county": p.get("county"),
            "type": p.get("type"),
            "cameras": p.get("total_cameras"),
            "searches_30d": p.get("total_searches"),
            "retention_days": p.get("data_retention"),
            "vehicles_captured_30d": p.get("vehicles_captured"),
            "hotlist_hits_30d": p.get("hotlist_hits"),
            "shared_with_count": p.get("organization_count"),
            "prohibited_uses": p.get("prohibited_uses"),
            "public_search_audit": bool(p.get("public_search_audit")),
        })

    # Derive the WI roster from every portal's sharing lists nationwide.
    # An agency in these lists participates in the Flock network even without a portal.
    edges: dict[str, dict] = {}
    wi_pattern = re.compile(r"\bWI\b")
    for p in portals:
        for org in (p.get("organizations_shared_with") or []) + (p.get("organizations_received_from") or []):
            if not wi_pattern.search(org):
                continue
            inactive = "[Inactive]" in org
            key = canonicalize(org)
            display = re.sub(r"\s+WI\b", "", org.replace("[Inactive]", "")).strip()
            entry = edges.setdefault(key, {"name": display,
                                           "mentions": 0, "active_mentions": 0})
            entry["mentions"] += 1
            if not inactive:
                entry["active_mentions"] += 1
    return wi_portals, edges


def fetch_atlas() -> list[dict]:
    r = requests.get(ATLAS_URL, headers=UA, timeout=180)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))))
    if not rows or "Technology" not in rows[0]:
        raise RuntimeError("Atlas of Surveillance CSV shape changed; expected a 'Technology' column.")
    out = []
    for row in rows:
        if row.get("State", "").strip() not in ("WI", "Wisconsin"):
            continue
        if "plate" not in row.get("Technology", "").lower():
            continue
        links = [row[k].strip() for k in ("Link 1", "Link 2", "Link 3") if row.get(k, "").strip()]
        out.append({
            "name": row["Agency"].strip(),
            "canonical": canonicalize(row["Agency"]),
            "county": row.get("County", "").strip() or None,
            "vendor": row.get("Vendor", "").strip() or None,
            "summary": row.get("Summary", "").strip() or None,
            "links": links,
        })
    if len(out) < 50:
        raise RuntimeError(f"Atlas returned only {len(out)} WI ALPR rows; expected 100+. Aborting.")
    return out


# ---------------------------------------------------------------- overlay + merge

def load_overlay() -> dict:
    overlay = json.loads((DATA / "status_overlay.json").read_text(encoding="utf-8"))
    for key, entry in overlay.items():
        if canonicalize(key) != key:
            raise RuntimeError(f"Overlay key is not canonical: '{key}' (should be '{canonicalize(key)}')")
        if entry["status"] not in VALID_STATUSES:
            raise RuntimeError(f"Overlay '{key}': status must be one of {VALID_STATUSES}")
        if not entry["source"].startswith("http"):
            raise RuntimeError(f"Overlay '{key}': source must be a URL")
        if "as_of" not in entry or "name" not in entry:
            raise RuntimeError(f"Overlay '{key}': 'name' and 'as_of' are required")
    return overlay


def build_agencies(portals: list[dict], edges: dict, atlas: list[dict], overlay: dict) -> list[dict]:
    agencies: dict[str, dict] = {}

    def get(key: str, name: str) -> dict:
        return agencies.setdefault(key, {
            "name": name, "canonical": key, "county": None, "type": None,
            "in_network": False, "network_mentions": 0,
            "portal": None, "atlas": None,
            "status": {"value": "unknown", "derived": True, "as_of": None, "source": None, "note": None},
        })

    for p in portals:
        a = get(p["canonical"], p["name"])
        a["county"], a["type"] = p["county"], p["type"]
        a["portal"] = {k: p[k] for k in ("portal_url", "cameras", "searches_30d", "retention_days",
                                         "vehicles_captured_30d", "hotlist_hits_30d",
                                         "shared_with_count", "prohibited_uses", "public_search_audit")}
        a["in_network"] = True
        a["status"] = {"value": "active", "derived": True, "as_of": None, "source": p["portal_url"],
                       "note": "Publishes a live Flock transparency portal"}

    for key, e in edges.items():
        a = get(key, e["name"])
        a["network_mentions"] = e["mentions"]
        if e["active_mentions"] > 0:
            a["in_network"] = True
            if a["status"]["value"] == "unknown":
                a["status"] = {"value": "active", "derived": True, "as_of": None, "source": None,
                               "note": f"Appears in {e['active_mentions']} agencies' Flock data-sharing lists"}

    for rec in atlas:
        a = get(rec["canonical"], rec["name"])
        a["name"] = rec["name"]  # formal Atlas names win over portal/edge shorthand
        a["atlas"] = {k: rec[k] for k in ("vendor", "summary", "links")}
        if a["county"] is None:
            a["county"] = rec["county"]

    for key, o in overlay.items():
        a = get(key, o["name"])
        a["name"] = o["name"]  # curated names win over everything
        if o.get("county"):
            a["county"] = o["county"]
        a["status"] = {"value": o["status"], "derived": False, "as_of": o["as_of"],
                       "source": o["source"], "note": o.get("note")}

    result = sorted(agencies.values(), key=lambda a: ((a["portal"] is None), -(a["portal"]["cameras"] or 0) if a["portal"] else 0, a["name"]))
    if len(result) < 100:
        raise RuntimeError(f"Merged roster has only {len(result)} agencies; expected 200+. Aborting.")
    return result


# ---------------------------------------------------------------- main

def main() -> None:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print("[1/4] Overpass: Wisconsin ALPR nodes...")
    cameras = fetch_cameras()
    print(f"      {cameras['count']} cameras ({cameras['flock_count']} Flock Safety)")

    print("[2/4] Eyes On Flock: transparency portals + network edges...")
    portals, edges = fetch_portals()
    print(f"      {len(portals)} WI portals, {len(edges)} WI agencies in sharing lists")

    print("[3/4] EFF Atlas of Surveillance: WI ALPR records...")
    atlas = fetch_atlas()
    print(f"      {len(atlas)} sourced records")

    print("[4/4] Merging with curated status overlay...")
    overlay = load_overlay()
    agencies = build_agencies(portals, edges, atlas, overlay)

    meta = {
        "generated": generated,
        "camera_count": cameras["count"],
        "flock_camera_count": cameras["flock_count"],
        "agency_count": len(agencies),
        "portal_count": len(portals),
        "curated_count": len(overlay),
        "attribution": {
            "cameras": "Camera locations © OpenStreetMap contributors, mapped by the DeFlock community (deflock.org)",
            "portals": "Transparency portal statistics aggregated by Eyes On Flock (eyesonflock.com)",
            "atlas": "Agency records from EFF's Atlas of Surveillance (atlasofsurveillance.org)",
        },
    }

    cameras["generated"] = generated
    (DATA / "cameras.json").write_text(json.dumps(cameras, separators=(",", ":")), encoding="utf-8")
    (DATA / "agencies.json").write_text(json.dumps({"generated": generated, "agencies": agencies}, separators=(",", ":")), encoding="utf-8")
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Done. {len(agencies)} agencies, {cameras['count']} cameras -> data/")


if __name__ == "__main__":
    sys.exit(main())
