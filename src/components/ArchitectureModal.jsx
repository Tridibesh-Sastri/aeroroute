import React from 'react';
import { X, Database, Cpu, Layers, CheckCircle2 } from 'lucide-react';

export default function ArchitectureModal({ isOpen, onClose, tileTelemetry }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl p-6 text-slate-200">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                AeroRoute System Architecture & AWS Lakehouse Pipeline
              </h2>
              <p className="text-xs text-slate-400">
                Registry of Open Data on AWS (OpenAQ) · DuckDB + Apache Iceberg · Amazon Location Service v2
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

        {/* LIVE TELEMETRY STATUS BAR */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-400" />
              Active Spatial Nodes
            </div>
            <div className="text-base font-bold text-white mt-1">
              {tileTelemetry.totalNodes} Stations Cached
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" />
              Viewport Tile Cache
            </div>
            <div className="text-base font-bold text-cyan-300 mt-1">
              {tileTelemetry.cachedTileCount} Visited BBOX Tiles
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
              Backend Engine
            </div>
            <div className="text-xs font-bold text-emerald-400 mt-1 truncate">
              {tileTelemetry.engineStatus}
            </div>
          </div>
        </div>

        {/* PIPELINE DIAGRAM */}
        <div className="space-y-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] leading-relaxed text-slate-300 overflow-x-auto">
            {`[AWS Registry: s3://openaq-data-archive/] + [Open-Meteo CAMS Real-Time API]
        │
        ▼ (Google Colab Notebook & Local Python server.py via DuckDB httpfs)
[In-Memory DuckDB Spatial Table & Apache Iceberg S3 Schema]
        │
        ▼ (Viewport BBOX Query on Map Pan/Zoom -> spatialTileStore.js LRU Cache)
[Dynamic MapLibre Clustering (Low Zoom) + IDW & Dijkstra Minimum-AQI Street Router (High Zoom)]`}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-1.5">
              1. Apache Iceberg Table DDL on Amazon S3 (Athena Lakehouse Layer)
            </h3>
            <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-emerald-300 overflow-x-auto">
{`CREATE TABLE aeroroute_db.openaq_sensor_grid_iceberg (
    id STRING,
    city STRING,
    lon DOUBLE,
    lat DOUBLE,
    pm25 DOUBLE,
    aqi INT,
    coverage_tier STRING,
    risk_tier STRING
)
PARTITIONED BY (risk_tier)
LOCATION 's3://aeroroute-mapit-lakehouse-2026/iceberg/openaq_grid/'
TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'PARQUET');`}
            </pre>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-1.5">
              2. Mathematical Formulation: IDW Exposure & Dijkstra Path Cost
            </h3>
            <p className="text-slate-400 leading-relaxed">
              Every candidate road geometry returned by Amazon Location Service / OSRM is discretized into 20 segments. At each checkpoint, Inverse Distance Weighting (IDW) interpolates the exact PM2.5 concentration from the nearest cached OpenAQ stations, minimizing cumulative route AQI load:
            </p>
            <div className="mt-2 p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-cyan-300">
              Cost(Edge u→v) = Distance(u,v) × [ α + (1 - α) × (AQI_uv / 30)^2.4 ]
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}