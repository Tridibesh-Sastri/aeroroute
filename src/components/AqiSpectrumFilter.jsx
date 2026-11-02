import React, { useState } from 'react';
import {
  Sliders,
  Search,
  Maximize2,
  Code2,
  Crosshair,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { searchGlobalPlace } from '../services/awsLocation';

export default function AqiSpectrumFilter({
  regionName,
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
  onOpenApiModal
}) {
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const {
    minAqi = 10,
    maxAqi = 250,
    minDistanceKm = 1.5,
    meanDistanceKm = 3.2,
    maxNativeZoom = 12.0,
    isBeyondNativeResolution = false
  } = resolutionTelemetry || {};

  const handleSearchChange = async (e) => {
    const val = e.target.value;
    setLocationQuery(val);
    if (val.trim().length >= 2) {
      setIsSearching(true);
      const res = await searchGlobalPlace(val);
      setLocationResults(res);
      setIsSearching(false);
    } else {
      setLocationResults([]);
    }
  };

  const handlePickLocation = (item) => {
    const shortName = item.label.split(',')[0];
    setLocationQuery(shortName);
    setLocationResults([]);
    if (onSelectRegionLocation) {
      onSelectRegionLocation({
        name: shortName,
        center: item.coord,
        zoom: 10.6
      });
    }
  };

  // Dynamic color for the currently selected AQI value on the slider
  const getAqiColorClass = (aqiVal) => {
    if (aqiVal <= 50) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/15';
    if (aqiVal <= 100) return 'text-amber-300 border-amber-500/40 bg-amber-500/15';
    if (aqiVal <= 150) return 'text-orange-400 border-orange-500/40 bg-orange-500/15';
    return 'text-rose-400 border-rose-500/40 bg-rose-500/15';
  };

  const activeMin =
    filterMode === 'BAND' ? Math.max(minAqi, targetAqi - bandwidth) : minAqi;
  const activeMax =
    filterMode === 'BAND' ? Math.min(maxAqi, targetAqi + bandwidth) : targetAqi;

  return (
    <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 p-3.5 rounded-xl shadow-2xl space-y-3">
      {/* 1. HEADER & TOWN/CITY/COUNTRY SPECTRUM SEARCH */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5" />
          Regional AQI Spectrum & Resolution
        </span>
        <span className="text-[10px] font-mono text-slate-400">
          {matchingCount}/{totalCount} Zones Match
        </span>
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
        <input
          type="text"
          value={locationQuery}
          onChange={handleSearchChange}
          placeholder={`Search city/town to calibrate (Active: ${regionName})...`}
          className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-400"
        />
        {isSearching && (
          <span className="absolute right-2.5 top-2 text-[10px] text-emerald-400 animate-pulse">
            Scanning...
          </span>
        )}

        {locationResults.length > 0 && (
          <div className="absolute left-0 right-0 top-9 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-40 max-h-40 overflow-y-auto divide-y divide-slate-800">
            {locationResults.map((item, idx) => (
              <button
                key={idx}
                onClick={() => handlePickLocation(item)}
                className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 truncate cursor-pointer"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. FILTER MODE SELECTOR */}
      <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        {[
          { id: 'ALL', label: 'Full Spectrum' },
          { id: 'BAND', label: 'Specific AQI (±Δ)' },
          { id: 'CEILING', label: 'Cleanest (≤ AQI)' }
        ].map((mode) => (
          <button
            key={mode.id}
            onClick={() => {
              setFilterMode(mode.id);
              if (mode.id !== 'ALL' && (targetAqi < minAqi || targetAqi > maxAqi)) {
                setTargetAqi(Math.round((minAqi + maxAqi) / 2));
              }
            }}
            className={`py-1 px-1.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
              filterMode === mode.id
                ? 'bg-emerald-500 text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* 3. CONTINUOUS LOWEST-TO-HIGHEST AQI SLIDER */}
      <div className="space-y-1.5 pt-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-300 font-medium">
            {filterMode === 'ALL'
              ? `Regional Range: ${minAqi} – ${maxAqi} AQI`
              : filterMode === 'BAND'
              ? `Iso-AQI Slice: ${activeMin} – ${activeMax} AQI`
              : `Clean Ceiling: ≤ ${targetAqi} AQI`}
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold border ${getAqiColorClass(
              targetAqi
            )}`}
          >
            Target: {targetAqi} AQI
          </span>
        </div>

        <input
          type="range"
          min={minAqi}
          max={maxAqi}
          step="1"
          value={Math.min(maxAqi, Math.max(minAqi, targetAqi))}
          onChange={(e) => {
            if (filterMode === 'ALL') setFilterMode('BAND');
            setTargetAqi( parseInt(e.target.value, 10) );
          }}
          className="w-full accent-emerald-400 cursor-pointer"
        />

        <div className="flex justify-between items-center text-[10px] text-slate-400">
          <span className="text-emerald-400 font-mono">Lowest: {minAqi} AQI</span>
          {filterMode === 'BAND' && (
            <div className="flex items-center gap-1">
              <span>Band Δ:</span>
              {[8, 15, 30].map((bw) => (
                <button
                  key={bw}
                  onClick={() => setBandwidth(bw)}
                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono border cursor-pointer ${
                    bandwidth === bw
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                      : 'bg-slate-950 border-slate-800 text-slate-500'
                  }`}
                >
                  ±{bw}
                </button>
              ))}
            </div>
          )}
          <span className="text-rose-400 font-mono">Highest: {maxAqi} AQI</span>
        </div>
      </div>

      {/* 4. DATASET SPATIAL RESOLUTION & MAX ZOOM CONTROLLER */}
      <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800/90 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1">
            <Crosshair className="w-3 h-3" />
            Dataset Spatial Resolution
          </span>
          <span
            className={`text-[10px] font-semibold flex items-center gap-1 ${
              isBeyondNativeResolution ? 'text-amber-300' : 'text-emerald-400'
            }`}
          >
            {isBeyondNativeResolution ? (
              <>
                <AlertTriangle className="w-3 h-3" />
                IDW Interpolated
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" />
                Native Ground-Truth
              </>
            )}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div className="text-[9px] text-slate-400">Min Spacing (d_min)</div>
            <div className="text-xs font-bold text-white font-mono">{minDistanceKm} km</div>
          </div>
          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div className="text-[9px] text-slate-400">Mean Spacing</div>
            <div className="text-xs font-bold text-slate-200 font-mono">{meanDistanceKm} km</div>
          </div>
          <div className="p-1.5 rounded bg-slate-900 border border-slate-800">
            <div className="text-[9px] text-slate-400">Zoom / Max Native</div>
            <div className="text-xs font-bold text-cyan-300 font-mono">
              {currentZoom.toFixed(1)} / {maxNativeZoom}x
            </div>
          </div>
        </div>

        {/* Action Buttons: Snap to Max Resolution + Expose Developer API */}
        <div className="grid grid-cols-2 gap-1.5 pt-0.5">
          <button
            onClick={onSnapToMaxResolution}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-[11px] font-semibold transition-all cursor-pointer"
            title="Zoom to the closest consistent sensor pair at maximum native dataset resolution"
          >
            <Maximize2 className="w-3 h-3" />
            Snap Max Res ({maxNativeZoom}x)
          </button>

          <button
            onClick={onOpenApiModal}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition-all cursor-pointer"
            title="Access Open Developer REST API & GeoJSON for this filtered AQI slice"
          >
            <Code2 className="w-3.5 h-3.5" />
            Open API ({matchingCount} pts)
          </button>
        </div>
      </div>
    </div>
  );
}