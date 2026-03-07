import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import { fetchBoundaries } from "../api";
import { Layers } from "lucide-react";

const SD_CENTER = [32.7157, -117.1611];
const SD_ZOOM = 11;

const POINT_PALETTE = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#06b6d4",
  "#84cc16",
  "#e11d48",
];

const DISTRICT_COLORS = [
  "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48",
];

function defaultDistrictStyle(feature) {
  const district =
    feature.properties?.district || feature.properties?.DISTRICT || 0;
  return {
    fillColor:
      DISTRICT_COLORS[(district - 1) % DISTRICT_COLORS.length] || "#64748b",
    fillOpacity: 0.08,
    color:
      DISTRICT_COLORS[(district - 1) % DISTRICT_COLORS.length] || "#64748b",
    weight: 1.5,
    opacity: 0.6,
  };
}

function districtTooltip(feature, layer) {
  const d =
    feature.properties?.district || feature.properties?.DISTRICT || "?";
  layer.bindTooltip(`District ${d}`, {
    sticky: true,
    className: "district-tooltip",
  });
}

function interpolateColor(value, min, max) {
  const t = max === min ? 0.5 : (value - min) / (max - min);
  const r = Math.round(34 + t * (220 - 34));
  const g = Math.round(197 + t * (38 - 197));
  const b = Math.round(94 + t * (38 - 94));
  return `rgb(${r},${g},${b})`;
}

function ChoroplethLayer({ districts, choropleth }) {
  if (!districts || !choropleth) return null;

  const valueMap = {};
  const valueKey = choropleth.config?.value_key || "value";
  const labelKey = choropleth.config?.label_key || "district";
  let min = Infinity,
    max = -Infinity;

  for (const d of choropleth.data) {
    const dist = d[labelKey];
    const val = parseFloat(d[valueKey]) || 0;
    valueMap[String(dist)] = { value: val, ...d };
    min = Math.min(min, val);
    max = Math.max(max, val);
  }

  const style = (feature) => {
    const dist =
      feature.properties?.district || feature.properties?.DISTRICT || 0;
    const entry = valueMap[String(dist)];
    if (!entry) return { fillOpacity: 0.05, color: "#64748b", weight: 1 };
    return {
      fillColor: interpolateColor(entry.value, min, max),
      fillOpacity: 0.5,
      color: interpolateColor(entry.value, min, max),
      weight: 2,
      opacity: 0.8,
    };
  };

  const onEach = (feature, layer) => {
    const dist =
      feature.properties?.district || feature.properties?.DISTRICT || "?";
    const entry = valueMap[String(dist)];
    const val = entry ? entry.value : "N/A";
    const extra = entry
      ? Object.entries(entry)
          .filter(([k]) => k !== labelKey && k !== valueKey && k !== "value")
          .map(([k, v]) => `<br/><b>${k}:</b> ${v}`)
          .join("")
      : "";
    layer.bindTooltip(
      `<b>District ${dist}</b><br/>${valueKey}: ${typeof val === "number" ? val.toLocaleString() : val}${extra}`,
      { sticky: true },
    );
  };

  return <GeoJSON data={districts} style={style} onEachFeature={onEach} key={choropleth.id} />;
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

  return layers.map((layer, layerIdx) => {
    const latKey = layer.config?.lat_key || "lat";
    const lngKey = layer.config?.lng_key || "lng";
    const labelKey = layer.config?.label_key;
    const colorKey = layer.config?.color_key;
    const sizeKey = layer.config?.size_key;
    const baseColor = POINT_PALETTE[layerIdx % POINT_PALETTE.length];

    let sizeMin = Infinity,
      sizeMax = -Infinity;
    if (sizeKey) {
      for (const p of layer.points || []) {
        const v = parseFloat(p[sizeKey]);
        if (!isNaN(v)) {
          sizeMin = Math.min(sizeMin, v);
          sizeMax = Math.max(sizeMax, v);
        }
      }
    }

    const colorMap = {};
    let colorIdx = 0;
    if (colorKey) {
      for (const p of layer.points || []) {
        const v = String(p[colorKey] ?? "");
        if (!(v in colorMap)) {
          colorMap[v] = POINT_PALETTE[colorIdx % POINT_PALETTE.length];
          colorIdx++;
        }
      }
    }

    return (layer.points || [])
      .filter((p) => p[latKey] && p[lngKey])
      .map((point, i) => {
        const color = colorKey
          ? colorMap[String(point[colorKey] ?? "")] || baseColor
          : baseColor;

        let radius = 6;
        if (sizeKey && sizeMax > sizeMin) {
          const v = parseFloat(point[sizeKey]) || sizeMin;
          const t = (v - sizeMin) / (sizeMax - sizeMin);
          radius = 4 + t * 16;
        }

        return (
          <CircleMarker
            key={`${layer.id}-${i}`}
            center={[parseFloat(point[latKey]), parseFloat(point[lngKey])]}
            radius={radius}
            fillColor={color}
            fillOpacity={0.7}
            color={color}
            weight={1}
            opacity={0.9}
          >
            <Popup>
              <div className="text-xs max-w-[200px]">
                {labelKey && point[labelKey] && (
                  <strong className="block mb-1">{point[labelKey]}</strong>
                )}
                {Object.entries(point)
                  .filter(([k]) => k !== latKey && k !== lngKey)
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div key={k}>
                      <span className="font-medium">{k}:</span> {String(v)}
                    </div>
                  ))}
              </div>
            </Popup>
          </CircleMarker>
        );
      });
  });
}

export default function MapPanel({ layers, choropleths = [] }) {
  const [districts, setDistricts] = useState(null);
  const [showDistricts, setShowDistricts] = useState(true);
  const activeChoropleth = choropleths.length > 0 ? choropleths[choropleths.length - 1] : null;

  useEffect(() => {
    fetchBoundaries("council_districts").then((data) => {
      if (data && data.type) setDistricts(data);
    });
  }, []);

  return (
    <div className="relative h-full w-full">
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

        {activeChoropleth && districts ? (
          <ChoroplethLayer
            districts={districts}
            choropleth={activeChoropleth}
          />
        ) : (
          showDistricts &&
          districts && (
            <GeoJSON
              data={districts}
              style={defaultDistrictStyle}
              onEachFeature={districtTooltip}
            />
          )
        )}

        <DynamicPoints layers={layers} />
      </MapContainer>

      {/* Controls */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
        {!activeChoropleth && (
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
        )}
      </div>

      {/* Layer badges */}
      {(layers.length > 0 || activeChoropleth) && (
        <div className="absolute bottom-3 left-3 z-[1000] flex flex-col gap-1 max-w-[calc(100%-24px)]">
          {activeChoropleth && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-sm truncate">
              🗺 {activeChoropleth.title}
            </span>
          )}
          {layers.map((l) => (
            <span
              key={l.id}
              className="text-[11px] px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 backdrop-blur-sm truncate"
            >
              📍 {l.title} ({l.points?.length || 0})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
