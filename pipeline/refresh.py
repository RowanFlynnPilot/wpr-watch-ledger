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

HISTORY_STAT_KEYS = {"cameras", "searches_30d", "vehicles_captured_30d", "hotlist_hits_30d"}


# ---------------------------------------------------------------- name matching

SUFFIX_MAP = [
    (r"police department$", "pd"),
    (r"police dept$", "pd"),
    (r"sheriffs? office$", "so"),
    (r"sheriffs? department$", "so"),
    (r"sheriffs? dept$", "so"),
    (r"sheriffs?$", "so"),  # WisDOT permit registry style: 'Dane Co Sheriff'
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
    s = re.sub(r"\bco\b", "county", s)  # 'Florence Co. SO' == 'Florence County SO'
    s = re.sub(r"\bst\b", "saint", s)  # 'St Croix Falls PD' == 'Saint Croix Falls PD'
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


LOWERCASE_NAME_TOKENS = {"of", "du"}  # 'Fond du Lac', 'University of Wisconsin'


def portal_name_from_slug(slug: str) -> str:
    """'altoona-wi-pd' -> 'Altoona PD'; 'fond-du-lac-wi-pd' -> 'Fond du Lac PD';
    'university-of-wisconsin-madison-wi-pd' -> 'University of Wisconsin Madison PD'"""
    tokens = slug.split("-")
    if "wi" not in tokens:
        raise RuntimeError(f"Portal slug missing WI marker: {slug}")
    i = tokens.index("wi")
    base = " ".join(t if n > 0 and t in LOWERCASE_NAME_TOKENS else t.title() for n, t in enumerate(tokens[:i]))
    suffix = " ".join(t.upper() for t in tokens[i + 1:])
    return f"{base} {suffix}".strip()


def fetch_portals() -> tuple[list[dict], dict, dict]:
    """Returns (WI portal records,
                WI network-edge roster derived from national sharing lists,
                per-portal WI sharing partners: portal canonical -> sorted partner canonicals)."""
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

    wi_pattern = re.compile(r"\bWI\b")
    wi_portals = []
    sharing: dict[str, list[str]] = {}
    for p in portals:
        if (p.get("state") or "").upper() != "WI":
            continue
        name = portal_name_from_slug(p["slug"])
        portal_key = canonicalize(name)
        partners = set()
        for org in p.get("organizations_shared_with") or []:
            if "[Inactive]" in org or not wi_pattern.search(org):
                continue
            partner_key = canonicalize(org)
            if partner_key != portal_key:
                partners.add(partner_key)
        sharing[portal_key] = sorted(partners)
        wi_portals.append({
            "name": name,
            "canonical": portal_key,
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
    return wi_portals, edges, sharing


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


# ---------------------------------------------------------------- history

def load_history() -> dict:
    """Load data/history.json, validating every snapshot. Missing file bootstraps an
    empty ledger (first run); any corruption or shape drift aborts the run."""
    path = DATA / "history.json"
    if not path.exists():
        return {"snapshots": []}
    history = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(history, dict) or list(history.keys()) != ["snapshots"] or not isinstance(history["snapshots"], list):
        raise RuntimeError("history.json corrupt: expected {'snapshots': [...]}")
    prev_date = ""
    for snap in history["snapshots"]:
        if not isinstance(snap, dict) or set(snap.keys()) != {"date", "portals"}:
            raise RuntimeError(f"history.json corrupt: snapshot keys must be {{date, portals}}, got {snap if not isinstance(snap, dict) else set(snap.keys())}")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", snap["date"]):
            raise RuntimeError(f"history.json corrupt: bad snapshot date '{snap['date']}'")
        if snap["date"] <= prev_date:
            raise RuntimeError(f"history.json corrupt: snapshot dates not strictly increasing at '{snap['date']}'")
        prev_date = snap["date"]
        if not isinstance(snap["portals"], dict):
            raise RuntimeError(f"history.json corrupt: snapshot '{snap['date']}' portals is not an object")
        for key, stats in snap["portals"].items():
            if not isinstance(stats, dict) or set(stats.keys()) != HISTORY_STAT_KEYS:
                raise RuntimeError(f"history.json corrupt: snapshot '{snap['date']}' entry '{key}' must have exactly {sorted(HISTORY_STAT_KEYS)}")
            for stat, value in stats.items():
                if value is not None and not isinstance(value, int):
                    raise RuntimeError(f"history.json corrupt: snapshot '{snap['date']}' entry '{key}' stat '{stat}' is {type(value).__name__}, expected int or null")
    return history


def append_snapshot(history: dict, portals: list[dict], run_date: str) -> None:
    """Append today's per-portal stats. Past snapshots are never rewritten; a rerun
    on the same date replaces that date's snapshot instead of duplicating it."""
    entry = {p["canonical"]: {k: p[k] for k in HISTORY_STAT_KEYS} for p in portals}
    for key, stats in entry.items():
        for stat, value in stats.items():
            if value is not None and not isinstance(value, int):
                raise RuntimeError(f"Portal '{key}' stat '{stat}' is {type(value).__name__}, expected int or null; refusing to write history.json")
    snapshots = history["snapshots"]
    if snapshots and snapshots[-1]["date"] == run_date:
        snapshots[-1]["portals"] = entry
    else:
        snapshots.append({"date": run_date, "portals": entry})


# ---------------------------------------------------------------- county enrichment

# One spelling per county, USPS style. Sources disagree: EOF says "Saint Croix",
# the Atlas ships a mangled "Croix County", title-casing yields "St Croix".
COUNTY_FIXUPS = {
    "Croix County": "St. Croix County",
    "Saint Croix County": "St. Croix County",
    "St Croix County": "St. Croix County",
    "Fond Du Lac County": "Fond du Lac County",
}

COUNTY_IN_NAME = re.compile(r"^(.+?) county\b")
CO_SO = re.compile(r"^(.+?) co so$")
MUNI_PREFIX = re.compile(r"^(city|town|village|university) of ")


def load_city_county() -> dict:
    path = DATA / "wi_city_county.json"
    if not path.exists():
        raise RuntimeError("data/wi_city_county.json is missing; the municipality->county lookup is required.")
    lookup = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(lookup, dict) or not lookup:
        raise RuntimeError("wi_city_county.json must be a non-empty object of municipality -> county")
    for muni, county in lookup.items():
        if canonicalize(muni) != muni:
            raise RuntimeError(f"wi_city_county.json key is not canonical: '{muni}' (should be '{canonicalize(muni)}')")
        if not isinstance(county, str) or not county.endswith(" County"):
            raise RuntimeError(f"wi_city_county.json '{muni}': value must end in ' County', got {county!r}")
    return lookup


def resolve_county(canonical: str, city_county: dict) -> str | None:
    """County for an agency whose sources supplied none. Two rules, no guessing:
    the name states its county outright (sheriffs, county agencies), or the name
    minus a municipal prefix/PD suffix exactly matches a known municipality."""
    m = COUNTY_IN_NAME.match(canonical) or CO_SO.match(canonical)
    if m:
        return " ".join(w.title() for w in m.group(1).split()) + " County"
    muni = MUNI_PREFIX.sub("", canonical)
    muni = re.sub(r" pd$", "", muni)
    return city_county.get(muni)


# ---------------------------------------------------------------- wisdot permits

WISDOT_CAMERA_KEYS = {"lat", "lon", "permit_id", "owner", "county", "address",
                      "product", "power", "permit_status", "confirmation", "date_approved"}

# Hand-checked corrections for the WisDOT permit registry's typos, abbreviation
# styles, and location annotations. Keys are exact owner strings from the
# snapshot; values are the agency as named elsewhere in the roster. Corrections
# only — anything ambiguous stays exactly as WisDOT wrote it.
WISDOT_OWNER_ALIASES = {
    "Adams SO": "Adams County SO",
    "Altoon PD": "Altoona PD",
    "Campbell PD": "Town of Campbell PD",
    "City of New Berlin PD": "New Berlin PD",
    "City of Onalaska PD": "Onalaska PD",
    "City of Waukesha PD": "Waukesha PD",
    "Colby/Abbotsford PD": "Abbotsford PD",
    "Columbia Co SO-Pardeeville": "Columbia County SO",
    "KewaskumPD": "Kewaskum PD",
    "Menominee Falls PD": "Menomonee Falls PD",
    "Menomonee SO": "Menominee County SO",
    "Merrilll PD": "Merrill PD",
    "Mukwonago PD": "Village of Mukwonago PD",
    "Prairie du Chien": "Prairie du Chien PD",
    "Richland SO": "Richland County SO",
    "Shawano PD (in Town of Wescott)": "Shawano PD",
    "Tomah PD (for Tomah Health)": "Tomah PD",
    "Turtle Lake PD": "Village of Turtle Lake PD",
    "V Pleasant Prairie": "Pleasant Prairie PD",
    "V Richfield": "Village of Richfield",
    "Village & Town of Somers": "Village of Somers",
    "Village of Pleasant Prairie PD": "Pleasant Prairie PD",
    "Waukesha Co SD-Sussex": "Waukesha County SO",
    "Waukesha Co SD-T of Lisbon": "Waukesha County SO",
}

# 12 cameras whose registry rows name no owning agency: they stay on the map
# but never become roster rows.
WISDOT_SKIP_OWNERS = {"Unknown", "Unknown Agency"}


def load_wisdot() -> dict:
    """Committed snapshot of WisDOT state-highway right-of-way permit records
    (obtained via open records by Deflock Dane). Static like the county lookup:
    refreshed by a new records release, not by the weekly run."""
    path = DATA / "wisdot_permits.json"
    if not path.exists():
        raise RuntimeError("data/wisdot_permits.json is missing; the WisDOT permit snapshot is required.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    cameras = doc.get("cameras")
    if not isinstance(cameras, list) or doc.get("camera_count") != len(cameras):
        raise RuntimeError("wisdot_permits.json corrupt: camera_count does not match cameras list")
    if len(cameras) < 500:
        raise RuntimeError(f"wisdot_permits.json has only {len(cameras)} cameras; expected 700+. Truncated?")
    for c in cameras:
        if set(c.keys()) != WISDOT_CAMERA_KEYS:
            raise RuntimeError(f"wisdot_permits.json camera has wrong keys: {set(c.keys()) ^ WISDOT_CAMERA_KEYS}")
        if not (42.0 < c["lat"] < 47.5 and -93.5 < c["lon"] < -86.0):
            raise RuntimeError(f"wisdot_permits.json camera outside Wisconsin: {c['lat']},{c['lon']} ({c['owner']})")
        if not c["owner"]:
            raise RuntimeError("wisdot_permits.json camera with empty owner")
    return doc


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


def build_agencies(portals: list[dict], edges: dict, atlas: list[dict], overlay: dict,
                   city_county: dict, wisdot: dict) -> list[dict]:
    agencies: dict[str, dict] = {}

    def get(key: str, name: str) -> dict:
        return agencies.setdefault(key, {
            "name": name, "canonical": key, "county": None, "type": None,
            "in_network": False, "network_mentions": 0,
            "portal": None, "atlas": None, "wisdot": None,
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

    # WisDOT highway right-of-way permits: official per-agency camera counts.
    # Documents ALPR use even for agencies absent from every other source, but
    # says nothing about Flock network membership, so in_network is untouched.
    by_owner: dict[str, dict] = {}
    for c in wisdot["cameras"]:
        owner = WISDOT_OWNER_ALIASES.get(c["owner"], c["owner"])
        if owner in WISDOT_SKIP_OWNERS:
            continue
        key = canonicalize(owner)
        entry = by_owner.setdefault(key, {"name": owner, "cameras": 0,
                                          "counties": set(), "permits": set()})
        entry["cameras"] += 1
        entry["counties"].add(c["county"])
        if c["permit_id"]:
            entry["permits"].add(c["permit_id"])
    for key, w in by_owner.items():
        a = get(key, w["name"])
        a["wisdot"] = {"cameras": w["cameras"], "permits": sorted(w["permits"]),
                       "counties": sorted(w["counties"])}

    for a in agencies.values():
        if a["county"] is None:
            a["county"] = resolve_county(a["canonical"], city_county)
        if a["county"] is None and a["wisdot"] and len(a["wisdot"]["counties"]) == 1:
            # weakest signal, used last: every permitted camera stands in one county
            a["county"] = f"{a['wisdot']['counties'][0]} County"
        if a["county"] in COUNTY_FIXUPS:
            a["county"] = COUNTY_FIXUPS[a["county"]]

    result = sorted(agencies.values(), key=lambda a: ((a["portal"] is None), -(a["portal"]["cameras"] or 0) if a["portal"] else 0, a["name"]))
    if len(result) < 100:
        raise RuntimeError(f"Merged roster has only {len(result)} agencies; expected 200+. Aborting.")
    return result


# ---------------------------------------------------------------- main

def main() -> None:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print("[1/5] Overpass: Wisconsin ALPR nodes...")
    cameras = fetch_cameras()
    print(f"      {cameras['count']} cameras ({cameras['flock_count']} Flock Safety)")

    print("[2/5] Eyes On Flock: transparency portals + network edges...")
    portals, edges, sharing = fetch_portals()
    print(f"      {len(portals)} WI portals, {len(edges)} WI agencies in sharing lists, "
          f"{sum(len(v) for v in sharing.values())} WI->WI active edges")

    print("[3/5] EFF Atlas of Surveillance: WI ALPR records...")
    atlas = fetch_atlas()
    print(f"      {len(atlas)} sourced records")

    print("[4/5] Merging with curated status overlay + county lookup + WisDOT permits...")
    overlay = load_overlay()
    city_county = load_city_county()
    wisdot = load_wisdot()
    agencies = build_agencies(portals, edges, atlas, overlay, city_county, wisdot)
    unresolved = sum(1 for a in agencies if a["county"] is None)
    with_wisdot = sum(1 for a in agencies if a["wisdot"])
    print(f"      {len(agencies) - unresolved} agencies with a county, {unresolved} unresolved; "
          f"{with_wisdot} agencies hold WisDOT highway permits")

    print("[5/5] Appending portal stats to history ledger...")
    history = load_history()
    append_snapshot(history, portals, generated[:10])
    print(f"      {len(history['snapshots'])} snapshot(s) on record")

    meta = {
        "generated": generated,
        "camera_count": cameras["count"],
        "flock_camera_count": cameras["flock_count"],
        "agency_count": len(agencies),
        "portal_count": len(portals),
        "curated_count": len(overlay),
        "wisdot_camera_count": wisdot["camera_count"],
        "wisdot_agency_count": with_wisdot,
        "attribution": {
            "cameras": "Camera locations © OpenStreetMap contributors, mapped by the DeFlock community (deflock.org)",
            "portals": "Transparency portal statistics aggregated by Eyes On Flock (eyesonflock.com)",
            "atlas": "Agency records from EFF's Atlas of Surveillance (atlasofsurveillance.org)",
            "wisdot": "State-highway camera permits from Wisconsin DOT records, obtained under the Wisconsin Open Records Law and mapped by Deflock Dane (deflockdane.org)",
        },
    }

    cameras["generated"] = generated
    (DATA / "cameras.json").write_text(json.dumps(cameras, separators=(",", ":")), encoding="utf-8")
    (DATA / "agencies.json").write_text(json.dumps({"generated": generated, "agencies": agencies}, separators=(",", ":")), encoding="utf-8")
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (DATA / "history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
    (DATA / "edges.json").write_text(json.dumps({"generated": generated, "edges": sharing}, separators=(",", ":")), encoding="utf-8")
    print(f"Done. {len(agencies)} agencies, {cameras['count']} cameras -> data/")


if __name__ == "__main__":
    sys.exit(main())
