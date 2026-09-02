import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";

const WI_BOUNDS = [[42.4, -93.0], [47.1, -86.7]];
const MARATHON_BOUNDS = [[44.68, -90.36], [45.15, -89.15]];

const fmt = (n) => n.toLocaleString("en-US");

export default function CameraMap({ cameras, wisdotCameras }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const wisdotLayerRef = useRef(null);
  const [showWisdot, setShowWisdot] = useState(true);
  const [view, setView] = useState("state");

  useEffect(() => {
    const map = L.map(el.current, {
      scrollWheelZoom: false, // page scroll must not fight the map inside an iframe embed
    });
    mapRef.current = map;
    map.fitBounds(WI_BOUNDS);

    // Esri's Light Gray Canvas: keyless. CARTO's raster basemaps began demanding an
    // API key in 2026 (tiles render an "API KEY REQUIRED" watermark without one) and
    // are being retired, so they are no longer an option for a static embed.
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      {
        attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ',
        maxZoom: 16,
      }
    ).addTo(map);

    const renderer = L.canvas({ padding: 0.4 });
    for (const c of cameras) {
      const isFlock = c.manufacturer === "Flock Safety";
      const marker = L.circleMarker([c.lat, c.lon], {
        renderer,
        radius: 4,
        weight: 1.25,
        color: isFlock ? "#2C6B62" : "#6B6B66",
        fillColor: isFlock ? "#3A867C" : "#B9B9B2",
        fillOpacity: 0.75,
      }).addTo(map);
      marker.bindPopup(
        `<strong>${c.manufacturer || "Unknown vendor"}</strong><br/>` +
          (c.operator ? `Operator: ${c.operator}<br/>` : "") +
          (c.zone ? `Zone: ${c.zone}<br/>` : "") +
          `<a href="https://www.openstreetmap.org/node/${c.id}" target="_blank" rel="noreferrer">View on OpenStreetMap</a>`
      );
    }

    // WisDOT-permitted highway cameras: hollow rings over the community dots,
    // toggled from the control card.
    const wisdotLayer = L.layerGroup();
    wisdotLayerRef.current = wisdotLayer;
    for (const c of wisdotCameras) {
      const marker = L.circleMarker([c.lat, c.lon], {
        renderer,
        radius: 7,
        weight: 1.75,
        color: "#1F2421",
        fillColor: "#FFFDF8",
        fillOpacity: 0,
      });
      marker.bindPopup(
        `<strong>${c.owner}</strong><br/>` +
          `${c.product}<br/>` +
          (c.permit_id ? `WisDOT permit ${c.permit_id}` : "In WisDOT map export; no permit number on file") +
          (c.date_approved ? ` &middot; approved ${c.date_approved}` : "") +
          `<br/>${c.address}`
      );
      wisdotLayer.addLayer(marker);
    }

    return () => {
      mapRef.current = null;
      wisdotLayerRef.current = null;
      map.remove();
    };
  }, [cameras, wisdotCameras]);

  useEffect(() => {
    const map = mapRef.current, layer = wisdotLayerRef.current;
    if (!map || !layer) return;
    if (showWisdot) layer.addTo(map);
    else layer.remove();
  }, [showWisdot, cameras, wisdotCameras]);

  const zoomTo = (key) => {
    setView(key);
    mapRef.current?.fitBounds(key === "marathon" ? MARATHON_BOUNDS : WI_BOUNDS);
  };

  return (
    <div className="map-frame">
      <div className="camera-map" ref={el} />
      <div className="map-card">
        <div className="map-card-zoom" role="group" aria-label="Zoom shortcuts">
          <button
            className={view === "state" ? "active" : ""}
            onClick={() => zoomTo("state")}
          >
            Statewide
          </button>
          <button
            className={view === "marathon" ? "active" : ""}
            onClick={() => zoomTo("marathon")}
          >
            Marathon Co.
          </button>
        </div>
        <div className="map-card-legend">
          <span className="legend-item"><span className="legend-dot legend-flock" aria-hidden="true" />Flock Safety</span>
          <span className="legend-item"><span className="legend-dot legend-other" aria-hidden="true" />Other ALPR vendors</span>
          <label className="legend-item legend-toggle">
            <input
              type="checkbox"
              checked={showWisdot}
              onChange={(e) => setShowWisdot(e.target.checked)}
            />
            <span className="legend-dot legend-official" aria-hidden="true" />
            WisDOT-permitted ({fmt(wisdotCameras.length)})
          </label>
        </div>
      </div>
    </div>
  );
}
