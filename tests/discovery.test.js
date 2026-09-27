const { test } = require('node:test');
const assert = require('node:assert/strict');
const { discoverCandidates } = require('../lib/google-discovery');
const place = (id, extra = {}) => ({ id, displayName: { text: `Place ${id}` }, location: { latitude: 40, longitude: -74 }, ...extra });
async function withProvider(provider, run) {
  const oldFetch = global.fetch, oldKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-only-placeholder';
  const requests = [];
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
    const body = JSON.parse(init.body);
    requests.push(body);
    assert.equal(init.headers['X-Goog-FieldMask'], 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,routingSummaries');
    assert.equal(init.method, 'POST');
    assert.equal(body.pageSize, 20);
    assert.deepEqual(body.routingParameters, { travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    return provider(body);
  };
  try { await run(requests); }
  finally { global.fetch = oldFetch; if (oldKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = oldKey; }
}
const success = places => ({ ok: true, status: 200, json: async () => ({ places }) });

test('four narrow route searches deduplicate IDs and expose only normalized internal candidates', async () => {
  const pools = {
    park: [place('shared', { formattedAddress: '123 Main St', primaryType: 'park', types: ['park', 'point_of_interest'] }), place('park-only')],
    'recreation area': [place('shared'), place('recreation', { primaryType: 'recreation_center', types: ['recreation_center'] })],
    'picnic area': [place('picnic', { primaryType: 'picnic_ground', types: ['picnic_ground'] })],
    'rest area': [place('rest', { primaryType: 'rest_stop', types: ['rest_stop'] }), place('shared')]
  };
  await withProvider(body => success(pools[body.textQuery]), async requests => {
    const { candidates, diagnostics } = await discoverCandidates('route-a');
    assert.deepEqual(requests.map(r => r.textQuery), ['park', 'recreation area', 'picnic area', 'rest area']);
    assert.ok(requests.every(r => r.searchAlongRouteParameters.polyline.encodedPolyline === 'route-a'));
    assert.deepEqual({ ...diagnostics, routing: undefined }, { routing: undefined, candidateCount: 5, receivedCount: 7, rejectedCount: 0, duplicateCount: 2 });
    assert.equal(new Set(candidates.map(c => c.id)).size, 5);
    assert.equal(candidates[0].name, 'Place shared');
    assert.equal(candidates[0].address, '123 Main St');
    assert.equal(candidates[0].lat, 40); assert.equal(candidates[0].lng, -74);
    assert.deepEqual(candidates.map(c => c.primaryType), ['park', null, 'recreation-area', 'picnic-area', 'rest-area']);
    assert.deepEqual(candidates[0].types, ['park']);
    for (const c of candidates) {
      assert.deepEqual(Object.keys(c), ['id', 'name', 'address', 'lat', 'lng', 'primaryType', 'types', 'attributes', 'provenance', 'route']);
      for (const attribute of Object.values(c.attributes)) assert.deepEqual(attribute, { value: null, confidence: 'unknown' });
      const serialized = JSON.stringify(c);
      for (const forbidden of ['displayName', 'formattedAddress', 'location', 'latitude', 'longitude', 'tripMinutes', 'detourMinutes', 'plannedFitScore', 'test-only-placeholder']) assert.ok(!serialized.includes(forbidden));
    }
  });
});

test('malformed candidates are discarded before deduplication; optional fields remain unknown', async () => {
  const invalid = [null, {}, place(''), place('bad id'), place('bad-name', { displayName: { text: ' ' } }), place('string-lat', { location: { latitude: '40', longitude: -74 } }), place('null-lat', { location: { latitude: null, longitude: -74 } }), place('no-location', { location: null }), place('range', { location: { latitude: 91, longitude: 0 } }), place('range-lng', { location: { latitude: 0, longitude: -181 } }), place('infinite', { location: { latitude: Infinity, longitude: 0 } }), place('recover', { displayName: null })];
  await withProvider(body => success(body.textQuery === 'park' ? [...invalid, place('recover'), place('zero', { location: { latitude: 0, longitude: 0 }, primaryType: 'unknown_provider_category', types: ['unknown_provider_category'], formattedAddress: '' })] : []), async () => {
    const { candidates, diagnostics } = await discoverCandidates('route-a');
    assert.equal(diagnostics.rejectedCount, invalid.length); assert.equal(diagnostics.candidateCount, 2);
    for (const candidate of candidates) {
      assert.equal(candidate.address, null); assert.equal(candidate.primaryType, null); assert.equal(candidate.types, null);
      assert.ok(Object.values(candidate.attributes).every(a => a.value === null && a.confidence === 'unknown'));
    }
  });
});

test('route changes reach all searches and yield different candidate sets without cross-request state', async () => {
  await withProvider(body => success([place(body.searchAlongRouteParameters.polyline.encodedPolyline)]), async () => {
    const a = await discoverCandidates('route-a');
    const b = await discoverCandidates('route-b');
    const again = await discoverCandidates('route-a');
    assert.notDeepEqual(a.candidates.map(c => c.id), b.candidates.map(c => c.id));
    assert.deepEqual(a, again);
    assert.equal(a.diagnostics.candidateCount, 1); assert.equal(a.diagnostics.duplicateCount, 3);
  });
});

test('empty and entirely unusable pools succeed without fabricated candidates', async () => {
  for (const result of [{}, { places: [] }, { places: [null, {}] }]) {
    await withProvider(() => ({ ok: true, status: 200, json: async () => result }), async () => {
      const found = await discoverCandidates('route-a');
      assert.deepEqual(found.candidates, []); assert.equal(found.diagnostics.candidateCount, 0);
    });
  }
});

test('one failed search rejects the pool and never leaks raw provider failures', async () => {
  for (const failure of [
    () => { throw Error('private provider diagnostic'); },
    () => ({ ok: false, status: 403 }),
    () => ({ ok: true, status: 200, json: async () => { throw Error('private provider body'); } }),
    () => ({ ok: true, status: 200, json: async () => ({ places: null }) }),
    () => ({ ok: true, status: 200, json: async () => ({ error: 'private provider body' }) })
  ]) {
    await withProvider(body => body.textQuery === 'rest area' ? failure() : success([place('valid')]), async () => {
      await assert.rejects(discoverCandidates('route-a'), error => error.code === 'PROVIDER_ERROR' && error.message === 'PROVIDER_ERROR');
    });
  }
  await withProvider(() => ({ ok: false, status: 429 }), async () => {
    await assert.rejects(discoverCandidates('route-a'), error => error.code === 'RATE_LIMITED' && error.message === 'RATE_LIMITED');
  });
});

const summary = (first = '662.5s', second = '600s') => ({ legs: [{ duration: first }, { duration: second }] });
const payload = data => ({ ok: true, status: 200, json: async () => data });
test('pairs by original index, retains precision and prefers later routed duplicates deterministically', async () => {
  await withProvider(async body => {
    if (body.textQuery === 'park') {
      await new Promise(resolve => setTimeout(resolve, 10));
      return payload({ places: [null, place('a'), place('b'), place('c')], routingSummaries: [summary('1s', '1s'), {}, summary(), summary('700s', '600s')] });
    }
    if (body.textQuery === 'recreation area') return payload({ places: [place('a', { displayName: { text: 'Replacement' } }), place('b')], routingSummaries: [summary('800s', '600s'), summary('900s', '600s')] });
    return success([]);
  }, async () => {
    const { candidates, diagnostics } = await discoverCandidates('route-a', { baselineRouteDurationMinutes: 20 });
    assert.deepEqual(candidates.map(c => c.provenance.placeId), ['a', 'b', 'c']);
    assert.equal(candidates[0].name, 'Replacement');
    assert.deepEqual(candidates[1].route, { tripMinutes: 662.5 / 60, detourMinutes: 1262.5 / 60 - 20 });
    assert.deepEqual(diagnostics.routing, { routedCount: 3, missingCount: 0, inconsistentCount: 0, tripMin: 662.5 / 60, tripMax: 800 / 60, detourMin: 1262.5 / 60 - 20, detourMax: 1400 / 60 - 20 });
    for (const c of candidates) {
      assert.deepEqual(Object.keys(c.route), ['tripMinutes', 'detourMinutes']);
      for (const field of ['routingSummaries', 'legs', 'duration', 'distanceMeters', 'targetMinutes', 'deltaMinutes', 'timingLabel', 'matchScore', 'plannedFitScore']) assert.ok(!JSON.stringify(c).includes(`"${field}"`));
    }
  });
});

test('missing, malformed and implausible summaries retain structural candidates with null routes', async () => {
  const invalidDurations = [undefined, null, 662, '', '662', ' 662s', '662s\n', '-1s', '0s', 'NaNs', 'Infinitys', '1e3s', '.5s', '1.s', '1.1234567890s', '2592001s', `${'9'.repeat(400)}s`];
  const invalid = [undefined, null, [], {}, { legs: [] }, { legs: {} }, { legs: [null, {}] }, { legs: [{ duration: '600s' }] }, { legs: [...summary().legs, { duration: '1s' }] }, summary('2592000s', '1s'), ...invalidDurations.flatMap(value => [{ legs: [{ duration: value }, { duration: '600s' }] }, { legs: [{ duration: '600s' }, { duration: value }] }])];
  for (const value of invalid) {
    await withProvider(body => body.textQuery === 'park' ? payload({ places: [place('a')], routingSummaries: [value] }) : success([]), async () => {
      const { candidates, diagnostics } = await discoverCandidates('route-a', { baselineRouteDurationMinutes: 20 });
      assert.equal(candidates.length, 1); assert.equal(candidates[0].route, null);
      assert.equal(diagnostics.routing.missingCount, 1); assert.equal(diagnostics.routing.tripMin, null);
    });
  }
  for (const routingSummaries of [undefined, [], {}, 'bad']) {
    await withProvider(() => payload({ places: [place('a')], routingSummaries }), async () => {
      const found = await discoverCandidates('route-a', { baselineRouteDurationMinutes: 20 });
      assert.equal(found.candidates[0].route, null); assert.equal(found.diagnostics.routing.missingCount, 1);
    });
  }
});

test('negative detours are separately inconsistent; zero detour is valid', async () => {
  await withProvider(body => body.textQuery === 'park' ? payload({ places: [place('negative'), place('zero')], routingSummaries: [summary('599s', '600s'), summary('600s', '600s')] }) : success([]), async () => {
    const found = await discoverCandidates('route-a', { baselineRouteDurationMinutes: 20 });
    assert.equal(found.candidates[0].route, null);
    assert.deepEqual(found.candidates[1].route, { tripMinutes: 10, detourMinutes: 0 });
    assert.equal(found.diagnostics.routing.inconsistentCount, 1);
    assert.equal(found.diagnostics.routing.missingCount, 0);
  });
});
