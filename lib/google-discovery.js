const { createHash } = require('node:crypto');

const QUERIES = ['park', 'recreation area', 'picnic area', 'rest area'];
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,routingSummaries';
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

// Match protobuf seconds without coercion; use the baseline's 30-day operational bound.
function durationSeconds(value) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,9})?s$(?![\s\S])/.test(value)) return null;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 2592000 ? seconds : null;
}

function normalizeMetrics(summary, baselineMinutes) {
  const unavailable = { route: null, status: 'missing' };
  if (!Number.isFinite(baselineMinutes) || baselineMinutes <= 0 || baselineMinutes > 43200
    || !object(summary) || !Array.isArray(summary.legs) || summary.legs.length !== 2) return unavailable;
  const first = object(summary.legs[0]) ? durationSeconds(summary.legs[0].duration) : null;
  const second = object(summary.legs[1]) ? durationSeconds(summary.legs[1].duration) : null;
  if (first === null || second === null || first + second > 2592000) return unavailable;
  const tripMinutes = first / 60;
  const viaTripMinutes = (first + second) / 60;
  const detourMinutes = viaTripMinutes - baselineMinutes;
  if (detourMinutes < 0) return { route: null, status: 'inconsistent' };
  return { route: { tripMinutes, detourMinutes }, status: 'routed' };
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
async function discoverCandidates(encodedPolyline, { signal = AbortSignal.timeout(15000), baselineRouteDurationMinutes } = {}) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!optionalText(key) || !optionalText(encodedPolyline)) throw new DiscoveryError();
  const results = await Promise.allSettled(QUERIES.map(async textQuery => {
    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({ textQuery, pageSize: 20, routingParameters: { travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }, searchAlongRouteParameters: { polyline: { encodedPolyline } } }),
        signal
      });
      if (response.status === 429) throw new DiscoveryError('RATE_LIMITED');
      if (!response.ok) throw new DiscoveryError();
      const data = await response.json();
      if (!object(data) || data.error) throw new DiscoveryError();
      // An empty protobuf response is a successful search with no places.
      if (Object.keys(data).length === 0) return [];
      if (!Array.isArray(data.places)) throw new DiscoveryError();
      // Pair before any filtering or deduplication, including malformed places.
      return data.places.map((place, index) => ({ place, summary: Array.isArray(data.routingSummaries) ? data.routingSummaries[index] : undefined }));
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
    for (const { place, summary } of result.value) {
      receivedCount++;
      const candidate = normalizePlace(place);
      if (!candidate) { rejectedCount++; continue; }
      const metrics = normalizeMetrics(summary, baselineRouteDurationMinutes);
      candidate.route = metrics.route;
      const previous = byPlaceId.get(candidate.provenance.placeId);
      if (previous) {
        duplicateCount++;
        if (previous.candidate.route || !candidate.route) continue;
      }
      // Prefer usable metrics, otherwise first valid record in fixed query order wins.
      // Replacing a Map value preserves its original position.
      byPlaceId.set(candidate.provenance.placeId, { candidate, status: metrics.status });
    }
  }
  const entries = [...byPlaceId.values()];
  const candidates = entries.map(entry => entry.candidate);
  const routed = candidates.filter(candidate => candidate.route).map(candidate => candidate.route);
  const routing = {
    routedCount: routed.length,
    missingCount: entries.filter(entry => entry.status === 'missing').length,
    inconsistentCount: entries.filter(entry => entry.status === 'inconsistent').length,
    tripMin: routed.length ? Math.min(...routed.map(route => route.tripMinutes)) : null,
    tripMax: routed.length ? Math.max(...routed.map(route => route.tripMinutes)) : null,
    detourMin: routed.length ? Math.min(...routed.map(route => route.detourMinutes)) : null,
    detourMax: routed.length ? Math.max(...routed.map(route => route.detourMinutes)) : null
  };
  return { candidates, diagnostics: { candidateCount: candidates.length, receivedCount, rejectedCount, duplicateCount, routing } };
}

module.exports = { discoverCandidates, DiscoveryError };
