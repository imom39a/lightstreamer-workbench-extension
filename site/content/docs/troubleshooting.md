## No Lightstreamer activity appears

1. Confirm that the page uses the official Lightstreamer Web Client.
2. Open Workbench in Chrome DevTools.
3. Check **Capture** and **Coverage**.
4. Select Page Scope.
5. Clear the active Filter.
6. Reload the page.

If Coverage is limited, follow the displayed recovery action. Missing Evidence does not prove that an event did not occur.

## Extension context invalidated

This can occur after an extension update or reload. The open page can still contain the previous content script.

1. Reopen DevTools.
2. Reload the inspected page to attach a fresh bridge.

For an unpacked build, keep Developer mode enabled in `chrome://extensions`.

## Older Evidence is missing

History has rolling limits. At capacity, Workbench removes the oldest Evidence while Capture continues. Export the records you need before they expire.

Check the retained range and Evidence Gaps before drawing conclusions. See [retained history]({{site}}docs/evidence/#retained-history).

## History uses memory

IndexedDB can be unavailable at startup or fail during capture. Workbench uses the smaller memory capacity for the rest of that Panel Session.

Check Notifications for the cause. Restore IndexedDB before opening a new panel. The new panel starts empty. Memory storage does not reduce Coverage by itself.

## Local Injection is unavailable

1. Select a live target Subscription.
2. Select compatible Item Update Evidence.
3. Close a protected Draft or Scenario that owns a different target.

Retired objects remain available for inspection but cannot receive Local Injection.

## An MCP agent cannot find a panel

Use the [connection checks]({{site}}docs/agent-access/#check-the-connection). Confirm that the agent app starts the MCP server and the intended Workbench panel is open.

If **Agent access and setup** is missing, install a [matching packaged extension]({{site}}docs/agent-access/#install-a-matching-extension). If you loaded that download unpacked, use its Chrome-assigned ID in the npm setup command.

## The interface differs from this guide

Check the installed version in `chrome://extensions`. Compare it with [Release notes]({{site}}releases/).

If the problem continues, contact [Support]({{site}}support/). Remove private data before sharing a report.
