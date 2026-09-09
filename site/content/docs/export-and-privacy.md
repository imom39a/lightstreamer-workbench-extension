## Scoped exports

Workbench can create a versioned JSON snapshot or an offline HTML report for the current Scope. Workbench creates an export only when you request it. An export is a local download.

Workbench always excludes credentials. You can also remove server addresses, masked client IP information, item names, COMMAND keys, field names, and captured identifiers.

Structural JSON and HTML exports do not include Client Message bodies. **Copy retained scoped Evidence** always redacts Client Message bodies, processed responses, and denial text. Complete raw Evidence for one selected message remains a deliberate local action and can contain application data.

You must explicitly include complete Evidence. Captured application payloads can contain private or proprietary data.

## Local storage boundary

Captured clients, Sessions, Subscriptions, updates, field values, Client Messages, diagnostics, Sources, and Local or Server Drafts stay in the browser extension context. One Panel Session owns one temporary Event History. IndexedDB can retain 100,000 Evidence records or 256 MiB. The memory fallback can retain 5,000 records or 32 MiB. Reaching either limit removes the oldest accepted prefix while later valid Capture continues. A candidate that cannot enter any canonical segment creates an explicit Evidence Gap; later valid activity remains eligible. Workbench does not change the storage type during the Panel Session.

Complete History ends at the current History Interval's Committed Evidence Boundary. Clear ends the current interval. Clear does not restart Capture after a terminal stop. A controlled Close tries to erase the Event History. An abnormal stop can prevent this action. Residual data can remain until Chrome runs the extension again. A new Panel Session starts empty and does not load earlier Evidence. Capture, Coverage, History Capacity, and Live or Frozen remain independent. The memory fallback does not reduce Coverage by itself.

## Usage analytics boundary

Configured production builds send fixed feature names, foreground engagement, coarse outcomes, extension version, event time, and a random installation identifier to Google Analytics. Open **More actions → Help & resources → Usage analytics** to turn this off. Opting out removes the saved analytics identifier and session and does not upload a backlog if analytics is enabled again later.

Captured Evidence, payloads, inspected URLs, Lightstreamer addresses, search text, clipboard or export content, Drafts, raw errors, and stack traces are not sent. Workbench has no maintainer-operated collection backend, advertising, or account sign-in. The public website does not use analytics, cookies, forms, or tracking scripts. Read the [Privacy policy]({{site}}privacy/) for the complete data boundary.

Read the [Privacy policy]({{site}}privacy/) before you share an export or inspect production data.
