# Workbench Keyboard and High-Frequency Operation Model

Status: accepted product direction, 2026-08-04

This document defines the keyboard, focus, selection, filtering, contextual-action, and pointer behavior for the Lightstreamer Workbench Chrome DevTools panel. It refines the accepted [Scoped Evidence Workspace](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md), [Elastic Triad layout](WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md), and [single-event Local Injection editor](../prototypes/workbench-ui-05/COMPARISON.md). Production implementation follows as separate work.

## Decision

Adopt **Roving Instrument**.

Workbench uses ordinary Tab order between semantic surfaces and the expected keyboard model inside each composite widget. Scope, Evidence, Context, menus, splitters, and promoted documents own clearly bounded behavior. Focus identifies where the next keyboard operation occurs; selection identifies the evidence or runtime object currently being inspected. Passive capture changes neither.

The accepted trade-off is deliberate: predictable, browser-native interaction may require more Tab traversal between distant surfaces. Workbench does not compensate with a command palette, printable-key leader, mnemonic pane mode, remapping system, or second command registry. Those systems add hidden state and conflict management before a measured navigation bottleneck exists.

## Operating principles

1. **One Tab stop per composite.** Tab and Shift+Tab move between surfaces. Arrow keys operate only inside the focused composite.
2. **Focus and selection are independent.** Moving focus to Context or another control does not clear the selected evidence. Hover is neither focus nor selection.
3. **Passive work is inert.** Capture, live updates, responsive relocation, and pane restoration never steal focus, change selection, move a non-following scroll anchor, or disturb an editor.
4. **Consequential actions are explicit.** No chord injects locally, clears retained evidence, changes Capture, discards a draft, or silently retargets it.
5. **Escape requires ownership.** Workbench consumes Escape only when it has a visible transient layer to close.
6. **Every accelerator has a visible route.** Context menus and tooltips improve throughput without becoming the only way to discover a core operation.
7. **Geometry changes placement, not meaning.** The same semantic focus target and selection survive wide, normal, shallow, and compact layouts.

## Surface model

### Scope

Scope is a tree composite with one Tab stop.

- Up and Down move the tree cursor.
- Left collapses an expanded node or moves to its parent.
- Right expands a collapsed node or moves to its first child.
- Home and End move to the first and last visible node.
- Typeahead moves the cursor without changing Scope.
- Enter or Space commits the focused runtime object as Scope.
- Pointer click focuses and commits the node in one operation.

Scope deliberately differs from Evidence: arrow navigation is inspection; Enter or Space is commitment. This prevents a quick tree scan from repeatedly rebuilding Evidence.

### Evidence

Evidence is an interactive grid or list composite with stable event identities and one Tab stop.

- Up and Down move row focus and selection together.
- Page Up and Page Down move by one viewport.
- Home and End traverse within the current retained region; Control/Command+Home and Control/Command+End reach retained bounds.
- Enter explicitly opens or focuses Context for the selected event.
- Pointer click focuses and selects. Double-click may open Context, but is never required.
- Moving focus away retains a quieter, unfocused selection state.
- If cell-level horizontal navigation is introduced, it must not silently change the selected event.

Selecting Evidence updates visible Context without moving focus. At wide, normal, and shallow geometry, Enter transfers focus into the existing Context lens. At compact geometry, Enter performs the explicit Evidence-to-Context surface replacement. Selection alone never replaces compact Evidence.

### Context

Context retains the selected event or runtime object while focus moves elsewhere.

- Context tabs use Left, Right, Home, and End with immediate activation because their content is local and immediate.
- Enter from Evidence focuses the active Context lens at simultaneous-pane geometries.
- Compact Back returns to the exact originating Evidence row, selection, virtual-list anchor, and focused control.
- A hidden or geometry-parked Context surface is absent from Tab order.

### Menus and popovers

Right-click, the Menu key or Shift+F10, and a visible object-menu button expose the same object-scoped commands.

- Up and Down move through enabled items; Home and End reach the bounds.
- Enter or Space activates an item.
- Escape closes the menu and restores the exact keyboard trigger.
- A pointer-opened non-modal popover may close on outside click without forcing focus restoration.
- A keyboard-opened popover restores its semantic trigger when dismissed.

Appropriate contextual accelerators include copy, filter by value, reveal related evidence, and create a Local Injection Draft. Capture, clear retained evidence, export, and final Local Injection always have visible non-menu routes.

### Splitters

Keyboard-operable separators use arrows in their visual orientation, Shift+arrow for a larger increment, Home and End for useful limits, and Enter to collapse or restore. Pointer dragging and labelled collapse/restore controls produce the same state changes. If responsive layout removes a focused splitter, focus moves to its adjacent labelled restore control.

### Promoted documents and the raw JSON editor

The Local Injection editor is a promoted document, not a special keyboard mode.

- Tab moves focus out of raw JSON by default.
- A visible editor-local **Tab inserts indentation** toggle opts into code-editor indentation.
- The preference is local to the editor and does not introduce a global chord or hidden panel mode.
- Undo, redo, text selection, cursor, scroll, folding, validation markers, and document Find remain editor-owned.
- Opening a draft restores its editor cursor while keeping Target, Source, Local-only provenance, validation, and action controls outside the document.

Keyboard users reach Review and the labelled **Inject locally** control by ordinary focus navigation, then activate the focused control with Enter or Space. An invalid or retired target keeps the action visible with a textual blocking reason. Workbench never moves the editor cursor, discards the draft, or chooses a replacement target automatically.

## Find, Filter, Jump, and Scope

These are distinct operations and must remain visibly distinguishable.

- **Find** locates matches without changing the evidence set. Enter and Shift+Enter navigate next and previous matches.
- **Filter** changes the visible set, remains visibly active, reports shown versus total evidence, and provides explicit Apply and Clear actions.
- **Jump** navigates to a known client, Session, Subscription, item, key, or event identity.
- **Scope** changes the authoritative runtime object whose evidence is being investigated.

Control/Command+F is the only accepted panel-level chord:

- When Workbench chrome or Evidence owns focus, it opens Evidence Find.
- When raw evidence or a draft editor owns focus, it remains document-local.
- Filter receives no global shortcut.
- Find uses staged Escape: the first Escape clears a non-empty temporary query; the next closes Find and restores its exact origin.

This context boundary follows the established distinction between DevTools panel search and filtering. See [Chrome DevTools search](https://developer.chrome.com/docs/devtools/search/) and [Chrome DevTools keyboard shortcuts](https://developer.chrome.com/docs/devtools/shortcuts).

## Escape ownership and restoration

Escape closes only the topmost visible Workbench-owned transient and restores its semantic keyboard trigger. It does not:

- close ordinary Context;
- act as compact Back;
- minimize or discard a draft;
- change Scope;
- toggle Live, Frozen, or Capture;
- escape from the raw editor when no Workbench transient owns it.

When no Workbench transient is open, Workbench does not consume Escape. Chrome DevTools retains its Drawer behavior.

Each composite remembers its last semantic focus target on re-entry. Restoration uses identities rather than DOM positions: runtime-object identity for Scope, event identity and virtual-list anchor for Evidence, lens identity for Context, and cursor/selection/fold/scroll state for editors.

## Hidden, filtered, and retired objects

### Filter hides the selection

Preserve the selected event and Context and show **Selected event outside current results** with visible Reveal and Clear selection actions. Evidence focus moves to the nearest visible row without silently changing selection. The next deliberate Up or Down commits a new visible selection. Live updates cannot change the hidden selection or row focus.

### The focused object disappears

If retention or runtime retirement removes a focused row or node, recover to the nearest logical survivor in this order: next sibling, previous sibling, parent. Announce the recovery once only when the developer was operating that surface. Preserve historical selection whenever retained evidence still supports it.

A retired Injection Target blocks Review and execution in place. It does not move editor focus, discard the draft, or select another target.

## Live Capture, following, and announcements

Capture and investigation position are independent.

- Passive capture never moves focus, selection, Context, a non-following scroll anchor, or editor state.
- Workbench does not announce individual captured updates.
- Following Live is explicit. Frozen investigation may continue while Capture remains active.
- Status announcements are reserved for deliberate action outcomes, material Capture or storage changes, focused-object retirement, Injection target or validation changes, and a relevant newer-matching-evidence count.

Announcements are concise and do not repeat on every render. Persistent Capture and Live/Frozen state remain visible rather than being represented by transient messages.

## Discoverability

- Overflow includes a labelled **Keyboard help** entry grouped by the currently focused surface.
- Tooltips show assigned keys on both hover and keyboard focus.
- The first keyboard entry into a composite may show a temporary hint such as **Arrows navigate · Enter opens**, with equivalent accessible text.
- Workbench does not add a permanent shortcut bar, onboarding panel, keyboard-mode indicator, or printable-key leader.

The help surface describes behavior already present in visible controls; it is not a second command registry.

## Chrome and DevTools shortcut boundary

The prototype checked proposed behavior against the current official [Chrome DevTools shortcut map](https://developer.chrome.com/docs/devtools/shortcuts) and [assistive-technology navigation guidance](https://developer.chrome.com/docs/devtools/accessibility/navigation). Workbench does not claim DevTools or browser chords for the Command Menu, file navigation, cross-resource search, panel cycling, Drawer, reload, docking, zoom, debugger control, or recording tools.

Control/Command+F is the sole intentional context multiplexer because it follows established local-Find behavior and remains document-local inside editors. The former Control/Command+Enter direct Local Injection shortcut is retired. F6, Alt+number, pane-cycling chords, printable mnemonics, and focus modes are excluded from v1.

## Accessibility contract

Use native controls where possible. Implement ARIA composite roles only with their full interaction behavior. The selected rules align with the [APG keyboard-interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/), [grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/), [tree view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/), [tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [menu pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu/), and [window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/).

Material UI changes must verify:

- complete keyboard traversal and operation without a pointer;
- one Tab stop per composite and logical ordering at every geometry;
- visible, independent focus and selection in light, dark, and forced-colors modes;
- focus restoration after menu, Find, compact, and promoted-document transitions;
- stable focus, selection, scroll, and editor state during live capture;
- names, roles, states, row context, blocking reasons, and status outcomes with assistive technology;
- pointer parity for selection, opening, contextual actions, and resizing.

## Rejected alternatives

### Operator Lens

Rejected as the v1 operating model. A searchable command projection could improve discovery of infrequent actions, but it requires a registry for ranking, availability, object scope, and focus restoration. It risks becoming a hidden mega-menu that duplicates visible controls.

### One-Shot Key Lens

Rejected as the v1 operating model. Temporary mnemonic pane routing reduces long-distance Tab traversal, but adds memory burden, international-keyboard and assistive-technology risk, remapping, and conflict management.

Revisit either accelerator only after measured usage identifies a concrete bottleneck that native composites, Find, and contextual menus cannot solve. Their prototypes remain comparison evidence, not dormant production features.

## Verification evidence

The disposable [workbench-ui-07 prototype](../prototypes/workbench-ui-07/README.md) compares all three models on the same deterministic Workbench scenario. The selected Roving Instrument was browser-checked for:

- keyboard movement and selection in Evidence;
- explicit Evidence-to-Context opening;
- staged Find Escape and exact trigger restoration;
- pointer, Menu key, and Shift+F10 contextual parity;
- unowned Escape preservation;
- filtered-out selection retention and deliberate replacement;
- editor Tab movement and indentation opt-in;
- invalid and retired Injection targets without direct execution shortcuts;
- Live, Frozen, empty, high-volume, menu, Local Injection, and validation-error scenarios;
- compact, normal, shallow, and wide geometry in representative light and dark themes.

JavaScript syntax checking, TypeScript checking, the production extension build, whitespace validation, browser overflow checks, and console inspection passed. No production panel behavior changed.

## Vocabulary resolution

This decision adds no Lightstreamer domain term. Focus, selection, Find, Filter, Context, and composite navigation are interaction vocabulary, so [CONTEXT.md](../CONTEXT.md) does not change. Existing domain boundaries remain authoritative: captured Server evidence is immutable, Local Injection operates on a separate target-anchored draft, and Capture remains independent from Live/Frozen investigation state.
