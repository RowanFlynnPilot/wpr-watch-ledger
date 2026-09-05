"""The Watch Ledger — data refresh pipeline.

One entry point, one path: fetch three sources, merge, validate, write static JSON.
Any failure raises and kills the run; the site keeps serving the last committed data.

    python pipeline/refresh.py

Sources:
  1. OpenStreetMap via Overpass API (DeFlock community mapping) -> camera points
  2. Eyes On Flock aggregate (eyesonflock.com/api/v1/data)      -> transparency portal stats
  3. EFF Atlas of Surveillance CSV                              -> sourced agency records
  + data/status_overlay.json (hand-curated contract status; overlay always wins)
  + data/usatoday_flock_search.json (committed snapshot of USA TODAY's audit-log
    search totals per Wisconsin agency, Jan 2023 - Apr 2026)
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

# A portal whose figures Flock has not updated in this many days is excluded from
# the statewide 30-day totals and flagged in the roster.
STALE_DAYS = 45

HISTORY_STAT_KEYS = {"cameras", "searches_30d", "vehicles_captured_30d", "hotlist_hits_30d"}

WI_PATTERN = re.compile(r"\bWI\b")
US_STATES = set("""AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV
NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC""".split())
# Flock's own placeholder entries inside sharing lists — never counted as agencies.
DEAD_ORG = re.compile(r"\[(DEACTIVATED|Inactive)\]|\bdemo\b|DO NOT USE", re.I)

# OSM operator tags naming the vendor rather than the agency running the camera.
VENDOR_OPERATORS = {"flock safety", "flock", "motorola solutions", "genetec", "leonardo",
                    "axon enterprise", "vigilant solutions", "rekor"}

# Hand-checked corrections for OSM operator tags whose typo hides an obvious agency.
# Corrections only — joint or ambiguous tags stay exactly as volunteers wrote them.
OSM_OPERATOR_ALIASES = {
    "Bayfield County Sherrif's Dept": "Bayfield County Sheriff's Office",
}


def classify_orgs(orgs: list[str] | None) -> dict:
    """Split one portal's sharing list into Wisconsin vs out-of-state agencies, with
    the set of states reached. Deactivated/demo placeholders are dropped from every count."""
    wi = out = 0
    states: set[str] = set()
    for org in orgs or []:
        if DEAD_ORG.search(org):
            continue
        if WI_PATTERN.search(org):
            wi += 1
            continue
        out += 1
        states.update(t for t in re.findall(r"\b[A-Z]{2}\b", org) if t in US_STATES)
    return {"total": wi + out, "wi": wi, "out_of_state": out, "states": sorted(states)}


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
    # 'Village of Fox Point PD' == 'Fox Point PD'. 'Town of X' is kept: a town and a
    # city of the same name (Delavan) run separate departments.
    s = re.sub(r"^(city|village) of ", "", s)
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


def fetch_portals() -> tuple[list[dict], dict, dict, dict]:
    """Returns (WI portal records,
                WI network-edge roster derived from national sharing lists,
                per-portal WI sharing partners: portal canonical -> sorted partner canonicals,
                national portal counts for the how-WI-compares line)."""
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

    wi_pattern = WI_PATTERN
    today = datetime.now(timezone.utc).date()
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
        # Freshness: Flock stamps each portal with when its figures last changed. A
        # portal frozen for weeks (typically an agency that quit) must not keep feeding
        # the statewide 30-day totals as if it were current.
        updated = p.get("data_last_updated")
        if updated:
            try:
                stale_days = (today - datetime.strptime(updated[:10], "%Y-%m-%d").date()).days
            except ValueError as exc:
                raise RuntimeError(f"Portal {p['slug']} has unparsable data_last_updated {updated!r}") from exc
        else:
            stale_days = None
        received = p.get("organizations_received_from") or []
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
            "hand_read": False,
            "updated": updated[:10] if updated else None,
            "stale_days": stale_days,
            "hit_rate": p.get("hotlist_hit_rate"),
            # reach.received is None when the portal discloses no inbound list at all.
            "reach": {
                "shared": classify_orgs(p.get("organizations_shared_with")),
                "received": classify_orgs(received) if received else None,
            },
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
            display = re.sub(r"\s*\(WI\)|\s+WI\b", "", org.replace("[Inactive]", "")).strip()
            entry = edges.setdefault(key, {"name": display,
                                           "mentions": 0, "active_mentions": 0})
            entry["mentions"] += 1
            if not inactive:
                entry["active_mentions"] += 1

    # National context from the same payload: portal counts per state, WI's rank.
    state_counts: dict[str, int] = {}
    for p in portals:
        st = (p.get("state") or "").upper()
        if st:
            state_counts[st] = state_counts.get(st, 0) + 1
    wi_count = state_counts.get("WI", 0)
    leader = max(state_counts.items(), key=lambda kv: kv[1])
    national = {
        "us_portal_count": len(portals),
        "states_with_portals": len(state_counts),
        "wi_portal_count": wi_count,
        "wi_rank_by_portals": 1 + sum(1 for c in state_counts.values() if c > wi_count),
        "leader_state": leader[0],
        "leader_portal_count": leader[1],
    }
    return wi_portals, edges, sharing, national


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
    "Monre County": "Monroe County",        # WisDOT registry typo
    "Menomonee County": "Menominee County",  # WisDOT registry typo
    "Saywer County": "Sawyer County",        # WisDOT registry typo
    "Ozuakee County": "Ozaukee County",      # WisDOT registry typo
    "LaCrosse County": "La Crosse County",   # WisDOT registry spacing
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


# ---------------------------------------------------------------- county boundaries

def load_county_shapes() -> dict:
    """Committed snapshot of Wisconsin county boundaries (Census cartographic
    boundaries, simplified). Used to give each community-mapped camera a county;
    names must match the DOA list exactly."""
    path = DATA / "wi_counties.json"
    if not path.exists():
        raise RuntimeError("data/wi_counties.json is missing; the county boundary snapshot is required.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    feats = doc.get("features")
    if not isinstance(feats, list) or len(feats) != 72:
        raise RuntimeError(f"wi_counties.json must hold 72 county features, got {len(feats) if isinstance(feats, list) else 'none'}")
    for f in feats:
        if f["geometry"]["type"] != "MultiPolygon" or not f["properties"].get("name", "").endswith(" County"):
            raise RuntimeError(f"wi_counties.json bad feature: {f.get('properties')}")
    return doc


def _in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def county_of(lon: float, lat: float, shapes: dict, bboxes: list) -> str | None:
    for name, (minx, miny, maxx, maxy), polys in bboxes:
        if not (minx <= lon <= maxx and miny <= lat <= maxy):
            continue
        for poly in polys:
            if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, hole) for hole in poly[1:]):
                return name
    return None


def county_index(shapes: dict) -> list:
    out = []
    for f in shapes["features"]:
        polys = f["geometry"]["coordinates"]
        xs = [x for poly in polys for ring in poly for x, _ in ring]
        ys = [y for poly in polys for ring in poly for _, y in ring]
        out.append((f["properties"]["name"], (min(xs), min(ys), max(xs), max(ys)), polys))
    return out


# ---------------------------------------------------------------- population

def load_population() -> dict:
    """Committed WI DOA official population estimates (state, counties, places, towns).
    Static like the county lookup; refreshed when DOA publishes new final estimates."""
    path = DATA / "wi_population.json"
    if not path.exists():
        raise RuntimeError("data/wi_population.json is missing; the DOA population estimates are required.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc.get("state"), int) or doc["state"] < 5_000_000:
        raise RuntimeError("wi_population.json corrupt: implausible state population")
    if not isinstance(doc.get("counties"), dict) or len(doc["counties"]) != 72:
        raise RuntimeError(f"wi_population.json corrupt: expected 72 counties, got {len(doc.get('counties', {}))}")
    for name, pop in doc["counties"].items():
        if not name.endswith(" County") or not isinstance(pop, int) or pop <= 0:
            raise RuntimeError(f"wi_population.json corrupt county row: {name!r}: {pop!r}")
    return doc


def build_counties(agencies: list[dict], wisdot: dict, population: dict, generated: str) -> dict:
    """Per-county rollup + statewide coverage. County spellings are enforced against
    DOA's official list — a new source misspelling aborts instead of leaking through."""
    rows = {name: {"name": name, "population": pop, "agencies": 0, "in_network": 0,
                   "portals": 0, "audits": 0, "dropped": 0, "wisdot_cameras": 0, "usat_searches": 0}
            for name, pop in population["counties"].items()}
    unresolved = 0
    for a in agencies:
        c = a["county"]
        if c is None:
            unresolved += 1
            continue
        if c not in rows:
            raise RuntimeError(f"Agency county not in DOA county list: {c!r} ({a['name']})")
        rows[c]["agencies"] += 1
        if a["in_network"]:
            rows[c]["in_network"] += 1
        if a["portal"]:
            rows[c]["portals"] += 1
            if a["portal"]["public_search_audit"]:
                rows[c]["audits"] += 1
        if a["status"]["value"] == "dropped":
            rows[c]["dropped"] += 1
        if a["usatoday"]:
            rows[c]["usat_searches"] += a["usatoday"]["searches"]
    unlocated_cameras = 0
    for cam in wisdot["cameras"]:
        c = f"{cam['county']} County"
        c = COUNTY_FIXUPS.get(c, c)
        if c in rows:
            rows[c]["wisdot_cameras"] += 1
        else:
            unlocated_cameras += 1
    covered = [r for r in rows.values() if r["in_network"] > 0]
    return {
        "generated": generated,
        "population_as_of": population["as_of"],
        "state_population": population["state"],
        "covered_counties": len(covered),
        "covered_population": sum(r["population"] for r in covered),
        "unresolved_agencies": unresolved,
        "unlocated_cameras": unlocated_cameras,
        "counties": sorted(rows.values(), key=lambda r: -r["population"]),
    }


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


# ---------------------------------------------------------------- usa today search records

USAT_KEYS = {"source", "url", "retrieved", "files", "coverage", "notes", "agencies", "high_frequency"}
USAT_COVERAGE_INTS = {"searches", "agencies", "users", "plates", "records", "national_searches", "national_agencies"}
# Units of a department whose searches belong with the department in the roster.
USAT_ALIASES = {"Milwaukee WI PD - STAC": "Milwaukee WI PD"}


def load_usatoday() -> dict:
    """Committed snapshot of USA TODAY's Flock search-records tool, Wisconsin slice:
    cumulative audit-log searches per agency plus the state's rows among the 5,000
    highest-frequency plate searches nationally. Static like the WisDOT permits."""
    path = DATA / "usatoday_flock_search.json"
    if not path.exists():
        raise RuntimeError("data/usatoday_flock_search.json is missing; the USA TODAY search-records snapshot is required.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    if set(doc.keys()) != USAT_KEYS:
        raise RuntimeError(f"usatoday_flock_search.json keys drifted: {set(doc.keys()) ^ USAT_KEYS}")
    cov = doc["coverage"]
    for k in USAT_COVERAGE_INTS:
        if not isinstance(cov.get(k), int) or cov[k] <= 0:
            raise RuntimeError(f"usatoday_flock_search.json coverage.{k} must be a positive int")
    for k in ("first_seen", "last_seen"):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", cov.get(k, "")):
            raise RuntimeError(f"usatoday_flock_search.json coverage.{k} must be YYYY-MM-DD")
    if len(doc["agencies"]) < 200:
        raise RuntimeError(f"usatoday_flock_search.json has only {len(doc['agencies'])} agencies; expected 240+. Truncated?")
    for a in doc["agencies"]:
        if set(a.keys()) != {"org_id", "name", "searches"} or not isinstance(a["searches"], int) or a["searches"] < 0:
            raise RuntimeError(f"usatoday_flock_search.json bad agency row: {a}")
    if sum(a["searches"] for a in doc["agencies"]) != cov["searches"]:
        raise RuntimeError("usatoday_flock_search.json agency totals do not sum to coverage.searches")
    ids = {a["org_id"] for a in doc["agencies"]}
    for r in doc["high_frequency"]:
        if r["org_id"] not in ids or not isinstance(r["count"], int) or not isinstance(r["score"], int):
            raise RuntimeError(f"usatoday_flock_search.json bad high_frequency row: {r}")
    return doc


# ---------------------------------------------------------------- overlay + merge

OVERLAY_PORTAL_INT_KEYS = {"cameras", "searches_30d", "vehicles_captured_30d", "hotlist_hits_30d",
                           "retention_days", "shared_total", "shared_wi", "received_total", "received_wi"}
OVERLAY_PORTAL_KEYS = OVERLAY_PORTAL_INT_KEYS | {"portal_url", "read_on", "shared_states", "received_states",
                                                 "public_search_audit", "prohibited_uses"}


def validate_overlay_portal(key: str, block: dict) -> None:
    """A hand-read portal: figures copied from transparency.flocksafety.com by a person
    on `read_on`, for portals Eyes On Flock has not indexed. Eyes On Flock wins whenever
    it does index the agency; until then these figures age exactly like any other
    portal's (stale after STALE_DAYS from read_on)."""
    extra = set(block) - OVERLAY_PORTAL_KEYS
    if extra:
        raise RuntimeError(f"Overlay '{key}' portal: unknown keys {sorted(extra)}")
    for k in ("portal_url", "read_on"):
        if k not in block:
            raise RuntimeError(f"Overlay '{key}' portal: '{k}' is required")
    if not block["portal_url"].startswith("https://transparency.flocksafety.com/"):
        raise RuntimeError(f"Overlay '{key}' portal: portal_url must be a transparency.flocksafety.com URL")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", block["read_on"]):
        raise RuntimeError(f"Overlay '{key}' portal: read_on must be YYYY-MM-DD")
    for k in OVERLAY_PORTAL_INT_KEYS:
        v = block.get(k)
        if v is not None and (not isinstance(v, int) or v < 0):
            raise RuntimeError(f"Overlay '{key}' portal: '{k}' must be a non-negative int or null, got {v!r}")
    for k in ("shared_states", "received_states"):
        v = block.get(k, [])
        if not isinstance(v, list) or any(st not in US_STATES for st in v):
            raise RuntimeError(f"Overlay '{key}' portal: '{k}' must be a list of state codes")


def portal_from_overlay(block: dict) -> dict:
    today = datetime.now(timezone.utc).date()
    stale_days = (today - datetime.strptime(block["read_on"], "%Y-%m-%d").date()).days
    vehicles, hits = block.get("vehicles_captured_30d"), block.get("hotlist_hits_30d")
    hit_rate = round(100 * hits / vehicles, 2) if vehicles and hits is not None else None
    shared = None
    if block.get("shared_total") is not None:
        shared = {"total": block["shared_total"], "wi": block.get("shared_wi") or 0,
                  "out_of_state": block["shared_total"] - (block.get("shared_wi") or 0),
                  "states": sorted(block.get("shared_states", []))}
    received = None
    if block.get("received_total") is not None:
        received = {"total": block["received_total"], "wi": block.get("received_wi") or 0,
                    "out_of_state": block["received_total"] - (block.get("received_wi") or 0),
                    "states": sorted(block.get("received_states", []))}
    return {
        "portal_url": block["portal_url"],
        "cameras": block.get("cameras"),
        "searches_30d": block.get("searches_30d"),
        "retention_days": block.get("retention_days"),
        "vehicles_captured_30d": vehicles,
        "hotlist_hits_30d": hits,
        "shared_with_count": block.get("shared_total"),
        "prohibited_uses": block.get("prohibited_uses"),
        "public_search_audit": bool(block.get("public_search_audit")),
        "updated": block["read_on"],
        "stale_days": stale_days,
        "hit_rate": hit_rate,
        "reach": {"shared": shared, "received": received},
        "hand_read": True,
    }


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
        if "portal" in entry:
            validate_overlay_portal(key, entry["portal"])
    return overlay


def build_agencies(portals: list[dict], edges: dict, atlas: list[dict], overlay: dict,
                   city_county: dict, wisdot: dict, cameras: dict, usat: dict) -> tuple[list[dict], list[dict]]:
    """Returns (roster, OSM operators that matched no roster agency)."""
    agencies: dict[str, dict] = {}

    def get(key: str, name: str) -> dict:
        return agencies.setdefault(key, {
            "name": name, "canonical": key, "county": None, "type": None,
            "in_network": False, "network_mentions": 0,
            "portal": None, "atlas": None, "wisdot": None, "osm_cameras": 0, "usatoday": None,
            "status": {"value": "unknown", "derived": True, "as_of": None, "source": None, "note": None},
        })

    for p in portals:
        a = get(p["canonical"], p["name"])
        # EOF started shipping bare county names ("Winnebago") in 2026-09; DOA's list is
        # "<Name> County", so normalize before the county rollup validates it.
        county = p["county"]
        if county and not county.endswith(" County"):
            county = f"{county} County"
        a["county"], a["type"] = COUNTY_FIXUPS.get(county, county), p["type"]
        a["portal"] = {k: p[k] for k in ("portal_url", "cameras", "searches_30d", "retention_days",
                                         "vehicles_captured_30d", "hotlist_hits_30d",
                                         "shared_with_count", "prohibited_uses", "public_search_audit",
                                         "updated", "stale_days", "hit_rate", "reach", "hand_read")}
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
        if o.get("portal") and a["portal"] is None:
            a["portal"] = portal_from_overlay(o["portal"])
            a["in_network"] = True

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

    # USA TODAY audit-log records: cumulative searches per agency over the coverage
    # window. An agency that ran searches is a Flock customer whatever the sharing
    # lists say, so it joins the network roster; overlay status still wins.
    cov = usat["coverage"]
    by_key: dict[str, dict] = {}
    id_key: dict[int, str] = {}
    for rec in usat["agencies"]:
        name = USAT_ALIASES.get(rec["name"], rec["name"])
        key = canonicalize(name)
        id_key[rec["org_id"]] = key
        e = by_key.setdefault(key, {"name": re.sub(r"\s*\(WI\)|\s+WI\b", "", name).strip(),
                                    "searches": 0, "org_ids": [], "flagged": [], "users": set()})
        e["searches"] += rec["searches"]
        e["org_ids"].append(rec["org_id"])
    for r in usat["high_frequency"]:
        e = by_key[id_key[r["org_id"]]]
        e["flagged"].append({"count": r["count"], "days_active": r["days_active"],
                             "first_seen": r["first_seen"], "last_seen": r["last_seen"],
                             "reasons": r["reasons"], "score": r["score"]})
        e["users"].add(r["user"])
    for key, e in by_key.items():
        a = get(key, e["name"])
        a["usatoday"] = {"searches": e["searches"], "org_ids": sorted(e["org_ids"]),
                         "flagged_rows": len(e["flagged"]), "flagged_users": len(e["users"]),
                         "max_plate_count": max((f["count"] for f in e["flagged"]), default=0),
                         "flagged": sorted(e["flagged"], key=lambda f: -f["count"])}
        if e["searches"] > 0:
            a["in_network"] = True
            if a["status"]["value"] == "unknown":
                a["status"] = {"value": "active", "derived": True, "as_of": None, "source": usat["url"],
                               "note": f"Ran {e['searches']:,} Flock searches in audit logs obtained by USA TODAY "
                                       f"({cov['first_seen']} to {cov['last_seen']})"}

    # OSM operator tags: volunteers sometimes record who runs a camera. Matched to the
    # roster by canonical name (a bare municipality resolves to its PD, a bare county
    # to its SO). Vendors are ignored; anything unmatched is reported, never guessed.
    osm_counts: dict[str, int] = {}
    for c in cameras["cameras"]:
        op = OSM_OPERATOR_ALIASES.get(c["operator"], c["operator"])
        if op and canonicalize(op) not in VENDOR_OPERATORS:
            osm_counts[op] = osm_counts.get(op, 0) + 1
    unmatched = []
    for op, n in osm_counts.items():
        key = canonicalize(op)
        hit = next((k for k in (key, f"{key} pd", f"{key} so") if k in agencies), None)
        if hit:
            agencies[hit]["osm_cameras"] += n
        else:
            unmatched.append({"operator": op, "cameras": n})
    unmatched.sort(key=lambda u: (-u["cameras"], u["operator"]))

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
    return result, unmatched


# ---------------------------------------------------------------- main

def main() -> None:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print("[1/5] Overpass: Wisconsin ALPR nodes...")
    cameras = fetch_cameras()
    print(f"      {cameras['count']} cameras ({cameras['flock_count']} Flock Safety)")

    print("[2/5] Eyes On Flock: transparency portals + network edges...")
    portals, edges, sharing, national = fetch_portals()
    print(f"      {len(portals)} WI portals, {len(edges)} WI agencies in sharing lists, "
          f"{sum(len(v) for v in sharing.values())} WI->WI active edges; "
          f"WI ranks #{national['wi_rank_by_portals']} of {national['states_with_portals']} states by portal count")

    print("[3/5] EFF Atlas of Surveillance: WI ALPR records...")
    atlas = fetch_atlas()
    print(f"      {len(atlas)} sourced records")

    print("[4/5] Merging with curated status overlay + county lookup + WisDOT permits...")
    shapes = load_county_shapes()
    idx = county_index(shapes)
    for c in cameras["cameras"]:
        c["county"] = county_of(c["lon"], c["lat"], shapes, idx)
    located = sum(1 for c in cameras["cameras"] if c["county"])
    print(f"      {located} of {len(cameras['cameras'])} mapped cameras placed in a county by boundary")
    overlay = load_overlay()
    city_county = load_city_county()
    wisdot = load_wisdot()
    population = load_population()
    usat = load_usatoday()
    agencies, unmatched_operators = build_agencies(portals, edges, atlas, overlay, city_county, wisdot, cameras, usat)
    with_usat = [a for a in agencies if a["usatoday"]]
    print(f"      USA TODAY records: {len(with_usat)} agencies, {sum(a['usatoday']['searches'] for a in with_usat):,} searches "
          f"({usat['coverage']['first_seen']} to {usat['coverage']['last_seen']}); "
          f"{sum(1 for a in with_usat if not a['portal'] and a['usatoday']['searches'] > 0)} of them publish no portal")
    hand_read = [a["name"] for a in agencies if a["portal"] and a["portal"].get("hand_read")]
    stale = [a["name"] for a in agencies
             if a["portal"] and a["portal"]["stale_days"] is not None and a["portal"]["stale_days"] > STALE_DAYS]
    unresolved = sum(1 for a in agencies if a["county"] is None)
    with_wisdot = sum(1 for a in agencies if a["wisdot"])
    counties = build_counties(agencies, wisdot, population, generated)
    print(f"      {len(agencies) - unresolved} agencies with a county, {unresolved} unresolved; "
          f"{with_wisdot} agencies hold WisDOT highway permits")
    print(f"      network agencies in {counties['covered_counties']}/72 counties, "
          f"home to {counties['covered_population']:,} of {counties['state_population']:,} residents")
    print(f"      {sum(a['osm_cameras'] for a in agencies)} mapped cameras attributed to roster agencies "
          f"via OSM operator tags; {len(unmatched_operators)} operators unmatched")
    print(f"      {len(stale)} portal(s) frozen more than {STALE_DAYS} days: {', '.join(stale) or 'none'}")
    print(f"      {len(hand_read)} hand-read portal(s) not indexed by Eyes On Flock: {', '.join(hand_read) or 'none'}")
    permits_by_year: dict[str, int] = {}
    for c in wisdot["cameras"]:
        y = (c["date_approved"] or "")[:4]
        y = y if re.fullmatch(r"\d{4}", y) else "unknown"
        permits_by_year[y] = permits_by_year.get(y, 0) + 1

    print("[5/5] Appending portal stats to history ledger...")
    history = load_history()
    append_snapshot(history, portals, generated[:10])
    print(f"      {len(history['snapshots'])} snapshot(s) on record")

    meta = {
        "generated": generated,
        "camera_count": cameras["count"],
        "flock_camera_count": cameras["flock_count"],
        "agency_count": len(agencies),
        "portal_count": len(portals) + len(hand_read),
        "hand_read_portal_count": len(hand_read),
        "curated_count": len(overlay),
        "wisdot_camera_count": wisdot["camera_count"],
        "wisdot_agency_count": with_wisdot,
        "wisdot_permits_by_year": dict(sorted(permits_by_year.items())),
        "stale_days_threshold": STALE_DAYS,
        "usatoday": {"retrieved": usat["retrieved"], "url": usat["url"], "coverage": usat["coverage"], "notes": usat["notes"]},
        "stale_portal_count": len(stale),
        "national": national,
        "attribution": {
            "cameras": "Camera locations © OpenStreetMap contributors, mapped by the DeFlock community (deflock.org)",
            "portals": "Transparency portal statistics aggregated by Eyes On Flock (eyesonflock.com)",
            "atlas": "Agency records from EFF's Atlas of Surveillance (atlasofsurveillance.org)",
            "wisdot": "State-highway camera permits from Wisconsin DOT records, obtained under the Wisconsin Open Records Law and mapped by Deflock Dane (deflockdane.org)",
            "usatoday": "Search records from Flock usage audit logs obtained under public-records laws and analyzed by USA TODAY (data.usatoday.com/projects/flock-search)",
        },
    }

    cameras["generated"] = generated
    (DATA / "cameras.json").write_text(json.dumps(cameras, separators=(",", ":")), encoding="utf-8")
    (DATA / "agencies.json").write_text(json.dumps({"generated": generated, "agencies": agencies, "unmatched_operators": unmatched_operators}, separators=(",", ":")), encoding="utf-8")
    (DATA / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (DATA / "history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
    (DATA / "edges.json").write_text(json.dumps({"generated": generated, "edges": sharing}, separators=(",", ":")), encoding="utf-8")
    (DATA / "counties.json").write_text(json.dumps(counties, separators=(",", ":")), encoding="utf-8")
    print(f"Done. {len(agencies)} agencies, {cameras['count']} cameras -> data/")


if __name__ == "__main__":
    sys.exit(main())
