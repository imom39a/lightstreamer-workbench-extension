# Current panel developer-journey audit

Date: 2026-08-03

Scope: the shipped Lightstreamer Workbench Chrome DevTools panel before the
`workbench-ui` redesign. This document records evidence and constraints; it
does not choose the replacement information architecture.

## Executive assessment

The current panel has strong debugging capabilities and unusually good
behavioral guardrails, but its interface is organized around three internal
feature destinations—Timeline, Topology, and COMMAND State—rather than the
developer journey of orienting to the inspected runtime, investigating an
observation, and taking a deliberate scoped action.

This is not primarily a styling problem. A visual reskin would retain the
largest sources of friction:

- permanent product, view, filter, status, and settings chrome competes with
  captured evidence;
- context is partitioned among three peer views with different searches,
  selections, details, and action locations;
- COMMAND investigation expands into four simultaneous panes at wide sizes
  and four vertically stacked surfaces at compact sizes;
- Topology presents a metric strip and then repeats much of that information
  in the selected page detail;
- Local Injection is exposed through the obsolete language of “Replay” and
  “Re-inject,” obscuring the immutable-source → editable-draft → additional
  local action model already established by the project glossary;
- the responsive rules keep controls technically reachable, but they do not
  establish a coherent compact debugging workflow.

The redesign should preserve the current domain behavior, performance bounds,
and verification coverage while treating the current views, pane count,
header, labels, and action placement as replaceable.

## Evidence reviewed

The current `main` branch passed the complete real-browser UI gate during this
audit: 20 of 20 Playwright tests, including sustained memory and IndexedDB
Timeline streams, Topology, high-cardinality COMMAND evidence, export,
keyboard behavior, serious/critical axe checks, and visual regression.

The following deterministic screenshots were inspected:

| Working shape | Scenario | Evidence |
| --- | --- | --- |
| Normal, 900×700, Dark | Timeline following sustained Capture | [Timeline Live](../tests/ui/visual-regression.spec.ts-snapshots/timeline-live-dark-900x700.png) |
| Normal, 900×700, Light | Frozen filtered Timeline with selected detail | [Timeline Frozen](../tests/ui/visual-regression.spec.ts-snapshots/timeline-frozen-light-900x700.png) |
| Wide, 1280×800, Dark | Expanded structural Topology | [Topology expanded](../tests/ui/visual-regression.spec.ts-snapshots/topology-expanded-dark-1280x800.png) |
| Wide, 1280×800, Light | Collapsed structural Topology | [Topology collapsed](../tests/ui/visual-regression.spec.ts-snapshots/topology-collapsed-light-1280x800.png) |
| Wide, 1440×900, Dark | High-cardinality COMMAND evidence in Topology | [Topology COMMAND evidence](../tests/ui/visual-regression.spec.ts-snapshots/topology-command-evidence-dark-1440x900.png) |
| Compact, 563×137, Light | Open Topology export | [Compact Export](../tests/ui/visual-regression.spec.ts-snapshots/export-open-light-563x137.png) |
| Wide, 1280×800, Auto | Selected Timeline event and Local Injection entry | [Timeline detail](../tests/ui/panel.spec.ts-snapshots/timeline-detail-auto-1280x800.png) |
| Wide, 1280×800, Auto | COMMAND key lifecycle and selected detail | [COMMAND State](../tests/ui/panel.spec.ts-snapshots/command-state-auto-1280x800.png) |
| Wide, 1280×800, Auto | Authored COMMAND Local Injection draft | [New COMMAND update](../tests/ui/panel.spec.ts-snapshots/new-command-auto-1280x800.png) |

Additional deterministic renders were inspected locally at 563×700 and
900×700 for Timeline detail, COMMAND State, and the new COMMAND draft, in Dark
and Light themes. The audit also reviewed the panel DOM/CSS, deterministic
scenario definitions, accessibility and visual-QA guidance, `CONTEXT.md`, all
accepted ADRs, architecture documentation, and privacy policy.

This is a product and codebase audit, not a comparative usability study with
external developers. The canonical journey ticket must still establish the
human success criteria used to judge prototypes.

## Capability inventory

### Session and Capture shell

- Capture/bridge status, retained-event count, filtered count, and a
  high-volume retention warning.
- Theme override, optional analytics consent/control, and destructive
  current-session event clearing.
- Session-scoped ordered event history using IndexedDB with an in-memory
  fallback.

### Timeline investigation

- Search across normalized fields, identifiers, COMMAND values, and raw JSON.
- Bounded 60-row rendering backed by complete retained history.
- Independent Capture, Live/Frozen Timeline, history-window, filter, pinned
  selection, and selected-detail state.
- Older/Newer navigation, newer matching-event counts, and deliberate return
  to Live.
- Comparable event columns for time, code, item, COMMAND/key, and provenance.
- Selected-event JSON, current fields, changed fields, context, raw capture,
  copy, and Local Injection entry points.

### Runtime Topology

- Page → client → Session → Subscription → item → listener hierarchy.
- Active, waiting, historical, and unassigned structures with stable selection
  and keyboard tree navigation.
- Coverage, synchronization, client/subscription settings, snapshot phase,
  logical-update and delivery counts, loss/error/duplicate/overlap evidence,
  and live target availability.
- Structural bounding for items and COMMAND generations, incremental reveal,
  complete evidence copy, and a scoped route to COMMAND State.
- Current-observation reset, frozen-history clearing, and privacy-safe JSON and
  self-contained HTML export.

### COMMAND investigation

- Explicit Observed Server and Local Effective projections.
- Subscription/item groups, active and deleted keys, per-key lifecycle,
  selected update, fields, provenance, and diagnostics.
- Search across state, fields, diagnostics, event identifiers, and JSON.
- Captured-update Local Injection, mutated drafts, and newly authored COMMAND
  updates with schema-aware validation and target status.

### Safety, accessibility, and operational behavior

- Immutable captured evidence and separate draft mutation.
- Live/stale/session-mismatch target checks, disabled invalid actions, and
  page-delivery outcomes before a local synthetic event is appended.
- Resizable panes with keyboard-accessible separators where panes remain
  side-by-side.
- Roving-focus Topology tree with Arrow, Home/End, selection, expand/collapse,
  and typeahead behavior.
- Stable selection, focus, scroll, open detail sections, and drafts during
  passive live updates.
- Deterministic browser scenarios, representative visual baselines,
  accessibility checks, and independent visual QA requirements.

## Journey audit

### Orient: “Is Workbench capturing the runtime I care about?”

What works:

- Capture state is persistently visible.
- Topology exposes the detected client, Session, Subscription, item, and
  listener structure with coverage and synchronization state.
- Waiting, historical, limited-coverage, and high-volume conditions have
  explicit data models rather than being inferred from an empty log.

What impedes the journey:

1. **The default destination is Timeline, not runtime orientation.** A developer
   must know to switch to Topology before answering which clients and
   Subscriptions exist or whether coverage is complete.
2. **The global status uses implementation language.** “bridge connected” and
   “capturing” report internal connectivity but do not summarize whether the
   inspected page has useful Lightstreamer coverage, what is live, or which
   condition needs attention.
3. **The Topology overview is exhaustive rather than prioritized.** Seven
   metric blocks plus four actions form a horizontally scrolling band. The
   selected page detail then repeats clients, Sessions, Subscriptions, items,
   listeners, coverage explanation, and observation scope.
4. **Explanatory prose occupies the normal working surface.** Coverage and
   observational-boundary notes remain visible even after the runtime is
   understood, while anomalies and next investigative actions receive no
   equivalent priority.
5. **The empty state mentions the fixture page.** “Open the fixture page or
   refresh the inspected app” leaks contributor/test context into the generic
   developer product and does not distinguish no client, late instrumentation,
   unsupported client, disconnected bridge, or simply no update yet.
6. **Global chrome consumes the evidence budget.** At 900×700 the product
   header, peer-view selector, and Timeline/COMMAND filter strip consume about
   130 px before the first evidence row. At 563 px wide the header and filter
   controls wrap, consuming about 200 px before selected detail begins.

### Investigate: “What happened, where, and why?”

What works:

- Timeline provides an ordered, searchable, bounded live log without dropping
  retained history.
- Live/Frozen state protects historical investigation while Capture continues.
- Selected detail, raw evidence, copy, and COMMAND projections expose the data
  necessary for deep diagnosis.
- Topology remains structural at high cardinality, and COMMAND State owns the
  complete key lifecycle.
- Tree and detail state survive passive Capture updates, which is essential for
  a streaming debugger.

What impedes the journey:

1. **Navigation follows subsystems instead of questions.** Timeline, Topology,
   and COMMAND State are presented as equal destinations. Each has its own
   search, selection, and detail model, so developers must mentally transfer
   client/Subscription/item/key context between surfaces. Topology has a
   dedicated route into COMMAND State, but cross-surface continuity is the
   exception rather than the workspace model.
2. **The Timeline code column is compact but cryptic.** Values such as `U`,
   `SUBCMD`, and Workbench-specific codes require a separate legend. The code
   optimizes horizontal space but not recognition of the event’s diagnostic
   meaning or relevance.
3. **Selected Timeline detail promotes action before evidence.** The “Replay”
   card precedes current fields and raw context for compatible Item Updates,
   even when the developer’s goal is only to understand the event.
4. **Topology detail has weak signal hierarchy.** Large property tables present
   identity, settings, counters, phases, and evidence with similar weight;
   warnings and causal clues can sit below several screens of ordinary values.
5. **COMMAND State requires too many simultaneous surfaces.** Wide layout uses
   Subscriptions, keys, updates, and detail panes. At 760–1199 px it becomes a
   full-width Subscription row, side-by-side keys/updates, and a full-width
   detail row. Below 760 px all four panes stack in one scrolling workspace.
6. **Compact COMMAND State is technically responsive but operationally poor.**
   At 563×700 the selected Subscription pane alone receives roughly 180 px,
   including empty space; keys begin below it, update rows begin near the
   viewport bottom, and selected detail or a draft is below the fold. The
   developer cannot scan key → update → detail as one working context.
7. **Pane adaptation is inconsistent across views.** Timeline hides its evidence
   list when detail is open below 600 px, Topology stacks a resizable tree and
   detail below 760 px, and COMMAND stacks four independently scrolling panes.
   Breakpoints at 400, 499, 599, 759, 959, and 1199 px encode local fixes rather
   than a shared compact/normal/wide operating model.
8. **The current scenario matrix underrepresents critical states.** There is no
   committed compact visual baseline for Timeline detail, COMMAND
   investigation, or a Local Injection draft, and no visual scenario for empty,
   disconnected, partial/limited coverage, invalid draft, stale target, or
   failed Local Injection states.

### Act: “What can I safely do from this evidence?”

What works:

- Copy, filter, Freeze/Follow, history navigation, complete-evidence copy,
  export, reset, and clear operations exist.
- Local Injection validates the captured context and current target before
  execution and reports outcomes.
- The draft model can show source fields, edited fields, changed fields,
  command, key, snapshot status, and validation diagnostics.
- The new COMMAND workflow supports captured-update reuse, mutation, and
  authored updates without contacting a server.

What impedes the journey:

1. **The primary action vocabulary contradicts the domain model.** The UI uses
   “Replay,” “Re-inject,” “Mutate & re-inject,” “Replay source,” and “synthetic
   replay.” `CONTEXT.md` explicitly chooses Injection, Injection Source,
   Injection Draft, Mutation, Local Injection, and Injected Update and lists
   replay/reinjection language under “Avoid.”
2. **The additional-action boundary is not clear enough at decision time.**
   “Re-inject” can read as editing or repeating the captured event rather than
   creating a separate Local Injection while the immutable captured update
   remains part of observed evidence.
3. **Target scope is compressed into a status pill.** “Target: live
   Subscription” is correct but does not foreground that one Logical Update
   will be delivered locally to every current listener of that Subscription and
   will not enter the server stream.
4. **Local Injection is fragmented across entry points.** Captured updates start
   in Timeline or COMMAND detail; authored updates start from the keys pane;
   target, source, field comparison, diagnostics, action, and resulting local
   evidence can occupy different panes or different vertical regions.
5. **The authored-action label is misleading.** The sticky action says “New
   COMMAND key” and its helper says the key does not exist, but the deterministic
   scenario opens that action, chooses `UPDATE`, and targets the existing
   `alpha` key. The actual capability is authoring a COMMAND Item Update, not
   only creating a new key.
6. **The action is permanently promoted before it is needed.** “New COMMAND
   key” occupies the top of the keys pane for every selected item, and the
   “Replay” card occupies the top of compatible selected-event detail. Both
   compete with evidence during ordinary investigation.
7. **Destructive and reset scopes are difficult to compare.** “Clear events” is
   global, “Reset current” clears Topology observations, and “Clear history”
   removes frozen Topology only. Their short labels depend on tooltips to explain
   materially different consequences and appear in separate interface regions.
8. **Export is a Topology-local action despite being a session artifact.** Its
   compact popover is well guarded and reachable, but discovery depends on the
   developer first treating Topology as the correct destination.

## Terminology conflicts

| Current UI term | Canonical term or distinction | Risk |
| --- | --- | --- |
| Replay / Re-inject | Local Injection | Suggests re-running or editing historical evidence rather than requesting an additional local action. |
| Replay source | Injection Source | Hides the source’s immutability. |
| Mutate & re-inject | Create/edit an Injection Draft, then Inject locally | Collapses drafting and execution into one ambiguous label. |
| Synthetic live | Local Injected Update / local provenance | “Synthetic” describes implementation provenance but not the developer-controlled local action. |
| New COMMAND key | Author COMMAND Item Update | Incorrect for UPDATE/DELETE and for existing keys. |
| Bridge connected | Capture connection/coverage state | Exposes an internal bridge without answering whether useful runtime evidence is available. |

Internal function and analytics names may migrate separately, but all visible
copy in the redesigned workflow must use `CONTEXT.md` consistently.

## Capability-preservation boundary

The following are product semantics, not layout decisions. The redesign must
preserve them even if every current view and control is replaced.

1. **Capture remains observational.** Captured Item Updates are immutable and
   continue on the application’s original path. Mutation applies only to a
   separate Injection Draft; every Injection is an explicit additional action.
2. **Local Injection is Subscription-scoped.** It targets one selected
   Subscription and delivers one Logical Update to all current listeners on
   that Subscription, never one historical listener or every matching page
   Subscription.
3. **No Server Injection workflow is introduced.** Local Injection does not
   contact Lightstreamer Server or claim to create an inbound Server Update.
4. **COMMAND projections stay distinct.** Observed Server COMMAND State uses
   Server Updates only; Local Effective COMMAND State additionally applies
   successful Local Injected Updates. The selected projection and provenance
   remain persistently visible.
5. **Capture, Live/Frozen Timeline, history window, filters, and pinned detail
   remain independent.** Investigating history must not pause Capture or lose
   newer matching-event counts.
6. **Accepted events remain complete and ordered for one DevTools session.**
   IndexedDB is operational backing with an in-memory fallback, not cross-session
   product persistence. Clear and teardown semantics remain ordered.
7. **Topology remains structural.** Page, client, Session, Subscription, item,
   and listener are the hierarchy. High-cardinality COMMAND identities remain
   bounded evidence with complete copy/export and a route to lifecycle detail.
8. **Historical Topology remains frozen and read-only.** It never masquerades as
   a connection maintained by Workbench and never becomes an Injection target.
9. **Export remains one immutable, versioned, credential-safe snapshot.** JSON
   and offline HTML share the same data; category redaction and complete evidence
   are deliberate choices; credential-like values are always excluded.
10. **Target validity remains authoritative at execution time.** Stale,
    unavailable, and session/connection changes remain explicit; failed page
    delivery does not create a panel-only Injected Update.
11. **Streaming interaction state remains stable.** Passive updates must preserve
    focus, selection, scroll anchors, pane/detail state, and active drafts while
    bounded rendering protects performance.
12. **Privacy and analytics boundaries remain intact.** Capture content stays
    local; analytics remains opt-in and accepts only its coarse closed allowlist;
    exact client IP data never crosses the capture boundary.
13. **Keyboard and browser verification remain release gates.** Tree/grid/pane
    semantics, visible focus, accessible names/states, compact reachability, real
    downloads, and independent visual QA are capabilities to improve, not trade
    away for density.

## What may change freely

Subject to later decision tickets, the redesign may replace or consolidate:

- the Timeline/Topology/COMMAND State peer-view selector;
- the branded header and permanent Theme/analytics placement;
- the default landing surface;
- the number, orientation, and persistence of panes;
- separate Timeline and COMMAND searches;
- the Topology metric strip and repeated page summary;
- the location and prominence of copy, export, clear, reset, and Local Injection
  actions;
- every visible Replay/Re-inject label;
- breakpoint values and view-specific compact transformations;
- card, table, tree, detail, popover, and status presentation, provided the
  capability-preservation boundary remains satisfied.

## Prioritized findings for the next decisions

1. **Choose a journey-first workspace model.** The information-architecture
   prototype must demonstrate live orientation, evidence selection, preserved
   scope, deep investigation, and deliberate action without requiring the user
   to translate context among three feature silos.
2. **Make compact operation a primary design case.** A compact panel must present
   one useful working context at a time with an explicit path back and preserved
   scope; stacking four COMMAND surfaces is not sufficient.
3. **Redesign Local Injection around the domain transition.** Every prototype
   must make source immutability, draft state, target Subscription, validation,
   local-only boundary, final action, outcome, and resulting provenance
   inspectable without using replay terminology.
4. **Reduce permanent chrome and distinguish state classes.** Persistent
   operating state, selected scope, evidence summary, contextual action, and
   transient outcome need distinct placements instead of accumulating in the
   product header and per-view bars.
5. **Prioritize anomalies over exhaustive summaries.** Live orientation should
   surface coverage gaps, inactive/stale state, diagnostics, and the next useful
   investigative route before repeating ordinary counts and explanatory prose.
6. **Expand the scenario matrix with the selected architecture.** Later
   prototypes and production slices need empty, disconnected, degraded capture,
   compact investigation, stale/invalid Local Injection, failed delivery,
   high-volume, and resize-with-preserved-context evidence.
7. **Use the existing browser guardrails as the migration safety net.** The
   strong current tests should protect semantics during redesign, but baseline
   parity must not be mistaken for usability validation.

## Deferred questions

This audit deliberately does not decide:

- which capabilities become persistent workspace regions, peer modes,
  contextual detail, drawers, or commands;
- the exact compact/normal/wide thresholds;
- default pane orientation, size, or persistence;
- the final Local Injection entry points and editor presentation;
- the final status/provenance visual language;
- the keyboard shortcut set;
- the production migration slices.

Those decisions remain in the downstream `workbench-ui` Wayfinder tickets.
