## Inspect Lightstreamer activity

1. Open Workbench before the activity you want to capture. See [Getting started]({{site}}docs/getting-started/) for installation.
2. Check **Capture** and **Coverage** in the operating strip.
3. Select the relevant client, Session, Subscription, or item in **Scope**.
4. Use **Filter** to reduce the visible Evidence.
5. Use **Find** to locate a value within that Evidence.
6. Select an event to inspect its Fields in **Context**.

Scope, Filter, Find, and selection are independent. **Freeze Evidence** stops the view from following new events. Capture continues.

Check Coverage and retained history before drawing conclusions from missing events. Workbench observes the page's clients. It does not connect or subscribe for the application.

## Choose a task

| Task | Guide |
| --- | --- |
| Navigate Scope, Evidence, Context, and Notifications | [Workspace]({{site}}docs/workspace/) |
| Read rows, filter data, or check retained history | [Ordered Evidence]({{site}}docs/evidence/) |
| Trace ADD, UPDATE, and DELETE for a key | [COMMAND lifecycles]({{site}}docs/command-state/) |
| Test one update or an ordered Scenario | [Local Injection]({{site}}docs/local-injection/) |
| Review and send a Client Message | [Server Injection]({{site}}docs/server-injection/) |
| Connect an agent | [MCP setup]({{site}}docs/agent-access/) |
| Save or share a capture | [Export and privacy]({{site}}docs/export-and-privacy/) |
| Resolve missing activity or an unavailable target | [Troubleshooting]({{site}}docs/troubleshooting/) |

Local Injection delivers an update in the page. Server Injection sends a Client Message to the application's server. Neither outcome proves an application business result.

## Keyboard essentials

- **Tab / Shift+Tab** moves between controls and surfaces.
- In Scope, use arrow keys to navigate. Use Enter or Space to select a Scope.
- In Evidence, use Up/Down to select rows. Use Enter to open Context.
- **Control/Command+F** opens Search scopes from Scope, Evidence Find elsewhere, or Find within an active document.
- **Escape** closes the active transient control. It does not inject or clear history.

Injection, clear, and export actions have visible controls. There is no Injection keyboard shortcut.
