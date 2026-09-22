# Pawstop V2 Prototype

Pawstop is a dog-first road-trip stop intelligence concept.

## What's new in V2

- Preference-based matching instead of hard-coded match percentages.
- Stop data, matching logic, and UI are separated so the prototype can evolve toward a real app.
- Priorities now affect recommendations: large grass, low dog traffic, restrooms, minimal detours, fenced space, and lighting.
- Max detour and “avoid dedicated dog-relief areas” affect scoring.
- Route view includes a dog profile / break plan summary and highlights the best match.
- “Dog needs a stop” now supports 15 / 30 / 60 minute windows.
- Alternatives dynamically compare Best match / Fastest / Largest grass / Restrooms.
- Community-report UI previews the future data layer using clearly labeled demo data.
- Google Maps navigation handoff and confidence/provenance links remain.
- Mobile-first visual polish.

## Current prototype boundary

V2 still uses a curated Jersey City → Chicago corridor. Drive times, detours, dog traffic, grass condition, cleanliness, and closures are not live data. Community observations shown in V2 are demo data. Pawstop matches observable stop characteristics and user preferences; it does not assess medical safety.

## Path toward the app

The next technical milestone should replace curated route/stop inputs with live routing and place discovery while keeping the V2 matching engine and interface model.
