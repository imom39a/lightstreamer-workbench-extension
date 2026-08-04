# PROTOTYPE — Workbench panel density and docked-size behavior

This is disposable UI for resolving `workbench-ui-06 — Choose panel density and docked-size behavior`. It is not production panel code.

Status: **Variant A — Elastic Triad selected during live human review. The complete layout contract is accepted.**

> Three materially different layout-rule systems, switchable with `?variant=`, applied to the accepted Scoped Evidence Workspace and the accepted single-event raw-JSON Local Injection flow.

Run it with:

```sh
npm run prototype:panel-density
```

Then open:

- `http://127.0.0.1:4176/workbench-ui-06/?variant=A`
- `http://127.0.0.1:4176/workbench-ui-06/?variant=B`
- `http://127.0.0.1:4176/workbench-ui-06/?variant=C`

Add `&presentation=1` to hide the disposable prototype controls when capturing the Workbench surface itself.

The floating Prototype state control switches among live evidence, selected detail, high-volume evidence, Local Injection, Capture diagnostics, and export review. It can render the actual browser size or representative compact `563×700`, normal `900×700`, shallow `900×320`, and wide `1440×900` frames.

The shallow frame is deliberate. Chrome DevTools docking produces both narrow/tall and wide/short geometries, so the final rules cannot be a conventional width-only responsive system.

## Candidates

- **A — Elastic Triad:** stable Scope, Evidence, and Context panes relocate or park as geometry changes. Local Injection and other document-heavy work are promoted.
- **B — Anchored Context Deck:** evidence remains visible at normal and wide sizes while one resizable deck hosts detail, Local Injection, diagnostics, or export. Compact becomes one surface.
- **C — Viewport Lease:** exactly one surface owns the usable canvas at a time; wider geometry enriches that surface instead of adding persistent panes.

The selected baseline is **A — Elastic Triad**: stable investigation panes may relocate or park as geometry changes, while document-heavy work receives the full canvas. B and C remain comparison evidence until the density ticket is fully resolved.

## Accepted geometry solver

Layout responds to available panel geometry and zoom, not a device name or docking side. Prototype gates are:

- **Wide Triad:** approximately `1120px` or wider with useful height, allowing Scope, dominant Evidence, and Context to meet their minimums.
- **Normal Stack:** approximately `700px` or wider and `440px` or taller, with Evidence above a resizable Context surface.
- **Shallow Side:** approximately `700px` or wider but shorter than `440px`, with Evidence beside Context instead of two unusably shallow rows.
- **Focused Compact:** all remaining geometry, exposing exactly one primary surface.

Production gates must be derived from the usable content box after persistent strips and pane minimums. Resizing uses approximately `32px` of hysteresis so dragging the DevTools boundary does not repeatedly flip layouts near a gate.

## Accepted restoration rule

- A pane parked only because geometry became insufficient returns automatically when capacity returns.
- A pane the developer explicitly collapsed remains collapsed until explicitly reopened.
- Wide side-pane sizes, normal stacked-detail size, and shallow side-detail size are remembered independently.
- Automatic restoration never steals focus, changes evidence selection, resets a lens, or moves a scroll anchor.
- If a focused separator disappears, focus moves to the adjacent labelled restore control; returning panes never claim focus.

## Accepted information-reduction hierarchy

When capacity falls, Workbench reduces in this order:

1. Unpin the structural Scope tree while retaining the authoritative scope breadcrumb.
2. Move Context from beside Evidence to below it.
3. Replace simultaneous panes with one explicitly focused surface.
4. Move low-frequency actions into labelled overflow.
5. Convert evidence columns into the compact two-line row grammar.

The layout never removes Capture and Live/Frozen state, authoritative scope, evidence identity, textual Server/Local provenance, selected-event identity, Local Injection target/source/validation, the consequential action, or a material diagnostic. Compact operation may shorten visible text, but the complete value remains programmatically available and reachable from its owning surface.

## Accepted scroll ownership

- The Workbench shell never becomes a scrolling document.
- Each visible Scope, Evidence, or Context pane owns exactly one content scroll.
- Toolbars, breadcrumbs, pane headings, splitters, and required action/status bars remain outside pane content scrolls.
- Focused Compact and promoted document surfaces have one primary content scroll owner.
- Side-by-side Source/Draft comparison uses one shared structural scroll surface; its columns never drift independently.
- Whole-panel horizontal scrolling is forbidden. Only inherently two-dimensional evidence or raw documents may own bounded horizontal scrolling.
- Live Capture never moves a non-following scroll anchor, selection, or focused control.
- Transient Problems, evidence peek, and similar supporting surfaces may own one bounded scroll without moving their underlying editor or ledger.

## Accepted density and reachability

- Operating, scope, task, and origin strips are approximately `28–30px` high.
- The bottom status/action strip is approximately `24–32px` high.
- Independent controls and selectable rows provide at least `24×24px`, following compact developer-tool ergonomics rather than consumer-web touch sizing.
- Normal and wide evidence rows are approximately `26–28px`; compact evidence uses `40–44px` two-line rows.
- Noninteractive JSON and diff lines may use approximately `18–20px` line height.
- Focused Compact and shallow surfaces keep Back, current state, and the consequential action fixed and reachable.
- `563×137` is emergency-operable geometry, not a comfortable editing target.
- Wider layouts reveal useful columns and context; they never spend capacity on extra padding, card grids, metric tiles, or decorative empty space.

## Accepted promotion boundary

- Local Injection editing and Source comparison always promote to the full canvas.
- Complete raw evidence, deep Capture diagnostics, complete lifecycle analysis, and export preview/review promote when their content exceeds Context-pane minimums.
- Ordinary dossiers, selected-event Summary/Fields/Deliveries/projections, concise diagnostics, and initial export controls remain in Context.
- Only one promoted surface may exist. Promotion never creates a nested stack or permanent destination.
- Back or Minimize restores the exact originating workspace checkpoint.

The durable accepted rules live in [`docs/WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md`](../../docs/WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md).

## Accepted-model captures

- [`selected-A-wide-detail-dark.png`](screenshots/selected-A-wide-detail-dark.png)
- [`selected-A-normal-detail-light.png`](screenshots/selected-A-normal-detail-light.png)
- [`selected-A-shallow-detail-dark.png`](screenshots/selected-A-shallow-detail-dark.png)
- [`selected-A-compact-evidence-dark.png`](screenshots/selected-A-compact-evidence-dark.png)
- [`selected-A-compact-injection-dark.png`](screenshots/selected-A-compact-injection-dark.png)
- [`selected-A-wide-injection-dark.png`](screenshots/selected-A-wide-injection-dark.png)

The prototype is in-memory only. It never communicates with an inspected page or Lightstreamer Server.

The product owner previously requested direct work on `main`, so the prototype remains isolated by directory rather than using the prototype skill's default throwaway branch. The accepted decision—not this code—will be the durable output.
