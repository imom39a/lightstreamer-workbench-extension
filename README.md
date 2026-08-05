# Lightstreamer Workbench

Lightstreamer Workbench is an open-source Chrome DevTools extension for debugging web applications that use the official Lightstreamer Web Client. It captures clients, subscriptions, item updates, snapshots, and COMMAND-mode key lifecycles so developers can diagnose streaming behavior and perform deliberate Local Injections without backend access.

[Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) | [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf) | [Source](https://github.com/imom39a/lightstreamer-workbench-extension/) | [Contributing](CONTRIBUTING.md) | [Privacy](PRIVACY.md) | [Security](SECURITY.md) | [Release notes and publishing](RELEASE.md)

<p align="center">
  <img src="docs/assets/mascot.png" alt="Lightstreamer Workbench mascot" width="180">
</p>

## Project Status

Version `0.1.5` is the current release. Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf), or build from source and load the generated `dist/` directory as an unpacked extension.

The first release focuses on local, current-session debugging for the inspected tab. The UI and internal event envelope may evolve as more Lightstreamer workflows are validated.

## What The Extension Does

- Adds a `Lightstreamer Workbench` panel to Chrome DevTools.
- Instruments the inspected page at `document_start` to observe official Lightstreamer Web Client constructors and listeners.
- Captures client, subscription, listener, item update, snapshot, and COMMAND lifecycle events into a temporary local event store for the current DevTools session.
- Presents the accepted React **Scoped Evidence Workspace**: structural Topology chooses Scope, Ordered Evidence remains the dominant investigation surface, and Context explains the active runtime object or selected Evidence.
- Keeps Capture operation, Coverage, Scope, Filter, Find, selection, and Live/Frozen Evidence position independent while retaining complete current-session history behind a bounded rendered window.
- Reconstructs **Observed Server COMMAND State** from captured Server Updates and **Local Effective COMMAND State** from Server Updates plus successful Local Injected Updates.
- Maintains exactly one target-anchored **Local Injection Draft**, created from an immutable selected Injection Source or authored from a live COMMAND scope, with raw JSON editing, validation, Review, and a persistent truthful outcome.
- Delivers a reviewed Local Injection through a captured listener or captured Lightstreamer WebSocket path in the inspected page.
- Provides WebSocket/TLCP fallback diagnostics when primary Web Client API instrumentation is unavailable.
- Marks successful Local Injected Update Evidence clearly so it remains distinguishable from Server Evidence.

## What It Does Not Do

- It does not send inspected URLs, Lightstreamer addresses, captured values, identifiers, search text, Injection Drafts, or error details to this project, the maintainers, analytics services, or any external backend.
- It does not intentionally retain captured events after the current DevTools/tab session; temporary local storage is reset on panel startup and cleared on normal panel teardown.
- It does not inject data into the real Lightstreamer server stream.
- It does not create a Lightstreamer client, call `connect()` or `subscribe()`, or establish a server session; capture only observes clients and WebSockets owned by the inspected page.
- It does not provide app-specific interpretation rules in the core product.
- It does not treat arbitrary WebSocket protocols as first-class Lightstreamer domain models.
- It does not enable optional product analytics unless the user accepts the in-panel disclosure.

## Who This Helps

Use this extension when you are:

- Debugging a page that uses the official Lightstreamer Web Client.
- Investigating COMMAND subscriptions, keyed rows, ADD/UPDATE/DELETE behavior, snapshots, or deleted-key lifecycles.
- Reproducing a streaming sequence locally when the backend event order is hard to trigger on demand.
- Comparing captured Lightstreamer primitives without relying on application-specific domain objects.
- QA testing a Lightstreamer integration from inside Chrome DevTools.

This is not a generic WebSocket inspector and is not a replacement for a Lightstreamer server, Data Adapter, or backend test harness.

## Open Source And Contributions

Contributions are welcome through GitHub issues and pull requests. The project is licensed under [Apache-2.0](LICENSE), and contributions intentionally submitted to this repository are provided under Apache-2.0 unless explicitly marked otherwise.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Issue reporting expectations and useful bug report details.
- Local development setup and source installation.
- Test, build, package, and fixture commands.
- Project architecture and repository layout.
- Pull request process and review expectations.
- Contribution license rules.

Please keep the core model Lightstreamer-native. App-specific business objects should stay out of Capture, normalization, COMMAND projections, and Local Injection core modules unless they are introduced as optional adapters.

## Documentation

- [Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) - public GitHub Pages site and product overview.
- [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf) - official extension listing.
- [Source repository](https://github.com/imom39a/lightstreamer-workbench-extension/) - source code, issues, and pull requests.
- [CONTRIBUTING.md](CONTRIBUTING.md) - contributor workflow, local setup, architecture, tests, and pull request process.
- [RELEASE.md](RELEASE.md) - release packaging, Chrome Web Store publishing, GitHub Pages deployment, and maintainer-only release flow.
- [MAINTAINERS.md](MAINTAINERS.md) - maintainer roles, official distribution boundaries, and release authority.
- [PRIVACY.md](PRIVACY.md) - extension privacy behavior and Chrome Web Store privacy language.
- [docs/ANALYTICS.md](docs/ANALYTICS.md) - opt-in event dictionary, GA4 custom definitions, and product-improvement reports.
- [SECURITY.md](SECURITY.md) - security reporting path and sensitive-data guidance.
- [store-listing/](store-listing/) - Chrome Web Store listing copy, screenshots, icons, promo assets, and reviewer notes.

## Privacy And Safety

Lightstreamer Workbench keeps captured event data in temporary local storage for the current DevTools/tab session; that data is not transmitted off-device by the extension. Lightstreamer-provided client IP addresses are irreversibly masked before they cross the inspected-page capture boundary, so the panel never receives or offers a toggle for the exact address. Retired structural Scope remains readable historical Evidence only.

Official builds may offer optional, opt-in Google Analytics for coarse product usage such as panel activation, Lightstreamer detection, Evidence search, Local Injection entry/target/outcome categories, and a bucketed event count. The extension creates a random analytics installation ID and sends requests only after the user accepts the prominent panel disclosure. Opt-out deletes that ID and blocks future analytics requests. Analytics adds no Chrome permission and never receives inspected-page URLs or captured Lightstreamer content; see [PRIVACY.md](PRIVACY.md) for the exact allowlist.

The extension requests broad page access because it must instrument the inspected page's Lightstreamer Web Client runtime before application code creates clients or subscriptions. Use it only on pages you are authorized to debug, and avoid sharing screenshots or issue logs that contain production secrets, customer data, tokens, or proprietary event payloads.

Every successful Local Injected Update is marked in the UI and event envelope. Local Injection must reach the inspected page: it uses either a captured listener callback or a synthetic TLCP update dispatched through the captured page WebSocket so the page's Lightstreamer client and application listeners receive it. Neither path contacts the Lightstreamer Server, and failed, stale, or uncertain delivery never creates successful Local Evidence.

## Official Distribution

The Apache-2.0 license applies to source code and documentation in this repository unless a file states otherwise. It does not grant rights to publish updates to the official Chrome Web Store item or to reuse maintainer-controlled store listing identity, extension ID, logos, screenshots, support channels, or release credentials for unrelated distributions.

Maintainer release rules are documented in [RELEASE.md](RELEASE.md) and [MAINTAINERS.md](MAINTAINERS.md).

## External References

- [Lightstreamer Web Client API](https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/index.html)
- [Lightstreamer General Concepts](https://lightstreamer.com/ls-server/latest/docs/General%20Concepts.pdf)
- [Chrome DevTools panel extension API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- [Chrome content script execution worlds](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

## License

Lightstreamer Workbench is licensed under the [Apache License 2.0](LICENSE).
