// Pure planning over normalized candidates. Pools are internal, not final selections.
function matchTargets({ candidates, breakTargetsMinutes, breakCadenceMinutes, maxDetourMinutes }) {
  const routed = candidates.filter(candidate => candidate?.route
    && Number.isFinite(candidate.route.tripMinutes) && candidate.route.tripMinutes > 0
    && Number.isFinite(candidate.route.detourMinutes) && candidate.route.detourMinutes >= 0);
  const diagnostics = {
    targets: breakTargetsMinutes.length, routed: routed.length, pairs: 0,
    coveredTargets: 0, gaps: 0, overDetour: 0, close: 0, early: 0, late: 0
  };
  const windowMinutes = breakCadenceMinutes / 2;
  // Preserve target order and empty pools for later unique, chronological selection.
  const pools = breakTargetsMinutes.map(targetMinutes => {
    const matches = [];
    for (const candidate of routed) {
      const deltaMinutes = candidate.route.tripMinutes - targetMinutes;
      if (Math.abs(deltaMinutes) > windowMinutes) continue;
      const close = Math.abs(deltaMinutes) <= 15;
      const timingPenalty = Math.max(0, Math.abs(deltaMinutes) - 15) * (deltaMinutes < 0 ? 0.20 : 0.75);
      const timingLabel = close ? 'Close to planned break'
        : `${Math.round(Math.abs(deltaMinutes))} min ${deltaMinutes < 0 ? 'before' : 'after'} planned break`;
      const excessMinutes = candidate.route.detourMinutes - maxDetourMinutes;
      const maxDetourPenalty = excessMinutes > 0 ? 10 + 6 * excessMinutes : 0;
      matches.push({ candidate, targetMinutes, deltaMinutes, timingPenalty, timingLabel, maxDetourPenalty });
      diagnostics.pairs++;
      if (excessMinutes > 0) diagnostics.overDetour++;
      diagnostics[close ? 'close' : deltaMinutes < 0 ? 'early' : 'late']++;
    }
    matches.sort((a, b) => Math.abs(a.deltaMinutes) - Math.abs(b.deltaMinutes)
      || a.candidate.route.detourMinutes - b.candidate.route.detourMinutes
      || a.candidate.route.tripMinutes - b.candidate.route.tripMinutes
      // Code-unit order is stable across server locales; identity is normalized Pawstop id.
      || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0));
    if (matches.length) diagnostics.coveredTargets++;
    else diagnostics.gaps++;
    return { targetMinutes, matches };
  });
  return { pools, diagnostics };
}

module.exports = { matchTargets };
