const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchTargets } = require('../lib/target-matching');
const candidate = (id, tripMinutes, detourMinutes = 5) => ({ id, route: { tripMinutes, detourMinutes } });
const match = (candidates, options = {}) => matchTargets({ candidates, breakTargetsMinutes: [150], breakCadenceMinutes: 150, maxDetourMinutes: 10, ...options });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

for (const [delta, penalty, label] of [
  [0, 0, 'Close to planned break'], [-15, 0, 'Close to planned break'], [15, 0, 'Close to planned break'],
  [-15.1, 0.02, '15 min before planned break'], [15.1, 0.075, '15 min after planned break'],
  [-30, 3, '30 min before planned break'], [30, 11.25, '30 min after planned break'],
  [-30.75, 3.15, '31 min before planned break'], [30.75, 11.8125, '31 min after planned break']
]) {
  test(`delta ${delta} preserves signed timing, penalty and display label`, () => {
    const result = match([candidate('a', 150 + delta)]);
    const pair = result.pools[0].matches[0];
    assert.equal(pair.deltaMinutes, (150 + delta) - 150);
    near(pair.deltaMinutes, delta); near(pair.timingPenalty, penalty);
    assert.equal(pair.timingLabel, label);
    assert.equal(result.diagnostics.pairs, 1);
    assert.equal(result.diagnostics[Math.abs(delta) <= 15 ? 'close' : delta < 0 ? 'early' : 'late'], 1);
  });
}

for (const [detour, expected] of [[9, 0], [10, 0], [11, 16], [12, 22], [12.125, 22.75]]) {
  test(`detour ${detour} stays eligible with penalty ${expected}`, () => {
    const pair = match([candidate('a', 150, detour)]).pools[0].matches[0];
    assert.equal(pair.maxDetourPenalty, expected);
    assert.equal(pair.candidate.route.detourMinutes, detour);
  });
}

test('inclusive half-cadence boundaries reject immediately outside candidates, including fractional cadence', () => {
  for (const cadence of [150, 150.5]) {
    const half = cadence / 2;
    const found = match([
      candidate('early', 150 - half), candidate('late', 150 + half),
      candidate('too-early', 150 - half - 0.000001), candidate('too-late', 150 + half + 0.000001)
    ], { breakCadenceMinutes: cadence });
    assert.deepEqual(found.pools[0].matches.map(m => m.candidate.id), ['early', 'late']);
  }
});

test('unavailable and invalid normalized metrics are ineligible', () => {
  const invalid = [null, { id: 'a', route: null }, { id: 'b' }, candidate('c', NaN), candidate('d', Infinity), candidate('e', -1), candidate('f', 0), candidate('g', '150'), candidate('h', 150, -1), candidate('i', 150, NaN), candidate('j', 150, Infinity), candidate('k', 150, '5')];
  const result = match(invalid);
  assert.deepEqual(result.pools, [{ targetMinutes: 150, matches: [] }]);
  assert.deepEqual(result.diagnostics, { targets: 1, routed: 0, pairs: 0, coveredTargets: 0, gaps: 1, overDetour: 0, close: 0, early: 0, late: 0 });
});

test('pools retain shared candidates and coverage gaps without assignment or mutation', () => {
  const shared = Object.freeze({ id: 'shared', route: Object.freeze({ tripMinutes: 225, detourMinutes: 12 }) });
  const candidates = Object.freeze([shared]);
  const targets = Object.freeze([150, 300, 450]);
  const result = match(candidates, { breakTargetsMinutes: targets });
  assert.deepEqual(result.pools.map(p => p.matches.length), [1, 1, 0]);
  assert.equal(result.pools[0].matches[0].candidate, shared);
  assert.equal(result.pools[1].matches[0].candidate, shared);
  assert.deepEqual(result.pools.map(p => p.targetMinutes), targets);
  assert.deepEqual(Object.keys(shared.route), ['tripMinutes', 'detourMinutes']);
  for (const pool of result.pools.slice(0, 2)) {
    assert.deepEqual(Object.keys(pool.matches[0]), ['candidate', 'targetMinutes', 'deltaMinutes', 'timingPenalty', 'timingLabel', 'maxDetourPenalty']);
  }
  assert.deepEqual(result.diagnostics, { targets: 3, routed: 1, pairs: 2, coveredTargets: 2, gaps: 1, overDetour: 2, close: 0, early: 1, late: 1 });
  assert.ok(!JSON.stringify(result).includes('matchScore'));
  assert.ok(!JSON.stringify(result).includes('plannedFitScore'));
});

test('pre-scoring order uses absolute delta, detour, trip minutes, then identity independent of input order', () => {
  const candidates = [candidate('z', 150, 100), candidate('b', 130, 2), candidate('a', 130, 2), candidate('late', 170, 2), candidate('low-detour', 180, 0), candidate('high-detour', 130, 3)];
  const expected = ['z', 'a', 'b', 'late', 'high-detour', 'low-detour'];
  for (const ordered of [candidates, [...candidates].reverse(), [...candidates.slice(2), ...candidates.slice(0, 2)]]) {
    const before = structuredClone(ordered);
    assert.deepEqual(match(ordered).pools[0].matches.map(m => m.candidate.id), expected);
    assert.deepEqual(ordered, before);
  }
});

test('empty candidate and target lists preserve internal gaps and zero counts', () => {
  assert.equal(match([]).diagnostics.gaps, 1);
  const result = match([], { breakTargetsMinutes: [] });
  assert.deepEqual(result.pools, []);
  assert.ok(Object.values(result.diagnostics).every(count => count === 0));
});
