import * as turf from '@turf/turf';
import { pm25ToUsAqi } from './spatialEngine';

/**
 * Computes the AQI spectrum [minAqi, maxAqi] and spatial resolution metrics
 * (min inter-sensor distance d_min, mean distance, and max native zoom level)
 * for all sensor features in the active region.
 */
export function analyzeRegionalSpectrumAndResolution(sensorGeoJson, timeMultiplier = 1.0, currentZoom = 10.0) {
  const features = sensorGeoJson?.features || [];

  if (features.length === 0) {
    return {
      minAqi: 10,
      maxAqi: 300,
      meanAqi: 75,
      minDistanceKm: 0,
      meanDistanceKm: 0,
      maxNativeZoom: 12.0,
      isBeyondNativeResolution: false,
      resolutionStatus: 'Awaiting Regional Telemetry...',
      closestPairLine: null,
      closestPairMidpoint: null,
      enrichedFeatures: []
    };
  }

  let minAqi = Infinity;
  let maxAqi = -Infinity;
  let sumAqi = 0;

  const enrichedFeatures = features.map((f) => {
    const rawPm25 = Number(f.properties?.pm25 ?? 20);
    const scaledPm25 = Number((rawPm25 * timeMultiplier).toFixed(1));
    const aqi = pm25ToUsAqi(scaledPm25);

    if (aqi < minAqi) minAqi = aqi;
    if (aqi > maxAqi) maxAqi = aqi;
    sumAqi += aqi;

    return {
      ...f,
      properties: {
        ...f.properties,
        adjusted_pm25: scaledPm25,
        computed_aqi: aqi
      }
    };
  });

  if (minAqi === Infinity) minAqi = 10;
  if (maxAqi === -Infinity || maxAqi <= minAqi) maxAqi = minAqi + 50;

  // Compute nearest-neighbor inter-sensor spacing (d_min and d_mean)
  // Sample up to 180 nodes in view for O(N) real-time speed
  const samplePool = enrichedFeatures.slice(0, 180);
  let globalMinDistKm = Infinity;
  let sumNearestDistKm = 0;
  let validPairs = 0;
  let closestPairCoords = null;

  for (let i = 0; i < samplePool.length; i++) {
    const coordA = samplePool[i].geometry.coordinates;
    let nearestForNode = Infinity;
    let nearestCoordB = null;

    for (let j = 0; j < samplePool.length; j++) {
      if (i === j) continue;
      const coordB = samplePool[j].geometry.coordinates;
      const dKm = turf.distance(coordA, coordB, { units: 'kilometers' });

      // Ignore duplicate/zero-distance points (< 0.05 km) to find consistent physical spacing
      if (dKm >= 0.05 && dKm < nearestForNode) {
        nearestForNode = dKm;
        nearestCoordB = coordB;
      }
    }

    if (nearestForNode < Infinity) {
      sumNearestDistKm += nearestForNode;
      validPairs += 1;
      if (nearestForNode < globalMinDistKm) {
        globalMinDistKm = nearestForNode;
        closestPairCoords = [coordA, nearestCoordB];
      }
    }
  }

  const minDistanceKm = globalMinDistKm < Infinity ? Number(globalMinDistKm.toFixed(2)) : 2.5;
  const meanDistanceKm = validPairs > 0 ? Number((sumNearestDistKm / validPairs).toFixed(2)) : 4.0;

  // Calculate Maximum Native Zoom Ceiling (Z_native) using latitude & min sensor spacing
  const sampleLat = samplePool[0]?.geometry?.coordinates?.[1] || 25.0;
  const cosLat = Math.max(0.2, Math.cos((sampleLat * Math.PI) / 180));
  // At Z_native, adjacent sensors at d_min are separated by ~80 screen pixels
  const rawMaxZoom = Math.log2((40075 * cosLat) / Math.max(0.15, minDistanceKm * 6.5));
  const maxNativeZoom = Number(Math.min(15.5, Math.max(6.5, rawMaxZoom)).toFixed(1));

  const isBeyondNativeResolution = currentZoom > maxNativeZoom + 0.4;

  const resolutionStatus = isBeyondNativeResolution
    ? `Sub-Grid IDW Interpolation (Zoom ${currentZoom.toFixed(1)} > Native ${maxNativeZoom})`
    : `Native Ground-Truth Grid (Min Spacing: ${minDistanceKm} km)`;

  let closestPairLine = null;
  let closestPairMidpoint = null;
  if (closestPairCoords) {
    closestPairLine = turf.lineString(closestPairCoords, {
      distanceKm: minDistanceKm,
      label: `Min Spacing: ${minDistanceKm} km`
    });
    closestPairMidpoint = turf.midpoint(closestPairCoords[0], closestPairCoords[1]).geometry.coordinates;
  }

  return {
    minAqi,
    maxAqi,
    meanAqi: Math.round(sumAqi / enrichedFeatures.length),
    minDistanceKm,
    meanDistanceKm,
    maxNativeZoom,
    isBeyondNativeResolution,
    resolutionStatus,
    closestPairLine,
    closestPairMidpoint,
    enrichedFeatures
  };
}

/**
 * Filters enriched features by the user's AQI Spectrum Slider settings
 * Modes:
 * - 'ALL': Full regional spectrum
 * - 'BAND': Specific Iso-AQI slice [targetAqi - bandwidth, targetAqi + bandwidth]
 * - 'CEILING': All clean locations up to targetAqi (<= targetAqi)
 */
export function filterFeaturesByAqiSlider(
  enrichedFeatures,
  filterMode = 'ALL',
  targetAqi = 80,
  bandwidth = 15
) {
  if (!enrichedFeatures || enrichedFeatures.length === 0) return [];
  if (filterMode === 'ALL') return enrichedFeatures;

  const minBound = filterMode === 'BAND' ? Math.max(0, targetAqi - bandwidth) : 0;
  const maxBound = filterMode === 'BAND' ? targetAqi + bandwidth : targetAqi;

  return enrichedFeatures.filter((f) => {
    const aqi = f.properties?.computed_aqi ?? f.properties?.aqi ?? 50;
    return aqi >= minBound && aqi <= maxBound;
  });
}

/**
 * Generates the live Open Developer REST API URL & JSON response payload
 * so external developers can query filtered AQI locations and resolution metrics.
 */
export function buildDeveloperApiPayload({
  regionName,
  bbox,
  filterMode,
  targetAqi,
  bandwidth,
  resolutionTelemetry,
  matchingFeatures
}) {
  const aqiMin =
    filterMode === 'ALL'
      ? resolutionTelemetry.minAqi
      : filterMode === 'BAND'
      ? Math.max(0, targetAqi - bandwidth)
      : 0;
  const aqiMax =
    filterMode === 'ALL'
      ? resolutionTelemetry.maxAqi
      : filterMode === 'BAND'
      ? targetAqi + bandwidth
      : targetAqi;

  const queryParams = new URLSearchParams({
    region: regionName || 'Custom_Viewport',
    aqi_min: String(aqiMin),
    aqi_max: String(aqiMax),
    max_res_km: String(resolutionTelemetry.minDistanceKm || 1.5),
    native_zoom: String(resolutionTelemetry.maxNativeZoom || 12.0),
    format: 'geojson'
  });

  if (bbox && bbox.length === 4) {
    queryParams.set('bbox', bbox.map((n) => Number(n).toFixed(3)).join(','));
  }

  const endpointPath = `/api/v1/extract?${queryParams.toString()}`;

  const payload = {
    type: 'FeatureCollection',
    api_version: '1.0.0-aws-mapit',
    query_metadata: {
      region: regionName || 'Custom_Viewport',
      filter_mode: filterMode,
      aqi_range: [aqiMin, aqiMax],
      matching_locations_count: matchingFeatures.length,
      spatial_resolution: {
        min_sensor_spacing_km: resolutionTelemetry.minDistanceKm,
        mean_sensor_spacing_km: resolutionTelemetry.meanDistanceKm,
        max_native_zoom_level: resolutionTelemetry.maxNativeZoom,
        nyquist_status: resolutionTelemetry.resolutionStatus
      },
      data_sources: [
        'Registry of Open Data on AWS (s3://openaq-data-archive/)',
        'AeroRoute DuckDB + Apache Iceberg Spatial Lakehouse'
      ]
    },
    features: matchingFeatures.slice(0, 100).map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        id: f.properties.id,
        city: f.properties.city,
        aqi: f.properties.computed_aqi ?? f.properties.aqi,
        pm25_ug_m3: f.properties.adjusted_pm25 ?? f.properties.pm25,
        risk_tier: f.properties.risk_tier,
        coverage_tier: f.properties.coverage_tier
      }
    }))
  };

  return {
    endpointPath,
    aqiMin,
    aqiMax,
    payload
  };
}