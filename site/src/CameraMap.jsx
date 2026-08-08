import React, { useEffect, useRef } from "react";
import L from "leaflet";

const WI_BOUNDS = [[42.4, -93.0], [47.1, -86.7]];

export default function CameraMap({ cameras }) {
  const el = useRef(null);

  useEffect(() => {
    const map = L.map(el.current, {
      scrollWheelZoom: false, // page scroll must not fight the map inside an iframe embed
    });
    map.fitBounds(WI_BOUNDS);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

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

    return () => map.remove();
  }, [cameras]);

  return <div className="camera-map" ref={el} />;
}
