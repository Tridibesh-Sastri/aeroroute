import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Wind, RefreshCw, Layers, Code2 } from 'lucide-react';
import MapCanvas from './components/MapCanvas';
import ControlPanel from './components/ControlPanel';
import ArchitectureModal from './components/ArchitectureModal';
import ApiEndpointModal from './components/ApiEndpointModal';
import {
  GLOBAL_CITIES,
  evaluateRouteExposure,
  evaluateIsolineAudit
} from './services/spatialEngine';
import {
  analyzeRegionalSpectrumAndResolution,
  filterFeaturesByAqiSlider,
  buildDeveloperApiPayload
} from './services/resolutionEngine';
import {
  searchGlobalPlace,
  fetchDualRoutes,
  fetchIsolinePolygon
} from './services/awsLocation';
import {
  fetchViewportSpatialData,
  getCulledFeaturesGeoJson,
  clearSpatialTileCache
} from './services/spatialTileStore';

const TIME_SLOTS = [
  { id: 'live', label: 'LIVE Real-Time', multiplier: 1.0 },
  { id: 'rush', label: '09:00 Rush Peak', multiplier: 1.25 },
  { id: 'inversion', label: '22:00 Inversion', multiplier: 1.45 }
];

export default function App() {
  const [sensorData, setSensorData] = useState({ type: 'FeatureCollection', features: [] });
  const [currentZoom, setCurrentZoom] = useState(10.8);
  const [currentBbox, setCurrentBbox] = useState([76.8, 28.4, 77.5, 28.9]);

  // AQI Spectrum Slider & Filter State
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'BAND' | 'CEILING'
  const [targetAqi, setTargetAqi] = useState(85);
  const [bandwidth, setBandwidth] = useState(15);
  const [snapTarget, setSnapTarget] = useState(null);

  const [tileTelemetry, setTileTelemetry] = useState({
    engineStatus: 'Initializing 60-FPS Frustum Store...',
    cachedTileCount: 0,
    totalNodes: 0,
    pythonConnected: false
  });
  const [isFetchingTile, setIsFetchingTile] = useState(false);
  const [isArchModalOpen, setIsArchModalOpen] = useState(false);
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);

  const [selectedCity, setSelectedCity] = useState(GLOBAL_CITIES[1]); // Delhi NCR default
  const [activeMode, setActiveMode] = useState('route');
  const [clickTarget, setClickTarget] = useState('dest');
  const [alphaWeight, setAlphaWeight] = useState(0.15);
  const [timeSlot, setTimeSlot] = useState(TIME_SLOTS[0]);
  const [travelMode, setTravelMode] = useState('Pedestrian');

  const [originCoord, setOriginCoord] = useState(GLOBAL_CITIES[1].defaultOrigin);
  const [destCoord, setDestCoord] = useState(GLOBAL_CITIES[1].defaultDest);
  const [isolineCenter, setIsolineCenter] = useState(GLOBAL_CITIES[1].center);

  const [originQuery, setOriginQuery] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchingFor, setSearchingFor] = useState(null);

  const [fastRoute, setFastRoute] = useState(null);
  const [cleanRoute, setCleanRoute] = useState(null);
  const [optimalNodesGeoJson, setOptimalNodesGeoJson] = useState(null);
  const [isolinePolygon, setIsolinePolygon] = useState(null);

  const lastViewportRef = useRef({ bbox: [76.8, 28.4, 77.5, 28.9], zoom: 10.8 });

  // 1. Viewport Pan/Zoom Handler
  const handleViewportChange = useCallback(
    async (bbox, zoom) => {
      lastViewportRef.current = { bbox, zoom };
      setCurrentBbox(bbox);
      setCurrentZoom(zoom);
      setIsFetchingTile(true);

      const result = await fetchViewportSpatialData(bbox, zoom, originCoord, destCoord);
      setSensorData(result.geoJson);
      setTileTelemetry({
        engineStatus: result.engineStatus,
        cachedTileCount: result.cachedTileCount,
        totalNodes: result.totalNodes,
        pythonConnected: result.pythonConnected
      });
      setIsFetchingTile(false);
    },
    [originCoord, destCoord]
  );

  // 2. Analyze Regional AQI Spectrum [minAqi, maxAqi] & Spatial Resolution (d_min, Z_native)
  const resolutionTelemetry = useMemo(
    () =>
      analyzeRegionalSpectrumAndResolution(
        sensorData,
        timeSlot.multiplier,
        currentZoom
      ),
    [sensorData, timeSlot.multiplier, currentZoom]
  );

  // Keep targetAqi calibrated within the active region's [minAqi, maxAqi] bounds when switching cities
  useEffect(() => {
    const { minAqi, maxAqi, meanAqi } = resolutionTelemetry;
    if (targetAqi < minAqi || targetAqi > maxAqi) {
      setTargetAqi(meanAqi || Math.round((minAqi + maxAqi) / 2));
    }
  }, [selectedCity, resolutionTelemetry.minAqi, resolutionTelemetry.maxAqi]);

  // 3. Filter Active Features by AQI Slider
  const filteredFeatures = useMemo(
    () =>
      filterFeaturesByAqiSlider(
        resolutionTelemetry.enrichedFeatures,
        filterMode,
        targetAqi,
        bandwidth
      ),
    [resolutionTelemetry.enrichedFeatures, filterMode, targetAqi, bandwidth]
  );

  // 4. Build Live Open Developer REST API Payload
  const apiBundle = useMemo(
    () =>
      buildDeveloperApiPayload({
        regionName: selectedCity.name,
        bbox: currentBbox,
        filterMode,
        targetAqi,
        bandwidth,
        resolutionTelemetry,
        matchingFeatures: filteredFeatures
      }),
    [
      selectedCity.name,
      currentBbox,
      filterMode,
      targetAqi,
      bandwidth,
      resolutionTelemetry,
      filteredFeatures
    ]
  );

  // 5. Decoupled Route Calculation
  useEffect(() => {
    let cancelled = false;
    async function computeRoutes() {
      const corridorSensors = getCulledFeaturesGeoJson(
        lastViewportRef.current.bbox,
        originCoord,
        destCoord
      );
      if (!corridorSensors.features.length) return;

      const {
        fastRoute: fRoute,
        cleanRoute: cRoute,
        optimalNodesGeoJson: optNodes
      } = await fetchDualRoutes(
        originCoord,
        destCoord,
        corridorSensors,
        alphaWeight,
        timeSlot.multiplier
      );
      if (!cancelled) {
        setFastRoute(fRoute);
        setCleanRoute(cRoute);
        setOptimalNodesGeoJson(optNodes);
      }
    }
    computeRoutes();
    return () => {
      cancelled = true;
    };
  }, [originCoord, destCoord, alphaWeight, timeSlot.multiplier, sensorData.features.length === 0]);

  // 6. Recompute 15-Minute Isoline
  useEffect(() => {
    let cancelled = false;
    async function loadIsoline() {
      const poly = await fetchIsolinePolygon(isolineCenter, 15, travelMode);
      if (!cancelled) setIsolinePolygon(poly);
    }
    loadIsoline();
    return () => {
      cancelled = true;
    };
  }, [isolineCenter, travelMode]);

  const fastMetrics = useMemo(
    () => evaluateRouteExposure(fastRoute, sensorData, timeSlot.multiplier),
    [fastRoute, sensorData, timeSlot]
  );

  const cleanMetrics = useMemo(
    () => evaluateRouteExposure(cleanRoute, sensorData, timeSlot.multiplier),
    [cleanRoute, sensorData, timeSlot]
  );

  const aqiPayloadSavedPct = useMemo(() => {
    if (!fastMetrics.cumulativeAqiSum || fastMetrics.cumulativeAqiSum <= 0) return 0;
    const diff =
      ((fastMetrics.cumulativeAqiSum - cleanMetrics.cumulativeAqiSum) /
        fastMetrics.cumulativeAqiSum) *
      100;
    return Math.max(0, Math.round(diff));
  }, [fastMetrics, cleanMetrics]);

  const isolineAudit = useMemo(
    () => evaluateIsolineAudit(isolinePolygon, sensorData, timeSlot.multiplier),
    [isolinePolygon, sensorData, timeSlot]
  );

  const handleCitySelect = (city) => {
    setSelectedCity(city);
    setFilterMode('ALL');
    if (city.name !== 'Global 3D View') {
      setOriginCoord(city.defaultOrigin);
      setDestCoord(city.defaultDest);
      setIsolineCenter(city.center);
    }
  };

  // Triggered when user searches any custom town/city/country in AqiSpectrumFilter
  const handleSelectRegionLocation = (loc) => {
    const customCity = {
      name: loc.name,
      center: loc.center,
      zoom: loc.zoom || 10.6,
      defaultOrigin: [loc.center[0] - 0.06, loc.center[1] - 0.04],
      defaultDest: [loc.center[0] + 0.06, loc.center[1] + 0.04],
      coverageTier: 'Dynamic Regional Calibration',
      description: `Live AQI spectrum & spatial resolution calibrated for ${loc.name}. Scrub the AQI slider to isolate specific pollution bands or export via the Open API.`
    };
    setSelectedCity(customCity);
    setOriginCoord(customCity.defaultOrigin);
    setDestCoord(customCity.defaultDest);
    setIsolineCenter(customCity.center);
  };

  // Triggered when user clicks [Snap Max Res]
  const handleSnapToMaxResolution = () => {
    const targetCenter =
      resolutionTelemetry.closestPairMidpoint || selectedCity.center;
    setSnapTarget({
      center: targetCenter,
      zoom: resolutionTelemetry.maxNativeZoom,
      ts: Date.now()
    });
  };

  const handleMapCoordinateClick = (coord) => {
    if (activeMode === 'isoline') {
      setIsolineCenter(coord);
    } else if (clickTarget === 'origin') {
      setOriginCoord(coord);
      setClickTarget('dest');
    } else {
      setDestCoord(coord);
    }
  };

  const handlePlaceSearch = async (text, targetType) => {
    if (targetType === 'origin') setOriginQuery(text);
    else setDestQuery(text);

    setSearchingFor(targetType);
    if (text.trim().length >= 3) {
      const results = await searchGlobalPlace(text);
      setSearchResults(results);
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectSearchResult = (item) => {
    if (searchingFor === 'origin') {
      setOriginCoord(item.coord);
      setOriginQuery(item.label.split(',')[0]);
    } else {
      setDestCoord(item.coord);
      setDestQuery(item.label.split(',')[0]);
    }
    setSearchResults([]);
    setSearchingFor(null);
  };

  const handlePurgeCache = () => {
    clearSpatialTileCache();
    handleViewportChange(lastViewportRef.current.bbox, lastViewportRef.current.zoom);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      <MapCanvas
        filteredFeatures={filteredFeatures}
        closestPairLine={resolutionTelemetry.closestPairLine}
        optimalNodesGeoJson={optimalNodesGeoJson}
        selectedCity={selectedCity}
        snapTarget={snapTarget}
        activeMode={activeMode}
        alphaWeight={alphaWeight}
        fastRoute={fastRoute}
        cleanRoute={cleanRoute}
        isolinePolygon={isolinePolygon}
        isolineCenter={isolineCenter}
        originCoord={originCoord}
        destCoord={destCoord}
        onMapCoordinateClick={handleMapCoordinateClick}
        onViewportChange={handleViewportChange}
      />

      {/* TOP HEADER BAR */}
      <header className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-3 bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3.5 py-2 rounded-xl shadow-2xl">
          <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <Wind className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-white">AeroRoute Live</h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                {isFetchingTile && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
                {tileTelemetry.pythonConnected
                  ? 'DuckDB Lakehouse + Open API'
                  : '60-FPS Spatial Spectrum Engine'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Iso-AQI Spectrum Slicer · Native Resolution Analyzer · Minimum-AQI Street Router
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-1.5 rounded-xl shadow-2xl">
          {GLOBAL_CITIES.map((city) => {
            const isSelected = selectedCity.name === city.name;
            return (
              <button
                key={city.name}
                onClick={() => handleCitySelect(city)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 font-semibold shadow-lg shadow-emerald-500/20'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {city.name}
              </button>
            );
          })}

          <button
            onClick={() => setIsApiModalOpen(true)}
            className="ml-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 cursor-pointer"
          >
            <Code2 className="w-3.5 h-3.5" />
            Developer API
          </button>

          <button
            onClick={() => setIsArchModalOpen(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5" />
            AWS Lakehouse
          </button>
        </div>
      </header>

      <ControlPanel
        selectedCity={selectedCity}
        onSelectRegionLocation={handleSelectRegionLocation}
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        targetAqi={targetAqi}
        setTargetAqi={setTargetAqi}
        bandwidth={bandwidth}
        setBandwidth={setBandwidth}
        resolutionTelemetry={resolutionTelemetry}
        matchingCount={filteredFeatures.length}
        totalCount={resolutionTelemetry.enrichedFeatures.length}
        currentZoom={currentZoom}
        onSnapToMaxResolution={handleSnapToMaxResolution}
        onOpenApiModal={() => setIsApiModalOpen(true)}
        activeMode={activeMode}
        setActiveMode={setActiveMode}
        clickTarget={clickTarget}
        setClickTarget={setClickTarget}
        originCoord={originCoord}
        destCoord={destCoord}
        originQuery={originQuery}
        destQuery={destQuery}
        searchResults={searchResults}
        onPlaceSearch={handlePlaceSearch}
        onSelectSearchResult={handleSelectSearchResult}
        timeSlots={TIME_SLOTS}
        timeSlot={timeSlot}
        setTimeSlot={setTimeSlot}
        alphaWeight={alphaWeight}
        setAlphaWeight={setAlphaWeight}
        aqiPayloadSavedPct={aqiPayloadSavedPct}
        optimalNodesGeoJson={optimalNodesGeoJson}
        cleanMetrics={cleanMetrics}
        fastMetrics={fastMetrics}
        travelMode={travelMode}
        setTravelMode={setTravelMode}
        isolineAudit={isolineAudit}
        tileTelemetry={tileTelemetry}
        onPurgeCache={handlePurgeCache}
      />

      <ApiEndpointModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        apiBundle={apiBundle}
        pythonConnected={tileTelemetry.pythonConnected}
      />

      <ArchitectureModal
        isOpen={isArchModalOpen}
        onClose={() => setIsArchModalOpen(false)}
        tileTelemetry={tileTelemetry}
      />
    </div>
  );
}