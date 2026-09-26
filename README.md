# Pawstop V2.2 Phase 2A

Pawstop is a dog-first road-trip stop planning prototype built with plain HTML, CSS, and JavaScript. Phase 1 replaces the fixed route duration with a real Google driving route and cadence-based break targets. Architecture: [V2.2 API contract](docs/v2.2-api-contract.md).

## Current behavior

“Build my Pawstop route” sends the trip and dog preferences to `POST /api/plan-route`. The server validates the request, calls Google Routes `computeRoutes`, and returns normalized duration, distance, polyline, provenance, break targets, and one `stop: null` recommendation per target. The browser shows the real duration/distance and explicit coverage-gap cards. A route at or below the cadence has no planned breaks before arrival.

Phase 2A adds internal along-route candidate discovery using four Places Text Searches: park, recreation area, picnic area, and rest area. Each search requests only structural fields and one page of up to 20 results; coverage is not exhaustive. Candidates are validated, deduplicated by Place ID, and normalized without inferring amenities or dog suitability. Routes with no break targets skip discovery. There are still no real-route stop recommendations, match scores, or stop navigation links; Phase 2B must validate route metrics first. Preferences are accepted for the future matching pipeline but do not yet affect planned stop selection. Break targets exclude dwell time and cumulative detours.

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
node --test tests/*.test.js
```

Tests use built-in Node tools, mocked provider responses, and a minimal DOM event-handler harness. They make no live Google calls and need no real credentials. Coverage includes 780 minutes / 150-minute cadence → `[150,300,450,600,750]`, short routes, arrival boundaries, request validation, first valid route normalization, sanitized failures, planned gaps, loading/error recovery, and urgent demo controls/navigation.

On Vercel Preview, verify actual route resolution and plausible duration/distance for Jersey City → Chicago, Jersey City → Nashville, New York → Boston, and a short route such as Jersey City → Newark. Verify function deployment, environment/key permissions, real error states, mobile layout, and that no credentials or raw provider errors appear in browser responses. Confirm the urgent demo remains clearly separate and planned routes never display the six curated stops.
