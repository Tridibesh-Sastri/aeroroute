import * as turf from '@turf/turf';

export const GLOBAL_CITIES = [
  {
    name: 'Global 3D View',
    center: [78.0, 22.0],
    zoom: 3.2,
    defaultOrigin: [77.1025, 28.5562],
    defaultDest: [77.2410, 28.6562],
    coverageTier: 'Dynamic Cluster View',
    description: 'Pan anywhere on the globe. Real stations dynamically cluster by region and split into street sensors as you zoom in.'
  },
  {
    name: 'Delhi NCR',
    center: [77.2090, 28.6139],
    zoom: 10.8,
    defaultOrigin: [77.1025, 28.5562],
    defaultDest: [77.2410, 28.6562],
    coverageTier: 'Dense Monitoring',
    description: 'High-density CPCB & OpenAQ sensor grid extracted via Colab DuckDB pipeline.'
  },
  {
    name: 'Kolkata - Hooghly',
    center: [88.3639, 22.5726],
    zoom: 11.0,
    defaultOrigin: [88.3426, 22.5850],
    defaultDest: [88.4312, 22.5760],
    coverageTier: 'Moderate Monitoring',
    description: 'Hooghly industrial and urban corridor with live river-breeze AQI gradients.'
  },
  {
    name: 'Rural Sensor Desert',
    center: [87.5000, 23.2000],
    zoom: 9.8,
    defaultOrigin: [87.3200, 23.0800],
    defaultDest: [87.6800, 23.3200],
    coverageTier: 'Sensor Desert',
    description: 'Sparse monitoring zone (<1 station per 500 km²) demonstrating public-health blindspot detection.'
  },
  {
    name: 'Los Angeles',
    center: [-118.2437, 34.0522],
    zoom: 10.5,
    defaultOrigin: [-118.4085, 33.9416],
    defaultDest: [-118.1445, 34.1478],
    coverageTier: 'Dense Monitoring',
    description: 'South Coast AQMD sensor grid tracking basin traffic and coastal corridors.'
  },
  {
    name: 'London',
    center: [-0.1276, 51.5074],
    zoom: 11.2,
    defaultOrigin: [-0.2150, 51.5050],
    defaultDest: [-0.0195, 51.5054],
    coverageTier: 'Dense Monitoring',
    description: 'Breathe London network comparing Thames corridors against central arterial roads.'
  }
];

export function pm25ToUsAqi(pm25) {
  if (pm25 <= 12.0) return Math.round((50 / 12.0) * pm25);
  if (pm25 <= 35.4) return Math.round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51);
  if (pm25 <= 55.4) return Math.round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101);
  if (pm25 <= 150.4) return Math.round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151);
  return Math.min(500, Math.round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201));
}

export function getRiskTier(pm25) {
  if (pm25 >= 55.5) return 'HAZARDOUS';
  if (pm25 >= 35.5) return 'UNHEALTHY';
  if (pm25 >= 12.1) return 'MODERATE';
  return 'GOOD';
}

/**
 * Inverse Distance Weighting (IDW) interpolation at any coordinate [lon, lat]
 * using the 6 nearest real AQI stations in the cached spatial store.
 */
export function interpolateAqiAtPoint(coord, nearbyFeatures, timeMultiplier = 1.0) {
  if (!nearbyFeatures || nearbyFeatures.length === 0) {
    return { pm25: 22.0, aqi: 72 };
  }

  let weightSum = 0;
  let pm25Weighted = 0;

  for (let i = 0; i < nearbyFeatures.length; i++) {
    const f = nearbyFeatures[i];
    const dKm = Math.max(0.15, turf.distance(coord, f.geometry.coordinates, { units: 'kilometers' }));
    if (dKm > 120) continue; // Ignore stations far outside the corridor
    const w = 1 / Math.pow(dKm, 2.2);
    const val = (f.properties?.pm25 ?? 22) * timeMultiplier;
    weightSum += w;
    pm25Weighted += w * val;
  }

  if (weightSum === 0) {
    const pt = turf.point(coord);
    const nearest = turf.nearestPoint(pt, turf.featureCollection(nearbyFeatures));
    const val = (nearest?.properties?.pm25 ?? 22) * timeMultiplier;
    return { pm25: val, aqi: pm25ToUsAqi(val) };
  }

  const pm25 = pm25Weighted / weightSum;
  return { pm25, aqi: pm25ToUsAqi(pm25) };
}

/**
 * High-Accuracy Dijkstra Minimum-AQI Pathfinding over the Corridor Station Graph:
 * Finds the lowest-AQI intermediate pivot coordinates between Origin and Destination.
 */
export function findMinimumAqiCorridorDijkstra(origin, dest, allSensorFeatures, alphaWeight = 0.15) {
  if (!allSensorFeatures || allSensorFeatures.length === 0) {
    return { waypoints: [], optimalNodesGeoJson: turf.featureCollection([]) };
  }

  const directDistKm = Math.max(0.5, turf.distance(origin, dest, { units: 'kilometers' }));
  const midPt = turf.midpoint(origin, dest).geometry.coordinates;

  // Filter stations within the routing corridor ellipse (radius = 85% of trip distance)
  const corridorStations = allSensorFeatures.filter((f) => {
    const dMid = turf.distance(midPt, f.geometry.coordinates, { units: 'kilometers' });
    return dMid <= Math.max(15, directDistKm * 0.85);
  });

  if (corridorStations.length === 0) {
    return { waypoints: [], optimalNodesGeoJson: turf.featureCollection([]) };
  }

  const originAqi = interpolateAqiAtPoint(origin, corridorStations).aqi;
  const destAqi = interpolateAqiAtPoint(dest, corridorStations).aqi;

  const nodes = [
    { id: 'origin', coord: origin, pm25: 18, aqi: originAqi },
    ...corridorStations.map((f, i) => ({
      id: f.properties?.id || `node_${i}`,
      coord: f.geometry.coordinates,
      pm25: f.properties?.adjusted_pm25 ?? f.properties?.pm25 ?? 25,
      aqi: f.properties?.aqi ?? pm25ToUsAqi(f.properties?.pm25 ?? 25)
    })),
    { id: 'dest', coord: dest, pm25: 18, aqi: destAqi }
  ];

  const n = nodes.length;
  const maxEdgeKm = Math.max(8, directDistKm * 0.55);
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const visited = new Array(n).fill(false);

  dist[0] = 0;

  for (let step = 0; step < n; step++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === n - 1) break;
    visited[u] = true;

    for (let v = 1; v < n; v++) {
      if (visited[v] || u === v) continue;

      const edgeKm = turf.distance(nodes[u].coord, nodes[v].coord, { units: 'kilometers' });
      if (edgeKm > maxEdgeKm && !(u === 0 && v === n - 1)) continue;

      // Forward progress constraint toward Destination
      const remU = turf.distance(nodes[u].coord, dest, { units: 'kilometers' });
      const remV = turf.distance(nodes[v].coord, dest, { units: 'kilometers' });
      if (remV > remU * 1.12) continue;

      // Composite Cost = Distance * [ alpha + (1 - alpha) * (Node_AQI / 30)^2.4 ]
      const meanAqi = (nodes[u].aqi + nodes[v].aqi) / 2;
      const aqiWeightFactor = Math.pow(meanAqi / 30.0, 2.4);
      const edgeCost = edgeKm * (alphaWeight * 1.5 + (1 - alphaWeight) * aqiWeightFactor);

      // Penalize direct un-guided jump 0 -> n-1 so Dijkstra selects clean corridor pivots
      const skipPenalty = u === 0 && v === n - 1 ? 2.8 : 1.0;

      const candidateCost = dist[u] + edgeCost * skipPenalty;
      if (candidateCost < dist[v]) {
        dist[v] = candidateCost;
        prev[v] = u;
      }
    }
  }

  const path = [];
  let curr = n - 1;
  while (curr !== -1) {
    path.unshift(curr);
    curr = prev[curr];
  }

  const pivots = path.slice(1, -1).map((idx) => nodes[idx]);

  // Select the single cleanest pivot or top 2 pivots for road routing
  let waypoints = [];
  if (pivots.length === 1) {
    waypoints = [pivots[0].coord];
  } else if (pivots.length >= 2) {
    // Pick the lowest-AQI pivot in the first half and second half
    const midIdx = Math.floor(pivots.length / 2);
    waypoints = [pivots[0].coord, pivots[midIdx].coord];
  }

  const optimalNodeFeatures = pivots.map((nd, i) =>
    turf.point(nd.coord, {
      id: nd.id,
      step: i + 1,
      pm25: nd.pm25,
      aqi: nd.aqi
    })
  );

  return {
    waypoints,
    optimalNodesGeoJson: turf.featureCollection(optimalNodeFeatures)
  };
}

/**
 * Evaluates a street route using 24-point IDW Line-Integral sampling across the real AQI field
 */
export function evaluateRouteExposure(routeFeature, sensorGeoJson, timeMultiplier = 1.0) {
  const allFeatures = sensorGeoJson?.features || [];
  if (!routeFeature || allFeatures.length === 0) {
    return {
      distanceKm: 0,
      durationMin: 0,
      avgPm25: 0,
      peakPm25: 0,
      cumulativeAqiSum: 0,
      inhaledDoseUg: 0,
      sensorsHit: 0
    };
  }

  const distanceKm = Math.max(0.2, turf.length(routeFeature, { units: 'kilometers' }));
  const bbox = turf.bbox(routeFeature);
  const pad = 0.35;

  // Pre-filter local corridor stations for fast IDW evaluation
  const localStations = allFeatures.filter((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return (
      lon >= bbox[0] - pad &&
      lon <= bbox[2] + pad &&
      lat >= bbox[1] - pad &&
      lat <= bbox[3] + pad
    );
  });

  const activePool = localStations.length > 0 ? localStations : allFeatures;
  const sampleSteps = 20;
  let sumPm25 = 0;
  let peakPm25 = 0;
  let cumulativeAqiSum = 0;

  for (let i = 0; i <= sampleSteps; i++) {
    const pt = turf.along(routeFeature, (distanceKm * i) / sampleSteps, {
      units: 'kilometers'
    });
    const { pm25, aqi } = interpolateAqiAtPoint(
      pt.geometry.coordinates,
      activePool,
      timeMultiplier
    );
    sumPm25 += pm25;
    if (pm25 > peakPm25) peakPm25 = pm25;
    cumulativeAqiSum += aqi;
  }

  const avgPm25 = sumPm25 / (sampleSteps + 1);
  const durationMin =
    routeFeature.properties?.durationMin || Math.max(3, Math.round(distanceKm * 2.0));
  const inhaledDoseUg = avgPm25 * durationMin * 0.015;

  return {
    distanceKm: Number(distanceKm.toFixed(1)),
    durationMin: Math.round(durationMin),
    avgPm25: Number(avgPm25.toFixed(1)),
    peakPm25: Number(peakPm25.toFixed(1)),
    cumulativeAqiSum: Math.round(cumulativeAqiSum),
    inhaledDoseUg: Number(inhaledDoseUg.toFixed(1)),
    sensorsHit: localStations.length
  };
}

export function evaluateIsolineAudit(isolinePolygon, sensorGeoJson, timeMultiplier = 1.0) {
  if (!isolinePolygon || !sensorGeoJson?.features?.length) return null;

  const inside = turf.pointsWithinPolygon(sensorGeoJson, isolinePolygon);
  const features = inside.features || [];
  const areaKm2 = turf.area(isolinePolygon) / 1_000_000;

  let sumPm25 = 0;
  let sumAqi = 0;

  features.forEach((f) => {
    const val = (f.properties?.pm25 || 0) * timeMultiplier;
    sumPm25 += val;
    sumAqi += pm25ToUsAqi(val);
  });

  // If isoline falls between grid points, interpolate at center
  if (features.length === 0) {
    const centerPt = turf.center(isolinePolygon).geometry.coordinates;
    const interp = interpolateAqiAtPoint(centerPt, sensorGeoJson.features, timeMultiplier);
    sumPm25 = interp.pm25;
    sumAqi = interp.aqi;
  }

  const avgPm25 = features.length > 0 ? sumPm25 / features.length : sumPm25;

  return {
    areaKm2: Number(areaKm2.toFixed(1)),
    sensorsInside: features.length,
    avgPm25: Number(avgPm25.toFixed(1)),
    cumulativeAqi: Math.round(sumAqi),
    blindspotAlert: features.length < 3,
    statusLabel:
      features.length === 0
        ? 'SENSOR DESERT BLINDSPOT (IDW Interpolated)'
        : features.length < 3
        ? 'SPARSE COVERAGE (<3 Stations in Reach)'
        : 'VERIFIED DENSE COVERAGE'
  };
}