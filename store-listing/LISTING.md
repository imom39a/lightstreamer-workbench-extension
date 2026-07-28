# Chrome Web Store Listing Draft

## Basic Listing

Name:

```text
Lightstreamer Event Workbench
```

Summary, 87 characters:

```text
DevTools panel for inspecting and locally replaying Lightstreamer Web Client COMMAND updates.
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
Lightstreamer Event Workbench adds a Chrome DevTools panel for developers debugging web applications that use the official Lightstreamer Web Client.

It captures client, subscription, listener, item update, snapshot, and COMMAND-mode key lifecycle activity from the inspected page, then shows it in a searchable in-memory workbench with explicit retention status. Developers can inspect normalized Lightstreamer event envelopes, reconstruct current COMMAND state, review key lifecycles, and locally reinject captured or edited synthetic updates through captured listener or Lightstreamer WebSocket paths without backend access.

Key features:

- Timeline view for captured Lightstreamer clients, subscriptions, item updates, snapshots, and synthetic replays, with bounded rendering for high-volume sessions.
- COMMAND State view that groups active and deleted keys by subscription and item, with a selected-key update history.
- Single free-text search in Timeline and COMMAND State for event IDs, Lightstreamer fields, commands, keys, diagnostics, source, and JSON payloads.
- Collapsible detail panes, table headers, and clearer selected-row highlighting for faster scanning.
- Lifecycle detail for ADD, UPDATE, DELETE, snapshot, live, and synthetic COMMAND events, with diagnostics and update payloads surfaced first.
- Direct replay and edit-and-reinject actions for compatible captured updates, with request-scoped delivery feedback.
- New COMMAND update editor with schema-based fields, validation diagnostics, and listener-target checks.
- WebSocket/TLCP fallback diagnostics when primary Web Client instrumentation is unavailable.
- Current-tab in-memory state only; no backend service is required.
- Optional, consent-based coarse feature analytics that never includes inspected-page or captured Lightstreamer data.

This extension is intended for developers and QA engineers who need to understand and reproduce Lightstreamer COMMAND subscription behavior inside Chrome DevTools.
```

## Screenshot Upload Order

1. `screenshots/01-command-state-active-keys.png`
   - Caption: COMMAND State groups active and deleted keys by subscription and item, with selected-key update history and lifecycle detail.
2. `screenshots/02-timeline-event-detail.png`
   - Caption: Timeline view lists captured Lightstreamer updates with headers, single search, and normalized event detail.
3. `screenshots/03-new-command-update-editor.png`
   - Caption: New COMMAND update editor validates schema fields and listener-target diagnostics before local injection.

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
Reinjection workflow, reliability, and opt-in analytics release.

- Adds direct replay, edit-and-reinject, and new COMMAND update workflows with clearer target selection.
- Delivers synthetic updates through captured listener or Lightstreamer WebSocket paths and returns request-scoped success or failure feedback.
- Preserves selection, editor drafts, scrolling, and field positions during live capture and editing.
- Refreshes the panel with theme-aware styling, simpler JSON editing, and clearer replay results.
- Adds optional coarse usage analytics with prominent consent, a Not now path, and immediate opt-out; no inspected-page or captured payload data is sent.
- Makes the fixture tooling cross-platform and expands end-to-end reinjection and analytics coverage.
```

## Privacy Practices Draft

```text
Lightstreamer Event Workbench processes inspected-page Lightstreamer event data locally inside the browser DevTools session. Captured events are kept in temporary storage for the current tab/session and are not transmitted to the developer, this extension's authors, Google Analytics, or any other external service by the extension.

The extension offers optional coarse product-usage analytics through a dedicated Google Analytics 4 property. Analytics remains off until the user accepts a prominent disclosure in the DevTools panel. When enabled, events are limited to workbench panel/view use, whether Lightstreamer was detected, whether search or local replay was used, replay target/result categories, a bucketed captured-event count, extension version, session timing, and a random installation identifier. It never sends inspected URLs, Lightstreamer addresses, captured values or identifiers, item/field/key names, search text, replay drafts, raw errors, or stack traces. Advertising consent is denied and analytics is used only to improve the extension. Turning analytics off deletes the identifier and blocks future requests. The analytics integration adds no Chrome permission.

The extension does not use advertising, remote error logging, or account sign-in. It does not sell user data. Required host/page access is used to instrument the inspected page's Lightstreamer Web Client activity and to support developer-controlled local synthetic reinjection.
```

Privacy questionnaire note:

```text
Declare the extension's opt-in collection of coarse product interaction/user-activity metrics and the random analytics installation identifier. Disclose Google Analytics as the processor/recipient and product improvement as the sole use. Do not declare inspected URLs, browsing history, website content, Lightstreamer payloads, authentication information, or personal communications as transmitted: those remain local. Certify no sale, no advertising use, and no use outside the extension's single purpose. The privacy policy, listing, dashboard privacy fields, and in-product disclosure must remain identical in substance.
```

## Reviewer Test Instructions

```text
No account or login is required.

This is a Chrome DevTools extension. After installing it, open Chrome DevTools on a page that uses the official Lightstreamer Web Client and select the "Lightstreamer Event Workbench" panel. The panel stays idle until the inspected page creates Lightstreamer clients/subscriptions. Captured updates appear in the Timeline view; COMMAND subscriptions can be inspected in the COMMAND State view.

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
- [ ] Upload `release/lightstreamer-event-workbench-v0.1.5.zip`.
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
