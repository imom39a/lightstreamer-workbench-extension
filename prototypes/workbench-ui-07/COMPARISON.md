# Keyboard model comparison

Status: **A — Roving Instrument selected and accepted as the final interaction model**

All candidates preserve the same product and domain boundaries. Focus and selection are separate, Scope and Evidence selection are separate, Live/Frozen is not Capture, Local Injection remains target-anchored and Local-only, and geometry cannot reset the investigation.

## A — Roving Instrument

One roving focus cursor per composite. Tab crosses semantic surfaces, arrows operate inside the focused tree/grid/tablist/menu, Enter opens the selected evidence, and Escape closes only a Workbench-owned transient layer.

Strongest at predictability, accessibility, and avoiding Chrome/DevTools conflicts. Its cost is more Tab traversal between distant surfaces.

## B — Operator Lens

A searchable projection of commands already visible in the current Scope, Evidence selection, Context, or promoted document. It distinguishes Find, Filter, Jump, Scope, Open, and Action instead of treating them as one fuzzy mutation box.

Strongest at discovery and scaling to infrequent operations. Its cost is a substantial command registry, ranking, availability, and focus-restoration system that can become a hidden mega-menu.

## C — One-Shot Key Lens

A temporary mnemonic layer routes focus to Scope, Evidence, Detail, Raw, Filter, Find, Jump, Live/Frozen, or Local Injection sub-surfaces. One command completes and exits; it never directly performs a consequential action.

Strongest at expert pane movement across changing geometry. Its cost is memory burden, international-keyboard and assistive-technology risk, plus remapping and conflict-management complexity.

## Baseline selection

Use **A — Roving Instrument** as the final model. The product owner accepted the trade-off that predictable native composite navigation may require more Tab traversal between distant surfaces. B and C are rejected as primary operating models. Revisit an accelerator only if measured use exposes a concrete throughput problem that A cannot solve. The lasting contract is recorded in [Workbench Keyboard and High-Frequency Operation Model](../../docs/WORKBENCH_KEYBOARD_AND_OPERATION_MODEL.md).

Current official Chrome documentation reserves the DevTools Command Menu, file navigation, cross-resource search, panel cycling, Drawer, reload, docking, zoom, debugger, and several recording chords. The prototype therefore treats `Control/Command+F` as the only intentional panel-level multiplexing and consumes Escape only while a visible Workbench transient layer owns it.

## Accepted rules so far

### Evidence and Scope selection

- In Evidence, Up/Down moves the active row and selection together. Context updates immediately, but keyboard focus remains in Evidence.
- Horizontal cell movement, where supported, does not change the selected event.
- Moving focus out of Evidence preserves selection with a quieter unfocused-selected presentation.
- Scope deliberately differs: arrows move the tree cursor for inspection, while Enter or Space commits the focused runtime object as Scope.
- Live updates never advance either cursor or selection automatically.

### Evidence to Context

- Enter on the selected Evidence row is the explicit Open/Focus Context operation.
- At wide, normal, and shallow geometry, selection may already have updated visible Context; Enter transfers focus into its active lens.
- At compact geometry, Enter performs the explicit Evidence-to-Context replacement.
- Merely selecting an event never steals focus or replaces the compact Evidence surface.

### Escape ownership

- Escape closes only the topmost visible Workbench-owned transient layer and restores its semantic trigger.
- Find uses staged Escape: first clear a non-empty temporary query, then close Find and restore its origin.
- Escape does not close Context, minimize a draft, discard edits, change Scope, or toggle Live/Frozen.
- With no owned transient layer open, Workbench does not consume Escape, preserving the DevTools Drawer behavior.

### Find and Filter

- Find locates matches without changing the evidence set. Enter and Shift+Enter move to the next and previous match.
- `Control/Command+F` opens Evidence Find when Workbench chrome or Evidence owns focus.
- The same chord remains document-local when raw evidence or the Injection Draft editor owns focus.
- Filter changes the visible evidence set, remains visibly active with shown/total status, and has explicit Apply and Clear controls.
- Filter receives no additional panel-wide shortcut. Find, Filter, Jump, and Scope remain distinct operations.

### Contextual actions

- Right-click, the Menu key or `Shift+F10`, and a visible object-menu button open the same object-scoped command set.
- Copy, filter by value, reveal related evidence, and create a Local Injection Draft are appropriate contextual accelerators.
- Escape closes the menu and restores the exact invoking row, tree item, or control.
- Every core operation also has a visible non-menu route.
- Final Local Injection, Capture controls, clearing retained evidence, and export are never menu-only operations.

### Local Injection keyboard boundary

- Retire the current `Control/Command+Enter` direct-execution shortcut.
- No keyboard chord executes a Local Injection, silently retargets a draft, discards edits, or clears validation.
- Opening a draft focuses the restored raw-JSON editor cursor while target, Source, Local-only boundary, validation, and action remain outside the document.
- Keyboard users reach Review and the final labelled **Inject locally** control through ordinary focus navigation and activate the focused control with Enter or Space.
- Invalid or retired-target states keep the action discoverable with a textual blocking reason and never move the editor cursor automatically.

### Raw editor Tab behavior

- Tab moves focus out of the raw JSON editor by default, preserving an ordinary keyboard path through the promoted document.
- A visible editor-local **Tab inserts indentation** toggle may opt into code-editor behavior.
- The toggle affects only the current editor preference and does not create a hidden panel-wide mode or chord.
- Undo, redo, text selection, document Find, cursor, scroll, validation markers, and folding remain editor-owned behavior.

### Filter-hidden selection

- When Filter hides the selected event, preserve the selection and Context with an explicit **Selected event outside current results** state.
- Context provides visible Reveal and Clear selection actions.
- Evidence focus moves to the nearest visible row without silently changing selection.
- The next deliberate Up/Down movement commits a new visible selection.
- Live updates cannot change the hidden selection, focused row, or scroll anchor.

### Disappearing focused objects

- If retention or runtime retirement removes the focused event or node, move focus to the nearest logical survivor: next sibling, previous sibling, then parent.
- Announce the recovery once only when the developer was operating that surface.
- Historical selection remains readable whenever its evidence is still retained.
- A retired Local Injection Target blocks Review and execution without moving editor focus, discarding the draft, or selecting a replacement target.

### Rejected command layers

- Exclude B's Operator Lens and C's One-Shot Key Lens from the selected v1 model.
- Do not ship a command palette, printable-key leader, mnemonic pane mode, remapping system, or second command registry preemptively.
- Reconsider an accelerator only after real usage identifies a specific, measurable navigation bottleneck that native composites, Find, and contextual menus cannot address.
- B and C remain prototype evidence rather than dormant production features.

### Discoverability

- Provide a labelled **Keyboard help** entry in overflow, grouped by the currently focused surface rather than one undifferentiated shortcut list.
- Tooltips reveal assigned keys on both pointer hover and keyboard focus.
- When a composite first receives keyboard focus, a short temporary hint such as **Arrows navigate · Enter opens** may appear with equivalent accessible description.
- Do not add a permanent shortcut bar, onboarding panel, or keyboard-mode indicator.

### Composite key map

- Scope tree: Up/Down traversal; Left collapse or ascend; Right expand or descend; Home/End; typeahead; Enter/Space commits Scope.
- Evidence grid: Up/Down moves row focus and selection; Page Up/Down moves by a viewport; Home/End traverses the row; Control/Command+Home/End reaches the retained bounds; Enter opens/focuses Context.
- Context tabs: Left/Right and Home/End move with immediate activation because lenses are local and instant.
- Menus: Up/Down, Home/End, Enter/Space, and Escape with trigger restoration.
- Splitters: orientation arrows resize; Shift increases the increment; Home/End reaches useful limits; Enter collapses or restores.
- Every composite is one Tab stop and restores its last semantic focus target on re-entry.

### Pointer parity

- Clicking Evidence focuses and selects the row. Double-click may open Context but is never the only route.
- Clicking a Scope node focuses and commits it in one pointer operation.
- Right-click and visible object-menu buttons expose the same contextual actions.
- Pointer-opened non-modal popovers may dismiss on outside click without forcing focus back; keyboard-opened popovers restore their trigger.
- Dragging splitters and labelled collapse controls provide the same state changes as separator keyboard operation.

### Cross-surface navigation

- Tab and Shift+Tab are the only v1 cross-surface navigation mechanism.
- Each composite contributes one Tab stop; native controls follow logical task order for the current geometry.
- Hidden or geometry-parked panes never enter the Tab sequence.
- Do not assign F6, Alt+number, pane-cycling, or focus-mode shortcuts.
- Compact Back/Minimize restores the exact originating semantic control, selection, and virtual-list anchor.

### Live Capture and announcements

- Passive Capture never moves focus, selection, Context, a non-following scroll anchor, or editor state.
- Do not announce individual captured updates through a live region.
- Concise status announcements are reserved for deliberate user-action outcomes, material Capture or storage changes, focused-object retirement, Local Injection target or validation changes, and a relevant newer-matching-evidence count.
- Following Live is explicit; Frozen investigation and background Capture remain independent.
