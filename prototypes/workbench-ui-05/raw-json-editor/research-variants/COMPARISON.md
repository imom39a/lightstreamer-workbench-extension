# Researched raw JSON variant comparison

## D — Revision Editor

The diff is the editor. Wide docking permanently pairs immutable Source and editable Draft; normal and compact docking use an inline revision. Unchanged spans collapse, differences are navigable, and individual changes can be reverted.

This is the strongest challenger to the Payload Document when the primary task is mutating a captured event. It makes provenance and exact changes continuously inspectable. Its cost is persistent visual weight, especially for broad rewrites and newly authored updates without a real source event.

## E — Patch Forge

The editable document is an RFC 6902 JSON Patch. Immutable Source and computed full Result remain read-only. A four-operation recipe can represent changes to a 500-field event in a few lines.

This is an excellent specialist for sparse captured-event mutations, but a poor universal editor. JSON Pointer escaping and ordered operations add expertise, review must privilege the computed Result, and newly authored updates have no honest patch base. RFC 7396 Merge Patch was rejected because its `null` deletion semantics conflict with meaningful null field values.

## F — Quiet Buffer

One raw JSON editor remains visible. With one draft there is no navigation chrome. A future second draft adds only a count; activating it opens a transient searchable Draft Switcher backed by independent editor models.

This is the best low-chrome future multi-document model. It avoids rails, tabs, arrays, and queue language while preserving independent invalid buffers and targets. Its cost is reduced ambient awareness, so the collapsed count must surface hidden invalid and stale drafts.

## G — Draft Set

This synthesis preserves C's continuous editing experience without using C's literal batch array. One scrolling workspace contains independent raw JSON documents separated by protected event boundaries. Each boundary owns stable event identity, Source, target, status, and focus. The footer reviews only the focused draft and explicitly says that collection order has no execution semantics.

`Compare sources` changes every captured-event section into D's Source/Draft presentation, matched by stable event identity rather than array position. Side-by-side comparison becomes inline below 960px. A newly authored event keeps its full JSON editor and states that Workbench will not invent a captured source.

This is the strongest overall interaction model if future multi-event work values continuous scanning and editing. It costs more vertical space than F and needs careful editor-model virtualization in a production implementation, but it avoids permanent navigation chrome and does not turn the payload format into an execution contract.

G has now been promoted into the final top-level Variant A prototype. The promoted version adds independent event collapsing and replaces two diff scrollers with one shared Source/Draft scroll surface per event.

## Updated synthesis

- Use G as the leading proposal: A-like raw JSON editing for one event, a C-like continuous workspace for several independent events, and D-like comparison on demand.
- Keep F's transient Draft Switcher as a fallback if real traces make G's vertical workspace too long.
- Treat E as a possible later expert mutation mode, not as the canonical draft contract.
- Do not revive C's literal JSON array. G preserves its useful experience without coupling editing structure to ordering, batch review, or batch execution.
