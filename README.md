# Pawstop V2.1 prototype

Pawstop is a dog-first road-trip stop intelligence concept.

## What's new in V2.1

- Cadence-aware, chronological route planning on the approximately 780-minute Jersey City → Chicago demo trip. Numeric `tripMinutes` represent elapsed trip time; the separate `minutes` value is a demo urgent-stop time ahead.
- Break targets repeat at the selected cadence before arrival: 2.5 hours produces 150, 300, 450, 600, and 750 minutes.
- Each target selects an unused stop within half a cadence, in chronological order. Selection combines preference match (70%) and timing fit (30%), so timing does not completely override quality. Missing candidates appear as explicit coverage gaps.
- Matching preserves large grass, low dog traffic, restrooms, minimal detours, fenced space, lighting, and avoiding dedicated dog-relief areas. Exceeding the selected max detour costs ten match points plus six per excess minute, even when minimal detours is not selected.
- Life stage adds soft planning signals: puppies slightly favor lower expected dog traffic, adults are neutral, and seniors slightly favor lower detours. These are product preferences, not veterinary or medical advice.
- Route cards show planned break targets, actual estimated timing, early/close/after timing (within 15 minutes counts as close), estimated detours, and Pawstop match.
- Urgency-specific ranking: 15 minutes strongly favors time ahead and detour; 30 minutes balances urgency and fit; 60 minutes favors overall quality. In-window stops are considered first. If none qualify, the soonest option is shown with an outside-window warning.
- Best match uses the selected urgency ranking. Fastest, Largest grass, and Restrooms compare eligible alternatives; when none are in-window, alternatives compare the demo pool and retain the warning.
- Google Maps navigation, provenance/source links, confidence indicators, and demo Pawstop community reports remain available in the mobile-first interface.

## Current prototype limitations

The prototype uses a small curated Jersey City → Chicago corridor even if the origin and destination fields are edited. Route times, detours, dog traffic, grass condition, cleanliness, closures, and community observations are curated/demo data rather than live data. Urgent time-ahead estimates are a separate simulated snapshot, not GPS tracking or values derived from the full-route timeline; they include the demo approach to the stop, with detour displayed separately.

Cadence targets do not include break duration, traffic, or time-zone adjustments. Sparse candidate coverage can leave gaps, and chronological selection is a heuristic rather than a globally optimized itinerary. Match percentages are preference scores, not probabilities or safety guarantees. Max detour is a strong scoring penalty rather than a hard exclusion. Verify pet access, hours, fees, and current conditions using the linked sources. Pawstop does not assess medical safety.

## Validation

Run `node --check app.js` for a JavaScript syntax check. Exercise the planner with each cadence, life stage, and detour setting; check chronological cards and gaps; test all urgency windows, alternatives, navigation handoffs, and source disclosures.

## Path toward the app

Replace curated route and stop inputs with live routing and place discovery while preserving cadence-aware planning, transparent matching, and explicit data provenance.
