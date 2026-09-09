## Scope, Filter, and Find are different

- **Scope** establishes the runtime-object boundary.
- **Filter** changes which matching Evidence is visible and reports shown versus total counts.
- **Find** navigates matches without changing the Evidence set.
- **Selection** identifies the Evidence explained in Context.

Workbench keeps these states independent. If a Filter hides the selected event, use **Reveal** or **Clear selection**.

## Read an Evidence row

The left rail shows the retained Event order. The timestamp has a separate position. The rest of the row shows the Evidence meaning, Source, phase, COMMAND operation, runtime object, and key.

## Use Filter

Filter applies to the Panel Session. You can add criteria without changing unrelated criteria. Workbench uses the same filter rules for IndexedDB and memory history.

## Use Live and Frozen

**Live** follows the newest matching Evidence. **Frozen** keeps the historical window, selection, and scroll position. Capture continues. Workbench counts new matching Evidence and does not move focus.

Live or Frozen does not start or stop Capture. Capture does not delete history or change the Live or Frozen state.

## Retained history

One Panel Session owns one temporary Event History. IndexedDB can retain up to 100,000 Evidence records or 256 MiB. The memory fallback can retain up to 5,000 records or 32 MiB. Reaching either limit removes the oldest accepted prefix while later valid Capture continues. A candidate that cannot enter any canonical segment creates an explicit Evidence Gap; later valid activity remains eligible. Workbench does not change the storage type during the Panel Session. Use **Oldest**, **Older**, **Newer**, and **Newest** to move through retained Evidence.

Complete History ends at the current History Interval's Committed Evidence Boundary. A journal failure or History Capacity limit stops the admission of new Evidence at this boundary. A refused or failed event does not become Evidence. It also does not change derived COMMAND state. Capture, Coverage, History Capacity, and Live or Frozen remain independent.

**Clear retained Evidence** ends the current History Interval. Scope and Filter do not change this boundary. Workbench requires confirmation before it clears the Evidence. Clear cannot restart Capture after a terminal stop.

A controlled Close tries to erase the Event History. An abnormal stop can prevent this action. Residual data can remain until Chrome runs the extension again. A new Panel Session does not load Evidence from an earlier Panel Session.

## Evidence provenance

Workbench shows `SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH` as text. It does not show a Local Injected Update as a Server Update. `ADD`, `UPDATE`, and `DELETE` are COMMAND operations, not result or severity values.

Outbound Client Message Evidence records the page-owned or Workbench-owned `sendMessage` submission and any available terminal listener outcome. An application message is `RUNTIME`; a Server Injection is `WORKBENCH`. A Processed message is not proof of a later Server Update or business effect.

## Diagnostics are not Evidence filters

Notifications applies to the Panel Session. It has Code, Severity, and Affected filters. These filters do not change Evidence Scope, Filter, Find, selection, Live or Frozen state, or retained history. **Dismiss** hides the footer message. It does not remove the notification or supporting Evidence.
