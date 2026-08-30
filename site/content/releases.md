## 2.0.1 — current release line

Version 2.0.1 is the current release line. Chrome Web Store review controls when this version is available. Check Chrome extension details to see your installed version.

- Adds Local Injection Scenarios for ordered multi-event tests. Each Scenario uses one target, immutable reviewed Runs, serial controls, per-Step outcomes, and Workbench Checkpoints.
- Adds diagnostic Checkpoints after Review. These Checkpoints use normalized diagnostic data, active-time periods, bounded references, and explicit Clear or unavailable results.
- Verifies a three-Step ADD → UPDATE → DELETE Run through the official Lightstreamer client. Each Step uses one local delivery request and related Local Evidence.
- Removes the general COMMAND projection comparison. Use ordered Evidence, Fields, diagnostics, Scenarios, and Checkpoints to inspect COMMAND behavior.
- Adds one Notifications document for the Panel Session. A stable condition updates its existing entry. Dismiss hides only the footer message.
- Gives each Scope item a primary identity line and a secondary facts line.
- Gives Ordered Evidence a separate rail for retained Event order.
- Shows selected update Fields before the closed Activity summary, Filter, and Evidence metadata sections.
- Keeps the same Manifest V3 permissions, local-only data handling, Panel Session-owned temporary Event History, and Local Injection boundaries.
- Updates the product site, screenshots, and developer guide.

The maintainer controls the staged release process. A package or source commit does not prove that the Chrome Web Store release is available.

## 2.0.0 — unified workspace foundation

Version 2.0.0 is the first public release with the current Workbench workspace.

- Puts Runtime Scope, Ordered Evidence, and Context in one responsive workspace.
- Keeps Scope, Filter, Find, selection, Capture operation, Observation Coverage, and Live/Frozen Evidence position independent.
- Keeps current-session Evidence in one temporary Event History. IndexedDB can keep 100,000 records or 256 MiB. The memory fallback can keep 5,000 records or 32 MiB.
- Shows the Committed Evidence Boundary. A journal failure or capacity limit stops the admission of new Evidence at this boundary. Clear cannot restart stopped Capture.
- Tries to erase Event History during a controlled Close. An abnormal stop can leave residual data until Chrome runs the extension again. A new Panel Session does not load earlier Evidence.
- Adds derived COMMAND state for validation and the comparison workflow that was available in 2.0.0.
- Adds one protected Local Injection Draft with raw JSON editing, Source comparison, validation, Review, and explicit outcomes.
- Adds credential-safe scoped JSON and offline HTML exports.
- Removes product analytics. Help links open the project documentation, privacy, and support pages.

Version 2.0.0 is available from the [Chrome Web Store]({{store}}). This site contains the documentation, privacy policy, security policy, and support page.
