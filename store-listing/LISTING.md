# Chrome Web Store Listing Draft

## Basic Listing

Name:

```text
Lightstreamer Workbench
```

Summary, 99 characters:

```text
DevTools workspace for inspecting Lightstreamer Web Client activity and deliberate Local Injection.
```

Category:

```text
Developer Tools
```

Language:

```text
English (United States)
```

## Detailed Description

```text
Lightstreamer Workbench adds a Chrome DevTools panel for developers debugging web applications that use the official Lightstreamer Web Client.

It captures client, Session, Subscription, listener, Item Update, snapshot, and COMMAND-mode key lifecycle activity from the inspected page. The React Scoped Evidence Workspace keeps structural Runtime Scope, chronological Ordered Evidence, and explanatory Context together so developers can follow an investigation without losing its active object or selected Evidence.

Key features:

- Runtime Scope for choosing the inspected page, client, Session, Subscription, item, or listener while retired objects remain readable but cannot become Local Injection targets.
- Ordered Evidence with independent Find, Filter, selection, Capture, Coverage, and Live/Frozen controls, plus bounded rendering backed by complete retained current-session history.
- Context for the active runtime object or selected Evidence, including immutable raw Evidence, COMMAND lifecycle detail, and explicit provenance and limitations.
- Side-by-side Observed Server COMMAND State and Local Effective COMMAND State projections; neither is presented as authoritative server state.
- Exactly one protected Local Injection Draft, created from an immutable captured Source or authored from a live COMMAND scope.
- Full-size raw JSON editing with validation, Review, and optional immutable Source/Draft comparison and diff.
- Local-only delivery to the exact live Subscription through the inspected page, with delivered, failed, partial, unknown, and stale-target outcomes that state only what Workbench can prove.
- WebSocket/TLCP fallback diagnostics when primary Web Client instrumentation is unavailable.
- Current-DevTools-session history in temporary IndexedDB-backed batches, with an in-memory fallback when IndexedDB is unavailable; no backend service is required.
- Optional, consent-based coarse feature analytics that never includes inspected-page or captured Lightstreamer data.

This extension is intended for developers and QA engineers who need to understand and reproduce Lightstreamer COMMAND subscription behavior inside Chrome DevTools.
```

## Screenshot Upload Order

1. `screenshots/01-command-projections-context.png`
   - Caption: Context compares Observed Server and Local Effective COMMAND State while Runtime Scope keeps the active Subscription visible.
2. `screenshots/02-ordered-evidence-context.png`
   - Caption: Ordered Evidence preserves chronological Capture detail, Find and Filter state, and selected-Evidence Context in one workspace.
3. `screenshots/03-local-injection-editor.png`
   - Caption: One Local Injection Draft provides raw JSON editing, validation, and an immutable Source/Draft comparison before Review.

## Graphic Assets

Store icon:

```text
store-listing/icons/icon-128.png
```

Small promo tile:

```text
store-listing/promo/small-promo-tile.png
```

Marquee promo tile, optional:

```text
store-listing/promo/marquee-promo-tile.png
```

## Release Notes Draft

Version:

```text
0.1.5
```

What's new:

```text
React Scoped Evidence Workspace and Local Injection release.

- Brings Runtime Scope, Ordered Evidence, and Context into one responsive investigation workspace.
- Keeps Scope, Find, Filter, Evidence selection, Capture, Coverage, and Live/Frozen position independent during ongoing activity.
- Compares Observed Server and Local Effective COMMAND State with explicit provenance and authority limits.
- Adds exactly one protected Local Injection Draft with raw JSON editing, immutable Source comparison, validation, Review, and truthful delivery outcomes.
- Retains complete current-session Evidence in temporary IndexedDB-backed batches, with an in-memory fallback and bounded high-volume rendering.
- Updates optional coarse usage analytics to current Ordered Evidence and Local Injection terms while preserving prominent consent, immediate opt-out, and the inspected-data exclusion boundary.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data locally inside the browser DevTools session. Captured Evidence is held in temporary IndexedDB-backed storage for the current tab/session, with an in-memory fallback when IndexedDB is unavailable. It is not transmitted to the developer, this extension's authors, Google Analytics, or any other external service by the extension.

The extension offers optional coarse product-usage analytics through a dedicated Google Analytics 4 property. Analytics remains off until the user accepts a prominent disclosure in the DevTools panel. When enabled, events are limited to panel use, whether Lightstreamer was detected, whether Ordered Evidence search or Local Injection was used, Local Injection entry/target/outcome categories, an edited/not-edited flag, a bucketed captured-Evidence count, extension version, session timing, and a random installation identifier. It never sends inspected URLs, Lightstreamer addresses, captured values or identifiers, item/field/key names, search text, Injection Sources, Injection Drafts, raw errors, or stack traces. Advertising consent is denied and analytics is used only to improve the extension. Turning analytics off deletes the identifier and blocks future requests. The analytics integration adds no Chrome permission.

The extension does not use advertising, remote error logging, or account sign-in. It does not sell user data. Required host/page access is used to instrument the inspected page's Lightstreamer Web Client activity and to support developer-controlled Local Injection within the inspected page. Local Injection does not contact the Lightstreamer Server.
```

Privacy questionnaire note:

```text
Declare the extension's opt-in collection of coarse product interaction/user-activity metrics and the random analytics installation identifier. Disclose Google Analytics as the processor/recipient and product improvement as the sole use. Do not declare inspected URLs, browsing history, website content, Lightstreamer payloads, authentication information, or personal communications as transmitted: those remain local. Certify no sale, no advertising use, and no use outside the extension's single purpose. The privacy policy, listing, dashboard privacy fields, and in-product disclosure must remain identical in substance.
```

## Reviewer Test Instructions

```text
No account or login is required.

This is a Chrome DevTools extension. After installing it, open Chrome DevTools on a page that uses the official Lightstreamer Web Client and select the "Lightstreamer Workbench" panel. The panel stays idle until the inspected page creates Lightstreamer clients or Subscriptions. Captured activity appears chronologically in Ordered Evidence. Use Runtime Scope to choose a client, Session, Subscription, item, or listener; Context explains the active runtime object or selected Evidence and shows COMMAND key lifecycles and projections when applicable.

To inspect Local Injection, select one compatible captured Item Update and choose **Create Local Injection Draft**, or choose **Author COMMAND Item Update** from an applicable live COMMAND scope. Workbench protects exactly one Draft. Edit its raw JSON, optionally choose **Compare Source** to view the immutable Source/Draft diff, resolve validation problems, and use **Review Local Injection** before **Inject locally**. The outcome document distinguishes delivered, failed, partial, unknown, and stale-target results without claiming downstream application effects.

On the first panel open in an analytics-configured official build, a disclosure explains the exact coarse metrics and excluded inspected data. **Not now** keeps analytics disabled. **Allow analytics** begins the documented coarse collection; the toolbar control can turn analytics off again, delete the random identifier, and block later requests.

For deterministic local verification from the repository:

1. Run `npm ci`.
2. Run `npm run release:package`.
3. Load the generated `dist/` directory as an unpacked extension in Chrome.
4. Run `npm run fixture:test` to verify the bundled Lightstreamer fixture smoke path.
```

## Release Checklist

- [ ] Confirm `public/manifest.json` version matches `package.json`.
- [ ] Run `npm run release:package`.
- [ ] Upload `release/lightstreamer-workbench-v0.1.5.zip`.
- [ ] Upload `public/icons/icon-128.png` as the store icon.
- [ ] Upload all three screenshots in the order listed above.
- [ ] Upload `store-listing/promo/small-promo-tile.png`.
- [ ] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [ ] Paste the summary and detailed description from this file.
- [ ] Review the privacy practices answer before submission.
- [ ] Declare the opt-in product-usage collection and Google Analytics recipient in the dashboard privacy fields.
- [ ] Confirm the analytics-enabled build adds no Chrome permission and contacts only the documented GA4 collection endpoint.
- [ ] Confirm the GA4 property has advertising features disabled and only the documented custom dimensions.
- [ ] Verify **Not now**, allow, and opt-out/revocation paths in a packaged build.
- [ ] Confirm distribution, support URL, homepage URL, and staged publishing settings in the dashboard.
