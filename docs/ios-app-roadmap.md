# Pawstop iOS / App Store Roadmap

## Goal

Ship Pawstop as a real iPhone app, test it through TestFlight, and submit it to the Apple App Store while preserving the existing web product.

## Architecture

- Keep the current Vercel API as the route-planning backend.
- Package the Pawstop HTML/CSS/JavaScript frontend locally inside an iOS app with Capacitor.
- Native builds call `https://pawstop-one.vercel.app/api/plan-route`; the web app continues to use `/api/plan-route`.
- Allow only Pawstop's native Capacitor origins through the API CORS boundary.
- Keep one product codebase where practical instead of maintaining a separate native rewrite.

## Phase 1 — Native foundation

- [x] Add Node/Capacitor project tooling.
- [x] Add deterministic `www/` mobile bundle build.
- [x] Add native-aware API routing.
- [x] Add narrow native CORS support.
- [ ] Generate the iOS project with Xcode/Capacitor.
- [ ] Run Pawstop in an iPhone simulator and on a physical iPhone.

## Phase 2 — Make it meaningfully app-like

Before App Store review, add device-native value rather than submitting a thin website wrapper.

Planned first native features:

- Use current location as the trip origin.
- Save dog profile, break cadence, detour, and stop preferences on device.
- Native share sheet for sharing a Pawstop route/result.
- Native haptic feedback for primary planning actions and successful route creation.
- Proper app icon, launch screen, status bar, safe-area behavior, and offline/error states.

## Phase 3 — App Store readiness

- Apple Developer Program enrollment.
- Bundle identifier and signing.
- Privacy policy available both publicly and from inside the app.
- App privacy disclosures in App Store Connect.
- Privacy manifest / required-reason API review for included SDKs.
- Accessibility pass.
- App icon and App Store screenshots.
- App name, subtitle, keywords, description, support URL, marketing URL.
- Age rating questionnaire.
- App Review notes explaining Pawstop's route-planning utility and native features.

## Phase 4 — TestFlight

- Archive from Xcode.
- Upload build to App Store Connect.
- Resolve validation warnings.
- Internal TestFlight test.
- External TestFlight beta with Pawstop testers.
- Fix blocking issues found in beta.

## Phase 5 — App Store submission

- Select the tested build.
- Complete privacy, review, pricing/availability, and metadata.
- Submit for App Review.
- Respond to reviewer questions or rejections with evidence and fixes.
- Release manually after approval.

## Definition of done

Pawstop is downloadable from the public App Store, installs on an iPhone, plans real routes, returns Pawstop recommendations, hands off navigation appropriately, and has completed the full Apple submission/review workflow.
