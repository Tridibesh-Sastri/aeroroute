import React from 'react';
import {
  Navigation,
  Radar,
  ShieldAlert,
  Clock,
  Database,
  Sparkles,
  MapPin,
  Search,
  Server,
  Trash2,
  Lightbulb
} from 'lucide-react';
import AqiSpectrumFilter from './AqiSpectrumFilter';

export default function ControlPanel({
  selectedCity,
  onSelectRegionLocation,
  filterMode,
  setFilterMode,
  targetAqi,
  setTargetAqi,
  bandwidth,
  setBandwidth,
  resolutionTelemetry,
  matchingCount,
  totalCount,
  currentZoom,
  onSnapToMaxResolution,
  onOpenApiModal,
  activeMode,
  setActiveMode,
  clickTarget,
  setClickTarget,
  originCoord,
  destCoord,
  originQuery,
  destQuery,
  searchResults,
  onPlaceSearch,
  onSelectSearchResult,
  timeSlots,
  timeSlot,
  setTimeSlot,
  alphaWeight,
  setAlphaWeight,
  aqiPayloadSavedPct,
  optimalNodesGeoJson,
  cleanMetrics,
  fastMetrics,
  travelMode,
  setTravelMode,
  isolineAudit,
  tileTelemetry,
  onPurgeCache
}) {
  return (
    <aside className="absolute top-20 left-3 bottom-4 w-96 max-w-[calc(100vw-1.5rem)] z-10 flex flex-col gap-2.5 overflow-y-auto pr-1 pointer-events-auto">
      {/* 1. LOCATION-SCOPED AQI SPECTRUM SLIDER & SPATIAL RESOLUTION CONTROLLER */}
      <AqiSpectrumFilter
        regionName={selectedCity.name}
        onSelectRegionLocation={onSelectRegionLocation}
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        targetAqi={targetAqi}
        setTargetAqi={setTargetAqi}
        bandwidth={bandwidth}
        setBandwidth={setBandwidth}
        resolutionTelemetry={resolutionTelemetry}
        matchingCount={matchingCount}
        totalCount={totalCount}
        currentZoom={currentZoom}
        onSnapToMaxResolution={onSnapToMaxResolution}
        onOpenApiModal={onOpenApiModal}
      />

      {/* 2. MODE SWITCHER & ORIGIN/DESTINATION PICKER */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl shadow-2xl">
        <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800/80 mb-2.5">
          <button
            onClick={() => setActiveMode('route')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'route'
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Navigation className="w-3.5 h-3.5" />
            Safest AQI Routing
          </button>
          <button
            onClick={() => setActiveMode('isoline')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeMode === 'isoline'
                ? 'bg-cyan-400 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            15-Min Isoline Audit
          </button>
        </div>

        {activeMode === 'route' ? (
          <div className="space-y-2 relative">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setClickTarget('origin')}
                className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border shrink-0 cursor-pointer ${
                  clickTarget === 'origin'
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                A: [{originCoord[1].toFixed(2)}, {originCoord[0].toFixed(2)}]
              </button>
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={originQuery}
                  onChange={(e) => onPlaceSearch(e.target.value, 'origin')}
                  placeholder="Search Origin anywhere..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setClickTarget('dest')}
                className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border shrink-0 cursor-pointer ${
                  clickTarget === 'dest'
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                B: [{destCoord[1].toFixed(2)}, {destCoord[0].toFixed(2)}]
              </button>
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-slate-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={destQuery}
                  onChange={(e) => onPlaceSearch(e.target.value, 'dest')}
                  placeholder="Search Destination anywhere..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
                />
              </div>
            </div>

            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-20 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-30 max-h-44 overflow-y-auto divide-y divide-slate-800">
                {searchResults.map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelectSearchResult(item)}
                    className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 truncate cursor-pointer"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-0.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              Click map to set{' '}
              <strong className="text-white">
                {clickTarget === 'origin' ? 'Origin (A)' : 'Destination (B)'}
              </strong>{' '}
              (auto-snaps to road).
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            Click anywhere on the map to audit a 15-minute reachability zone.
          </p>
        )}
      </div>

      {/* 3. DIJKSTRA MINIMUM-AQI ROUTE HUD */}
      {activeMode === 'route' ? (
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3.5 rounded-xl shadow-2xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Dijkstra AQI Cost Weight (α)
            </span>
            <span className="text-xs font-mono text-emerald-400 font-bold">
              α = {alphaWeight.toFixed(2)}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={alphaWeight}
            onChange={(e) => setAlphaWeight(parseFloat(e.target.value))}
            className="w-full accent-emerald-500 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-400 -mt-2">
            <span className="text-emerald-400 font-medium">0.0 Lowest Σ AQI Path</span>
            <span>0.5 Balanced</span>
            <span className="text-orange-400 font-medium">1.0 Fastest Street</span>
          </div>

          <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-emerald-300 font-medium uppercase tracking-wider">
                IDW Line-Integral AQI Saved
              </div>
              <div className="text-lg font-extrabold text-white">
                -{aqiPayloadSavedPct}% Total Σ AQI Load
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400">Corridor Nodes</div>
              <div className="text-xs font-bold text-emerald-300">
                {optimalNodesGeoJson?.features?.length || 1} Low-AQI Pivots
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-lg bg-slate-950/80 border border-emerald-500/40">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-emerald-400">
                  Safest AQI Route
                </span>
                <span className="w-2.5 h-1 rounded bg-emerald-400" />
              </div>
              <div className="text-base font-bold text-white">
                Σ {cleanMetrics.cumulativeAqiSum}{' '}
                <span className="text-[10px] text-emerald-300 font-normal">AQI pts</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Avg: {cleanMetrics.avgPm25} µg/m³
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {cleanMetrics.durationMin} min · {cleanMetrics.distanceKm} km
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950/80 border border-orange-500/30">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-orange-400">
                  Direct Fast Route
                </span>
                <span className="w-2.5 h-1 rounded bg-orange-400" />
              </div>
              <div className="text-base font-bold text-white">
                Σ {fastMetrics.cumulativeAqiSum}{' '}
                <span className="text-[10px] text-orange-300 font-normal">AQI pts</span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5">
                Avg: {fastMetrics.avgPm25} µg/m³
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {fastMetrics.durationMin} min · {fastMetrics.distanceKm} km
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3.5 rounded-xl shadow-2xl flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
              15-Min Reachability Isochrone
            </span>
            <div className="flex gap-1">
              {['Pedestrian', 'Car'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTravelMode(mode)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                    travelMode === mode
                      ? 'bg-cyan-400 text-slate-950'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {isolineAudit && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Mean Zone PM2.5</div>
                  <div className="text-base font-bold text-white">
                    {isolineAudit.avgPm25} µg/m³
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                  <div className="text-[10px] text-slate-400">Zone Σ AQI Load</div>
                  <div className="text-base font-bold text-cyan-300">
                    {isolineAudit.cumulativeAqi} pts ({isolineAudit.sensorsInside} nodes)
                  </div>
                </div>
              </div>

              <div
                className={`p-2 rounded-lg border text-xs flex items-center gap-2 ${
                  isolineAudit.blindspotAlert
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-200'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                }`}
              >
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{isolineAudit.statusLabel}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* 4. ICEBERG TIME PARTITION & STORYTELLING INSIGHT */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl shadow-2xl space-y-2.5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Iceberg Time Partition
            </span>
            <span className="text-[11px] text-amber-300 font-mono">
              ×{timeSlot.multiplier} PM2.5
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {timeSlots.map((slot) => (
              <button
                key={slot.id}
                onClick={() => setTimeSlot(slot)}
                className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                  timeSlot.id === slot.id
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-200 font-semibold'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-800/80">
          <div className="flex items-center gap-1.5 text-amber-300 font-semibold text-[11px] mb-1">
            <Lightbulb className="w-3.5 h-3.5 shrink-0" />
            What the Map Reveals: {selectedCity.name}
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {selectedCity.description}
          </p>
        </div>
      </div>

      {/* 5. 60-FPS FRUSTUM CACHE TELEMETRY */}
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3 rounded-xl shadow-2xl text-xs">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Server className="w-3 h-3 text-emerald-400" />
            60-FPS Frustum Tile Store
          </span>
          <button
            onClick={onPurgeCache}
            className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-2.5 h-2.5" />
            Purge ({tileTelemetry.cachedTileCount}/30)
          </button>
        </div>

        <div className="text-[11px] text-emerald-300 truncate mb-1.5">
          {tileTelemetry.engineStatus}
        </div>

        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3 text-emerald-400" />
            {tileTelemetry.totalNodes} Culled Nodes
          </span>
          <span className="text-cyan-300 font-semibold">
            {tileTelemetry.pythonConnected ? 'DuckDB Online' : 'LRU Active'}
          </span>
        </div>
      </div>
    </aside>
  );
}