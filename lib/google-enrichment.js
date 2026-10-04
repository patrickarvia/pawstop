const { inferFromReviewConsensus } = require('./review-evidence');
const FIELD_MASK = 'id,allowsDogs,restroom,parkingOptions,googleMapsUri,reviews,websiteUri';
const ENRICH_CONCURRENCY = 5;
const PARKING_OPTIONS = ['freeParkingLot', 'paidParkingLot', 'freeStreetParking', 'paidStreetParking', 'valetParking', 'freeGarageParking', 'paidGarageParking'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const confirmed = (value, evidence) => ({ value, confidence: 'confirmed', evidence });

class EnrichmentError extends Error {
  constructor(code = 'PROVIDER_ERROR') { super(code); this.code = code; }
}

function mapsUrl(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const mapsHost = url.hostname === 'maps.google.com';
    const mapsPath = ['www.google.com', 'google.com'].includes(url.hostname) && /^\/maps(?:\/|$)/.test(url.pathname);
    const shortLink = url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1;
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (mapsHost || mapsPath || shortLink) ? value : null;
  } catch { return null; }
}

function websiteUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https:\/\/[^/]/i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? value : null;
  } catch { return null; }
}

function normalizeDetails(candidate, data) {
  const attributes = { ...candidate.attributes };
  // Existing normalized category evidence is usable even when optional details are unavailable.
  if (candidate.primaryType === 'dedicated-dog-area' || candidate.types?.includes('dedicated-dog-area')) {
    attributes.dedicatedDogArea = confirmed(true, 'Google Places categorizes this location as a dedicated dog area.');
  }
  let navigation = candidate.navigation;
  let verification = candidate.verification;
  const reviewAttributes = [];
  let enriched = false;
  // Require the requested identity to match before accepting any optional details.
  if (object(data) && !data.error && data.id === candidate.provenance.placeId) {
    if (typeof data.allowsDogs === 'boolean') {
      attributes.dogsAllowed = confirmed(data.allowsDogs, data.allowsDogs
        ? 'Google Places reports that dogs are allowed.' : 'Google Places reports that dogs are not allowed.');
      enriched ||= candidate.attributes.dogsAllowed.confidence === 'unknown';
    }
    if (typeof data.restroom === 'boolean') {
      attributes.restrooms = confirmed(data.restroom, data.restroom
        ? 'Google Places reports restrooms at this location.' : 'Google Places reports no restrooms at this location.');
      enriched ||= candidate.attributes.restrooms.confidence === 'unknown';
    }
    if (object(data.parkingOptions) && PARKING_OPTIONS.some(option => data.parkingOptions[option] === true)) {
      attributes.parking = confirmed(true, 'Google Places reports parking at this location.');
      enriched ||= candidate.attributes.parking.confidence === 'unknown';
    }
    const inferred = inferFromReviewConsensus(data.reviews);
    for (const [key, attribute] of Object.entries(inferred)) {
      if (attributes[key]?.confidence === 'confirmed') continue;
      attributes[key] = attribute;
      if (attribute.confidence === 'inferred') { reviewAttributes.push(key); enriched = true; }
    }
    const website = websiteUrl(data.websiteUri);
    if (website) { verification = { placeWebsiteUrl: website }; enriched = true; }
    const url = mapsUrl(data.googleMapsUri);
    if (url) {
      enriched ||= !mapsUrl(candidate.navigation?.googleMapsUrl);
      navigation = { googleMapsUrl: url };
    }
  }
  return {
    candidate: { ...candidate, attributes, ...(navigation ? { navigation } : {}), ...(verification ? { verification } : {}) },
    status: enriched ? 'enriched' : 'unchanged', ...(reviewAttributes.length ? { reviewAttributes } : {})
  };
}

// Supplemental evidence; no raw response or exception text leaves this adapter.
// The caller supplies the original request signal, never a fresh timeout budget.
async function enrichCandidates(candidates, { signal } = {}) {
  if (!candidates.length) return { results: [], requested: 0 };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (typeof key !== 'string' || !key.trim() || !signal) throw new EnrichmentError();
  const results = new Array(candidates.length);
  let next = 0, requested = 0, failure;
  async function worker() {
    while (!failure && next < candidates.length) {
      if (signal.aborted) { failure = new EnrichmentError(); return; }
      const index = next++;
      const candidate = candidates[index];
      try {
        const placeId = candidate.provenance?.placeId;
        if (typeof placeId !== 'string' || !placeId.trim()) {
          results[index] = normalizeDetails(candidate, null);
          continue;
        }
        requested++;
        const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
          method: 'GET', headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELD_MASK }, signal
        });
        if (response.status === 429) throw new EnrichmentError('RATE_LIMITED');
        if (response.status === 404 || response.status === 410) {
          results[index] = normalizeDetails(candidate, null);
          continue;
        }
        if (!response.ok) throw new EnrichmentError();
        let data;
        try { data = await response.json(); }
        catch { if (signal.aborted) throw new EnrichmentError(); }
        results[index] = normalizeDetails(candidate, data);
      } catch (error) {
        const sanitized = error instanceof EnrichmentError ? error : new EnrichmentError();
        if (!failure || sanitized.code === 'RATE_LIMITED') failure = sanitized;
      }
    }
  }
  // Drain active workers before returning; failures prevent queued requests from starting.
  await Promise.all(Array.from({ length: Math.min(ENRICH_CONCURRENCY, candidates.length) }, worker));
  if (failure) throw failure;
  return { results, requested };
}

module.exports = { enrichCandidates, EnrichmentError, ENRICH_CONCURRENCY };
