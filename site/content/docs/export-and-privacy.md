## Scoped exports

Workbench can prepare a versioned JSON snapshot or offline HTML report for the current Scope. Export is a deliberate local download, not automatic persistence.

Credentials are excluded unconditionally. Before downloading, you can redact additional categories such as server addresses, masked client IP information, item names, COMMAND keys, field names, and captured identifiers.

Including complete Evidence is explicit because captured application payloads can contain sensitive or proprietary data.

## Local storage boundary

Captured clients, Sessions, Subscriptions, updates, field values, diagnostics, Sources, and Drafts remain in the browser extension context for the current Panel Session. One Panel Session owns one temporary Event History. Normal IndexedDB History Capacity is 10,000 Evidence records or 64 MiB of canonical replay-complete journal bytes; the startup memory fallback is 5,000 records or 32 MiB. The first independent limit reached controls admission, and the selected adapter never changes mid-session.

Complete History is available only through the current History Interval's Committed Evidence Boundary. Clear is an exact interval cut; it does not restart Capture after a fail-closed terminal stop. Controlled Close attempts to erase the owned journal. Abnormal termination can defer cleanup to a later ownership-safe sweep, so residual temporary data may remain until Chrome next runs the extension. A new Panel Session starts empty and never replays a prior session's Evidence. Capture Operation, Observation Coverage, History Capacity, and Live/Frozen view state remain independent; storage fallback alone does not limit Coverage.

## No analytics or tracking

Version 2 sends no product analytics, inspected-page URLs, Lightstreamer addresses, captured values, identifiers, search text, Drafts, errors, or stack traces to the maintainers. The public website also uses no analytics, cookies, submitted forms, or tracking scripts.

Read the complete [Privacy policy]({{site}}privacy/) before sharing an export or using Workbench against production data.
