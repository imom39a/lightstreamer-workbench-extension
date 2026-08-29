# Chrome Web Store Listing Draft

## Basic Listing

Name:

```text
Lightstreamer Workbench
```

Summary, 89 characters:

```text
Inspect Lightstreamer Web Client activity and test local Item Updates in Chrome DevTools.
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
Lightstreamer Workbench adds a Chrome DevTools panel for applications that use the official Lightstreamer Web Client.

It captures clients, Sessions, Subscriptions, listeners, Item Updates, snapshots, and COMMAND key lifecycles. The workspace has Runtime Scope, Ordered Evidence, and Context.

Key features:

- Select the page, client, Session, Subscription, item, or listener in Runtime Scope. You can inspect retired objects, but you cannot use them as Local Injection targets.
- Read events in retained order. Each row shows its event number, time, Source, phase, operation, object, and key.
- Use Find, Filter, selection, Capture, Coverage, and Live or Frozen independently.
- Select an event to inspect its Fields, raw Evidence, Source, COMMAND details, and limits in Context.
- Review active conditions and recent Lightstreamer diagnostics in Notifications. Dismiss hides only the footer message.
- Trace COMMAND `ADD`, `UPDATE`, and `DELETE` operations. Use Fields, diagnostics, and Checkpoints for more detail.
- Create one protected Local Injection Draft from captured Evidence or from a live COMMAND Scope.
- Edit raw JSON and validate the Draft. Captured Drafts compare Source and Draft by default, then inject directly from that preview.
- Use a Local Injection Scenario for ordered Steps, immutable reviewed Runs, serial controls, Checkpoints, and results for each Step.
- Deliver an Item Update to the exact live Subscription in the inspected page. Workbench reports delivered, failed, partial, unknown, and stale-target results.
- Use WebSocket/TLCP fallback diagnostics when the primary Web Client instrumentation is not available.
- Keep one temporary Event History for each Panel Session. IndexedDB can keep 100,000 records or 256 MiB. The memory fallback can keep 5,000 records or 32 MiB.
- Use the Committed Evidence Boundary to find the end of complete History. Clear ends the current History Interval and cannot restart stopped Capture.
- A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty.
- No product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer-operated backend.
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
Update for the Workbench workspace.

- Adds Local Injection Scenarios with immutable reviewed Runs, serial controls, Checkpoints, and results for each Step.
- Adds one Notifications document for active conditions and recent Lightstreamer diagnostics. Dismiss hides only the footer message.
- Adds a separate rail for retained Event order and a two-line layout for Scope items.
- Shows selected update Fields before the closed supporting sections in Context.
- Keeps the same Manifest V3 permissions, local-only data handling, temporary Event History, and Local Injection server boundary.
```

## Privacy Practices Draft

```text
Lightstreamer Workbench processes inspected-page Lightstreamer event data in the browser extension context. Each Panel Session owns one temporary Event History. IndexedDB can keep 100,000 Evidence records or 256 MiB. The memory fallback can keep 5,000 records or 32 MiB. Workbench does not change the storage type during the Panel Session. The extension does not send captured Evidence to the maintainers, an analytics service, or another external service.

Complete History ends at the current History Interval's Committed Evidence Boundary. Clear ends the current History Interval. It cannot restart Capture after a terminal stop. A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty and does not load earlier Evidence. Capture, Coverage, History Capacity, and Live or Frozen are independent. The memory fallback does not reduce Coverage by itself.

Version 2 has no product analytics, tracking, advertising, account sign-in, remote error logging, or maintainer server. It does not create an analytics identifier. It can remove old 0.1.x analytics consent and installation identifier records when local storage is available. This cleanup does not send data. A cleanup failure does not block the panel.

Workbench uses host and page access to observe the official Lightstreamer Web Client. It also uses this access for Local Injection in the inspected page. Local Injection does not contact the Lightstreamer Server. Workbench creates a JSON or offline HTML export only when the user requests it. Each export excludes credentials and creates a local download.
```

Privacy questionnaire note:

```text
Version 2 does not send user data off the device. Do not declare product analytics or an analytics identifier. State that Workbench processes website content in the current DevTools session. State that only a user-requested export creates a local file. Certify that Workbench does not sell data or use it for advertising. Certify that Workbench has no account sign-in or remote logging. Keep the dashboard answers, listing, and privacy policy consistent.
```

## Reviewer Test Instructions

```text
No account or login is required.

This is a Chrome DevTools extension. Open Chrome DevTools on a page that uses the official Lightstreamer Web Client. Select the "Lightstreamer Workbench" panel. The panel stays idle until the page creates a Lightstreamer client or Subscription. Captured activity appears in Ordered Evidence. Use Runtime Scope to select a client, Session, Subscription, item, or listener. Select Evidence to inspect it in Context. Use ordered operations, Fields, diagnostics, and Checkpoints to inspect COMMAND lifecycles.

To test Local Injection, select a compatible captured Item Update. Then select **Create Local Injection Draft**. You can also select **Author COMMAND Item Update** from an applicable live COMMAND Scope. Workbench protects one Draft. For captured Evidence, **Compare Source** is active by default. Edit the JSON, correct validation errors, verify the exact target, then select **Inject locally** on the same authoring surface. Workbench freezes and revalidates the Draft and target before delivery. The outcome document reports delivered, failed, partial, unknown, and stale-target results. It does not report an application business result.

Open **More actions**. Confirm that **Help & resources** has Documentation, Privacy, and Support links. Version 2 has no analytics control.

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
- [x] Upload all four screenshots in the order listed above.
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
