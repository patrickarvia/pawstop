const BOOLEAN_PREFERENCES = {
  largeGrass: 'largeGrass', restrooms: 'restrooms', fencedSpace: 'fenced', goodLighting: 'lighting'
};
const trafficScore = attribute => ({ low: 5, medium: 3, high: 1 })[attribute?.value];
const confidenceWeight = attribute => attribute?.confidence === 'confirmed' ? 1 : attribute?.confidence === 'inferred' ? 0.5 : 0;

function explanations(candidate, match, preferences) {
  const why = [];
  const addEvidence = attribute => {
    if (confidenceWeight(attribute) && typeof attribute.evidence === 'string' && attribute.evidence.trim()) {
      const explanation = attribute.confidence === 'inferred' ? `Inferred: ${attribute.evidence}` : attribute.evidence;
      if (!why.includes(explanation)) why.push(explanation);
    }
  };
  const attributes = candidate.attributes;
  if (!confidenceWeight(attributes.dogsAllowed) || typeof attributes.dogsAllowed.value !== 'boolean') {
    why.push('Dog access is not confirmed.');
  } else if (attributes.dogsAllowed.value) {
    if (attributes.dogsAllowed.evidence) addEvidence(attributes.dogsAllowed);
    else why.push(attributes.dogsAllowed.confidence === 'inferred' ? 'Dog access is inferred, not confirmed.' : 'Dogs are reported to be allowed.');
  }
  for (const key of ['restrooms', 'parking']) addEvidence(attributes[key]);
  for (const [preference, key] of Object.entries(BOOLEAN_PREFERENCES)) if (preferences[preference]) addEvidence(attributes[key]);
  if (preferences.lowDogTraffic) addEvidence(attributes.dogTraffic);
  if (preferences.avoidDedicatedReliefAreas) addEvidence(attributes.dedicatedDogArea);
  why.push(`This stop adds about ${Math.round(candidate.route.detourMinutes)} minutes to the route.`);
  why.push(match.timingLabel);
  return why;
}

// Only normalized evidence and Phase 2C match values enter scoring.
function scoreStop(candidate, match, { preferences, lifeStage, maxDetourMinutes }) {
  let earned = 0, possible = 0;
  for (const [preference, key] of Object.entries(BOOLEAN_PREFERENCES)) {
    const attribute = candidate.attributes[key];
    if (!preferences[preference] || typeof attribute?.value !== 'boolean') continue;
    const weight = confidenceWeight(attribute);
    possible += 5 * weight;
    if (attribute.value) earned += 5 * weight;
  }
  const traffic = candidate.attributes.dogTraffic;
  const trafficValue = trafficScore(traffic);
  const trafficWeight = Number.isFinite(trafficValue) ? confidenceWeight(traffic) : 0;
  if (preferences.lowDogTraffic) {
    earned += (trafficValue || 0) * trafficWeight;
    possible += 5 * trafficWeight;
  }
  const detour = candidate.route.detourMinutes;
  if (preferences.minimalDetours) {
    possible += 5;
    earned += Math.max(0, 5 - (detour / Math.max(maxDetourMinutes, 1)) * 3);
  }
  const dedicated = candidate.attributes.dedicatedDogArea;
  if (preferences.avoidDedicatedReliefAreas && typeof dedicated?.value === 'boolean') {
    const weight = confidenceWeight(dedicated);
    possible += 5 * weight;
    if (!dedicated.value) earned += 5 * weight;
  }
  const rawPreferenceScore = possible > 0 ? earned / possible : 0.70;
  const lifeStageBonus = lifeStage === 'puppy' ? ((trafficValue || 3) - 3) * 1.5 * trafficWeight
    : lifeStage === 'senior' ? Math.max(-3, 3 - detour / 2) : 0;
  const matchScore = Math.max(0, Math.min(98, Math.round(rawPreferenceScore * 100 + lifeStageBonus - match.maxDetourPenalty)));
  const dogs = candidate.attributes.dogsAllowed;
  return {
    eligible: !(confidenceWeight(dogs) > 0 && dogs.value === false),
    pawstop: { matchScore, plannedFitScore: matchScore - match.timingPenalty, why: explanations(candidate, match, preferences) }
  };
}

function scoreTargetPools(pools, options) {
  return pools.map(pool => ({ ...pool, matches: pool.matches.map(match => ({
    ...match, ...scoreStop(match.candidate, match, options)
  })) }));
}

module.exports = { scoreStop, scoreTargetPools };
