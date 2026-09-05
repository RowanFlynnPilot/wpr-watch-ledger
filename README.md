# The Watch Ledger

Wausau Pilot & Review's statewide tracker of automated license plate reader (ALPR)
surveillance in Wisconsin: every community-mapped camera, every agency in the Flock
Safety data-sharing network, per-agency transparency portal statistics, and
hand-verified contract status with sources.

## Run locally

```
python -m pip install -r pipeline/requirements.txt
python pipeline/refresh.py
cd site; npm install; npm run dev
```

## Audit before publishing

```
python pipeline/audit.py
```

Read-only. Sixty cross-checks over `data/*.json` (meta vs files, roster integrity, history
and edges vs portals, county rollup recomputed, USA TODAY and ICE joins, unmapped rings by
brute force) and a printout of every headline figure the site derives, to compare against
the page. Exits non-zero on any failure.

## Deploy

1. Push to a new GitHub repo (`main` branch)
2. Repo Settings -> Pages -> Source: **GitHub Actions**
3. Repo Settings -> Actions -> General -> Workflow permissions: **Read and write**
4. Pushes deploy the site from committed data (`deploy.yml`, no pipeline run).
   Data refreshes every Monday 3 AM Central via `refresh.yml` — the only workflow
   that queries the sources — or on manual dispatch.

## Embed in WordPress

Paste both parts into ONE **Custom HTML** block (not a paragraph block, which converts the
quotes and breaks the markup). Use the block's HTML view, not the visual preview.

```html
<iframe id="watch-ledger" src="https://rowanflynnpilot.github.io/wpr-watch-ledger/"
        style="width:100%;border:none;height:1200px" title="The Watch Ledger"
        loading="lazy" referrerpolicy="no-referrer-when-downgrade"
        allow="geolocation; clipboard-write; web-share"></iframe>
<script>
window.addEventListener("message", function (e) {
  if (!e.data || e.data.source !== "wpr-watch-ledger") return;
  var frame = document.getElementById("watch-ledger");
  if (!frame || e.origin !== new URL(frame.src).origin) return;
  if (typeof e.data.height === "number" && e.data.height > 0) {
    frame.style.height = Math.ceil(e.data.height) + "px";
  }
});
</script>
```

What each part does, and what breaks without it:

- The site posts its rendered height to the embedding page (`{source: "wpr-watch-ledger",
  height}`) whenever content changes; the listener sizes the iframe to match, so there is no
  inner scrollbar and no clipped bottom. `height:1200px` is only the placeholder before the
  first message arrives.
- `allow="geolocation; clipboard-write; web-share"`: browsers block those three inside a
  cross-origin iframe unless the parent grants them. Without it, the map's "Near me" button,
  the Bookmark button's link copy, and Share silently fail.
- `referrerpolicy="no-referrer-when-downgrade"`: lets the tool see the article's full address
  so the Bookmark button copies the article, not the newsroom homepage.
- GitHub Pages sends no X-Frame-Options or frame-ancestors header, so any site may frame it.

**If WordPress strips the `<script>`** (WordPress.com plans without custom code, a security
plugin, or an author role without `unfiltered_html`): the iframe stays at the placeholder
height and scrolls inside itself. Use this script-free fallback instead and set the height to
taste; the tool's map ignores the scroll wheel so it will not fight the page:

```html
<iframe src="https://rowanflynnpilot.github.io/wpr-watch-ledger/"
        style="width:100%;border:none;height:90vh;min-height:800px" title="The Watch Ledger"
        loading="lazy" referrerpolicy="no-referrer-when-downgrade"
        allow="geolocation; clipboard-write; web-share"></iframe>
```

AMP pages strip both iframes and scripts; if the site serves AMP to mobile readers, either
disable AMP for the article or use `<amp-iframe>` with a fixed height.

## Editorial workflow

Contract status lives in `data/status_overlay.json` and always wins over derived status.
See CLAUDE.md for the row schema. Every row requires a source URL and an as-of date.

## Attribution

- Camera locations © OpenStreetMap contributors, mapped by the DeFlock community (deflock.org)
- Transparency portal statistics aggregated by Eyes On Flock (eyesonflock.com)
- Agency records from EFF's Atlas of Surveillance (atlasofsurveillance.org)
- Search records from Flock usage audit logs obtained under public-records laws and analyzed
  by USA TODAY (data.usatoday.com/projects/flock-search). `data/usatoday_flock_search.json`
  is a committed snapshot of the Wisconsin slice.
- ICE 287(g) agreements from U.S. Immigration and Customs Enforcement's participating-agencies
  list (ice.gov/identify-and-arrest/287g). `data/ice_287g.json` is a committed snapshot of the
  Wisconsin rows.
- State-highway camera permits from Wisconsin DOT records, obtained under the Wisconsin
  Open Records Law and mapped by Deflock Dane (deflockdane.org). `data/wisdot_permits.json`
  is a committed snapshot — refresh it when WisDOT releases new records, not on the cron.
