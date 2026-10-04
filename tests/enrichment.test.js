const { test } = require('node:test');
const assert = require('node:assert/strict');
const { enrichCandidates, ENRICH_CONCURRENCY } = require('../lib/google-enrichment');
const { enrichTargetPools, selectCandidates, ENRICH_PER_TARGET, MAX_ENRICH_CANDIDATES } = require('../lib/target-enrichment');
const unknown = () => ({ value: null, confidence: 'unknown' });
const candidate = (id, extra = {}) => ({
  id: `paw-${id}`, name: 'Private name', address: 'Private address', lat: 40, lng: -74,
  primaryType: 'park', types: ['park'], route: { tripMinutes: 150.25, detourMinutes: 12.125 },
  attributes: Object.fromEntries(['dogsAllowed', 'restrooms', 'parking', 'dedicatedDogArea', 'largeGrass', 'dogTraffic', 'fenced', 'lighting'].map(key => [key, unknown()])),
  provenance: { provider: 'google', placeId: id }, ...extra
});
const pool = candidates => ({ targetMinutes: 150, matches: candidates.map(candidate => ({ candidate, targetMinutes: 150, deltaMinutes: 0.25, timingPenalty: 0, timingLabel: 'Close to planned break', maxDetourPenalty: 22.75 })) });
const ok = data => ({ ok: true, status: 200, json: async () => data });
async function provider(fn, run) {
  const oldFetch = global.fetch, oldKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  const requests = [], signal = new AbortController().signal;
  global.fetch = async (url, init) => {
    requests.push({ url, ...init });
    assert.equal(init.method, 'GET');
    assert.deepEqual(init.headers, { 'X-Goog-Api-Key': 'test-key', 'X-Goog-FieldMask': 'id,allowsDogs,restroom,parkingOptions,googleMapsUri,reviews,websiteUri' });
    assert.equal(init.signal, signal);
    return fn(decodeURIComponent(url.split('/').at(-1)), requests.length);
  };
  try { await run({ signal, requests }); }
  finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldKey; }
}

test('top five per target, identity deduplication, first encounter order and global cap', async () => {
  assert.equal(ENRICH_PER_TARGET, 5); assert.equal(MAX_ENRICH_CANDIDATES, 20);
  const candidates = Array.from({ length: 35 }, (_, i) => candidate(String(i)));
  const pools = [pool(candidates.slice(0, 8)), pool([candidates[2], ...candidates.slice(8, 14)]), ...[14, 20, 26, 32].map(i => pool(candidates.slice(i, i + 6)))];
  const expected = [0,1,2,3,4,8,9,10,11,14,15,16,17,18,20,21,22,23,24,26].map(String);
  assert.deepEqual(selectCandidates(pools).map(c => c.provenance.placeId), expected);
  await provider(id => ok({ id }), async ({ signal, requests }) => {
    const result = await enrichTargetPools(pools, { signal });
    assert.equal(requests.length, 20);
    assert.deepEqual(requests.map(r => decodeURIComponent(r.url.split('/').at(-1))), expected);
    assert.equal(result.diagnostics.selected, 20); assert.equal(result.diagnostics.unchanged, 20);
  });
  assert.equal(selectCandidates([pool(candidates.slice(0, 2))]).length, 2);
});

test('empty pools make no calls or credential requirements', async () => {
  await provider(() => { throw Error('should not call'); }, async ({ requests }) => {
    const result = await enrichTargetPools([pool([])]);
    assert.deepEqual(requests, []);
    assert.ok(Object.values(result.diagnostics).every(count => count === 0));
  });
});

test('URL encodes provider identity and shares the exact request signal', async () => {
  await provider(id => ok({ id }), async ({ signal, requests }) => {
    await enrichCandidates([candidate('a/b ?#%')], { signal });
    assert.equal(requests[0].url, 'https://places.googleapis.com/v1/places/a%2Fb%20%3F%23%25');
  });
});

for (const value of [true, false, undefined, null, 'true', 0, {}, []]) {
  test(`boolean evidence is strict for ${JSON.stringify(value)}`, async () => {
    await provider(id => ok({ id, allowsDogs: value, restroom: value }), async ({ signal }) => {
      const { results } = await enrichCandidates([candidate('a')], { signal });
      for (const key of ['dogsAllowed', 'restrooms']) {
        const attribute = results[0].candidate.attributes[key];
        if (typeof value === 'boolean') {
          assert.equal(attribute.value, value); assert.equal(attribute.confidence, 'confirmed');
          assert.ok(attribute.evidence.startsWith('Google Places reports'));
        } else assert.deepEqual(attribute, unknown());
      }
      assert.equal(results[0].status, typeof value === 'boolean' ? 'enriched' : 'unchanged');
      for (const key of ['largeGrass', 'dogTraffic', 'fenced', 'lighting', 'dedicatedDogArea']) assert.deepEqual(results[0].candidate.attributes[key], unknown());
    });
  });
}

test('parking recognizes only explicit true supported options; false/empty/malformed remain unknown', async () => {
  const supported = ['freeParkingLot', 'paidParkingLot', 'freeStreetParking', 'paidStreetParking', 'valetParking', 'freeGarageParking', 'paidGarageParking'];
  for (const options of [undefined, {}, null, [], 'parking', { invented: true }, { freeParkingLot: 'true' }, Object.fromEntries(supported.map(k => [k, false])), ...supported.map(k => ({ [k]: true }))]) {
    await provider(id => ok({ id, parkingOptions: options }), async ({ signal }) => {
      const { results } = await enrichCandidates([candidate('a')], { signal });
      const attribute = results[0].candidate.attributes.parking;
      if (supported.some(k => options?.[k] === true)) assert.deepEqual(attribute, { value: true, confidence: 'confirmed', evidence: 'Google Places reports parking at this location.' });
      else assert.deepEqual(attribute, unknown());
    });
  }
});

test('dedicated category confirms true even without details; absence never confirms false', async () => {
  await provider(() => ({ ok: false, status: 404 }), async ({ signal }) => {
    const { results } = await enrichCandidates([candidate('a', { primaryType: 'dedicated-dog-area' }), candidate('b', { types: ['dedicated-dog-area'] }), candidate('c')], { signal });
    for (const result of results.slice(0, 2)) assert.deepEqual(result.candidate.attributes.dedicatedDogArea, { value: true, confidence: 'confirmed', evidence: 'Google Places categorizes this location as a dedicated dog area.' });
    assert.deepEqual(results[2].candidate.attributes.dedicatedDogArea, unknown());
    assert.ok(results.every(result => result.status === 'unchanged'));
  });
});

test('navigation accepts explicit Google Maps HTTPS URLs and rejects malformed or unrelated URLs', async () => {
  const valid = ['https://maps.google.com/?cid=123', 'https://www.google.com/maps/place/example', 'https://maps.app.goo.gl/example'];
  for (const uri of [...valid, undefined, null, {}, 'bad', 'javascript:alert(1)', 'http://maps.google.com/', 'https://evil.test/maps', 'https://maps.google.com.evil.test/', 'https://user:pass@maps.google.com/', ' https://maps.google.com/', 'https://www.google.com/search?q=park']) {
    await provider(id => ok({ id, googleMapsUri: uri }), async ({ signal }) => {
      const { results } = await enrichCandidates([candidate('a')], { signal });
      assert.deepEqual(results[0].candidate.navigation, valid.includes(uri) ? { googleMapsUrl: uri } : undefined);
    });
  }
});

test('enrichment updates every matching reference without mutating candidates, metrics, pools or ordering', async () => {
  const a = candidate('a'), b = candidate('b');
  const pools = [pool([a, b]), pool([a])];
  const before = structuredClone(pools);
  function freeze(value) { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item); }
  freeze(pools);
  await provider(id => ok({ id, allowsDogs: true, restroom: false, parkingOptions: { paidGarageParking: true }, googleMapsUri: 'https://maps.google.com/?cid=123', rating: 5, rawPrivate: 'secret' }), async ({ signal, requests }) => {
    const result = await enrichTargetPools(pools, { signal });
    assert.equal(requests.length, 2); assert.deepEqual(pools, before);
    assert.equal(result.pools[0].matches[0].candidate, result.pools[1].matches[0].candidate);
    for (let i = 0; i < pools.length; i++) for (let j = 0; j < pools[i].matches.length; j++) {
      const original = pools[i].matches[j], enriched = result.pools[i].matches[j];
      assert.deepEqual({ ...enriched, candidate: original.candidate }, original);
      assert.deepEqual(enriched.candidate.route, original.candidate.route);
      assert.deepEqual(enriched.candidate.provenance, original.candidate.provenance);
      assert.equal(enriched.candidate.name, original.candidate.name);
    }
    for (const forbidden of ['allowsDogs', 'restroom"', 'parkingOptions', 'googleMapsUri', 'rating', 'rawPrivate', 'matchScore', 'plannedFitScore']) assert.ok(!JSON.stringify(result).includes(forbidden));
    assert.deepEqual(result.diagnostics, { selected: 2, requested: 2, enriched: 2, unchanged: 0, dogsKnown: 2, restroomsKnown: 2, parkingKnown: 2, dedicatedKnown: 0, navKnown: 2, reviewDogsKnown: 0, reviewGrassKnown: 0, reviewTrafficKnown: 0, reviewFencedKnown: 0, reviewLightingKnown: 0, reviewDedicatedKnown: 0, websiteKnown: 0 });
  });
});

test('individual unusable details retain original evidence and structural candidates', async () => {
  for (const response of [ok(null), ok([]), ok({}), ok({ id: 'other', allowsDogs: true }), ok({ error: 'private body' }), { ok: false, status: 404 }, { ok: false, status: 410 }, { ok: true, status: 200, json: async () => { throw Error('private body'); } }]) {
    await provider(() => response, async ({ signal }) => {
      const original = candidate('a');
      const { results } = await enrichCandidates([original], { signal });
      assert.deepEqual(results, [{ candidate: original, status: 'unchanged' }]);
    });
  }
});

test('concurrency stays at five and results preserve selection order despite response timing', async () => {
  let active = 0, peak = 0;
  await provider(async id => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, id === '0' ? 20 : 1));
    active--; return ok({ id, allowsDogs: true });
  }, async ({ signal }) => {
    const candidates = Array.from({ length: 20 }, (_, i) => candidate(String(i)));
    const { results } = await enrichCandidates(candidates, { signal });
    assert.equal(peak, ENRICH_CONCURRENCY); assert.equal(active, 0);
    assert.deepEqual(results.map(r => r.candidate.id), candidates.map(c => c.id));
  });
});

test('throttling and infrastructure errors are sanitized and stop queued requests', async () => {
  for (const status of [429, 403, 500, 503]) {
    await provider(() => ({ ok: false, status }), async ({ signal, requests }) => {
      await assert.rejects(enrichCandidates(Array.from({ length: 20 }, (_, i) => candidate(String(i))), { signal }), error => error.code === (status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR') && error.message === error.code);
      assert.equal(requests.length, 5);
    });
  }
  await provider(() => { throw Error('private network error'); }, async ({ signal }) => {
    await assert.rejects(enrichCandidates([candidate('a')], { signal }), { message: 'PROVIDER_ERROR' });
  });
});

test('already aborted request starts no work; mid-request abort prevents queued work', async () => {
  const oldFetch = global.fetch, oldKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  try {
    let calls = 0;
    const controller = new AbortController(); controller.abort();
    global.fetch = () => { calls++; throw Error('private abort'); };
    await assert.rejects(enrichCandidates([candidate('a')], { signal: controller.signal }), { message: 'PROVIDER_ERROR' });
    assert.equal(calls, 0);
    const running = new AbortController();
    global.fetch = async () => { calls++; running.abort(); throw Error('private abort'); };
    await assert.rejects(enrichCandidates(Array.from({ length: 20 }, (_, i) => candidate(String(i))), { signal: running.signal }), { message: 'PROVIDER_ERROR' });
    assert.equal(calls, 1);
  } finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldKey; }
});

const reviews = (first, second = `${first}. On another visit.`) => [first,second].map(text => ({text:{text,languageCode:'en'},publishTime:new Date(Date.now()-86400000).toISOString(),authorAttribution:{displayName:'PRIVATE-REVIEWER'},rating:5}));
test('structured dog access and dedicated category always beat conflicting review consensus',async()=>{
  for(const allowsDogs of [true,false]){
    await provider(id=>ok({id,allowsDogs,reviews:reviews(allowsDogs?'dogs not allowed':'dogs allowed')}),async({signal})=>{
      const result=await enrichCandidates([candidate('a')],{signal});
      assert.equal(result.results[0].candidate.attributes.dogsAllowed.value,allowsDogs);
      assert.equal(result.results[0].candidate.attributes.dogsAllowed.confidence,'confirmed');
      assert.ok(!result.results[0].reviewAttributes?.includes('dogsAllowed'));
    });
  }
  await provider(id=>ok({id,reviews:reviews('no dog park')}),async({signal})=>{
    const c=candidate('a',{primaryType:'dedicated-dog-area'});
    const result=await enrichCandidates([c],{signal});
    assert.equal(result.results[0].candidate.attributes.dedicatedDogArea.confidence,'confirmed');
    assert.equal(result.results[0].candidate.attributes.dedicatedDogArea.value,true);
  });
});
test('review consensus yields six normalized inferred attributes and count-only diagnostics',async()=>{
  const body='dogs allowed, large grassy area, few dogs, fully fenced, well lit, dedicated dog area';
  await provider(id=>ok({id,reviews:reviews(`${body}. PRIVATE-REVIEW-FRAGMENT`),websiteUri:'https://example.org/park'}),async({signal,requests})=>{
    const result=await enrichTargetPools([pool([candidate('a')])],{signal});
    assert.equal(requests.length,1);
    const c=result.results[0].candidate;
    for(const key of ['dogsAllowed','largeGrass','dogTraffic','fenced','lighting','dedicatedDogArea']) assert.equal(c.attributes[key].confidence,'inferred');
    assert.equal(c.attributes.dogTraffic.value,'low');assert.deepEqual(c.verification,{placeWebsiteUrl:'https://example.org/park'});
    for(const key of ['reviewDogsKnown','reviewGrassKnown','reviewTrafficKnown','reviewFencedKnown','reviewLightingKnown','reviewDedicatedKnown','websiteKnown']) assert.equal(result.diagnostics[key],1);
    assert.ok(Object.values(result.diagnostics).every(Number.isInteger));
    for(const forbidden of ['PRIVATE-REVIEW-FRAGMENT','PRIVATE-REVIEWER','rating','publishTime','languageCode','"reviews":']) assert.ok(!JSON.stringify(result).includes(forbidden));
  });
});
test('website validation is HTTPS-only and never supplies dog evidence or additional requests',async()=>{
  const valid=['https://example.org/park?ref=maps','https://example.org:8443/'];
  for(const websiteUri of [...valid,undefined,null,{},'bad','http://example.org','javascript:alert(1)','https://user:pass@example.org',' https://example.org','https://example.org/a b','https://example.org/\\evil','https://example.org/\n','https://example.org/'+ 'x'.repeat(2049)]){
    await provider(id=>ok({id,websiteUri}),async({signal,requests})=>{
      const c=(await enrichCandidates([candidate('a')],{signal})).results[0].candidate;
      assert.deepEqual(c.verification,valid.includes(websiteUri)?{placeWebsiteUrl:websiteUri}:undefined);
      assert.deepEqual(c.attributes.dogsAllowed,unknown());assert.equal(requests.length,1);
    });
  }
});
test('mismatched provider identity never supplies reviews or website',async()=>{
  await provider(()=>ok({id:'other',reviews:reviews('dogs allowed'),websiteUri:'https://example.org'}),async({signal})=>{
    const c=(await enrichCandidates([candidate('a')],{signal})).results[0].candidate;
    assert.deepEqual(c.attributes.dogsAllowed,unknown());assert.equal(c.verification,undefined);
  });
});
test('review evidence naturally changes Phase 2G score ceilings, coverage, eligibility and selection',async()=>{
  const {scoreStop,scoreTargetPools}=require('../lib/scoring');const {selectStops}=require('../lib/selection');
  const preferences={largeGrass:true,restrooms:true,minimalDetours:true};
  const options={preferences,lifeStage:'adult',maxDetourMinutes:10};
  const base=candidate('a');base.route.detourMinutes=0;base.attributes.restrooms={value:true,confidence:'confirmed'};
  const pair=c=>({...pool([c]).matches[0],timingPenalty:0,maxDetourPenalty:0});
  const before=scoreStop(base,pair(base),options);assert.equal(before.pawstop.matchScore,79);
  await provider(id=>ok({id,reviews:reviews('dogs allowed. large grassy area')}),async({signal})=>{
    const c=(await enrichCandidates([base],{signal})).results[0].candidate;
    const after=scoreStop(c,pair(c),options);
    assert.equal(after.pawstop.matchScore,89);assert.equal(after.pawstop.evidenceCoverage,83);assert.equal(after.pawstop.evidenceStrength,'strong');
    const pools=[{targetMinutes:150,matches:[pair(base),pair(c)]}];
    const chosen=selectStops(scoreTargetPools(pools,options),options).recommendations[0].stop;
    assert.equal(chosen.pawstop.matchScore,89);assert.equal(chosen.attributes.dogsAllowed.confidence,'inferred');
  });
  await provider(id=>ok({id,reviews:reviews('no dogs')}),async({signal})=>{
    const c=(await enrichCandidates([base],{signal})).results[0].candidate;
    assert.equal(scoreStop(c,pair(c),options).eligible,false);
    assert.equal(selectStops(scoreTargetPools([{targetMinutes:150,matches:[pair(c)]}],options),options).recommendations[0].stop,null);
  });
  await provider(id=>ok({id,reviews:[...reviews('dogs allowed'),...reviews('no dogs')]}),async({signal})=>{
    const c=(await enrichCandidates([base],{signal})).results[0].candidate;
    assert.deepEqual(c.attributes.dogsAllowed,unknown());assert.equal(scoreStop(c,pair(c),options).pawstop.matchScore,79);
  });
  await provider(id=>ok({id,allowsDogs:true,reviews:reviews('no dogs')}),async({signal})=>{
    const c=(await enrichCandidates([base],{signal})).results[0].candidate;
    const expected={...base,attributes:{...base.attributes,dogsAllowed:{value:true,confidence:'confirmed',evidence:'Google Places reports that dogs are allowed.'}}};
    assert.deepEqual(scoreStop(c,pair(c),options),scoreStop(expected,pair(expected),options));
  });
});
