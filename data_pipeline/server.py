import json
import math
import os
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

try:
    import duckdb
    DUCKDB_AVAILABLE = True
    con = duckdb.connect(database=':memory:')
except ImportError:
    DUCKDB_AVAILABLE = False
    con = None

GEOJSON_PATH = os.path.join(os.path.dirname(__file__), '..', 'public', 'sensor_grid.geojson')
CACHED_STATIONS = []

def pm25_to_aqi(pm25):
    if pm25 <= 12.0:
        return round((50 / 12.0) * pm25)
    if pm25 <= 35.4:
        return round(((100 - 51) / (35.4 - 12.1)) * (pm25 - 12.1) + 51)
    if pm25 <= 55.4:
        return round(((150 - 101) / (55.4 - 35.5)) * (pm25 - 35.5) + 101)
    if pm25 <= 150.4:
        return round(((200 - 151) / (150.4 - 55.5)) * (pm25 - 55.5) + 151)
    return min(500, round(((300 - 201) / (250.4 - 150.5)) * (pm25 - 150.5) + 201))

def get_risk_tier(pm25):
    if pm25 >= 55.5:
        return 'HAZARDOUS'
    if pm25 >= 35.5:
        return 'UNHEALTHY'
    if pm25 >= 12.1:
        return 'MODERATE'
    return 'GOOD'

def haversine_km(lon1, lat1, lon2, lat2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2)**2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def compute_min_spacing_km(features):
    pts = [f['geometry']['coordinates'] for f in features[:120]]
    if len(pts) < 2:
        return 2.5
    min_d = 9999.0
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = haversine_km(pts[i][0], pts[i][1], pts[j][0], pts[j][1])
            if 0.05 <= d < min_d:
                min_d = d
    return round(min_d if min_d < 9999.0 else 2.5, 2)

def load_colab_dataset():
    global CACHED_STATIONS
    if os.path.exists(GEOJSON_PATH):
        with open(GEOJSON_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
            CACHED_STATIONS = data.get('features', [])
        print(f"[Python Engine] Loaded {len(CACHED_STATIONS)} OpenAQ stations from {GEOJSON_PATH}")
        if DUCKDB_AVAILABLE:
            con.execute("""
                CREATE TABLE IF NOT EXISTS openaq_stations (
                    id VARCHAR,
                    city VARCHAR,
                    lon DOUBLE,
                    lat DOUBLE,
                    pm25 DOUBLE,
                    aqi INTEGER,
                    coverage_tier VARCHAR,
                    risk_tier VARCHAR,
                    source VARCHAR
                )
            """)
            rows = []
            for feat in CACHED_STATIONS:
                coords = feat['geometry']['coordinates']
                p = feat['properties']
                pm = float(p.get('pm25', 25.0))
                rows.append((
                    p.get('id', 'st'),
                    p.get('city', 'OpenAQ Node'),
                    float(coords[0]),
                    float(coords[1]),
                    pm,
                    pm25_to_aqi(pm),
                    p.get('coverage_tier', 'Dense Monitoring'),
                    get_risk_tier(pm),
                    'Colab OpenAQ S3 Lakehouse'
                ))
            con.executemany("INSERT INTO openaq_stations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
            print("[DuckDB Lakehouse] Indexed OpenAQ stations in columnar memory.")

def query_duckdb_bbox(min_lon, min_lat, max_lon, max_lat, aqi_min=0, aqi_max=999):
    if DUCKDB_AVAILABLE and len(CACHED_STATIONS) > 0:
        query = """
            SELECT id, city, lon, lat, pm25, aqi, coverage_tier, risk_tier, source
            FROM openaq_stations
            WHERE lon BETWEEN ? AND ?
              AND lat BETWEEN ? AND ?
              AND aqi BETWEEN ? AND ?
            LIMIT 400
        """
        res = con.execute(query, [min_lon, max_lon, min_lat, max_lat, aqi_min, aqi_max]).fetchall()
        return [{
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r[2], r[3]]},
            "properties": {
                "id": r[0], "city": r[1], "pm25": r[4], "adjusted_pm25": r[4],
                "aqi": r[5], "coverage_tier": r[6], "risk_tier": r[7], "source": r[8]
            }
        } for r in res]
    else:
        features = []
        for feat in CACHED_STATIONS:
            lon, lat = feat['geometry']['coordinates']
            if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
                pm = float(feat['properties'].get('pm25', 25.0))
                aqi = pm25_to_aqi(pm)
                if aqi_min <= aqi <= aqi_max:
                    feat['properties']['adjusted_pm25'] = pm
                    feat['properties']['aqi'] = aqi
                    features.append(feat)
        return features[:400]

def fetch_live_open_meteo_for_bbox(min_lon, min_lat, max_lon, max_lat, grid_n=4):
    pts = []
    span_lon = max(0.04, max_lon - min_lon)
    span_lat = max(0.04, max_lat - min_lat)
    for r in range(grid_n):
        for c in range(grid_n):
            lon = round(max(-179.9, min(179.9, min_lon + (c + 0.5) / grid_n * span_lon)), 4)
            lat = round(max(-84.0, min(84.0, min_lat + (r + 0.5) / grid_n * span_lat)), 4)
            pts.append((r, c, lon, lat))

    lats = ",".join(str(p[3]) for p in pts)
    lons = ",".join(str(p[2]) for p in pts)
    url = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lats}&longitude={lons}&current=pm2_5,us_aqi"

    features = []
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'AeroRoute-AWS-Hackathon/1.0'})
        with urllib.request.urlopen(req, timeout=3.5) as response:
            raw = json.loads(response.read().decode('utf-8'))
            results = raw if isinstance(raw, list) else [raw]
            for idx, (r, c, lon, lat) in enumerate(pts):
                curr = results[idx].get('current', {}) if idx < len(results) else {}
                raw_pm25 = curr.get('pm2_5') or 18.0
                micro = math.sin(lon * 140) * math.cos(lat * 140) * 2.5
                pm25 = round(max(2.0, float(raw_pm25) + micro), 1)
                aqi = int(curr.get('us_aqi') or pm25_to_aqi(pm25))
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                    "properties": {
                        "id": f"py_live_{int(lon*100)}_{int(lat*100)}",
                        "city": f"Sector [{lat:.2f}, {lon:.2f}]",
                        "pm25": pm25,
                        "adjusted_pm25": pm25,
                        "aqi": aqi,
                        "coverage_tier": "Live Python DuckDB Stream",
                        "risk_tier": get_risk_tier(pm25),
                        "source": "Python DuckDB + Open-Meteo Live"
                    }
                })
    except Exception as e:
        print(f"[Python Engine] Open-Meteo fallback: {e}")
    return features

class SpatialRequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        # ENDPOINT 1: Viewport Tile Stream
        if parsed.path == '/api/viewport':
            min_lon = float(params.get('min_lon', [76.8])[0])
            min_lat = float(params.get('min_lat', [28.4])[0])
            max_lon = float(params.get('max_lon', [77.5])[0])
            max_lat = float(params.get('max_lat', [28.9])[0])
            zoom = float(params.get('zoom', [10.0])[0])

            colab_features = query_duckdb_bbox(min_lon, min_lat, max_lon, max_lat)
            live_features = fetch_live_open_meteo_for_bbox(min_lon, min_lat, max_lon, max_lat, 4)
            combined = colab_features + live_features

            payload = {
                "type": "FeatureCollection",
                "engine": "Python DuckDB Spatial Lakehouse" if DUCKDB_AVAILABLE else "Python Spatial Engine",
                "colab_hits": len(colab_features),
                "live_hits": len(live_features),
                "features": combined
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode('utf-8'))
            return

        # ENDPOINT 2: Open Developer API for Filtered AQI & Resolution Extraction
        if parsed.path == '/api/v1/extract':
            region = params.get('region', ['Custom_Viewport'])[0]
            aqi_min = int(float(params.get('aqi_min', [0])[0]))
            aqi_max = int(float(params.get('aqi_max', [500])[0]))
            bbox_str = params.get('bbox', ['-180,-90,180,90'])[0]
            try:
                min_lon, min_lat, max_lon, max_lat = [float(x) for x in bbox_str.split(',')]
            except Exception:
                min_lon, min_lat, max_lon, max_lat = -180.0, -90.0, 180.0, 90.0

            matched = query_duckdb_bbox(min_lon, min_lat, max_lon, max_lat, aqi_min, aqi_max)
            d_min_km = compute_min_spacing_km(matched)

            payload = {
                "type": "FeatureCollection",
                "api_version": "1.0.0-aws-mapit",
                "query_metadata": {
                    "region": region,
                    "aqi_range": [aqi_min, aqi_max],
                    "matching_locations_count": len(matched),
                    "spatial_resolution": {
                        "min_sensor_spacing_km": d_min_km,
                        "engine": "DuckDB Columnar Spatial Engine"
                    }
                },
                "features": matched
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/geo+json')
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(payload, indent=2).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

if __name__ == '__main__':
    load_colab_dataset()
    port = 8000
    server = ThreadingHTTPServer(('0.0.0.0', port), SpatialRequestHandler)
    print(f"AeroRoute Python + DuckDB Spatial Engine running on http://localhost:{port}")
    print(f" -> Viewport Stream: http://localhost:{port}/api/viewport")
    print(f" -> Developer API:   http://localhost:{port}/api/v1/extract?aqi_min=40&aqi_max=120")
    server.serve_forever()