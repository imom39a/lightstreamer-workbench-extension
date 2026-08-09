## Scope, Filter, and Find are different

- **Scope** establishes the runtime-object boundary.
- **Filter** changes which matching Evidence is visible and reports shown versus total counts.
- **Find** navigates matches without changing the Evidence set.
- **Selection** identifies the Evidence explained in Context.

Workbench preserves these states independently. A filtered-out selected event remains recoverable through explicit Reveal or Clear selection actions.

## Live and Frozen investigation

**Live** follows the newest matching Evidence. **Frozen** preserves the historical window, selection, and scroll anchor while Capture continues. Newer matching Evidence is counted rather than stealing focus.

Live/Frozen position does not start or stop Capture. Likewise, Capture state does not silently discard history or force the Evidence view to follow.

## Retained history

Current-session history is held in temporary IndexedDB-backed batches when available, with an in-memory fallback. The DOM stays bounded even when thousands of events are retained. Use Oldest, Older, Newer, and Newest to move through retained regions.

**Clear retained Evidence** removes the whole current DevTools-session history, regardless of active Scope or Filter. It is deliberately separated from routine controls and requires inline confirmation.

## Evidence provenance

`SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH` remain textual. A Local Injected Update is not presented as a Server Update, and a COMMAND verb such as `ADD`, `UPDATE`, or `DELETE` is not treated as success or severity.
