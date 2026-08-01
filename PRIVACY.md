# Privacy Policy

Lightstreamer Workbench is a Chrome DevTools extension for inspecting Lightstreamer Web Client behavior in the currently inspected browser tab.

## Data Collection

Captured Lightstreamer clients, subscriptions, item updates, field values, COMMAND keys, diagnostics, and synthetic replay drafts are processed locally in the browser extension context for the current inspected tab/session.

When the Lightstreamer Web Client exposes a client IP address, page-world instrumentation irreversibly masks it before constructing the capture message. The exact address never crosses the inspected-page capture boundary, is never available to the Topology inspector, and cannot be restored with a UI toggle. Client IP addresses are never included in analytics; any future export feature must preserve this pre-boundary masking rule.

The extension offers optional usage analytics to help the maintainers understand which workbench features are useful and where coarse failures occur. Analytics is off until the user accepts the prominent disclosure inside the DevTools panel.

When enabled, the extension may send these allowlisted events to a dedicated Google Analytics 4 property:

- DevTools panel views and whether Lightstreamer activity was detected.
- Timeline or COMMAND State view selection.
- Whether search was used, without the search text.
- Local replay surface, listener/wire target category, edited/not-edited flag, and success or coarse failure category.
- A session summary with the captured-event total converted to a broad bucket, plus whether COMMAND State, search, or replay was used.
- Extension version, a random installation identifier, session timing fields, and standard request/device information received by Google when processing an HTTPS request.

The analytics path never receives inspected-page URLs, Lightstreamer server addresses, adapter sets, client/subscription/listener IDs, item/field/key names, captured values, search text, replay drafts, raw error messages, stack traces, cookies, account details, or a Google user ID. Advertising consent is explicitly denied in every request, personalized advertising is disabled, and the data is used only to improve the extension.

The project does not sell user data or use analytics data for advertising.

## Storage

Version 1 stores captured event data locally for the current DevTools/tab session. The panel may use temporary IndexedDB-backed storage so high-volume sessions can be queried without keeping every row in the DOM, but it resets that session storage on panel startup and clears it during normal panel teardown. If Chrome or DevTools exits abruptly before teardown completes, leftover temporary data is cleared the next time the panel starts for that inspected tab.

The extension may use normal Chrome extension runtime state required to connect the DevTools panel, background service worker, content script, and inspected page. This runtime state is local to the browser. If analytics is enabled, the extension also stores the consent choice and a randomly generated analytics installation identifier in extension-local storage. It does not fingerprint the device.

Turning analytics off from the panel removes the random installation identifier, records the opt-out locally, and blocks all future analytics requests. Re-enabling analytics requires another explicit action.

## Network Access

The extension does not send captured Lightstreamer event data to a maintainer-operated backend.

After opt-in only, bundled extension code sends the allowlisted usage events above directly to Google Analytics over HTTPS using the Google Analytics Measurement Protocol. The extension does not load remote analytics scripts or executable code. Google processes that data under the [Google Privacy Policy](https://policies.google.com/privacy).

If the inspected page itself communicates with Lightstreamer servers or other application services, that traffic belongs to the inspected page, not to this extension.

## Permissions

The extension requests page access so it can instrument the inspected page's official Lightstreamer Web Client runtime before application code creates clients or subscriptions. This access is used for local debugging in Chrome DevTools.

Analytics adds no Chrome permission. Its consented HTTPS requests go only to `https://www.google-analytics.com/mp/collect`.

Permission changes must be documented in pull requests and release notes because expanded extension permissions affect user trust and Chrome Web Store review.

## User Responsibility

Use the extension only on pages you are authorized to debug. Do not attach raw production payloads, screenshots with secrets, customer data, tokens, cookies, or private URLs to public GitHub issues or pull requests.

## Changes

Privacy-impacting changes require maintainer review before merge and must be reflected in this file, the Chrome Web Store privacy fields, and release notes before publication.
