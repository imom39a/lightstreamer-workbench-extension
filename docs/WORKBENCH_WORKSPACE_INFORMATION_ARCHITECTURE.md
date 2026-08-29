# Workbench Workspace Information Architecture

Status: accepted product direction, 2026-08-03

This document records the selected workspace model for the Lightstreamer Workbench Chrome DevTools panel. It applies the [canonical developer journeys](CANONICAL_DEVELOPER_JOURNEYS.md), the [current-panel audit](CURRENT_PANEL_UI_AUDIT.md), and the [Chrome DevTools interaction research](research/chrome-devtools-interaction-conventions.md). Detailed Local Injection, density, keyboard, and visual-semantic decisions remain assigned to their downstream Wayfinder tickets.

## Decision

Adopt a **Scoped Evidence Workspace**.

Ordered evidence is the permanent primary surface. A persistent runtime scope determines which evidence is in the investigation. Structural Topology chooses that scope instead of remaining a peer destination. Selection opens contextual detail without silently changing scope. Raw capture, export, and Local Injection are lenses or actions reached from the relevant scope or evidence.

The model combines:

- the evidence-first organization of prototype A, **Scoped Evidence Console**;
- the runtime-object dossier and explicit target clarity of prototype B, **Runtime Lens**;
- ordinary compact master/detail Back restoration, without prototype C's maintained investigation-step taxonomy.

The architecture has no permanent Timeline, Topology, and COMMAND State peer destinations. The [integrated Activity amendment](WORKBENCH_INTEGRATED_ACTIVITY.md) places one compact shared timeline above Ordered Evidence and one collapsed scoped Activity summary in existing Context; it retires the separate Activity doorway after preserving its useful details.

## Workspace anatomy

### Operating strip

The compact top-level strip communicates operating state, not product chrome or implementation internals. It keeps these distinctions directly available:

- whether Capture is useful, unavailable, or limited, including its confidence boundary;
- Capture active/stopped independently from the evidence view's Live/Frozen state;
- the current or recent client and Session context when space permits;
- material recovery or diagnostic entry when operation is degraded;
- low-frequency session actions through appropriately labelled contextual or overflow access.

Ordinary counts belong in an evidence summary rather than a permanent dashboard of metric cards. Labels such as “bridge connected” do not qualify as operator-facing status.

### Notifications

The labelled **Notifications** entry in the global footer opens a temporary promoted document for active Workbench conditions and recent Lightstreamer diagnostics, including History and storage pressure, Capture and Coverage limits, Activity aggregation failure, canonical current-runtime recovery, runtime-Scope conditions, snapshot boundaries, keepalive callbacks, Subscription conditions, and COMMAND anomalies. It shows the unfiltered recent count and the highest Warning/Error severity, when present. Repeated notice text does not occupy selected Evidence Context or the operating footer.

Notifications spans the current Panel Session, independently of Evidence Scope and Filter. It preserves the existing bound of up to 100 active-or-recent diagnostic presentations, reports shown/total counts, and provides independent Code, Severity, and Affected filters with a visible reset. This is not a complete or persistent log; supporting Evidence follows Event History retention.

Each entry identifies severity, affected Evidence or object, observation, limitations and consequences, and its available inspection or recovery route. A recovery-only active condition keeps that recovery instruction visible before optional Details. **Back to Evidence** restores the originating investigation and focus. Deliberate inspection may reveal supporting Evidence or the affected Scope through the existing investigation navigation. Active footer conditions have a labelled Dismiss action; dismissal suppresses only that footer copy, retains the notification until the condition ends, and does not alter Evidence or its Diagnostic Observation. Stable condition identity updates one entry instead of piling up duplicates. Resolution clears the dismissal even while the footer is hidden, so a later recurrence surfaces again. Workflow-local validation stays at its decision boundary.

This responsibility uses the existing promoted-document boundary and adds no permanent peer workspace pane. The maintainer requested this separation on 2026-08-28 after recurring informational notices obscured selected Evidence.

### Runtime scope

The scope breadcrumb is the authoritative statement of the investigation boundary. It can contain the inspected Page, client, Session, Subscription, item, and a selected COMMAND key where applicable.

Structural Topology provides the scope picker:

- wide layouts may pin the bounded runtime tree;
- normal layouts open it as a temporary picker or collapsible pane;
- compact layouts open it as a full replacement sheet and return to evidence after selection;
- Page, client, Session, Subscription, item, and listener remain structural nodes;
- high-cardinality COMMAND keys never become structural peers in the tree;
- live, retired historical, unavailable, and incomplete-coverage scopes remain visibly distinct.

Scope selection and evidence selection are separate state. Selecting an evidence row must not silently rescope the ledger. An explicit action may narrow or reveal related scope while preserving a history entry.

Each structural Scope row uses a stable priority block: object type and runtime lifecycle first, complete identity as the primary line, then captured facts. Long identities may visually truncate only after receiving their own line; their complete value remains programmatically available and reachable from the owning Scope surface.

### Ordered evidence ledger

The evidence ledger is always the dominant working surface. It presents
complete current-session Evidence only through the current History Interval's
Committed Evidence Boundary, using bounded or virtualized rendering while
preserving chronological order. A stopped or failed History Interval does not
claim events beyond its final committed boundary.

Its stable scanning grammar uses four semantic columns:

- **Order**: a labelled rail anchored by authoritative retained History sequence, with exact Evidence identity preserved independently;
- **Evidence**: semantic evidence type first, with timestamp, textual provenance, and Snapshot/Live phase beneath it;
- **Command**: neutral COMMAND operation, or an explicit unavailable mark;
- **Object**: Lightstreamer primitive identity first, with the captured COMMAND key beneath it when applicable.

Concise changed-field and lifecycle summaries remain in Context rather than competing with the row's scanning anchors. Server versus local provenance is always text, not color alone.

Scope, Filter, and Find remain distinct:

- **Scope** establishes the runtime boundary.
- **Filter** changes the visible evidence set and exposes its active criteria and shown/total counts.
- **Find** moves among matches without silently changing the evidence set.

Live Capture never steals focus, selection, scroll position, or detail context. Frozen investigation preserves the historical window while Capture continues and reports newer matching evidence.

### History and operating boundaries

One Panel Session owns one temporary Event History. The normal IndexedDB journal
supports 100,000 Evidence records or 256 MiB of retained serialized journal bytes;
the startup in-memory fallback supports 5,000 records or 32 MiB. The selected
adapter is fixed before the first offer and never changes during the session.
Fallback changes History Capacity only; Capture Operation, Observation Coverage,
and Live/Frozen position remain independent.

Clear is a deliberate exact History Interval cut: accepted work settles before
the old interval is removed and post-cut Evidence belongs only to the new
interval. Capacity pressure or journal failure stops acceptance fail-closed at
the final Committed Evidence Boundary; Clear cannot restart it. Controlled Close
attempts erasure and reports its outcome. Abnormal termination can leave
residual data until an ownership-safe guarded sweep, which never replays
abandoned Evidence. A new Panel Session starts empty.

### Contextual secondary surface

The secondary surface changes with context rather than becoming another permanent product destination.

When no evidence row is selected, it presents a **runtime-object dossier** for the active scope. The dossier assembles only relevant information, such as:

- identity and configuration;
- lifecycle and snapshot state;
- Capture coverage and material diagnostics;
- listeners and Update Delivery boundaries;
- a bounded recent-evidence summary;
- relevant COMMAND lifecycle diagnostics where the scope supports them;
- valid contextual actions for a live object.

When an evidence row is selected, the same secondary surface becomes an **evidence inspector**. Applicable lenses include Summary, Fields, Deliveries, and Raw. The collapsed Activity summary, Filter selected Evidence, and Evidence metadata disclosures precede Selected update, keeping captured Fields in the initial viewport while the supporting context remains directly expandable. Selected provenance remains visible in the inspector header, and the Filter disclosure remains stable with an explicit unavailable state when it has no typed actions. Runtime-object dossiers remain expanded when no Evidence is selected. Evidence remains primary; the inspector explains it and exposes valid follow-up actions.

This conditional dossier is the selected contribution from Runtime Lens. Runtime objects do not replace ordered evidence as the workspace organizer.

### COMMAND lifecycle analysis

Complete COMMAND lifecycle analysis applies or inherits the relevant Subscription, item, and key scope, then correlates ordered `ADD`, `UPDATE`, `DELETE`, snapshot, generation, and diagnostic Evidence in the primary ledger. Workbench does not add a general reconstructed-state lens or comparison document; internal state remains available to validation, Scenarios, Checkpoints, and diagnostic producers.

### Local Injection transition

Local Injection is a first-class contextual transition, not a permanent editor or generic resend action.

The selected workspace supports:

- compatible Captured Item Update → **Create Local Injection Draft**;
- live COMMAND item or key scope → **Author COMMAND Item Update**;
- contextual menus as accelerators only, never the sole route.

The draft keeps the exact Local Injection Target visible and separates the immutable Injection Source from the editable Injection Draft. A captured Draft compares Source and Draft by default, using that same authoring surface as the delivery preview. Target availability, validation, the direct labelled **Inject locally** action, Injection Outcome, marked Injected Update, and Timeline trace remain explicit; there is no separate standalone Review document.

The draft occupies the contextual detail area where space permits. In compact geometry it becomes the one primary surface and Back restores the exact evidence selection and investigation state. Target retirement preserves safe edits, disables execution, and requires explicit reselection; Workbench never silently retargets.

Detailed editor composition and failure behavior will be selected by the dedicated Local Injection interaction ticket.

### Advanced tools

Advanced tools inherit the active scope or selected evidence and remain one interaction away:

- raw capture and Capture coverage diagnostics;
- complete COMMAND lifecycle analysis;
- Frozen and high-volume session history;
- versioned, credential-safe JSON or offline HTML export;
- complete current-interval Evidence copy through the Committed Evidence Boundary without rendering all retained rows.

Advanced tools do not become permanent top-level destinations. Opening and closing them preserves the originating scope, selection, filters, scroll anchor, Live/Frozen state, and safe draft.

## Layout behavior by available space

### Wide

- The ordered evidence ledger receives the dominant share of the workspace.
- The bounded runtime scope tree may be pinned on the left.
- The object dossier or evidence inspector may coexist on the right.
- Both secondary panes are independently collapsible and resizable.
- Wide space may increase visible context but cannot introduce capabilities unavailable in compact layouts.

### Normal

- The scope tree becomes a temporary picker or collapsed pane.
- Evidence remains primary.
- Detail normally moves to a resizable lower master/detail split so useful evidence columns remain comparable.
- The workspace preserves independent side and stacked detail dimensions.

### Compact

- Exactly one primary working surface is visible: scope picker, evidence, detail, raw evidence, export review, or Injection Draft.
- Evidence selection does not automatically replace the ledger; an explicit Open or Enter transition opens detail.
- Back returns to the exact prior row, keyboard focus, scroll anchor, scope, filter, and Live/Frozen state.
- This is ordinary responsive master/detail navigation, not an investigation workflow or maintained step taxonomy.
- Target identity, provenance, validation, status, and the final Inject action remain reachable at the narrowest supported geometry.

## Navigation and state rules

1. Opening the panel first establishes whether Workbench is observing a useful runtime.
2. Evidence remains accessible at Page scope before the developer knows the relevant runtime object.
3. The scope breadcrumb and selected row are visibly different and independently preserved.
4. Object selection assembles a dossier; evidence selection assembles an inspector.
5. Revealing related evidence or narrowing scope is an explicit, reversible operation.
6. Back/Forward restoration preserves scope, filters, selection, inspector lens, scroll anchor, Live/Frozen position, and draft state.
7. A retired object remains readable historical evidence but cannot remain a Local Injection Target.
8. Capture state changes do not silently change Live/Frozen view, discard history, or close a draft.
9. Compact, normal, and wide layouts expose the same capability model.
10. Context menus accelerate visible operations and never hide the only route to a core action.

## Rejected alternatives

### Preserve the current three feature destinations

Rejected because Timeline, Topology, and COMMAND State force developers to translate and reselect context across feature silos. The redesign preserves their capabilities, not their status as peer navigation.

### Runtime Lens as the primary organizer

Rejected as the full architecture. It provides strong multi-client orientation, an effective runtime-object dossier, and explicit Local Injection target context, all of which the selected model borrows. Making object navigation primary would add navigation tax for event-first investigations, risk tree churn during live operation, and demote the high-volume ordered evidence that defines the primary debugging journey.

### Investigation Stack

Rejected. A maintained Orient → Scope → Evidence → Explain → Act workflow is too narrowly focused for generic Lightstreamer developer infrastructure. As Workbench evolves, new scenarios would force the team to update a product-owned investigation taxonomy and could constrain expert workflows that do not follow the prescribed sequence.

The selected model retains only conventional compact master/detail Back restoration. It does not expose investigation steps, task frames, or a guided workflow trail.

## Prototype evidence

The disposable [workbench-ui-04 prototype](../prototypes/workbench-ui-04/README.md) provides all three models on one deterministic diagnostic scenario. It includes captured-update and Local Injection transitions plus screenshots at:

- compact: 563 × 700;
- normal: 900 × 700;
- wide: 1440 × 900.

The [prototype comparison](../prototypes/workbench-ui-04/COMPARISON.md) records the evaluated trade-offs. The product owner reviewed the variants sequentially and explicitly accepted the Scoped Evidence Workspace synthesis.

## Downstream decisions

This decision fixes the workspace organizer and responsive structure. It deliberately leaves these questions to the existing frontier tickets:

- complete Local Injection editor and outcome interaction;
- exact density, pane sizing, overflow, and docked-size thresholds;
- keyboard commands, focus ownership, selection behavior, and contextual-command details;
- visual semantics for Capture confidence, lifecycle, provenance, diagnostics, and outcomes.

Those decisions may refine the prototype but cannot reintroduce peer feature destinations or a maintained investigation stack without reopening this architecture decision.

## Vocabulary resolution

**Scoped Evidence Workspace**, runtime-object dossier, evidence inspector, and layout categories are product-design language, not Lightstreamer domain concepts. No new domain term was resolved, so [CONTEXT.md](../CONTEXT.md) does not change. Existing Injection, Capture, Update Delivery, and internal COMMAND-state language remains authoritative.
