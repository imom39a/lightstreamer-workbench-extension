# React Slice 2 visual-QA packet

Status: **final independent review ACCEPTED; historical pre-repair review
BLOCKED**

## Acceptance and change class

React Slice 2 is a **Material UI** addition to the accepted Scoped Evidence
Workspace. It adds the single-event Local Injection journey defined by the
[Workbench UI migration plan](../WORKBENCH_UI_MIGRATION_PLAN.md) and the
accepted [Local Injection interaction model](../../prototypes/workbench-ui-05/COMPARISON.md).

The affected workflow begins from either one compatible selected Captured Item
Update or one live applicable COMMAND Item Scope. It promotes one protected
Injection Draft to the canvas, provides a lazy CodeMirror JSON editor and
optional immutable Source comparison, requires a dedicated read-only Review,
executes through the inspected client's existing local listener path, and
retains a truthful outcome. The UI continues to distinguish Observed Server
COMMAND State from Local Effective COMMAND State.

The accepted scope remains deliberately single-event. This packet does not
accept multi-event selection, Draft Sets, batch ordering or execution, Replay,
Server Injection, automatic retargeting, or automatic retry.

## Reproducible image artifacts

Run the deterministic React browser packet with:

```text
npm run test:ui:react
```

Each scenario attaches a current full-page screenshot and its axe result to the
Playwright HTML report:

```text
test-results/react-diagnose-report/index.html
test-results/react-diagnose/
```

These ignored artifacts are current implementation evidence. Slice 2
introduces a new React Local Injection surface, so this packet does not claim a
pixel-parity baseline against the legacy renderer. Review is against the
accepted interaction model, UI standard, and deterministic scenario states.
No committed visual baseline was replaced.

## Scenario matrix and disposition

The complete React matrix contains 29/29 passing scenarios. Twenty-one retain
the accepted Slice 1 Diagnose coverage; the eight Local Injection cases below
exercise the new journey and its material variants.

| Scenario | Viewport and theme | State under review | Disposition |
| --- | --- | --- | --- |
| Captured Draft | 1440×900 Dark, then 900×700 | Selected captured Source, protected target, lazy editor, immutable comparison, shared scroll, document-local Find, Tab behavior | Passed; the editor remains visually dominant and the Local-only boundary stays persistent. |
| Authored COMMAND Draft | 900×700 Light, then 563×700 | Source-free authoring, validation, Review/Back, minimize/expand, park/resume, discard confirmation | Passed; compact disclosure preserves target identity and a deliberate return path. |
| Invalid and corrected Draft | 900×700 | Duplicate JSON key, syntax failure, COMMAND semantic failure, corrected ready state | Passed; blocking diagnostics remain inline and Review stays unavailable until correction. |
| Large captured Draft | 1440×900 Light, then 900×700 | 500 fields, collapsed unchanged comparison regions, folding, search, selection, undo, geometry changes, minimize and park | Passed; editor state and shared-scroll position remain stable. |
| Retired target | 900×700 Light and Dark | Retirement before Review and passive retirement after Review | Passed; the document demotes to blocked edit state, Review is disabled, and execution is not attempted. |
| Pending acknowledgement | 563×700 Light | One execution in flight, no repeat or automatic retry, destructive and park controls disabled | Passed; the pending boundary remains explicit at compact geometry. |
| Conflicting entry | 563×700 Light | Protected current Draft, deliberate keep/discard, replacement Draft | Passed; no silent replacement occurs and the new Draft receives fresh focus and scroll state. |
| Durable outcomes | 900×700 Dark and Light | Delivered, failed, partial-listener failure, and acknowledgement-unknown outcomes | Passed; claims and counts match the evidence available for each outcome. |

The retained Slice 1 scenarios continue to cover compact, normal, shallow, and
wide geometry; Dark and Light themes; forced colors; active and Frozen Capture;
empty, filtered, limited, disconnected, recovery, and retired states; roving
Evidence and Scope focus; splitters; raw Evidence; export; and distinct COMMAND
projections.

## Browser, accessibility, focus, and keyboard evidence

The deterministic browser suite completed **29/29** with no browser console,
page, or unhandled runtime diagnostics. Every scenario runs axe and reported no
serious or critical violations.

The Local Injection coverage verifies:

- accessible names for both entry actions, the promoted Draft region, mutable
  JSON editor, immutable Source editor, comparison action, Review region, and
  final local execution action;
- visible textual Target, Session, Source, Local-only, readiness, pending, and
  outcome boundaries without relying on color;
- forced-colors editor focus indication and a distinct textual Local-only
  boundary;
- semantic focus transitions from entry to editor, edit to Review heading,
  Back to the editor's preserved selection, minimize to Expand, expand to the
  prior Draft target, park to Resume, resume to the prior target, and discard
  confirmation to its triggering control after Escape;
- restoration to selected Evidence or the appropriate Scope control after a
  confirmed discard or Finish, plus fresh focus for a replacement Draft;
- no focus trap in the promoted document or discard confirmation;
- CodeMirror search, folding, syntax highlighting, lint ranges, and undo;
- default Tab navigation plus the explicit `Tab inserts indentation` option;
- document-local Cmd/Ctrl+F: CodeMirror Find opens without opening ordered
  Evidence Find, and already-handled shortcuts remain handled;
- preservation of cursor/selection, fold state, undo history, and outer scroll
  position across compare, responsive geometry, minimize/expand, and
  park/resume;
- immutable Source and Injection Draft comparison with collapsed unchanged
  regions and exactly one shared outer scroll owner. CodeMirror's inner
  scrollers remain non-owning, so Source and Draft stay synchronized through
  the shared document scroll.

## Extension and official-client evidence

The React extension smoke completed successfully:

```text
npm run test:ui:extension:react
```

The real unpacked-extension fixture against the official Lightstreamer Web
Client completed **1/1**:

```text
npm run fixture:test:react
```

That fixture proves both public entry paths through the production extension
boundary. A captured Source delivers one Logical Update and advances the
deterministic listener-observed count from 1 to 2; an authored COMMAND update
advances it from 2 to 3. It verifies two marked `LOCAL` Evidence rows,
unchanged Observed Server COMMAND State, and advanced Local Effective COMMAND
State.

Chrome DevTools Protocol `scriptParsed` evidence also proves that the
CodeMirror lazy chunk is absent before the editor opens and present after it
opens. Manifest V3 extension-page CSP accepts the bundle, with zero console,
runtime, unhandled-rejection, or CSP errors.

## Integrated checks and bundle boundary

The recorded integrated commands are:

```text
npm run typecheck
npm test
npm run test:ui:react
npm run build:react
npm run test:ui:extension:react
npm run fixture:test:react
```

Latest recorded results:

- typecheck: passed;
- unit suite: 533/533 passed across 40 files;
- deterministic React browser matrix: 29/29 passed;
- React-only production build and renderer-isolation audit: passed;
- React extension smoke: passed;
- official-client React fixture: 1/1 passed.

The React production build measured:

| Chunk | Raw | Gzip | Disposition |
| --- | ---: | ---: | --- |
| Initial panel `extension/panel/index.js` | 396.89 kB | 118.20 kB | Contains the dynamic import only; no `@codemirror`, `.cm-editor`, or `EditorView` markers. |
| Lazy `assets/local-injection-document.js` | 401.57 kB | 130.42 kB | Contains the modular CodeMirror editor, JSON language, lint, search, and merge implementation. |
| Shared `assets/messages.js` | 10.10 kB | 3.07 kB | Shared renderer-neutral message/runtime code. |

The editor and merge implementation therefore remain outside the initial panel
chunk and load only when a Draft document opens. No remote code, `eval`,
runtime JSX compilation, or relaxed extension-page CSP is required.

## Planner and independent-review record

Planner visual inspection is recorded as **ACCEPTED for design/readability
after the focus/Find repairs**. The inspected deterministic screenshots showed
a coherent full-canvas Draft hierarchy, readable Dark and Light editor states,
persistent protected identity and Local-only boundaries, useful editor size,
clear validation and outcome treatment, and compact controls that remained
reachable without creating a second permanent navigation rail.

The earlier independent Slice 2 review was **BLOCKED** on five material
categories. Each was repaired at its owning boundary:

1. The captured Source listener was incorrectly treated as target-dependent.
   It is now provenance only; the delivery target is the exact current
   Subscription `onItemUpdate` listener set.
2. A zero-delivery `success` acknowledgement was accepted. Counted success now
   requires `attempted > 0`, `delivered === attempted`, and `failed === 0`; any
   other count shape creates no synthetic Evidence.
3. Editor Cmd/Ctrl+F leaked into ordered Evidence Find. The shortcut now stays
   local to CodeMirror and the panel respects `defaultPrevented` events.
4. Promoted-document focus and discard restoration were incomplete. Semantic
   focus now covers entry, Review, Back, minimize, park, discard, Finish, and
   conflict replacement while retaining editor cursor, selection, fold,
   scroll, and undo state.
5. Passive listener retirement or churn could leave a stale Draft marked
   ready. Validation now refreshes immediately, demotes Review to blocked edit
   state when necessary, and fingerprints the exact active delivery set. The
   final follow-up restricts that set to active `onItemUpdate` listeners and
   excludes lifecycle-only listeners.

The final independent re-review inspected the repaired behavior and evidence
packet and returned **ACCEPTED**. It reported no remaining material P0 or P1
findings. This closes the independent visual/interaction QA gate for React
Slice 2; it does not change the separate Store cutover boundary below.

## Store-build and fallback boundary

Slice 2 remains an isolated React development and CI artifact. The normal
Chrome Web Store build still resolves the **legacy renderer** and does not ship
this partial migration. The Store build changes directly to the accepted React
renderer only in Slice 3, followed by removal of the legacy renderer and
temporary build compatibility machinery.

Until that cutover, fallback is to keep the verified legacy Store artifact and
either repair or revert the isolated React Slice 2 work. A partial Local
Injection workflow must not be exposed through the Store build.
