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
4. Push (or run the `refresh-and-deploy` workflow manually). Data refreshes every Monday 6 AM Central.

## Embed in WordPress

```html
<iframe src="https://YOUR-GH-USERNAME.github.io/wpr-watch-ledger/"
        style="width:100%;border:none;min-height:3400px" title="The Watch Ledger"
        loading="lazy"></iframe>
```

## Editorial workflow

Contract status lives in `data/status_overlay.json` and always wins over derived status.
See CLAUDE.md for the row schema. Every row requires a source URL and an as-of date.

## Attribution

- Camera locations © OpenStreetMap contributors, mapped by the DeFlock community (deflock.org)
- Transparency portal statistics aggregated by Eyes On Flock (eyesonflock.com)
- Agency records from EFF's Atlas of Surveillance (atlasofsurveillance.org)
