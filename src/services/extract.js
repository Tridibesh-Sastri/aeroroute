// api/extract.js - Serverless Open Developer API Endpoint
export default function handler(req, res) {
  const {
    region = 'Global_Viewport',
    aqi_min = '0',
    aqi_max = '300',
    max_res_km = '1.8',
    native_zoom = '12.0'
  } = req.query || {};

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/geo+json');

  res.status(200).json({
    type: 'FeatureCollection',
    api_version: '1.0.0-aws-mapit',
    query_metadata: {
      region,
      aqi_range: [Number(aqi_min), Number(aqi_max)],
      spatial_resolution: {
        min_sensor_spacing_km: Number(max_res_km),
        max_native_zoom_level: Number(native_zoom),
        source: 'Registry of Open Data on AWS (OpenAQ Lakehouse)'
      }
    },
    note: 'Use the in-app Open API Drawer or local DuckDB server (:8000/api/v1/extract) for full coordinate stream.'
  });
}