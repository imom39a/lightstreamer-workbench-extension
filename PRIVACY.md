# Privacy Policy

Lightstreamer Workbench is a Chrome DevTools extension for inspecting Lightstreamer Web Client behavior in the currently inspected browser tab. This policy also covers the public Lightstreamer Workbench website.

Canonical policy URL: https://imom39a.github.io/lightstreamer-workbench-extension/privacy/

## Current release

The Chrome Web Store serves version `2.0.0`, the unified Scoped Evidence Workspace release.

- **Current Chrome Web Store release:** no product analytics, tracking, advertising, account sign-in, or remote error logging. On startup, 2.0 removes retired analytics consent and random installation identifier records left by earlier versions.
- **Public website:** static HTML and CSS with no analytics, cookies, executable JavaScript, advertising, account sign-in, or remote error logging.

## Inspected-page data

Captured Lightstreamer clients, Sessions, Subscriptions, Item Updates, field values, COMMAND keys, diagnostics, Injection Sources, and Injection Drafts are processed locally in the browser extension context for the current inspected tab and DevTools session.

When the Lightstreamer Web Client exposes a client IP address, page-world instrumentation irreversibly masks it before constructing the Capture message. The exact address never crosses the inspected-page Capture boundary, is never available to Workbench, and cannot be restored with a UI toggle.

Workbench does not send inspected-page URLs, Lightstreamer Server addresses, adapter sets, client, Subscription, listener, item, field, or key identifiers, captured values, search text, Injection Sources, Injection Drafts, raw errors, stack traces, cookies, account details, or other captured Evidence to the maintainers or an analytics service.

## Local storage and exports

Version 2 stores current Panel Session Evidence in one temporary Event History owned by that Panel Session. The normal IndexedDB journal supports up to 10,000 Evidence records or 64 MiB of retained serialized journal bytes; if startup selects the in-memory fallback, the lower-capacity limits are 5,000 records or 32 MiB. The fallback changes History Capacity, not Observation Coverage, and the selected adapter does not change during a Panel Session.

Controlled Close makes a final intake cut, settles accepted work, attempts to erase the owned retained and pending data, and reports whether erasure and cleanup were confirmed. A crash, renderer termination, extension reload, or blocked cleanup can defer erasure and leave residual temporary data until a later ownership-safe guarded sweep. The sweep considers only recognized orphan generations, skips active owners, and never reads, exports, projects, or replays abandoned Evidence. A new Panel Session starts empty and has no cross-session recovery.

Versioned Topology JSON and offline HTML exports are deliberate user downloads. Workbench excludes connection credentials and masks client IP addresses before they enter Capture, but an export can still contain application data selected by the user. Review every export before sharing it.

The extension also uses local runtime state needed to connect the DevTools panel, background service worker, content script, and inspected page. It does not use cross-session capture as application state.

## Network access

Version 2 does not contact a maintainer-operated service or analytics provider. If the inspected page communicates with Lightstreamer servers or other application services, that traffic belongs to the inspected page, not to Workbench.

Local Injection delivers a deliberate update only through captured listener callbacks or the inspected page's local delivery path. It does not contact the Lightstreamer Server. Planned Server Injection will send a reviewed Client Message through the inspected client's normal `sendMessage` path; it will not directly inject an inbound server update.

## Permissions

Workbench requests page access so it can instrument the inspected page's official Lightstreamer Web Client runtime before application code creates clients or Subscriptions. This access is used for developer-controlled debugging in Chrome DevTools.

Permission changes must be documented in pull requests and release notes because expanded extension permissions affect user trust and Chrome Web Store review.

## User responsibility

Use Workbench only on pages you are authorized to debug. Do not attach raw production payloads, exports, screenshots with secrets, customer data, tokens, cookies, or private URLs to public issues or pull requests.

## Changes

Privacy-impacting changes require maintainer review before merge and must be reflected in this policy, Chrome Web Store privacy fields, and release notes before publication.
