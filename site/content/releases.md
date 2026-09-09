## 2.0.3 candidate — Client Messages, Server Injection, and usage analytics

The 2.0.3 candidate captures outbound Client Messages and their listener outcomes. Server Injection can clone a captured message or author one for an exact live client and Session, optionally using an application-owned Message Recipe. Review shows every `LightstreamerClient.sendMessage` argument before one deliberate send. Workbench does not automatically retry an Unknown outcome, and Processed does not prove a later Server Update or business effect.

The candidate also adds Google Analytics 4 measurement for Workbench feature use, foreground engagement, investigation journeys, and coarse failure categories. Analytics is on by default in configured builds, with an off switch under **More actions → Help & resources → Usage analytics**. Captured Lightstreamer data, inspected URLs, search text, Drafts, and raw errors stay local. Turning analytics off removes the saved analytics identifier.

This candidate adds `storage` permission for analytics preferences and identity, plus access to Google's collection host. It does not load remote scripts. The website and offline exports remain free of analytics. The [Privacy policy]({{site}}privacy/) describes the data boundary. This entry does not mean the candidate is published.

## 2.0.2 — current release

Version 2.0.2 is the current Chrome Web Store release. Check Chrome extension details to see your installed version.

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

The maintainer controls the staged release process. A candidate package or source commit does not prove that version 2.0.3 is available.

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
