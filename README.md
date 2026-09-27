# Pawstop V2.2 Phase 2D

Pawstop is a dog-first road-trip stop planning prototype built with plain HTML, CSS, and JavaScript. Phase 1 replaces the fixed route duration with a real Google driving route and cadence-based break targets. Architecture: [V2.2 API contract](docs/v2.2-api-contract.md).

## Current behavior

“Build my Pawstop route” sends the trip and dog preferences to `POST /api/plan-route`. The server validates the request, calls Google Routes `computeRoutes`, and returns normalized duration, distance, polyline, provenance, break targets, and one `stop: null` recommendation per target. The browser shows the real duration/distance and explicit coverage-gap cards. A route at or below the cadence has no planned breaks before arrival.

Phase 2A adds internal along-route candidate discovery using four Places Text Searches: park, recreation area, picnic area, and rest area. Each search requests structural fields and response-level routing summaries and one page of up to 20 results; coverage is not exhaustive. Candidates are validated, deduplicated by Place ID, and normalized without inferring amenities or dog suitability. Routes with no break targets skip discovery. There are still no real-route stop recommendations, match scores, or stop navigation links; scoring and planning remain a later phase. Preferences are accepted for the future matching pipeline but do not yet affect planned stop selection. Break targets exclude dwell time and cumulative detours.

Phase 2B-1 calculates internal candidate `route: { tripMinutes, detourMinutes }` from exactly two routing-summary legs using `DRIVE` and `TRAFFIC_UNAWARE`, without overriding the polyline origin. Trip minutes are first-leg seconds / 60; detour minutes are total leg seconds / 60 minus the real baseline duration. Positive durations (up to nine fractional digits) and total via durations are bounded to 30 days. Missing or unusable summaries and negative detours retain the structural candidate with `route: null`; negative detours are counted separately. Deduplication prefers usable metrics, otherwise fixed query order wins. Preview/development logs contain only aggregate coverage counts and rounded ranges for deduplicated candidates; production emits no diagnostics. Candidate metrics and provider summaries never reach the browser.

Phase 2C internally matches real routed candidates to each cadence target using the inclusive half-cadence window: `abs(tripMinutes - targetMinutes) <= breakCadenceMinutes / 2`. Each match contains the unchanged candidate plus `targetMinutes`, `deltaMinutes`, `timingPenalty`, `timingLabel`, and `maxDetourPenalty`. Negative delta means early; positive means late. Timing penalty is zero within ±15 minutes, then 0.20 points per excess early minute or 0.75 per excess late minute. Labels say “Close to planned break” within ±15, otherwise rounded minutes before/after the planned break; calculations retain full numeric precision.

`maxDetourMinutes` is not a hard exclusion: excess detour receives the existing `10 + 6 × excessMinutes` penalty, regardless of `minimalDetours`. Internal target-match pools retain all timing-eligible pairs, including over-max detours, shared candidates at adjacent window boundaries, and empty pools for coverage gaps. Pre-scoring order is absolute delta, detour, trip minutes, then stable candidate identity. `matchTargets({ candidates, breakTargetsMinutes, breakCadenceMinutes, maxDetourMinutes })` in `lib/target-matching.js` returns `{ pools, diagnostics }` without mutating candidates. Preview/development adds one counts-only `Phase2C matching` line with targets, routed, pairs, coveredTargets, gaps, overDetour, close, early, and late counts. Zero-target routes skip matching and its log; production stays silent. Pools remain internal and real stops are still not surfaced. Preference scoring and final unique, chronological selection are the next phase.

Phase 2D selectively enriches the first five matches from each Phase 2C target pool in its existing order. Candidates are deduplicated by normalized Pawstop identity in first encounter order, with a global cap of 20 and at most five concurrent requests. Place Details uses the exact field mask `id,allowsDogs,restroom,parkingOptions,googleMapsUri` and the same 15-second request signal as routing/discovery. No reviews, photos, ratings, scraping, or generated summaries are used.

Explicit `allowsDogs` and `restroom` booleans become confirmed true or false evidence. Omitted/malformed fields remain unknown. A supported parking option explicitly set to true confirms parking; empty or all-false parking data remains unknown. A normalized dedicated-dog-area category confirms `dedicatedDogArea=true`, never false from absence. Large grass, dog traffic, fencing, and lighting remain unknown without evidence. Valid HTTPS Google Maps links are stored internally as `navigation.googleMapsUrl`. Selected places are not guaranteed to have dog-access or restroom data.

Enriched candidates replace references throughout the internal target pools without changing route metrics, target-specific values, or ordering. The adapter validates returned identity before accepting optional evidence. Individual unavailable places (404/410), unusable details, and omitted fields retain structural candidates and existing evidence. Throttling returns sanitized `RATE_LIMITED`; authentication, infrastructure, network, or timeout failures return sanitized `PROVIDER_ERROR`. Active requests are drained and queued requests stop after a fatal failure. Internal results distinguish `enriched` (a requested attribute became known or navigation became available) from `unchanged`; category-only evidence is counted separately in `dedicatedKnown`.

Preview/development emits one counts-only line: `Phase2D enrichment: selected=… requested=… enriched=… unchanged=… dogsKnown=… restroomsKnown=… parkingKnown=… dedicatedKnown=… navKnown=…`. No matches produces a zero-count line and no details requests. Zero-target routes skip enrichment and its log; production emits no diagnostics. Real recommendations and enrichment remain private: the public response still contains only route, break targets, and `stop: null` recommendations. Phase 2E will add preference scoring and unique chronological selection.

Phase 1 explicitly uses `DRIVE` and `TRAFFIC_UNAWARE`, returning `trafficAware: false`. This is a temporary implementation choice; traffic-aware versus traffic-unaware routing remains an open V2.2 decision. Displayed duration does not include traffic.

The endpoint accepts the required fields in contract section 3. Operational validation bounds are 500 characters for each location, 100 for dog name, cadence from 1 to 1,440 minutes, and max detour from 0 to 1,440 minutes. Provider durations must be positive and at most 30 days. Invalid requests return `INVALID_INPUT`; no route returns `ROUTE_NOT_FOUND`; provider failures return `PROVIDER_ERROR`; provider throttling returns `RATE_LIMITED`. Phase 2A still returns planned gaps, including when discovery succeeds with zero usable candidates. Places failures use the same sanitized provider errors. Internal `discoverCandidates()` results expose normalized candidates and counts (received, rejected, duplicate, and unique) to server-side tests, never to the browser or production UI. Routing and discovery share the existing 15-second provider timeout budget.

## Vercel deployment

Use the repository root with Vercel's **Other** framework preset, no build command, and the root static output. Vercel serves `index.html`, `style.css`, and `app.js`, and runs `api/plan-route.js` as a Node.js function at `/api/plan-route`. Use a supported Node.js runtime with built-in `fetch` (Node 22 or later). No framework or runtime dependencies are required. See [Vercel's Node.js function documentation](https://vercel.com/docs/functions/runtimes/node-js).

Configure `GOOGLE_MAPS_API_KEY` as a server-side environment variable in the Vercel project for both Preview and Production. The associated Google Cloud project must have billing configured and both **Routes API** and **Places API (New)** enabled, with the key permitted to call both APIs. The function reads the key only from `process.env.GOOGLE_MAPS_API_KEY`. Never put it in client JavaScript, responses, logs, or committed files. Local `.env` files and `.vercel` configuration are ignored by Git. Phase 2A calls Places API (New) Text Search using the computed encoded route. See Google’s [Search Along Route documentation](https://developers.google.com/maps/documentation/places/web-service/search-along-route). See Google's [computeRoutes reference](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes).

A static-only local server cannot execute `/api/plan-route`; use Vercel's function environment to exercise the full application. A future branch push can produce a Preview deployment for the first live provider test. This implementation does not itself push, deploy, or change project environment variables.

## Separate urgent-stop demo

The urgent-stop prototype remains explicitly labeled as a curated Jersey City → Chicago demo. Its six stops and simulated time-ahead values are unrelated to the real planned route or device location. The route screen's “Try the urgent-stop demo” button opens it.

The demo retains preference matching, Puppy / Adult / Senior soft signals, and the max-detour penalty of ten points plus six per excess minute. Urgent ETA includes simulated time ahead plus detour. The 15-, 30-, and 60-minute windows, eligible alternatives, outside-window warning, source disclosures, demo reports, and Google Maps links remain available. These are demonstration scores and observations, not live conditions or medical guidance. Live urgent geolocation belongs to V2.2.1.

The V2.1.1 timing helpers remain for future real-stop planning: ±15 minutes has no penalty, then early minutes cost 0.20 points each and late minutes cost 0.75. They are not used to invent Phase 1 recommendations.

## Validation

With Node.js available:

```sh
node --check app.js
node --check api/plan-route.js
node --check lib/target-matching.js
node --check lib/google-enrichment.js
node --test tests/*.test.js
```

Tests use built-in Node tools, mocked provider responses, and a minimal DOM event-handler harness. They make no live Google calls and need no real credentials. Coverage includes 780 minutes / 150-minute cadence → `[150,300,450,600,750]`, short routes, arrival boundaries, request validation, first valid route normalization, sanitized failures, planned gaps, loading/error recovery, and urgent demo controls/navigation.

On Vercel Preview, verify actual route resolution and plausible duration/distance for Jersey City → Chicago, Jersey City → Nashville, New York → Boston, and a short route such as Jersey City → Newark. Verify function deployment, environment/key permissions, real error states, mobile layout, and that no credentials or raw provider errors appear in browser responses. Confirm the urgent demo remains clearly separate and planned routes never display the six curated stops.

For Phase 2D Preview validation after a later push, inspect Jersey City → Chicago for at most 20 target-relevant details requests, retained pool coverage, evidence availability, and latency. New York → Boston should select at most five unique candidates when it has one target. Confirm a short zero-target route makes no Places discovery or enrichment requests. Unknown attributes must remain unknown; inspect request counts and latency before merging.
