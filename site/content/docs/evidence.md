## Select and search

| Control | Purpose |
| --- | --- |
| **Scope** | Select the runtime object. |
| **Filter** | Change which Evidence is visible. |
| **Find** | Move between matches without changing Filter. |
| **Selection** | Choose the event shown in Context. |

These controls are independent. If Filter hides the selected event, use **Reveal** or **Clear selection**.

## Read a row

Each row shows **Op**, the complete **Key / item**, and **Data**. Op stays pinned during horizontal scroll. Keys and data stay on one line.

Use **Codes** to read update and lifecycle codes. **LOCAL** marks Local Injected Updates. `R` marks runtime activity. `W` marks Workbench activity. `S` marks a snapshot.

**Readable** formats captured JSON strings and labels them **JSON string**. **Raw fields** preserves captured types.

Large row previews have a size limit. Select the event to inspect its full Fields, identity, time, Source, and phase in Context.

## Live and Frozen

**Live** follows new matching Evidence. **Frozen** keeps the visible window and selection. Capture continues in either state.

Use **Oldest**, **Older**, **Newer**, and **Newest** to navigate retained Evidence.

## Retained history

Each Panel Session owns one temporary Event History.

| Storage | Record limit | Size limit |
| --- | --- | --- |
| IndexedDB | 100,000 | 256 MiB |
| Memory fallback | 25,000 | 128 MiB |

The first limit reached removes the oldest Evidence while Capture continues. Failed or oversized records create explicit Evidence Gaps. Later valid records can still be retained.

The Committed Evidence Boundary identifies accepted records. Check Coverage, the retained range, and Evidence Gaps before drawing conclusions from missing data.

Repeated IndexedDB failures switch the panel to memory. Check Notifications for the cause. Memory storage does not reduce Coverage by itself.

**Clear retained Evidence** requires confirmation. Closing the panel attempts erasure. An abnormal stop can leave residual data until the extension runs again. A new Panel Session starts empty.

For storage and recovery details, see [Event History architecture on GitHub](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/docs/ARCHITECTURE.md#event-history-architecture).

## Client Messages

Outbound Client Messages record submission and available listener outcomes. An application's message is **RUNTIME**. A Server Injection is **WORKBENCH**.

A Processed message does not prove a later Server Update or a business result. See [Server Injection]({{site}}docs/server-injection/).
