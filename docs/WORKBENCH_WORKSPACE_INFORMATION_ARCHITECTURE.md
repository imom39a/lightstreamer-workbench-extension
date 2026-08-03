# Workbench Workspace Information Architecture

Status: accepted product direction, 2026-08-03

This document records the selected workspace model for the Lightstreamer Workbench Chrome DevTools panel. It applies the [canonical developer journeys](CANONICAL_DEVELOPER_JOURNEYS.md), the [current-panel audit](CURRENT_PANEL_UI_AUDIT.md), and the [Chrome DevTools interaction research](research/chrome-devtools-interaction-conventions.md). Detailed Local Injection, density, keyboard, and visual-semantic decisions remain assigned to their downstream Wayfinder tickets.

## Decision

Adopt a **Scoped Evidence Workspace**.

Ordered evidence is the permanent primary surface. A persistent runtime scope determines which evidence is in the investigation. Structural Topology chooses that scope instead of remaining a peer destination. Selection opens contextual detail without silently changing scope. COMMAND projections, raw capture, export, and Local Injection are lenses or actions reached from the relevant scope or evidence.

The model combines:

- the evidence-first organization of prototype A, **Scoped Evidence Console**;
- the runtime-object dossier and explicit target clarity of prototype B, **Runtime Lens**;
- ordinary compact master/detail Back restoration, without prototype C's maintained investigation-step taxonomy.

The architecture has no permanent Timeline, Topology, and COMMAND State peer destinations.

## Workspace anatomy

### Operating strip

The compact top-level strip communicates operating state, not product chrome or implementation internals. It keeps these distinctions directly available:

- whether Capture is useful, unavailable, or limited, including its confidence boundary;
- Capture active/stopped independently from the evidence view's Live/Frozen state;
- the current or recent client and Session context when space permits;
- material recovery or diagnostic entry when operation is degraded;
- low-frequency session actions through appropriately labelled contextual or overflow access.

Ordinary counts belong in an evidence summary rather than a permanent dashboard of metric cards. Labels such as “bridge connected” do not qualify as operator-facing status.

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

### Ordered evidence ledger

The evidence ledger is always the dominant working surface. It presents complete current-session evidence through a bounded or virtualized rendering while preserving chronological order.

Its stable scanning grammar includes:

- time and order;
- semantic evidence type or operation;
- Lightstreamer primitive identity, such as Subscription, item, key, or listener;
- concise changed-field or lifecycle summary;
- Server versus local provenance in text as well as visual treatment.

Scope, Filter, and Find remain distinct:

- **Scope** establishes the runtime boundary.
- **Filter** changes the visible evidence set and exposes its active criteria and shown/total counts.
- **Find** moves among matches without silently changing the evidence set.

Live Capture never steals focus, selection, scroll position, or detail context. Frozen investigation preserves the historical window while Capture continues and reports newer matching evidence.

### Contextual secondary surface

The secondary surface changes with context rather than becoming another permanent product destination.

When no evidence row is selected, it presents a **runtime-object dossier** for the active scope. The dossier assembles only relevant information, such as:

- identity and configuration;
- lifecycle and snapshot state;
- Capture coverage and material diagnostics;
- listeners and Update Delivery boundaries;
- a bounded recent-evidence summary;
- distinct COMMAND projections where the scope supports them;
- valid contextual actions for a live object.

When an evidence row is selected, the same secondary surface becomes an **evidence inspector**. Applicable lenses include Summary, Fields, Deliveries, COMMAND State, and Raw. Evidence remains primary; the inspector explains it and exposes valid follow-up actions.

This conditional dossier is the selected contribution from Runtime Lens. Runtime objects do not replace ordered evidence as the workspace organizer.

### COMMAND projections

Observed Server COMMAND State and Local Effective COMMAND State appear as named contextual lenses for a COMMAND Subscription, item, key, or relevant update. A compare treatment may juxtapose them but must never merge them or imply that either is Authoritative COMMAND State.

Complete COMMAND lifecycle analysis applies or inherits the relevant Subscription, item, and key scope, then correlates ordered ADD, UPDATE, DELETE, snapshot, generation, and warning evidence in the primary ledger.

### Local Injection transition

Local Injection is a first-class contextual transition, not a permanent editor or generic resend action.

The selected workspace supports:

- compatible Captured Item Update → **Create Local Injection Draft**;
- live COMMAND item or key scope → **Author COMMAND Item Update**;
- contextual menus as accelerators only, never the sole route.

The draft keeps the exact Local Injection Target visible and separates the immutable Injection Source from the editable Injection Draft. Target availability, validation, labelled execution, Injection Outcome, marked Injected Update, Timeline trace, and Local Effective COMMAND State effect remain explicit.

The draft occupies the contextual detail area where space permits. In compact geometry it becomes the one primary surface and Back restores the exact evidence selection and investigation state. Target retirement preserves safe edits, disables execution, and requires explicit reselection; Workbench never silently retargets.

Detailed editor composition and failure behavior will be selected by the dedicated Local Injection interaction ticket.

### Advanced tools

Advanced tools inherit the active scope or selected evidence and remain one interaction away:

- raw capture and Capture coverage diagnostics;
- complete COMMAND lifecycle analysis;
- Frozen and high-volume session history;
- versioned, credential-safe JSON or offline HTML export;
- complete evidence copy without rendering all retained rows.

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

**Scoped Evidence Workspace**, runtime-object dossier, evidence inspector, and layout categories are product-design language, not Lightstreamer domain concepts. No new domain term was resolved, so [CONTEXT.md](../CONTEXT.md) does not change. Existing Injection, Capture, Update Delivery, and COMMAND projection language remains authoritative.
