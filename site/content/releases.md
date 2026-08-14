## 2.0.1 — verified release candidate

Version 2.0.1 is a verified release candidate for the unified **Scoped Evidence Workspace** delivered in 2.0.0.

- Adds deterministic multi-event Local Injection Scenarios with explicit single-target membership, immutable reviewed Runs, serial controls, per-Step outcomes, Workbench-owned Checkpoints, and complete correlation.
- Proves a three-Step ADD → UPDATE → DELETE Run through the official Lightstreamer client using three ordinary local-delivery requests, then verifies the separate Observed Server and Local Effective COMMAND projections.
- Keeps the same Manifest V3 permissions, local-only data handling, Panel Session-owned temporary Event History, and Local Injection boundaries.
- Produces an audited 2.0.1 extension package for maintainer-controlled release.

The repository package is verified for maintainer release. This record does not mean it has been uploaded, submitted for review, approved, rolled out, or published; 2.0.0 remains the current Chrome Web Store release.

## 2.0.0 — current Chrome Web Store release

Version 2 is the first public release of the unified **Scoped Evidence Workspace**.

- Brings Runtime Scope, Ordered Evidence, and Context into one responsive investigation workspace instead of separate Timeline, Topology, and COMMAND State destinations.
- Keeps Scope, Filter, Find, selection, Capture operation, Observation Coverage, and Live/Frozen Evidence position independent.
- Retains high-volume current-session Evidence through one Panel Session-owned temporary Event History. Normal History Capacity is 100,000 Evidence records or 256 MiB of canonical replay-complete journal bytes; the startup memory fallback is 5,000 records or 32 MiB. The selected adapter is fixed for the session, and 100,000 arbitrary-size payloads are not promised.
- Makes the committed Evidence boundary explicit: Complete History reaches only through the current History Interval's Committed Evidence Boundary, Clear makes an exact interval cut, and journal or capacity failures stop acceptance fail-closed. Clear cannot restart stopped Capture.
- Makes cleanup and privacy boundaries explicit: controlled Close attempts erasure, abnormal termination relies on a later ownership-safe sweep, residual data may remain until Chrome next runs the extension, and a new Panel Session never replays stale Evidence. Storage fallback alone does not limit Observation Coverage.
- Compares Observed Server COMMAND State with Local Effective COMMAND State while keeping their evidence and authority limits explicit.
- Adds one protected Local Injection Draft with raw JSON editing, immutable Source comparison, validation, review, and truthful outcomes.
- Adds credential-safe scoped JSON and offline HTML exports.
- Removes product analytics and links Help resources only to first-party site documentation, privacy, and support routes.

Version 2.0.0 is available now from the [Chrome Web Store]({{store}}). Customer-facing documentation, privacy, security, and support remain on this first-party site.
