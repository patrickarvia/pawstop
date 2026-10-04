# Pawstop V2.2 Phase 2H

Pawstop is a dog-first road-trip stop planning prototype built with plain HTML, CSS, and JavaScript. Architecture: [V2.2 API contract](docs/v2.2-api-contract.md).

## Current behavior

`POST /api/plan-route` now returns real normalized stops selected from the computed route. The success envelope remains `{ route, breakTargetsMinutes, recommendations }`. Each target has `{ targetMinutes, stop }`, where `stop` is a normalized real stop or `null` for a coverage gap. Partial coverage is HTTP 200. When targets exist but no stop can be selected, HTTP 422 returns `NO_STOP_CANDIDATES` with “We couldn't find a suitable Pawstop along this route.” Zero-target routes still succeed with empty targets/recommendations and skip discovery, enrichment, and selection.

The frontend now renders real itinerary recommendations directly from the normalized public API response: stop identity, optional place type/address, route timing, PawStop match score, backend explanations, supported amenity tags, dog-access evidence, and the returned navigation link. Inferred attributes are labeled; unknown dog access stays visibly unconfirmed. Match is a product score, not a probability. Missing navigation has an unavailable state. Explicit gaps and the short-route “no planned breaks before arrival” state remain intentional successful outcomes. Phase 2G calibrates scores with evidence ceilings; selection uses calibrated planned fit with its existing quality floor and ordering. Cards show a secondary evidence-strength badge alongside the match score. The premium outdoor design and separate curated urgent-stop demo remain intact; live urgent geolocation is future V2.2.1 work.

Routes use `DRIVE` and `TRAFFIC_UNAWARE`, returning `trafficAware: false`. Targets are positive cadence multiples strictly before arrival and exclude dwell time and cumulative detours. Four one-page along-route searches (park, recreation area, picnic area, rest area; up to 20 results each) discover and deduplicate structural candidates. Phase 2B derives trip minutes from the first routing-summary leg and detour from total leg duration minus the baseline. Unusable summaries and negative detours keep structural candidates with unavailable metrics. Phase 2C uses the inclusive half-cadence window and calculates signed delta, timing label, asymmetric timing penalty, and max-detour penalty without changing candidate route metrics.

Phase 2D still enriches only the first five matches per target in deterministic pre-scoring order, deduplicated in first encounter order, capped at 20 candidates with five concurrent requests. Phase 2H expands the explicit Details mask to `id,allowsDogs,restroom,parkingOptions,googleMapsUri,reviews,websiteUri`. Routing, discovery, and enrichment share the same 15-second timeout signal. Explicit dog/restroom booleans become confirmed true or false; supported true parking options confirm parking. Dedicated-dog-area category evidence confirms true, never false from absence. Omitted fields remain unknown. Large grass, dog traffic, fencing, and lighting remain unknown without qualifying evidence. Valid navigation is preserved; unavailable navigation is null. Individual unavailable/unusable details retain candidates, while throttling and infrastructure failures remain sanitized.

## Phase 2H supplemental place evidence

Structured provider evidence remains confirmed and authoritative. Recent Google Maps review consensus can supplement dog access, substantial grass/open-field space, dog-specific low/high traffic, fencing, lighting, and dedicated dog areas with **inferred** evidence only. It never overrides confirmed true or false. Restrooms and parking still rely on structured fields. No website is fetched or scraped; there are no AI summaries, new services, or additional provider passes. Phase 2G scoring and ceilings are unchanged; inferred weights naturally affect coverage, fit, dog-denial exclusion, ordering, and gaps.

The deterministic parser processes at most the first five returned reviews, rejecting text over 5,000 characters, empty/control-character text, unsupported or missing language codes (only English `en`/regional English), malformed calendar timestamps, future timestamps, and publication older than 36 calendar months. The cutoff is inclusive and uses UTC; leap-day subtraction clamps to the last valid day. Reviews must contain explicit attribute-specific permission or physical descriptions. Generic dog sightings, park/grass mentions, generic quiet/crowded descriptions, and night visits do not qualify. Negation is handled before overlapping positive phrases; questions and hypothetical wording are conservatively ignored.

Inference requires at least two distinct qualifying review bodies supporting the same conclusion and zero opposing signals in qualifying reviews. Duplicate normalized text, review identifiers, or known reviewer identities cannot establish independent consensus. Conflict or silence leaves an attribute unknown unless confirmed structured evidence exists. Dog permission, grass, fencing, and lighting may infer true or false; dog traffic may infer low/high only; dedicated area review evidence may infer true only, never false from absence. Evidence strings are fixed PawStop-authored statements, never review quotations.

Raw review bodies and metadata are processed transiently on the server: they are not persisted, returned, interpolated into HTML/errors, or logged. The public response exposes only normalized attribute evidence and optional `verification: { placeWebsiteUrl }` (otherwise `null`). The website must be HTTPS, credential-free, well formed, whitespace/backslash-free, and at most 2,048 characters. The browser labels it “Place website ↗” for optional user verification; its presence confirms no attribute or policy. Navigation remains separate.

The enrichment budget remains five per target, twenty unique candidates total, and concurrency five with the original shared timeout. Preview/development Phase 2D diagnostics add only `reviewDogsKnown`, `reviewGrassKnown`, `reviewTrafficKnown`, `reviewFencedKnown`, `reviewLightingKnown`, `reviewDedicatedKnown`, and `websiteKnown` counts. Review counters count attributes actually accepted from review consensus, excluding confirmed-field overrides. Production remains silent.

Google lists existing `allowsDogs`, `restroom`, and `parkingOptions`, and newly requested `reviews`, under Place Details Enterprise + Atmosphere; `websiteUri` is Enterprise. This adds response data within the existing requests and can affect payload size and latency; no exact dollar cost is claimed. See [Google’s field and SKU reference](https://developers.google.com/maps/documentation/places/web-service/data-fields) and [Place resource/review schema](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places). The mask excludes summaries, photos, ratings, and unrelated fields; nested review ratings/attribution returned within `reviews` are ignored and discarded.

## Evidence-aware scoring and selection

`scoreStop(candidate, targetMatch, { preferences, lifeStage, maxDetourMinutes })` in `lib/scoring.js` returns `{ eligible, pawstop: { matchScore, plannedFitScore, evidenceCoverage, evidenceStrength, why } }`. `scoreTargetPools` scores every match without mutation, including candidates outside the enrichment budget. Scoring uses normalized Pawstop evidence only.

Unknown evidence is neither positive nor negative: it contributes zero earned and possible points. Confirmed evidence has weight 1; inferred evidence has weight 0.5. Enabled boolean preferences contribute `5 × weight` possible points, with the same earned points for true and zero for false. Low/medium/high dog traffic contributes 5/3/1 earned points times confidence weight. Avoiding dedicated areas rewards evidenced false and earns zero for evidenced true; unknown absence earns nothing. Parking and dog permission add no preference points.

When minimal detours is enabled, it contributes five possible points and `max(0, 5 - detourMinutes / max(maxDetourMinutes, 1) × 3)` earned points. Raw preference score is earned / possible, or the neutral 0.70 fallback with no scoreable evidence. Max detour remains a preference, not a hard exclusion: the exact Phase 2C penalty is zero within the maximum, otherwise `10 + 6 × excessMinutes`, even when minimal detours is disabled.

Puppy soft signals use known low/medium/high traffic for +3/0/−3 at confirmed confidence and half that influence for inferred evidence; unknown contributes zero. Adults are neutral. Seniors use `max(-3, 3 - detourMinutes / 2)`. These are product preferences, not medical claims. `existingScore = clamp(round(rawPreferenceScore × 100 + lifeStageBonus - maxDetourPenalty), 0, 98)` is a product score, not a probability. `matchScore = min(existingScore, dogAccessCeiling, evidenceCoverageCeiling)`. `plannedFitScore = matchScore - timingPenalty` retains fractional precision and may be negative. The existing timing penalty remains zero within ±15 minutes, then 0.20 per excess early minute or 0.75 per excess late minute.

### Phase 2G evidence calibration

Match measures how well a stop fits selected PawStop criteria, bounded by available evidence. Evidence strength measures how much supporting information exists for those enabled preferences. Neither is probability, safety confidence, a guarantee, or a live-condition assessment. Unknown remains distinct from false: it contributes no fit points or fit denominator, and never becomes a negative value. Sparse information limits the score ceiling rather than subtracting points.

Dog access independently limits match: confirmed true permits 98, inferred true permits 89, and unknown or unsupported permission permits 79 while remaining eligible. Confirmed/inferred false remains ineligible.

Coverage uses only enabled large-grass, low-dog-traffic, restroom, minimal-detour, fenced-space, good-lighting, and avoid-dedicated-area signals. Supported confirmed values count 1, inferred values 0.5, and unknown/unsupported values 0. Both known true and known false count as evidence; valid low/medium/high traffic values count likewise. Minimal detours counts 1 because the normalized real detour metric is known. Parking and dog permission do not enter preference coverage.

| Unrounded coverage | Match ceiling | Evidence strength |
| --- | --- | --- |
| ≥ 75% | 98 | `strong` |
| ≥ 50%, < 75% | 89 | `moderate` |
| ≥ 25%, < 50% | 79 | `limited` |
| < 25% | 69 | `very_limited` |

Public `pawstop.evidenceCoverage` is the coverage ratio rounded to an integer percentage; thresholds use the unrounded ratio. With no enabled preferences, coverage and strength are both `null`, the coverage ceiling is 98, and existing neutral scoring/soft signals remain; the dog-access ceiling still applies. Ceilings never raise a lower existing score. The unchanged timing penalty applies once after calibration. Selection retains `MIN_PLANNED_FIT_SCORE = 60`, so calibration can truthfully create more gaps. Public projection exposes the two new evidence fields, without raw scores, ceiling values, earned points, or denominators. Backend Why explanations and dog-access caveats are preserved.

Confirmed or inferred `dogsAllowed=false` excludes a candidate from recommendations. Unknown dog access stays eligible and is explicitly described as unconfirmed, never safe by assumption. Explanations use existing evidence, label inferred evidence, and describe real detour/timing; unsupported preference matches are never claimed.

`selectStops(scoredPools, { maxDetourMinutes })` ranks eligible matches by planned fit descending, absolute delta, detour, trip minutes, then stable identity. Final recommendations require `plannedFitScore >= 60` (`MIN_PLANNED_FIT_SCORE`). All otherwise eligible matches are still scored and ranked; matches below the floor become explicit gaps rather than forced recommendations when no qualifying candidate remains. Partial coverage remains HTTP 200; zero selected stops with targets returns `NO_STOP_CANDIDATES`. It processes ascending targets greedily, skips already-used IDs and non-increasing trip positions, and selects the first remaining match or an explicit gap. A gap does not prevent later selections. Stops are unique and strictly chronological. Public stops explicitly project identity/location, target-specific route values, Pawstop scores/explanations, eight normalized attributes, navigation or null, and provenance. Raw provider data, pool state, internal penalties, and scoring denominators stay private.

Preview/development retains the Phase 2A–2D aggregate diagnostics and adds `Phase2E selection: targets=… scored=… eligible=… dogExcluded=… belowFitThreshold=… selected=… gaps=… reusedSkipped=… chronologySkipped=… overDetourSelected=… unknownDogAccessSelected=…`. `belowFitThreshold` counts matches encountered and skipped during final selection because their planned fit is below 60; matches after an already selected winner are not visited or counted. Counts only: no names, IDs, coordinates, URLs, or individual scores. Production remains silent. Zero-target routes emit no phase diagnostics. Empty match pools perform no enrichment calls and emit zero-count enrichment/selection diagnostics before the no-candidates error.

Input bounds remain 500 characters per location, 100 for dog name, cadence 1–1,440 minutes, and max detour 0–1,440 minutes. Provider durations remain bounded to 30 days. Invalid input, absent routes, provider failures, and throttling retain their sanitized error codes.

## Vercel deployment

Use the repository root with Vercel's **Other** framework preset, no build command, and the root static output. Vercel serves `index.html`, `style.css`, and `app.js`, and runs `api/plan-route.js` as a Node.js function at `/api/plan-route`. Use a supported Node.js runtime with built-in `fetch` (Node 22 or later). No framework or runtime dependencies are required. See [Vercel's Node.js function documentation](https://vercel.com/docs/functions/runtimes/node-js).

Configure `GOOGLE_MAPS_API_KEY` as a server-side environment variable in the Vercel project for both Preview and Production. The associated Google Cloud project must have billing configured and both **Routes API** and **Places API (New)** enabled, with the key permitted to call both APIs. The function reads the key only from `process.env.GOOGLE_MAPS_API_KEY`. Never put it in client JavaScript, responses, logs, or committed files. Local `.env` files and `.vercel` configuration are ignored by Git. Phase 2A calls Places API (New) Text Search using the computed encoded route. See Google’s [Search Along Route documentation](https://developers.google.com/maps/documentation/places/web-service/search-along-route). See Google's [computeRoutes reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).

A static-only local server cannot execute `/api/plan-route`; use Vercel's function environment to exercise the full application. A future branch push can produce a Preview deployment for the first live provider test. Branch pushes can trigger the configured Vercel Preview integration; project environment variables are unchanged.

## Separate urgent-stop demo

The urgent-stop prototype remains explicitly labeled as a curated Jersey City → Chicago demo. Its six stops and simulated time-ahead values are unrelated to the real planned route or device location. The route screen's “Try the urgent-stop demo” button opens it.

The demo retains preference matching, Puppy / Adult / Senior soft signals, and the max-detour penalty of ten points plus six per excess minute. Urgent ETA includes simulated time ahead plus detour. The 15-, 30-, and 60-minute windows, eligible alternatives, outside-window warning, source disclosures, demo reports, and Google Maps links remain available. These are demonstration scores and observations, not live conditions or medical guidance. Live urgent geolocation belongs to V2.2.1.

The V2.1.1 timing helpers remain for future real-stop planning: ±15 minutes has no penalty, then early minutes cost 0.20 points each and late minutes cost 0.75. They are not used to invent Phase 1 recommendations.

## Validation

With Node.js available:

```sh
node --check app.js
node --check api/plan-route.js
node --check lib/scoring.js
node --check lib/selection.js
node --check lib/target-matching.js
node --check lib/google-enrichment.js
node --check lib/target-enrichment.js
node --check lib/review-evidence.js
node --test tests/*.test.js
```

Tests use built-in Node tools, synthetic normalized evidence, mocked providers, and a minimal DOM harness. No live Google calls or real credentials are used. Coverage includes confidence weighting, preference materiality, life stages, exact timing/detour penalties, dog-access exclusion, deterministic ranking, unique chronological selection, gaps, public field projection, sanitized errors, enrichment budgets, and the unchanged urgent demo.

After a later push, validate Vercel Preview with Jersey City → Chicago, Jersey City → Nashville, New York → Boston, and a short zero-target route. Inspect real normalized API stops, uniqueness, chronology, gaps, evidence caveats, missing navigation, and NO_STOP_CANDIDATES. Check details requests remain at most 20 globally and five for a single target, plus latency within the shared timeout. Verify no provider bodies/credentials leak, production emits no diagnostics, and the zero-target route performs no Places work. Phase 2F renders these normalized recommendations directly; live preview checks require an accessible deployment with server-side credentials.
