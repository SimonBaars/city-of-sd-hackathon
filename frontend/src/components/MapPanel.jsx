import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from "react-leaflet";
import { fetchBoundaries } from "../api";
import { Layers } from "lucide-react";

const SD_CENTER = [32.7157, -117.1611];
const SD_ZOOM = 11;

const DISTRICT_COLORS = [
  "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48",
];

function districtStyle(feature) {
  const district = feature.properties?.district || feature.properties?.DISTRICT || 0;
  return {
    fillColor: DISTRICT_COLORS[(district - 1) % DISTRICT_COLORS.length] || "#64748b",
    fillOpacity: 0.08,
    color: DISTRICT_COLORS[(district - 1) % DISTRICT_COLORS.length] || "#64748b",
    weight: 1.5,
    opacity: 0.6,
  };
}

function districtTooltip(feature, layer) {
  const d = feature.properties?.district || feature.properties?.DISTRICT || "?";
  layer.bindTooltip(`District ${d}`, { sticky: true, className: "district-tooltip" });
}

function DynamicPoints({ layers }) {
  const map = useMap();

  useEffect(() => {
    if (layers.length > 0) {
      const lastLayer = layers[layers.length - 1];
      const points = lastLayer.points;
      if (points?.length > 0) {
        const latKey = lastLayer.config?.lat_key || "lat";
        const lngKey = lastLayer.config?.lng_key || "lng";
        const validPoints = points.filter((p) => p[latKey] && p[lngKey]);
        if (validPoints.length > 0) {
          const bounds = validPoints.map((p) => [
            parseFloat(p[latKey]),
            parseFloat(p[lngKey]),
          ]);
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
      }
    }
  }, [layers, map]);

  return layers.map((layer) => {
    const latKey = layer.config?.lat_key || "lat";
    const lngKey = layer.config?.lng_key || "lng";
    const labelKey = layer.config?.label_key;

    return layer.points
      ?.filter((p) => p[latKey] && p[lngKey])
      .map((point, i) => (
        <CircleMarker
          key={`${layer.id}-${i}`}
          center={[parseFloat(point[latKey]), parseFloat(point[lngKey])]}
          radius={6}
          fillColor="#ef4444"
          fillOpacity={0.7}
          color="#ef4444"
          weight={1}
          opacity={0.9}
        >
          <Popup>
            <div className="text-xs">
              {labelKey && point[labelKey] && (
                <strong>{point[labelKey]}</strong>
              )}
              {Object.entries(point)
                .filter(([k]) => k !== latKey && k !== lngKey)
                .slice(0, 6)
                .map(([k, v]) => (
                  <div key={k}>
                    <span className="font-medium">{k}:</span> {String(v)}
                  </div>
                ))}
            </div>
          </Popup>
        </CircleMarker>
      ));
  });
}

export default function MapPanel({ layers }) {
  const [districts, setDistricts] = useState(null);
  const [showDistricts, setShowDistricts] = useState(true);

  useEffect(() => {
    fetchBoundaries("council_districts").then((data) => {
      if (data && data.type) setDistricts(data);
    });
  }, []);

  return (
    <div className="relative h-full">
      <MapContainer
        center={SD_CENTER}
        zoom={SD_ZOOM}
        className="h-full w-full"
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        />

        {showDistricts && districts && (
          <GeoJSON
            data={districts}
            style={districtStyle}
            onEachFeature={districtTooltip}
          />
        )}

        <DynamicPoints layers={layers} />
      </MapContainer>

      {/* Layer toggle */}
      <div className="absolute top-3 right-3 z-[1000]">
        <button
          onClick={() => setShowDistricts((v) => !v)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border backdrop-blur-sm transition-colors ${
            showDistricts
              ? "bg-sky-500/20 border-sky-500/30 text-sky-300"
              : "bg-slate-800/80 border-slate-600/50 text-slate-400"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Districts
        </button>
      </div>

      {/* Map layer badges */}
      {layers.length > 0 && (
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-1">
          {layers.map((l) => (
            <span
              key={l.id}
              className="text-[11px] px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 backdrop-blur-sm"
            >
              📍 {l.title} ({l.points?.length || 0})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
