# Large-event Local Injection editor comparison

Status: **superseded during live human review**

The product owner rejected the shared assumption behind all three variants: making each attribute a form, cell, or structured node feels restrictive and becomes hard to operate. Raw JSON should be the primary editor. Optional diff and diagnostics may help, but the permanent surface must remain minimal and leave a clean path to future multi-event work. The revised study is in [`../raw-json-editor/`](../raw-json-editor/).

## Why the prior form failed

The production editor is rendered inside the ordinary event detail pane. At wide docking that pane defaults to roughly 520px, and at normal docking it becomes a lower split. The existing Source/Draft table divides the narrow pane into 22% Field, 28% Original, and 50% Draft columns. Expanded JSON editors and long field lists therefore compete with event detail, source context, validation, and execution controls.

The revised invariant is:

> The contextual inspector may create, park, resume, and summarize a Local Injection Draft, but editing a payload opens a temporary full-size workspace.

All three variants keep the exact Local Injection Target and immutable Injection Source outside editable payload data. Back restores the originating evidence row, scope, filter, scroll position, inspector lens, and Live/Frozen position.

## A — Injection Matrix

A virtualized, dense Source/Draft grid with frozen field names, filters, changed-field membership, bulk operations, and an expanded cell editor for long or structured values.

Strongest for:

- scanning and comparing many flat Lightstreamer fields at once;
- keyboard-heavy editing and bulk correction;
- filtering 500 fields to differences, declared changed fields, or problems;
- keeping value differences separate from `changedFields` semantics.

Costs:

- spreadsheet behavior and accessible virtualization require care;
- horizontal space is valuable at wide/normal widths;
- nested JSON is edited in a separate expanded-cell surface rather than directly in the grid.

## B — Draft Document

A searchable document outline, editable structured document, and synchronized immutable Source comparison. Structured JSON values can be expanded into paths while remaining one top-level Lightstreamer field.

Strongest for:

- deeply nested JSON values and path-based navigation;
- tree and raw-JSON editing in the same workspace;
- making nested draft differences understandable;
- restoring a value, subtree, or complete top-level field.

Costs:

- more implementation complexity around parsing, serialization, duplicate keys, and raw/structured synchronization;
- less efficient than a grid for comparing hundreds of unrelated scalar fields;
- structured presentation can obscure that Lightstreamer changed semantics apply only to the top-level field unless repeatedly reinforced.

## C — Focus Queue

A searchable Field Map, one large Source/Draft Focus Station, and a Patch Queue containing blocking issues and net mutations.

Strongest for:

- sparse corrections within very large payloads;
- large multiline values that need the full editor width;
- issue-driven cleanup and auditing only intentional mutations;
- compact docking, where one field naturally owns the viewport.

Costs:

- developers cannot compare many values simultaneously;
- moving field-by-field is slower for broad edits;
- the patch queue adds conceptual weight to small payloads.

## Withdrawn provisional recommendation

The recommendation to use **A — Injection Matrix** is withdrawn. Although it scales spatially, its cell-by-cell interaction imposes the same restriction the product owner wants to avoid.

Borrow two mechanisms:

- B's structured expanded-cell editor and raw JSON escape hatch for an individual field value.
- C's issue navigation and net-patch summary as drawers over the Matrix rather than a separate editing model.

The contextual inspector retains quick `Use unchanged` for compatible captured updates. Any mutation or newly authored COMMAND update opens the full editor.

This recommendation is not accepted until the product owner completes the revised live review.

## Verification

- Browser-rendered at 1440×900, 900×700, and 563×700.
- Payloads exercised at 84, 240, and 500 fields.
- No page-level horizontal overflow or runtime errors across the nine combinations.
- Search, filters, problems, raw document mode, keyboard issue navigation, read-only execution review, and successful Local Injection outcome exercised.
- Automated check: 45 assertions, 0 runtime errors.
