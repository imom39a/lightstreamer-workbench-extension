# Canonical Developer Journeys

Status: accepted product direction, 2026-08-03

This document defines the developer journeys that the Lightstreamer Workbench UI must optimize. It is an input to information-architecture and interaction prototypes, not a screen specification. The journeys preserve the domain language in [CONTEXT.md](../CONTEXT.md), the constraints identified by the [current-panel audit](CURRENT_PANEL_UI_AUDIT.md), and the behavioral guidance in the [Chrome DevTools conventions research](research/chrome-devtools-interaction-conventions.md).

## Product outcome

Workbench is a debugging instrument inside Chrome DevTools. Its core operating sequence is:

> compact live-session orientation → focused investigation → deliberate scoped action

A successful investigation does not require Workbench to fix the inspected application. It requires the developer to identify the boundary at which observed behavior diverged and cite the evidence supporting that conclusion.

The UI must optimize diagnosis and Local Injection as its two core journeys. Recovery guidance appears when operation is degraded. Raw protocol inspection, complete lifecycle analysis, high-volume history work, and export remain close at hand without competing for permanent primary prominence.

Planned Server Injection is outside this journey set. Local Injection is in scope and remains a first-class capability.

## Representative operators

### Primary: application integration developer

The primary operator routinely uses Chrome DevTools and understands Lightstreamer clients, Sessions, Subscriptions, items, fields, subscription modes, and basic COMMAND behavior. They may not know TLCP or Workbench's instrumentation internals. The UI must let this developer reach a supported conclusion without requiring raw-protocol expertise.

### Secondary: Lightstreamer or platform specialist

This operator investigates instrumentation coverage, raw protocol evidence, configuration, lifecycle ordering, performance, or complex COMMAND behavior. They need raw evidence and complete diagnostic context one interaction away from the primary journey.

### Secondary: QA or SDET

This operator reproduces captured sequences and deliberate variations, especially through Local Injection. They need stable targets, explicit provenance, repeatable drafts, unambiguous outcomes, and evidence that can be shared without credentials.

## Priority and placement

| Priority | Journey | UI posture |
| --- | --- | --- |
| Primary | Diagnose incorrect application state | Default operating path; orientation is its first phase. |
| Primary | Reproduce or vary behavior with Local Injection | Deliberate action reached from relevant evidence or an explicit authoring entry point. |
| Contextual recovery | Understand degraded operation | Prominent when relevant; otherwise consumes little or no workspace. |
| Advanced | Raw capture, complete COMMAND lifecycle, frozen high-volume history, and diagnostic export | One interaction away while preserving investigative scope. |

“One interaction away” means the operation is directly reachable from the current scope or selection. It does not require every advanced surface to remain simultaneously visible.

## Journey 1: diagnose incorrect application state

### Trigger

The inspected application shows missing, stale, duplicated, or otherwise incorrect state, or behaves differently from the developer's expectation.

### Developer question

Where did behavior diverge: capture and coverage, client or Session lifecycle, Subscription setup, server-delivered data, Logical Update handling, Update Delivery, COMMAND reconstruction, or application behavior after delivery?

### Required evidence

- Current Capture health and any known coverage limitation.
- Detected clients, current or recent Sessions, and active or relevant Subscriptions.
- Subscription identity and configuration, including mode, items, fields, snapshot state, and lifecycle.
- Complete ordered evidence for the selected Subscription, item, or COMMAND key.
- The distinction between a Logical Update and its Update Deliveries, including listener identity where available.
- Captured values and changed fields, with raw evidence available for verification.
- For COMMAND, Observed Server COMMAND State and Local Effective COMMAND State presented as distinct projections.
- Current Live or Frozen investigation state, active filters, visible versus total evidence, and newer matching evidence.

### Canonical sequence

1. Open Workbench and orient on Capture health, client and Session activity, active Subscriptions, and material anomalies.
2. Select the suspicious Subscription, item, COMMAND key, or event without losing the surrounding runtime scope.
3. Follow its ordered update, delivery, snapshot, and lifecycle evidence.
4. For COMMAND behavior, compare Observed Server COMMAND State with Local Effective COMMAND State and trace the operations that produced the selected row.
5. Inspect raw evidence only when the semantic evidence is insufficient or must be verified.
6. Identify the exact boundary where the behavior diverged and retain enough scoped evidence to support the conclusion.

### Completion condition

The developer can name one of the following boundaries and cite the relevant evidence:

- Capture is unavailable, degraded, or unable to establish the required observation.
- The client or Session was not in the expected lifecycle state.
- The Subscription was absent, configured differently, or in an unexpected lifecycle or snapshot state.
- The expected Server Update did not appear in captured evidence, or the captured fields differed from expectation.
- A Logical Update was captured but the relevant listener did not receive the expected Update Delivery.
- Ordered COMMAND operations produced the observed projection, including an identifiable warning or inconsistent lifecycle where present.
- The expected evidence reached the application's listener boundary, so the remaining divergence is downstream of Workbench's observable Lightstreamer behavior.

Workbench may show uncertainty when coverage cannot support a stronger claim. Absence of captured evidence must not be presented as proof that an event did not occur when Capture was unavailable or limited.

### Important degraded states

- No Lightstreamer client or relevant activity has been detected.
- Capture connected after the relevant lifecycle began or otherwise has limited coverage.
- The DevTools bridge or inspected page is disconnected, navigating, or reloading.
- Current-DevTools-session history is using its in-memory fallback or has a material retention limitation.
- High event volume obscures the relevant interval; the developer must be able to Freeze, filter, and preserve selection without stopping Capture.
- The selected runtime object retired while evidence was being inspected; historical evidence remains read-only and clearly distinguished from a live target.

## Journey 2: reproduce or vary behavior with Local Injection

### Trigger

Diagnosis identifies an Item Update worth reproducing or varying, or the developer needs to exercise a plausible COMMAND transition without waiting for a backend event sequence.

### Developer question

How does the inspected application respond when this Item Update is deliberately delivered to this exact Subscription in the local browser runtime?

### Supported entry paths

1. Use a compatible Captured Item Update unchanged.
2. Copy a Captured Item Update into an Injection Draft and apply a Mutation.
3. Author a new Injection Draft for a COMMAND Item Update when no suitable capture exists.

These are entry paths into one journey, not three unrelated tools.

### Required evidence and state

- The immutable Injection Source, when a captured update is used.
- The Injection Draft as a separate editable object, including every deliberate difference from its source.
- The exact Local Injection Target: one selected Subscription, with its runtime identity, mode, items, fields, and current availability.
- COMMAND key, command, field values, changed-field semantics, and snapshot flag where applicable.
- Validation results before execution, attached to fields or target conditions that the developer can correct.
- A persistent Injection Outcome that describes handling at the local delivery boundary.
- An explicitly marked Injected Update and its Update Deliveries in ordered evidence after successful delivery.
- For COMMAND, the resulting Local Effective COMMAND State kept distinct from Observed Server COMMAND State.

### Canonical sequence

1. Enter from relevant captured evidence or start explicit COMMAND Item Update authoring.
2. Confirm the Local Injection Target before editing or execution.
3. Review the immutable Injection Source and the separate Injection Draft. If no source exists, make the newly authored status explicit.
4. Make deliberate mutations or author the required command, key, field values, and snapshot semantics.
5. Validate the draft and target. Keep execution unavailable while a correctable validation error remains.
6. Invoke a clearly labelled Inject action at an explicit execution boundary.
7. Report the Injection Outcome without claiming a downstream business effect.
8. Trace a successful Injected Update in the ordered Timeline and, for COMMAND, verify its effect only in Local Effective COMMAND State.

### Completion condition

The developer has verified the exact target, understood the source-to-draft relationship, passed validation, received a clear outcome, and can trace the explicitly local result through the same evidence model used for captured activity. Nothing in the UI implies that the Item Update entered Lightstreamer Server's update flow or changed Authoritative COMMAND State.

### Important failure and degraded states

- No compatible Local Injection Target is available.
- The selected Subscription retired or changed before execution, making the target stale.
- The source and target are incompatible, or the target does not contain the authored item or required fields.
- The Injection Draft is invalid, including invalid COMMAND key, command, field, or snapshot semantics.
- Delivery fails or Workbench cannot complete the local delivery boundary.
- Delivery succeeds but no downstream application effect is visible; the outcome still describes delivery rather than business success.
- Capture continues or the layout changes while a draft is open; target, source, draft, focus, and edits remain stable unless the target becomes invalid.
- A repeated execution is a new Injection with its own outcome and evidence, not an invisible retry of the earlier operation.

Recovery must preserve the draft when safe, identify what changed, and offer an explicit way to select a valid target or correct validation errors. Workbench must never silently retarget an Injection.

## Journey 3: understand degraded operation

### Trigger

Workbench has no detected client, reports limited Capture, loses its bridge, observes page reload or navigation, falls back in storage, or finds that a previously selected live target is no longer valid.

### Developer question

What evidence is still trustworthy, what conclusion can I safely draw, and what should I do next?

### Required evidence

- A plain-language operating state and the time or lifecycle boundary at which it changed.
- The affected Capture scope, retained evidence range, and known coverage limitation.
- Separation between Capture state and the Timeline's Live or Frozen viewing state.
- Whether the selected object is live, retired historical evidence, or an invalid Local Injection Target.
- The recovery action appropriate to the cause, plus access to deeper diagnostics when needed.

### Canonical sequence

1. Notice a contextual status that identifies the affected scope and severity without relying on color.
2. Inspect a concise explanation of what Workbench knows, what it cannot establish, and which existing evidence remains usable.
3. Take the appropriate recovery action: wait for a client, reload or reconnect the inspected context, re-establish Capture, return to Live evidence, select a current target, correct a draft, or open detailed diagnostics.
4. Reorient on the current client, Session, and Subscription context before continuing diagnosis or Local Injection.

### Completion condition

The developer understands the confidence boundary of the available evidence and either restores operation or continues with an explicitly limited conclusion. Recovery does not clear retained history, discard a safe draft, follow Live, or repeat an Injection implicitly.

## Advanced journeys

### Inspect raw capture and coverage

- **Trigger:** semantic evidence is insufficient, unexpected, or suspected to be incomplete.
- **Question:** does lower-level evidence confirm the event, ordering, identity, or instrumentation gap?
- **Evidence and actions:** retain the selected client, Session, Subscription, item, key, or event scope while revealing raw TLCP or capture diagnostics and coverage boundaries; search or filter without changing the underlying Capture.
- **Completion:** the specialist can correlate raw and semantic evidence or name the precise coverage limitation.
- **Degraded path:** raw evidence is unavailable or incomplete; Workbench states the limitation rather than manufacturing certainty.

### Analyze a complete COMMAND lifecycle

- **Trigger:** a key is unexpectedly absent, duplicated, updated, deleted, re-added, or inconsistent.
- **Question:** which ordered COMMAND operations and snapshot boundaries produced this row state?
- **Evidence and actions:** select the Subscription, item, and key; inspect generations and ordered ADD, UPDATE, and DELETE operations; compare projections; reveal related raw evidence as needed.
- **Completion:** the developer can explain the selected key's state from its ordered lifecycle and distinguish a captured server behavior from a local effect.
- **Degraded path:** Capture began mid-lifecycle or snapshot evidence is incomplete; the projection warning and its evidentiary limit remain visible.

### Freeze and navigate high-volume history

- **Trigger:** sustained Capture advances too quickly or the relevant interval is no longer in the live tail.
- **Question:** what happened in this historical interval while Capture continued?
- **Evidence and actions:** Freeze the view, query ordered session history, filter or find, pin selected detail, and monitor the count of newer matching evidence without changing Capture.
- **Completion:** the historical window, selection, filter, and detail remain stable, and the developer can deliberately return to Live when finished.
- **Degraded path:** IndexedDB is unavailable or history is bounded by fallback behavior; visible counts and retained-range limitations remain accurate.

### Export a diagnostic snapshot

- **Trigger:** the developer needs to share, archive, or escalate the scoped structural and diagnostic evidence.
- **Question:** can I produce an understandable artifact without exposing credentials or implying persistent application state?
- **Evidence and actions:** review export scope, version, redaction choices, and unconditional credential exclusions; download JSON or offline HTML deliberately.
- **Completion:** the artifact opens, represents the chosen scope and version, and remains credential-safe under the export contract.
- **Degraded path:** export generation or download fails; Workbench reports the failure without clearing the investigation context.

## UI implications to test, not assumed layouts

Information-architecture prototypes must demonstrate that:

- Opening the panel answers “is Workbench observing the runtime I care about?” before asking the developer to choose among feature areas.
- Selection of a client, Session, Subscription, item, key, or event carries into related evidence, detail, and action instead of forcing repeated context selection.
- Evidence remains primary; actions appear in the scope where they are valid.
- Local Injection is a deliberate transition from evidence or explicit authoring into a stable source/draft/target workflow.
- Recovery guidance replaces implementation labels such as “bridge connected” with operator-relevant status and next actions.
- Raw evidence and advanced tools are directly reachable without permanent multi-pane competition.
- Compact DevTools layouts preserve the same journey order even when only one primary pane can be visible at a time.

This document does not decide the top-level navigation, number of panes, breakpoint values, component library, visual styling, or production migration sequence.

## Vocabulary resolution

No new Lightstreamer domain term was needed during this session, so [CONTEXT.md](../CONTEXT.md) does not change. The accepted journeys reinforce its existing language:

- Use **Injection**, not Replay or Re-inject.
- Keep **Injection Source** immutable and **Injection Draft** separately editable.
- Use **Mutation** for deliberate draft changes.
- Name the exact **Local Injection Target**.
- Mark an **Injected Update** and retain its local provenance.
- Keep **Observed Server COMMAND State** distinct from **Local Effective COMMAND State** and from **Authoritative COMMAND State**.

Roles, journey names, fault boundaries, and UI placement categories are product-design language rather than additions to the Lightstreamer domain glossary.

## Acceptance record

The product owner explicitly confirmed, one decision at a time:

1. The primary and secondary operator hierarchy.
2. Incorrect application state as the primary incident.
3. Evidence-backed fault-boundary identification as the completion condition.
4. The canonical orientation and investigation sequence.
5. Local Injection as the second core journey.
6. Captured reuse, mutation, and newly authored COMMAND updates as its three entry paths.
7. Explicit target, validation, outcome, Timeline trace, and projection checks as its completion condition.
8. Degraded operation as a dedicated contextual journey.
9. Raw capture, complete COMMAND lifecycle, high-volume history, and export as the advanced journey set.
10. The resulting journey hierarchy as the shared direction for information-architecture work.
