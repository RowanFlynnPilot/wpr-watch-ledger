import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";

const WI_BOUNDS = [[42.4, -93.0], [47.1, -86.7]];
const MARATHON_BOUNDS = [[44.68, -90.36], [45.15, -89.15]];
// fitBounds on a 0 x 0 map gives Leaflet a NaN zoom (see the setup effect): skip it until the map has a size.
const fitIfSized = (map, bounds, opts) => { const s = map?.getSize(); if (s && s.x && s.y) map.fitBounds(bounds, opts); };
const NEAR_M = 150; // a ring with no volunteer dot within this many meters is "unmapped"

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Haversine in meters, good enough at Wisconsin latitudes.
const dist = (a, b) => {
  const r = 6371000, d2r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * d2r, dLon = (b.lon - a.lon) * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * d2r) * Math.cos(b.lat * d2r) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

// Permitted cameras with no community dot nearby: leads for volunteers, and the
// honest measure of how incomplete the crowd-sourced map still is.
function findUnmapped(cameras, wisdotCameras) {
  const cell = 0.003; // ~330 m north-south; a 3x3 neighbourhood covers 150 m at any offset
  const grid = new Map();
  for (const c of cameras) {
    const k = `${Math.floor(c.lat / cell)}:${Math.floor(c.lon / cell)}`;
    (grid.get(k) || grid.set(k, []).get(k)).push(c);
  }
  return wisdotCameras.filter((w) => {
    const gi = Math.floor(w.lat / cell), gj = Math.floor(w.lon / cell);
    for (let i = gi - 1; i <= gi + 1; i++)
      for (let j = gj - 1; j <= gj + 1; j++)
        for (const c of grid.get(`${i}:${j}`) || []) if (dist(c, w) <= NEAR_M) return false;
    return true;
  });
}

// OSM `direction` is compass degrees clockwise from north, sometimes a cardinal, sometimes
// several values joined by ";" for a pole carrying more than one camera.
const WEDGE_SPREAD = 24;
const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function bearings(direction) {
  if (direction == null) return [];
  const one = (t) => {
    const i = CARDINALS.indexOf(t);
    const n = i >= 0 ? i * 22.5 : Number(t);
    return Number.isFinite(n) && t !== "" ? ((n % 360) + 360) % 360 : null;
  };
  return String(direction).split(";").map((d) => {
    const t = d.trim().toUpperCase();
    // "324-34" is OSM's range form: a field of view swept clockwise from the first bearing.
    const r = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(t);
    if (r) {
      const a = one(r[1]), b = one(r[2]);
      const span = (b - a + 360) % 360;
      return { deg: (a + span / 2) % 360, spread: Math.min(90, Math.max(12, span / 2)) };
    }
    const deg = one(t);
    return deg == null ? null : { deg, spread: WEDGE_SPREAD };
  }).filter(Boolean);
}
const compass = (deg) => CARDINALS[Math.round(deg / 22.5) % 16];
const WEDGE_ZOOM = 14, WEDGE_M = 55;
function wedge(lat, lon, deg, spread) {
  const pts = [[lat, lon]];
  for (let a = deg - spread; a <= deg + spread + 0.01; a += spread / 3) {
    const r = (a * Math.PI) / 180;
    pts.push([lat + (WEDGE_M * Math.cos(r)) / 110540, lon + (WEDGE_M * Math.sin(r)) / (111320 * Math.cos((lat * Math.PI) / 180))]);
  }
  return pts;
}

// County shading: mapped cameras per 10,000 residents, five quantile classes over the counties
// that have any, so one outlier cannot flatten the scale. Light to dark, one hue.
const RAMP = ["#DCEBE7", "#B4D3CB", "#84B5AA", "#508F83", "#245D55"];
const NONE = "#FBF9F3";
const rateOf = (c) => (c.population > 0 ? (10000 * c.dots) / c.population : 0);
function classBreaks(stats) {
  const v = stats.filter((c) => c.dots > 0).map(rateOf).sort((a, b) => a - b);
  if (v.length < 5) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.floor(q * (v.length - 1))]);
}
const classOf = (rate, breaks) => breaks.filter((b) => rate > b).length;
const nice = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export default function CameraMap({ cameras, wisdotCameras, selectedCounties = [], shapes, outline, countyStats = [], onSelectCounties }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layers = useRef({});
  const meRef = useRef(null);
  const outlineRef = useRef(null);
  const boundsRef = useRef(null);
  const [shade, setShade] = useState(false);
  // What the current view holds, so panning and zooming always answer "how many here?"
  const [inView, setInView] = useState(null);
  const breaks = useMemo(() => classBreaks(countyStats), [countyStats]);
  const statByName = useMemo(() => new Map(countyStats.map((c) => [c.name, c])), [countyStats]);
  const [show, setShow] = useState({ flock: true, other: true, wisdot: true, unmappedOnly: false });
  const [view, setView] = useState("state");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);

  const unmapped = useMemo(() => findUnmapped(cameras, wisdotCameras), [cameras, wisdotCameras]);
  const unmappedIds = useMemo(() => new Set(unmapped.map((w) => w.permit_id || `${w.lat},${w.lon}`)), [unmapped]);
  const flockCount = cameras.filter((c) => c.manufacturer === "Flock Safety").length;

  useEffect(() => {
    // Quarter-step zoom lets the state fill the frame instead of snapping to a whole zoom level
    // that leaves it small; the grey canvas tiles scale between levels without looking soft.
    const map = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5 });
    mapRef.current = map;
    el.current.__map = map; // handle for debugging from the console
    const stateBounds = L.latLngBounds(outline ? outline.bounds : WI_BOUNDS);
    boundsRef.current = stateBounds;
    // Frame the state only once the map has a size. A page that loads hidden (a background
    // pane, a collapsed block, an iframe not yet laid out) gives the map a 0 x 0 box; fitting
    // to that hands Leaflet a NaN zoom, the bounds check below then throws, and the error
    // boundary blanks the whole ledger. Until then the map holds a plain, valid view.
    map.setView(stateBounds.getCenter(), 6);
    let framed = false;
    const frame = () => {
      const size = map.getSize();
      if (framed || !size.x || !size.y) return;
      framed = true;
      map.fitBounds(stateBounds, { padding: [14, 14], animate: false });
      // This is a map of Wisconsin: do not let it drift to the continent or another state.
      map.setMinZoom(map.getZoom() - 0.75);
      map.setMaxBounds(stateBounds.pad(0.6));
    };
    frame();
    map.on("resize", frame);
    // Leaflet only notices window resizes; a container that is revealed inside an unchanged
    // window (an opened <details>, a tab panel) needs its own watcher. invalidateSize's default
    // keeps the centre, as Leaflet's own resize handler does, so a rotated phone stays on target.
    const watcher = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => { map.invalidateSize(); frame(); })
      : null;
    watcher?.observe(el.current);

    // Panes, bottom to top: tiles, labels, the out-of-state mask, borders, then the markers.
    // Labels sit UNDER the mask so Wisconsin's cities read clearly and everyone else's fade.
    for (const [name, z] of [["labels", 250], ["mask", 300], ["shade", 320], ["borders", 350]]) {
      map.createPane(name).style.zIndex = z;
      map.getPane(name).style.pointerEvents = "none";
    }

    // Esri's Light Gray Canvas: keyless. CARTO's raster basemaps began demanding an
    // API key in 2026 (tiles render an "API KEY REQUIRED" watermark without one) and
    // are being retired, so they are no longer an option for a static embed.
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        // ODbL: the camera dots are OpenStreetMap data and must be credited wherever they are shown.
        attribution: 'Cameras &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> via <a href="https://deflock.org" target="_blank" rel="noreferrer">DeFlock</a> | Tiles &copy; <a href="https://www.esri.com">Esri</a>',
        maxZoom: 16,
      }
    ).addTo(map);
    // Place names from Esri's matching reference layer, also keyless.
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
      { pane: "labels", maxZoom: 16 }
    ).addTo(map);
    L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(map);

    if (outline) {
      const svg = L.svg({ pane: "mask" }).addTo(map);
      const rings = outline.polygons.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
      // One polygon covering the world, with Wisconsin (and its islands) cut out of it.
      L.polygon([[[-89, -360], [-89, 360], [89, 360], [89, -360]], ...rings], {
        renderer: svg, pane: "mask", stroke: false, fillColor: "#F6F2E9", fillOpacity: 0.8, fillRule: "evenodd", interactive: false,
      }).addTo(map);
      const lines = L.svg({ pane: "borders" }).addTo(map);
      if (shapes) {
        L.geoJSON(shapes, { renderer: lines, pane: "borders", interactive: false,
          style: { color: "#55594F", weight: 0.6, opacity: 0.4, fill: false } }).addTo(map);
      }
      // A pale halo under the border lifts the state off the masked background.
      L.polygon(rings.map((r) => [r]), { renderer: lines, pane: "borders", interactive: false,
        color: "#FFFDF8", weight: 5, opacity: 0.9, fill: false, lineJoin: "round" }).addTo(map);
      L.polygon(rings.map((r) => [r]), { renderer: lines, pane: "borders", interactive: false,
        color: "#1F2421", weight: 1.6, opacity: 0.85, fill: false, lineJoin: "round" }).addTo(map);
    }

    // County names, once the reader is close enough for them to help and until streets take over.
    const countyLabels = L.layerGroup();
    if (shapes) {
      for (const f of shapes.features) {
        const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
        const main = polys.reduce((a, b) => (b[0].length > a[0].length ? b : a))[0];
        const lon = (Math.min(...main.map((p) => p[0])) + Math.max(...main.map((p) => p[0]))) / 2;
        const lat = (Math.min(...main.map((p) => p[1])) + Math.max(...main.map((p) => p[1]))) / 2;
        L.marker([lat, lon], {
          interactive: false, keyboard: false, pane: "borders",
          icon: L.divIcon({ className: "county-label", html: esc(f.properties.name.replace(/ County$/, "")), iconSize: [120, 14] }),
        }).addTo(countyLabels);
      }
    }
    const syncLabels = () => {
      const z = map.getZoom();
      if (z >= 8 && z < 12.5) countyLabels.addTo(map); else countyLabels.remove();
    };
    map.on("zoomend", syncLabels);
    syncLabels();

    const renderer = L.canvas({ padding: 0.4 });
    const flock = L.layerGroup(), other = L.layerGroup(), wisdot = L.layerGroup();
    const dots = [], rings = [];
    for (const c of cameras) {
      const isFlock = c.manufacturer === "Flock Safety";
      const m = L.circleMarker([c.lat, c.lon], {
        renderer, radius: 4, weight: 1.25,
        color: isFlock ? "#2C6B62" : "#6B6B66",
        fillColor: isFlock ? "#3A867C" : "#B9B9B2",
        fillOpacity: 0.75,
      });
      m.bindPopup(
        `<p class="pop-kicker">Community-mapped camera</p>` +
          `<p class="pop-title">${esc(c.operator || c.manufacturer || "Operator and vendor not recorded")}</p>` +
          (c.operator ? `<p class="pop-row"><span>Vendor</span>${esc(c.manufacturer || "not recorded")}</p>` : "") +
          (c.county ? `<p class="pop-row"><span>County</span>${esc(c.county.replace(/ County$/, ""))}</p>` : "") +
          (c.zone ? `<p class="pop-row"><span>Zone</span>${esc(c.zone)}</p>` : "") +
          (bearings(c.direction).length
            ? `<p class="pop-row"><span>Facing</span>${bearings(c.direction).map((d) => `${compass(d.deg)} (${Math.round(d.deg)}°)`).join(", ")}</p>`
            : "") +
          `<p class="pop-link"><a href="https://www.openstreetmap.org/node/${c.id}" target="_blank" rel="noreferrer">View on OpenStreetMap ↗</a></p>`
      );
      m.options.county = c.county || null;
      m.options.bearings = bearings(c.direction);
      m.options.isFlock = isFlock;
      dots.push(m);
      (isFlock ? flock : other).addLayer(m);
    }
    for (const w of wisdotCameras) {
      const isUnmapped = unmappedIds.has(w.permit_id || `${w.lat},${w.lon}`);
      const m = L.circleMarker([w.lat, w.lon], {
        renderer, radius: 7, weight: 1.75,
        color: isUnmapped ? "#B5543B" : "#1F2421",
        fillColor: "#FFFDF8", fillOpacity: 0,
      });
      m.options.unmapped = isUnmapped;
      m.options.county = w.county ? `${w.county} County` : null;
      m.bindPopup(
        `<p class="pop-kicker">WisDOT-permitted camera${isUnmapped ? " · not yet on the volunteer map" : ""}</p>` +
          `<p class="pop-title">${esc(w.owner)}</p>` +
          `<p class="pop-row"><span>Product</span>${esc(w.product)}</p>` +
          `<p class="pop-row"><span>Permit</span>${w.permit_id ? esc(w.permit_id) : "in WisDOT map export; no number on file"}${w.date_approved ? ` · approved ${esc(w.date_approved)}` : ""}</p>` +
          `<p class="pop-row"><span>Where</span>${esc(w.address)}${w.county ? `, ${esc(w.county)} County` : ""}</p>` +
          (isUnmapped ? `<p class="pop-link"><a href="https://deflock.org" target="_blank" rel="noreferrer">Map it on DeFlock ↗</a></p>` : "")
      );
      rings.push(m);
      wisdot.addLayer(m);
    }
    layers.current = { flock, other, wisdot, rings, dots };
    flock.addTo(map); other.addTo(map); wisdot.addTo(map);

    // Marker size follows zoom: at the statewide view 759 rings and 2,100 dots
    // must read as a distribution, not a blot; zoomed in they become clickable targets.
    const resize = () => {
      const z = map.getZoom();
      const s = z < 6.5 ? { dot: 1.9, ring: 2.8, w: 0.8 }   // a phone's statewide view: keep it a texture, not a blot
        : z < 7 ? { dot: 2.5, ring: 3.5, w: 1 }
        : z <= 7 ? { dot: 3, ring: 4.5, w: 1.1 }
        : z <= 9 ? { dot: 4, ring: 7, w: 1.5 }
        : { dot: 5, ring: 9, w: 1.75 };
      // Softer fills at the statewide view, so Milwaukee reads as density rather than a blot.
      // With county shading on, the markers step back until the reader zooms into a county.
      const fade = layers.current.shade && z < 9;
      const fill = fade ? 0.1 : z <= 7 ? 0.5 : 0.75;
      for (const m of dots) { m.setRadius(s.dot); if (!m.options.hidden) m.setStyle({ fillOpacity: fill, opacity: fade ? 0.28 : 1 }); }
      for (const m of rings) { m.setStyle({ radius: s.ring, weight: s.w }); if (!m.options.hidden) m.setStyle({ opacity: fade ? 0.22 : 1 }); }
      layers.current.shadeLayer?.setStyle({ fillOpacity: z >= 9 ? 0.3 : 0.85 });
    };
    layers.current.resize = resize;
    map.on("zoomend", resize);
    resize();

    // Which way each camera looks: a wedge per bearing, drawn only at street level and
    // only for the dots in view, so the statewide map never carries 2,000 polygons.
    const wedges = L.layerGroup().addTo(map);
    const drawWedges = () => {
      wedges.clearLayers();
      if (map.getZoom() < WEDGE_ZOOM) return;
      const box = map.getBounds().pad(0.15);
      for (const m of dots) {
        if (!m.options.bearings.length || m.options.hidden || !map.hasLayer(m) || !box.contains(m.getLatLng())) continue;
        const { lat, lng } = m.getLatLng();
        for (const b of m.options.bearings) {
          L.polygon(wedge(lat, lng, b.deg, b.spread), {
            renderer, interactive: false, stroke: false,
            fillColor: m.options.isFlock ? "#2C6B62" : "#55594F", fillOpacity: 0.28,
          }).addTo(wedges);
        }
      }
    };
    map.on("moveend zoomend", drawWedges);
    layers.current.drawWedges = drawWedges;
    map.on("movestart", () => setView(null));

    const count = () => {
      const box = map.getBounds();
      let mapped = 0, permitted = 0;
      for (const m of dots) if (!m.options.hidden && map.hasLayer(m) && box.contains(m.getLatLng())) mapped++;
      for (const m of rings) if (!m.options.hidden && map.hasLayer(m) && box.contains(m.getLatLng())) permitted++;
      setInView({ mapped, permitted });
    };
    map.on("moveend zoomend", count);
    layers.current.count = count;
    count();

    // The legend floats over the map's top-right corner; a popup opening beneath it loses its
    // close button. Nudge the map just far enough to clear it.
    map.on("popupopen", (e) => {
      const card = el.current.parentElement.querySelector(".map-card");
      if (!card || getComputedStyle(card).position !== "absolute") return;
      const p = e.popup.getElement().getBoundingClientRect(), k = card.getBoundingClientRect();
      const overlapX = p.right - k.left, overlapY = k.bottom - p.top;
      if (overlapX > 0 && overlapY > 0) map.panBy(overlapX < overlapY ? [overlapX + 12, 0] : [0, -(overlapY + 12)], { animate: true, duration: 0.25 });
    });

    return () => { watcher?.disconnect(); mapRef.current = null; layers.current = {}; map.remove(); };
  }, [cameras, wisdotCameras, unmappedIds, outline, shapes]);

  // Layer visibility follows the checkboxes.
  useEffect(() => {
    const map = mapRef.current, ly = layers.current;
    if (!map || !ly.flock) return;
    const sync = (layer, on) => (on ? layer.addTo(map) : layer.remove());
    sync(ly.flock, show.flock);
    sync(ly.other, show.other);
    sync(ly.wisdot, show.wisdot);
    const inSel = (m) => selectedCounties.length === 0 || selectedCounties.includes(m.options.county);
    for (const m of ly.rings) {
      const hide = (show.unmappedOnly && !m.options.unmapped) || !inSel(m);
      m.options.hidden = hide;
      if (hide) m.setStyle({ opacity: 0 });
    }
    for (const m of ly.dots) {
      const hide = !inSel(m);
      m.options.hidden = hide;
      if (hide) m.setStyle({ opacity: 0, fillOpacity: 0 });
    }
    ly.shade = shade;
    ly.resize?.();
    ly.count?.();
    ly.drawWedges?.();
  }, [show, selectedCounties, shade]);

  // County shading: a filled layer under the borders, plus a readout that follows the pointer.
  // The markers' canvas sits above every SVG pane and swallows pointer events, so the county
  // under the cursor is found by point-in-polygon on the map's own mousemove.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shapes || !shade) return;
    const style = (f) => {
      const c = statByName.get(f.properties.name);
      const none = !c || c.dots === 0;
      return { stroke: false, fillColor: none ? NONE : RAMP[classOf(rateOf(c), breaks)], fillOpacity: map.getZoom() >= 9 ? 0.3 : 0.85 };
    };
    const svg = L.svg({ pane: "shade" }).addTo(map);
    const layer = L.geoJSON(shapes, { renderer: svg, pane: "shade", interactive: false, style }).addTo(map);
    layers.current.shadeLayer = layer;

    const index = shapes.features.map((f) => {
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      const xs = polys.flatMap((p) => p[0].map((pt) => pt[0])), ys = polys.flatMap((p) => p[0].map((pt) => pt[1]));
      return { f, polys, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
    const countyAt = ({ lat, lng }) =>
      index.find((c) => lng >= c.box[0] && lng <= c.box[2] && lat >= c.box[1] && lat <= c.box[3] && c.polys.some((p) => inRing(lng, lat, p[0])))?.f;

    const tip = L.tooltip({ direction: "top", offset: [0, -6], opacity: 1, className: "county-tip" });
    let hovered = null, outlineLayer = null, raf = 0;
    const clear = () => { hovered = null; tip.remove(); outlineLayer?.remove(); outlineLayer = null; };
    const showCounty = (latlng) => {
      const f = countyAt(latlng);
      if (!f) return clear();
      if (f !== hovered) {
        hovered = f;
        outlineLayer?.remove();
        outlineLayer = L.geoJSON(f, { pane: "borders", interactive: false, style: { color: "#1F2421", weight: 2, fill: false } }).addTo(map);
        const c = statByName.get(f.properties.name);
        const rate = c ? rateOf(c) : 0;
        tip.setContent(
          `<p class="pop-title">${esc(f.properties.name)}</p>` +
            (c && c.dots > 0
              ? `<p class="pop-row"><span>Per 10,000 residents</span>${nice(rate)}</p>`
              : `<p class="pop-row"><span>Mapped cameras</span>none yet</p>`) +
            (c ? `<p class="pop-row"><span>Mapped by volunteers</span>${c.dots.toLocaleString("en-US")}</p>` +
                 `<p class="pop-row"><span>Highway permits</span>${c.rings.toLocaleString("en-US")}</p>` +
                 `<p class="pop-row"><span>Residents</span>${c.population.toLocaleString("en-US")}</p>` : "")
        );
      }
      tip.setLatLng(latlng);
      if (!map.hasLayer(tip)) tip.addTo(map);
    };
    const onMove = (e) => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; showCounty(e.latlng); }); };
    const onClick = (e) => showCounty(e.latlng); // touch screens have no hover
    map.on("mousemove", onMove);
    map.on("click", onClick);
    map.on("mouseout", clear);
    return () => {
      map.off("mousemove", onMove); map.off("click", onClick); map.off("mouseout", clear);
      if (raf) cancelAnimationFrame(raf);
      clear(); layer.remove(); svg.remove(); layers.current.shadeLayer = null;
    };
  }, [shade, shapes, statByName, breaks]);

  // Selected counties: draw their outlines and fit the view to them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shapes) return;
    if (outlineRef.current) { outlineRef.current.remove(); outlineRef.current = null; }
    if (selectedCounties.length === 0) return;
    const fc = { type: "FeatureCollection", features: shapes.features.filter((f) => selectedCounties.includes(f.properties.name)) };
    const layer = L.geoJSON(fc, { style: { color: "#2C6B62", weight: 1.75, dashArray: "4 3", fill: true, fillColor: "#3A867C", fillOpacity: 0.05, interactive: false } }).addTo(map);
    outlineRef.current = layer;
    fitIfSized(map, layer.getBounds().pad(0.08), { maxZoom: 12 });
    const onlyMarathon = selectedCounties.length === 1 && selectedCounties[0] === "Marathon County";
    setTimeout(() => setView(onlyMarathon ? "marathon" : "counties"), 0);
  }, [selectedCounties, shapes]);

  const zoomTo = (key) => {
    setView(key);
    if (key === "marathon") {
      // Select the county rather than just framing it, so it is outlined and the markers filter.
      const already = selectedCounties.length === 1 && selectedCounties[0] === "Marathon County";
      if (onSelectCounties && !already) onSelectCounties(["Marathon County"]);
      else fitIfSized(mapRef.current, MARATHON_BOUNDS); // already selected: just bring it back into frame
    } else {
      if (onSelectCounties && selectedCounties.length) onSelectCounties([]);
      fitIfSized(mapRef.current, boundsRef.current || WI_BOUNDS, { padding: [14, 14] });
    }
    setTimeout(() => setView(key), 0);
  };
  const nearMe = () => {
    if (!navigator.geolocation) return setLocError("Location is not available in this browser.");
    setLocating(true); setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current; if (!map) return;
        const { latitude: lat, longitude: lon } = pos.coords;
        if (meRef.current) meRef.current.remove();
        meRef.current = L.circleMarker([lat, lon], { radius: 8, color: "#B5543B", fillColor: "#B5543B", fillOpacity: 0.35, weight: 2 })
          .bindPopup('<p class="pop-title">You are here</p>').addTo(map);
        map.setView([lat, lon], 12);
        setLocating(false);
        setTimeout(() => setView("me"), 0);
      },
      () => { setLocating(false); setLocError("Could not get your location. Check the browser's permission for this site."); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };
  const toggle = (k) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="map-frame">
      <div className="camera-map" ref={el} />
      <div className="map-card">
        <div className="map-card-zoom" role="group" aria-label="Zoom shortcuts">
          <button className={view === "state" ? "active" : ""} onClick={() => zoomTo("state")}>Statewide</button>
          <button className={view === "marathon" ? "active" : ""} onClick={() => zoomTo("marathon")}>Marathon Co.</button>
          <button className={view === "me" ? "active" : ""} onClick={nearMe} disabled={locating} title="Zoom to your location (asks the browser for permission)">
            {locating ? "Locating…" : "Near me"}
          </button>
        </div>
        {locError && <p className="map-error">{locError}</p>}
        {inView && (
          <p className="map-inview" role="status" aria-live="polite">
            In view: <strong>{fmt(inView.mapped)}</strong> mapped · <strong>{fmt(inView.permitted)}</strong> permitted
          </p>
        )}
        <div className="map-card-legend">
          <label className="legend-item legend-toggle">
            <input type="checkbox" checked={show.flock} onChange={() => toggle("flock")} />
            <span className="legend-dot legend-flock" aria-hidden="true" />
            Flock Safety <span className="legend-n">{fmt(flockCount)}</span>
          </label>
          <label className="legend-item legend-toggle">
            <input type="checkbox" checked={show.other} onChange={() => toggle("other")} />
            <span className="legend-dot legend-other" aria-hidden="true" />
            Other or unknown vendor <span className="legend-n">{fmt(cameras.length - flockCount)}</span>
          </label>
          <label className="legend-item legend-toggle">
            <input type="checkbox" checked={show.wisdot} onChange={() => toggle("wisdot")} />
            <span className="legend-dot legend-official" aria-hidden="true" />
            WisDOT-permitted <span className="legend-n">{fmt(wisdotCameras.length)}</span>
          </label>
          <label className={`legend-item legend-toggle legend-sub${show.wisdot ? "" : " off"}`}>
            <input type="checkbox" checked={show.unmappedOnly} disabled={!show.wisdot} onChange={() => toggle("unmappedOnly")} />
            <span className="legend-dot legend-unmapped" aria-hidden="true" />
            only rings with no dot within {NEAR_M} m <span className="legend-n">{fmt(unmapped.length)}</span>
          </label>
          {breaks.length > 0 && (
            <label className="legend-item legend-toggle legend-shade">
              <input type="checkbox" checked={shade} onChange={() => setShade(!shade)} />
              Shade counties by mapped cameras per 10,000 residents
            </label>
          )}
          {shade && (
            <div className="shade-key" role="img" aria-label={`County shading from light to dark: up to ${nice(breaks[0])}, then ${breaks.slice(1).map(nice).join(", ")} and above, mapped cameras per 10,000 residents`}>
              <div className="shade-ramp">
                {RAMP.map((color, i) => <span key={color} style={{ background: color }}>{i > 0 && <em>{nice(breaks[i - 1])}</em>}</span>)}
              </div>
              <p className="shade-unit">mapped cameras per 10,000 residents, in five equal groups of counties</p>
              <p className="shade-note">
                <span className="shade-none" /> none mapped · hover or tap a county. Shading follows
                where volunteers have mapped, which is not the same as where cameras are.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
