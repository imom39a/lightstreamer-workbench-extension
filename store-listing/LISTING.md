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

It captures client, subscription, listener, item update, snapshot, and COMMAND-mode key lifecycle activity from the inspected page, then shows it in a searchable in-memory workbench. Developers can inspect normalized Lightstreamer event envelopes, reconstruct current COMMAND state, review key lifecycles, and locally reinject edited synthetic updates through captured listener paths without backend access.

Key features:

- Timeline view for captured Lightstreamer clients, subscriptions, item updates, snapshots, and synthetic replays.
- COMMAND State view that groups active and deleted keys by subscription and item.
- Lifecycle detail for ADD, UPDATE, DELETE, snapshot, live, and synthetic COMMAND events.
- Draft editor for cloning captured updates and locally reinjecting safe synthetic events.
- New COMMAND update editor with schema-based fields, validation diagnostics, and listener-target checks.
- WebSocket/TLCP fallback diagnostics when primary Web Client instrumentation is unavailable.
- Current-tab in-memory state only; no backend service is required.

This extension is intended for developers and QA engineers who need to understand and reproduce Lightstreamer COMMAND subscription behavior inside Chrome DevTools.
```

## Screenshot Upload Order

1. `screenshots/01-command-state-active-keys.png`
   - Caption: COMMAND State groups active keys by subscription and item, with lifecycle results and selected-key detail.
2. `screenshots/02-timeline-event-detail.png`
   - Caption: Timeline view lists captured Lightstreamer updates and shows the normalized event envelope.
3. `screenshots/03-new-command-update-editor.png`
   - Caption: New COMMAND update editor validates schema fields before local listener-path injection.

## Graphic Assets

Store icon:

```text
public/icons/icon-128.png
```

Small promo tile:

```text
store-listing/promo/small-promo-tile.png
```

Marquee promo tile, optional:

```text
store-listing/promo/marquee-promo-tile.png
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
- [ ] Upload `release/lightstreamer-event-workbench-v0.1.0.zip`.
- [ ] Upload `public/icons/icon-128.png` as the store icon.
- [ ] Upload all three screenshots in the order listed above.
- [ ] Upload `store-listing/promo/small-promo-tile.png`.
- [ ] Optionally upload `store-listing/promo/marquee-promo-tile.png`.
- [ ] Paste the summary and detailed description from this file.
- [ ] Review the privacy practices answer before submission.
- [ ] Confirm distribution, support URL, homepage URL, and staged publishing settings in the dashboard.
