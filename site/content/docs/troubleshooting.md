## No Lightstreamer activity appears

1. Confirm the page uses the official Lightstreamer Web Client.
2. Open DevTools before you reload the inspected page.
3. Check Capture operation and Observation Coverage in the operating strip.
4. Return to Page Scope.
5. Clear the active Filter.
6. Reload the page.

## Coverage is limited

Do the recovery action that Workbench shows. Common causes are late attachment, an unsupported client, or a fallback observation method with less data.

Limited Coverage does not make captured Evidence invalid. State the Coverage limit when you make a conclusion from missing data.

## History uses the in-memory fallback

IndexedDB is not available in the panel. The memory fallback can keep 25,000 Evidence records or 128 MiB. IndexedDB can keep 100,000 records or 256 MiB. If IndexedDB writes repeatedly fail after Capture starts, Workbench continues in memory for the rest of the Panel Session. The footer shows the current storage mode, and Notifications records the failure reason and failed-attempt count. The memory fallback changes History Capacity. It does not reduce Coverage by itself. Restore IndexedDB and open a new Panel Session when you need the larger capacity. The new Panel Session starts empty.

## Capture stopped at a history boundary

Event History stops the admission of new Evidence after a journal failure or History Capacity limit. The final Committed Evidence Boundary identifies the last committed Evidence. Workbench can still commit accepted queued work in Capture order. A refused or failed event does not become Evidence or change derived COMMAND state. Clear cannot restart Capture after a terminal stop. Read the History condition in the footer for the cause, boundary, retained range, and recovery action.

## Closing or reopening the panel

A controlled Close tries to erase the Panel Session's temporary Event History. Workbench reports whether it confirmed this action. An abnormal stop can prevent the action. A later cleanup can remove an unused Workbench journal without changing active journals. Residual data can remain until Chrome runs the extension again. A new Panel Session does not load this data.

## Local Injection is unavailable

Confirm that the target Subscription is live. Confirm that the selected Evidence is compatible. Close a protected Draft or Scenario that owns a different target. You can inspect retired objects, but they cannot receive Local Injection.

## The panel still looks like the previous product

Check the version on the [Release notes]({{site}}releases/) page. Then check the version in Chrome extension details. Version 2.0.0 is the first Store release with the current workspace.

If the problem continues, use [Support]({{site}}support/). Remove private data from all payloads before you post them.
