# Raw JSON editor comparison

The user rejected field-by-field forms and grids as the primary editing model. All three revisions therefore make raw JSON the editor, keep source/target/execution semantics outside it, and make source diff optional.

## A — Payload Document

One event is one JSON document occupying nearly the whole panel. When several future drafts exist, a tiny previous/next document position appears; there is still no permanent navigation rail.

This is the most minimal current product. It gives large payloads maximum room and adds the least maintenance surface. It is weaker when a developer needs to understand the status of many drafts at once.

## B — Conditional Event Rail

The single-event screen is the same dominant raw editor with no empty rail. A narrow navigator appears only when a future flow supplies multiple drafts. Each event retains independent text, validation, source, target, and editor state. The rail has no selection checkboxes, Run All, or aggregate execution controls.

This is the strongest growth path. It does not tax today's workflow, but it gives future multi-event work an explicit, comprehensible place without turning payload JSON into a batch protocol.

## C — Batch Document

With multiple future events, one raw JSON array contains every payload, while a read-only manifest maps array positions to locked targets. This is compact for global search/replace, but navigation, validation ownership, source comparison, and execution review become ambiguous. The prototype intentionally disables review because batch execution semantics have not been decided.

This is useful as the contrast: minimal chrome does not necessarily mean a simpler workflow. A single large batch document couples editing structure to future execution concepts too early.

## Provisional synthesis

The first pass favored A with B's conditional navigator seam. The research pass challenges that recommendation in two places:

- D makes diff the primary editor for captured-event mutation instead of a temporary comparison.
- F replaces B's permanent multi-draft rail with a transient searchable Draft Switcher.

Variant G now supplies the synthesis: A-like raw JSON editing for one event, C's continuous workspace experience for multiple events, and D-style comparison on demand. Internally, events remain independent documents rather than array positions. F remains the low-chrome fallback if a continuous trace becomes too tall; E remains a specialist sparse-mutation mode; C's literal batch array remains rejected. See [`research-variants/COMPARISON.md`](./research-variants/COMPARISON.md) for the detailed comparison.
