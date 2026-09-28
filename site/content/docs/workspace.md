Workbench has three surfaces: Scope, Ordered Evidence, and Context.

## Runtime Scope

Select a page, client, Session, Subscription, item, or listener. Scope sets the runtime boundary for visible Evidence.

Use **Search scopes** to find an object, including objects in collapsed branches. Selecting an Evidence row does not change Scope.

Retired objects remain available for inspection but cannot receive Local Injection.

## Ordered Evidence

Read events in retained order. Each row shows **Op**, the complete **Key / item**, and **Data**.

Use **Codes** for operation meanings. Select a row to inspect its full data in Context. See [Ordered Evidence]({{site}}docs/evidence/) for Filter, Find, and history controls.

## Context

With no event selected, Context describes the current runtime object. With an event selected, it shows the update Fields.

Open **Activity summary**, **Filter selected Evidence**, or **Evidence metadata** for supporting detail. At compact width, use **Back to Evidence** to return to the selected row.

## Notifications

Open **Notifications** from the footer to inspect conditions and Lightstreamer diagnostics. Its filters do not change Evidence.

Select supporting Evidence or the affected Scope to investigate. **Dismiss** hides only the footer message. It does not delete the notification or Evidence.

## Session operations

Open **More actions** for copy, clear, export, Agent access, and Help.

The header's Agent access status opens its control without changing access. Use the [MCP setup guide]({{site}}docs/agent-access/) to connect an agent.
