# The Watch Ledger — Claude Code handoff context

WPR (Wausau Pilot & Review) statewide tracker of ALPR / Flock Safety surveillance:
every community-mapped camera in Wisconsin, every agency in the Flock sharing network,
transparency portal stats, and hand-verified contract status. Embeds in WordPress via iframe.

## Architecture (one path, no fallbacks)

Python pipeline -> validated static JSON in `data/` -> GitHub Actions weekly -> React/Vite
in `site/` -> GitHub Pages. Any pipeline failure aborts the run; the site keeps serving
the last committed data. Never add retry/fallback logic — fail loudly instead.

- `pipeline/refresh.py` — the only entry point (`python pipeline/refresh.py`)
  1. Overpass API: WI nodes tagged `surveillance:type=ALPR` -> `data/cameras.json`
  2. Eyes On Flock (`eyesonflock.com/api/v1/data`, undocumented community API):
     WI transparency portals + WI agency roster DERIVED from every portal's
     `organizations_shared_with` lists nationwide -> portal stats + network edges
  3. EFF Atlas of Surveillance CSV (`atlasofsurveillance.org/download`): sourced WI ALPR rows
  4. Merge on `canonicalize(name)` keys + apply `data/status_overlay.json` and join
     `data/wisdot_permits.json` -> `data/agencies.json`, `data/meta.json`
- `data/wisdot_permits.json` — COMMITTED SNAPSHOT of WisDOT state-highway right-of-way
  permit records (obtained under the WI Open Records Law; mapped by Deflock Dane,
  deflockdane.org — attribute them). Validated at every build, fails if missing. Refreshed
  by a new records release, not the weekly run. Registry typos are corrected only via the
  hand-checked WISDOT_OWNER_ALIASES map in refresh.py; ambiguous owners stay as written.
- `data/status_overlay.json` — HAND-CURATED, never generated. Overlay always wins.
  Keys must be canonical (`canonicalize(key) == key`, validated at build).
  Required per row: name, status (active|dropped|never), as_of, source URL.
- `site/` — React 18 + Leaflet (raw, no react-leaflet), hand-rolled table, no UI libs.
  `cpdata.mjs` copies `../data/*.json` into `public/data/` on every dev/build.

## Name matching

`canonicalize()` collapses variants across sources: strips apostrophes/periods first
(sheriff's -> sheriffs), drops WI/Wisconsin tokens, expands Co -> County and St -> Saint,
maps suffixes (Police Department -> pd, Sheriffs Office/bare Sheriff -> so).
"Marathon County Sheriff's Office" == "Marathon County WI SO" == "Marathon Co Sheriff".
Display-name precedence: overlay > Atlas (formal) > portal/edge shorthand.

## Design system (WPR)

teal #3A867C / deep #2C6B62, cream #F6F2E9, ink #1F2421, rust #B5543B (dropped status).
Fraunces display, Public Sans body, JetBrains Mono for data. Signature element: the
transparency-gap tick bar (one tick per network agency, filled = publishes a portal).

## Known constraints

- Flock's own transparency portals sit behind Cloudflare JS challenges — do NOT try to
  scrape transparency.flocksafety.com directly. Eyes On Flock is the one correct source.
- Overpass etiquette: single weekly query, identified User-Agent. Don't shorten the cron.
- Camera locations are crowdsourced and incomplete — copy must never imply completeness.

## Backlog (not v1)

- Records requests: Wausau PD + Marathon County SO Flock audit logs (the Waukesha treatment).
  One agency's NETWORK audit names every agency that searched it (Wisconsin Examiner proved
  this statewide); cross-submit obtained logs to haveibeenflocked.com
- Sharing-network graph visualization from the organizations_shared_with edges
- Contracts overlay (amount, term, source per agency) fed by Legistar/CivicClerk agenda
  mining + records requests; Deflock Dane's reading room has six Dane County contracts
- TODO in App.jsx: real corrections contact for the newsroom
