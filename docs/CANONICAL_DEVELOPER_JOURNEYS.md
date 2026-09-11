# Canonical Developer Journeys

Status: accepted product direction, 2026-08-03

This document defines the developer journeys that the Lightstreamer Workbench UI must optimize. It governs production and future UI work without prescribing a screen. The journeys preserve the domain language in [CONTEXT.md](../CONTEXT.md), the constraints identified by the historical [current-panel audit](CURRENT_PANEL_UI_AUDIT.md), and the behavioral guidance in the [Chrome DevTools conventions research](research/chrome-devtools-interaction-conventions.md).

## Product outcome

Workbench is a debugging instrument inside Chrome DevTools. Its core operating sequence is:

> compact live-session orientation → focused investigation → deliberate scoped action

A successful investigation does not require Workbench to fix the inspected application. It requires the developer to identify the boundary at which observed behavior diverged and cite the evidence supporting that conclusion.

The UI must optimize diagnosis, Local Injection, and deliberate Server Injection as its core journeys. Recovery guidance appears when operation is degraded. Raw protocol inspection, complete lifecycle analysis, high-volume history work, and export remain close at hand without competing for permanent primary prominence.

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
| Primary | Reproduce a Client Message with Server Injection | Protected reviewed action reached from outbound Evidence or one live public-API client. |
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
- Accepted ordered Evidence for the selected Subscription, item, or COMMAND key through the current History Interval's Committed Evidence Boundary.
- The distinction between a Logical Update and its Update Deliveries, including listener identity where available.
- Captured values and changed fields, with raw evidence available for verification.
- For COMMAND, ordered `ADD`, `UPDATE`, and `DELETE` Evidence, Fields, snapshot/live phase, and relevant lifecycle diagnostics.
- Current Live or Frozen investigation state, active filters, visible versus total evidence, and newer matching evidence.

### Canonical sequence

1. Open Workbench and orient on Capture health, client and Session activity, active Subscriptions, and material anomalies.
2. Select the suspicious Subscription, item, COMMAND key, or event without losing the surrounding runtime scope.
3. Follow its ordered update, delivery, snapshot, and lifecycle evidence.
4. For COMMAND behavior, trace the ordered operations, Fields, and diagnostics that produced the observed lifecycle.
5. Inspect raw evidence only when the semantic evidence is insufficient or must be verified.
6. Identify the exact boundary where the behavior diverged and retain enough scoped evidence to support the conclusion.

### Completion condition

The developer can name one of the following boundaries and cite the relevant evidence:

- Capture is unavailable, degraded, or unable to establish the required observation.
- The client or Session was not in the expected lifecycle state.
- The Subscription was absent, configured differently, or in an unexpected lifecycle or snapshot state.
- The expected Server Update did not appear in captured evidence, or the captured fields differed from expectation.
- A Logical Update was captured but the relevant listener did not receive the expected Update Delivery.
- Ordered COMMAND operations explain the observed lifecycle, including an identifiable warning or inconsistent lifecycle where present.
- The expected evidence reached the application's listener boundary, so the remaining divergence is downstream of Workbench's observable Lightstreamer behavior.

Workbench may show uncertainty when coverage cannot support a stronger claim. Absence of captured evidence must not be presented as proof that an event did not occur when Capture was unavailable or limited.

### Important degraded states

- No Lightstreamer client or relevant activity has been detected.
- Capture connected after the relevant lifecycle began or otherwise has limited coverage.
- The DevTools bridge or inspected page is disconnected, navigating, or reloading.
- The current Panel Session uses memory-backed History or has advanced its Retained Range; this limits retained replay without changing Observation Coverage.
- Event History has an exact Evidence Gap; later Capture continues, while conclusions that require an unbroken COMMAND or Topology sequence remain explicitly limited.
- High event volume obscures the relevant interval; the developer must be able to Freeze, filter, and preserve selection without stopping Capture.
- The selected runtime object retired while evidence was being inspected; historical evidence remains read-only and clearly distinguished from a live target.

One Panel Session owns one temporary rolling Event History. Normal retention is
100,000 Evidence records or 256 MiB; memory-backed retention is 5,000 records or
32 MiB. The oldest accepted prefix rolls away at the budget, and a failed durable
commit can fall back to memory without stopping Capture. Notifications keeps the
bounded incident and recovery history. Controlled Close attempts erasure and a
new Panel Session never replays abandoned data.

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
- For COMMAND, committed Local Evidence kept visibly distinct from captured Server Evidence.

### Canonical sequence

1. Enter from relevant captured evidence or start explicit COMMAND Item Update authoring.
2. Confirm the Local Injection Target before editing or execution.
3. For a captured update, open with the immutable Injection Source and separate Injection Draft compared as the default preview. If no source exists, make the newly authored status explicit.
4. Make deliberate mutations or author the required command, key, field values, and snapshot semantics.
5. Validate the draft and target. Keep execution unavailable while a correctable validation error remains.
6. Invoke the clearly labelled **Inject locally** action directly from that authoring and preview surface. Workbench atomically freezes and revalidates the Draft and target before attempting delivery.
7. Report the Injection Outcome without claiming a downstream business effect.
8. Trace a successful Injected Update as explicit `LOCAL` Evidence in the ordered Timeline.

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

## Journey 3: reproduce a Client Message with Server Injection

### Trigger

Diagnosis identifies a page-owned Client Message worth reproducing or varying, or the developer needs to send a new application-specific message through one current Lightstreamer Session.

### Developer question

What does the server boundary report when this exact Client Message is submitted once through this exact inspected client and Session?

### Required evidence and state

- An immutable Captured Client Message Source when the developer starts from Evidence.
- A separate editable Server Injection Draft containing message, sequence, delay timeout, and enqueue choice.
- Optional application-owned Message Recipes that may prepare exact Draft arguments from selected Evidence without implying a generic Item Update-to-Client Message translation.
- One protected page epoch, official public-API client, and current Session target.
- A Review phase showing the exact `LightstreamerClient.sendMessage` arguments.
- A persistent processed, denied, discarded, aborted, unknown, stale-target, or bridge outcome.
- Outbound `WORKBENCH` Evidence correlated to the request and any available listener outcome.

### Canonical sequence

1. Enter from a compatible Captured Client Message or explicitly author against one live client.
2. Confirm the exact page, client, Session, and public `sendMessage` boundary.
3. Optionally apply one application-owned Message Recipe, then edit the body and send arguments without mutating the Source or application's original call.
4. Resolve validation errors and review the exact call.
5. Invoke **Send Client Message once**.
6. Read the terminal outcome without inferring a downstream business effect or causal relationship to later Server Updates.
7. If the outcome is Unknown, stop. A deliberate Repeat is a new call with duplicate-effect risk, never an automatic retry.

### Completion condition

The developer can cite the reviewed call, exact target, outbound Evidence, and the strongest supported delivery-boundary outcome. Nothing implies that Workbench injected an inbound Item Update, contacted a Data Adapter directly, or proved an application result.

### Important failure and degraded states

- The selected client is fallback-only, retired, disconnected, reloaded, or in a different Session.
- The message or sequence is empty, or the timeout is invalid.
- No application Message Recipe matches the selected Evidence; the developer must clone captured outbound Evidence or use the application's message contract.
- The page bridge is missing before execution starts.
- Page evaluation or a listener outcome becomes uncertain after the call may have started; the outcome is Unknown and Workbench does not retry.
- The developer deliberately prepares a Repeat; the UI warns that server-side effects may be duplicated and creates a fresh execution identity.

## Journey 4: understand degraded operation

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

1. Notice one stable footer diagnostic that identifies the affected scope and severity without relying on color.
2. Inspect a concise explanation of what Workbench knows, what it cannot establish, and which existing evidence remains usable.
3. Take the appropriate recovery action: wait for a client, reload or reconnect the inspected context, re-establish Capture, return to Live evidence, select a current target, correct a draft, or open detailed diagnostics.
4. Reorient on the current client, Session, and Subscription context before continuing diagnosis or Injection.

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
- **Evidence and actions:** select the Subscription, item, and key; inspect generations and ordered `ADD`, `UPDATE`, and `DELETE` operations, Fields, and related raw Evidence as needed.
- **Completion:** the developer can explain the captured lifecycle and distinguish Server Evidence from a local effect without relying on a reconstructed-state UI.
- **Degraded path:** Capture began mid-lifecycle or snapshot Evidence is incomplete; Coverage and lifecycle diagnostics state the evidentiary limit.

### Freeze and navigate high-volume history

- **Trigger:** sustained Capture advances too quickly or the relevant interval is no longer in the live tail.
- **Question:** what happened in this historical interval while Capture continued?
- **Evidence and actions:** Freeze the view, query ordered session history, filter or find, pin selected detail, and monitor the count of newer matching evidence without changing Capture.
- **Completion:** the historical window, selection, filter, and detail remain stable, and the developer can deliberately return to Live when finished.
- **Degraded path:** IndexedDB is unavailable, the Retained Range has advanced, or an Evidence Gap exists; recent Evidence stays navigable and the exact retention or continuity limitation remains visible in Notifications.

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
- Server Injection is a separate deliberate transition with exact send arguments, a protected live Session target, one attempt, and terminal Unknown handling.
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
- Name the exact client and Session for **Server Injection** and preserve **Repeat Injection** as a separate execution.
- Mark an **Injected Update** and retain its local provenance.
- Keep captured Server Evidence distinct from committed Local Evidence and never imply Authoritative COMMAND State.

Roles, journey names, fault boundaries, and UI placement categories are product-design language rather than additions to the Lightstreamer domain glossary.

Implementation amendment, 2026-08-30: the repository candidate implements Journey 3 as a temporary promoted document and keeps it mutually exclusive with the protected Local Draft and Scenario boundaries. Independent Material UI review and release publication remain separate gates.

## Acceptance record

The product owner explicitly confirmed, one decision at a time:

1. The primary and secondary operator hierarchy.
2. Incorrect application state as the primary incident.
3. Evidence-backed fault-boundary identification as the completion condition.
4. The canonical orientation and investigation sequence.
5. Local Injection as the second core journey.
6. Captured reuse, mutation, and newly authored COMMAND updates as its three entry paths.
7. Explicit target, validation, outcome, and Timeline trace as its completion condition.
8. Degraded operation as a dedicated contextual journey.
9. Raw capture, complete COMMAND lifecycle, high-volume history, and export as the advanced journey set.
10. The resulting journey hierarchy as the shared direction for information-architecture work.
