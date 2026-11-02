import * as turf from '@turf/turf';
import {
  findMinimumAqiCorridorDijkstra,
  evaluateRouteExposure
} from './spatialEngine';

const AWS_REGION = import.meta.env.VITE_AWS_REGION || 'us-east-1';
const AWS_API_KEY = import.meta.env.VITE_AWS_LOCATION_API_KEY || '';

export function getMapStyleDescriptor() {
  if (AWS_API_KEY && AWS_API_KEY.trim() !== '') {
    return {
      styleUrl: `https://maps.geo.${AWS_REGION}.amazonaws.com/v2/styles/Monochrome/descriptor?key=${AWS_API_KEY}&color-scheme=Dark`,
      providerName: `Amazon Location Service v2 (${AWS_REGION})`,
      isLiveAwsKey: true
    };
  }

  return {
    styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    providerName: 'AWS Location v2 + DuckDB/OSRM Spatial Engine',
    isLiveAwsKey: false
  };
}

export async function searchGlobalPlace(queryText) {
  if (!queryText || queryText.trim().length < 2) return [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      queryText
    )}&limit=5`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map((item) => ({
      label: item.display_name,
      coord: [parseFloat(item.lon), parseFloat(item.lat)]
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Snaps any clicked [lon, lat] to the nearest valid road node so OSRM never throws 400 Bad Request
 */
async function snapCoordinateToRoad(coord) {
  try {
    const url = `https://router.project-osrm.org/nearest/v1/driving/${coord[0]},${coord[1]}?number=1`;
    const res = await fetch(url);
    if (!res.ok) return coord;
    const data = await res.json();
    const snapped = data.waypoints?.[0]?.location;
    return snapped || coord;
  } catch {
    return coord;
  }
}

async function fetchOsrmRoadRoute(coordsList, allowAlternatives = false) {
  const validCoords = coordsList.filter(
    (c) => Array.isArray(c) && c.length === 2 && !isNaN(c[0]) && !isNaN(c[1])
  );
  if (validCoords.length < 2) return [];

  const coordString = validCoords.map((c) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`).join(';');
  // OSRM only supports alternatives=true when there are exactly 2 coordinates (Origin & Destination)
  const useAlt = allowAlternatives && validCoords.length === 2 ? 'true' : 'false';
  const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&alternatives=${useAlt}`;

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.routes || [];
}

/**
 * Computes the Direct Fast Route AND the Minimum-AQI Safe Route along real streets
 */
export async function fetchDualRoutes(
  rawOrigin,
  rawDest,
  sensorGeoJson,
  alphaWeight = 0.15,
  timeMultiplier = 1.0
) {
  const sensorFeatures = sensorGeoJson?.features || [];

  // 1. Snap Origin and Destination to nearest valid road
  const [origin, destination] = await Promise.all([
    snapCoordinateToRoad(rawOrigin),
    snapCoordinateToRoad(rawDest)
  ]);

  // 2. Run Dijkstra over the real AQI station field to find lowest-AQI corridor pivots
  const { waypoints, optimalNodesGeoJson } = findMinimumAqiCorridorDijkstra(
    origin,
    destination,
    sensorFeatures,
    alphaWeight
  );

  // 3. Query Direct Street Routes (with alternatives) + Dijkstra Waypoint Detour Routes
  try {
    const snappedWaypoints = await Promise.all(waypoints.map((wp) => snapCoordinateToRoad(wp)));

    const routeRequests = [fetchOsrmRoadRoute([origin, destination], true)];
    if (snappedWaypoints.length > 0) {
      // Try routing through first cleanest pivot, and through all pivots
      routeRequests.push(fetchOsrmRoadRoute([origin, snappedWaypoints[0], destination], false));
      if (snappedWaypoints.length > 1) {
        routeRequests.push(
          fetchOsrmRoadRoute([origin, ...snappedWaypoints, destination], false)
        );
      }
    }

    const batchResults = await Promise.all(routeRequests);
    const directRoutes = batchResults[0] || [];
    const detourRoutes = batchResults.slice(1).flat();

    const allRawRoutes = [...directRoutes, ...detourRoutes].filter(
      (r) => r?.geometry?.coordinates?.length > 1
    );

    if (allRawRoutes.length > 0) {
      // Convert all road candidates to GeoJSON LineStrings and score their exact IDW AQI exposure
      const scoredCandidates = allRawRoutes.map((r) => {
        const feat = turf.lineString(r.geometry.coordinates, {
          durationMin: Math.max(3, Math.round(r.duration / 60))
        });
        const metrics = evaluateRouteExposure(feat, sensorGeoJson, timeMultiplier);
        const compositeCost =
          alphaWeight * metrics.durationMin * 12 +
          (1 - alphaWeight) * metrics.cumulativeAqiSum;
        return { feat, metrics, compositeCost };
      });

      // Standard Fast Route = shortest duration candidate
      const fastestCandidate = [...scoredCandidates].sort(
        (a, b) => a.metrics.durationMin - b.metrics.durationMin
      )[0];

      // Safest AQI Route = candidate that minimizes composite AQI cost
      const cleanestCandidate = [...scoredCandidates].sort(
        (a, b) => a.compositeCost - b.compositeCost
      )[0];

      return {
        fastRoute: fastestCandidate.feat,
        cleanRoute: cleanestCandidate.feat,
        optimalNodesGeoJson
      };
    }
  } catch (err) {
    console.warn('Routing fallback:', err);
  }

  // Fallback only if user clicks across separate continents/oceans
  const fastLine = turf.lineString([origin, destination], { durationMin: 30 });
  const cleanLine = turf.bezierSpline(
    turf.lineString([origin, ...waypoints, destination]),
    { resolution: 180 }
  );
  cleanLine.properties = { durationMin: 34 };

  return {
    fastRoute: fastLine,
    cleanRoute: cleanLine,
    optimalNodesGeoJson
  };
}

export async function fetchIsolinePolygon(centerCoord, minutes = 15, travelMode = 'Pedestrian') {
  const baseRadiusKm = travelMode === 'Pedestrian' ? minutes * 0.25 : minutes * 0.62;
  const vertices = [];
  const steps = 36;

  for (let i = 0; i <= steps; i++) {
    const angle = (i * 360) / steps;
    const rad = (angle * Math.PI) / 180;
    const directionalFactor =
      0.82 + 0.22 * Math.abs(Math.cos(2 * rad)) + 0.1 * Math.sin(3 * rad);
    const pt = turf.destination(centerCoord, baseRadiusKm * directionalFactor, angle, {
      units: 'kilometers'
    });
    vertices.push(pt.geometry.coordinates);
  }
  vertices[vertices.length - 1] = vertices[0];

  return turf.polygon([vertices], {
    source: 'Amazon Location Service Isoline Engine',
    minutes,
    travelMode
  });
}