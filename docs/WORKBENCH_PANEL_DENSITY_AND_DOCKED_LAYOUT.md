# Workbench Panel Density and Docked Layout

Status: accepted product direction, 2026-08-03

This document records the selected density, pane, resizing, overflow, and docked-size behavior for the Lightstreamer Workbench Chrome DevTools panel. It refines the accepted [Scoped Evidence Workspace](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md) and [Local Injection interaction model](../prototypes/workbench-ui-05/COMPARISON.md). Production implementation follows as a separate effort.

## Decision

Adopt **Elastic Triad**.

Scope, Evidence, and Context are stable workspace surfaces. Available geometry may relocate or temporarily park a surface, but it never reconstructs the developer's investigation state. Ordered Evidence remains dominant. Document-heavy work receives the full canvas rather than being compressed into an inspector.

This is a two-axis DevTools layout system, not a conventional webpage breakpoint system. Right docking produces narrow/tall geometry; bottom docking produces wide/short geometry. Width and height both determine whether panes remain useful.

## Geometry solver

Layout gates are derived from the usable content box after persistent operating, scope/origin, and status/action strips. The prototype uses these representative gates:

- **Wide Triad:** approximately `1120px` or wider with useful height. Scope, dominant Evidence, and Context coexist.
- **Normal Stack:** approximately `700px` or wider and `440px` or taller. Evidence appears above resizable Context; Scope is parked behind its breadcrumb action.
- **Shallow Side:** approximately `700px` or wider but shorter than `440px`. Evidence and Context sit side by side instead of becoming two unusably shallow rows.
- **Focused Compact:** all remaining geometry. Exactly one primary surface is visible.

Production derives the exact gates from pane minima and the current zoomed content box rather than treating these numbers as device classes. Resizing uses approximately `32px` of hysteresis around a gate so dragging the DevTools boundary cannot repeatedly flip layouts.

Representative verification geometries are:

- compact narrow/tall: `563×700`;
- normal: `900×700`;
- shallow wide/short: `900×320`;
- wide: `1440×900`;
- emergency shallow: `563×137`, operable but not a comfortable editing target.

## Pane minima and information priority

Pane minima exist to preserve useful operation, not merely prevent CSS overflow:

- Scope tree: approximately `216px` preferred, bounded to a compact structural range.
- Evidence ledger: approximately `520px` useful width in column form or `220px` useful height in a stack.
- Context: approximately `320px` useful width or `210px` useful height.
- Raw JSON document: all available working space; one Source or Draft comparison side requires enough width to remain meaningfully readable.

Evidence receives remaining capacity. A user resize cannot starve Evidence or Context below its useful minimum; reaching that boundary offers collapse or triggers the next geometry mode.

When capacity falls, Workbench reduces in this order:

1. Unpin the structural Scope tree while retaining the authoritative scope breadcrumb.
2. Move Context from beside Evidence to below it.
3. Replace simultaneous panes with one explicitly focused surface.
4. Move low-frequency actions into labelled overflow.
5. Convert evidence columns into the compact two-line row grammar.

Wide layouts expose more useful columns and context. They do not add padding, cards, metric tiles, or decorative empty space.

## Information that cannot be reduced away

Every supported geometry keeps these distinctions directly reachable:

- Capture useful/limited/unavailable and Capture active/stopped;
- Live/Frozen state and newer matching evidence;
- authoritative runtime scope;
- evidence identity and textual Server/Local provenance;
- selected-event identity when detail or a document is open;
- material diagnostic state;
- Local Injection Target, Source or newly-authored state, validation, Local-only boundary, and consequential action;
- Back or Minimize for an explicitly opened compact or promoted surface.

Visible labels may shorten in compact geometry, but their complete value remains programmatically available and reachable from the owning surface.

## Layout by geometry

### Wide Triad

- The bounded runtime Scope tree may be pinned on the left.
- Ordered Evidence is the dominant center surface.
- The runtime-object dossier or selected-evidence Context appears on the right.
- Scope and Context are independently resizable and collapsible.
- Evidence always retains its useful minimum and receives remaining width.
- Ordinary selected detail remains Context; document-heavy work promotes.

### Normal Stack

- Scope opens as a temporary picker and does not become a third persistent region.
- Evidence occupies the upper working region.
- Context occupies a resizable lower region, with Evidence preferred around 60–65 percent by default.
- Evidence and Context remember their normal stacked dimension separately from wide or shallow dimensions.
- Large documents promote rather than stretching the lower region indefinitely.

### Shallow Side

- Scope remains parked.
- Evidence and Context move side by side.
- The same surface identities, selection, lens, and scroll anchors survive the move from stacked to side placement.
- Structural strips compress to their accepted minimums; they do not disappear if they contain required state or actions.

### Focused Compact

- Exactly one primary surface is visible: Scope picker, Evidence, Context detail, raw evidence, diagnostics, export, or Local Injection.
- Selecting an evidence row does not automatically replace Evidence. Enter or an explicit Open action transitions to Context.
- Compact evidence uses a stable two-line row grammar retaining time/order, semantic type, primitive identity, operation/change summary, and textual provenance.
- Back restores the exact originating row or control, virtual-list anchor, scope, Filter, Find, Live/Frozen state, and focus.
- Compact behavior is ordinary master/detail restoration, not an investigation stack.

## Document promotion boundary

The following always or conditionally promote into one full-canvas document surface:

- Local Injection editing and Source comparison: always promote.
- Complete raw evidence: promote when Context cannot retain useful document dimensions.
- Deep Capture diagnostics and complete lifecycle analysis: promote when their evidence exceeds concise Context treatment.
- Export preview and review: promote when meaningful preview or configuration cannot retain the minimum action boundary.

The following normally remain in Context:

- runtime-object dossier;
- selected-event Summary, Fields, Deliveries, and COMMAND projections;
- concise diagnostics and recovery guidance;
- initial export controls and scoped manifest summary.

Only one promoted surface may exist. Supporting Problems or evidence peek may appear as one bounded transient surface within it, but cannot create another promotion. A different promoted operation must first close, park, or explicitly replace the current one.

Promotion never creates a permanent destination. Back or Minimize restores an exact workspace checkpoint.

## Restoration and resizing

Geometry-driven parking and deliberate collapse are distinct:

- A pane parked because geometry became insufficient returns automatically when capacity returns.
- A pane explicitly collapsed by the developer remains collapsed until explicitly reopened.
- Wide side-pane sizes, normal stacked-detail size, and shallow side-detail size are remembered independently.
- Stored sizes clamp to current pane minima without overwriting the remembered preference.
- Returning panes never steal focus, change selection, change the active Context lens, or move a scroll anchor.
- A focused separator that disappears transfers focus to the adjacent labelled restore control.

Responsive state is addressed by stable semantic identity rather than pixel position. Evidence restoration uses an event identity plus virtual-list anchor and offset. Editor restoration retains exact text, cursor, selection, folds, scroll, validation markers, and undo state.

## Scroll ownership

- The Workbench shell never becomes a scrolling document.
- Each visible Scope, Evidence, or Context pane owns exactly one content scroll.
- Toolbars, breadcrumbs, pane headings, splitters, and required action/status bars remain outside pane content scrolls.
- Focused Compact and promoted document surfaces have one primary content scroll owner.
- Side-by-side Source/Draft comparison uses one shared structural scroll surface; the columns never drift independently.
- Whole-panel horizontal scrolling is forbidden.
- The Evidence ledger or a raw document may own bounded horizontal scrolling when the content is inherently two-dimensional.
- Transient Problems or evidence-peek surfaces may own one bounded scroll without moving their underlying editor or ledger.
- Live Capture never changes a non-following scroll anchor, selection, or focused control.

## Density and reachability

- Operating, scope, task, and origin strips: approximately `28–30px` high.
- Bottom status/action strip: approximately `24–32px` high.
- Independent controls and selectable rows: at least `24×24px`, following compact developer-tool ergonomics rather than consumer-web touch sizing.
- Normal and wide evidence rows: approximately `26–28px`.
- Compact evidence rows: approximately `40–44px` with two lines.
- Noninteractive JSON and diff lines: approximately `18–20px`.

Focused Compact and shallow surfaces keep Back, current state, and the consequential action fixed and reachable. Fixed strips cannot cover focused content. `563×137` must preserve emergency operation and download/action reachability but is not a supported comfortable JSON-editing size.

## Scenario behavior

### Live Capture

- New evidence never steals focus, selection, Context, or a non-following scroll anchor.
- Following Live remains active only while the developer is explicitly following the tail.
- Frozen or historically anchored Evidence reports newer matching evidence in a reserved status region.
- Resizing never implies Capture stop, Freeze, Follow live, or selection change.

### Selected detail

- Wide: selected detail updates Context on the right.
- Normal: selected detail updates Context below Evidence.
- Shallow: selected detail moves beside Evidence.
- Compact: detail opens only through an explicit transition and restores Evidence exactly on Back.

### High-cardinality evidence

- Evidence remains virtualized with stable event identities.
- COMMAND keys remain evidence/filter identities and never become structural Scope-tree peers.
- Wide and normal preserve comparable columns while useful; compact switches to the two-line grammar.
- Complete copy and export operate on retained evidence, not only rendered rows.

### Local Injection

- Local Injection always promotes to the full canvas at every geometry.
- Exact Subscription instance, Session, item, Source or newly-authored state, target availability, validation, and Local-only boundary remain fixed outside raw JSON.
- Wide Source comparison becomes side by side only when both sides meet useful width; otherwise it is inline.
- Side-by-side comparison uses one shared scroll surface.
- Minimize parks the draft and restores Evidence. Starting another current draft reveals the parked draft and requires resume/finish or explicit discard.
- Target retirement blocks execution without moving the editor cursor or discarding edits.

### Diagnostics and export

- Material degraded state remains concise in the operating/status region with direct recovery guidance.
- The global footer owns each session- or runtime-level diagnostic once across every geometry; Ordered Evidence and Context do not repeat it. Complete diagnostic evidence may still promote when a dedicated investigation needs more than the footer grammar.
- Initial export choices may stay in Context; substantial preview/review promotes.
- Scope, version, privacy boundary, unconditional credential exclusion, and the final download action remain fixed and reachable.
- Failure preserves the originating investigation and current configuration.

## Theme and non-color behavior

Light, Dark, Follow DevTools, zoom, and forced-colors use the same geometry and density rules. This decision does not select the final semantic token system, which remains assigned to the visual-semantics ticket.

Required distinctions never rely on color alone:

- Server and Local provenance remain text;
- selection uses fill plus a leading marker;
- keyboard focus uses an independent outline;
- warning, invalid, stale, retired, and outcome states use text and icon/shape;
- diff lines include textual or gutter `+`, `−`, and changed-region markers.

## Rejected alternatives

### Anchored Context Deck

Rejected as the primary rule. Keeping Evidence visible throughout every normal/wide operation improves continuous correlation, but materially reduces raw-JSON editor height, creates dual-scroll ambiguity, and couples careful editing to moving live evidence. Maximization helps but does not equal a full-canvas document.

### Viewport Lease

Rejected as the universal rule. One surface at every geometry gives excellent compact reliability and document room, but pays unnecessary navigation tax and removes useful simultaneous Context where normal and wide geometry can support it.

Elastic Triad borrows Viewport Lease's full-canvas behavior for document-heavy operations and rejects the assumption that every ordinary detail requires promotion.

## Verification evidence

The disposable [workbench-ui-06 prototype](../prototypes/workbench-ui-06/README.md) provides all three models on one deterministic Lightstreamer scenario. The selected Elastic Triad was browser-checked across compact, normal, shallow, and wide frames; Live Evidence, selected detail, high-volume evidence, Local Injection, diagnostics, and export; and representative Dark and Light themes.

Checks covered panel-level overflow, pane relocation, compact two-line evidence rows, textual provenance, full-canvas Local Injection, Source/Draft scroll ownership, action reachability, variant switching, and browser console errors. Type checking, the extension build, JavaScript syntax checking, and whitespace validation passed. No production panel behavior changed.

## Vocabulary resolution

Elastic Triad, Normal Stack, Shallow Side, Focused Compact, and document promotion are product-layout language rather than new Lightstreamer domain concepts. No `CONTEXT.md` edit is required. Existing Scope, Evidence, Context, Injection Source, Injection Draft, Local Injection Target, Injected Update, and COMMAND projection vocabulary remains authoritative.
