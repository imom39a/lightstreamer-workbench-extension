# Workbench UI Standard

Status: accepted, 2026-08-04

This is the normative entry point for designing, changing, and reviewing the Lightstreamer Workbench Chrome DevTools panel. It keeps the product optimized for developer investigation rather than conventional web-application presentation, and it defines the minimum evidence required before a UI change is treated as ready.

The primary maintainer owns this standard. Contributors may propose amendments through a focused pull request or internal Project ticket, but a change to a mandatory rule, semantic boundary, or accepted interaction model requires explicit maintainer approval.

## Authority and supporting contracts

Workbench domain language and behavioral boundaries remain authoritative in [CONTEXT.md](../CONTEXT.md), the [architecture](ARCHITECTURE.md), and accepted [ADRs](adr/). This standard governs UI decisions within those boundaries.

The following accepted contracts provide detailed rules:

- [Canonical Developer Journeys](CANONICAL_DEVELOPER_JOURNEYS.md) — the operator, journey priority, completion conditions, and degraded paths.
- [Workbench Workspace Information Architecture](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md) — Scoped Evidence Workspace.
- [Local Injection interaction model](../prototypes/workbench-ui-05/COMPARISON.md) — one target-anchored raw-JSON Injection Draft today and the future Draft Set boundary.
- [Workbench Panel Density and Docked Layout](WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md) — Elastic Triad.
- [Workbench Keyboard and Operation Model](WORKBENCH_KEYBOARD_AND_OPERATION_MODEL.md) — Roving Instrument.
- [Workbench Visual Semantics](WORKBENCH_VISUAL_SEMANTICS.md) — Plain Ledger.

The [panel verification procedure](agents/ui-verification.md) and [independent visual-QA procedure](agents/ui-visual-qa.md) explain how to collect evidence. They do not replace this standard or redefine its change classes. Research and disposable prototypes are decision evidence, not normative product contracts.

When two sources appear to conflict, apply them in this order:

1. domain vocabulary, constraints, and ADRs;
2. this standard;
3. accepted detailed UI contracts;
4. verification procedures;
5. prototype and research evidence.

Escalate a real contradiction to the primary maintainer instead of silently choosing the most convenient rule.

## Governing outcome

Workbench is an expert debugging instrument inside Chrome DevTools. Its core operating sequence is:

> compact live-session orientation → focused investigation → deliberate scoped action

The default journey is evidence-backed diagnosis of incorrect application state. Local Injection is the second core journey. Degraded operation appears contextually. Raw capture, complete COMMAND lifecycle analysis, high-volume history, and export remain one interaction away without becoming permanent peer destinations.

A successful UI helps a developer name the boundary where behavior diverged and cite the evidence. It does not attempt to look like a consumer dashboard, prescribe an investigation taxonomy, or hide Lightstreamer semantics behind generic application language.

## Mandatory design rules

### Developer journey and information architecture

- Use the **Scoped Evidence Workspace**. Ordered Evidence is the dominant working surface, structural Topology chooses Scope, and Context explains the active runtime object or selected Evidence.
- Do not reintroduce permanent Timeline, Topology, and COMMAND State peer destinations.
- Keep Scope, Filter, Find, focus, selection, Capture operation, and Live/Frozen Evidence position independent.
- Keep advanced evidence and contextual actions one interaction away while preserving the originating Scope, selection, Filter, scroll anchor, Live/Frozen position, and safe Draft state.
- Do not add or maintain an investigation-step stack, wizard, task taxonomy, or hidden workflow trail.

### Density, panes, and scroll

- Use **Elastic Triad**: Wide Triad, Normal Stack, Shallow Side, then Focused Compact as available width and height change.
- Geometry may relocate or park Scope and Context; it never changes semantic state or reconstructs an investigation.
- Reduce in the accepted order: unpin Scope, relocate Context, focus one surface, overflow low-frequency actions, then use compact two-line Evidence rows.
- Every visible pane owns at most one content scroll. The Workbench shell and whole panel never scroll horizontally.
- Use bounded horizontal scrolling only for inherently two-dimensional Evidence or raw documents.
- Promote Local Injection and Source comparison to the full canvas. Promote other document-heavy work only when Context cannot remain useful.
- Wide geometry may expose more context but never capabilities unavailable at compact geometry.

### Keyboard, focus, selection, and contextual commands

- Use **Roving Instrument**. Tab and Shift+Tab are the only cross-surface navigation commands.
- Implement the conventional composite keyboard model completely for every tree, grid, tablist, menu, and splitter.
- Keep focus and selection visibly and programmatically distinct. Passive Capture never moves either.
- Evidence Up/Down moves row focus and selection together; Context updates without stealing focus. Enter deliberately opens Context.
- Consume Escape only for the topmost Workbench-owned transient and restore the exact trigger. Unowned Escape remains available to Chrome DevTools.
- Keep Find, Filter, Jump, and Scope distinct. Control/Command+F is contextual to Evidence or the active document.
- Context menus accelerate object-scoped actions but never provide the only path to a core action.
- Do not add a command palette, leader-key layer, mnemonic pane mode, remapping system, or second command registry without measured evidence of a concrete bottleneck and a standard amendment.

### Actions, Find, and progressive disclosure

- Keep at most one necessary primary action in each decision context. Accent does not imply domain success.
- Separate global/session actions from Scope- or selection-owned actions, and keep destructive actions visually apart from both.
- Use labelled controls for consequential and unfamiliar actions. A familiar compact icon control still requires an accessible name and discoverable purpose.
- Keep active Filters, shown/total counts, and a one-step reset visible. Find moves among matches; it never silently changes the visible Evidence set.
- Use overflow menus and Context for infrequent controls, advanced Evidence, and raw detail.
- Do not progressively hide Capture operation, observation Coverage, current Scope, active Filters, selection, textual provenance, material diagnostics, or the final Local Injection Target and action.
- Preserve a visible route to every core action. Hover, right-click, and shortcuts may accelerate but never exclusively own a capability.

### Visual semantics and text

- Use **Plain Ledger**: explicit text first, stable placement second, typography and limited shape third, and color only as reinforcement.
- Keep Capture operation, observation Coverage, Live/Frozen position, runtime lifecycle, provenance, Snapshot/Live phase, COMMAND operation, diagnostics, Injection readiness/outcome, and interaction state independent.
- Keep `SERVER`, `LOCAL`, `RUNTIME`, and `WORKBENCH` textual at every density. Do not use provenance colors or treat Local as success.
- Keep `ADD`, `UPDATE`, and `DELETE` neutral. A COMMAND verb is not diagnostic severity.
- Reserve generic selection fill plus a leading marker for selection and an independent outline for focus.
- Pair every material diagnostic with severity text, affected Evidence or object, consequence, and one relevant inspection or recovery route.
- Keep raw JSON syntax styling free of Workbench provenance, mutability, validation, and COMMAND meaning. Place those semantics outside the document.
- Consolidate session- and runtime-level diagnostics in the global footer and render each cause once. Do not repeat the same diagnostic in Ordered Evidence or Context; keep workflow-local validation and outcomes at their own decision boundary.
- Use sentence case, active voice, Lightstreamer-native terms, and direct recovery guidance. Avoid card dashboards, badge necklaces, hover-only meaning, decorative metrics, and private icon vocabularies.
- Preserve the same meaning in Dark, Light, Follow DevTools, zoom, grayscale, and forced-colors conditions.

### COMMAND projections

- Always name **Observed Server COMMAND State** and **Local Effective COMMAND State** in full at their decision boundary.
- State the evidence contributing to each projection and any completeness limit.
- Keep the fact that neither projection is **Authoritative COMMAND State** visible before a developer relies on the comparison.
- Treat projection differences as comparison evidence, not as COMMAND operations or severity.

### Local Injection

- Never edit Captured Item Update evidence in place. Create a separate Injection Draft from an immutable Injection Source or explicit source-free authoring entry.
- Current behavior contains one target-anchored Draft. Visible Evidence never joins that Draft automatically.
- Raw JSON is the primary editor. Keep Subscription instance, Session, item identity, Source, validation, target, and execution boundary protected outside the editable document.
- Keep Compare Source optional. Side-by-side Source/Draft comparison uses one synchronized scroll; narrower layouts use inline comparison.
- Review and inject one focused Draft. There is no direct injection keyboard shortcut.
- State that Local Injection delivers one Logical Update locally to current listeners and does not contact Lightstreamer Server.
- Successful Evidence is explicitly Local, advances only Local Effective COMMAND State, and leaves Observed Server COMMAND State unchanged.
- Invalid and stale Drafts say that no Injection was attempted. Failed or uncertain outcomes state only what Workbench can prove and preserve safe recovery.
- Never silently retarget, discard, repeat, or broaden a Local Injection.

## Destructive and consequential actions

- Prefer Undo over confirmation when recovery is reliable.
- Require inline confirmation when an action permanently loses session Evidence, discards an edited Injection Draft, or cannot be safely reconstructed.
- Use a dedicated Review step instead of a generic confirmation modal for Local Injection. Show exact target, Source/Draft state, Local-only boundary, and expected delivery scope.
- Name the verb, object, and scope, such as `Discard draft` or `Clear 12,482 retained events`.
- Separate destructive actions from routine controls. Never make them icon-only, default-focused, or directly executable through a keyboard shortcut.
- Keep the reason beside a disabled consequential action. Confirmation cannot make an invalid or stale target safe.
- Require explicit retargeting when a target retires or becomes incompatible.

## Permanent-surface and shared-component gate

A new permanent surface is justified only when all of the following are true:

1. it serves a recurring, accepted developer journey;
2. it owns independent, persistent state or scroll that cannot remain useful in Scope, Evidence, Context, or a promoted document;
3. contextual disclosure would materially obstruct the journey rather than merely require one deliberate interaction;
4. compact, normal, and relevant shallow/wide scenarios demonstrate useful fit, reachability, restoration, and keyboard behavior;
5. the primary maintainer explicitly approves the new workspace responsibility.

Otherwise use Context, a contextual action or menu, a bounded transient, or a temporary promoted document.

Add a reusable shared component only after the same semantic and interaction contract appears in at least two accepted workflows. A focused module may still own one workflow; it does not enter a generic component library until reuse is proven. Shared components do not invent new semantics or override the composite keyboard, density, visual, and restoration rules above.

## UI change classes

Classify every change in its pull request or internal Project ticket. When multiple classes apply, use the highest class. The primary maintainer resolves uncertainty.

### 1. Non-UI

Use for documentation, internal refactoring, tests, build changes, or other work with no browser-visible behavior or presentation change.

Required evidence:

- review affected links, commands, and claims;
- run the tests and static checks capable of detecting the changed behavior;
- state why no UI scenario or screenshot is affected.

A refactor that changes rendered DOM, accessible state, timing, focus, geometry, or user-visible output is not Non-UI.

### 2. Bounded UI

Use for copy, styling, or a behavior correction that remains entirely inside an accepted surface, interaction, and semantic pattern. It cannot introduce a new control, workflow, permanent surface, keyboard contract, provenance meaning, consequential action, or baseline update.

Required evidence:

- first add or update a failing user-facing test at the lowest capable seam;
- use a deterministic affected scenario;
- exercise the relevant compact and normal geometry when text, reachability, or layout can change;
- inspect affected screenshots in the representative theme, and exercise both Dark and Light when a visual token or semantic treatment changes;
- record keyboard/focus and accessibility checks relevant to the changed control or state;
- run `npm run typecheck`, `npm test`, `npm run test:ui`, and `npm run build`;
- run `npm run test:ui:extension` or the appropriate `fixture:*` proof when the shipped DevTools or inspected-page boundary is affected.

### 3. Material UI

Use for any new control or workflow; workspace, layout, navigation, visual hierarchy, keyboard, focus, selection, semantic, provenance, Local Injection, destructive-action, Export, Ordered Evidence, Scope/Topology, COMMAND projection, or accessibility change; a permanent-surface/shared-component decision; or any visual-baseline creation or update.

Material UI requires all Bounded UI evidence plus:

- deterministic primary, empty/degraded, failure, and high-volume scenarios relevant to the changed journey;
- compact and normal geometry plus relevant shallow and wide geometry;
- representative Dark and Light themes, with forced-colors/non-color inspection when semantic presentation changes;
- keyboard traversal, focus restoration/visibility, accessible names/states, and axe serious/critical results;
- base, changed, and diff artifacts for every affected visual baseline, with an explanation for intentional updates;
- an independent visual-QA packet and recorded outcome under [Independent visual QA](agents/ui-visual-qa.md);
- explicit maintainer approval.

Automated checks, an updated baseline, or implementation rationale alone cannot satisfy Material UI review.

## Review record

The pull request or internal Project ticket records:

- change class and affected developer journey;
- acceptance criteria and changed workflows;
- deterministic scenarios, viewport sizes, and themes;
- exact commands and browser/extension/fixture tests run;
- inspected screenshot and diff artifacts;
- accessibility and keyboard/focus results;
- independent visual-QA findings and outcome when required;
- intentional baseline changes;
- any standard exception or amendment.

Private production Capture data is never required. Use deterministic local fixtures and redact application-controlled values from shared artifacts.

## Exceptions and amendments

There are no silent or permanent waivers.

An exception record identifies:

- the exact rule being bypassed;
- affected workflow and scope;
- reason and alternatives considered;
- verification evidence still collected;
- approving maintainer;
- removal or revisit trigger and follow-up owner.

An exception applies to one change. If the same exception is requested a second time, amend the standard through explicit maintainer approval instead of accumulating local deviations.

An emergency fix may land with reduced evidence only when the omitted checks, risk, follow-up owner, and completion trigger are recorded. Emergency status does not waive domain, privacy, permission, Capture-observational, provenance, or Local Injection safety boundaries.

Update this standard and every directly affected contract in the same focused change. Do not edit a prototype to imply that an accepted product rule changed.

## Vocabulary resolution

UI change class, permanent surface, shared component, visual-QA packet, exception, and amendment are product-process language rather than Lightstreamer domain concepts. No `CONTEXT.md` change is required. Existing Capture, Evidence, Injection, Injection Source, Injection Draft, Injection Outcome, Local Injection Target, Server Update, Injected Update, and COMMAND projection language remains authoritative.

## Acceptance record

The product owner explicitly approved, one decision at a time:

1. this file as the normative entry point, owned by the primary maintainer;
2. the permanent-surface and shared-component gate;
3. Non-UI, Bounded UI, and Material UI change classes with proportional evidence;
4. the scoped exception and amendment process;
5. the destructive and consequential action contract;
6. this complete policy as the shared understanding for future Workbench UI changes.
