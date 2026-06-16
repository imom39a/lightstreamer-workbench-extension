# Privacy Policy

Lightstreamer Event Workbench is a Chrome DevTools extension for inspecting Lightstreamer Web Client behavior in the currently inspected browser tab.

## Data Collection

The extension does not collect, sell, transfer, or upload user data to this project, the maintainers, analytics providers, or external services.

Captured Lightstreamer clients, subscriptions, item updates, field values, COMMAND keys, diagnostics, and synthetic replay drafts are processed locally in the browser extension context for the current inspected tab/session.

## Storage

Version 1 stores captured event data in memory only. Captured events are not persisted by the extension after the current DevTools/tab session.

The extension may use normal Chrome extension runtime state required to connect the DevTools panel, background service worker, content script, and inspected page. This runtime state is local to the browser.

## Network Access

The extension does not send captured Lightstreamer event data to a maintainer-operated backend.

If the inspected page itself communicates with Lightstreamer servers or other application services, that traffic belongs to the inspected page, not to this extension.

## Permissions

The extension requests page access so it can instrument the inspected page's official Lightstreamer Web Client runtime before application code creates clients or subscriptions. This access is used for local debugging in Chrome DevTools.

Permission changes must be documented in pull requests and release notes because expanded extension permissions affect user trust and Chrome Web Store review.

## User Responsibility

Use the extension only on pages you are authorized to debug. Do not attach raw production payloads, screenshots with secrets, customer data, tokens, cookies, or private URLs to public GitHub issues or pull requests.

## Changes

Privacy-impacting changes require maintainer review before merge and must be reflected in this file, the Chrome Web Store privacy fields, and release notes before publication.
