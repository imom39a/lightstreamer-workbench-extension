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

Homepage URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/
```

Support URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/support/
```

Privacy policy URL:

```text
https://imom39a.github.io/lightstreamer-workbench-extension/privacy/
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
- No product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer-operated backend.
- First-party Help links to versioned documentation, privacy, and support routes on the project site.

This extension is intended for developers and QA engineers who need to understand and reproduce Lightstreamer COMMAND subscription behavior inside Chrome DevTools.
```

## Screenshot Upload Order

Remove every legacy screenshot that shows the retired three-section interface before uploading this 2.0 set.

1. `screenshots/01-command-projections-context.png`
   - Caption: Context compares Observed Server and Local Effective COMMAND State while Runtime Scope keeps the active Subscription visible.
2. `screenshots/02-ordered-evidence-context.png`
   - Caption: Complete raw Evidence preserves the immutable captured envelope, provenance, and Lightstreamer-native runtime context for detailed inspection.
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
2.0.0
```

What's new:

```text
Unified Scoped Evidence Workspace and Local Injection release.

- Brings Runtime Scope, Ordered Evidence, and Context into one responsive investigation workspace.
- Keeps Scope, Find, Filter, Evidence selection, Capture, Coverage, and Live/Frozen position independent during ongoing activity.
- Compares Observed Server and Local Effective COMMAND State with explicit provenance and authority limits.
- Adds exactly one protected Local Injection Draft with raw JSON editing, immutable Source comparison, validation, Review, and truthful delivery outcomes.
- Retains complete current-session Evidence in temporary IndexedDB-backed batches, with an in-memory fallback and bounded high-volume rendering.
- Removes product analytics, tracking configuration, remote transport, and the persistent installation identifier; 2.0 also clears the two retired 0.1.x preference/identifier records.
- Adds first-party Documentation, Privacy, and Support links in Session operations.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data locally inside the browser DevTools session. Captured Evidence is held in temporary IndexedDB-backed storage for the current tab/session, with an in-memory fallback when IndexedDB is unavailable. It is not transmitted to the developer, this extension's authors, an analytics service, or any other external service by the extension.

Version 2 includes no product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer-operated backend. It creates no analytics identifier. On panel startup, it removes the retired 0.1.x analytics consent and random installation identifier records if present. This cleanup never sends data and cannot block the panel when local storage is unavailable.

Required host/page access is used to instrument the inspected page's official Lightstreamer Web Client activity and support developer-controlled Local Injection within the inspected page. Local Injection does not contact the Lightstreamer Server. Versioned JSON and offline HTML exports occur only after an explicit user action, exclude credentials, and create local downloads for the user to review.
```

Privacy questionnaire note:

```text
Version 2 has no off-device user-data collection or transmission by the extension. Do not declare product-usage analytics or an analytics identifier. Explain any locally processed website content in the dashboard field whose wording requires it, and state that it stays in the current DevTools session except for deliberate user-created local exports. Certify no sale, advertising use, account sign-in, remote logging, or use outside the extension's single debugging purpose. The dashboard answers, listing, and policy at https://imom39a.github.io/lightstreamer-workbench-extension/privacy/ must remain identical in substance.
```

## Reviewer Test Instructions

```text
No account or login is required.

This is a Chrome DevTools extension. After installing it, open Chrome DevTools on a page that uses the official Lightstreamer Web Client and select the "Lightstreamer Workbench" panel. The panel stays idle until the inspected page creates Lightstreamer clients or Subscriptions. Captured activity appears chronologically in Ordered Evidence. Use Runtime Scope to choose a client, Session, Subscription, item, or listener; Context explains the active runtime object or selected Evidence and shows COMMAND key lifecycles and projections when applicable.

To inspect Local Injection, select one compatible captured Item Update and choose **Create Local Injection Draft**, or choose **Author COMMAND Item Update** from an applicable live COMMAND scope. Workbench protects exactly one Draft. Edit its raw JSON, optionally choose **Compare Source** to view the immutable Source/Draft diff, resolve validation problems, and use **Review Local Injection** before **Inject locally**. The outcome document distinguishes delivered, failed, partial, unknown, and stale-target results without claiming downstream application effects.

Open **More actions** and confirm the **Help & resources** section links to first-party Documentation, Privacy, and Support routes. Version 2 has no analytics disclosure or analytics preference control.

For deterministic local verification from the repository:

1. Run `npm ci`.
2. Run `npm run release:package`.
3. Load the generated `dist/` directory as an unpacked extension in Chrome.
4. Run `npm run fixture:test` to verify the bundled Lightstreamer fixture smoke path.
```

## Release Checklist

- [ ] Confirm `public/manifest.json` version matches `package.json`.
- [ ] Run `npm run release:package`.
- [ ] Upload `release/lightstreamer-workbench-v2.0.0.zip`.
- [ ] Upload `public/icons/icon-128.png` as the store icon.
- [ ] Upload all three screenshots in the order listed above.
- [ ] Upload `store-listing/promo/small-promo-tile.png`.
- [ ] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [ ] Paste the summary and detailed description from this file.
- [ ] Review the privacy practices answer before submission.
- [ ] Remove the retired product-usage analytics and identifier declarations from the dashboard privacy fields.
- [ ] Confirm the packaged build contains no analytics endpoint, configuration, event, or identifier residue.
- [ ] Confirm the privacy policy URL is `https://imom39a.github.io/lightstreamer-workbench-extension/privacy/`.
- [ ] Confirm the support URL is `https://imom39a.github.io/lightstreamer-workbench-extension/support/`.
- [ ] Confirm the homepage URL is `https://imom39a.github.io/lightstreamer-workbench-extension/` and staged publishing remains enabled.
