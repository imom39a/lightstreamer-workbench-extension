## Scope, Filter, and Find are different

- **Scope** establishes the runtime-object boundary.
- **Filter** changes which matching Evidence is visible and reports shown versus total counts.
- **Find** navigates matches without changing the Evidence set.
- **Selection** identifies the Evidence explained in Context.

Workbench preserves these states independently. A filtered-out selected event remains recoverable through explicit Reveal or Clear selection actions.

## Canonical faceted filtering

Filter state is one typed, revisioned descriptor for the whole Panel Session. The shared algebra owns evaluation and mutation; `evidence-facets.ts` owns facet extraction and canonical search text; the bounded Evidence query owns planning, discovery, Find, paging, and restoration. IndexedDB and memory implement that same query contract, so a session cannot mix an older scalar filter, renderer predicate, or full-history filtering read with the shipped semantics. Future facets extend the descriptor catalog and query contract at that seam rather than adding a presentation-specific filter path.

## Live and Frozen investigation

**Live** follows the newest matching Evidence. **Frozen** preserves the historical window, selection, and scroll anchor while Capture continues. Newer matching Evidence is counted rather than stealing focus.

Live/Frozen position does not start or stop Capture. Likewise, Capture state does not silently discard history or force the Evidence view to follow.

## Retained history

One Panel Session owns one temporary Event History. The normal IndexedDB tier supports 100,000 retained Evidence records or 256 MiB of canonical replay-complete journal bytes; the startup memory fallback supports 5,000 records or 32 MiB. The first independent limit reached controls admission, and the selected adapter does not switch during the session. The DOM stays bounded even when 100,000 events are retained. Use Oldest, Older, Newer, and Newest to move through retained regions.

Complete History means committed Evidence through the current History Interval's Committed Evidence Boundary. A journal failure or History Capacity breach stops acceptance fail-closed at that boundary; refused or failed candidates do not become Evidence or advance projections. Capture Operation, Observation Coverage, History Capacity, and Live/Frozen position remain independent.

**Clear retained Evidence** makes an exact History Interval cut, regardless of active Scope or Filter. It is deliberately separated from routine controls and requires inline confirmation; it cannot restart Capture after a terminal stop. Controlled Close attempts erasure of the owned journal. Abnormal termination may defer cleanup to a later ownership-safe sweep, residual data may remain until Chrome next runs the extension, and a new Panel Session never replays stale Evidence.

## Evidence provenance

`SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH` remain textual. A Local Injected Update is not presented as a Server Update, and a COMMAND verb such as `ADD`, `UPDATE`, or `DELETE` is not treated as success or severity.
