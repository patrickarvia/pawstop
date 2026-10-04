const MIN_PLANNED_FIT_SCORE = 60;
const ATTRIBUTES = ['largeGrass', 'dogTraffic', 'restrooms', 'dogsAllowed', 'fenced', 'lighting', 'parking', 'dedicatedDogArea'];

function compareMatches(a, b) {
  return b.pawstop.plannedFitScore - a.pawstop.plannedFitScore
    || Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes)
    || a.candidate.route.detourMinutes - b.candidate.route.detourMinutes
    || a.candidate.route.tripMinutes - b.candidate.route.tripMinutes
    || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0);
}

// Explicit projection is the public boundary: never spread a candidate or match here.
function publicStop(match) {
  const candidate = match.candidate;
  return {
    id: candidate.id, name: candidate.name, primaryType: candidate.primaryType,
    address: candidate.address, lat: candidate.lat, lng: candidate.lng,
    route: {
      tripMinutes: candidate.route.tripMinutes, detourMinutes: candidate.route.detourMinutes,
      targetMinutes: match.targetMinutes, deltaMinutes: match.deltaMinutes, timingLabel: match.timingLabel
    },
    pawstop: { matchScore: match.pawstop.matchScore, plannedFitScore: match.pawstop.plannedFitScore,
      evidenceCoverage: match.pawstop.evidenceCoverage, evidenceStrength: match.pawstop.evidenceStrength, why: [...match.pawstop.why] },
    attributes: Object.fromEntries(ATTRIBUTES.map(key => {
      const attribute = candidate.attributes[key];
      return [key, { value: attribute.value, confidence: attribute.confidence,
        ...(typeof attribute.evidence === 'string' ? { evidence: attribute.evidence } : {}) }];
    })),
    // Navigation has already been validated by enrichment; scoring never constructs it.
    navigation: candidate.navigation?.googleMapsUrl ? { googleMapsUrl: candidate.navigation.googleMapsUrl } : null,
    verification: candidate.verification?.placeWebsiteUrl ? { placeWebsiteUrl: candidate.verification.placeWebsiteUrl } : null,
    provenance: { provider: candidate.provenance.provider, placeId: candidate.provenance.placeId }
  };
}

function selectStops(pools, { maxDetourMinutes }) {
  const diagnostics = { targets: pools.length, scored: 0, eligible: 0, dogExcluded: 0, belowFitThreshold: 0, selected: 0, gaps: 0, reusedSkipped: 0, chronologySkipped: 0, overDetourSelected: 0, unknownDogAccessSelected: 0 };
  const used = new Set();
  let previousTripMinutes = -Infinity;
  const recommendations = [...pools].sort((a, b) => a.targetMinutes - b.targetMinutes).map(pool => {
    diagnostics.scored += pool.matches.length;
    const eligible = pool.matches.filter(match => match.eligible);
    diagnostics.eligible += eligible.length;
    diagnostics.dogExcluded += pool.matches.length - eligible.length;
    let stop = null;
    for (const match of eligible.sort(compareMatches)) {
      if (match.pawstop.plannedFitScore < MIN_PLANNED_FIT_SCORE) { diagnostics.belowFitThreshold++; continue; }
      const candidate = match.candidate;
      if (used.has(candidate.id)) { diagnostics.reusedSkipped++; continue; }
      if (candidate.route.tripMinutes <= previousTripMinutes) { diagnostics.chronologySkipped++; continue; }
      stop = publicStop(match);
      used.add(candidate.id);
      previousTripMinutes = candidate.route.tripMinutes;
      diagnostics.selected++;
      if (candidate.route.detourMinutes > maxDetourMinutes) diagnostics.overDetourSelected++;
      if (candidate.attributes.dogsAllowed.confidence === 'unknown') diagnostics.unknownDogAccessSelected++;
      break;
    }
    if (!stop) diagnostics.gaps++;
    return { targetMinutes: pool.targetMinutes, stop };
  });
  return { recommendations, diagnostics };
}

module.exports = { selectStops, compareMatches, MIN_PLANNED_FIT_SCORE };
