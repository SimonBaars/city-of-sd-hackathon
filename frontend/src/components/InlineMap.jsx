import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import { useEffect } from "react";

const COLORS = [
  "#0ea5e9", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899",
  "#f97316", "#06b6d4", "#84cc16", "#e11d48",
];

function FitBounds({ points, latKey, lngKey }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = points.map((p) => [
      parseFloat(p[latKey]),
      parseFloat(p[lngKey]),
    ]);
    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 14 });
  }, [points, latKey, lngKey, map]);
  return null;
}

export default function InlineMap({ artifact }) {
  const { title, data, config = {} } = artifact;
  const latKey = config.lat_key || "lat";
  const lngKey = config.lng_key || "lng";
  const labelKey = config.label_key;
  const colorKey = config.color_key;
  const sizeKey = config.size_key;

  const validPoints = useMemo(
    () => (data || []).filter((p) => p[latKey] && p[lngKey]),
    [data, latKey, lngKey],
  );

  const { colorMap, sizeMin, sizeMax } = useMemo(() => {
    const cm = {};
    let ci = 0;
    let sMin = Infinity,
      sMax = -Infinity;

    for (const p of validPoints) {
      if (colorKey) {
        const v = String(p[colorKey] ?? "");
        if (!(v in cm)) {
          cm[v] = COLORS[ci % COLORS.length];
          ci++;
        }
      }
      if (sizeKey) {
        const v = parseFloat(p[sizeKey]);
        if (!isNaN(v)) {
          sMin = Math.min(sMin, v);
          sMax = Math.max(sMax, v);
        }
      }
    }
    return { colorMap: cm, sizeMin: sMin, sizeMax: sMax };
  }, [validPoints, colorKey, sizeKey]);

  if (validPoints.length === 0) {
    return (
      <div className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2 mt-2">
        📍 {title} (no valid coordinates)
      </div>
    );
  }

  const center = [
    validPoints.reduce((s, p) => s + parseFloat(p[latKey]), 0) /
      validPoints.length,
    validPoints.reduce((s, p) => s + parseFloat(p[lngKey]), 0) /
      validPoints.length,
  ];

  return (
    <div className="mt-3 bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700/50 flex items-center justify-between">
        <h4 className="text-sm font-medium text-slate-200">📍 {title}</h4>
        <span className="text-xs text-slate-500">
          {validPoints.length} points
        </span>
      </div>
      <div className="h-56 sm:h-64">
        <MapContainer
          center={center}
          zoom={12}
          className="h-full w-full"
          zoomControl={true}
          scrollWheelZoom={false}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          />
          <FitBounds
            points={validPoints}
            latKey={latKey}
            lngKey={lngKey}
          />
          {validPoints.map((point, i) => {
            const color = colorKey
              ? colorMap[String(point[colorKey] ?? "")] || COLORS[0]
              : COLORS[0];
            let radius = 6;
            if (sizeKey && sizeMax > sizeMin) {
              const v = parseFloat(point[sizeKey]) || sizeMin;
              const t = (v - sizeMin) / (sizeMax - sizeMin);
              radius = 4 + t * 14;
            }
            return (
              <CircleMarker
                key={i}
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
                      .slice(0, 6)
                      .map(([k, v]) => (
                        <div key={k}>
                          <span className="font-medium">{k}:</span>{" "}
                          {String(v)}
                        </div>
                      ))}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
      {colorKey && Object.keys(colorMap).length > 1 && (
        <div className="px-3 py-2 border-t border-slate-700/50 flex flex-wrap gap-2">
          {Object.entries(colorMap).map(([label, color]) => (
            <span key={label} className="flex items-center gap-1 text-[11px] text-slate-400">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
