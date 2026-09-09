# Privacy Policy

Lightstreamer Workbench is a Chrome DevTools extension for inspecting Lightstreamer Web Client behavior in the currently inspected browser tab. This policy also covers the public Lightstreamer Workbench website.

Canonical policy URL: https://imom39a.github.io/lightstreamer-workbench-extension/privacy/

## Builds covered

- **Repository candidate with the Usage analytics control:** version `2.0.3` collects the limited product-usage data described below, enabled by default in configured production builds. This policy does not imply that the candidate has been published to the Chrome Web Store.
- **Current Chrome Web Store release:** version `2.0.2` has no product analytics, tracking, advertising, account sign-in, or remote error logging. This and earlier v2 packages remove old analytics settings and installation identifier records at startup.
- **Public website:** static HTML and CSS. It has no analytics, cookies, JavaScript, advertising, account sign-in, or remote error logging.

The repository candidate also captures inspected-page Client Messages and implements deliberate Server Injection. This candidate is not a statement that the Chrome Web Store package has been published.

## Usage analytics

Configured production builds use Google Analytics 4 to understand feature adoption, investigation journeys, foreground engagement time, and coarse failure categories. Analytics is on by default. Open **More actions → Help & resources → Usage analytics** and turn off **Share usage analytics** to stop collection. No sign-in is required.

Events contain fixed Workbench action and screen names, coarse Capture and Injection outcomes, extension version, event time, foreground duration, and a random installation identifier. The identifier distinguishes installations and returning use; it is pseudonymous, not a named user account. Workbench does not create a browser fingerprint or join this identifier to Chrome Web Store visitors. Analytics is not used for advertising, and requests deny advertising personalization and advertising user-data use.

The preference and identifier use extension-local storage. The analytics session uses browser-session storage and expires after thirty minutes without reported activity. These records are separate from captured Event History. Opt-out stops sending, aborts an active request where possible, discards queued events, and removes the identifier and analytics session. It does not retract events already received by Google. Enabling analytics later starts fresh without uploading a backlog. No event queue is saved to disk. Missing configuration or unavailable storage pauses collection without blocking Workbench.

Google receives HTTPS analytics requests and the network IP address used to contact its service. Workbench does not include inspected-page IP addresses or geographic information in those requests. Google processes received analytics data under its [privacy policy](https://policies.google.com/privacy) and the property's retention settings. Workbench does not sell analytics data.

## Inspected-page data

Workbench processes captured Lightstreamer data in the browser extension context. This data includes clients, Sessions, Subscriptions, Item Updates, field values, COMMAND keys, Client Message bodies and outcomes, diagnostics, Injection Sources, and Local or Server Injection Drafts. The data applies to the current inspected tab and DevTools session.

If the Lightstreamer Web Client provides a client IP address, Workbench masks it before it creates the Capture message. Workbench cannot reverse the mask. The exact address does not cross the inspected-page Capture boundary. The UI cannot restore it.

Workbench does not send captured Evidence to the maintainers or an analytics service. This Evidence includes inspected-page URLs, Lightstreamer Server addresses, adapter sets, runtime identifiers, captured values, search text, Injection Sources, Injection Drafts, errors, stack traces, cookies, and account details.

## Local storage and exports

Version 2 stores current Panel Session Evidence in one temporary Event History. IndexedDB can retain 100,000 Evidence records or 256 MiB. The memory fallback can retain 5,000 records or 32 MiB. Reaching either limit removes the oldest accepted prefix while later valid Capture continues. A candidate that cannot enter any canonical segment creates an explicit Evidence Gap; later valid activity remains eligible. The memory fallback reduces History Capacity. It does not reduce Coverage by itself. Workbench does not change the storage type during a Panel Session.

A controlled Close stops intake and commits accepted work. It then tries to erase retained and pending data. Workbench reports whether it confirmed erasure and cleanup. A crash, renderer stop, extension reload, or blocked cleanup can prevent erasure. Residual data can remain until a later safe cleanup. Cleanup removes only recognized unused Workbench data. It does not read, export, derive state from, or load this Evidence. A new Panel Session starts empty.

Workbench creates a versioned JSON or offline HTML export only when the user requests it. Workbench excludes connection credentials. It masks client IP addresses before Capture. Structural exports do not include Client Message bodies. A bulk retained-Evidence clipboard copy always redacts Client Message bodies, processed responses, and denial text. Opening and copying one complete raw event remains a deliberate local action. An export or copy can still contain other selected application data. Review each artifact before you share it.

The extension uses local runtime state to connect the DevTools panel, service worker, content script, and inspected page. It does not use captured data from an earlier Panel Session as application state.

## Network access

Configured builds with usage analytics contact `https://www.google-analytics.com/mp/collect` from the extension service worker while analytics is enabled. No remote analytics script is loaded. Earlier v2 packages without the Usage analytics control do not contact an analytics provider. The inspected page can separately communicate with Lightstreamer servers and application services. This traffic belongs to the inspected page, not to a Workbench maintainer service.

Local Injection delivers an Item Update through a captured listener or the inspected page's local delivery path. It does not contact the Lightstreamer Server.

In the repository candidate, Server Injection is an explicit inspected-page network action. After the user reviews the exact message, sequence, timeout, enqueue choice, client, Session, and page target, Workbench makes one call through that client's normal public `sendMessage` path. It does not contact a Data Adapter directly or create an inbound Server Update. A Processed outcome does not prove a downstream business effect. Workbench does not automatically retry an Unknown outcome; a deliberate Repeat is a separate call that may duplicate server-side effects.

## Permissions

Workbench requests page access to observe the official Lightstreamer Web Client before the application creates clients or Subscriptions. Workbench uses this access for developer-controlled inspection in Chrome DevTools.

The analytics candidate adds the `storage` permission for the usage preference and random identifier, and host access to `https://www.google-analytics.com/*` for event submission. Analytics is not added to content scripts or the inspected page. It does not require browser history or account access.

Document each permission change in the pull request and release notes. Chrome Web Store review includes extension permissions.

## User responsibility

Use Workbench only on pages that you have permission to inspect. Do not attach private data to a public issue or pull request. Private data includes production payloads, exports, screenshots with secrets, customer data, tokens, cookies, and private URLs.

## Changes

A maintainer must review each privacy change before merge. Update this policy, the Chrome Web Store privacy fields, and the release notes before publication.
