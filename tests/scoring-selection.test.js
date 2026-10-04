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
  assert.equal(score(candidate('a', { restrooms: evidence(true) }), { largeGrass: true, restrooms: true }).pawstop.matchScore, 79);
  assert.equal(score(candidate(), { largeGrass: true, lowDogTraffic: true, restrooms: true, fencedSpace: true, goodLighting: true, avoidDedicatedReliefAreas: true }).pawstop.matchScore, 69);
});
for (const [preference, key] of [['largeGrass','largeGrass'], ['restrooms','restrooms'], ['fencedSpace','fenced'], ['goodLighting','lighting']]) {
  test(`preference ${preference} maps only to ${key}`, () => {
    assert.equal(score(candidate('a', { [key]: evidence(true) }), { [preference]: true }).pawstop.matchScore, 79);
    assert.equal(score(candidate('a', { [key]: evidence(false) }), { [preference]: true }).pawstop.matchScore, 0);
    assert.equal(score(candidate('a', { [key]: evidence(false) }), { [preference]: false }).pawstop.matchScore, 70);
  });
}
for (const [value, expected] of [['low',79],['medium',60],['high',20],[null,69]]) {
  test(`dog traffic ${value} maps to the requested preference value`, () => {
    assert.equal(score(candidate('a', { dogTraffic: value ? evidence(value) : unknown() }), { lowDogTraffic: true }).pawstop.matchScore, expected);
  });
}
for (const [value, confidence, expected] of [[true,'confirmed',0],[false,'confirmed',79],[true,'inferred',0],[false,'inferred',79],[null,'unknown',69]]) {
  test(`dedicated area ${value}/${confidence} uses evidence rather than category absence`, () => {
    const c = candidate('a', { dedicatedDogArea: evidence(value, confidence) });
    assert.equal(score(c, { avoidDedicatedReliefAreas: true }).pawstop.matchScore, expected);
    assert.equal(score(c, { avoidDedicatedReliefAreas: false }).pawstop.matchScore, 70);
  });
}
test('minimal detour preserves precision, denominator floor, and independent Phase 2C penalty', () => {
  for (const [detour, max, expected] of [[0,10,98],[5,10,70],[3.125,10,81],[1,0,40],[20,10,0]]) {
    assert.equal(score(candidate('a', { dogsAllowed: evidence(true) }, 150, detour), { minimalDetours: true }, 'adult', {}, max).pawstop.matchScore, expected);
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
  assert.equal(score(candidate('a', { restrooms: evidence(true) }), { restrooms: true }).pawstop.matchScore, 79);
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
  assert.deepEqual(result.diagnostics, { targets: 4, scored: 6, eligible: 6, dogExcluded: 0, belowFitThreshold: 0, selected: 3, gaps: 1, reusedSkipped: 1, chronologySkipped: 2, overDetourSelected: 1, unknownDogAccessSelected: 3 });
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
  const a = candidate('restrooms', { restrooms: evidence(true), dogsAllowed: evidence(true) }, 150, 1.5);
  const b = candidate('small-detour', { dogsAllowed: evidence(true) }, 150, 1);
  const pools = [{ targetMinutes: 150, matches: [match(a), match(b)] }];
  const winner = preferences => selectStops(scoreTargetPools(pools, options(preferences)), options()).recommendations[0].stop.id;
  assert.equal(winner({ restrooms: true, minimalDetours: true }), 'restrooms');
  assert.equal(winner({ restrooms: false, minimalDetours: true }), 'small-detour');
});

test('inferred traffic has half influence relative to confirmed boolean evidence', () => {
  const c = candidate('a', { dogTraffic: evidence('medium', 'inferred'), restrooms: evidence(false) });
  assert.equal(score(c, { lowDogTraffic: true, restrooms: true }).pawstop.matchScore, 20);
});

test('final quality floor includes exactly 60 and excludes 59.999 without changing scored/eligible counts', () => {
  const { MIN_PLANNED_FIT_SCORE } = require('../lib/selection');
  assert.equal(MIN_PLANNED_FIT_SCORE, 60);
  for (const fit of [60, 59.999]) {
    const result = selectStops([{ targetMinutes: 150, matches: [scored(candidate(), fit)] }], options());
    assert.equal(result.recommendations[0].stop?.id ?? null, fit === 60 ? 'a' : null);
    assert.equal(result.diagnostics.scored, 1); assert.equal(result.diagnostics.eligible, 1);
    assert.equal(result.diagnostics.belowFitThreshold, fit === 60 ? 0 : 1);
  }
});

test('qualifying planned fit outranks a low-fit candidate listed first even with higher match score', () => {
  const low = scored(candidate('late', {}, 218.7), 46.7, 68.7); low.pawstop.matchScore = 87;
  const qualifying = scored(candidate('qualifying'), 60);
  const rows = [low, qualifying]; const before = structuredClone(rows);
  const result = selectStops([{ targetMinutes: 150, matches: rows }], options());
  assert.equal(result.recommendations[0].stop.id, 'qualifying');
  assert.deepEqual(rows, before);
  // Descending fit visits the qualifying winner first; lower matches are not encountered.
  assert.equal(result.diagnostics.belowFitThreshold, 0);
});

test('low-fit pools create gaps, count each skipped pair and preserve uniqueness/chronology afterward', () => {
  const a = candidate('a', {}, 150), later = candidate('later', {}, 450);
  const pools = [
    { targetMinutes: 150, matches: [scored(a, 60)] },
    { targetMinutes: 300, matches: [scored(candidate('low', {}, 300), 59.999, 0, 300), scored(candidate('lower', {}, 310), 40, 10, 300)] },
    { targetMinutes: 450, matches: [scored(a, 90, 0, 450), scored(candidate('backward', {}, 149), 80, 0, 450), scored(later, 60, 0, 450)] }
  ];
  const result = selectStops(pools, options());
  assert.deepEqual(result.recommendations.map(r => r.stop?.id ?? null), ['a', null, 'later']);
  assert.equal(result.diagnostics.belowFitThreshold, 2);
  assert.equal(result.diagnostics.reusedSkipped, 1); assert.equal(result.diagnostics.chronologySkipped, 1);
  assert.equal(result.diagnostics.scored, 6); assert.equal(result.diagnostics.eligible, 6);
});

const allPreferences={largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,fencedSpace:true,goodLighting:true,avoidDedicatedReliefAreas:true};
const positiveAttributes={largeGrass:evidence(true),dogTraffic:evidence('low'),restrooms:evidence(true),fenced:evidence(true),lighting:evidence(true),dedicatedDogArea:evidence(false),dogsAllowed:evidence(true)};
test('dog-access ceilings bound strong fit without denying unknown access',()=>{
  for(const [dogs,expected,eligible] of [[evidence(true),98,true],[evidence(true,'inferred'),89,true],[unknown(),79,true],[evidence(true,'unknown'),79,true],[evidence(null),79,true],[evidence(false),79,false],[evidence(false,'inferred'),79,false]]){
    const result=score(candidate('a',{...positiveAttributes,dogsAllowed:dogs}),allPreferences);
    assert.equal(result.pawstop.matchScore,expected);assert.equal(result.eligible,eligible);
    assert.equal(result.pawstop.evidenceCoverage,100);assert.equal(result.pawstop.evidenceStrength,'strong');
  }
});
test('ceilings are minima, not deductions, and timing is applied once afterward',()=>{
  const c=candidate('a',{...positiveAttributes,dogsAllowed:unknown()});
  const result=score(c,allPreferences,'adult',{maxDetourPenalty:37,timingPenalty:11.125});
  assert.equal(result.pawstop.matchScore,63);assert.equal(result.pawstop.plannedFitScore,51.875);
  const capped=score(c,allPreferences,'adult',{timingPenalty:11.125});
  assert.equal(capped.pawstop.matchScore,79);assert.equal(capped.pawstop.plannedFitScore,67.875);
});
test('coverage boundaries use supported confirmed/inferred values including known negatives',()=>{
  const preferences={largeGrass:true,restrooms:true,fencedSpace:true,goodLighting:true};
  for(const [weight,coverage,strength,ceiling] of [[0,0,'very_limited',69],[.5,13,'very_limited',69],[1,25,'limited',79],[1.5,38,'limited',79],[2,50,'moderate',89],[2.5,63,'moderate',89],[3,75,'strong',98],[3.5,88,'strong',98],[4,100,'strong',98]]){
    const attributes={dogsAllowed:evidence(true)};let remaining=weight;
    for(const key of ['largeGrass','restrooms','fenced','lighting']){
      attributes[key]=remaining>=1?evidence(true):remaining>0?evidence(true,'inferred'):unknown();remaining=Math.max(0,remaining-1);
    }
    const result=score(candidate('a',attributes),preferences).pawstop;
    assert.equal(result.evidenceCoverage,coverage);assert.equal(result.evidenceStrength,strength);
    assert.equal(result.matchScore,weight===0?69:ceiling);
  }
  const negative=score(candidate('a',{...positiveAttributes,restrooms:evidence(false)}),{restrooms:true,largeGrass:true}).pawstop;
  assert.equal(negative.evidenceCoverage,100);assert.equal(negative.matchScore,50);
  const inferred=score(candidate('a',{dogsAllowed:evidence(true),restrooms:evidence(false,'inferred'),largeGrass:evidence(true)}),{restrooms:true,largeGrass:true}).pawstop;
  assert.equal(inferred.evidenceCoverage,75);assert.equal(inferred.matchScore,67);
});
test('40/60/80 percent coverage examples and the sparse live pattern are calibrated',()=>{
  const preferences={largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,avoidDedicatedReliefAreas:true};
  for(const [extra,coverage,strength,ceiling] of [[{},40,'limited',79],[{largeGrass:evidence(true)},60,'moderate',89],[{largeGrass:evidence(true),dogTraffic:evidence('low')},80,'strong',98]]){
    const c=candidate('a',{dogsAllowed:evidence(true),restrooms:evidence(true),...extra});
    const result=score(c,preferences).pawstop;
    assert.equal(result.evidenceCoverage,coverage);assert.equal(result.evidenceStrength,strength);assert.equal(result.matchScore,ceiling);
  }
  const c=candidate('live-pattern',{restrooms:evidence(true)},150,1.5);
  const result=score(c,preferences,'puppy').pawstop;
  assert.equal(result.matchScore,79);assert.equal(result.evidenceCoverage,40);assert.equal(result.evidenceStrength,'limited');
});
test('coverage ignores disabled signals, parking and dog permission; rejects unsupported values',()=>{
  const c=candidate('a',{dogsAllowed:evidence(true),parking:evidence(true),largeGrass:evidence('yes'),dogTraffic:evidence('busy'),restrooms:evidence(true,'unknown'),dedicatedDogArea:evidence(null)});
  const result=score(c,{largeGrass:true,lowDogTraffic:true,restrooms:true,avoidDedicatedReliefAreas:true}).pawstop;
  assert.equal(result.evidenceCoverage,0);assert.equal(result.evidenceStrength,'very_limited');assert.equal(result.matchScore,69);
  const detour=score(c,{minimalDetours:true}).pawstop;
  assert.equal(detour.evidenceCoverage,100);assert.equal(detour.matchScore,98);
  const none=score(c,{largeGrass:false,restrooms:false}).pawstop;
  assert.equal(none.evidenceCoverage,null);assert.equal(none.evidenceStrength,null);assert.equal(none.matchScore,70);
});
test('all inferred positive preferences count half and no-preference soft signals remain neutral',()=>{
  const attributes=Object.fromEntries(Object.entries(positiveAttributes).map(([key,a])=>[key,evidence(a.value,'inferred')]));attributes.dogsAllowed=evidence(true);
  const result=score(candidate('a',attributes),{...allPreferences,minimalDetours:false}).pawstop;
  assert.equal(result.evidenceCoverage,50);assert.equal(result.evidenceStrength,'moderate');assert.equal(result.matchScore,89);
  for(const dogsAllowed of [unknown(),evidence(true),evidence(true,'inferred')]){
    const none=score(candidate('a',{dogsAllowed}),{},'senior').pawstop;
    assert.equal(none.matchScore,73);assert.equal(none.evidenceCoverage,null);assert.equal(none.evidenceStrength,null);
  }
});
test('calibrated fit selects stronger evidence and creates truthful below-floor gaps',()=>{
  const preferences={largeGrass:true,lowDogTraffic:true,restrooms:true,minimalDetours:true,avoidDedicatedReliefAreas:true};
  const sparse=candidate('sparse',{restrooms:evidence(true),dogsAllowed:evidence(true)},150,0);
  const strong=candidate('strong',positiveAttributes,150,3);
  const pools=[{targetMinutes:150,matches:[match(sparse),match(strong)]},{targetMinutes:300,matches:[match(candidate('weak',{restrooms:evidence(true)},300),{targetMinutes:300,timingPenalty:20})]}];
  const result=selectStops(scoreTargetPools(pools,options(preferences)),options());
  assert.deepEqual(result.recommendations.map(r=>r.stop?.id??null),['strong',null]);
  assert.equal(result.diagnostics.belowFitThreshold,1);
  assert.deepEqual(Object.keys(result.recommendations[0].stop.pawstop),['matchScore','plannedFitScore','evidenceCoverage','evidenceStrength','why']);
  assert.equal(result.recommendations[0].stop.pawstop.evidenceCoverage,100);
});
