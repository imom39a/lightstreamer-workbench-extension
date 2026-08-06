# Surgical comparison contract

## Decision under test

Replace only the Ordered Evidence ledger’s six presentation columns with a JSONL-style console. Preserve the accepted Scoped Evidence Workspace, Elastic Triad, Roving Instrument, and Plain Ledger contracts.

## Intentional differences inside the ledger

| Today | Surgical JSON console |
| --- | --- |
| Six fixed semantic columns | Absolute line/order plus one monospaced JSON line |
| 27 px normal/wide rows; 48 px compact two-line rows | 27 px single-line rows at every geometry |
| Bounded horizontal scroll when six columns exceed Evidence width | Bounded horizontal scroll for complete JSON lines |
| Find-current marker in the time/identity cell | Find-current marker on the row plus concise status in the sticky line cell |

The JSON property order is a display contract: `time`, textual `source`, `phase`, `command`, kind, key, identity, object, summary, then the complete persistable event. This keeps the required Workbench semantics visible before horizontal travel while retaining complete normalized Evidence.

## Must remain unchanged

- Capture operation, observation Coverage, Live/Frozen position, and their controls.
- Find behavior, retained-history query/index, match count, navigation, and selected-event independence.
- Filter behavior, active-filter visibility, reset, and hidden-selection recovery.
- Scope breadcrumb, structural Scope tree, topology lifecycle, collapse/restore, and picker placement.
- Retained-Evidence 60-row window, ordering, older/newer navigation, IndexedDB/in-memory behavior, and teardown.
- Selection, focus, Up/Down, Page Up/Down, Home/End, Enter, compact Back, and scroll-anchor restoration.
- Context header, metadata ordering, selected Item Update Fields, JSON-string expansion, diagnostics, COMMAND projection actions, Local Injection entry, and `Open complete raw`.
- Wide, normal, shallow, and compact geometry gates; pane minima, splitters, collapse/restoration, and scroll ownership.
- Local Injection, export, scoped copy, retention/clear, analytics, capture instrumentation, storage schema, and event-envelope domain types.

## Explicitly not carried forward from the first prototype

- No repositioned Find or Filter toolbar.
- No redesigned Scope sidebar or breadcrumb.
- No new Context JSON block.
- No `Chars` column.
- No inline expanded selected row.
- No syntax-color semantics, provenance colors, badges, or new icon language.
- No new search index, query language, copy action, workflow, permanent surface, or navigation destination.

## Implementation seam to validate

1. Add one deterministic formatter near the Workbench evidence presentation boundary. It serializes the current derived semantics plus a persistable event envelope and excludes ephemeral topology-only state.
2. Cache the formatted line with the existing per-event presentation cache; do not `JSON.stringify` every row on every React render.
3. Change only `EvidenceRow`, the ledger header, and their focused CSS. Keep the runtime Find implementation—already backed by complete retained-event search text—unchanged.
4. Keep Context exactly as it is today. The center JSON line is complete, while `Open complete raw` remains the deliberate promoted raw-document route.

## Surgical regression proof

For identical deterministic data, selection, theme, and viewport:

- Capture base, changed, and diff screenshots for compact `563×700`, normal `900×700`, shallow `900×320`, and wide `1440×900`, with representative Dark and Light coverage.
- Assert equal bounding boxes for the operating strip, Scope strip, Evidence pane header, retained-window controls, Scope pane, Context pane, splitters, and status strip across baseline and JSON-console renders.
- Treat any pixel delta outside the ledger content box as an unintended regression unless explicitly approved.
- Assert Context text and action names are identical for the same selected event; no normalized envelope appears in Context.
- Re-run all current high-volume, retained Find, Filter-hidden selection, live growth, focus/selection, Local Injection, extension, fixture, package, accessibility, and performance gates without weakening assertions or silently updating baselines.

## Current recommendation

Variant B is the preferred migration direction if the parity proof passes. It removes column-design churn and makes complete textual Evidence the center scanning unit, while the existing Context remains the semantic interpreter rather than a second copy of the JSON.
