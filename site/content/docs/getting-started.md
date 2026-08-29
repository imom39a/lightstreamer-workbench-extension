## Requirements

- Google Chrome with permission to install the extension and open DevTools.
- A page that uses the official Lightstreamer Web Client.
- Authorization to inspect the page and any data it displays.

Workbench does not require an account or a Workbench server.

## Install

1. Install [Lightstreamer Workbench from the Chrome Web Store]({{store}}).
2. Open the application page you want to inspect.
3. Open Chrome DevTools.
4. Select **Lightstreamer Workbench** from the DevTools panels.
5. Reload the page if the Lightstreamer client existed before Workbench opened.

## Check Capture and Coverage

The operating strip shows two independent states:

- **Capture** shows whether Workbench accepts activity.
- **Coverage** shows how much of the applicable Lightstreamer runtime Workbench can observe.

If Coverage is LIMITED or UNAVAILABLE, do the displayed recovery action. Do not use missing Evidence as proof until you correct the Coverage problem.

## Inspect your first Session

1. Open **Scope**.
2. Select a client, Session, Subscription, item, or listener.
3. Read the matching events in **Ordered Evidence**.
4. Select one row to show **Context**.
5. Use **Find** to move between matches without changing the visible set.
6. Use **Filter** to change the visible set.
7. Select **Freeze Evidence** when you need a stable historical view. Capture continues.
8. Open **Notifications** when the footer shows a condition or recent diagnostic.
9. Dismiss a footer message if it obstructs the workspace. This action does not delete the notification or Evidence.

Next, use the [Developer guide]({{site}}docs/developer-guide/) or read about the [Workbench workspace]({{site}}docs/workspace/).
