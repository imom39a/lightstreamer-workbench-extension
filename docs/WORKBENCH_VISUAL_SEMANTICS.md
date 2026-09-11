# Workbench Visual Semantics

Status: accepted product direction, amended 2026-08-29

This document records the selected visual language for status, provenance, diagnostics, COMMAND evidence, and Local Injection outcomes in the Lightstreamer Workbench Chrome DevTools panel. It refines the accepted [Scoped Evidence Workspace](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md), [Elastic Triad layout](WORKBENCH_PANEL_DENSITY_AND_DOCKED_LAYOUT.md), and [Roving Instrument interaction model](WORKBENCH_KEYBOARD_AND_OPERATION_MODEL.md). The production panel implements this model; the [UI Standard](WORKBENCH_UI_STANDARD.md) and later accepted amendments govern any differences.

## Decision

Adopt **A — Plain Ledger**.

Workbench communicates meaning through explicit text, stable placement, compact rows, and persistent evidence. Color, iconography, and shape may reinforce a material condition, but they never carry provenance, protocol operation, lifecycle, or outcome meaning alone.

This is an evidence language for an expert developer tool, not a decorative brand system. Ordinary states stay quiet. A developer should be able to answer what happened, where it came from, what Workbench observed, what Workbench inferred, and what action remains safe without learning a private symbol vocabulary.

Plain Ledger accepts one deliberate cost: repeated text is visually flatter and can scan more slowly than a dense icon rail. Precision, accessibility, forced-colors reliability, compact maintenance, and resistance to semantic drift outweigh that cost.

## Encoding order

Every material distinction uses these channels in order:

1. **Text:** the canonical state or provenance is named at the decision boundary.
2. **Placement:** stable columns, property rows, headings, and persistent outcome regions make repeated meaning predictable.
3. **Typography:** weight and monospace treatment distinguish labels, protocol values, identities, and evidence without changing their meaning.
4. **Shape:** a limited marker such as `!`, `×`, a leading selection bar, or focus outline reinforces an already-named condition.
5. **Color:** a supplemental emphasis for focus, selection, information, warning, error, or a confirmed operation outcome.

No material distinction may require memorizing an icon, hue, lane position, border style, or animation. Tooltips may explain controls, but they are not the sole carrier of semantic state.

## Independent semantic axes

Combining independent axes is a correctness defect. The following contracts apply everywhere:

| Axis | Required text | Permitted reinforcement | Forbidden shortcut |
|---|---|---|---|
| Capture operation | `Capture RUNNING`, `IDLE`, or `STOPPED` | Quiet weight or active indicator | Green meaning “everything is complete” |
| Observation coverage | `Coverage USEFUL`, `LIMITED`, or `UNAVAILABLE`, plus reason when limited | `!`, warning treatment | Folding coverage into Capture operation |
| Evidence view | `View FOLLOW LIVE` or `FROZEN`, with newer count | Stable operating-strip position | Treating Frozen as stopped Capture |
| Runtime lifecycle | Connected, recovering, stalled, disconnected, active, inactive, retired, or unknown | Information/warning marker when interpretation is affected | Using provenance color as lifecycle |
| Provenance | `SERVER`, `LOCAL`, `RUNTIME`, or `WORKBENCH` | Compact stream annotation with exact Source in Context and accessible labels | Color-only provenance or Local-as-success |
| Phase | `SNAPSHOT`, `LIVE`, `END OF SNAPSHOT`, or `UNKNOWN` | Snapshot annotation with exact Phase in Context and accessible labels | Inferring phase from provenance |
| COMMAND operation | `ADD`, `UPDATE`, or `DELETE` | Monospace or weight | Traffic-light severity colors |
| Diagnostic severity | `Information`, `Warning`, or `Error`, with consequence | `i`, `!`, or `×` and matching color | Applying severity to neutral protocol verbs |
| Injection readiness | `READY` or `BLOCKED`, with target and reason | Warning/error marker | Hiding the block behind a disabled button |
| Injection outcome | `NOT RUN`, `NO INJECTION ATTEMPTED`, `DELIVERED LOCALLY`, or a precise failure/unknown result | Persistent outcome row and appropriate outcome color | Toast-only success or implying business effect |
| Interaction | Hover, focus, selected, disabled, or busy | Fill, leading marker, independent outline | Reusing domain status styling |

`ADD`, `UPDATE`, and `DELETE` are neutral Lightstreamer operations. A `DELETE` is not an error, an `ADD` is not success, and an `UPDATE` is not warning. Existing production command-specific traffic-light colors are legacy presentation and do not define the accepted direction.

## Core token roles

The visual system needs a small set of semantic roles, not component-specific palettes:

- **Surfaces:** panel background, ordinary surface, raised header/control surface, border, and strong separator.
- **Text:** primary, muted, and subtle; code text uses the same semantic foreground roles.
- **Interaction:** focus outline, selection fill, selection leading marker, and hover fill. Focus and selection are separate roles.
- **Conditions:** information, warning, and error foreground/background pairs.
- **Outcome:** confirmed success foreground/background pair. Success is reserved for a proven operation boundary, never provenance or COMMAND operation.
- **Actions:** ordinary control and primary consequential action. Accent color does not imply domain success.

Do not add provenance colors, per-COMMAND colors, Snapshot colors, lifecycle rainbows, or application-identifier colors. The sole approved provenance-color amendment is the [integrated Activity timeline](WORKBENCH_INTEGRATED_ACTIVITY.md#narrow-provenance-amendment): neutral SERVER marks and purple outlined LOCAL diamonds, reinforced by visible text, accessible names and non-color shape. It does not apply to Evidence rows or other surfaces. If another color role is proposed, its meaning must remain valid for every component that uses it and must still be communicated without color.

## Operating strip

The persistent operating strip presents independent noun/value pairs in a stable order:

1. Capture operation;
2. observation coverage;
3. Evidence view position;
4. compact, labelled actions.

For example: `Capture RUNNING · Coverage LIMITED · View FROZEN · 2,418 newer`.

Coverage limitations name the affected observation and provide a nearby diagnostics route. Capture can continue while Coverage is limited and while the Evidence view is Frozen. The footer's compact History status communicates rolling retention and the active tier without a health verdict; it never truncates or replaces Capture, Coverage, or View. Storage fallback or retained-history pressure also appears as a named condition when it affects a developer decision, without changing Observation Coverage.

## Scope and runtime lifecycle

- Scope nodes use one stable priority block: object type and lifecycle share the first line, canonical runtime identity owns the primary line, and captured facts own the secondary line.
- Long identities visually truncate only after receiving their own line; the exact value remains programmatically available from the owning Scope row.
- Current, inactive, retired, and unknown objects remain distinguishable in text.
- A material limitation appears beside the affected object and expands into concise consequence and recovery guidance.
- Scope selection uses the generic interaction treatment; it never borrows Server, Local, warning, or success styling.
- High-cardinality COMMAND keys remain Evidence/filter identities rather than structural peers with individual status decorations.

## Ordered Evidence ledger

The 2026-09-11 amendment replaces the Order / Evidence / Command / Object layout with **Op / Key or item / Data**. Rows remain neutral chronological records with a fixed 30px rhythm. Op is the sole horizontally pinned column. Exact keys occupy one line, without wrapping or ellipsis; their full content and captured data share horizontal scrolling inside the ledger.

The historical codes distinguish TLCP notifications from Workbench capture lifecycle in the Codes reference. U always means Item Update; separate neutral command/snapshot/Local annotations qualify it. Exact provenance, command, time, sequence and identity remain in accessible labels and Context. Local is visibly marked and never treated as success. Newer event kinds have explicit Workbench meanings rather than fabricated wire tokens.

Readable data shows application field values and explicitly identifies decoded JSON strings. Raw fields preserves captured types. Large inline previews are marked as incomplete and full values remain in Context. Neither formatting nor syntax styling changes captured evidence. Selection and focus keep their independent established treatments. The panel shell never scrolls horizontally.

Use an em dash only for not applicable. Use the literal word `unknown` when Workbench cannot determine a value, and name `unavailable`, `redacted`, or `inferred` where those are the actual evidence conditions.

## Selection, focus, and passive Capture

- Selection uses a quiet fill plus a leading marker.
- Keyboard focus uses an independent visible outline.
- Selected-but-unfocused remains visibly selected without pretending to be focused.
- Hover is weaker than selection and never persists.
- Disabled and busy controls retain an accessible label; a blocking reason remains adjacent.
- Passive Capture does not flash rows, animate status continuously, or move focus, selection, Context, editor state, or a non-following scroll anchor.

## Context and diagnostics

Context expands concise ledger values into explicit property names. It answers Source, Phase, COMMAND operation, runtime lifecycle, object identity, changed fields, observation path, and evidence limitations without requiring the developer to decode row styling. Active operational and runtime-Scope conditions appear in the global footer until they end or their footer copy is dismissed. Notifications retains those active conditions alongside recurring Lightstreamer notices, keeping selected Evidence free of unrelated diagnostic text.

Diagnostics follow a stable grammar:

`<severity> · <condition>` followed by `<affected object or evidence>`, `<consequence>`, and one relevant inspection or recovery route.

- Information explains a limit or transition that does not require correction.
- Warning identifies evidence that may be incomplete, stale, or misleading without more inspection.
- Error identifies an invalid or failed condition that prevents the current action or proves an operation failure.
- Blocking is a consequence, not a replacement severity. Name both, such as `ERROR · Invalid JSON` and `Review blocked`.

Render each active operational or runtime-Scope condition once in the global footer with a labelled Dismiss action. This includes History and storage pressure, Capture and Coverage limits, canonical current-runtime recovery, retired or cleared Scope, failed History clear, and Activity aggregation failure. Dismiss only that active lifecycle's footer copy; keep its notification available until the condition ends, clear the dismissal when the condition resolves even while the footer is hidden, and surface a later recurrence again. At shallow geometry, keep the complete heading, affected identity, Dismiss action, and a **Diagnostic details** cue visible; place longer observation, consequence, recovery, and inspection copy inside that disclosure instead of clipping it. Render active Workbench conditions and recurring Lightstreamer diagnostics in Notifications as neutral separated entries, with severity text and the available inspection action or recovery instruction visible before optional Details. Information does not need a filled callout. Do not duplicate the same cause in Ordered Evidence or Context banners. Workflow-local validation, stale-target conditions, and Injection Outcomes remain at their own decision boundary.

## Raw evidence

Raw JSON syntax styling describes document structure only. Workbench semantics remain outside the JSON editor or viewer:

- evidence identity;
- `SERVER` or `LOCAL` provenance;
- Phase and observation path;
- immutable Source versus prospective Draft;
- validation and outcome.

Do not recolor raw keys or values to imply provenance, mutability, validity, or COMMAND meaning. Application-controlled field names and values never select semantic colors.

## COMMAND lifecycles

Present COMMAND behavior through ordered `ADD`, `UPDATE`, and `DELETE` Evidence, explicit key identity, Fields, snapshot/live phase, and relevant diagnostics. Keep each operation neutral: a lifecycle verb is not a success state or diagnostic severity.

Do not add a general reconstructed-state summary, matching/different marker, comparison document, or neutral doorway. Internal COMMAND state supports validation, Scenarios, Checkpoints, and diagnostic production without becoming a permanent visual surface or implying Authoritative COMMAND State.

## Local Injection

Local Injection preserves five explicit boundaries outside the raw JSON editor:

1. immutable Injection Source or newly authored state;
2. prospective Draft and `LOCAL ONLY` boundary;
3. exact Local Injection Target and current runtime lifecycle;
4. draft validation/readiness;
5. persistent Injection Outcome.

Invalid JSON and stale or retired targets say `NO INJECTION ATTEMPTED`; they do not manufacture a failed execution. A delivered result says `DELIVERED LOCALLY` and identifies the Workbench delivery boundary and related Injected Update evidence. It does not claim an application or business effect. A failed result names the boundary that failed, preserves the Draft, and does not create successful Injected Update evidence.

Outcome evidence remains in the document or resulting Evidence trace. A disappearing toast is insufficient. Consequential actions remain labelled and target-anchored; color never makes an Inject action appear safe.

## Empty, degraded, and high-volume states

- Empty Evidence names the current Scope and whether Capture and Coverage remain useful. It offers only relevant recovery, such as changing Scope or clearing a Filter.
- Degraded Capture names the observation limit, affected evidence, and consequence. It never implies that ordinary captured evidence is Local or invalid.
- High-volume Evidence preserves stable columns or compact row grammar, virtualization, order, retained/shown counts, Live/Frozen state, and newer matching count.
- Snapshot boundaries and Local Injection traces remain ordinary chronological Evidence. Plain Ledger does not introduce universal sequence cards or investigation groupings.

## Theme, contrast, and forced colors

Dark, Light, Follow DevTools, zoom, grayscale, and forced-colors modes preserve the same semantic text, ordering, and geometry.

- Ordinary text targets at least `4.5:1` contrast against its surface.
- Large text and non-text component boundaries or state indicators target at least `3:1`.
- Focus indicators target at least `3:1` against adjacent colors and remain visible in forced colors.
- Muted text remains readable; lowering contrast cannot be the only way to convey disabled, retired, historical, or unavailable state.
- Information, warning, error, success, Server, and Local meanings remain recoverable with color removed.
- Motion is unnecessary for ordinary semantic communication and respects reduced-motion preferences when used for a bounded transition.

These rules follow the repository's accepted [WCAG 2.2 AA baseline](research/chrome-devtools-interaction-conventions.md) and Chrome DevTools interaction conventions.

## Rejected alternatives

### B — Signal Rail

Rejected. A fixed provenance/phase/COMMAND/lifecycle/diagnostic/outcome gutter improves experienced scanning, but consumes permanent width and creates a private vocabulary that every contributor must maintain. The former 2026-08-29 Order rail was superseded by the 2026-09-11 Op/key/data amendment; historical codes use the explicit Codes reference.

### C — Evidence Blocks

Rejected as the earlier variable-row universal ledger grammar. The approved 2026-09-11 Evidence stream keeps one fixed 30px rhythm and ordinary chronological rows; it does not create grouped sequence boundaries or another investigation taxonomy.

## Verification evidence

The disposable [workbench-ui-08 prototype](../prototypes/workbench-ui-08/README.md) provides the selected Plain Ledger and the two rejected contrasts over one deterministic Lightstreamer scenario. The later [workbench-ui-12 prototype](../prototypes/workbench-ui-12/README.md) records the maintainer-approved Scope priority blocks and Order rail amendment. Browser review covered populated and long-identity Scope, ordered Evidence, mixed Server and Local Evidence, degraded Capture, Frozen high volume, immutable raw Server evidence, empty Scope, and ready, invalid, stale-target, delivered, and failed Local Injection states.

The selected model and contrasts were exercised at compact `563×700`, normal `900×700`, shallow `900×320`, and wide `1440×900` geometries in representative Dark and Light themes. Checks covered shell and pane overflow, textual provenance, non-color meaning, persistent Injection outcomes, keyboard isolation, and browser console errors. Type checking, extension build, JavaScript syntax checking, and whitespace validation passed. No production panel behavior changed.

## Vocabulary resolution

Plain Ledger is presentation language rather than a new Lightstreamer domain concept. This decision uses the existing Capture, Injection Source, Injection Draft, Injection Outcome, Local Injection Target, Server Update, Injected Update, and internal COMMAND-state vocabulary. No `CONTEXT.md` change is required.
