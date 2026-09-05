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

## Deploy

1. Push to a new GitHub repo (`main` branch)
2. Repo Settings -> Pages -> Source: **GitHub Actions**
3. Repo Settings -> Actions -> General -> Workflow permissions: **Read and write**
4. Pushes deploy the site from committed data (`deploy.yml`, no pipeline run).
   Data refreshes every Monday 3 AM Central via `refresh.yml` — the only workflow
   that queries the sources — or on manual dispatch.

## Embed in WordPress

The site posts its rendered height to the embedding page (`{source: "wpr-watch-ledger",
height}`) whenever content changes, so the iframe can size itself — no hardcoded
min-height. Paste both the iframe and the listener into a Custom HTML block:

```html
<iframe id="watch-ledger" src="https://YOUR-GH-USERNAME.github.io/wpr-watch-ledger/"
        style="width:100%;border:none;height:1200px" title="The Watch Ledger"
        loading="lazy"></iframe>
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

The `height:1200px` is only the placeholder before the first message arrives.

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
- State-highway camera permits from Wisconsin DOT records, obtained under the Wisconsin
  Open Records Law and mapped by Deflock Dane (deflockdane.org). `data/wisdot_permits.json`
  is a committed snapshot — refresh it when WisDOT releases new records, not on the cron.
