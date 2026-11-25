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
  catch { return res.status(400).json({ suggestions: [] }); }
  if (typeof body?.input !== 'string' || body.input.trim().length < 3 || body.input.length > 200) return res.status(400).json({ suggestions: [] });
  const request = { input: body.input.trim(), languageCode: 'en' };
  const bias = body.bias;
  if (Number.isFinite(bias?.latitude) && Math.abs(bias.latitude) <= 90 && Number.isFinite(bias?.longitude) && Math.abs(bias.longitude) <= 180) {
    request.locationBias = { circle: { center: bias, radius: 50000 } };
  }
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    const suggestions = (data.suggestions || []).map(item => item.placePrediction)
      .filter(item => typeof item?.placeId === 'string' && typeof item?.text?.text === 'string')
      .slice(0, 5).map(item => ({ placeId: item.placeId, label: item.text.text }));
    return res.status(200).json({ suggestions });
  } catch { return res.status(502).json({ suggestions: [] }); }
};
