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
     `organizations_shared_with` lists nationwide -> portal stats + network edges.
     EOF `total_cameras` is Flock's TOTAL camera count (LPR plus any other Flock
     cameras, e.g. Delafield 9 total / 7 LPR); label it "cameras on the portal", never "ALPRs".
     Also carried through per portal: `updated`/`stale_days` (from `data_last_updated`;
     a portal frozen > STALE_DAYS=45 is flagged and excluded from statewide 30-day
     totals on the site), `hit_rate`, and `reach` (shared/received lists split WI vs
     out-of-state with the states reached; Flock's demo/deactivated placeholders dropped;
     `reach.received` is null when the portal publishes no inbound list)
  3. EFF Atlas of Surveillance CSV (`atlasofsurveillance.org/download`): sourced WI ALPR rows
  4. Merge on `canonicalize(name)` keys + apply `data/status_overlay.json` and join
     `data/wisdot_permits.json` -> `data/agencies.json`, `data/meta.json`.
     OSM `operator` tags are joined to the roster by canonical name (bare municipality ->
     its PD, bare county -> its SO) into `osm_cameras`; vendors are ignored and unmatched
     operators (Lowe's, Home Depot, hospitals...) are emitted as
     `agencies.json.unmatched_operators`, never guessed into an agency.
     `meta.wisdot_permits_by_year` is the permit-approval timeline.
- `data/wisdot_permits.json` — COMMITTED SNAPSHOT of WisDOT state-highway right-of-way
  permit records (obtained under the WI Open Records Law; mapped by Deflock Dane,
  deflockdane.org — attribute them). Validated at every build, fails if missing. Refreshed
  by a new records release, not the weekly run. Registry typos are corrected only via the
  hand-checked WISDOT_OWNER_ALIASES map in refresh.py; ambiguous owners stay as written.
- `data/usatoday_flock_search.json` — COMMITTED SNAPSHOT of the Wisconsin slice of USA
  TODAY's Flock search-records tool (data.usatoday.com/projects/flock-search): cumulative
  audit-log searches per agency (Jan 2023 - Apr 2026, 249 agencies, 1.87M searches) plus
  the WI rows among the 5,000 highest "frequency score" plate searches nationally. Built
  from the page's three static files (state_summary.json, org_map.json, data/initial.json)
  by a one-off script; validated at build (keys, totals must sum). Joined by canonical
  name into `agency.usatoday`; USAT_ALIASES folds units (Milwaukee PD - STAC) into their
  department. An agency with searches > 0 joins the network roster (derived active).
  NEVER put these cumulative counts in the same column as, or add them to, the portals'
  30-day session figures. Attribute USA TODAY. Flock withdrew the audit view in Dec 2025,
  so this does not refresh; re-snapshot only if USA TODAY republishes.
- `data/ice_287g.json` — COMMITTED SNAPSHOT of the Wisconsin rows of ICE's 287(g)
  participating-agencies spreadsheet (ice.gov/identify-and-arrest/287g -> file-download
  208912; one row per signed agreement; 20 sheriff's offices as of 2026-09-05). Validated at
  build; joined by canonical name into `agency.ice_287g` (agreements, models, first_signed)
  and counted per county. Does not touch in_network. Re-download when ICE updates the list.
- `data/wi_counties.json` — COMMITTED SNAPSHOT of Wisconsin county boundaries (Census
  cartographic boundary files via plotly/datasets, Douglas-Peucker simplified to 0.0015°,
  names normalized to the DOA list). Validated at build (72 MultiPolygon features). Each
  community-mapped camera gets `county` by point-in-polygon in refresh.py; the site's
  county picker filters dots and rings by it and draws the outlines.
- `data/wi_population.json` — COMMITTED SNAPSHOT of WI DOA official final population
  estimates (state/counties/places/towns). Joined at build into `data/counties.json`
  (per-county rollup + statewide coverage); county spellings are validated against DOA's
  official list and a mismatch aborts the run.
- `data/status_overlay.json` — HAND-CURATED, never generated. Overlay always wins.
  Keys must be canonical (`canonicalize(key) == key`, validated at build).
  Required per row: name, status (active|dropped|never), as_of, source URL.
  Optional `portal` block = a HAND-READ transparency portal that Eyes On Flock does not
  index (Marathon County SO and Wausau PD both have live portals EOF misses, found
  2026-09-01). A person opens transparency.flocksafety.com/<slug> in a browser and copies
  the figures; `read_on` is the date they did so and drives staleness exactly like an
  EOF portal's `data_last_updated`, so a hand-read portal drops out of the statewide
  totals after STALE_DAYS unless re-read. Required: portal_url, read_on. Optional ints:
  cameras (LPR count), searches_30d, vehicles_captured_30d, hotlist_hits_30d,
  retention_days, shared_total, shared_wi, received_total, received_wi (null = the
  portal does not publish that figure); lists shared_states /
  received_states (out-of-state codes); public_search_audit, prohibited_uses.
  EOF wins the moment it indexes the agency. The pipeline never fetches these itself
  (Cloudflare challenge; see constraints) — they are editorial, like status.
- `site/` — React 18 + Leaflet (raw, no react-leaflet), hand-rolled table, no UI libs.
  ATLAS_NAME_ALIASES in refresh.py corrects Atlas typos that would otherwise create a
  second roster row ("Mequon Police Departmet", "Croix County Sheriff's Office").
  Basemap is Esri World Light Gray Canvas (keyless). CARTO's raster basemaps started
  demanding an API key in 2026 (tiles render "API KEY REQUIRED") and are being retired;
  do not switch back. Every chart (sparklines, week-by-week, reach bars, permit timeline,
  inner-circle graph) is plain SVG/CSS — no chart library.
  `cpdata.mjs` copies the listed `../data/*.json` files into `public/data/` on every dev/build — add any new data file to that list or the site gets index.html back as JSON.

## Name matching

`canonicalize()` collapses variants across sources: strips apostrophes/periods first
(sheriff's -> sheriffs), drops WI/Wisconsin tokens, expands Co -> County and St -> Saint,
maps suffixes (Police Department -> pd, Sheriffs Office/bare Sheriff -> so), and strips a
leading "City of"/"Village of" (never "Town of": Town of Delavan PD and City of Delavan PD
are different departments).
"Marathon County Sheriff's Office" == "Marathon County WI SO" == "Marathon Co Sheriff".
Display-name precedence: overlay > Atlas (formal) > portal/edge shorthand, then `pretty_name()`
applies one house style to every non-overlay name (Co -> County, trailing SO/PD/Hwy expanded,
"Town Of" -> "Town of", curly apostrophes straightened). Overlay names only get the apostrophe fix.

## Design system (WPR)

teal #3A867C / deep #2C6B62, cream #F6F2E9, ink #1F2421, rust #B5543B (dropped status).
Fraunces display, Public Sans body, JetBrains Mono for data. Signature element: the
transparency-gap tick bar (one tick per network agency, filled = publishes a portal).

## Known constraints

- Flock's own transparency portals sit behind Cloudflare JS challenges — do NOT try to
  scrape transparency.flocksafety.com directly. Eyes On Flock is the one correct source.
- Overpass etiquette: single weekly query, identified User-Agent. Don't shorten the cron.
  Only refresh.yml (Monday 08:00 UTC cron + manual dispatch) queries Overpass, with one
  workflow-level 15-minute-backoff retry; site-code pushes deploy from committed data via
  deploy.yml and never touch the pipeline. Local dev runs should avoid Overpass when the
  change doesn't need fresh camera data.
- Camera locations are crowdsourced and incomplete — copy must never imply completeness.

## Backlog (not v1)

- Records requests: Wausau PD + Marathon County SO Flock audit logs (the Waukesha treatment).
  One agency's NETWORK audit names every agency that searched it (Wisconsin Examiner proved
  this statewide); cross-submit obtained logs to haveibeenflocked.com
- Full sharing-network graph (all 249 agencies) from the organizations_shared_with edges;
  the inner circle (portal agencies only) and inbound reach bars ship today
- Contracts overlay (amount, term, source per agency) fed by Legistar agenda mining +
  records requests; Deflock Dane's reading room has six Dane County contracts. Scoped
  2026-08: webapi.legistar.com serves milwaukee, madison, racine, waukesha,
  milwaukeecounty; substringof('Flock', MatterTitle) returns real contract matters
  (Waukesha 2022 pilot -> 2023 5-yr agreement -> 2025 expansion). Needs editorial review
  before publish — Madison returns false positives like "#FLOCKTOSTATE".
- TODO in App.jsx: real corrections contact for the newsroom
