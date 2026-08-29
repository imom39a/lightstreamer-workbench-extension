## 2.0.1 — current release line

Version 2.0.1 is the release-current **Scoped Evidence Workspace**. Chrome Web Store availability follows the maintainer-controlled review and rollout process; check Chrome's extension details for the version installed in your browser.

- Adds deterministic multi-event Local Injection Scenarios with explicit single-target membership, immutable reviewed Runs, serial controls, per-Step outcomes, Workbench-owned Checkpoints, and complete correlation.
- Extends Scenario Checkpoints with exact post-Review normalized Diagnostic Observation assertions, race-safe journal reads, active-time windows, bounded references, and explicit Clear/unavailable outcomes.
- Proves a three-Step ADD → UPDATE → DELETE Run through the official Lightstreamer client using three ordinary local-delivery requests, then verifies the separate Observed Server and Local Effective COMMAND projections.
- Moves active operational conditions and recent Lightstreamer diagnostics into one Panel Session-wide Notifications document. Stable conditions update in place, supporting Evidence remains inspectable, and Dismiss hides only the active footer copy.
- Improves Scope readability with a stable identity line and secondary facts, and gives Ordered Evidence a dedicated retained-order rail separate from timestamp and event identity.
- Keeps selected update Fields visible by collapsing Activity summary, Filter selected Evidence, and Evidence metadata while preserving selected provenance in the Context header.
- Keeps the same Manifest V3 permissions, local-only data handling, Panel Session-owned temporary Event History, and Local Injection boundaries.
- Publishes a release-current product site, screenshots, and practical developer guide for the complete workflow.

The release process is staged and maintainer-controlled. A built package or source commit alone does not prove that a Web Store rollout has completed.

## 2.0.0 — unified workspace foundation

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
