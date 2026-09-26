const { createHash } = require('node:crypto');

const QUERIES = ['park', 'recreation area', 'picnic area', 'rest area'];
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types';
// Adapter-owned mapping into Pawstop categories; unrecognized categories stay unknown.
const CATEGORIES = new Map([
  ['park', 'park'], ['national_park', 'park'], ['state_park', 'park'],
  ['recreation_center', 'recreation-area'], ['picnic_ground', 'picnic-area'],
  ['rest_stop', 'rest-area'], ['dog_park', 'dedicated-dog-area']
]);
const ATTRIBUTES = ['largeGrass', 'dogTraffic', 'restrooms', 'dogsAllowed', 'fenced', 'lighting', 'parking', 'dedicatedDogArea'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = value => typeof value === 'string' && value.trim() ? value.trim() : null;

class DiscoveryError extends Error {
  constructor(code = 'PROVIDER_ERROR') {
    super(code);
    this.code = code;
  }
}

function normalizePlace(place) {
  if (!object(place)) return null;
  const placeId = optionalText(place.id);
  const name = optionalText(place.displayName?.text);
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (!placeId || !/^[A-Za-z0-9_-]+$/.test(placeId) || !name
    || !Number.isFinite(lat) || lat < -90 || lat > 90
    || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  const types = Array.isArray(place.types)
    ? [...new Set(place.types.map(type => CATEGORIES.get(type)).filter(Boolean))] : [];
  return {
    id: `place-${createHash('sha256').update(`google:${placeId}`).digest('hex')}`,
    name,
    address: optionalText(place.formattedAddress),
    lat,
    lng,
    primaryType: CATEGORIES.get(place.primaryType) || null,
    types: types.length ? types : null,
    // Structural categories are not evidence of amenities or dog suitability.
    attributes: Object.fromEntries(ATTRIBUTES.map(attribute => [attribute, { value: null, confidence: 'unknown' }])),
    provenance: { provider: 'google', placeId }
  };
}

// Internal return value is test-visible, never serialized by /api/plan-route.
// One page per concept (at most 80 raw results); coverage is intentionally not exhaustive.
async function discoverCandidates(encodedPolyline, { signal = AbortSignal.timeout(15000) } = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!optionalText(key) || !optionalText(encodedPolyline)) throw new DiscoveryError();
  const results = await Promise.allSettled(QUERIES.map(async textQuery => {
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ textQuery, pageSize: 20, searchAlongRouteParameters: { polyline: { encodedPolyline } } }),
        signal
      });
      if (response.status === 429) throw new DiscoveryError('RATE_LIMITED');
      if (!response.ok) throw new DiscoveryError();
      const data = await response.json();
      if (!object(data) || data.error) throw new DiscoveryError();
      // An empty protobuf response is a successful search with no places.
      if (Object.keys(data).length === 0) return [];
      if (!Array.isArray(data.places)) throw new DiscoveryError();
      return data.places;
    } catch (error) {
      throw error instanceof DiscoveryError ? error : new DiscoveryError();
    }
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    // Do not treat a failed search as empty or return a silently partial pool.
    throw new DiscoveryError(failures.some(result => result.reason.code === 'RATE_LIMITED') ? 'RATE_LIMITED' : 'PROVIDER_ERROR');
  }
  const byPlaceId = new Map();
  let receivedCount = 0, rejectedCount = 0, duplicateCount = 0;
  for (const result of results) {
    for (const place of result.value) {
      receivedCount++;
      const candidate = normalizePlace(place);
      if (!candidate) { rejectedCount++; continue; }
      if (byPlaceId.has(candidate.provenance.placeId)) { duplicateCount++; continue; }
      // First valid record wins in fixed query order, independent of response timing.
      byPlaceId.set(candidate.provenance.placeId, candidate);
    }
  }
  const candidates = [...byPlaceId.values()];
  return { candidates, diagnostics: { candidateCount: candidates.length, receivedCount, rejectedCount, duplicateCount } };
}

module.exports = { discoverCandidates, DiscoveryError };
