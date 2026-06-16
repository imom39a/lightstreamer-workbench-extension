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

It captures client, subscription, listener, item update, snapshot, and COMMAND-mode key lifecycle activity from the inspected page, then shows it in a searchable in-memory workbench with explicit retention status. Developers can inspect normalized Lightstreamer event envelopes, reconstruct current COMMAND state, review key lifecycles, and locally reinject edited synthetic updates through captured listener paths without backend access.

Key features:

- Timeline view for captured Lightstreamer clients, subscriptions, item updates, snapshots, and synthetic replays, with bounded rendering for high-volume sessions.
- COMMAND State view that groups active and deleted keys by subscription and item, with a selected-key update history.
- Single free-text search in Timeline and COMMAND State for event IDs, Lightstreamer fields, commands, keys, diagnostics, source, and JSON payloads.
- Collapsible detail panes, table headers, and clearer selected-row highlighting for faster scanning.
- Lifecycle detail for ADD, UPDATE, DELETE, snapshot, live, and synthetic COMMAND events, with diagnostics and update payloads surfaced first.
- Draft editor for cloning captured updates and locally reinjecting safe synthetic events.
- New COMMAND update editor with schema-based fields, validation diagnostics, and listener-target checks.
- WebSocket/TLCP fallback diagnostics when primary Web Client instrumentation is unavailable.
- Current-tab in-memory state only; no backend service is required.

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
0.1.1
```

What's new:

```text
Bug-fix release focused on high-volume debugging and DevTools panel readability.

- Shows retained, total, and pruned event counts so event-store limits are explicit during long sessions.
- Keeps Timeline rendering responsive by bounding visible high-volume event lists and prompting users to narrow search results.
- Replaces dense Timeline and COMMAND State filter rows with one free-text search per view.
- Adds visible table headers, collapsible detail panes, and clearer full-row selection highlighting.
- Fixes help popups so tooltip text is visible on hover/focus and avoids viewport clipping.
- Reorganizes event detail sections so raw diagnostics and useful update payloads are easier to inspect.
```

## Privacy Practices Draft

```text
Lightstreamer Event Workbench processes inspected-page Lightstreamer event data locally inside the browser DevTools session. Captured events are kept in memory for the current tab/session and are not transmitted to the developer, this extension's authors, or any external service by the extension.

The extension does not use analytics, advertising, remote logging, or account sign-in. It does not sell or transfer user data. Host/page access is used only to instrument the inspected page's Lightstreamer Web Client activity and to support developer-controlled local synthetic reinjection through captured listener callbacks.
```

Privacy questionnaire note:

```text
Recommended answer for data handling review: no off-device collection or sale. The extension locally processes website content/event payloads from the inspected page, so review Chrome Web Store privacy fields carefully and disclose local processing if prompted.
```

## Reviewer Test Instructions

```text
No account or login is required.

This is a Chrome DevTools extension. After installing it, open Chrome DevTools on a page that uses the official Lightstreamer Web Client and select the "Lightstreamer Event Workbench" panel. The panel stays idle until the inspected page creates Lightstreamer clients/subscriptions. Captured updates appear in the Timeline view; COMMAND subscriptions can be inspected in the COMMAND State view.

For deterministic local verification from the repository:

1. Run `npm ci`.
2. Run `npm run release:package`.
3. Load the generated `dist/` directory as an unpacked extension in Chrome.
4. Run `npm run fixture:test` to verify the bundled Lightstreamer fixture smoke path.
```

## Release Checklist

- [ ] Confirm `public/manifest.json` version matches `package.json`.
- [ ] Run `npm run release:package`.
- [ ] Upload `release/lightstreamer-event-workbench-v0.1.1.zip`.
- [ ] Upload `public/icons/icon-128.png` as the store icon.
- [ ] Upload all three screenshots in the order listed above.
- [ ] Upload `store-listing/promo/small-promo-tile.png`.
- [ ] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [ ] Paste the summary and detailed description from this file.
- [ ] Review the privacy practices answer before submission.
- [ ] Confirm distribution, support URL, homepage URL, and staged publishing settings in the dashboard.
