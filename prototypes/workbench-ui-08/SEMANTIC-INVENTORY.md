# PROTOTYPE — Visual-semantic inventory

Status: resolved through **A — Plain Ledger**. See the durable [Workbench Visual Semantics](../../docs/WORKBENCH_VISUAL_SEMANTICS.md) contract.

Question: how should Workbench encode status, provenance, diagnostics, and outcomes for fast, accurate scanning without becoming a decorative brand system?

This inventory separates independent semantic axes before any palette or component is chosen. Combining axes is a correctness bug: a COMMAND `DELETE` is not an error, Local provenance is not success, Snapshot is not Server provenance, and selection is not domain status.

## Axes that must remain independent

### 1. Capture operation and coverage

- Capture operation: capturing, idle/stopped, bridge connected, bridge disconnected.
- Observation coverage: complete or partial, with a reason such as late attachment, unavailable getter, unsupported shape, limit exceeded, or sanitization failure.
- Storage/retention condition: durable session storage, in-memory fallback, retained-history pressure, or material loss/limit.
- Investigation position: Live or Frozen, with newer matching evidence. This is not Capture state.

Developer decision: can I trust that Workbench is observing now, and what evidentiary limit applies?

### 2. Runtime lifecycle

- Client/Session connection: connecting, connected, recovering, stalled, disconnected, unknown.
- Session identity: current/live or retained historical/frozen.
- Subscription: subscribed, waiting for Session, pending, failed, inactive, or retired historical evidence.
- Snapshot phase: not requested, waiting, snapshot, snapshot complete, live, cleared, or unknown.
- Listener: active or inactive/retired.

Developer decision: is this runtime object currently usable, transitional, failed, or historical evidence only?

### 3. Evidence provenance and observation path

- Captured Server evidence: an observed Server Update or lifecycle event that followed the application's ordinary path.
- Local Injected evidence: a Logical Update known to have been introduced by a Local Injection.
- Update Delivery inherits the provenance of its Logical Update.
- Listener/wire describes the Capture observation path. It does not turn Server evidence into Local evidence or establish causal attribution.
- Injection Source is immutable evidence; Injection Draft is prospective and editable.

Developer decision: did this evidence come from the Server flow or from a deliberate Local Injection, and how was it observed?

### 4. COMMAND operation and phase

- Operation: ADD, UPDATE, or DELETE. All are neutral protocol operations.
- Phase: snapshot or live. A Local Injection may deliberately carry a snapshot flag, so phase does not imply Server provenance.
- Row lifecycle: active or deleted.

Developer decision: what operation occurred, in which phase, and what state transition did it produce?

### 5. COMMAND projection identity and evidentiary limit

- Observed Server COMMAND State: reconstructed only from captured Server Updates.
- Local Effective COMMAND State: Server Updates plus successfully delivered Local Injected Updates for one Subscription.
- Authoritative COMMAND State: server-side application state, not visible or owned by Workbench.
- Projection completeness may be limited by late Capture, missing snapshot evidence, or inconsistent lifecycle evidence.

Developer decision: which projection am I reading, which evidence contributed, and what claim is Workbench not making?

### 6. Diagnostics and severity

- Informational context: useful limitation or explanation that does not require correction.
- Warning/attention: incomplete evidence, lost updates, unknown-key lifecycle, recovery, or another condition that may affect interpretation.
- Error/blocking: invalid draft, unavailable execution boundary, missing required COMMAND identity, or a failed operation that prevents the current action.
- Severity belongs to a diagnostic or condition, never to a COMMAND verb, provenance, selection, or lifecycle phase by itself.

Developer decision: what is affected, how serious is it, and what should I inspect or do next?

### 7. Local Injection readiness and outcome

- Draft: unchanged/changed, valid/invalid.
- Target: current and ready, stale/retired, incompatible, or unavailable.
- Execution outcome: delivered locally, stale target, listener error, wire error, or bridge error.
- “Delivered locally” proves the Workbench delivery boundary only. It does not claim a downstream application or business effect.
- Final execution is Local only and does not contact Lightstreamer Server.

Developer decision: can this exact draft be delivered to this exact Subscription, what did Workbench prove, and what recovery is safe?

### 8. Evidence value status

- requested, real, inferred, unknown, unavailable, redacted, or not applicable.
- These labels describe how a value was obtained or why it is absent. They are neither provenance nor severity.

Developer decision: is this value observed, configured, inferred, intentionally hidden, or unavailable?

### 9. Interaction state

- hover, keyboard focus, selected, selected but unfocused, disabled, and busy.
- Focus and selection remain independent and must not reuse provenance, lifecycle, or severity styling.

Developer decision: where will the next operation occur, and which evidence currently drives Context?

## Required presentation contexts

- Persistent operating strip: Capture operation, coverage, storage/retention, Live/Frozen.
- Scope tree: lifecycle, historical state, material diagnostics, current Scope, and keyboard focus.
- Dense Evidence: provenance, event kind, COMMAND operation, phase, diagnostics, selection, and high-volume scanning.
- Context detail: full identity, values and value status, diagnostics, provenance explanation, and related actions.
- COMMAND projections: unmistakable projection identity and evidence limit before row comparison.
- Raw evidence: immutable Source identity and Server/Local provenance outside the document.
- Local Injection: Local-only boundary, target readiness, draft validity, comparison, and exact outcome.
- Empty/degraded states: affected scope, direct explanation, and one relevant recovery route.

## Non-negotiable constraints

- Every material distinction has persistent text at its decision boundary.
- Color is supplemental; icon shape, text, placement, or pattern preserves meaning in forced colors and grayscale.
- Selection fill and focus outline are reserved for interaction state.
- Server and Local remain textual at every density; Local gets a dedicated provenance treatment rather than a success treatment.
- ADD, UPDATE, and DELETE do not use traffic-light severity colors.
- Snapshot and Live remain explicit phase labels or boundaries.
- Warning/error treatment identifies the affected object and includes concise consequence/recovery text.
- Dense rows do not accumulate a necklace of badges. Low-frequency explanation belongs in Context.
- Theme changes preserve semantic hierarchy and geometry.
- Application-controlled identifiers and values never determine semantic color or iconography.

## Prototype scenario matrix

- healthy Live Capture with mixed Server and Local evidence;
- partial Capture coverage and in-memory fallback;
- connecting/recovering/stalled/disconnected runtime objects;
- snapshot-to-live boundary, clear snapshot, and lost updates;
- complete and limited Observed Server COMMAND State;
- Local Effective COMMAND State differing because of Local Injection;
- ready, invalid, stale-target, delivered-locally, and failed Local Injection;
- empty, filtered-empty, selected, selected-unfocused, and high-volume Evidence;
- compact, normal, shallow, and wide geometry;
- Dark, Light, and forced-colors-equivalent non-color inspection.
