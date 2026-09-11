## Scope, Filter, and Find are different

- **Scope** establishes the runtime-object boundary.
- **Filter** changes which matching Evidence is visible and reports shown versus total counts.
- **Find** navigates matches without changing the Evidence set.
- **Selection** identifies the Evidence explained in Context.

Workbench keeps these states independent. If a Filter hides the selected event, use **Reveal** or **Clear selection**.

## Read an Evidence row

Rows start with a compact **Op**, followed by the complete **Key / item** and **Data**. Only Op stays pinned when you scroll horizontally; the key and data stay on one line and scroll together. Keys are never shortened. **Codes** explains update and lifecycle codes such as `U`, `EOS`, and `SUBOK`.

**Readable** displays captured JSON object and array strings as structured values and marks them **JSON string**. **Raw fields** preserves the captured field types. Large payload previews are bounded; select a row to inspect its complete payload in Context. Exact Evidence identity, timestamp, retained sequence, Source, and phase remain available in Context.

## Use Filter

Filter applies to the Panel Session. You can add criteria without changing unrelated criteria. Workbench uses the same filter rules for IndexedDB and memory history.

## Use Live and Frozen

**Live** follows the newest matching Evidence. **Frozen** keeps the historical window, selection, and scroll position. Capture continues. Workbench counts new matching Evidence and does not move focus.

Live or Frozen does not start or stop Capture. Capture does not delete history or change the Live or Frozen state.

## Retained history

One Panel Session owns one temporary Event History. IndexedDB can retain up to 100,000 Evidence records or 256 MiB. The memory fallback can retain up to 25,000 records or 128 MiB. Reaching either limit removes the oldest accepted prefix while later valid Capture continues. A candidate that cannot enter any canonical segment creates an explicit Evidence Gap; later valid activity remains eligible. After bounded journal retries fail, Workbench continues in memory for the rest of the Panel Session. The footer shows the current storage mode, and Notifications records the failure reason. Use **Oldest**, **Older**, **Newer**, and **Newest** to move through retained Evidence.

Complete History ends at the current History Interval's Committed Evidence Boundary. Pending writes advance that boundary only after acceptance. Refused or failed candidates create explicit Evidence Gaps and do not change derived COMMAND state; they do not prevent later valid activity from becoming Evidence. Capture, Coverage, History Capacity, and Live or Frozen remain independent.

**Clear retained Evidence** ends the current History Interval. Scope and Filter do not change this boundary. Workbench requires confirmation before it clears the Evidence. Clear cannot restart Capture after a terminal stop.

A controlled Close tries to erase the Event History. An abnormal stop can prevent this action. Residual data can remain until Chrome runs the extension again. A new Panel Session does not load Evidence from an earlier Panel Session.

## Evidence provenance

The Op column labels Local Injected Updates **LOCAL**, runtime activity `R`, and Workbench activity `W`; unmarked updates are from the server. `S` marks a snapshot. Context retains the full `SERVER`, `LOCAL`, `RUNTIME`, or `WORKBENCH` Source. `ADD` and `DELETE` annotate COMMAND updates; an ordinary update uses `U`. These operations are not result or severity values.

Outbound Client Message Evidence records the page-owned or Workbench-owned `sendMessage` submission and any available terminal listener outcome. An application message is `RUNTIME`; a Server Injection is `WORKBENCH`. A Processed message is not proof of a later Server Update or business effect.

## Diagnostics are not Evidence filters

Notifications applies to the Panel Session. It has Code, Severity, and Affected filters. These filters do not change Evidence Scope, Filter, Find, selection, Live or Frozen state, or retained history. **Dismiss** hides the footer message. It does not remove the notification or supporting Evidence.
