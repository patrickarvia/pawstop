const nativeOrigins = new Set(['capacitor://localhost', 'http://localhost']);
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (nativeOrigins.has(req.headers?.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(nativeOrigins.has(req.headers?.origin) ? 204 : 403).end();
  if (req.method !== 'POST') return res.status(405).end();
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ address: null }); }
  if (!Number.isFinite(body?.latitude) || Math.abs(body.latitude)>90 || !Number.isFinite(body?.longitude) || Math.abs(body.longitude)>180) return res.status(400).json({});
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${body.latitude},${body.longitude}`);
    url.searchParams.set('key', process.env.GOOGLE_MAPS_API_KEY || '');
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) throw new Error('Geocoding unavailable');
    const address = data.results?.[0]?.formatted_address;
    return res.status(200).json({ address: typeof address === 'string' ? address : null });
  } catch { return res.status(502).json({ address: null }); }
};
