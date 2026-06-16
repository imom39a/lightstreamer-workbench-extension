# Lightstreamer Event Workbench

Lightstreamer Event Workbench is an open-source Chrome DevTools extension for debugging web applications that use the official Lightstreamer Web Client. It captures clients, subscriptions, item updates, snapshots, COMMAND-mode key lifecycles, and synthetic local replays so developers can inspect and reproduce streaming behavior without backend access.

[Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) | [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-event-workb/kfpgbhfphbhkebglopimjhfnnmbifocf) | [Source](https://github.com/imom39a/lightstreamer-workbench-extension/) | [Contributing](CONTRIBUTING.md) | [Privacy](PRIVACY.md) | [Security](SECURITY.md) | [Release notes and publishing](RELEASE.md)

<p align="center">
  <img src="docs/assets/mascot.png" alt="Lightstreamer Event Workbench mascot" width="180">
</p>

![COMMAND State view showing active keys and selected key lifecycle](store-listing/screenshots/01-command-state-active-keys.png)

## Project Status

Version `0.1.1` is the current bug-fix package. Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-event-workb/kfpgbhfphbhkebglopimjhfnnmbifocf), or build from source and load the generated `dist/` directory as an unpacked extension.

The first release focuses on in-memory debugging for the current inspected tab. The UI and internal event envelope may evolve as more Lightstreamer workflows are validated.

## What The Extension Does

- Adds a `Lightstreamer Event Workbench` panel to Chrome DevTools.
- Instruments the inspected page at `document_start` to observe official Lightstreamer Web Client constructors and listeners.
- Captures client, subscription, listener, item update, snapshot, and COMMAND lifecycle events into an in-memory event store.
- Shows a searchable Timeline with normalized event envelopes and raw diagnostic payloads.
- Reconstructs COMMAND state by subscription, item, key, command, snapshot state, provenance, and diagnostics.
- Lets developers clone compatible captured updates, edit fields, and locally reinject synthetic updates through captured listener paths.
- Provides WebSocket/TLCP fallback diagnostics when primary Web Client API instrumentation is unavailable.
- Marks synthetic events clearly so local replay activity is distinguishable from server-originated updates.

## What It Does Not Do

- It does not send captured data to this project, the maintainers, analytics services, or any external backend.
- It does not persist captured events after the current DevTools/tab session in v1.
- It does not inject data into the real Lightstreamer server stream.
- It does not provide app-specific interpretation rules in the core product.
- It does not treat arbitrary WebSocket protocols as first-class Lightstreamer domain models.

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

Please keep the core model Lightstreamer-native. App-specific business objects should stay out of capture, normalization, COMMAND state, and synthetic replay core modules unless they are introduced as optional adapters.

## Documentation

- [Project site](https://imom39a.github.io/lightstreamer-workbench-extension/) - public GitHub Pages site and product overview.
- [Chrome Web Store](https://chromewebstore.google.com/detail/lightstreamer-event-workb/kfpgbhfphbhkebglopimjhfnnmbifocf) - official extension listing.
- [Source repository](https://github.com/imom39a/lightstreamer-workbench-extension/) - source code, issues, and pull requests.
- [CONTRIBUTING.md](CONTRIBUTING.md) - contributor workflow, local setup, architecture, tests, and pull request process.
- [RELEASE.md](RELEASE.md) - release packaging, Chrome Web Store publishing, GitHub Pages deployment, and maintainer-only release flow.
- [MAINTAINERS.md](MAINTAINERS.md) - maintainer roles, official distribution boundaries, and release authority.
- [PRIVACY.md](PRIVACY.md) - extension privacy behavior and Chrome Web Store privacy language.
- [SECURITY.md](SECURITY.md) - security reporting path and sensitive-data guidance.
- [store-listing/](store-listing/) - Chrome Web Store listing copy, screenshots, icons, promo assets, and reviewer notes.

## Privacy And Safety

Lightstreamer Event Workbench runs locally in the browser extension context. Captured event data is kept in memory for the current tab/session and is not transmitted off-device by the extension.

The extension requests broad page access because it must instrument the inspected page's Lightstreamer Web Client runtime before application code creates clients or subscriptions. Use it only on pages you are authorized to debug, and avoid sharing screenshots or issue logs that contain production secrets, customer data, tokens, or proprietary event payloads.

Synthetic events are marked in the UI and event envelope. v1 local reinjection uses captured listener paths and does not create a real inbound Lightstreamer server event.

## Official Distribution

The Apache-2.0 license applies to source code and documentation in this repository unless a file states otherwise. It does not grant rights to publish updates to the official Chrome Web Store item or to reuse maintainer-controlled store listing identity, extension ID, logos, screenshots, support channels, or release credentials for unrelated distributions.

Maintainer release rules are documented in [RELEASE.md](RELEASE.md) and [MAINTAINERS.md](MAINTAINERS.md).

## External References

- [Lightstreamer Web Client API](https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/index.html)
- [Lightstreamer General Concepts](https://lightstreamer.com/ls-server/latest/docs/General%20Concepts.pdf)
- [Chrome DevTools panel extension API](https://developer.chrome.com/docs/extensions/reference/api/devtools/panels)
- [Chrome content script execution worlds](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

## License

Lightstreamer Event Workbench is licensed under the [Apache License 2.0](LICENSE).
