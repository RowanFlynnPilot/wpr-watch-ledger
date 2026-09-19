"""Rebuild data/ice_287g.json: the Wisconsin rows of ICE's 287(g) participating-agencies
spreadsheet (ice.gov/identify-and-arrest/287g).

Run by hand, never by the weekly job:  python pipeline/snapshot_ice.py
Needs openpyxl (pip install openpyxl). ICE replaces the spreadsheet every few days under a new
file-download id, so the id is read from the landing page rather than stored.
After running: python pipeline/refresh.py (or a CI refresh), then python pipeline/audit.py.
"""
from __future__ import annotations

import io
import json
import re
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import openpyxl

PAGE = "https://www.ice.gov/identify-and-arrest/287g"
# ice.gov answers 403 to Python's HTTP clients whatever headers they send (it fingerprints the
# connection), but serves curl with browser headers. curl ships with Windows, macOS and Linux.
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": PAGE,
}
OUT = Path(__file__).resolve().parent.parent / "data" / "ice_287g.json"


def get(url: str) -> bytes:
    args = ["curl", "--silent", "--show-error", "--fail", "--location", "--max-time", "120"]
    for k, v in HEADERS.items():
        args += ["-H", f"{k}: {v}"]
    return subprocess.run(args + [url], check=True, capture_output=True).stdout


def main() -> None:
    page = get(PAGE).decode("utf-8", "replace")
    m = re.search(r'href="([^"]*/file-download/download/public/\d+)"[^>]*>\s*View 287\(g\) Participating Agencies', page)
    if not m:
        raise RuntimeError("Could not find the participating-agencies spreadsheet link on ICE's 287(g) page")
    file_url = m.group(1) if m.group(1).startswith("http") else "https://www.ice.gov" + m.group(1)
    rows = [r[:8] for r in openpyxl.load_workbook(io.BytesIO(get(file_url)), read_only=True).worksheets[0].iter_rows(values_only=True)]
    header = [str(c).strip().upper() if c else "" for c in rows[0]]
    want = ["STATE", "LAW ENFORCEMENT AGENCY", "TYPE", "COUNTY", "SUPPORT TYPE", "SIGNED", "MOA"]
    if header[:7] != want:
        raise RuntimeError(f"ICE spreadsheet columns changed: {header[:8]}")
    text = lambda v: str(v).strip() if v is not None else None
    day = lambda v: v.strftime("%Y-%m-%d") if isinstance(v, (datetime, date)) else text(v)
    body = [r for r in rows[1:] if r[0]]
    agreements = sorted(({"agency": text(r[1]), "county": text(r[3]), "support_type": text(r[4]),
                          "signed": day(r[5]), "moa": text(r[6])}
                         for r in body if text(r[0]).upper() in ("WI", "WISCONSIN")),
                        key=lambda a: (a["agency"], a["support_type"]))
    if not agreements:
        raise RuntimeError("No Wisconsin rows found; refusing to write an empty snapshot")

    previous = json.loads(OUT.read_text(encoding="utf-8"))
    sig = lambda rows_: sorted((a["agency"], a["support_type"], a["signed"]) for a in rows_)
    was, now = sig(previous["agreements"]), sig(agreements)
    print(f"Wisconsin agreements {len(was)} -> {len(now)}; national rows {previous['national_rows']} -> {len(body)}")
    print("added:", [x for x in now if x not in was])
    print("removed:", [x for x in was if x not in now])
    snapshot = {**previous, "file_url": file_url, "retrieved": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "national_rows": len(body), "agreements": agreements}
    OUT.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
