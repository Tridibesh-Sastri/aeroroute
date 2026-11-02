import React, { useState } from 'react';
import {
  X,
  Code2,
  Copy,
  Check,
  Download,
  ExternalLink,
  Terminal,
  Database,
  Sparkles
} from 'lucide-react';

export default function ApiEndpointModal({
  isOpen,
  onClose,
  apiBundle,
  pythonConnected
}) {
  const [activeTab, setActiveTab] = useState('geojson'); // 'geojson' | 'curl' | 'js' | 'python'
  const [copied, setCopied] = useState(false);

  if (!isOpen || !apiBundle) return null;

  const { endpointPath, aqiMin, aqiMax, payload } = apiBundle;
  const baseUrl = pythonConnected
    ? 'http://localhost:8000'
    : window.location.origin;
  const fullEndpointUrl = `${baseUrl}${endpointPath}`;

  const curlSnippet = `curl -X GET "${fullEndpointUrl}" \\
  -H "Accept: application/geo+json"`;

  const jsSnippet = `// Fetch filtered Iso-AQI locations & resolution metadata
const response = await fetch("${fullEndpointUrl}");
const geojson = await response.json();

console.log("Max Native Zoom:", geojson.query_metadata.spatial_resolution.max_native_zoom_level);
console.log("Min Sensor Spacing (km):", geojson.query_metadata.spatial_resolution.min_sensor_spacing_km);
console.log("Matching Locations:", geojson.features.length);`;

  const pythonSnippet = `import requests
import geopandas as gpd

url = "${fullEndpointUrl}"
res = requests.get(url).json()

print("Resolution Metadata:", res["query_metadata"]["spatial_resolution"])
gdf = gpd.GeoDataFrame.from_features(res["features"])
print(gdf.head())`;

  const getActiveCodeText = () => {
    if (activeTab === 'curl') return curlSnippet;
    if (activeTab === 'js') return jsSnippet;
    if (activeTab === 'python') return pythonSnippet;
    return JSON.stringify(payload, null, 2);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getActiveCodeText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadGeoJson = () => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/geo+json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aeroroute_aqi_${aqiMin}_to_${aqiMax}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resMeta = payload?.query_metadata?.spatial_resolution || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl text-slate-200 overflow-hidden">
        {/* TOP MODAL HEADER */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Open Spatial API & Filtered GeoJSON Endpoint
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  GET /api/v1/extract
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Reusable Data-as-a-Service endpoint exposing slider-filtered AQI zones & spatial resolution metrics
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MODAL BODY */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* LIVE REST URL BAR */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold font-mono shrink-0">
                GET
              </span>
              <code className="text-xs text-emerald-300 font-mono truncate">
                {fullEndpointUrl}
              </code>
            </div>
            {pythonConnected && (
              <a
                href={fullEndpointUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 flex items-center gap-1 shrink-0"
              >
                <span>Open Raw</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>

          {/* RESOLUTION & FILTER SUMMARY CARDS */}
          <div className="grid grid-cols-4 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">Selected AQI Band</div>
              <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                {aqiMin} – {aqiMax} AQI
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">Matching Locations</div>
              <div className="text-sm font-bold text-white font-mono mt-0.5">
                {payload.query_metadata.matching_locations_count} Nodes
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">Min Sensor Spacing</div>
              <div className="text-sm font-bold text-cyan-300 font-mono mt-0.5">
                {resMeta.min_sensor_spacing_km} km (d_min)
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <div className="text-[10px] text-slate-400">Max Native Zoom</div>
              <div className="text-sm font-bold text-amber-300 font-mono mt-0.5">
                {resMeta.max_native_zoom_level}x Ceiling
              </div>
            </div>
          </div>

          {/* TABS & ACTION BUTTONS */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
              {[
                { id: 'geojson', label: 'Live GeoJSON Response', icon: Database },
                { id: 'curl', label: 'cURL CLI', icon: Terminal },
                { id: 'js', label: 'JS fetch()', icon: Code2 },
                { id: 'python', label: 'Python / GeoPandas', icon: Sparkles }
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      activeTab === t.id
                        ? 'bg-emerald-500 text-slate-950 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 border border-slate-700 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy {activeTab === 'geojson' ? 'JSON' : 'Snippet'}</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownloadGeoJson}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-xs font-bold text-slate-950 flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Download .geojson
              </button>
            </div>
          </div>

          {/* CODE / JSON INSPECTOR */}
          <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-72 leading-relaxed">
            {getActiveCodeText()}
          </pre>
        </div>
      </div>
    </div>
  );
}