# Privacy Policy

Lightstreamer Workbench is a Chrome DevTools extension for inspecting Lightstreamer Web Client behavior in the currently inspected browser tab. This policy also covers the public Lightstreamer Workbench website.

Canonical policy URL: https://imom39a.github.io/lightstreamer-workbench-extension/privacy/

## Current release

The Chrome Web Store serves version `2.0.0`.

- **Current Chrome Web Store release:** no product analytics, tracking, advertising, account sign-in, or remote error logging. At startup, version 2 removes old analytics settings and installation identifier records.
- **Public website:** static HTML and CSS. It has no analytics, cookies, JavaScript, advertising, account sign-in, or remote error logging.

## Inspected-page data

Workbench processes captured Lightstreamer data in the browser extension context. This data includes clients, Sessions, Subscriptions, Item Updates, field values, COMMAND keys, diagnostics, Injection Sources, and Injection Drafts. The data applies to the current inspected tab and DevTools session.

If the Lightstreamer Web Client provides a client IP address, Workbench masks it before it creates the Capture message. Workbench cannot reverse the mask. The exact address does not cross the inspected-page Capture boundary. The UI cannot restore it.

Workbench does not send captured Evidence to the maintainers or an analytics service. This Evidence includes inspected-page URLs, Lightstreamer Server addresses, adapter sets, runtime identifiers, captured values, search text, Injection Sources, Injection Drafts, errors, stack traces, cookies, and account details.

## Local storage and exports

Version 2 stores current Panel Session Evidence in one temporary Event History. IndexedDB can keep 100,000 Evidence records or 256 MiB. The memory fallback can keep 5,000 records or 32 MiB. The first count or byte limit stops admission. The memory fallback reduces History Capacity. It does not reduce Coverage by itself. Workbench does not change the storage type during a Panel Session.

A controlled Close stops intake and commits accepted work. It then tries to erase retained and pending data. Workbench reports whether it confirmed erasure and cleanup. A crash, renderer stop, extension reload, or blocked cleanup can prevent erasure. Residual data can remain until a later safe cleanup. Cleanup removes only recognized unused Workbench data. It does not read, export, derive state from, or load this Evidence. A new Panel Session starts empty.

Workbench creates a versioned JSON or offline HTML export only when the user requests it. Workbench excludes connection credentials. It masks client IP addresses before Capture. An export can still contain selected application data. Review each export before you share it.

The extension uses local runtime state to connect the DevTools panel, service worker, content script, and inspected page. It does not use captured data from an earlier Panel Session as application state.

## Network access

Version 2 does not contact a maintainer service or analytics provider. The inspected page can communicate with Lightstreamer servers and application services. This traffic belongs to the inspected page, not to Workbench.

Local Injection delivers an Item Update through a captured listener or the inspected page's local delivery path. It does not contact the Lightstreamer Server. Planned Server Injection will send a reviewed Client Message through the inspected client's normal `sendMessage` path. It will not create an inbound Server Update.

## Permissions

Workbench requests page access to observe the official Lightstreamer Web Client before the application creates clients or Subscriptions. Workbench uses this access for developer-controlled inspection in Chrome DevTools.

Document each permission change in the pull request and release notes. Chrome Web Store review includes extension permissions.

## User responsibility

Use Workbench only on pages that you have permission to inspect. Do not attach private data to a public issue or pull request. Private data includes production payloads, exports, screenshots with secrets, customer data, tokens, cookies, and private URLs.

## Changes

A maintainer must review each privacy change before merge. Update this policy, the Chrome Web Store privacy fields, and the release notes before publication.
