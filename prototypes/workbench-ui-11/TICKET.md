## What to build

Migrate only the **Ordered Evidence ledger** from today’s six-column presentation (`Time / #`, `Source`, `Phase`, `Op`, `Evidence / object`, `COMMAND key`) to a JSONL-style console: one stable retained-order line number plus one complete normalized Workbench Evidence JSON object per visible row.

This is a **Material UI** change under the Workbench UI Standard because it changes Ordered Evidence, density, keyboard-visible row presentation, and visual baselines. The developer journey remains evidence-backed diagnosis of incorrect application state.

“Normalized Workbench Evidence JSON” means the semantic presentation already available to Workbench plus the complete persistable event envelope. It is not raw WebSocket/TLCP capture and it must not invent application-specific interpretation. Use this deterministic property order so the scan-critical semantics precede the complete event document:

```text
time, source, phase, command, kind, commandKey, id, object, summary, event
```

`event` is the result of the existing persistable-envelope boundary. Do not include ephemeral topology-only data. Preserve canonical JSON types (`null`, boolean, number, string, object, array); do not write display glyphs such as `—` into the serialized data. A field containing encoded JSON remains a JSON string in the console even though existing Context affordances may interpret it for inspection.

### Intended implementation seam

1. Add a deterministic console-line formatter at the Workbench evidence-presentation boundary.
2. Cache its output with the existing per-event presentation cache; do not run a full `JSON.stringify` for every visible row on every React render.
3. Replace only the ledger header, `EvidenceRow` contents, and their narrowly owned CSS/ARIA treatment.
4. Reuse the current retained Evidence repository, 60-row window, Find text/index, Filter predicates, selection state, focus model, and Context routes.
5. Keep the leading retained-order cell sticky while horizontal scrolling exposes the complete JSON line.

### Surgical scope guard

The following are explicitly unchanged:

- Capture operation, Coverage, Live/Frozen position, and the placement/behavior of Find, Filter, Theme, and More actions.
- Scope breadcrumb/strip, Scope tree/sidebar, topology lifecycle, Scope picker, collapse/restore, and pane splitters.
- Retained-history ordering, 60-row visible window, oldest/older/newer/newest navigation, IndexedDB/in-memory fallback, retention, clear, teardown, and export behavior.
- Selection versus focus, keyboard movement, compact Context routing, restoration, and passive Capture behavior.
- Context header, metadata order, selected Item Update Fields/Changed fields/JSON patches, diagnostics, COMMAND projection actions, Local Injection route, and `Open complete raw`.
- Local Injection, COMMAND projections, capture instrumentation, event schema, storage schema, analytics, scoped copy, and application-facing behavior.

Do **not** add or reposition a toolbar, redesign Scope, add a `Chars`/Length column, add inline row expansion, add provenance colors or syntax colors with domain meaning, introduce a query language, create a new search index, add a new copy workflow, or add a duplicate normalized envelope in Context.

## Acceptance criteria

### 1. Red proof and exact change boundary

- [ ] Before production code changes, add/update a user-facing test that fails because Ordered Evidence still has the six legacy columns and passes only when the normalized JSON console is present.
- [ ] Retain an explicit baseline/current comparison scenario so the test suite proves the change is limited to the ledger instead of merely accepting new screenshots.
- [ ] For identical deterministic data, theme, viewport, Scope, selected Evidence, Filter, Find cursor, Live/Frozen state, and pane sizes, assert identical bounding boxes for the operating strip, Scope strip, Evidence header, diagnostics/conditions, retained-window controls, Scope pane, Context pane, splitters, and status strip.
- [ ] Base/changed/diff artifacts show no unexplained pixel delta outside the Ordered Evidence ledger rectangle. Any cascade outside that rectangle requires a separately documented decision and explicit maintainer approval.
- [ ] Context text, action names, action order, and scroll ownership are identical for the same selected Evidence before and after the migration.

### 2. JSON representation and truthfulness

- [ ] Every visible row exposes one complete valid JSON object representing the normalized Workbench Evidence plus its persistable event envelope; no captured property available at this boundary is silently dropped.
- [ ] Property order is deterministic and starts with `time`, textual `source`, `phase`, `command`, `kind`, `commandKey`, `id`, `object`, and `summary`, followed by the complete persistable `event`.
- [ ] `SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH` remain textual and visible in the JSON at compact, normal, shallow, and wide geometry.
- [ ] Snapshot/Live phase and `ADD`/`UPDATE`/`DELETE` remain explicit when applicable; non-applicable/unknown values use canonical JSON (`null` or omission according to the existing envelope contract), not presentation placeholders.
- [ ] The formatter uses `toPersistableEventEnvelope` (or the same canonical boundary) and excludes ephemeral `topology` state.
- [ ] Encoded JSON field values remain strings, with escaping and Unicode preserved exactly. Selecting the row still exposes the existing structured Context interpretation without mutating the captured value.
- [ ] Long client/session/subscription/item/key identities and large field values remain complete in the JSON document and exact in Context; truncation is visual only.
- [ ] The leading line value is the stable absolute retained-Evidence order, not the row’s index in the current 60-row window or filtered subset.

### 3. Find, Filter, retained history, and live growth

- [ ] Reuse the current complete-event search text and retained index. No second search index or JSON-specific query engine is introduced.
- [ ] Find still searches all retained Evidence, can navigate to an off-window match, marks and scrolls the current match, reports the correct ordinal/count, and never changes the selected Evidence or silently filters the visible set.
- [ ] Find highlighting is presentation-only and does not alter/corrupt copied or inspected JSON text.
- [ ] Filter still changes the visible Evidence set, shows the active filter and shown/total count, preserves independently selected Context, and retains the current one-step reset/reveal behavior.
- [ ] Oldest/Older/Newer/Newest and keyboard retained-window navigation retain their exact boundary focus and ordering behavior with filtered and unfiltered Evidence.
- [ ] Frozen high-volume investigation, Follow Live, passive growth, and scroll-anchor restoration behave exactly as today, including while the JSON document is horizontally scrolled.

### 4. Selection, focus, keyboard, and Context

- [ ] Up/Down moves row focus and selection together; Page Up/Page Down, Home/End, modified retained-bound keys, Enter, Escape, Tab/Shift+Tab, compact Back, and trigger restoration retain the accepted Roving Instrument behavior.
- [ ] Selection fill/leading marker, focus outline, and Find-current marker remain visually and programmatically distinct in Dark, Light, grayscale, zoom, and forced colors.
- [ ] A row has a concise accessible name containing time/order, textual source, phase, COMMAND operation, kind/object, key, and Evidence identity. Assistive technology is not forced to announce the entire potentially large JSON string during row navigation.
- [ ] The JSON remains available to sighted users and through the existing complete-raw inspection route; ARIA does not create duplicated or invalid grid semantics.
- [ ] Context remains the semantic interpreter. It contains metadata and selected update detail first, retains diagnostics/actions, and does not add a “Normalized envelope”/JSON duplicate.
- [ ] `Open complete raw`, COMMAND comparison, and Create Local Injection Draft retain their current eligibility, placement, focus return, and selected-Evidence target.

### 5. Geometry, density, and scroll ownership

- [ ] Verify `563×700` compact, `900×700` normal, `900×320` shallow, and `1440×900` wide using representative Dark and Light themes from `tests/ui/visual-matrix.json`.
- [ ] The Workbench shell and whole panel have zero horizontal overflow. Only the Ordered Evidence scroll owner owns JSON horizontal scrolling; Scope and Context retain their existing independent content scrolls.
- [ ] Wide remains Scope / Evidence / Context, normal remains Evidence over Context with temporary Scope, shallow remains Evidence beside Context, and compact remains one focused surface with exact return to the originating row.
- [ ] Pane minimums, splitter orientation/values, collapse/restore, temporary Scope placement, Context reachability, and button placement do not change.
- [ ] The visible DOM window remains bounded to the existing retained-window size. The JSON console must not render all retained events or add row expansion/variable height.
- [ ] The primary maintainer explicitly decides whether 27px single-line JSON rows at compact are an accepted raw-document presentation or whether the UI Standard’s compact two-line Evidence-row rule requires an exception/amendment. Record that decision; do not silently waive the rule.

### 6. Performance, privacy, and domain boundaries

- [ ] The formatter is deterministic and cached per event. Profiling confirms routine React rerenders do not reserialize unchanged retained events.
- [ ] Existing 4,000-event, live growth, long-identity, repository/search, render-performance, and release ZIP budget gates pass without weakening limits.
- [ ] No additional event fields are captured, persisted, exported, logged, or sent. This is a presentation migration over already captured Evidence.
- [ ] Capture remains observational and Local Injection remains separate, explicit, and marked. The JSON console cannot edit captured Evidence.
- [ ] The UI and docs call this Workbench Evidence/Event JSON, not raw WebSocket frames and not Authoritative COMMAND State.

### 7. Maintained verification and review gate

- [ ] Run `npm run typecheck`, `npm test`, `npm run test:ui`, and `npm run build`.
- [ ] Run the complete Material UI boundary gates: `npm run test:ui:extension`, `npm run fixture:test:browser`, `npm run release:package`, and `npm run docs:check`.
- [ ] Run `npm run test:ui:visual` and inspect base/reference, changed/current, and diff artifacts for every affected visual baseline. Update baselines only through the deliberate update commands and explain every intentional delta.
- [ ] Run the read-only UI suite on Darwin and the pinned Linux Playwright container; both sets of committed baselines pass.
- [ ] Exercise primary, high-volume, empty, limited/in-memory, disconnected/historical, Filter-hidden selection, and off-window Find scenarios.
- [ ] Record keyboard/focus results and axe serious/critical results for all affected geometries. No serious or critical accessibility finding remains.
- [ ] Provide an independent visual-QA packet containing acceptance criteria, base/changed/diff images, viewport/theme matrix, browser results, and accessibility/keyboard notes without implementation rationale. Resolve or explicitly accept every material finding.
- [ ] Record explicit primary-maintainer approval before merge. No permanent-surface/shared-component exception is implied by this ticket.

## Blocked by

- No code dependency.
- Approval gate: the primary maintainer must explicitly resolve the compact single-line JSON-row versus accepted compact two-line Evidence-row contract during implementation. If it is not accepted within the current standard, pause and record a scoped exception/amendment rather than hiding the conflict in a baseline update.

## Source

- [Disposable design evidence on `main`](https://github.com/imom39a/lightstreamer-workbench-extension/tree/main/prototypes/workbench-ui-11) (Variant A is today’s ledger; Variant B changes only the ledger to the surgical JSON console).
- [Workbench UI Standard](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/docs/WORKBENCH_UI_STANDARD.md)
- [Current EvidenceRow presentation](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/src/extension/panel/react/workbench-panel.tsx#L175)
- [Existing per-event presentation cache](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/src/extension/panel/workbench-runtime.ts#L2080)
- [Existing complete-event Find text](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/src/extension/panel/workbench-runtime.ts#L2725)
- [Canonical persistable envelope boundary](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/src/core/event-envelope.ts#L127)
- [Current event search text](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/src/core/event-filter.ts#L20)
- [High-volume/off-window Find browser coverage](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/tests/ui/workbench.spec.ts#L561)
- [Find-current/selection independence coverage](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/tests/ui/workbench.spec.ts#L1196)
- [Selected Context detail coverage](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/tests/ui/workbench.spec.ts#L1236)
- Requested after comparing the current Workbench panel with Chrome DevTools’ compact socket-frame stream and reviewing the surgical JSON-console prototype on 2026-08-06.
