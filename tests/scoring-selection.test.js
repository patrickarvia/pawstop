const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreStop, scoreTargetPools } = require('../lib/scoring');
const { selectStops, compareMatches } = require('../lib/selection');
const { matchTargets } = require('../lib/target-matching');
const unknown = () => ({ value: null, confidence: 'unknown' });
const evidence = (value, confidence = 'confirmed', text = 'Supported evidence.') => ({ value, confidence, evidence: text });
function candidate(id = 'a', attributes = {}, tripMinutes = 150, detourMinutes = 0) {
  return { id, name: `Stop ${id}`, primaryType: 'park', address: null, lat: 40, lng: -74,
    route: { tripMinutes, detourMinutes },
    attributes: { ...Object.fromEntries(['largeGrass','dogTraffic','restrooms','dogsAllowed','fenced','lighting','parking','dedicatedDogArea'].map(key => [key, unknown()])), ...attributes },
    provenance: { provider: 'synthetic', placeId: 'source-id' } };
}
const match = (c = candidate(), extra = {}) => ({ candidate: c, targetMinutes: 150, deltaMinutes: 0, timingPenalty: 0, timingLabel: 'Close to planned break', maxDetourPenalty: 0, ...extra });
const options = (preferences = {}, lifeStage = 'adult', maxDetourMinutes = 10) => ({ preferences, lifeStage, maxDetourMinutes });
const score = (c, preferences = {}, lifeStage = 'adult', values = {}, max = 10) => scoreStop(c, match(c, values), options(preferences, lifeStage, max));

for (const [confidence, value, expected] of [['confirmed',true,50],['confirmed',false,0],['inferred',true,33],['inferred',false,0],['unknown',null,0]]) {
  test(`${confidence} ${value} uses weighted boolean evidence against confirmed false`, () => {
    const c = candidate('a', { largeGrass: evidence(value, confidence), restrooms: evidence(false) });
    assert.equal(score(c, { largeGrass: true, restrooms: true }).pawstop.matchScore, expected);
  });
}
test('inferred false has half influence and unknown contributes neither earned nor possible', () => {
  assert.equal(score(candidate('a', { largeGrass: evidence(false, 'inferred'), restrooms: evidence(true) }), { largeGrass: true, restrooms: true }).pawstop.matchScore, 67);
  assert.equal(score(candidate('a', { restrooms: evidence(true) }), { largeGrass: true, restrooms: true }).pawstop.matchScore, 98);
  assert.equal(score(candidate(), { largeGrass: true, lowDogTraffic: true, restrooms: true, fencedSpace: true, goodLighting: true, avoidDedicatedReliefAreas: true }).pawstop.matchScore, 70);
});
for (const [preference, key] of [['largeGrass','largeGrass'], ['restrooms','restrooms'], ['fencedSpace','fenced'], ['goodLighting','lighting']]) {
  test(`preference ${preference} maps only to ${key}`, () => {
    assert.equal(score(candidate('a', { [key]: evidence(true) }), { [preference]: true }).pawstop.matchScore, 98);
    assert.equal(score(candidate('a', { [key]: evidence(false) }), { [preference]: true }).pawstop.matchScore, 0);
    assert.equal(score(candidate('a', { [key]: evidence(false) }), { [preference]: false }).pawstop.matchScore, 70);
  });
}
for (const [value, expected] of [['low',98],['medium',60],['high',20],[null,70]]) {
  test(`dog traffic ${value} maps to the requested preference value`, () => {
    assert.equal(score(candidate('a', { dogTraffic: value ? evidence(value) : unknown() }), { lowDogTraffic: true }).pawstop.matchScore, expected);
  });
}
for (const [value, confidence, expected] of [[true,'confirmed',0],[false,'confirmed',98],[true,'inferred',0],[false,'inferred',98],[null,'unknown',70]]) {
  test(`dedicated area ${value}/${confidence} uses evidence rather than category absence`, () => {
    const c = candidate('a', { dedicatedDogArea: evidence(value, confidence) });
    assert.equal(score(c, { avoidDedicatedReliefAreas: true }).pawstop.matchScore, expected);
    assert.equal(score(c, { avoidDedicatedReliefAreas: false }).pawstop.matchScore, 70);
  });
}
test('minimal detour preserves precision, denominator floor, and independent Phase 2C penalty', () => {
  for (const [detour, max, expected] of [[0,10,98],[5,10,70],[3.125,10,81],[1,0,40],[20,10,0]]) {
    assert.equal(score(candidate('a', {}, 150, detour), { minimalDetours: true }, 'adult', {}, max).pawstop.matchScore, expected);
  }
  const c = candidate('a', {}, 150, 12);
  const pair = matchTargets({ candidates: [c], breakTargetsMinutes: [150], breakCadenceMinutes: 150, maxDetourMinutes: 10 }).pools[0].matches[0];
  const scored = scoreStop(c, pair, options({ minimalDetours: false }));
  assert.equal(scored.pawstop.matchScore, 48); assert.equal(scored.eligible, true);
  // Deliberately distinct from a recomputed penalty: the supplied match value is authoritative.
  assert.equal(score(c, {}, 'adult', { maxDetourPenalty: 17.25 }).pawstop.matchScore, 53);
});
for (const [value, confidence, expected] of [['low','confirmed',73],['medium','confirmed',70],['high','confirmed',67],['low','inferred',72],['high','inferred',69],[null,'unknown',70]]) {
  test(`puppy soft signal ${value}/${confidence} only uses evidenced traffic`, () => {
    const c = candidate('a', { dogTraffic: evidence(value, confidence) });
    assert.equal(score(c, {}, 'puppy').pawstop.matchScore, expected);
    assert.equal(score(c, {}, 'adult').pawstop.matchScore, 70);
  });
}
test('senior detour soft signal and rounding/clamping preserve score math', () => {
  for (const [detour, expected] of [[0,73],[3,72],[6,70],[20,67]]) assert.equal(score(candidate('a', {}, 150, detour), {}, 'senior').pawstop.matchScore, expected);
  assert.equal(score(candidate('a', { restrooms: evidence(true) }), { restrooms: true }).pawstop.matchScore, 98);
  const result = score(candidate(), {}, 'adult', { maxDetourPenalty: 100, timingPenalty: 11.125 });
  assert.equal(result.pawstop.matchScore, 0); assert.equal(result.pawstop.plannedFitScore, -11.125);
  assert.equal(score(candidate(), {}, 'adult', { timingPenalty: 0.075 }).pawstop.plannedFitScore, 69.925);
});
for (const [confidence, value, eligible] of [['confirmed',false,false],['inferred',false,false],['confirmed',true,true],['inferred',true,true],['unknown',null,true]]) {
  test(`dog access ${value}/${confidence} affects eligibility without bonus points`, () => {
    const result = score(candidate('a', { dogsAllowed: evidence(value, confidence), parking: evidence(true) }));
    assert.equal(result.eligible, eligible); assert.equal(result.pawstop.matchScore, 70);
  });
}
test('explanations use normalized evidence, label inferences and preserve uncertainty', () => {
  const c = candidate('a', { dogsAllowed: evidence(true, 'confirmed', 'Dogs allowed on leash.'), restrooms: evidence(true, 'confirmed', 'Restrooms are confirmed.'), parking: evidence(true, 'confirmed', 'Parking is confirmed.'), dedicatedDogArea: evidence(true, 'confirmed', 'Dedicated dog area.'), fenced: evidence(true, 'inferred', 'Fencing is suggested by evidence.') }, 150, 6.2);
  const why = score(c, { avoidDedicatedReliefAreas: true, fencedSpace: true }).pawstop.why;
  assert.deepEqual(why, ['Dogs allowed on leash.', 'Restrooms are confirmed.', 'Parking is confirmed.', 'Inferred: Fencing is suggested by evidence.', 'Dedicated dog area.', 'This stop adds about 6 minutes to the route.', 'Close to planned break']);
  const unsupported = score(candidate(), { largeGrass: true, lowDogTraffic: true, fencedSpace: true, goodLighting: true }).pawstop.why;
  assert.deepEqual(unsupported, ['Dog access is not confirmed.', 'This stop adds about 0 minutes to the route.', 'Close to planned break']);
  assert.ok(!why.join(' ').includes('Google'));
});

function scored(c, fit, delta = 0, targetMinutes = 150) {
  return { ...match(c, { targetMinutes, deltaMinutes: delta }), eligible: true, pawstop: { matchScore: 70, plannedFitScore: fit, why: ['Evidence.'] } };
}
test('ranking applies every tie-breaker and is independent of input order', () => {
  const rows = [scored(candidate('fit', {}, 170, 10), 90, 20), scored(candidate('delta', {}, 160, 9), 80, 0), scored(candidate('detour', {}, 160, 1), 80, 10), scored(candidate('a', {}, 140, 2), 80, -10), scored(candidate('b', {}, 140, 2), 80, -10), scored(candidate('trip', {}, 160, 2), 80, 10)];
  for (const source of [rows, [...rows].reverse()]) assert.deepEqual([...source].sort(compareMatches).map(m => m.candidate.id), ['fit','delta','detour','a','b','trip']);
});
test('selection greedily skips reused and non-increasing stops, preserves gaps and continues afterward', () => {
  const a = candidate('a', {}, 200), b = candidate('b', {}, 210), c = candidate('c', {}, 205), d = candidate('d', {}, 500, 12);
  const pools = [
    { targetMinutes: 450, matches: [scored(c, 90, 0, 450)] },
    { targetMinutes: 150, matches: [scored(a, 90)] },
    { targetMinutes: 300, matches: [scored(a, 99, 0, 300), scored(candidate('equal', {}, 200), 95, 0, 300), scored(b, 80, 0, 300)] },
    { targetMinutes: 600, matches: [scored(d, 70, 0, 600)] }
  ];
  const before = structuredClone(pools);
  const result = selectStops(pools, { maxDetourMinutes: 10 });
  assert.deepEqual(result.recommendations.map(r => [r.targetMinutes, r.stop?.id || null]), [[150,'a'],[300,'b'],[450,null],[600,'d']]);
  assert.deepEqual(pools, before);
  assert.deepEqual(result.diagnostics, { targets: 4, scored: 6, eligible: 6, dogExcluded: 0, selected: 3, gaps: 1, reusedSkipped: 1, chronologySkipped: 2, overDetourSelected: 1, unknownDogAccessSelected: 3 });
});
test('public projection exposes only contract fields, preserves metrics and does not mutate inputs', () => {
  const c = candidate(); c.navigation = { googleMapsUrl: 'https://maps.google.com/?cid=1', secret: 'hidden' }; c.raw = 'hidden';
  c.attributes.largeGrass.raw = 'hidden'; c.provenance.raw = 'hidden';
  const pair = match(c, { targetMinutes: 150, deltaMinutes: 0.125, timingLabel: 'Close to planned break', timingPenalty: 0.125 });
  const pools = [{ targetMinutes: 150, matches: [pair] }]; const before = structuredClone(pools);
  const result = selectStops(scoreTargetPools(pools, options()), { maxDetourMinutes: 10 });
  const stop = result.recommendations[0].stop;
  assert.deepEqual(Object.keys(stop), ['id','name','primaryType','address','lat','lng','route','pawstop','attributes','navigation','provenance']);
  assert.deepEqual(stop.route, { tripMinutes: 150, detourMinutes: 0, targetMinutes: 150, deltaMinutes: 0.125, timingLabel: 'Close to planned break' });
  assert.equal(stop.pawstop.matchScore, 70); assert.equal(stop.pawstop.plannedFitScore, 69.875); assert.ok(Array.isArray(stop.pawstop.why));
  assert.deepEqual(stop.navigation, { googleMapsUrl: 'https://maps.google.com/?cid=1' });
  assert.deepEqual(stop.provenance, { provider: 'synthetic', placeId: 'source-id' });
  for (const forbidden of ['raw','hidden','timingPenalty','maxDetourPenalty','earned','possible','eligible','enrichment','routingSummaries','allowsDogs','parkingOptions','googleMapsUri']) assert.ok(!JSON.stringify(stop).includes(forbidden));
  assert.deepEqual(pools, before);
  assert.equal(selectStops(scoreTargetPools([{ targetMinutes: 150, matches: [match()] }], options()), options()).recommendations[0].stop.navigation, null);
});
test('scoring all pools excludes known denied dog access, including inferred denials', () => {
  const pools = [{ targetMinutes: 150, matches: [match(candidate('denied', { dogsAllowed: evidence(false) })), match(candidate('inferred-denied', { dogsAllowed: evidence(false, 'inferred') })), match(candidate('unknown'))] }];
  const result = selectStops(scoreTargetPools(pools, options()), options());
  assert.equal(result.recommendations[0].stop.id, 'unknown');
  assert.equal(result.diagnostics.scored, 3); assert.equal(result.diagnostics.dogExcluded, 2); assert.equal(result.diagnostics.eligible, 1);
});
test('changing preferences materially changes the selected stop', () => {
  const a = candidate('restrooms', { restrooms: evidence(true) }, 150, 1.5);
  const b = candidate('small-detour', {}, 150, 1);
  const pools = [{ targetMinutes: 150, matches: [match(a), match(b)] }];
  const winner = preferences => selectStops(scoreTargetPools(pools, options(preferences)), options()).recommendations[0].stop.id;
  assert.equal(winner({ restrooms: true, minimalDetours: true }), 'restrooms');
  assert.equal(winner({ restrooms: false, minimalDetours: true }), 'small-detour');
});

test('inferred traffic has half influence relative to confirmed boolean evidence', () => {
  const c = candidate('a', { dogTraffic: evidence('medium', 'inferred'), restrooms: evidence(false) });
  assert.equal(score(c, { lowDogTraffic: true, restrooms: true }).pawstop.matchScore, 20);
});
