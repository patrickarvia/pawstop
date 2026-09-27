const { scoreTargetPools } = require('../lib/scoring');
const { selectStops } = require('../lib/selection');
const { enrichTargetPools } = require('../lib/target-enrichment');
const { EnrichmentError } = require('../lib/google-enrichment');
const { matchTargets } = require('../lib/target-matching');
const { discoverCandidates, DiscoveryError } = require('../lib/google-discovery');

const PREFERENCES = ['largeGrass', 'lowDogTraffic', 'restrooms', 'minimalDetours', 'fencedSpace', 'goodLighting', 'avoidDedicatedReliefAreas'];
const MESSAGES = {
  NO_STOP_CANDIDATES: "We couldn't find a suitable Pawstop along this route.",
  INVALID_INPUT: 'Please check your trip details and try again.',
  ROUTE_NOT_FOUND: "We couldn't find a drivable route between those locations.",
  PROVIDER_ERROR: "We couldn't load your route right now. Please try again shortly.",
  RATE_LIMITED: 'Route planning is busy right now. Please try again shortly.'
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function validInput(body) {
  return object(body) && text(body.origin, 500) && text(body.destination, 500) && text(body.dogName, 100)
    && ['puppy', 'adult', 'senior'].includes(body.lifeStage)
    && Number.isFinite(body.breakCadenceMinutes) && body.breakCadenceMinutes >= 1 && body.breakCadenceMinutes <= 1440
    && Number.isFinite(body.maxDetourMinutes) && body.maxDetourMinutes >= 0 && body.maxDetourMinutes <= 1440
    && object(body.preferences) && PREFERENCES.every(key => typeof body.preferences[key] === 'boolean');
}

function normalizeRoute(route) {
  if (!object(route) || typeof route.duration !== 'string' || !/^\d+(?:\.\d{1,9})?s$/.test(route.duration)) return null;
  const durationMinutes = Number(route.duration.slice(0, -1)) / 60;
  // Bound unusable provider data and target allocation to at most 30 days.
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 43200
    || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0
    || !text(route.polyline?.encodedPolyline, 1000000)) return null;
  return { durationMinutes, distanceMeters: route.distanceMeters, encodedPolyline: route.polyline.encodedPolyline, provider: 'google', trafficAware: false };
}

function plannedTargets(duration, cadence) {
  const targets = [];
  for (let multiple = 1; multiple * cadence < duration; multiple++) targets.push(multiple * cadence);
  return targets;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const error = (status, code) => res.status(status).json({ error: { code, message: MESSAGES[code] } });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return error(405, 'INVALID_INPUT');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return error(400, 'INVALID_INPUT');
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return error(400, 'INVALID_INPUT');
  }
  if (!validInput(body)) return error(400, 'INVALID_INPUT');
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (typeof key !== 'string' || !key.trim()) return error(502, 'PROVIDER_ERROR');

  try {
    // Share the existing request budget across routing, discovery, and enrichment.
    const signal = AbortSignal.timeout(15000);
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline'
      },
      body: JSON.stringify({
        origin: { address: body.origin.trim() },
        destination: { address: body.destination.trim() },
        travelMode: 'DRIVE',
        // Temporary Phase 1 choice; the final V2.2 traffic mode remains open.
        routingPreference: 'TRAFFIC_UNAWARE'
      }),
      signal
    });
    if (response.status === 429) return error(429, 'RATE_LIMITED');
    if (!response.ok) return error(502, 'PROVIDER_ERROR');
    const data = await response.json();
    if (!object(data) || data.error) return error(502, 'PROVIDER_ERROR');
    // Protobuf JSON may omit an empty routes array when no route is found.
    if (!Object.hasOwn(data, 'routes') && Object.keys(data).length === 0) return error(422, 'ROUTE_NOT_FOUND');
    if (!Array.isArray(data.routes)) return error(502, 'PROVIDER_ERROR');
    if (!data.routes.length) return error(422, 'ROUTE_NOT_FOUND');
    const route = data.routes.map(normalizeRoute).find(Boolean);
    if (!route) return error(502, 'PROVIDER_ERROR');
    const breakTargetsMinutes = plannedTargets(route.durationMinutes, body.breakCadenceMinutes);
    let recommendations = [];
    // Only selected, explicitly projected stops cross the public boundary.
    // Short routes need no discovery.
    if (breakTargetsMinutes.length) {
      const { candidates, diagnostics } = await discoverCandidates(route.encodedPolyline, { signal, baselineRouteDurationMinutes: route.durationMinutes });
      const matching = matchTargets({ candidates, breakTargetsMinutes, breakCadenceMinutes: body.breakCadenceMinutes, maxDetourMinutes: body.maxDetourMinutes });
      const enrichment = await enrichTargetPools(matching.pools, { signal });
      const selection = selectStops(scoreTargetPools(enrichment.pools, body), body);
      recommendations = selection.recommendations;
      if (['preview', 'development'].includes(process.env.VERCEL_ENV)
        || (!process.env.VERCEL_ENV && process.env.NODE_ENV !== 'production')) {
        console.log(`Phase2A discovery: received=${diagnostics.receivedCount} candidates=${diagnostics.candidateCount} duplicates=${diagnostics.duplicateCount} rejected=${diagnostics.rejectedCount}`);
        const metrics = diagnostics.routing;
        const ranges = metrics.routedCount ? ` tripMin=${metrics.tripMin.toFixed(1)} tripMax=${metrics.tripMax.toFixed(1)} detourMin=${metrics.detourMin.toFixed(1)} detourMax=${metrics.detourMax.toFixed(1)}` : '';
        console.log(`Phase2B routing: candidates=${diagnostics.candidateCount} routed=${metrics.routedCount} missing=${metrics.missingCount} inconsistent=${metrics.inconsistentCount}${ranges}`);
        const counts = matching.diagnostics;
        console.log(`Phase2C matching: targets=${counts.targets} routed=${counts.routed} pairs=${counts.pairs} coveredTargets=${counts.coveredTargets} gaps=${counts.gaps} overDetour=${counts.overDetour} close=${counts.close} early=${counts.early} late=${counts.late}`);
        const evidence = enrichment.diagnostics;
        console.log(`Phase2D enrichment: selected=${evidence.selected} requested=${evidence.requested} enriched=${evidence.enriched} unchanged=${evidence.unchanged} dogsKnown=${evidence.dogsKnown} restroomsKnown=${evidence.restroomsKnown} parkingKnown=${evidence.parkingKnown} dedicatedKnown=${evidence.dedicatedKnown} navKnown=${evidence.navKnown}`);
        const selected = selection.diagnostics;
        console.log(`Phase2E selection: targets=${selected.targets} scored=${selected.scored} eligible=${selected.eligible} dogExcluded=${selected.dogExcluded} selected=${selected.selected} gaps=${selected.gaps} reusedSkipped=${selected.reusedSkipped} chronologySkipped=${selected.chronologySkipped} overDetourSelected=${selected.overDetourSelected} unknownDogAccessSelected=${selected.unknownDogAccessSelected}`);
      }
      if (!selection.diagnostics.selected) return error(422, 'NO_STOP_CANDIDATES');
    }
    return res.status(200).json({
      route,
      breakTargetsMinutes,
      recommendations
    });
  } catch (failure) {
    if ((failure instanceof DiscoveryError || failure instanceof EnrichmentError) && failure.code === 'RATE_LIMITED') return error(429, 'RATE_LIMITED');
    // Never return or log provider bodies, exception messages, or credentials.
    return error(502, 'PROVIDER_ERROR');
  }
};
