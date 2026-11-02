import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import * as turf from '@turf/turf';
import { getMapStyleDescriptor } from '../services/awsLocation';

maplibregl.setWorkerUrl(workerUrl);

export default function MapCanvas({
  filteredFeatures,
  closestPairLine,
  optimalNodesGeoJson,
  selectedCity,
  snapTarget,
  activeMode,
  alphaWeight,
  fastRoute,
  cleanRoute,
  isolinePolygon,
  isolineCenter,
  originCoord,
  destCoord,
  onMapCoordinateClick,
  onViewportChange
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const onClickCallbackRef = useRef(onMapCoordinateClick);
  const onViewportCallbackRef = useRef(onViewportChange);

  useEffect(() => {
    onClickCallbackRef.current = onMapCoordinateClick;
    onViewportCallbackRef.current = onViewportChange;
  }, [onMapCoordinateClick, onViewportChange]);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const { styleUrl } = getMapStyleDescriptor();

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: selectedCity.center,
      zoom: selectedCity.zoom,
      pitch: selectedCity.zoom > 5 ? 30 : 0,
      bearing: 0,
      attributionControl: false
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    let moveTimeout = null;
    const emitBounds = () => {
      if (!onViewportCallbackRef.current) return;
      const b = map.getBounds();
      const bbox = [
        Number(b.getWest().toFixed(4)),
        Number(b.getSouth().toFixed(4)),
        Number(b.getEast().toFixed(4)),
        Number(b.getNorth().toFixed(4))
      ];
      onViewportCallbackRef.current(bbox, map.getZoom());
    };

    map.on('moveend', () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      moveTimeout = setTimeout(emitBounds, 300);
    });

    map.on('load', () => {
      try {
        map.setProjection({ type: 'globe' });
      } catch (e) {
        // Fallback if style doesn't support globe
      }

      map.addSource('sensors-clustered', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 55,
        clusterProperties: {
          sum_pm25: ['+', ['get', 'adjusted_pm25']]
        }
      });

      map.addSource('sensors-raw', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('closest-pair', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('dijkstra-nodes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('isoline', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('fast-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('clean-route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addSource('route-endpoints', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // LAYER 1: Ambient Pollution Plume Glow
      map.addLayer({
        id: 'sensor-glow',
        type: 'circle',
        source: 'sensors-raw',
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            2, 10,
            7, 22,
            12, 38
          ],
          'circle-color': [
            'step',
            ['get', 'adjusted_pm25'],
            '#10B981', 15,
            '#FBBF24', 35,
            '#F97316', 55,
            '#EF4444'
          ],
          'circle-opacity': 0.22,
          'circle-blur': 0.85
        }
      });

      // LAYER 2: Dynamic Regional Clusters
      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'sensors-clustered',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            22,
            10, 30,
            35, 40
          ],
          'circle-color': [
            'step',
            ['/', ['get', 'sum_pm25'], ['get', 'point_count']],
            '#10B981', 15,
            '#FBBF24', 35,
            '#F97316', 55,
            '#EF4444'
          ],
          'circle-opacity': 0.35,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': [
            'step',
            ['/', ['get', 'sum_pm25'], ['get', 'point_count']],
            '#10B981', 15,
            '#FBBF24', 35,
            '#F97316', 55,
            '#EF4444'
          ]
        }
      });

      map.addLayer({
        id: 'cluster-labels',
        type: 'symbol',
        source: 'sensors-clustered',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': [
            'concat',
            ['to-string', ['round', ['/', ['get', 'sum_pm25'], ['get', 'point_count']]]],
            ' µg\n(',
            ['get', 'point_count_abbreviated'],
            ' st)'
          ],
          'text-size': 11
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#090d16',
          'text-halo-width': 1.5
        }
      });

      // LAYER 3: Sensor Desert Warning Rings
      map.addLayer({
        id: 'sensor-desert-ring',
        type: 'circle',
        source: 'sensors-raw',
        minzoom: 6,
        filter: ['==', ['get', 'coverage_tier'], 'Sensor Desert'],
        paint: {
          'circle-radius': 34,
          'circle-color': 'transparent',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#F43F5E',
          'circle-stroke-opacity': 0.85
        }
      });

      // LAYER 4: Minimum Inter-Sensor Resolution Vector (d_min line)
      map.addLayer({
        id: 'closest-pair-line',
        type: 'line',
        source: 'closest-pair',
        minzoom: 8,
        paint: {
          'line-color': '#38BDF8',
          'line-width': 2.5,
          'line-dasharray': [2, 2]
        }
      });

      map.addLayer({
        id: 'closest-pair-label',
        type: 'symbol',
        source: 'closest-pair',
        minzoom: 8,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, -0.8]
        },
        paint: {
          'text-color': '#38BDF8',
          'text-halo-color': '#090d16',
          'text-halo-width': 2
        }
      });

      // LAYER 5: 15-Minute Isoline Fill & Outline
      map.addLayer({
        id: 'isoline-fill',
        type: 'fill',
        source: 'isoline',
        paint: {
          'fill-color': '#06B6D4',
          'fill-opacity': 0.18
        }
      });

      map.addLayer({
        id: 'isoline-outline',
        type: 'line',
        source: 'isoline',
        paint: {
          'line-color': '#22D3EE',
          'line-width': 2.5,
          'line-dasharray': [2, 2]
        }
      });

      // LAYER 6: Direct Fast Street Route
      map.addLayer({
        id: 'fast-route-line',
        type: 'line',
        source: 'fast-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#F97316',
          'line-width': 4,
          'line-opacity': 0.8,
          'line-dasharray': [2, 1.5]
        }
      });

      // LAYER 7: Safest AQI Street Route
      map.addLayer({
        id: 'clean-route-glow',
        type: 'line',
        source: 'clean-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#10B981',
          'line-width': 13,
          'line-opacity': 0.3,
          'line-blur': 4
        }
      });

      map.addLayer({
        id: 'clean-route-line',
        type: 'line',
        source: 'clean-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#10B981',
          'line-width': 5.5,
          'line-opacity': 0.98
        }
      });

      // LAYER 8: Dijkstra Low-AQI Corridor Pivot Nodes
      map.addLayer({
        id: 'dijkstra-corridor-nodes',
        type: 'circle',
        source: 'dijkstra-nodes',
        paint: {
          'circle-radius': 6.5,
          'circle-color': '#059669',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#A7F3D0'
        }
      });

      // LAYER 9: Individual Unclustered Sensor Stations
      map.addLayer({
        id: 'sensor-points',
        type: 'circle',
        source: 'sensors-clustered',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5, 5.5,
            10, 8,
            13, 11.5
          ],
          'circle-color': [
            'step',
            ['get', 'adjusted_pm25'],
            '#10B981', 15,
            '#FBBF24', 35,
            '#F97316', 55,
            '#EF4444'
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0F172A'
        }
      });

      // LAYER 10: Street-Level AQI & PM2.5 Numeric Labels
      map.addLayer({
        id: 'sensor-value-labels',
        type: 'symbol',
        source: 'sensors-clustered',
        filter: ['!', ['has', 'point_count']],
        minzoom: 8.5,
        layout: {
          'text-field': [
            'concat',
            ['to-string', ['get', 'computed_aqi']],
            ' AQI'
          ],
          'text-size': 10,
          'text-offset': [0, -1.35],
          'text-allow-overlap': false
        },
        paint: {
          'text-color': '#F8FAFC',
          'text-halo-color': '#0F172A',
          'text-halo-width': 1.5
        }
      });

      // LAYER 11: Origin (A) & Destination (B) Pins
      map.addLayer({
        id: 'endpoints-circle',
        type: 'circle',
        source: 'route-endpoints',
        paint: {
          'circle-radius': 9,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.on('click', 'cluster-circles', async (e) => {
        e.originalEvent.stopPropagation();
        const features = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (!clusterId) return;
        const zoom = await map.getSource('sensors-clustered').getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: features[0].geometry.coordinates,
          zoom: zoom + 0.5,
          duration: 900
        });
      });

      map.on('click', 'sensor-points', (e) => {
        e.originalEvent.stopPropagation();
        const feat = e.features?.[0];
        if (!feat) return;

        const coords = feat.geometry.coordinates.slice();
        const props = feat.properties;

        const badgeBg =
          props.adjusted_pm25 >= 55.5
            ? '#EF4444'
            : props.adjusted_pm25 >= 35.5
            ? '#F97316'
            : props.adjusted_pm25 >= 15
            ? '#FBBF24'
            : '#10B981';

        const html = `
          <div style="min-width: 215px; font-family: system-ui, sans-serif;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.05em; color:#94a3b8;">
                ${props.id} · ${props.city || 'Station'}
              </span>
              <span style="background:${badgeBg}; color:#090d16; font-weight:700; font-size:10px; padding:2px 6px; border-radius:4px;">
                ${props.risk_tier}
              </span>
            </div>
            <div style="display:flex; align-items:baseline; gap:10px; margin-bottom:4px;">
              <div style="font-size:22px; font-weight:800; color:#f8fafc;">
                AQI ${props.computed_aqi || props.aqi}
              </div>
              <div style="font-size:13px; font-weight:600; color:#38bdf8;">
                ${props.adjusted_pm25} µg/m³ PM2.5
              </div>
            </div>
            <div style="font-size:11px; color:#cbd5e1; border-top:1px solid rgba(148,163,184,0.2); padding-top:6px; margin-top:6px;">
              <div><strong>Coords:</strong> [${coords[1].toFixed(3)}, ${coords[0].toFixed(3)}]</div>
              <div><strong>Coverage:</strong> ${props.coverage_tier}</div>
              <div style="color:#10b981; font-size:10px; margin-top:2px;">${props.source}</div>
            </div>
          </div>
        `;

        new maplibregl.Popup({ closeButton: false, offset: 12 })
          .setLngLat(coords)
          .setHTML(html)
          .addTo(map);
      });

      map.on('mouseenter', 'sensor-points', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'sensor-points', () => {
        map.getCanvas().style.cursor = 'crosshair';
      });
      map.on('mouseenter', 'cluster-circles', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'cluster-circles', () => {
        map.getCanvas().style.cursor = 'crosshair';
      });

      map.on('click', (e) => {
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ['sensor-points', 'cluster-circles']
        });
        if (hit.length > 0) return;

        if (onClickCallbackRef.current) {
          onClickCallbackRef.current([
            Number(e.lngLat.lng.toFixed(4)),
            Number(e.lngLat.lat.toFixed(4))
          ]);
        }
      });

      map.getCanvas().style.cursor = 'crosshair';
      setMapLoaded(true);
      emitBounds();
    });

    mapRef.current = map;

    return () => {
      if (moveTimeout) clearTimeout(moveTimeout);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fly to selected city or custom searched location
  useEffect(() => {
    if (!mapRef.current || !selectedCity) return;
    mapRef.current.flyTo({
      center: selectedCity.center,
      zoom: selectedCity.zoom,
      pitch: selectedCity.zoom > 5 ? 30 : 0,
      bearing: 0,
      duration: 1500,
      essential: true
    });
  }, [selectedCity]);

  // Snap to Maximum Native Dataset Resolution when user clicks [Snap Max Res]
  useEffect(() => {
    if (!mapRef.current || !snapTarget) return;
    mapRef.current.flyTo({
      center: snapTarget.center,
      zoom: snapTarget.zoom,
      pitch: 38,
      bearing: -10,
      duration: 1400,
      essential: true
    });
  }, [snapTarget]);

  // Update Filtered Sensor Nodes & Closest-Pair Resolution Vector
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    const collection = {
      type: 'FeatureCollection',
      features: filteredFeatures || []
    };
    map.getSource('sensors-clustered')?.setData(collection);
    map.getSource('sensors-raw')?.setData(collection);

    map.getSource('closest-pair')?.setData(
      closestPairLine
        ? { type: 'FeatureCollection', features: [closestPairLine] }
        : { type: 'FeatureCollection', features: [] }
    );
  }, [mapLoaded, filteredFeatures, closestPairLine]);

  // Update Routes, Dijkstra Nodes & Isolines
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    if (activeMode === 'route') {
      map.getSource('isoline')?.setData({ type: 'FeatureCollection', features: [] });
      map.getSource('fast-route')?.setData(
        fastRoute
          ? { type: 'FeatureCollection', features: [fastRoute] }
          : { type: 'FeatureCollection', features: [] }
      );
      map.getSource('clean-route')?.setData(
        cleanRoute
          ? { type: 'FeatureCollection', features: [cleanRoute] }
          : { type: 'FeatureCollection', features: [] }
      );
      map.getSource('dijkstra-nodes')?.setData(
        optimalNodesGeoJson || { type: 'FeatureCollection', features: [] }
      );

      const endpoints = [];
      if (originCoord) endpoints.push(turf.point(originCoord, { color: '#38BDF8' }));
      if (destCoord) endpoints.push(turf.point(destCoord, { color: '#10B981' }));
      map.getSource('route-endpoints')?.setData(turf.featureCollection(endpoints));
    } else {
      map.getSource('fast-route')?.setData({ type: 'FeatureCollection', features: [] });
      map.getSource('clean-route')?.setData({ type: 'FeatureCollection', features: [] });
      map.getSource('dijkstra-nodes')?.setData({ type: 'FeatureCollection', features: [] });
      map.getSource('isoline')?.setData(
        isolinePolygon
          ? { type: 'FeatureCollection', features: [isolinePolygon] }
          : { type: 'FeatureCollection', features: [] }
      );

      const centerPt = isolineCenter
        ? [turf.point(isolineCenter, { color: '#22D3EE' })]
        : [];
      map.getSource('route-endpoints')?.setData(turf.featureCollection(centerPt));
    }
  }, [
    mapLoaded,
    activeMode,
    fastRoute,
    cleanRoute,
    optimalNodesGeoJson,
    isolinePolygon,
    originCoord,
    destCoord,
    isolineCenter
  ]);

  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    const cleanEmphasis = alphaWeight <= 0.5;
    map.setPaintProperty('clean-route-line', 'line-width', cleanEmphasis ? 5.5 : 3);
    map.setPaintProperty('clean-route-line', 'line-opacity', cleanEmphasis ? 0.98 : 0.45);
    map.setPaintProperty('fast-route-line', 'line-width', cleanEmphasis ? 3.5 : 5.5);
    map.setPaintProperty('fast-route-line', 'line-opacity', cleanEmphasis ? 0.65 : 0.98);
  }, [mapLoaded, alphaWeight]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
}