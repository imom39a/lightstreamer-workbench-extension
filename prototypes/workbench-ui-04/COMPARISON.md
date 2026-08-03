# Workspace model comparison

Status: reviewed; Scoped Evidence Workspace selected

## Selection

The selected architecture uses **A — Scoped Evidence Console** as its organizer: ordered evidence remains the permanent primary surface under an explicit runtime scope.

It borrows **B — Runtime Lens** behavior when assembling the contextual secondary surface: an active runtime object receives a concise dossier, and Local Injection always exposes its exact live Subscription target. B does not replace evidence as the primary organizer.

**C — Investigation Stack** is rejected. Its maintained question and step taxonomy would be too narrowly focused for generic developer infrastructure and would become expensive to evolve as Workbench gains new scenarios. The selected model retains conventional compact evidence → detail → draft Back restoration without exposing a workflow stack.

All three models use the same deterministic diagnostic state and preserve the same Lightstreamer domain semantics. They disagree about what permanently organizes the workspace.

## A — Scoped Evidence Console

**Organizer:** one ordered evidence ledger under a persistent runtime scope.

- Structural Topology is a scope picker, pinnable at wide sizes.
- Selecting evidence opens semantic detail; COMMAND projections are an inspector lens.
- Local Injection forks selected immutable evidence into a draft within the detail path.
- Compact behavior is evidence → detail → draft → trace with exact Back restoration.

Strongest at chronological scanning, high-volume Capture, and the primary missing/incorrect-update investigation. Its main risks are making runtime orientation too subtle, confusing scope with filters, and hiding contextual actions in the inspector.

## B — Runtime Lens

**Organizer:** the selected runtime object; Workbench assembles a contextual dossier around it.

- Structural Topology is the primary wide/normal navigator.
- Activity, configuration, coverage, projections, and valid actions are lenses on the selected object.
- Local Injection naturally inherits an explicit live Subscription target.
- Compact behavior uses a runtime-scope replacement sheet and then one object dossier at a time.

Strongest at multiple-client/Session orientation, target clarity, and synthesizing why one object is behaving as observed. Its main risks are navigation tax, weak event-first investigation, tree churn, and dossier sections becoming another dashboard.

## C — Investigation Stack

**Organizer:** the current developer question in an explicit orient → scope → evidence → explain → act trail.

- Topology, raw capture, lifecycle analysis, export, and Local Injection are pushed task frames.
- Each frame inherits scope and owns its selection, filters, Live/Frozen state, and scroll anchor.
- Compact is the source layout; normal and wide sizes add only supporting previews and trail context.
- Local Injection is a deliberate full working frame followed by an outcome and trace path.

Strongest at compact coherence, recovery, explicit fault-boundary reasoning, and deliberate action. Its main risks are drill-down fatigue, hiding sibling/cross-object evidence, over-guiding expert operators, and requiring unusually disciplined frame-state restoration.

## Review dimensions

### Navigation depth

- A is shallowest when the developer starts from time, event, command, or key evidence.
- B is shallowest when the developer already knows the client, Session, Subscription, or item.
- C makes journey progress clearest but adds a frame transition whenever the question changes.

### Preserved context

- A distinguishes persistent scope from selected evidence.
- B distinguishes object scope from selected activity.
- C preserves a complete stack frame for every task transition.

All require stable focus, selection, filters, Live/Frozen state, scroll anchors, and drafts during Capture and resizing.

### Scan efficiency

- A devotes the largest share to dense ordered evidence.
- B devotes the largest share to an assembled object explanation.
- C devotes all compact space to the current question and uses consistent two-line evidence rows.

### Action discoverability

- A keeps actions close to selected evidence but risks inspector under-discovery.
- B exposes actions on the current object but can over-promote them before evidence.
- C gives Local Injection an explicit Act stage but may make expert action feel unnecessarily sequential.

### High-volume behavior

- A is the most direct fit for a virtualized chronological ledger.
- B queries evidence by object before rendering, reducing noise but potentially hiding cross-object causality.
- C uses the same virtualized ledger inside an Evidence frame, with more transitions to compare other scopes.

### Compact DevTools behavior

- A becomes a conventional master → detail → draft flow.
- B replaces the navigator with the selected object dossier and relies more heavily on scope/back controls.
- C changes least because one full frame is already its canonical layout.

## Shared non-negotiables

Whichever model wins must retain:

- operator-facing Capture and coverage confidence before feature navigation;
- explicit runtime scope and distinct selected evidence;
- evidence before action;
- separately named Observed Server and Local Effective COMMAND projections;
- immutable Injection Source, separate Injection Draft, exact Local Injection Target, validation, labelled Inject boundary, outcome, and local trace;
- no Server Injection workflow in this effort;
- structural bounded Topology and high-cardinality evidence outside the tree;
- compact, normal, and wide operation without changing the journey semantics;
- advanced raw evidence, lifecycle, Frozen history, and export one interaction from the relevant scope;
- stable keyboard focus, selection, scroll, filters, projections, and drafts through live updates and resizing.

The review may select one model or synthesize a primary model with specific borrowed behavior. A synthesis must still name one organizer clearly; combining all permanent surfaces would recreate the current bloat.
