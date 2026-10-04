const { enrichCandidates } = require('./google-enrichment');
const ENRICH_PER_TARGET = 5;
const MAX_ENRICH_CANDIDATES = 20;

function selectCandidates(pools) {
  const selected = new Map();
  for (const pool of pools) {
    for (const { candidate } of pool.matches.slice(0, ENRICH_PER_TARGET)) {
      if (!selected.has(candidate.id)) selected.set(candidate.id, candidate);
      if (selected.size === MAX_ENRICH_CANDIDATES) return [...selected.values()];
    }
  }
  return [...selected.values()];
}

async function enrichTargetPools(pools, { signal } = {}) {
  const selected = selectCandidates(pools);
  const { results, requested } = await enrichCandidates(selected, { signal });
  const byId = new Map(results.map(result => [result.candidate.id, result.candidate]));
  const diagnostics = {
    selected: selected.length, requested,
    enriched: results.filter(result => result.status === 'enriched').length,
    unchanged: results.filter(result => result.status === 'unchanged').length,
    dogsKnown: 0, restroomsKnown: 0, parkingKnown: 0, dedicatedKnown: 0, navKnown: 0,
    reviewDogsKnown: 0, reviewGrassKnown: 0, reviewTrafficKnown: 0, reviewFencedKnown: 0, reviewLightingKnown: 0, reviewDedicatedKnown: 0, websiteKnown: 0
  };
  for (const { candidate, reviewAttributes = [] } of results) {
    for (const [counter, attribute] of [['reviewDogsKnown','dogsAllowed'],['reviewGrassKnown','largeGrass'],['reviewTrafficKnown','dogTraffic'],['reviewFencedKnown','fenced'],['reviewLightingKnown','lighting'],['reviewDedicatedKnown','dedicatedDogArea']]) {
      if (reviewAttributes.includes(attribute)) diagnostics[counter]++;
    }
    if (candidate.verification?.placeWebsiteUrl) diagnostics.websiteKnown++;
    for (const [counter, attribute] of [['dogsKnown', 'dogsAllowed'], ['restroomsKnown', 'restrooms'], ['parkingKnown', 'parking'], ['dedicatedKnown', 'dedicatedDogArea']]) {
      if (candidate.attributes[attribute].confidence !== 'unknown') diagnostics[counter]++;
    }
    if (candidate.navigation?.googleMapsUrl) diagnostics.navKnown++;
  }
  return {
    pools: pools.map(pool => ({ ...pool, matches: pool.matches.map(match => ({
      ...match, candidate: byId.get(match.candidate.id) || match.candidate
    })) })),
    results, diagnostics
  };
}

module.exports = { enrichTargetPools, selectCandidates, ENRICH_PER_TARGET, MAX_ENRICH_CANDIDATES };
