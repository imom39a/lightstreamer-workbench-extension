# Local Injection interaction model comparison

Status: **final synthesis selected during live human review**

The product owner rejected the core assumption that the edit form could remain inside the contextual inspector: large events do not have enough room and become difficult to edit. The revised decision study promotes editing into a temporary full-size workspace and lives in [`large-event-editor/`](./large-event-editor/).

The subsequent large-event review also rejected its field forms, matrix, and structured document as primary models. Raw JSON should be the default editing surface, with optional diff and validation as quiet aids. That current study lives in [`raw-json-editor/`](./raw-json-editor/).

All three models sit inside the accepted Scoped Evidence Workspace. None creates a permanent Local Injection destination, exposes Server Injection, edits captured evidence, or offers one-click replay.

## Final A — Scoped Draft Set

The selected prototype keeps Variant A's evidence entry, anchored target, park/resume, focused review, outcome, and trace lifecycle. Its editing phase is replaced by the raw-JSON Draft Set validated in the later research study:

- current mode contains exactly one event: either the explicitly selected captured event or one newly authored COMMAND update;
- a parked current draft must be resumed/finished or explicitly discarded before another captured or authored draft can be created;
- visible timeline events never automatically become drafts;
- future multi-edit begins with one member and adds captured or authored events explicitly through `Add event…`;
- timeline multi-selection is only a potential bulk shortcut into the same explicit membership operation;
- one continuous scrolling workspace, backed by independent event documents;
- protected event boundaries for identity, Source, target, differences, and status;
- per-event collapse without losing the boundary or problem state;
- optional Source/Draft comparison matched by event identity;
- one shared scroll surface for both diff columns, preventing scroll drift;
- inline comparison at normal and compact docking widths;
- review and Local Injection for the focused draft only;
- no ordering, batch review, or collection execution semantics.

This preserves the useful experience of the rejected batch document without making timeline visibility, a JSON array, or visual position part of the product contract.

## Shared contract

- A Captured Item Update can seed an unchanged or mutated Injection Draft; the source remains immutable.
- A live COMMAND item scope can create a newly authored draft with no Injection Source.
- The target is an exact Subscription instance and Session, never whichever row is selected later.
- The execution boundary says that one Logical Update is delivered to every current listener and that Lightstreamer Server is not contacted.
- Target, item, mode, schema, command, key, changed-field semantics, snapshot flag, listeners, and page delivery availability are validated.
- Every execution receives a distinct Injection identity. Repetition always creates another deliberate draft/execution.
- Only a fully delivered result appends the prototype's successful Injected Update and advances Local Effective COMMAND State. Observed Server COMMAND State remains unchanged.
- Partial listener failure and acknowledgement loss state only what is known and do not manufacture successful evidence.
- Compact Back/park/resume restores the draft without silently retargeting or discarding it.

## Historical A — Anchored Composer

The draft temporarily replaces the contextual evidence inspector while the ordered evidence ledger remains primary.

Best at:

- fast source → edit → inject → trace loops;
- keeping the developer's evidence context visible;
- matching the accepted wide inspector, normal lower detail, and compact master/detail geometry;
- making Local Injection feel like an evidence action rather than a separate tool.

Cost:

- large schemas create a long inspector;
- selection focus and the immutable draft anchor must remain visibly distinct;
- execution history must stay compact.

## B — Injection Bench

Entering Local Injection promotes the draft into a temporary, dedicated primary workspace with source/runs, editor, and target/execution regions.

Best at:

- complex schemas and repeated QA/SDET variation;
- exposing target, source, editor, outcomes, and execution history together;
- reducing the chance that evidence selection is mistaken for draft context.

Cost:

- leaves the evidence ledger during the core edit loop;
- feels heavier for unchanged reuse and small mutations;
- uses substantially more workspace chrome and empty area at wide widths.

## C — Sealed Preflight

The draft must cross a distinct read-only Review state before a one-shot execution. The reviewed payload contains zero editable controls.

Best at:

- proving that the executed payload is exactly what the developer reviewed;
- surfacing target, schema, listener-set, and bridge checks at the decision point;
- preventing accidental double activation or executing after material runtime change.

Cost:

- adds friction to every exploratory variation;
- repeats information from the editor;
- listener-set-sensitive review can become stale in dynamic applications.

## Superseded provisional recommendation

The earlier recommendation to choose **A — Anchored Composer** is withdrawn for the editing phase. Its evidence-first premise remains useful for inspection and entry, but it does not provide enough room for 50–500 fields or large structured values.

The compact inspector is now constrained to entry, parked-draft status, and outcomes. Editing is evaluated separately in the large-event study.

## Reviewed screenshots

- `final-A-single-selected-event.jpg`
- `final-A-single-authored-command.jpg`
- `final-A-future-add-event.jpg`
- `final-A-draft-set-edit.jpg`, `final-A-draft-set-compare.jpg`, `final-A-draft-set-collapsed.jpg`

- `A-wide-ready.png`, `A-normal-ready.png`, `A-compact-author.png`
- `B-wide-ready.png`, `B-normal-partial-failure.png`, `B-compact-stale.png`
- `C-wide-edit.png`, `C-normal-sealed-preflight.png`, `C-compact-unconfirmed.png`
