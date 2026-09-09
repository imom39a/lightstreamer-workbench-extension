---
status: accepted
---

# Measure extension usage with a closed analytics vocabulary

The maintainer requested GA4 product analytics, enabled by default, on 2026-09-02. This decision replaces the no-product-analytics release invariant for the new candidate. It does not change observational Capture, Event History ownership, or either Injection delivery boundary.

Use the GA4 Measurement Protocol from the extension service worker. The panel converts semantic actions and published state transitions to a closed, versioned vocabulary of Workbench features, screens, foreground engagement, and coarse outcomes. Both ends validate it. Captured Evidence, application-controlled strings, inspected URLs, identifiers, raw errors, stacks, search text, and Drafts never enter the transport. Core runtime and page instrumentation do not depend on analytics.

Usage analytics is on by default in configured production builds. A native disclosure and checkbox in More actions → Help & resources explains collection and persists the user's choice. Opt-out blocks sending immediately, aborts an active request, invalidates queued work, and erases the installation identifier and analytics session. Storage failure pauses collection without blocking Workbench. Legacy 0.1.x identifiers are erased, never reused.

A random installation identifier lives in `chrome.storage.local`. An analytics session, distinct from a Lightstreamer Session or Panel Session, lives in `chrome.storage.session` and expires after thirty minutes without reported activity. Foreground engagement excludes hidden, unfocused, and idle time. No event queue persists. Sending is bounded and best effort, without retries.

Use the dedicated Workbench usage property for engagement and the Chrome Web Store property for listing acquisition. Do not join their identities. Deny advertising consent fields; do not add account IDs or browser fingerprints.

## Considered options

- Listing metrics alone cannot explain activity inside Workbench.
- A remote analytics SDK would violate Manifest V3's executable-code boundary.
- A maintainer relay could conceal the ingestion key but would add a backend and data recipient. Initially use Chrome's documented direct Measurement Protocol approach. A bundled ingestion key is extractable and permits event submission, not report access. Reconsider a relay if collection abuse becomes a concrete problem.

## Consequences

- Add only the `storage` permission and Google Analytics host access. Keep analytics out of content scripts and inspected-page instrumentation.
- Keep the vocabulary and reporting setup in [Usage analytics](../USAGE_ANALYTICS.md). Any expansion is a data-boundary change.
- Update policy, Store disclosure draft, and release notes together. Publication requires normal release-manager approval.
- Treat the preference control as Material UI; preserve workspace responsibilities and keyboard restoration, and collect independent visual QA.
- Validate synthetic payloads against Google's non-collecting validation endpoint. Ordinary browser tests and fixtures must not enter production reports.
