## Scoped exports

Workbench can prepare a versioned JSON snapshot or offline HTML report for the current Scope. Export is a deliberate local download, not automatic persistence.

Credentials are excluded unconditionally. Before downloading, you can redact additional categories such as server addresses, masked client IP information, item names, COMMAND keys, field names, and captured identifiers.

Including complete Evidence is explicit because captured application payloads can contain sensitive or proprietary data.

## Local storage boundary

Captured clients, Sessions, Subscriptions, updates, field values, diagnostics, Sources, and Drafts remain in the browser extension context for the current inspected tab/session. Temporary IndexedDB-backed history is cleared on startup and normal teardown; memory fallback exists when IndexedDB is unavailable.

## No analytics or tracking

Version 2 sends no product analytics, inspected-page URLs, Lightstreamer addresses, captured values, identifiers, search text, Drafts, errors, or stack traces to the maintainers. The public website also uses no analytics, cookies, submitted forms, or tracking scripts.

Read the complete [Privacy policy]({{site}}privacy/) before sharing an export or using Workbench against production data.
