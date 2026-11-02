# AeroRoute Live — Spatial Air Quality Lakehouse & Minimum-AQI Street Router

[![Hackathon](https://img.shields.io/badge/AWS_Builder_Center-Weekend_Challenge:_Map_It-FF9900?style=flat-square&logo=amazon-aws)](https://builder.aws.com)
[![Data Source](https://img.shields.io/badge/AWS_Open_Data-OpenAQ_S3_Archive-10B981?style=flat-square)](https://registry.opendata.aws/openaq/)
[![Engine](https://img.shields.io/badge/Spatial_Engine-DuckDB_%2B_Turf.js-06B6D4?style=flat-square)](https://duckdb.org/)
[![Frontend](https://img.shields.io/badge/WebGL-React_19_%2B_MapLibre_GL-38BDF8?style=flat-square)](https://maplibre.org/)

> **Standard navigation apps optimize strictly for travel time—even if the fastest road routes you straight through an active particulate plume. AeroRoute Live optimizes for your lungs.**

**AeroRoute Live** is a full-stack geospatial exploration platform, regional air-quality spectrum analyzer, and health-optimal street routing engine. Built for the *AWS Builder Center Weekend Challenge: Map it*, it combines baseline atmospheric records from the **Registry of Open Data on AWS (`s3://openaq-data-archive/`)** with real-time global telemetry, **DuckDB** spatial queries, **Apache Iceberg** lakehouse schemas, and **Amazon Location Service v2** compatible APIs.

---

## Table of Contents
1. [What We Built & Why It Matters](#1-what-we-built--why-it-matters)
2. [System Architecture & Data Flow](#2-system-architecture--data-flow)
3. [Core Mathematical & Spatial Algorithms](#3-core-mathematical--spatial-algorithms)
4. [Platform Functionalities & Interactive Features](#4-platform-functionalities--interactive-features)
5. [Engineering Evolution: How We Solved Real Bottlenecks](#5-engineering-evolution-how-we-solved-real-bottlenecks)
6. [Tech Stack, Packages & Cloud Services](#6-tech-stack-packages--cloud-services)
7. [Project Structure (Code-Split Architecture)](#7-project-structure-code-split-architecture)
8. [Open Developer REST API (`/api/v1/extract`)](#8-open-developer-rest-api-apiv1extract)
9. [Local Setup & Execution Guide](#9-local-setup--execution-guide)

---

## 1. What We Built & Why It Matters

Environmental air quality datasets are typically locked inside massive, unindexed CSV or Parquet archives on cloud object storage, while consumer mapping applications treat roads as simple time-distance graphs. AeroRoute bridges these two worlds:

1. **Planetary-to-Street Exploration:** Zoom out on a 3D WebGL globe to inspect regional air quality clusters (dynamically aggregated on the GPU), or zoom into any city on Earth to inspect individual street-level monitoring nodes.
2. **Location-Calibrated Iso-AQI Slicing:** Search any town, city, or country to automatically calibrate an interactive **AQI Spectrum Slider** (`[min_AQI, max_AQI]`). Scrubbing the slider slices the region by specific pollution bands (`Target AQI ± Δ`) or clean-air ceilings (`≤ Target AQI`).
3. **Dataset Spatial Resolution Telemetry ($d_{\text{min}} \rightarrow Z_{\text{native}}$):** Automatically measures the physical nearest-neighbor spacing ($d_{\text{min}}$ in km) between consistent monitoring stations in the viewport and calculates the **Maximum Native Zoom Ceiling** before sub-grid interpolation begins.
4. **Minimum-AQI Street Routing:** Computes both the **Direct Fast Route** and the **Safest Air Quality Route** along real street geometry, minimizing cumulative inhaled $\text{PM}_{2.5}$ and total route AQI payload ($\sum \text{AQI}$).
5. **Sensor Desert Blindspot Detection:** Explicitly flags rural and industrial corridors where monitoring density falls below safe public-health thresholds (`<3 stations` within a 15-minute reachability isochrone).
6. **Open Data-as-a-Service API:** Exposes a live REST API endpoint (`/api/v1/extract`) so external developers and researchers can query and download slider-filtered GeoJSON slices alongside spatial resolution metadata.

---

## 2. System Architecture & Data Flow

```
==========================================================================================
LAYER 1: CLOUD DATA LAKEHOUSE & HYBRID INGESTION
==========================================================================================
[Registry of Open Data on AWS]              [Open-Meteo CAMS / OpenAQ Live API]
 s3://openaq-data-archive/ (Anonymous S3)    Real-time PM2.5, PM10, NO2, US AQI
              │                                             │
              ▼ (Google Colab Notebook + DuckDB httpfs)     │
   [public/sensor_grid.geojson]                             │
   (Multi-region baseline + Sensor Desert tags)             │
              │                                             │
              └──────────────────────┬──────────────────────┘
                                     ▼
            [Local Python + DuckDB Microservice (data_pipeline/server.py)]
            • Indexes stations in an in-memory DuckDB columnar table
            • Serves bounding-box spatial queries: GET /api/viewport
            • Serves developer extraction API:     GET /api/v1/extract

==========================================================================================
LAYER 2: CLIENT-SIDE SPATIAL MEMORY & FRUSTUM CULLING (src/services/spatialTileStore.js)
==========================================================================================
[Map Pan / Zoom Event: moveend -> [west, south, east, north, zoom]]
              │
              ▼
   [Quantized Tile Key Generator (zoomBucket_tileX_tileY)]
     ├── Tile in LRU Cache? ──> O(1) Memory Hit (0ms latency, 0 network calls)
     └── New Tile? ───────────> Queries DuckDB Server (:8000) or Browser Stream Fallback
              │
              ▼
   [O(1) LRU Eviction (Max 30 Tiles) + Viewport/Corridor Frustum Culling]
   • Passes ONLY visible viewport + active route corridor nodes (~200-500 pts) to WebGL

==========================================================================================
LAYER 3: GEOSPATIAL MATH & ROUTING ENGINE (src/services/)
==========================================================================================
   ┌─────────────────────────────────┬──────────────────────────────────┐
   │  spatialEngine.js               │  resolutionEngine.js             │
   │  • 20-Point IDW Line Integral   │  • Regional [minAqi, maxAqi]     │
   │  • Dijkstra Min-AQI Graph       │  • Nearest-Neighbor d_min (km)   │
   │  • 15-Min Isoline Spatial Join  │  • Nyquist Max Zoom (Z_native)   │
   └─────────────────┬───────────────┴──────────────────┬───────────────┘
                     ▼                                  ▼
   [awsLocation.js: Amazon Location Service v2 + OSRM Road-Snapped Street Router]

==========================================================================================
LAYER 4: WEBGL VISUALIZATION & HUD (src/components/)
==========================================================================================
   [MapCanvas.jsx]     [ControlPanel.jsx + AqiSpectrumFilter.jsx]   [ApiEndpointModal.jsx]
```

---

## 3. Core Mathematical & Spatial Algorithms

Every metric displayed in the AeroRoute interface is backed by deterministic spatial mathematics implemented in `src/services/spatialEngine.js` and `src/services/resolutionEngine.js`.

### 3.1. Inverse Distance Weighting (IDW) Exposure Line Integral
Rather than averaging an entire city's pollution, AeroRoute discretizes every candidate street route $R$ of length $L$ into $M = 20$ equidistant checkpoints $\mathbf{p}_0, \mathbf{p}_1, \dots, \mathbf{p}_M$. At each checkpoint $\mathbf{p}_k$, the local $\text{PM}_{2.5}$ concentration $\hat{C}(\mathbf{p}_k)$ is interpolated from surrounding monitoring stations $\{\mathbf{x}_1, \dots, \mathbf{x}_N\}$ using power-law IDW ($p = 2.2$):

$$\hat{C}(\mathbf{p}_k) = \frac{\sum_{i=1}^{N} w_i(\mathbf{p}_k) \cdot C(\mathbf{x}_i)}{\sum_{i=1}^{N} w_i(\mathbf{p}_k)}, \quad \text{where} \quad w_i(\mathbf{p}_k) = \frac{1}{\max\left(0.15, \; d_{\text{Haversine}}(\mathbf{p}_k, \mathbf{x}_i)\right)^{2.2}}$$

From these checkpoints, we compute the **Cumulative Route AQI Payload** ($\Sigma_{\text{AQI}}$) and estimated **Inhaled Particulate Dose** ($D_{\mu\text{g}}$, assuming a commuter minute ventilation rate $V_E = 0.015\text{ m}^3/\text{min}$):

$$\Sigma_{\text{AQI}}(R) = \sum_{k=0}^{M} \text{AQI}\!\left(\hat{C}(\mathbf{p}_k)\right), \quad D_{\mu\text{g}}(R) = \bar{C}(R) \cdot T_{\text{min}}(R) \cdot 0.015$$

---

### 3.2. Dijkstra Minimum-AQI Corridor Pathfinding
To discover low-pollution detours between Origin $\mathbf{A}$ and Destination $\mathbf{B}$:
1. We construct a directed spatial graph $G = (V, E)$ over all active sensor nodes within the bounding ellipse of segment $\overline{\mathbf{AB}}$, enforcing a forward-progress constraint ($d(v, \mathbf{B}) \le 1.12 \cdot d(u, \mathbf{B})$) to prevent backtracking loops.
2. Each directed edge $(u \to v)$ is assigned a non-linear composite cost controlled by the user's **$\alpha$ Trade-Off Slider** ($\alpha \in [0, 1]$, where $\alpha = 0$ prioritizes cleanest air and $\alpha = 1$ prioritizes shortest distance):

$$\text{Cost}(u \to v) = d(u, v) \cdot \left[ 1.5\alpha + (1 - \alpha) \cdot \left( \frac{\text{AQI}_u + \text{AQI}_v}{60} \right)^{2.4} \right]$$

3. Dijkstra's algorithm extracts the optimal low-AQI pivot waypoints $\mathbf{W}^* = \{\mathbf{w}_1, \mathbf{w}_2\}$.
4. Both the raw endpoints and pivot waypoints are snapped to the nearest valid road segment (`/nearest/v1/driving/`) and routed through the street network (`Amazon Location Service CalculateRoutes` / `OSRM Street Engine`). All candidate road geometries are scored via the IDW line integral, and the trajectory minimizing composite exposure is rendered in glowing emerald green.

---

### 3.3. Spatial Nyquist Resolution & Maximum Native Zoom Ceiling ($d_{\text{min}} \rightarrow Z_{\text{native}}$)
Every spatial dataset has a physical resolution limit determined by how closely its sensors are spaced. For all stations in the active viewport, `resolutionEngine.js` computes the minimum consistent nearest-neighbor distance $d_{\text{min}}$ (in kilometers):

$$d_{\text{min}} = \min_{i} \min_{j \neq i, \, d_{ij} \ge 0.05\text{ km}} d_{\text{Haversine}}(\mathbf{x}_i, \mathbf{x}_j)$$

Using the region's latitude $\phi$ and Web Mercator circumference ($40,075\text{ km}$), we derive the **Maximum Native Zoom Ceiling ($Z_{\text{native}}$)**—the exact zoom level where the closest sensor pair is separated by $\sim 80$ screen pixels:

$$Z_{\text{native}} = \text{clamp}\!\left(\log_2\!\left(\frac{40075 \cdot \cos(\phi)}{d_{\text{min}} \cdot 6.5}\right), \; 6.5, \; 15.5\right)$$

* When $\text{Zoom} \le Z_{\text{native}}$, the HUD badges the view as **`Native Ground-Truth Grid`**.
* When $\text{Zoom} > Z_{\text{native}}$, the HUD warns the user they have zoomed past physical station spacing into **`Sub-Grid IDW Interpolation`** and renders a cyan dashed measurement vector connecting the closest sensor pair.

---

## 4. Platform Functionalities & Interactive Features

| Feature Module | How It Works in the Live App |
| :--- | :--- |
| **3D Globe & Dynamic Superclustering** | At low zoom (`zoom < 8`), MapLibre's native WebGL clustering aggregates stations into regional circles colored by true mean $\text{PM}_{2.5}$ (`sum_pm25 / point_count`). Clicking any cluster smoothly zooms in and splits it into sub-clusters and individual stations. |
| **Town / City / Country Spectrum Calibration** | Typing any location into the top-left spectrum search flies to that region, queries the viewport tile store, and recalibrates the AQI slider's minimum and maximum bounds to match that area's exact pollution distribution. |
| **Continuous Iso-AQI Slider (`ALL` / `BAND` / `CEILING`)** | Scrubbing the slider filters the map in real time: **Specific AQI (`±Δ`)** isolates narrow iso-AQI contours (e.g., `70–90 AQI`), while **Cleanest (`≤ AQI`)** reveals only low-pollution pockets below your threshold. |
| **`Snap Max Res` Camera Controller** | One click flies the camera directly to the midpoint of the closest sensor pair at exact zoom level $Z_{\text{native}}$, displaying the physical `Min Spacing: X.XX km` vector on the map. |
| **Interactive Street Routing (`A` & `B` Picker)** | Click anywhere on the map (or use the Origin/Destination autocomplete search bars) to set endpoints. The app snaps off-road clicks to the nearest street and compares **Safest AQI Route** vs. **Direct Fast Route** side by side. |
| **15-Minute Reachability Isoline Auditor** | Switch to **15-Min Isoline Audit** mode and toggle between **Pedestrian** and **Car**. Clicking any coordinate generates a travel-time polygon, counts active sensors inside, and triggers a crimson alert if the area is a **Sensor Desert** (`<3 stations`). |
| **Iceberg Temporal Partition Switcher** | Toggle between **LIVE Real-Time (`×1.0`)**, **09:00 Rush Peak (`×1.25`)**, and **22:00 Winter Inversion (`×1.45`)** to simulate how diurnal atmospheric boundary layers shift route safety. |

---

## 5. Engineering Evolution: How We Solved Real Bottlenecks

Building AeroRoute involved solving four major engineering challenges during development:

1. **From Cloud S3 Archives to Zero-Cost Local & Colab Queries:**
   Querying raw gigabyte-scale S3 buckets directly from a browser is slow and expensive. We built a **Google Colab notebook (`openaq_iceberg_pipeline.ipynb`)** using **DuckDB's `httpfs` extension** to pull anonymous records from `s3://openaq-data-archive/`, designed an **Apache Iceberg** partitioned table schema for Amazon Athena, and exported a fast baseline `sensor_grid.geojson`.
2. **Eliminating `400 Bad Request` Routing Failures on Coastal/Rural Clicks:**
   When testing dynamic click-to-route near coastlines (such as the Bay of Bengal) or rural fields, OSRM returned `400 Bad Request` errors because coordinates fell outside driveable road geometry[cite: 5]. Furthermore, passing `alternatives=true` with multiple intermediate waypoints caused parameter rejections. We solved both by pre-snapping every coordinate via `/nearest/v1/driving/` and separating direct road alternatives from waypoint-guided Dijkstra requests.
3. **Solving the 12,800-Node WebGL Freeze via $O(1)$ LRU Caching & Frustum Culling:**
   When panning across dozens of regions globally, our initial cache accumulated over **12,800 nodes**. Because `sensorData` was in the routing `useEffect` dependency array, every map pan triggered $O(N^2)$ Dijkstra runs, 3 HTTP routing calls, and full WebGL cluster rebuilds.
   * **The Fix:** We decoupled camera panning from route calculation and built `spatialTileStore.js` with an **$O(1)$ LRU Tile Cache (capped at 30 tiles)** plus **Spatial Frustum Culling**. MapLibre now only receives stations inside the active screen viewport $\cup$ active route corridor (`~200–500 nodes`), locking pan/zoom performance at **60 FPS**.
4. **Refactoring a Monolith into a Code-Split Architecture:**
   As features grew, we split the codebase into dedicated single-responsibility services (`spatialTileStore.js`, `spatialEngine.js`, `resolutionEngine.js`, `awsLocation.js`) and modular UI components (`MapCanvas.jsx`, `ControlPanel.jsx`, `AqiSpectrumFilter.jsx`, `ApiEndpointModal.jsx`, `ArchitectureModal.jsx`)[cite: 2].

---

## 6. Tech Stack, Packages & Cloud Services

### AWS & Geospatial Data Services
* **Registry of Open Data on AWS (`s3://openaq-data-archive/`):** Primary open dataset providing ground-truth air quality monitoring station coordinates and $\text{PM}_{2.5}$ readings.
* **Amazon Location Service v2 Compatible Connector (`src/services/awsLocation.js`):** Configured for AWS Location v2 Vector Map Styles (`Monochrome Dark`), `CalculateRoutes`, `CalculateIsolines`, and `SearchText`, with automatic zero-key fallback to Carto Dark Matter GL vector tiles, OSRM street routing, and OpenStreetMap Nominatim geocoding.
* **Apache Iceberg & DuckDB Lakehouse:** Columnar SQL aggregation and spatial bounding-box indexing in `data_pipeline/server.py` and `openaq_iceberg_pipeline.ipynb`.
* **Open-Meteo Global Air Quality API:** Real-time CAMS + OpenAQ atmospheric fusion stream for live viewport tile hydration.

### Frontend & Runtime Packages
* **`react` (`^19.0.0`) & `vite` (`^6.0.0`):** Fast ESM frontend bundle and reactive state orchestration[cite: 2].
* **`maplibre-gl` (`^5.x` / `^6.x`):** WebGL 3D globe projection, GPU-accelerated Supercluster aggregation, and custom symbol/line layers (configured with explicit Vite Web Worker registration `?worker&url`)[cite: 1, 3].
* **`@turf/turf` (`^7.x`):** Client-side geospatial geometry math (`distance`, `along`, `length`, `bbox`, `midpoint`, `nearestPoint`, `pointsWithinPolygon`, `bezierSpline`)[cite: 2].
* **`tailwindcss` (`v4` via `@tailwindcss/vite`) & `lucide-react`:** Dark glassmorphic HUD styling and iconography[cite: 2].

---

## 7. Project Structure (Code-Split Architecture)

```text
aeroroute/
├── api/
│   └── extract.js                          # Serverless Open Developer REST API (Vercel production endpoint)
├── data_pipeline/
│   ├── openaq_iceberg_pipeline.ipynb       # Google Colab notebook (S3 OpenAQ extraction + Iceberg DDL)
│   └── server.py                           # Local Python + DuckDB spatial microservice (:8000)
├── public/
│   └── sensor_grid.geojson                 # Baseline multi-region OpenAQ spatial grid & Sensor Deserts
├── src/
│   ├── components/
│   │   ├── MapCanvas.jsx                   # MapLibre GL 3D globe, dynamic clusters, routes & d_min vector
│   │   ├── ControlPanel.jsx                # Left HUD sidebar orchestrating routing, isolines & telemetry
│   │   ├── AqiSpectrumFilter.jsx           # Location search, min-to-max AQI slider & resolution controller
│   │   ├── ApiEndpointModal.jsx            # Live REST API playground (GeoJSON, cURL, JS fetch, Python)
│   │   └── ArchitectureModal.jsx           # In-app AWS S3 + Iceberg SQL & mathematical formula inspector
│   ├── services/
│   │   ├── spatialTileStore.js             # O(1) LRU viewport tile cache (max 30 tiles) & frustum culling
│   │   ├── spatialEngine.js                # IDW line-integral sampler, Dijkstra graph & isoline auditor
│   │   ├── resolutionEngine.js             # Regional [minAqi, maxAqi], d_min spacing & Z_native calculator
│   │   └── awsLocation.js                  # AWS Location Service v2 connector + road-snapped OSRM router
│   ├── App.jsx                             # Top-level state orchestrator
│   ├── index.css                           # Tailwind v4 theme + custom dark MapLibre popup & scrollbar styles
│   └── main.jsx                            # React DOM entry point
├── package.json
├── vite.config.js
└── README.md
```

---

## 8. Open Developer REST API (`/api/v1/extract`)

AeroRoute exposes its filtered spatial data and resolution metrics to external developers so others can build on top of our pipeline.

### Endpoint
```http
GET /api/v1/extract?region=Delhi_NCR&aqi_min=45&aqi_max=115&max_res_km=1.42&native_zoom=12.1&bbox=76.80,28.40,77.50,28.90&format=geojson
```

### Example `cURL` Request
```bash
curl -X GET "http://localhost:8000/api/v1/extract?region=Delhi_NCR&aqi_min=45&aqi_max=115&bbox=76.8,28.4,77.5,28.9" \
  -H "Accept: application/geo+json"
```

### Example Response Structure
```json
{
  "type": "FeatureCollection",
  "api_version": "1.0.0-aws-mapit",
  "query_metadata": {
    "region": "Delhi_NCR",
    "aqi_range": [45, 115],
    "matching_locations_count": 42,
    "spatial_resolution": {
      "min_sensor_spacing_km": 1.42,
      "mean_sensor_spacing_km": 2.85,
      "max_native_zoom_level": 12.1,
      "nyquist_status": "Native Ground-Truth Grid (Min Spacing: 1.42 km)"
    }
  },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [77.209, 28.6139] },
      "properties": {
        "id": "station_14",
        "city": "Delhi NCR",
        "aqi": 92,
        "pm25_ug_m3": 31.8,
        "risk_tier": "MODERATE",
        "coverage_tier": "Dense Monitoring"
      }
    }
  ]
}
```

---

## 9. Local Setup & Execution Guide

### Prerequisites
* **Node.js** `v18+` (`v20+` recommended)
* **Python** `v3.9+` (optional, for running the local DuckDB spatial microservice)

### 1. Clone & Start the Frontend
```bash
git clone [https://github.com/Tridibesh-Sastri/aeroroute.git](https://github.com/Tridibesh-Sastri/aeroroute.git)
cd aeroroute

# Install dependencies
npm install

# Start Vite development server at http://localhost:5173
npm run dev
```

### 2. Start the Local Python + DuckDB Spatial Engine (Optional)
The frontend works out-of-the-box in standalone mode, but starting `server.py` activates in-memory **DuckDB SQL** bounding-box queries over your Colab OpenAQ dataset:

```bash
pip install duckdb
python data_pipeline/server.py
```
Once running on `http://localhost:8000`, the top-left badge in the web app automatically switches to **`DuckDB Lakehouse + Open API`**.

### 3. Optional AWS Location Service v2 Configuration
To use your own live AWS Location Service API key for base map styles and routing, create a `.env` file in the root directory:

```env
VITE_AWS_REGION=us-east-1
VITE_AWS_LOCATION_API_KEY=v1.public.your_aws_location_api_key_here
```

---

## License & Attribution
* **Air Quality Data:** Sourced from the [OpenAQ Archive on the Registry of Open Data on AWS](https://registry.opendata.aws/openaq/) and [Open-Meteo Air Quality API](https://open-meteo.com/).
* **Built by:** Tridibesh Sastri for the *AWS Builder Center Weekend Challenge: Map it (2026)*.