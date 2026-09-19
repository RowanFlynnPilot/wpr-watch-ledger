"""Flock watch: tell a person when the news has moved past the ledger.

Nothing in refresh.py can notice a news event, and the tenth audit (2026-09-19) found the
status overlay three weeks and 19 agencies behind a story the newsroom itself was covering.
This script looks for new stories and opens ONE GitHub issue listing them, assigned to the
repo owner (GitHub emails the assignee). It never edits data: the overlay stays hand-curated.

  python pipeline/watch_news.py --dry-run     print what it would file
  python pipeline/watch_news.py               file the issue (needs the gh CLI and GH_TOKEN)

Sources: the newsroom's own posts (WordPress REST search) and a Google News search for
Wisconsin Flock stories. A story already linked or titled in an earlier flock-watch issue,
open or closed, is never reported twice. Run by .github/workflows/watch-news.yml.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

LOOKBACK_DAYS = 10
LABEL = "flock-watch"
DATA = Path(__file__).resolve().parent.parent / "data"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}

WPR_API = "https://wausaupilotandreview.com/wp-json/wp/v2/posts"
NEWS_RSS = "https://news.google.com/rss/search"
NEWS_QUERY = 'Wisconsin "Flock" (cameras OR "license plate") when:{days}d'

ON_TOPIC = re.compile(r"\bFlock\b|license[- ]plate (reader|camera)|\bALPRs?\b")
# Words that suggest an agency changed what it does. Lawsuits and "will keep" stories are listed
# in the issue but are not status changes, so they do not raise a ledger hint.
ACTION = re.compile(r"\b(drop|end|ends|ended|ending|cancel|terminat|suspend|paus|cover|remov|vote|ditch|cut ties|"
                    r"pull|halt|stop|scrap|not renew|defund|discontinu|bag)", re.I)


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def newsroom_stories(since: datetime) -> list[dict]:
    q = urllib.parse.urlencode({"search": "flock", "after": since.strftime("%Y-%m-%dT%H:%M:%S"),
                                "per_page": 30, "_fields": "date,link,title,excerpt"})
    out = []
    for p in json.loads(get(f"{WPR_API}?{q}")):
        title = html.unescape(p["title"]["rendered"]).strip()
        excerpt = re.sub(r"<[^>]+>", " ", html.unescape(p.get("excerpt", {}).get("rendered", "")))
        if ON_TOPIC.search(title) or (ON_TOPIC.search(excerpt) and re.search(r"camera|plate|surveill", excerpt, re.I)):
            out.append({"date": p["date"][:10], "title": title, "link": p["link"], "outlet": "Wausau Pilot & Review"})
    return sorted(out, key=lambda s: s["date"], reverse=True)


def statewide_stories(since: datetime) -> list[dict]:
    q = urllib.parse.urlencode({"q": NEWS_QUERY.format(days=LOOKBACK_DAYS), "hl": "en-US", "gl": "US", "ceid": "US:en"})
    out, seen = [], set()
    for it in ET.fromstring(get(f"{NEWS_RSS}?{q}")).findall(".//item"):
        full = (it.findtext("title") or "").strip()
        title, _, outlet = full.rpartition(" - ")
        title, outlet = (title or full).strip(), (it.findtext("source") or outlet).strip()
        try:
            when = parsedate_to_datetime(it.findtext("pubDate"))
        except (TypeError, ValueError):
            continue
        key = norm(title)
        if when < since or key in seen or not ON_TOPIC.search(title) or "Wausau Pilot" in outlet:
            continue
        seen.add(key)
        out.append({"date": when.strftime("%Y-%m-%d"), "title": title, "link": it.findtext("link"), "outlet": outlet})
    return sorted(out, key=lambda s: s["date"], reverse=True)


def norm(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def already_reported() -> str:
    """Everything said in earlier flock-watch issues, open or closed, as one searchable blob."""
    r = subprocess.run(["gh", "issue", "list", "--label", LABEL, "--state", "all", "--limit", "200", "--json", "body"],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        raise RuntimeError(f"gh issue list failed: {r.stderr.strip()}")
    bodies = "\n".join(i["body"] or "" for i in json.loads(r.stdout or "[]"))
    return bodies + "\n" + norm(bodies)


def ledger_gaps(stories: list[dict]) -> list[str]:
    """Agencies a headline seems to say acted, that the ledger still lists as active or unverified."""
    agencies = json.loads((DATA / "agencies.json").read_text(encoding="utf-8"))["agencies"]
    hints = []
    for a in agencies:
        if a["status"]["value"] not in ("active", "unknown"):
            continue
        name = a["name"].replace("’", "'")
        m = re.match(r"^(.+?) County Sheriff's Office$", name)
        u = re.match(r"^University of Wisconsin\s*-\s*(.+?) Police Department$", name)
        if m:      # "Jefferson County" or the headline writer's "Jefferson Co."
            pat = re.compile(rf"\b{re.escape(m.group(1))} Co(unty|\.)")
        elif u:    # campuses are "UW-Milwaukee" or "UWM" in headlines, never the full name
            pat = re.compile(rf"\bUW[- ]?{re.escape(u.group(1))}\b|\bUW{re.escape(u.group(1)[0])}\b")
        else:
            place = re.sub(r"^(City|Village|Town) of ", "", re.sub(r" Police Department$", "", name))
            if place == name or len(place) < 5:
                continue
            # a city, not its county and not its UW campus
            pat = re.compile(rf"(?<!UW-)(?<!UW )\b{re.escape(place)}\b(?! Co(unty|\.))")
        for s in stories:
            if pat.search(s["title"]) and ACTION.search(s["title"]):
                hints.append(f"- **{a['name']}** is `{a['status']['value']}` in the ledger. Headline: \"{s['title']}\" ({s['outlet']}, {s['date']})")
                break
    return hints


def main() -> None:
    dry = "--dry-run" in sys.argv
    since = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)
    own, wide = newsroom_stories(since.replace(tzinfo=None)), statewide_stories(since)
    seen = "" if dry else already_reported()
    fresh = lambda s: s["link"] not in seen and norm(s["title"]) not in seen
    own, wide = [s for s in own if fresh(s)], [s for s in wide if fresh(s)]
    # headlines that report an agency acting come first; the rest is context
    wide.sort(key=lambda s: not ACTION.search(s["title"]))  # stable: newest first within each half
    print(f"new since {since:%Y-%m-%d}: {len(own)} newsroom, {len(wide)} statewide")
    if not own and not wide:
        return
    gaps = ledger_gaps(own + wide)
    line = lambda s: f"- {s['date']} · [{s['title']}]({s['link']}) · {s['outlet']}"
    body = "\n".join([
        "New Flock stories since the last check. The ledger's status list is hand-curated, so nothing here has been applied.",
        "",
        "### Possibly not in the ledger yet" if gaps else "",
        *(gaps if gaps else []),
        "" if gaps else "",
        f"### Wausau Pilot & Review ({len(own)})" if own else "",
        *[line(s) for s in own],
        "" if own else "",
        f"### Statewide ({len(wide)})" if wide else "",
        *[line(s) for s in wide[:25]],
        # Everything past the first 25 still has to be IN the issue: the issue text is this
        # script's only memory of what it has already reported.
        *(["", f"<details><summary>and {len(wide) - 25} more</summary>", "", *[line(s) for s in wide[25:]], "", "</details>"]
          if len(wide) > 25 else []),
        "",
        "### What to do",
        "- [ ] For each agency that ended, voted to end or will not renew: add or update a `dropped` row in `data/status_overlay.json`",
        "- [ ] For each agency that covered or stopped using cameras with no contract decision: a `suspended` row",
        "- [ ] Promote a `suspended` row to `dropped` when a termination is reported",
        "- [ ] If the newsroom published on Wausau PD or the Marathon County sheriff, update those two rows to match",
        "- [ ] Run the refresh workflow, then close this issue",
        "",
        "_Headline matching is a hint, not a finding: read the story before changing a row._",
    ])
    body = re.sub(r"\n{3,}", "\n\n", body)
    title = f"Flock watch: {len(own) + len(wide)} new stor{'y' if len(own) + len(wide) == 1 else 'ies'}, {datetime.now(timezone.utc):%b %d}"
    if dry:
        print(title, "\n", body)
        return
    subprocess.run(["gh", "label", "create", LABEL, "--color", "B5543B", "--description",
                    "News the hand-curated status list may not reflect yet", "--force"], check=True, capture_output=True)
    cmd = ["gh", "issue", "create", "--title", title, "--body", body, "--label", LABEL]
    owner = (sys.argv[sys.argv.index("--assign") + 1] if "--assign" in sys.argv else "").strip()
    if owner:
        cmd += ["--assignee", owner]
    print(subprocess.run(cmd, check=True, capture_output=True, text=True).stdout.strip())


if __name__ == "__main__":
    main()
