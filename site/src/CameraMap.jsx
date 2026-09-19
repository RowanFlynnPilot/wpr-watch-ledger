import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";

const WI_BOUNDS = [[42.4, -93.0], [47.1, -86.7]];
const MARATHON_BOUNDS = [[44.68, -90.36], [45.15, -89.15]];
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

export default function CameraMap({ cameras, wisdotCameras, selectedCounties = [], shapes }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layers = useRef({});
  const meRef = useRef(null);
  const outlineRef = useRef(null);
  const [show, setShow] = useState({ flock: true, other: true, wisdot: true, unmappedOnly: false });
  const [view, setView] = useState("state");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);

  const unmapped = useMemo(() => findUnmapped(cameras, wisdotCameras), [cameras, wisdotCameras]);
  const unmappedIds = useMemo(() => new Set(unmapped.map((w) => w.permit_id || `${w.lat},${w.lon}`)), [unmapped]);
  const flockCount = cameras.filter((c) => c.manufacturer === "Flock Safety").length;

  useEffect(() => {
    const map = L.map(el.current, { scrollWheelZoom: false });
    mapRef.current = map;
    el.current.__map = map; // handle for debugging from the console
    map.fitBounds(WI_BOUNDS);

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
    L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(map);

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
          `<p class="pop-title">${esc(c.manufacturer || "Unknown vendor")}</p>` +
          (c.operator ? `<p class="pop-row"><span>Operator</span>${esc(c.operator)}</p>` : "") +
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
      const s = z <= 6 ? { dot: 2.5, ring: 3.5, w: 1 }
        : z <= 7 ? { dot: 3, ring: 4.5, w: 1.1 }
        : z <= 9 ? { dot: 4, ring: 7, w: 1.5 }
        : { dot: 5, ring: 9, w: 1.75 };
      // Softer fills at the statewide view, so Milwaukee reads as density rather than a blot.
      const fill = z <= 7 ? 0.5 : 0.75;
      for (const m of dots) { m.setRadius(s.dot); if (!m.options.hidden) m.setStyle({ fillOpacity: fill }); }
      for (const m of rings) m.setStyle({ radius: s.ring, weight: s.w });
    };
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

    return () => { mapRef.current = null; layers.current = {}; map.remove(); };
  }, [cameras, wisdotCameras, unmappedIds]);

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
      m.setStyle({ opacity: hide ? 0 : 1 });
    }
    for (const m of ly.dots) {
      const hide = !inSel(m);
      m.options.hidden = hide;
      m.setStyle({ opacity: hide ? 0 : 1, fillOpacity: hide ? 0 : map.getZoom() <= 7 ? 0.5 : 0.75 });
    }
    ly.drawWedges?.();
  }, [show, selectedCounties]);

  // Selected counties: draw their outlines and fit the view to them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !shapes) return;
    if (outlineRef.current) { outlineRef.current.remove(); outlineRef.current = null; }
    if (selectedCounties.length === 0) return;
    const fc = { type: "FeatureCollection", features: shapes.features.filter((f) => selectedCounties.includes(f.properties.name)) };
    const layer = L.geoJSON(fc, { style: { color: "#2C6B62", weight: 1.75, dashArray: "4 3", fill: true, fillColor: "#3A867C", fillOpacity: 0.05, interactive: false } }).addTo(map);
    outlineRef.current = layer;
    map.fitBounds(layer.getBounds().pad(0.08), { maxZoom: 12 });
    setTimeout(() => setView("counties"), 0);
  }, [selectedCounties, shapes]);

  const zoomTo = (key) => {
    setView(key);
    mapRef.current?.fitBounds(key === "marathon" ? MARATHON_BOUNDS : WI_BOUNDS);
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
        </div>
      </div>
    </div>
  );
}
