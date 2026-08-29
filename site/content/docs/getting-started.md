## Requirements

- Google Chrome with permission to install the extension and open DevTools.
- A page that uses the official Lightstreamer Web Client.
- Authorization to inspect the page and any data it displays.

Workbench does not require an account or a maintainer-operated backend.

## Install

1. Install [Lightstreamer Workbench from the Chrome Web Store]({{store}}).
2. Open the application page you want to inspect.
3. Open Chrome DevTools.
4. Select **Lightstreamer Workbench** from the DevTools panels.
5. Reload the inspected page with DevTools open when the application created its Lightstreamer client before instrumentation attached.

## Confirm useful Capture

The operating strip separates two questions:

- **Capture operation** tells you whether Workbench is accepting activity.
- **Observation Coverage** tells you how confidently captured Evidence represents the relevant Lightstreamer runtime.

When Coverage is limited or unavailable, follow the recovery text before treating missing Evidence as proof that activity did not occur.

## Run a first investigation

1. Open **Scope** and choose a client, Session, Subscription, item, or listener.
2. Follow matching events in **Ordered Evidence**.
3. Select one row to populate **Context**.
4. Use **Find** to navigate matches without changing the visible set.
5. Use **Filter** to change the visible set deliberately.
6. Freeze the Evidence view when you need a stable historical window; Capture continues unless its operating state says otherwise.
7. Open **Notifications** when the footer reports an active condition or recent diagnostic; dismissing a footer copy does not remove its notification or Evidence.

Next: follow the complete [Developer guide]({{site}}docs/developer-guide/) or [understand the unified workspace]({{site}}docs/workspace/).
