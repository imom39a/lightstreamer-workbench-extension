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
- Ordered Evidence with independent Find, Filter, selection, Capture, Coverage, and Live/Frozen controls, plus bounded rendering backed by committed Evidence through the current History Interval's Committed Evidence Boundary.
- Context for the active runtime object or selected Evidence, including immutable raw Evidence, COMMAND lifecycle detail, and explicit provenance and limitations.
- A Panel Session-wide Notifications document for active operational conditions and recent Lightstreamer diagnostics, with stable identities, independent filters, supporting Evidence routes, and dismissible footer copies.
- Side-by-side Observed Server COMMAND State and Local Effective COMMAND State projections; neither is presented as authoritative server state.
- Exactly one protected Local Injection Draft, created from an immutable captured Source or authored from a live COMMAND scope.
- Full-size raw JSON editing with validation, Review, and optional immutable Source/Draft comparison and diff.
- Explicit Local Injection Scenarios with ordered single-target Steps, immutable reviewed Runs, serial controls, Checkpoints, per-Step outcomes, and complete correlation.
- Local-only delivery to the exact live Subscription through the inspected page, with delivered, failed, partial, unknown, and stale-target outcomes that state only what Workbench can prove.
- WebSocket/TLCP fallback diagnostics when primary Web Client instrumentation is unavailable.
- One temporary Event History per Panel Session, with normal 100,000-record/256 MiB and startup-memory 5,000-record/32 MiB History Capacity tiers; the selected adapter is fixed for the session and no backend service is required. Count and canonical bytes are independent limits; arbitrary-size payloads are not promised.
- Complete History is limited to committed Evidence through the current History Interval's Committed Evidence Boundary. Clear makes an exact interval cut and cannot restart stopped Capture; journal or capacity failures stop acceptance fail-closed.
- Controlled Close attempts erasure. Abnormal termination relies on a later ownership-safe sweep, so residual data may remain until Chrome next runs the extension; a new Panel Session starts empty and never replays stale Evidence. Storage fallback alone does not limit Observation Coverage.
- No product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer-operated backend.
- First-party Help links to versioned documentation, privacy, and support routes on the project site.

This extension is intended for developers and QA engineers who need to understand and reproduce Lightstreamer COMMAND subscription behavior inside Chrome DevTools.
```

## Screenshot Upload Order

Remove every legacy screenshot that shows the retired three-section interface before uploading this 2.0 set.

1. `screenshots/01-command-projections-context.png`
   - Caption: Runtime Scope, retained Event order, timestamp, Source, COMMAND operation, object, key, and selected update Fields remain readable in one workspace.
2. `screenshots/02-ordered-evidence-context.png`
   - Caption: Complete raw Evidence preserves the immutable captured envelope, provenance, and Lightstreamer-native runtime context for detailed inspection.
3. `screenshots/03-local-injection-editor.png`
   - Caption: One protected Local Injection Draft provides raw JSON editing, validation, exact target details, and deliberate Review.
4. `screenshots/04-notifications.png`
   - Caption: Notifications keeps active Workbench conditions and recent Lightstreamer diagnostics reviewable without taking over selected Evidence Context.

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
2.0.1
```

What's new:

```text
Focused update for the 2.0 Scoped Evidence Workspace.

- Adds explicit multi-event Local Injection Scenarios with immutable reviewed Runs, serial controls, Checkpoints, and correlated outcomes.
- Adds a Panel Session-wide Notifications workflow for active conditions and recent Lightstreamer diagnostics; footer conditions can be dismissed without changing Evidence.
- Improves Scope and Ordered Evidence readability, including a dedicated retained-order rail and stable two-line Scope identities.
- Keeps selected update Fields visible by default through compact supporting Context disclosures.
- Keeps the same Manifest V3 permissions, local-only data handling, temporary Event History, and Local Injection server boundary.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data locally inside one Panel Session. Each Panel Session owns one temporary Event History: normal IndexedDB capacity is 100,000 Evidence records or 256 MiB, and startup memory fallback capacity is 5,000 records or 32 MiB. The selected adapter is fixed for that session. Captured Evidence is not transmitted to the developer, this extension's authors, an analytics service, or any other external service by the extension.

Complete History means committed Evidence through the current History Interval's Committed Evidence Boundary. Clear makes an exact interval cut and cannot restart Capture after a terminal stop. Controlled Close attempts erasure; abnormal termination may defer cleanup to a later ownership-safe sweep, so residual data can remain until Chrome next runs the extension. A new Panel Session starts empty and never replays stale Evidence. Capture Operation, Observation Coverage, History Capacity, and Live/Frozen state are independent, and storage fallback alone does not limit Coverage.

Version 2 includes no product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer-operated backend. It creates no analytics identifier. It may remove retired 0.1.x analytics consent and random installation identifier records when local storage is available; this cleanup never sends data and cannot block the panel when local storage is unavailable.

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

- [x] Confirm `public/manifest.json` version matches `package.json`.
- [x] Run `npm run release:package`.
- [x] Upload `release/lightstreamer-workbench-v2.0.1.zip`.
- [x] Upload `public/icons/icon-128.png` as the store icon.
- [x] Upload all three screenshots in the order listed above.
- [x] Upload `store-listing/promo/small-promo-tile.png`.
- [x] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [x] Confirm the package-derived summary and paste the detailed description from this file.
- [ ] Review the privacy practices answer before submission.
- [ ] Remove the retired product-usage analytics and identifier declarations from the dashboard privacy fields.
- [x] Confirm the packaged build contains no analytics endpoint, configuration, event, or identifier residue.
- [x] Confirm the packaged Manifest V3 has no new storage permission and no `unlimitedStorage` declaration.
- [x] Confirm the final Event History real-Chrome report is `PASS`, or retain the explicit maintainer-accepted `REVIEW` disposition in the internal Project ticket; a `FAIL` blocks publication.
- [ ] Confirm the privacy policy URL is `https://imom39a.github.io/lightstreamer-workbench-extension/privacy/`.
- [ ] Confirm the support URL is `https://imom39a.github.io/lightstreamer-workbench-extension/support/`.
- [ ] Confirm the homepage URL is `https://imom39a.github.io/lightstreamer-workbench-extension/` and staged publishing remains enabled.
