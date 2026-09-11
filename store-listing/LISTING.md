# Chrome Web Store Listing Draft

## Basic Listing

Name:

```text
Lightstreamer Workbench
```

Summary, 91 characters:

```text
Inspect Lightstreamer activity and test Item Updates or Client Messages in Chrome DevTools.
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

The description below accompanies the 2.0.4 release candidate. Publish it only with the matching package and privacy disclosures. The versioned release records later in this file describe their original packages.

```text
Lightstreamer Workbench adds a Chrome DevTools panel for applications that use the official Lightstreamer Web Client.

It captures clients, Sessions, Subscriptions, listeners, Item Updates, snapshots, and COMMAND key lifecycles. The workspace has Runtime Scope, Ordered Evidence, and Context.

Key features:

- Select the page, client, Session, Subscription, item, or listener in Runtime Scope. You can inspect retired objects, but you cannot use them as Local Injection targets.
- Read compact operation codes, complete single-line keys, and captured data in retained order. Op stays pinned while keys and data scroll horizontally. Open Codes for the Lightstreamer and Workbench lifecycle reference.
- Read JSON string fields in a clearly marked readable view, or use Raw fields to preserve captured types. Complete data and exact event metadata remain in Context.
- Use a consistent Off / Include / Exclude control for Evidence and notification filters. Workbench uses dark mode in every system appearance.
- Use Find, Filter, selection, Capture, Coverage, and Live or Frozen independently.
- Select an event to inspect its Fields, raw Evidence, Source, COMMAND details, and limits in Context.
- Capture outbound Client Messages and their normal listener outcomes as ordered Evidence.
- Review active conditions and recent Lightstreamer diagnostics in Notifications. Dismiss hides only the footer message.
- Trace COMMAND `ADD`, `UPDATE`, and `DELETE` operations. Use Fields, diagnostics, and Checkpoints for more detail.
- Create one protected Local Injection Draft from captured Evidence or from a live COMMAND Scope.
- Edit raw JSON and validate the Draft. Captured Drafts compare Source and Draft by default, then inject directly from that preview.
- Use a Local Injection Scenario for ordered Steps, immutable reviewed Runs, serial controls, Checkpoints, and results for each Step.
- Deliver an Item Update to the exact live Subscription in the inspected page. Workbench reports delivered, failed, partial, unknown, and stale-target results.
- Create a protected Server Injection Draft from captured Client Message Evidence, author one for an exact live client and Session, or start from an application-owned Message Recipe.
- Review every LightstreamerClient.sendMessage argument, then send the Client Message once through the inspected application's normal client-to-server path.
- Treat Processed as a Lightstreamer message outcome, not proof of an application business effect or later Server Update. Workbench never retries an Unknown outcome automatically.
- Use WebSocket/TLCP fallback diagnostics when the primary Web Client instrumentation is not available.
- Keep one temporary Event History for each Panel Session. IndexedDB can keep 100,000 records or 256 MiB. The memory fallback can keep 25,000 records or 128 MiB.
- Use the Committed Evidence Boundary to find the end of complete History. Retention removes the oldest accepted prefix while Capture continues and reports the resulting Evidence Gap explicitly.
- A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty.
- Usage analytics helps improve feature adoption and reliability. It sends fixed feature names, engagement time, coarse outcomes, and a random installation identifier to Google Analytics. It is on by default and can be turned off in More actions → Help & resources → Usage analytics. Captured data, inspected URLs, and typed text stay local.
- No advertising, account sign-in, or maintainer-operated collection backend.
- Help links open the project documentation, privacy policy, and support page.

Use this extension to inspect and test Lightstreamer behavior in Chrome DevTools.
```

## Screenshot Upload Order

Remove every legacy screenshot that shows the retired three-section interface before uploading this 2.0 set.

1. `screenshots/01-workspace-context.png`
   - Caption: Select a Runtime Scope. Read events in order. Inspect the selected update Fields in Context.
2. `screenshots/02-ordered-evidence-context.png`
   - Caption: Inspect the complete raw Evidence, Source, and Lightstreamer runtime context for an event.
3. `screenshots/03-local-injection-editor.png`
   - Caption: Compare, edit, validate, and inject one protected Local Injection Draft from the same preview.
4. `screenshots/04-notifications.png`
   - Caption: Review active Workbench conditions and recent Lightstreamer diagnostics in Notifications.
5. `screenshots/05-server-injection.png`
   - Caption: Review the exact client, Session, and sendMessage arguments before one deliberate Client Message send.

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
2.0.4
```

What's new:

```text
Full-key JSON Evidence stream and capture reliability improvements.

- Compact historical operation codes with a Codes reference panel.
- Complete single-line keys and horizontally scrollable data; only Op stays pinned.
- Readable JSON and Raw fields with preserved captured types and bounded inline previews.
- Consistent Off / Include / Exclude filters and dark-only appearance.
- Improved IndexedDB commit throughput, larger memory fallback, and clearer storage diagnostics.
- Correct grouped COMMAND edit validation and clean content-bridge retirement after extension reloads.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data in the browser extension context. Each Panel Session owns one temporary Event History. IndexedDB can keep 100,000 Evidence records or 256 MiB. The memory fallback can keep 25,000 records or 128 MiB. After bounded journal retries fail, Workbench continues in memory for the rest of the Panel Session and reports the storage change and failure reason. The extension does not send captured Evidence to the maintainers, an analytics service, or another external service.

Complete History ends at the current History Interval's Committed Evidence Boundary. Retention removes the oldest accepted prefix while Capture continues and reports the resulting Evidence Gap explicitly. Clear makes an exact History Interval cut. A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty and does not load earlier Evidence. Capture, Coverage, History Capacity, and Live or Frozen are independent. The memory fallback does not reduce Coverage by itself.

The analytics candidate sends fixed Workbench feature names, foreground engagement time, coarse outcomes, extension version, event time, and a random installation identifier to Google Analytics 4. Analytics is enabled by default in configured builds. More actions → Help & resources → Usage analytics provides a persistent off switch. Turning it off stops collection and removes the identifier and analytics session. Captured Evidence, payloads, inspected URLs, search text, clipboard/export content, and raw errors are never sent. Workbench does not sell data, use analytics for advertising, require sign-in, or operate a maintainer collection server.

Workbench uses host and page access to observe the official Lightstreamer Web Client. It also uses this access for Local Injection in the inspected page. Local Injection does not contact the Lightstreamer Server. Workbench creates a JSON or offline HTML export only when the user requests it. Each export excludes credentials and creates a local download.
```

Privacy questionnaire note:

```text
For the analytics candidate, declare collection of user activity and the pseudonymous installation identifier in the dashboard's applicable categories. Describe the fixed product events, Google Analytics recipient, default-on behavior, and off switch. Do not claim that all data stays on the device. Captured website content, message bodies, credentials, browsing history, search text, and raw errors remain excluded from collection. Explain storage permission for preferences/identity and https://www.google-analytics.com/* host access for Measurement Protocol. Keep dashboard answers, listing, and policy consistent before publishing. Earlier no-analytics releases retain their original disclosures.
```

Single purpose description:

```text
Provide a Chrome DevTools panel that observes official Lightstreamer Web Client activity, reconstructs runtime and COMMAND Evidence, and lets developers test Item Updates locally or send reviewed Client Messages through the inspected client's current Session.
```

Storage permission justification:

```text
The storage permission keeps the user's usage-analytics preference and a random installation identifier. Turning analytics off removes the identifier and analytics session. It is not used for captured Lightstreamer Evidence; each Panel Session owns a temporary Event History in IndexedDB with a bounded memory fallback.
```

Host permission justification:

```text
Page access is required to run packaged instrumentation at document_start before the application creates Lightstreamer clients or Subscriptions. It observes the official Web Client, captures outbound Client Messages, and supports developer-requested Local Injection. https://www.google-analytics.com/* is used only by the packaged service worker to send fixed usage events while enabled. Captured Evidence, payloads, inspected URLs, search text, Drafts, and raw errors are excluded. No remote code is loaded.
```

## Reviewer Test Instructions

```text
No account is required. Open DevTools on a page using the official Lightstreamer Web Client and select Lightstreamer Workbench. Capture appears in Ordered Evidence. For Local Injection, create a Draft from an Item Update and choose Inject locally. For Server Injection, clone captured Client Message Evidence or author one for a live client, review the sendMessage arguments, then choose Send Client Message once. Usage analytics is under More actions > Help & resources and can be turned off.
```

## Version 2.0.2 Release Checklist (historical)

- [x] Confirm `public/manifest.json` version matches `package.json`.
- [x] Run `npm run release:package`.
- [x] Upload `release/lightstreamer-workbench-v2.0.2.zip`.
- [x] Upload `public/icons/icon-128.png` as the store icon.
- [x] Upload all four screenshots in the order listed above.
- [x] Upload `store-listing/promo/small-promo-tile.png`.
- [x] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [x] Confirm the package-derived summary and paste the detailed description from this file.
- [x] Review the privacy practices answer before submission.
- [x] Remove the retired product-usage analytics and identifier declarations from the dashboard privacy fields.
- [x] Confirm the packaged build contains no analytics endpoint, configuration, event, or identifier residue.
- [x] Confirm the packaged Manifest V3 has no new storage permission and no `unlimitedStorage` declaration.
- [x] Confirm the final Event History real-Chrome report is `PASS`, or retain the explicit maintainer-accepted `REVIEW` disposition in the internal Project ticket; a `FAIL` blocks publication.
- [x] Confirm the privacy policy URL is `https://imom39a.github.io/lightstreamer-workbench-extension/privacy/`.
- [x] Confirm the support URL is `https://imom39a.github.io/lightstreamer-workbench-extension/support/`.
- [ ] Confirm the homepage URL is `https://imom39a.github.io/lightstreamer-workbench-extension/` and staged publishing remains enabled.

## Version 2.0.3 Preparation Checklist (historical)

- [x] Confirm `public/manifest.json`, `package.json`, and the package lock use version `2.0.3`.
- [x] Run `npm run analytics:validate` with the dedicated production measurement configuration and confirm the DebugView probes.
- [x] Run `npm run store:assets` and inspect all five current screenshots, including Server Injection Review.
- [x] Run `npm run release:package` and record the ZIP size, integrity result, and SHA-256.
- [x] Run `npm run docs:check` and `npm run test:site`.
- [x] Publish the matching website and privacy policy before submitting the Store candidate.
- [x] Upload `release/lightstreamer-workbench-v2.0.3.zip` as a draft.
- [x] Replace the Store description, reviewer instructions, icon, five screenshots, and promo tiles from this directory; keep the release notes above ready for submission.
- [x] Update the privacy questionnaire for usage analytics, the random installation identifier, captured website content, `storage`, and Google's collection host.
- [x] Confirm the homepage, support, and privacy policy URLs.
- [ ] Confirm staged publishing during the later Store review submission.
- [x] Obtain the Material UI visual-QA disposition; maintainer approval is still required before Store review submission.

## Version 2.0.4 Preparation Checklist

- [x] Include all maintainer-authorized pending changes and the prior capture reliability, filter and dark-mode fixes.
- [x] Confirm package, lockfile and manifest version `2.0.4`, with unchanged permissions.
- [x] Regenerate and independently review all five 1280×800 screenshots from the production component.
- [x] Prepare the matching description and release notes above.
- [x] Verify the full unit suite, official-client journeys, extension reload and 100,500-event rolling-capacity proof.
- [x] Build and audit `release/lightstreamer-workbench-v2.0.4.zip`: 467,424 bytes; ZIP integrity passes.
- [x] Record SHA-256: `ba105d4cf2319ebd787b7a168a025cdb26d712a083fc08693fe9fb61cf896433`.
- [ ] Upload the package through the existing Chrome publisher session.
- [ ] Replace the description and five screenshots, save, and submit for Store review.
- [ ] Verify the Store's actual review/publication status.

The maintainer explicitly authorized this release. The Chrome session currently requires the Mac to be unlocked; version 2.0.4 has not been uploaded or submitted. Detailed verification is recorded in [`key-json-stream-evidence.md`](../docs/agents/key-json-stream-evidence.md).
