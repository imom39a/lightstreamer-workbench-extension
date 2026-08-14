---
status: accepted
---

# Run Local Injection Scenarios as immutable single-target plans

The accepted Local Injection Draft Set defines explicit independent documents but deliberately assigns visual order no execution meaning. Deterministic multi-event Local Injection therefore becomes a separate Scenario domain: one mutable, Panel Session-local Scenario is reviewed into an immutable single-target Run plan, and the runner executes one ordinary Local Injection at a time. This favors traceable failure and reproducible operator intent over multi-target orchestration, overlapping timers, automatic continuation, or a generic batch protocol.

## Scenario definition and membership

- A Local Injection Scenario contains one to 100 explicitly added Scenario Steps plus optional Scenario Checkpoints. Visible, selected, ranged, or filtered Evidence never becomes membership implicitly. A range or filtered-set shortcut must preview exact stable Evidence identities and require confirmation before adding them.
- Every Scenario Step keeps its own stable identity, immutable Injection Source when present, raw-JSON Injection Draft, validation, comparison, undo state, relative delay, and assertions. Duplicating or removing a Step is explicit; removal is undoable while editing. Captured Evidence sequence supplies the initial order for a confirmed multi-add, while execution order changes only through deliberate reordering.
- One Scenario has one exact Local Injection Target: page epoch, client, Session, Subscription instance, and listener or wire delivery path. Steps may address different items within that Subscription when their mode and schema are compatible. Cross-Subscription, cross-Session, and mixed delivery-path orchestration are outside this decision.
- A standalone Injection Draft and a Scenario are mutually protected authoring responsibilities. Starting one reveals the other and requires explicit resume, conversion, finish, or confirmed discard; Workbench never silently broadens one Draft into a Scenario.
- The accounted Scenario document, including Sources, Drafts, immutable Run plans, and Scenario Traces, is limited to 8 MiB. Admission refuses a Step or new Run before exceeding either the 100-Step or accounted-byte boundary. It never truncates membership or silently evicts a trace.

## Review and immutable Run plan

Scenario Review validates every Step, the shared Target, capacity, assertions, and timing, then freezes the exact Scenario revision, Step order, payloads, relative delays, speed, assertion windows, target identity, target fingerprint, and committed-Evidence seed boundary into a Scenario Run. Editing returns to a new Scenario revision and cannot mutate an existing Run.

COMMAND validation begins from Local Effective COMMAND State at the Run's committed-Evidence seed boundary and simulates preceding planned COMMAND Steps in order. This permits an UPDATE to validate against an earlier planned ADD without presenting planned state as committed Evidence or Authoritative COMMAND State.

The Run is not an Injection. Dispatching a Scenario Step creates one distinct Injection identity and uses the existing one-request/one-result bridge. Synthetic Local Evidence adds Scenario, Run, Step, ordinal, and Injection correlation without introducing a batch bridge message or changing the Local Injection delivery boundary.

## Scenario Clock and controls

- Each Step stores a non-negative relative delay. The first delay begins when the Run starts; every later delay begins only after the preceding Injection Outcome and any resulting Evidence acceptance settle. An optional speed selected before Review scales those delays and is frozen into the Run.
- The runner uses a monotonic Scenario Clock, never wall-clock time or captured timestamps. It has at most one Injection in flight, never skips or overlaps Steps, and never emits a catch-up burst after suspension or timer drift.
- **Step next** dispatches exactly the next Step immediately, evaluates its assertions, and returns the Run to Paused. Timed Play, Pause, and Stop build on the same state machine.
- Pause prevents the next dispatch but cannot cancel an Injection already sent. Stop is terminal for scheduling: the current request settles truthfully, remaining Steps become `NOT RUN — RUN STOPPED`, and no callback is rolled back.
- Hiding the panel automatically pauses before another dispatch. Capture continues observationally. Returning to a visible panel requires an explicit Resume.
- Automatic looping, automatic retry, implicit repetition, and mid-Run speed changes are excluded. **Run again** performs a new Review and creates a new Scenario Run and new Injection identities.

## Drift, delivery, and Evidence outcomes

Determinism means explicit membership, immutable inputs, strict order, relative active-time delays, one in-flight Injection, and a complete Scenario Trace. It does not isolate the inspected application or suppress ordinary Server Updates.

- Every Step performs a just-in-time target and Review-fingerprint check. A page, Session, Subscription, item, or delivery-path retirement makes that Step `NOT RUN` and ends the Run; retargeting requires a new Scenario revision and Run.
- A changed listener set or committed Server Item Update for the target Subscription pauses before the next Step and identifies the changed listeners or interleaving Evidence. Continuing requires an explicit re-review of the remaining immutable Steps, which appends a new authorization boundary to the Trace; failed revalidation ends the Run.
- Full Local delivery waits for the resulting Local Injected Update to settle at the Event History boundary before assertions or the next delay begin. Only committed Evidence advances Local Effective COMMAND State.
- Full delivery whose Local Evidence cannot be retained remains `DELIVERED LOCALLY`, but the Run stops as evidence-incomplete and projection assertions do not run.
- Partial listener delivery remains `PARTIALLY DELIVERED` with attempted, delivered, and failed counts. Delivery failure and acknowledgement loss retain their precise existing Injection Outcomes. Any partial, failed, unknown, or blocked outcome stops the Run without rollback, retry, skipping, or successful Local Evidence.
- Event History must be accepting Evidence before a Run starts. Clear is unavailable while a Run is active. A later Clear may remove correlated Evidence; the Scenario Trace remains truthful and marks those references unavailable rather than recreating or retaining hidden Evidence.
- Closing the Panel Session stops scheduling and discards the Scenario and its Trace. There is no cross-session recovery.

## Assertions and Checkpoints

Scenario Assertions observe Workbench-owned facts only:

- the preceding Injection Outcome and listener delivery counts when the delivery path exposes them;
- existence of committed Local Evidence correlated to the Run and Step;
- Local Effective COMMAND key existence or absence;
- primitive field equality in Local Effective COMMAND State;
- normalized diagnostic presence after the diagnostic contract from Build 5 exists.

Assertions never execute inspected-page JavaScript or inspect arbitrary DOM, callback internals, application state, or Authoritative COMMAND State. Wire delivery cannot offer listener-count assertions. A positive assertion may carry an explicit `within` duration measured by the Scenario Clock; later Steps wait, Pause freezes the window, and the result records the exact committed Evidence boundary used. A failed or expired assertion stops the Run.

## Interaction model

The Scenario is a temporary promoted document inside the Scoped Evidence Workspace, not a permanent destination. One member retains the existing raw-JSON Draft experience; additional explicit members use the accepted continuous Draft Set with independent documents, protected Step boundaries, optional Source comparison, per-Step collapse, and one content scroll.

An **Add Step** transition opens a bounded Evidence picker or same-target authoring action. Incompatible Evidence stays visible with a reason and cannot be added. Scenario Edit, Review, Running, Paused, outcome, and trace states each expose at most one necessary primary action. There is no direct execution shortcut. Exact Back, focus, editor, Source comparison, Scenario, Run, and Evidence state restore across compact, normal, shallow, and wide geometry.

This workflow is Material UI. Each implementation slice must carry deterministic primary, invalid/stale, partial/unknown, interleaving, hidden/pause, stopped, assertion, empty, and high-volume evidence appropriate to the slice, followed by the complete browser, keyboard, accessibility, theme, visual-diff, independent visual-QA, and maintainer-approval gate before release.

## Considered options

- Treat a JSON array or Draft Set as a batch and add `Run all`. Rejected because document position would silently become execution order and would erase independent Source, Review, target, and outcome boundaries.
- Allow one target per Step. Rejected because it creates cross-Subscription orchestration, heterogeneous schemas, and ambiguous drift and failure behavior before the single-target workflow is proven.
- Reproduce captured absolute timestamps or schedule Steps concurrently. Rejected because wall time, timer suspension, bridge latency, and overlapping side effects would make order and failure non-deterministic.
- Continue automatically after partial, unknown, failed, or evidence-incomplete outcomes. Rejected because Workbench cannot roll back application callbacks or prove the state from which later Steps would execute.
- Assert arbitrary application or DOM state. Rejected because generic Workbench owns Lightstreamer and Workbench evidence boundaries, not application-specific truth.
- Persist Scenarios across Panel Sessions in extension storage. Rejected because the accepted product owns temporary session state and deliberate exports, not hidden cross-session recovery.

## Consequences

- The current validate → fingerprint → execute once → await Evidence settlement → map outcome path must become one renderer-neutral Local Injection execution coordinator shared by standalone Drafts and Scenario Steps.
- Scenario authoring and execution require a dedicated state machine and monotonic clock seam, while the inspected-page bridge remains single-request and unchanged in shape.
- Successful Local Evidence and Scenario Traces need stable Scenario/Run/Step/Injection correlation; unsuccessful attempts remain truthful Trace outcomes rather than fabricated Item Update Evidence.
- Build 4 selected-update semantics and Build 5 normalized diagnostics remain roadmap prerequisites. Diagnostic assertions cannot ship before Build 5.
