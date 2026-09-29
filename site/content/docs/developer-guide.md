Use this procedure to find and inspect activity from the page's Lightstreamer client. For installation and the first Session, see [Getting started]({{site}}docs/getting-started/).

## Inspect Lightstreamer activity

1. Open Workbench before the activity you want to capture.
2. Check **Capture** and **Coverage** in the operating strip.
3. Select the relevant client, Session, Subscription, or item in **Scope**.
4. Use **Filter** to reduce the visible Evidence.
5. Use **Find** to locate a value within that Evidence.
6. Select an event to inspect its Fields in **Context**.

Scope, Filter, Find, and selection are independent. **Freeze Evidence** stops the view from following new events. Capture continues.

Check Coverage and retained history before drawing conclusions from missing events. Workbench observes the page's clients. It does not connect or subscribe for the application. See [Ordered Evidence]({{site}}docs/evidence/) for Filter, Find, and history controls. For a COMMAND key, follow the [COMMAND lifecycle guide]({{site}}docs/command-state/).

## Keyboard essentials

- **Tab / Shift+Tab** moves between controls and surfaces.
- In Scope, use arrow keys to navigate. Use Enter or Space to select a Scope.
- In Evidence, use Up/Down to select rows. Use Enter to open Context.
- **Control/Command+F** opens Search scopes from Scope, Evidence Find elsewhere, or Find within an active document.
- **Escape** closes the active transient control. It does not inject or clear history.

Injection, clear, and export actions have visible controls. There is no Injection keyboard shortcut.
