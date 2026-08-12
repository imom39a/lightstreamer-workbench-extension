## No Lightstreamer activity appears

1. Confirm the page uses the official Lightstreamer Web Client.
2. Open DevTools before reloading the inspected page so instrumentation can attach before clients are created.
3. Check Capture operation and Observation Coverage in the operating strip.
4. Return to Page Scope and clear any active Filter before concluding that Evidence is absent.

## Coverage is limited

Follow the specific recovery guidance shown by Workbench. Common causes include late attachment, an unsupported client shape, or fallback observation that cannot provide the same semantic detail as primary Web Client instrumentation.

Limited Coverage means conclusions need qualification. It does not automatically invalidate Evidence that was captured.

## History uses the in-memory fallback

IndexedDB is unavailable in the panel context. Evidence remains usable for the current Panel Session, but the startup memory adapter has the lower 5,000-record/32 MiB History Capacity rather than the normal 10,000-record/64 MiB tier. The selected adapter is fixed for the session; Workbench does not migrate from memory to IndexedDB after Capture begins. This fallback changes History Capacity, not Observation Coverage by itself. Restore IndexedDB availability and open a new Panel Session when you need the normal tier; a new session starts empty and does not recover or replay a prior session.

## Capture stopped at a history boundary

Event History stops accepting new Evidence fail-closed when a journal failure or History Capacity limit is reached. The final Committed Evidence Boundary identifies the last trustworthy Evidence; accepted queued work may drain in Capture order, but refused or failed candidates never become Evidence or advance projections. Clear cannot restart a terminally stopped Capture. Use the typed History condition in the global footer for the cause, boundary, retained range, and recovery route.

## Closing or reopening the panel

Controlled Close attempts to erase the Panel Session's owned temporary journal and reports whether erasure was confirmed. An abnormal browser, DevTools, renderer, or extension termination cannot guarantee an unload callback; a later ownership-safe sweep may remove an orphaned Workbench journal while preserving active owners and unknown generations. Residual data can therefore remain until Chrome next runs the extension, but it is never replayed into a new Panel Session.

## Local Injection is unavailable

Check that the target Subscription is live, the selected Evidence is compatible, and no protected Draft already owns another target. Retired objects remain readable but cannot receive Local Injection.

## The panel still looks like the previous product

Check the version on the [Release notes]({{site}}releases/) page and in Chrome's extension details. Version 2.0.0 is the first Store release of the unified workspace.

Still stuck? Choose the appropriate route on [Support]({{site}}support/) and sanitize all payloads before posting publicly.
