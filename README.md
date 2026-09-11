# Lightstreamer Workbench

Lightstreamer Workbench is an open-source Chrome DevTools extension. Use it to inspect applications that use the official Lightstreamer Web Client. It captures clients, Sessions, Subscriptions, Item Updates, snapshots, COMMAND key lifecycles, and outbound Client Messages. Use Local Injection to test an Item Update in the page without a server change, or Server Injection to send one reviewed Client Message through the inspected client's current Session.

[Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) | [Documentation](https://imom39a.github.io/lightstreamer-workbench-extension/docs/) | [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf) | [Source](https://github.com/imom39a/lightstreamer-workbench-extension/) | [Privacy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/) | [Security](https://imom39a.github.io/lightstreamer-workbench-extension/security/) | [Support](https://imom39a.github.io/lightstreamer-workbench-extension/support/)

<p align="center">
  <img src="docs/assets/mascot.png" alt="Lightstreamer Workbench mascot" width="180">
</p>

## Project Status

Version `2.0.2` is the current public release. Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf). You can also build the source and load `dist/` as an unpacked extension.

This repository contains the `2.0.4` release candidate. Version `2.0.3` is currently published; the new package becomes available after Chrome Web Store review and publication.

Version 2 inspects the current Panel Session for the selected tab. Scope, Ordered Evidence, and Context are in one workspace. The public [roadmap](https://imom39a.github.io/lightstreamer-workbench-extension/roadmap/) lists planned work without release dates.

## What The Extension Does

- Adds a `Lightstreamer Workbench` panel to Chrome DevTools.
- Instruments the inspected page at `document_start` to observe official Lightstreamer Web Client constructors and listeners.
- Captures client, subscription, listener, item update, snapshot, COMMAND lifecycle, `sendMessage`, and `ClientMessageListener` outcome events into temporary session-scoped Event History for the current Panel Session.
- Shows Runtime Scope, Ordered Evidence, and Context in one React workspace.
- Keeps Capture, Coverage, Scope, Filter, Find, selection, and Live or Frozen independent.
- Keeps current-session Evidence through its Committed Evidence Boundary. The panel renders a limited set of rows at one time.
- Traces COMMAND `ADD`, `UPDATE`, and `DELETE` Evidence while internal derived state powers Draft validation, Scenarios, Checkpoints, and lifecycle diagnostics.
- Keeps one protected **Local Injection Draft** for one target. Create it from captured Evidence or from a live COMMAND Scope. Captured Drafts compare Source and Draft by default; edit, validate, and inject directly from that preview.
- Keeps one protected **Server Injection Draft** for one exact live client, Session, and page. Clone an immutable Captured Client Message or author one, optionally start from an application-owned Message Recipe, review the exact `sendMessage` arguments, and send it once through the inspected application's normal client-to-server path.
- Provides a temporary **Local Injection Scenario** for ordered Steps and optional Checkpoints. Review creates an immutable Run. Each Step makes one Local Injection request and gets one result.
- Delivers Drafts and Scenario Steps through a captured listener or Lightstreamer WebSocket path in the inspected page.
- Provides WebSocket/TLCP fallback diagnostics when primary Web Client API instrumentation is unavailable.
- Marks successful Local Injected Update Evidence clearly so it remains distinguishable from Server Evidence.

### Event History contract

Each Panel Session owns one temporary Event History. The normal IndexedDB journal
uses a rolling retention budget of 100,000 Evidence records or 256 MiB of
canonical accounted bytes. Memory-backed operation uses the smaller rolling
budget of 25,000 records or 128 MiB. Event History retries a definitively aborted
commit a bounded number of times and can continue in memory when IndexedDB is
unavailable. Storage degradation does not by itself reduce Observation Coverage
or alter Live/Frozen view state.

Evidence is complete only through the current History Interval's Committed
Evidence Boundary and only when no Evidence Gap has occurred. Reaching a
retention budget quietly removes the oldest accepted prefix while later Capture
continues. A candidate that cannot enter any canonical segment creates an exact,
visible Evidence Gap; later valid activity remains eligible. Clear remains the
only deliberate History Interval reset.

## What It Does Not Do

- It does not send inspected URLs, Lightstreamer addresses, captured values, search text, Injection Drafts, or raw error details to this project, the maintainers, analytics services, or any external backend.
- It does not intentionally keep captured events after the current Panel Session. A controlled Close tries to erase Event History. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session starts empty.
- It does not inject an arbitrary Item Update into the real Lightstreamer server stream. Server Injection sends a Client Message through `LightstreamerClient.sendMessage`; only the server-side application decides what that message does.
- It does not automatically retry Server Injection. An Unknown outcome remains terminal until you deliberately prepare a separate Repeat, which may duplicate server-side effects.
- It does not create a Lightstreamer client, call `connect()` or `subscribe()`, or establish a server session; capture only observes clients and WebSockets owned by the inspected page.
- It does not provide app-specific interpretation rules in the core product.
- It does not treat arbitrary WebSocket protocols as first-class Lightstreamer domain models.
- It does not include advertising, account sign-in, remote error logging, or a maintainer-operated collection backend. Configured production builds send the limited usage analytics described below.

## Intended use

Use this extension to:

- Debug a page that uses the official Lightstreamer Web Client.
- Inspect COMMAND Subscriptions, keyed rows, ADD/UPDATE/DELETE behavior, snapshots, or deleted-key lifecycles.
- Test a streaming sequence locally when you cannot easily reproduce the server event order.
- Inspect captured Lightstreamer data without application-specific business objects.
- Inspect application Client Messages and deliberately reproduce one through the exact current client and Session.
- Test a Lightstreamer integration in Chrome DevTools.

This is not a generic WebSocket inspector and is not a replacement for a Lightstreamer server, Data Adapter, or backend test harness.

## Open Source And Contributions

Use GitHub issues and pull requests to contribute. The project uses the [Apache-2.0](LICENSE) license. A contribution to this repository uses Apache-2.0 unless it has a different explicit license.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Issue reporting expectations and useful bug report details.
- Local development setup and source installation.
- Test, build, package, and fixture commands.
- Project architecture and repository layout.
- Pull request process and review expectations.
- Contribution license rules.

Keep the core model based on Lightstreamer terms. Do not add application-specific business objects to Capture, normalization, COMMAND state, Local Injection, or Server Injection core modules. Add them only as optional adapters.

## Documentation

- [Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) - product overview.
- [Public documentation](https://imom39a.github.io/lightstreamer-workbench-extension/docs/) - install, workspace, Evidence, COMMAND lifecycle, Local Injection, export, and troubleshooting guides.
- [Roadmap](https://imom39a.github.io/lightstreamer-workbench-extension/roadmap/) and [release notes](https://imom39a.github.io/lightstreamer-workbench-extension/releases/) - planned work and version history.
- [Privacy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/), [security](https://imom39a.github.io/lightstreamer-workbench-extension/security/), and [support](https://imom39a.github.io/lightstreamer-workbench-extension/support/) - policies and support.
- [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf) - official extension listing.
- [Source repository](https://github.com/imom39a/lightstreamer-workbench-extension/) - source code, issues, and pull requests.
- [CONTRIBUTING.md](CONTRIBUTING.md) - contributor workflow, local setup, architecture, tests, and pull request process.
- [RELEASE.md](RELEASE.md) - release packaging, Chrome Web Store publishing, GitHub Pages deployment, and maintainer-only release flow.
- [MAINTAINERS.md](MAINTAINERS.md) - maintainer roles, official distribution boundaries, and release authority.
- [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md) - repository sources used to build the matching first-party policy routes.
- [store-listing/](store-listing/) - Chrome Web Store listing copy, screenshots, icons, promo assets, and reviewer notes.

## Privacy And Safety

Lightstreamer Workbench keeps captured event data, including Client Message bodies and Injection Drafts, in one temporary Event History for the Panel Session. The extension does not send this data to the maintainers or an analytics service. Complete History ends at the current History Interval's Committed Evidence Boundary. Workbench masks Lightstreamer client IP addresses before the panel receives them. The panel cannot show the exact address. Bulk retained-Evidence copies always redact Client Message bodies and outcome text; complete local raw Evidence remains a deliberate per-event action. You can inspect a retired Scope, but you cannot use it for Injection.

The repository candidate adds usage analytics, enabled by default in configured production builds. It sends fixed feature names, foreground engagement, coarse outcomes, and a random installation identifier to Google Analytics. Turn it off under **More actions → Help & resources → Usage analytics**; this removes the saved analytics identifier. Captured data and typed text stay local. See [analytics setup and reports](docs/USAGE_ANALYTICS.md). The public website remains static HTML and CSS without analytics, cookies, or JavaScript. Read the [privacy policy](https://imom39a.github.io/lightstreamer-workbench-extension/privacy/) for more information.

The extension needs broad page access to observe the Lightstreamer Web Client before the application creates clients or Subscriptions. Use Workbench only on pages that you have permission to inspect. Do not share screenshots or logs that contain secrets, customer data, tokens, or proprietary payloads.

Workbench marks each successful Local Injected Update in the UI and event envelope. Local Injection uses a captured listener callback or a synthetic TLCP update on the captured page WebSocket. Both paths deliver to the inspected page. Neither path contacts the Lightstreamer Server. A failed, stale, or uncertain delivery does not create successful Local Evidence.

Server Injection is a real inspected-page network action. Workbench calls the selected page-owned client's public `sendMessage` API once after review and listens for the normal Lightstreamer outcome callbacks. A Processed result proves that Lightstreamer handled the Client Message, not that a downstream business effect or later Server Update occurred. Workbench never retries an Unknown outcome automatically.

## Official Distribution

The Apache-2.0 license applies to source code and documentation unless a file states a different license. It does not give permission to publish updates to the official Chrome Web Store item. It does not give permission to use maintainer-controlled listing text, extension ID, logos, screenshots, support channels, or release credentials for an unrelated distribution.

Maintainer release rules are documented in [RELEASE.md](RELEASE.md) and [MAINTAINERS.md](MAINTAINERS.md).

## External References

- [Lightstreamer Web Client API](https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/index.html)
- [Lightstreamer General Concepts](https://lightstreamer.com/ls-server/latest/docs/General%20Concepts.pdf)
- [Chrome DevTools panel extension API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- [Chrome content script execution worlds](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

## License

Lightstreamer Workbench is licensed under the [Apache License 2.0](LICENSE).
