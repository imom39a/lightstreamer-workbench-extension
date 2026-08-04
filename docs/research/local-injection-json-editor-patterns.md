# Raw-JSON Local Injection editor patterns

**Date:** 2026-08-03  
**Question:** What established developer-tool interaction patterns can inform a raw-JSON-first Local Injection editor for 50–500 fields, optional source comparison, validation, and possible future multi-document editing?  
**Scope:** Primary sources only: Chrome DevTools documentation, Visual Studio Code and Monaco documentation, and JSON standards. Product recommendations below are inferences from those sources, not claims that Workbench should reproduce another tool exactly.

## Findings

### 1. The editable document should own the workspace

Visual Studio Code describes its editor as the main area and its sidebars, status bar, and lower panel as supporting regions. Its default layout explicitly maximizes editor space while keeping errors and warnings in a panel rather than permanently inside the document surface. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface#_basic-layout)

**Workbench implication:** for 50–500 Lightstreamer fields, the Injection Draft JSON should be the dominant surface. Exact target, source identity, and the Local-only boundary need persistent but compact context outside the document. Validation summaries can occupy a status line; a detailed problem list should open only when requested.

### 2. Source comparison can be a revision tool rather than another editor mode

Chrome DevTools' Changes panel tracks edits made within DevTools, presents them as a diff, and supports reverting all changes to the selected file. It places this supporting view in the Drawer by default and notes that the tracked changes are session-scoped unless another persistence mechanism is configured. [Chrome DevTools Changes panel](https://developer.chrome.com/docs/devtools/changes)

VS Code's source-control diff editor compares the original and modified file. It defaults to side-by-side presentation, can use an inline presentation, can collapse unchanged regions in large files, supports next/previous-change navigation, and offers change-level reversion from the gutter. It also supplies an Accessible Diff Viewer. [VS Code review changes with the diff editor](https://code.visualstudio.com/docs/sourcecontrol/staging-commits#_review-changes-with-the-diff-editor)

Monaco exposes the same core primitives without requiring source-control semantics:

- `createDiffEditor` constructs a dedicated diff editor. [Monaco `createDiffEditor`](https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.editor.createDiffEditor.html)
- The original model is non-editable by default. [Monaco `originalEditable`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html#originalEditable)
- It supports side-by-side rendering, a width breakpoint that switches to inline rendering, compact mode, resizable split views, hidden unchanged regions, next-difference affordances, and an accessible-only diff presentation. [Monaco diff editor options](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html)

**Workbench implication:** there are two credible patterns:

1. a dominant single draft document with comparison opened temporarily; or
2. a revision editor in which immutable Source and editable Draft form the primary diff.

The second is a genuinely different concept, not a JSON editor with a supplemental source drawer. It is especially suitable when the developer's central question is “what will differ from the captured update?” Wide docking can use side-by-side diff, while normal and compact docking can switch to inline diff without changing the underlying document model. “Stage” and “commit” should not be borrowed: a Local Injection Draft has no partial-execution or source-control staging semantics.

### 3. Large-document review should hide unchanged material without hiding access to it

VS Code recommends collapsing unchanged regions for large diffs and supplies next/previous change navigation. [VS Code diff editor](https://code.visualstudio.com/docs/sourcecontrol/staging-commits#_review-changes-with-the-diff-editor) Monaco directly exposes `hideUnchangedRegions`, including context-line and reveal-line controls. [Monaco `hideUnchangedRegions`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html#hideUnchangedRegions)

Chrome DevTools pretty-prints Changes output so a single long line does not force horizontal review. [Chrome DevTools Changes panel](https://developer.chrome.com/docs/devtools/changes#view-and-understand-your-changes)

**Workbench implication:** a Revision Editor may collapse long unchanged spans by default after the first mutation, but must provide “Show all” and ordinary document search. The complete Source and Draft remain inspectable. Workbench should compare a stable, deterministic serialization so formatting-only changes do not overwhelm semantic changes.

### 4. Validation should be visible in-place and expandable on demand

VS Code shows errors and warnings in several coordinated places: inline in the document, in the overview ruler, as a status summary, and in an on-demand Problems panel. It supports keyboard traversal and inline code actions. [VS Code errors and warnings](https://code.visualstudio.com/docs/editing/editingevolved#_errors-warnings)

Monaco's JSON language service supports both syntax and schema-based validation and can associate schemas with model URIs. It exposes configurable severity for schema errors and trailing commas. [Monaco JSON diagnostics options](https://microsoft.github.io/monaco-editor/typedoc/interfaces/languages_features_json_register.DiagnosticsOptions.html)

JSON Schema Draft 2020-12 defines structural assertions over a JSON instance and can also carry descriptive metadata useful to interactive tools. [JSON Schema validation specification](https://json-schema.org/draft/2020-12/json-schema-validation)

**Workbench implication:** use two validation layers:

- JSON syntax and the editable draft-document schema, associated with the draft model; and
- Workbench domain diagnostics for captured schema compatibility, COMMAND `command`/`key`, snapshot semantics, changed-field semantics, and target availability.

Markers belong on the editable Draft, not the immutable Source. The status line should summarize errors and warnings; activating it opens a bounded Problems drawer. Validation must not silently repair JSON or move the cursor. Any quick fix must describe and apply an ordinary undoable text edit.

### 5. Preserve familiar in-document search and avoid colliding with DevTools

Chrome DevTools uses `Command/Ctrl+F` for search inside the current tool and provides next/previous match controls, case sensitivity, and regular expressions where supported. It uses `Escape` globally to toggle the Drawer and reserves other combinations for panel navigation, the Command Menu, and cross-resource search. [Chrome DevTools search](https://developer.chrome.com/docs/devtools/search/) [Chrome DevTools keyboard shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)

VS Code exposes keyboard traversal of diagnostics and the Problems list; its documented default is `F8`/`Shift+F8` for next/previous error or warning. [VS Code default keyboard shortcuts](https://code.visualstudio.com/docs/reference/default-keybindings)

**Workbench implication:** preserve `Command/Ctrl+F`, ordinary JSON-editor undo/redo, go-to-line, folding, and next-diagnostic behavior. Do not assign a global shortcut that executes a Local Injection. `Escape` should close a Workbench-owned overlay only when one is open; otherwise Workbench should not unexpectedly defeat DevTools' Drawer behavior.

### 6. The editor must reject ambiguous JSON object members

RFC 8259 says object member names should be unique and warns that receiver behavior is unpredictable when they are not: implementations may keep only the last member, fail parsing, or expose every duplicate. [RFC 8259, Objects](https://www.rfc-editor.org/rfc/rfc8259.html#section-4)

**Workbench implication:** duplicate keys in the editable draft must be a blocking diagnostic. Workbench must not silently accept the last duplicate member. Formatting and parsing also need to preserve the distinctions among `null`, empty string, `false`, and zero. The draft schema should admit only the value shapes supported by the actual Local Injection implementation.

### 7. Separate text models support future documents without defining future execution

Monaco represents editor content as `ITextModel` instances with stable URIs and independent undo/redo behavior. [Monaco `ITextModel`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ITextModel.html) Its editor API can serialize and restore view state, including cursor and scroll state. [Monaco `saveViewState` / `restoreViewState`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ICodeEditor.html#restoreViewState)

VS Code uses tabs for open documents and preserves open files and layout state. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface#_basic-layout)

**Workbench implication:** model today's one-event draft as one source model plus one draft model with stable Workbench-owned URIs, and persist editor view state for the DevTools session. If multi-event drafting is added later, it can add one independent model pair per event and a document switcher. This does **not** imply array-shaped JSON, run-all behavior, ordering, delays, shared targets, or any other multi-event execution semantics.

### 8. A standards-based patch document is useful, but only as a specialist mutation view

RFC 6902 defines a JSON Patch document as an array of operations. The operations are applied sequentially to one target document until all succeed or an error occurs. Each operation uses a JSON Pointer path and one of `add`, `remove`, `replace`, `move`, `copy`, or `test`. [RFC 6902, document structure and operations](https://www.rfc-editor.org/rfc/rfc6902.html#section-3)

RFC 7396 defines JSON Merge Patch as an object-shaped description of changes. It is concise, but `null` means removal rather than assigning a JSON null value; the RFC says the format is best suited to object-heavy documents that do not use explicit null values. [RFC 7396, introduction](https://www.rfc-editor.org/rfc/rfc7396.html#section-1)

**Workbench implication:** RFC 6902 can support a credible Source → Patch → Result editor for a captured event with a small number of mutations. It makes the edit recipe compact and auditable, but JSON Pointer escaping and ordered operations are additional concepts, and the computed Result—not the patch—would need to be the execution-review payload. Merge Patch is a poor default while `null` is a valid Lightstreamer field value. Neither patch format should replace full-document authoring for a newly authored COMMAND update, because a patch requires a real base document and Workbench must not fabricate an Injection Source.

### 9. A transient draft switcher can preserve an empty one-document workspace

VS Code supports navigation among open editors through tabs, Quick Open, and most-recently-used history, and it also supports working with tabs hidden. [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface#_working-without-tabs)

Chrome DevTools' Command Menu provides one transient search surface that changes between commands and file opening rather than keeping every navigation action permanently visible. [Chrome DevTools Command Menu](https://developer.chrome.com/docs/devtools/command-menu)

**Workbench implication:** if future work introduces multiple independent drafts, the one-draft screen can remain free of tabs and rails. A compact `N drafts` status can open a transient searchable Draft Switcher that swaps independent editor models and their external target/source metadata. The switcher must not use queue language, ordering controls, multi-selection, or any execution command. Because Chrome and VS Code already own common Quick Open chords, Workbench should expose a visible button and only assign a shortcut after collision testing.

### 10. A continuous Draft Set can be a view without becoming a batch document

The product decision is not limited to permanent navigation versus one JSON array. Workbench can present several independent editor models in one continuous scrolling workspace while retaining a stable model URI, Source, target, validation state, undo history, and view state for each event.

**Workbench implication:** the continuous order is a reading and editing aid only. It must be labeled as having no injection-order semantics. Source comparison matches each draft by stable event identity rather than array index, preventing insertion, removal, or reordering from producing a misleading whole-array diff. Review remains focused on one draft until a separate multi-event execution model is deliberately designed.

## Recommended interaction standards

1. **Document first.** Raw JSON or raw JSON diff receives nearly all available panel area.
2. **Protected context outside JSON.** Subscription identity, item, Session, listener availability, immutable Source identity, and “Local only; no server contacted” cannot be pasted over or edited as payload.
3. **One canonical editable projection.** Do not expose both a form model and a JSON model that can disagree.
4. **Deterministic serialization.** Preserve stable field order from the captured schema where possible; ignore formatting-only changes in semantic counts.
5. **Immutable base, editable working revision.** In a diff, Source is always read-only and Draft owns validation markers and undo history.
6. **Responsive diff, not squeezed columns.** Use side-by-side only when each side remains usable; switch to inline at normal and compact widths.
7. **Progressive diagnostics.** Gutter and status first; Problems drawer on demand; explicit execution review after the document validates.
8. **Search and navigation are editor-native.** Retain common find, go-to-line, folding, change navigation, and diagnostic navigation.
9. **No execution in the editor.** Review and explicit Local Injection remain outside the editable JSON and revalidate the exact target at the boundary.
10. **Future documents remain independent.** Reserve a document-title slot, not a batch model.
11. **Patch editing is optional expertise.** If offered, apply it only to a real immutable captured source and always review the computed full result.
12. **Transient navigation is valid.** A searchable switcher can replace permanent tabs or a rail when ambient awareness is less important than editor space.
13. **A continuous view is not a batch contract.** Several independent models may share one scrolling workspace while keeping validation, Source, target, undo, and review boundaries per event.
14. **Collapsing preserves the boundary.** An event may hide its editor or comparison body, but identity, target, Source, validation status, and focused state remain visible.
15. **Diff columns share a scroll surface.** Source and Draft should live inside one vertical and horizontal scroll container when presented side by side. Structural synchronization is more reliable than coordinating two independent scroll events and prevents drift.
16. **Draft membership is explicit.** Current Local Injection contains exactly one selected captured event or one newly authored COMMAND event. A future Draft Set begins with one explicit member; additional captured or authored events enter only through an Add operation. Timeline visibility is never membership, and timeline multi-selection can only be a bulk shortcut into that same operation.
17. **Current mode has one active draft.** Starting from another captured event or the new COMMAND action must not append to, replace, or retarget a parked draft. Workbench reveals the active draft and requires resume/finish or explicit discard before another draft is created.

## Design cautions

- A diff can overemphasize textual formatting. Canonical initial formatting and semantic change counts are necessary.
- Side-by-side diff is harmful when DevTools is narrow. Use an explicit breakpoint and an inline presentation rather than horizontal compression.
- Source-control words such as *stage*, *commit*, and *push* would falsely imply partial or server-side execution. Use *Source*, *Draft*, *difference*, *revert*, *review*, and *Inject locally*.
- A newly authored COMMAND update has no Captured Item Update to present as its Source. Its read-only base must be labeled as a schema-derived authoring basis from the captured Subscription/item context, never as an observed Server Update.
- A successful Local Injection changes Local Effective COMMAND State only. Diff colors describe Source-to-Draft text, not server effects or business outcomes.
- JSON Patch operation order applies to constructing one Result document. It must never be presented as future Local Injection execution order.
- JSON Merge Patch's `null` deletion rule conflicts with a draft model in which `null` is a meaningful field value.

## Primary sources

- [Chrome DevTools: Changes](https://developer.chrome.com/docs/devtools/changes)
- [Chrome DevTools: Search](https://developer.chrome.com/docs/devtools/search/)
- [Chrome DevTools: Keyboard shortcuts](https://developer.chrome.com/docs/devtools/shortcuts)
- [VS Code: User interface](https://code.visualstudio.com/docs/editing/userinterface)
- [VS Code: Errors and warnings](https://code.visualstudio.com/docs/editing/editingevolved#_errors-warnings)
- [VS Code: Review changes with the diff editor](https://code.visualstudio.com/docs/sourcecontrol/staging-commits#_review-changes-with-the-diff-editor)
- [VS Code: Default keyboard shortcuts](https://code.visualstudio.com/docs/reference/default-keybindings)
- [Monaco: `createDiffEditor`](https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.editor.createDiffEditor.html)
- [Monaco: Diff editor options](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html)
- [Monaco: JSON diagnostics options](https://microsoft.github.io/monaco-editor/typedoc/interfaces/languages_features_json_register.DiagnosticsOptions.html)
- [Monaco: `ITextModel`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ITextModel.html)
- [Monaco: `ICodeEditor`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ICodeEditor.html)
- [JSON Schema Draft 2020-12 validation](https://json-schema.org/draft/2020-12/json-schema-validation)
- [RFC 8259: JSON](https://www.rfc-editor.org/rfc/rfc8259.html)
- [RFC 6902: JSON Patch](https://www.rfc-editor.org/rfc/rfc6902.html)
- [RFC 7396: JSON Merge Patch](https://www.rfc-editor.org/rfc/rfc7396.html)
- [Chrome DevTools: Command Menu](https://developer.chrome.com/docs/devtools/command-menu)
