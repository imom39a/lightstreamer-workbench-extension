# Workbench production UI migration plan

Status: **accepted implementation handoff, 2026-08-04**

This plan moves the production Chrome DevTools panel from the current feature-first DOM renderer to the accepted [integrated Workbench direction](../prototypes/workbench-ui-10/README.md). It is an implementation sequence, compatibility contract, and verification handoff. It does not change production behavior by itself.

The migration preserves Lightstreamer and extension semantics. It replaces the panel renderer and its state boundary; it does not reinterpret Capture, COMMAND state, Local Injection, storage, privacy, export, or analytics.

## Outcome

Implement the accepted **Scoped Evidence Workspace** with React in three developer-visible vertical slices:

1. **Read-only Diagnose and operate** — the complete observation, scoping, Evidence, Context, projection, export, and degraded-operation journey.
2. **Single-event Local Injection** — both accepted entry paths, raw JSON editing, optional Source comparison, validation, review, execution, and persistent outcomes.
3. **Cut over and remove the legacy renderer** — change the approved Store build to React only, prove capability parity, and delete the temporary compatibility machinery and obsolete interface.

Slices 1 and 2 are separately buildable React panel variants used in development and CI. They are not partial Store rollouts. The Store build continues to contain only the legacy renderer until Slice 3, when it changes directly to React and the legacy implementation is removed.

## Decisions fixed by this plan

### Framework and ownership

- Use React for the new DevTools panel only.
- Keep background, content-script, inspected-page instrumentation, bridge, event history, Capture, and Lightstreamer semantics framework-independent.
- Create one React root and one `WorkbenchRuntime` per panel session.
- Do not introduce Redux, Zustand, or another application state container initially.
- Do not preserve `PanelController` or `renderPanel()` as the new panel interface. They remain isolated legacy implementation details until cutover and are then deleted.
- Do not run, mount, or hot-switch two renderers in one panel session.

### Deep runtime boundary

`WorkbenchRuntime` is the single owner of observable investigation state. Its complete public interface is:

```ts
interface WorkbenchRuntime {
  getSnapshot(): WorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: WorkbenchCommand): void;
  dispose(): void;
}
```

The interface is framework-independent. React consumes it through `useSyncExternalStore`, renders immutable snapshots, and dispatches typed commands. `getSnapshot()` returns the same cached object until observable state changes. `dispose()` is idempotent and releases store subscriptions, bridge listeners, timers, scheduled publications, and view-owned resources.

The runtime owns:

- Capture operation, Coverage, inspected-context availability, and storage fallback state;
- current structural Topology and active Scope;
- Evidence query, bounded history window, Live or Frozen position, newer matching count, Find, Filter, focus identity, selection, and Context identity;
- Observed Server and Local Effective COMMAND projections and their supporting diagnostics;
- promoted raw Evidence, export, and diagnostic document state;
- the semantic Local Injection Source, Draft, exact target, validation, review, pending execution, and immutable outcome;
- navigation and restoration identities required to preserve the developer's investigation.

React components do not subscribe directly to Capture, history, bridge, or analytics services. CodeMirror may retain presentation-local cursor, selection, fold, scroll, and undo structures, but the runtime owns the Draft text, target, validation, review state, and outcome. Unmounting or changing geometry must preserve both semantic and editor restoration state.

### Publication cadence

- Developer commands publish synchronously: Scope, Find, Filter, Evidence selection, Context transitions, Freeze or Follow Live, draft changes, review, and execution actions feel immediate.
- Passive Capture updates enter history and runtime projections immediately, then publish at most one immutable snapshot per animation frame with a 32 ms fallback.
- Passive updates never steal focus, change a pinned selection, move a Frozen anchor, reset an editor, or close Context.
- When the DevTools panel is hidden, Capture and persistence continue but React publications stop. Showing the panel publishes one consolidated current snapshot before resuming frame-aligned updates.

### Evidence rendering

- Preserve the existing query-backed **60-event bounded window** for the first production migration.
- Preserve complete current-session history in the existing store; the bound applies only to rendered Evidence.
- Preserve chronological order, Live and Frozen semantics, filtered newer counts, stable event identity, selection, scroll anchoring, and deliberate Follow Live behavior.
- React renders keyed rows from the bounded snapshot. Do not add a virtual-list dependency until measured production evidence shows missed frames, long tasks, or inadequate historical navigation.
- A future virtualization change cannot alter Evidence, query, selection, or Live/Frozen semantics.

### Local Injection editor

- Use modular CodeMirror 6 packages for JSON state, view, commands, search, JSON language support, lint markers, and merge presentation.
- Load the editor and merge packages lazily when a Local Injection or comparison document opens. They are not part of the initial panel chunk.
- Do not use Monaco. Its broader VS Code feature and worker surface is unnecessary for this focused raw-JSON workflow.
- The default surface is an editable raw JSON Draft. It is not a generated field-by-field form.
- Optional Source comparison uses CodeMirror's two-sided merge presentation with one shared outer scroll owner. The Source is immutable and matched to the Draft by Evidence identity.
- Long unchanged regions may collapse; each Draft event boundary may also be minimized without hiding its identity, target, validation problem, or outcome state.
- Current production behavior contains exactly one Draft event. Visible Evidence never automatically becomes Draft membership.

### Build-time renderer boundary

- Keep the panel HTML/bootstrap stable and resolve an internal `panel-renderer` module through a Vite compile-time alias.
- During Slices 1 and 2, the normal Store build resolves only the legacy renderer. A separate development and CI command resolves only the React renderer.
- Never select the renderer with a URL parameter, local storage, hidden preference, remote flag, runtime conditional, or dynamic hot switch.
- Each built extension contains exactly one renderer. Rollup must not retain the inactive implementation or its framework dependencies.
- At cutover, the normal alias resolves React. The immediately following cleanup removes the alias, legacy renderer, legacy public interface, old-only selectors, tests, CSS, and baselines.

### Compatibility contract

Compatibility is judged through deterministic panel scenarios and user-visible semantics—not `PanelController`, legacy DOM structure, or pixel parity with the old panel.

Each cross-renderer scenario fixes:

- Capture messages and ordering;
- Topology, Subscription modes, items, fields, COMMAND lifecycles, and target availability;
- viewport, theme, panel visibility, and initial history state;
- developer actions expressed in semantic terms;
- expected Scope, Evidence, selection, projections, diagnostics, export, Draft, and outcome semantics.

Each renderer receives a thin interaction adapter. During coexistence, CI runs the same scenario contract against legacy and React separately and compares observable meaning and outcomes. Legacy selectors, adapter, and legacy-only baselines are deleted at cutover.

Visual compatibility means conformance to the accepted prototype and UI standard, not visual parity with the legacy shell.

## Preserved capability contract

| Capability | Migration requirement | Proof boundary |
| --- | --- | --- |
| Capture | Remains observational; never alters or suppresses application updates or messages. Capture operation stays distinct from Coverage and Live/Frozen view state. | Shared Capture scenarios plus unpacked-extension fixture. |
| Official Web Client instrumentation | Existing MAIN-world instrumentation and typed bridge envelopes remain unchanged unless separately approved. React never enters inspected-page code. | Build bundle audit and official-client fixture. |
| Event history | Ordered IndexedDB batches, in-memory fallback, current-DevTools-session teardown, filtering, counts, and complete retained history remain intact. | In-memory and IndexedDB sustained-Capture scenarios. |
| Scope and Topology | Structural Topology chooses Scope; Evidence selection never silently changes it. Retired objects remain readable but cannot be targets. | Live, retired, limited-Coverage, and disconnected scenarios. |
| COMMAND projections | Observed Server uses captured Server Updates only. Local Effective additionally applies successful Local Injected Updates. Names and provenance never collapse. | Projection comparison and lifecycle scenarios. |
| Local Injection | Forks an immutable Source into one prospective Draft, remains local and Subscription-scoped, validates the exact live target, and uses the existing delivery path. | Draft, stale-target, delivered, partial-failure, and acknowledgement-loss scenarios plus extension fixture. |
| Export and privacy | Versioned JSON/offline HTML, credential exclusion, deliberate local download, selected redaction, and no cross-session Capture persistence remain unchanged. | Browser download/offline proof and schema tests. |
| Analytics | Existing consent, event minimization, failure isolation, and privacy boundaries remain unchanged. Renderer changes do not create new analytics meaning implicitly. | Consent-on/off and transport-failure tests. |
| Theme and accessibility | Auto, Dark, Light, forced-colors awareness, keyboard composites, visible focus, and exact restoration follow the accepted standards. | Pairwise screenshots, keyboard paths, and axe. |

## Slice 1 — Read-only Diagnose and operate

### Developer-visible outcome

A developer can open the React panel, establish whether Capture is useful, scope an investigation, inspect ordered Evidence, understand runtime and COMMAND state, preserve a historical investigation during sustained Capture, diagnose degraded operation, and export or copy relevant evidence. No Local Injection capability is claimed by the React build yet.

### Included behavior

- accepted operating strip: Capture, Coverage, Live/Frozen, current Scope, and contextual recovery;
- Elastic Triad behavior across wide, normal, shallow, and compact panel geometry;
- structural Scope picker and breadcrumb for Page, client, Session, Subscription, item, listener, and applicable COMMAND key context;
- dominant ordered Evidence ledger with query-backed 60-event windows;
- Scope, Filter, Find, focus, selection, Context, and Live/Frozen state kept independent;
- runtime-object dossier and selected-Evidence Context;
- raw Evidence and complete Evidence copy;
- Observed Server and Local Effective COMMAND projections with exact names and provenance;
- high-volume Frozen history and accurate filtered newer counts;
- Capture limited, disconnected, recovering, retired-Scope, and in-memory-fallback states with safe conclusions and nearby recovery;
- scoped versioned JSON and offline HTML export with current redaction and credential rules;
- theme preference, current retention/clear behavior, session teardown, analytics consent, and failure isolation.

### Implementation order

1. Add the stable bootstrap, compile-time renderer alias, React-only build command, scenario adapter, React root, and the smallest `WorkbenchRuntime` that renders a truthful empty or Capture-orientation state.
2. Bring Capture operation, Coverage, Topology, and Scope into the runtime with the operating strip and Scope picker.
3. Bring history querying, bounded Evidence, Filter, Find, selection, Context, and Live/Frozen behavior into the same runtime slice.
4. Add raw Evidence, COMMAND projections, diagnostics, high-volume/degraded behavior, export, theme, retention/clear, and analytics consent.
5. Complete the Slice 1 verification packet and establish the React bundle, startup, long-task, and memory baseline.

Each extraction lands with a developer-visible React behavior and its scenario. There is no foundation-only refactor or speculative shared-component library.

### Required Slice 1 scenarios

- empty useful Capture and empty current Scope;
- active Capture with no selection;
- selected Server and Local Evidence;
- Live sustained Capture and Frozen high-volume history;
- active Filter and separate Find navigation;
- limited Coverage, inspected-page disconnect, recovery, retired Scope, and IndexedDB fallback;
- raw Evidence, scoped export, and both COMMAND projections;
- normal teardown and reopened panel state appropriate to current-session storage.

### Slice 1 completion gate

- Every included legacy capability has a scenario-backed React equivalent or an explicit accepted removal recorded in the ticket. Cosmetic similarity is not required.
- Capture, history, projections, export, privacy, and analytics tests pass unchanged or are replaced with semantic tests at an equal or stronger boundary.
- The actual extension loads the React-only build against the official client fixture and completes a read-only Diagnose journey.
- The normal Store build remains legacy and green.

### Slice 1 fallback

Do not change the Store renderer. If the React slice is not acceptable, remove or revert its isolated commits; Capture, storage, and the released panel remain on the prior verified legacy artifact.

## Slice 2 — Single-event Local Injection

### Developer-visible outcome

A developer can create one explicit Local Injection Draft from either a selected compatible Captured Item Update or a live COMMAND scope, edit raw JSON at useful size, optionally compare it to its immutable Source, review the exact target and Local-only boundary, execute deliberately, and inspect a persistent truthful outcome.

### Included behavior

- **Create Local Injection Draft** from one selected compatible Captured Item Update;
- **Author COMMAND Item Update** from one live applicable COMMAND item or key scope;
- exactly one current Draft, with explicit park/resume or discard behavior before changing its anchor;
- full-size raw JSON CodeMirror editor with syntax support, search, undo, and inline validation;
- optional immutable Source/Draft comparison using one shared scroll owner;
- per-event minimize/collapse that retains boundary identity and material status;
- schema, command/key, changed-field, item, Subscription instance, Session, listener-set, page-delivery, and target-liveness validation;
- dedicated Review that keeps exact target, Source/Draft relationship, Local-only boundary, and validation visible together;
- pending execution that prevents accidental duplicate activation;
- delivered, failed, partial-listener-failure, acknowledgement-loss, and retired-target outcomes that state only what Workbench can prove;
- successful marked Injected Update Evidence, unchanged Observed Server COMMAND State, and advanced Local Effective COMMAND State;
- exact Back, focus, cursor, selection, fold, scroll, undo, Draft, and outcome restoration across layout changes and promoted documents.

### Explicitly excluded

- multiple selected Evidence events becoming Drafts;
- multi-event editing, Draft Set membership, ordering, batch review, or batch execution;
- Replay or generic resend terminology;
- Server Injection or any implication that Workbench creates an inbound server-stream update;
- automatic retargeting, repetition, discarding, or broadening of a Draft.

### Implementation order

1. Add lazy modular CodeMirror integration and the selected-Evidence Source-to-Draft transition.
2. Add semantic JSON validation, Source comparison, shared scrolling, collapse/minimize, and complete editor restoration.
3. Add target preflight, dedicated Review, execution dispatch through the existing Local Injection bridge, and persistent outcomes.
4. Add the authored COMMAND entry path using the same Draft and execution contract.
5. Complete Local Injection browser, extension, performance, accessibility, and independent-review evidence.

### Required Slice 2 scenarios

- unchanged and edited captured Source;
- newly authored COMMAND update without an Injection Source;
- large valid JSON, invalid syntax, semantic field error, and corrected Draft;
- Source comparison with long unchanged regions, one shared scroll owner, and minimized Draft event;
- target retirement before Review and between Review and execution;
- deliberate Review, duplicate-activation prevention, delivered outcome, delivery failure, partial listener failure, and acknowledgement loss;
- Local Injected Update trace and divergent named COMMAND projections;
- compact park/resume and exact editor/focus restoration.

### Slice 2 completion gate

- Both entry paths complete through the same Draft contract.
- A real unpacked-extension fixture proves delivery through the existing official Lightstreamer client/listener path; a standalone mock is insufficient.
- Invalid or stale Drafts cannot execute and never manufacture successful Injected Update Evidence.
- CodeMirror and its language/merge code appear only in lazy panel chunks and require no remote code, `eval`, runtime JSX, or relaxed extension-page CSP.
- The React build has capability parity for all accepted Diagnose and Local Injection journeys. Only then may Slice 3 begin.

### Slice 2 fallback

The Store build remains legacy. Revert the React Slice 2 commits or continue to use the last verified React Slice 1 artifact while defects are resolved. Never expose a partial Local Injection workflow in a Store build.

## Slice 3 — Cut over and remove the legacy renderer

### Developer-visible outcome

The normal extension build and Chrome Web Store package contain the accepted React Workbench only. All preserved capabilities remain available, and no temporary compatibility control or obsolete legacy interface remains.

### Implementation order

1. Run and record the complete capability-parity checklist against the last legacy artifact and candidate React artifact using the shared scenarios.
2. Switch the normal compile-time alias so `npm run build` and Store packaging resolve React only.
3. Run the full unit, browser, extension, official-client fixture, export/offline, performance, accessibility, visual, CSP, and package verification packet.
4. In the immediately following cleanup commit, delete the renderer alias, legacy `renderPanel()`/`PanelController` surface, legacy-only implementation and CSS, legacy interaction adapter, selectors, tests, screenshot baselines, and temporary build commands.
5. Audit production source, tests, docs, analytics names, and screenshots for obsolete Timeline/Topology/COMMAND peer-view organization, Replay terminology, and accidental dual-renderer references.
6. Build and retain the verified release artifact and its measurements before publication work begins.

The cutover and cleanup may be separate consecutive commits for reviewability, but they form one release boundary. Do not publish the intermediate dual-source repository state.

### Slice 3 completion gate

- The Store ZIP contains one renderer, one React copy, and no legacy panel code.
- The initial panel JavaScript chunk is at most 500 kB uncompressed. Editor/merge code remains lazy.
- The actual stored-entry Store ZIP is below 1 MiB, or the maintainer explicitly reviews and approves a raised engineering budget before release.
- React is absent from background, content, and inspected-page/instrumentation bundles.
- The compiled extension contains no remote executable code, runtime JSX transform, inline executable script, `eval`, or `new Function`, and installs under the declared Manifest V3 CSP.
- No serious or critical axe violations, unreviewed baseline changes, material independent-review findings, or semantic capability gaps remain.
- Production build, package, and official-client fixture evidence are attached to the implementation ticket or pull request.

### Slice 3 fallback

Rollback means reverting the cutover commit or reinstalling the previous verified legacy artifact. It does not mean shipping a runtime toggle, retaining two renderers indefinitely, or restoring legacy through a hidden setting. If the React artifact fails after cutover but before release, return `main` to the last verified commit while correcting the candidate.

## Verification standard for every slice

All three slices are **Material UI** changes under the [Workbench UI standard](WORKBENCH_UI_STANDARD.md). Each slice must record the following evidence.

### Static, unit, and semantic checks

- `npm run typecheck`
- `npm test`
- `npm run build` for the approved Store renderer
- the corresponding React-only build during Slices 1 and 2
- focused runtime snapshot/command/disposal tests;
- preserved domain, projection, history, export, privacy, analytics, and Local Injection tests;
- a bundle-content audit proving renderer and framework isolation.

Behavior changes are developed from a failing user-facing test at the lowest layer capable of detecting them. DOM-structure assertions are not compatibility evidence unless the structure itself carries required accessibility semantics.

### Browser and extension checks

- `npm run test:ui`
- `npm run test:ui:extension` whenever the shipped DevTools boundary is exercised;
- the official Lightstreamer fixture proof for Capture and Local Injection slices;
- real browser geometry for overflow, reachability, scrolling, downloads, focus visibility, and editor behavior;
- no unexpected browser-console warnings or errors.

### Pairwise visual matrix

Do not preserve a full Cartesian state × geometry × theme baseline set.

- Render every named semantic state and run automated no-overflow/reachability checks.
- Represent compact `563×700`, normal `900×700`, shallow `900×320`, and wide `1440×900` geometry in inspected screenshots.
- Represent Dark and Light themes across the packet.
- Exercise high-volume, degraded Capture, invalid Draft, Source comparison, Review, and failure outcomes across both themes and the relevant extreme geometries.
- Record base, changed, and diff artifacts for every affected baseline and explain intentional updates.

### Keyboard and accessibility

- Run axe against representative journeys with zero serious or critical violations.
- Verify Evidence and Scope composite navigation, Find, Filter, Context entry, promoted-document Back restoration, resize controls, menus, Review, and outcomes using the keyboard.
- Preserve visible focus and distinguish focus from selection.
- Ensure CodeMirror does not trap Tab; provide and verify its tab-focus escape behavior.
- Verify accessible names, current states, changed counts, target identity, provenance, diagnostics, and outcome announcements.

### Performance and package evidence

Record the exact environment and compare each slice with the previous verified artifact:

- unpacked `dist` bytes and actual stored-entry Store ZIP bytes;
- every JavaScript chunk's uncompressed and gzip bytes and its delta;
- cold panel time to first usable frame over at least five runs;
- scripting/parse time and long tasks during low-volume startup and sustained high-volume Capture;
- retained heap after opening, exercising, hiding/showing, and disposing the panel;
- visible Evidence refresh gap under sustained Capture.

The first React slice establishes the runtime baseline. Later slices require explicit review when cold usability regresses by more than 20% or 50 ms, whichever is larger; when a panel-attributable task exceeds 50 ms in the high-volume scenario; or when repeated lifecycle cycles show monotonic retained-heap growth. These are review triggers, not permission to weaken semantic or accessibility gates.

### Independent review

An independent reviewer receives the source acceptance criteria, deterministic scenario identifiers, base and changed screenshots, visual diffs, geometries, themes, keyboard/a11y results, bundle/performance measurements, and extension-fixture result without implementation rationale. Material findings block completion until fixed or explicitly accepted as an intentional design decision by the maintainer.

## Risks and stop conditions

| Risk | Prevention and detection | Stop or fallback condition |
| --- | --- | --- |
| Renderer divergence during coexistence | One scenario contract, separate artifacts, capability comparisons, short three-slice migration. | A semantic mismatch without an approved product decision blocks the next slice. |
| React render storms during Capture | Deep runtime, cached immutable snapshots, frame batching, bounded rows, hidden-panel consolidation. | Refresh-gap, long-task, or heap review trigger is exceeded. |
| Focus or investigation loss | Identity-based Scope/Evidence/editor restoration and browser keyboard scenarios. | Passive Capture changes focus, selection, Frozen anchor, Context, or Draft. |
| COMMAND semantic drift | Preserve existing projection modules and exact named outputs; scenario both projections after Local Injection. | Observed Server includes Local Evidence or Local Effective fails to include a successful local update. |
| Unsafe Local Injection | Exact target identity, preflight validation, dedicated Review, pending lock, truthful immutable outcomes. | Any stale/invalid Draft can execute, a target silently changes, or successful Evidence is manufactured after uncertain failure. |
| Editor/package growth | Modular lazy CodeMirror, per-chunk measurements, 500 kB initial-chunk and 1 MiB Store ZIP gates. | A budget is exceeded without explicit review or editor code enters initial/background/content bundles. |
| Manifest V3 rejection | Local dependencies, compiled-artifact audit, CSP install proof, no remote executable code/evaluation. | Any runtime-loaded executable dependency, inline executable script, `eval`, or relaxed CSP is required. |
| Permanent compatibility burden | Build-only alias, one renderer per artifact, immediate Slice 3 deletion audit. | A runtime renderer switch or indefinite legacy path becomes necessary; reopen the migration decision instead. |

## Handoff checklist

Before implementation starts:

- create implementation work items for Slice 1, Slice 2, and Slice 3 in that order;
- attach this plan, the integrated prototype review matrix, and the UI standard to each item;
- keep production work on `main` as requested, using small independently green commits and no migration branch;
- record the last verified legacy commit and package as the initial fallback point;
- capture the current package and runtime performance baseline using the same commands and environment planned for React;
- do not start Slice 2 until Slice 1's React evidence packet is accepted;
- do not start cutover until complete Diagnose and single-event Local Injection capability parity is accepted.

## Source decisions and evidence

- [Canonical developer journeys](CANONICAL_DEVELOPER_JOURNEYS.md)
- [Scoped Evidence Workspace](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md)
- [Local Injection interaction model](../prototypes/workbench-ui-05/COMPARISON.md)
- [Panel density and docked layout](WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md)
- [Keyboard and operation model](WORKBENCH_KEYBOARD_AND_OPERATION_MODEL.md)
- [Visual semantics](WORKBENCH_VISUAL_SEMANTICS.md)
- [Workbench UI standard](WORKBENCH_UI_STANDARD.md)
- [Integrated prototype review](../prototypes/workbench-ui-10/REVIEW-MATRIX.md)
- [React extension bundle-size research](research/react-chrome-extension-bundle-size.md)
- [CodeMirror system guide](https://codemirror.net/docs/guide/) and [merge reference](https://codemirror.net/docs/ref/)

## Approval record

The product owner explicitly approved:

1. a temporary gated migration with capability parity before cutover and immediate legacy removal afterward;
2. three vertical slices: Diagnose, single-event Local Injection, and cutover/removal;
3. React in the panel only and a new framework-independent `WorkbenchRuntime` instead of preserving `PanelController`;
4. one runtime and one renderer per panel session;
5. deterministic scenarios as the compatibility contract;
6. a build-time-only renderer gate with no shipped runtime switch;
7. CodeMirror 6 for raw JSON editing and Source comparison;
8. the query-backed 60-event Evidence window without an initial virtualization dependency;
9. synchronous developer-command publication and frame-batched passive Capture publication;
10. the compile-time Vite alias build boundary;
11. pairwise visual verification plus browser, extension, performance, accessibility, and independent-review evidence;
12. all remaining recommendations needed to complete this ordered handoff.

No `CONTEXT.md` amendment is required. `WorkbenchRuntime`, React, renderer aliasing, CodeMirror, package budgets, vertical slices, and compatibility scenarios are implementation and product-process language. Existing domain terms and semantics remain authoritative.
