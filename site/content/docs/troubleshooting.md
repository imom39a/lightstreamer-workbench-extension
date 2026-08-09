## No Lightstreamer activity appears

1. Confirm the page uses the official Lightstreamer Web Client.
2. Open DevTools before reloading the inspected page so instrumentation can attach before clients are created.
3. Check Capture operation and Observation Coverage in the operating strip.
4. Return to Page Scope and clear any active Filter before concluding that Evidence is absent.

## Coverage is limited

Follow the specific recovery guidance shown by Workbench. Common causes include late attachment, an unsupported client shape, or fallback observation that cannot provide the same semantic detail as primary Web Client instrumentation.

Limited Coverage means conclusions need qualification. It does not automatically invalidate Evidence that was captured.

## History uses the in-memory fallback

IndexedDB is unavailable in the panel context. Evidence remains usable for the current open panel but has a lower practical History Capacity. Restore IndexedDB availability and reopen DevTools when you need the normal session history path.

## Local Injection is unavailable

Check that the target Subscription is live, the selected Evidence is compatible, and no protected Draft already owns another target. Retired objects remain readable but cannot receive Local Injection.

## The panel still looks like the previous product

Check the version on the [Release notes]({{site}}releases/) page and in Chrome's extension details. Version 2.0.0 is the first Store release of the unified workspace.

Still stuck? Choose the appropriate route on [Support]({{site}}support/) and sanitize all payloads before posting publicly.
