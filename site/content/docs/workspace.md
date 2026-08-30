Version 2 has one Workbench workspace. It replaces the separate Timeline, Topology, and COMMAND State pages. A wide layout shows Scope, Ordered Evidence, and Context at the same time.

## Runtime Scope

The Scope breadcrumb sets the runtime boundary. The Scope tree uses this order: Page → client → Session → Subscription → item → listener. You can inspect a retired object, but you cannot use it as a Local Injection target.

Scope controls which Evidence is in the view. Selecting an Evidence row does not change Scope.

## Ordered Evidence

Ordered Evidence shows events in retained order. Each row shows its identity, Lightstreamer meaning, Source, snapshot or live phase, and COMMAND operation.

Workbench renders a limited number of rows at one time. The retained Evidence stays available. Use **Older** and **Newer** to move through it.

## Context

If no row is selected, Context shows information about the active runtime object. If a row is selected, Context shows its Source and Fields first. **Activity summary**, **Filter selected Evidence**, and **Evidence metadata** are closed by default.

Open only the section that you need. The Filter section has Include, Exclude, and Around actions. These actions do not change other filter criteria. Evidence metadata shows Source, phase, identities, observation path, COMMAND details, and limits.

At compact width, Context replaces the Evidence list. Select **Back to Evidence** to return to the selected row.

## Notifications

The **Notifications** footer control opens the Notifications document. It contains active Workbench conditions and recent Lightstreamer diagnostics for the Panel Session. Notification filters do not change Evidence Scope or Filter. A stable condition updates its existing entry.

**Dismiss** hides only the footer message. The notification, supporting Evidence, affected Scope, and diagnostic record remain available until the condition ends.

## Session operations

**More actions** contains session operations that are not used frequently. These operations include copy, clear history, export, appearance settings, and Help links. These operations do not open a primary workspace page.
