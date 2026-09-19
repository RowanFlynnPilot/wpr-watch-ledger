"""Rebuild data/usatoday_flock_search.json: the Wisconsin slice of USA TODAY's Flock
search-records tool (data.usatoday.com/projects/flock-search).

Run by hand, never by the weekly job:  python pipeline/snapshot_usatoday.py
USA TODAY republishes occasionally and reassigns its org_ids when it does, so the snapshot
is rebuilt whole. Check for a republish by comparing the live Wisconsin row of
state_summary.json with `coverage` in the committed file (the tenth audit did, 2026-09-19).
After running: python pipeline/refresh.py (or a CI refresh), then python pipeline/audit.py.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://data.usatoday.com/projects/flock-search/"
FILES = ["state_summary.json", "org_map.json", "data/initial.json"]
# USA TODAY's edge answers 406 to anything that does not look like a browser, and to the
# extra headers the requests library adds, so this uses urllib with a browser identifier.
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
OUT = Path(__file__).resolve().parent.parent / "data" / "usatoday_flock_search.json"


def get(path: str):
    with urllib.request.urlopen(urllib.request.Request(BASE + path, headers=UA), timeout=180) as r:
        return json.loads(r.read())


def main() -> None:
    summary, org_map, initial = (get(f) for f in FILES)
    wi = next(s for s in summary if s["state"] == "WI")
    nation = next(s for s in summary if s["state"] == "")
    orgs = [o for o in org_map if o["state"] == "WI"]
    if len(orgs) != wi["agencies"]:
        raise RuntimeError(f"org_map has {len(orgs)} WI agencies, state_summary says {wi['agencies']}")
    total = sum(o["total"] for o in orgs)
    if total != wi["searches"]:
        raise RuntimeError(f"WI agency totals sum to {total:,}, state_summary says {wi['searches']:,}")
    ids = {o["org_id"] for o in orgs}
    split = lambda s: [p.strip() for p in (s or "").split("§") if p.strip()]
    flagged = [{
        "org_id": r["org_id"], "user": r["out2"], "plate": r["license_plate"], "count": r["count"],
        "days_active": r["days_active"], "first_seen": r["first_seen"][:10], "last_seen": r["last_seen"][:10],
        "reasons": split(r["reasons"]), "score": r["score"],
    } for r in initial if r["org_id"] in ids]

    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    snapshot = {
        "source": "USA TODAY, Flock Safety Records Search",
        "url": BASE,
        "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "files": FILES,
        "coverage": {
            "state": "WI", "first_seen": wi["first_seen"][:10], "last_seen": wi["last_seen"][:10],
            "searches": wi["searches"], "agencies": wi["agencies"], "users": wi["users"],
            "plates": wi["plates"], "records": wi["records"],
            "national_searches": nation["searches"], "national_agencies": nation["agencies"],
        },
        "notes": previous["notes"] if previous else [],
        "agencies": sorted(({"org_id": o["org_id"], "name": o["org_name"], "searches": o["total"]} for o in orgs),
                           key=lambda a: (-a["searches"], a["name"])),
        "high_frequency": sorted(flagged, key=lambda r: (-r["score"], -r["count"], r["plate"])),
    }
    if previous:
        was = {a["name"]: a["searches"] for a in previous["agencies"]}
        now = {a["name"]: a["searches"] for a in snapshot["agencies"]}
        print(f"searches {previous['coverage']['searches']:,} -> {wi['searches']:,}; "
              f"agencies {len(was)} -> {len(now)}; flagged rows {len(previous['high_frequency'])} -> {len(flagged)}")
        print("new agencies:", sorted(set(now) - set(was)))
        print("gone agencies:", sorted(set(was) - set(now)))
        moved = sorted(((n, was[n], now[n]) for n in now if n in was and was[n] != now[n]), key=lambda x: x[1] - x[2])
        print(f"{len(moved)} agencies changed; largest:", moved[:6])
    OUT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
