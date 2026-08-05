# React Slice 1 visual-QA packet

Status: **final independent review ACCEPTED; historical pre-repair review BLOCKED**

## Acceptance and change class

React Slice 1 is a **Material UI** migration to the accepted Scoped Evidence
Workspace. The accepted design reference is the integrated Diagnose journey in
[`prototypes/workbench-ui-10`](../../prototypes/workbench-ui-10/README.md).
The change covers ordered Evidence, Scope, Context, COMMAND projections,
Elastic Triad geometry, Roving Instrument keyboard behavior, and Dark, Light,
and Auto theme operation.

The renderer theme repair in this packet keeps the existing Theme preference
truthful while applying an effective theme separately: persisted Dark or Light
is restored, Auto follows the live Chrome DevTools theme, and the effective
theme is exposed on the renderer and document roots. Theme listeners are
disposed with the renderer.

## Reproducible image artifacts

Generate the complete four-case packet from a clean ignored output directory:

```text
node scripts/generate-react-slice1-visual-evidence.mjs
```

The command starts the accepted prototype and deterministic React scenario
servers, captures the Workbench element at equal dimensions, and writes:

```text
test-results/react-slice1-visual-qa/manifest.json
test-results/react-slice1-visual-qa/base/<scenario>.png
test-results/react-slice1-visual-qa/changed/<scenario>.png
test-results/react-slice1-visual-qa/diff/<scenario>.png
```

`base` is a fresh deterministic capture from accepted integrated prototype
variant A. `changed` is the current deterministic React implementation. `diff`
is the absolute per-channel pixel delta between equal-size images. These diffs
are inspectable design-reference deltas, not pixel-parity acceptance gates: the
prototype and Slice 1 use intentionally different fixture identities, retained
counts, disclosure, and implementation geometry.

The generated manifest records Chrome version, source disposition, exact paths,
pixel counts, and duration. The matrix contract can be inspected without
starting browsers:

```text
node scripts/generate-react-slice1-visual-evidence.mjs --print-matrix
```

## Four-case matrix and disposition

| Artifact | Viewport | Theme | Accepted base | React changed | Disposition |
| --- | ---: | --- | --- | --- | --- |
| `normal-selected-dark` | 900×700 | Dark | Diagnose / selected Evidence / Normal | `live-selected` | Comparable journey and decision boundary. Fixture names, counts, row density, and Context composition intentionally differ; inspect hierarchy and reachability, not pixel parity. |
| `compact-selected-light` | 563×700 | Light | Diagnose / selected Evidence / Compact | `live-selected` | Comparable compact Evidence journey. React parks Context behind the labelled `Open Context` route; that accepted disclosure difference is not a regression. |
| `shallow-frozen-dark` | 900×320 | Dark | Diagnose / Frozen high volume / Shallow | `frozen-high-volume` | Comparable Frozen/high-volume state. Inspect Capture/Coverage/View orientation, selected Evidence, Context reachability, and single-pane scrolling. |
| `wide-command-dark` | 1440×900 | Dark | Diagnose / promoted COMMAND comparison / Wide | `live-selected` with both COMMAND projections in Context | **Reference only.** Slice 1 intentionally keeps both named projections in Context instead of claiming parity with the prototype's promoted document. |

For every row, inspect the same-named PNG in all three `base`, `changed`, and
`diff` directories. No committed visual baseline was replaced by this command;
the artifacts remain ignored review evidence.

## Browser, accessibility, and keyboard evidence

The deterministic React browser suite is run with:

```text
CI=1 npx playwright test -c tests/ui/react.playwright.config.ts --timeout=10000
```

It covers normal, shallow, compact, and wide geometry; Dark and Light themes;
forced-colors selection; selected Local Evidence; active Capture without a
selection; limited Coverage; in-memory fallback; historical Scope; Session
recovery; empty/filter states; high-volume retained-window navigation; Scope
and Evidence roving focus; Find and staged Escape; Context focus restoration;
splitter keyboard/pointer behavior; scoped Export; and axe serious/critical
results. Playwright attachments live under `test-results/react-diagnose`.

The integrated verification commands are:

```text
npm run typecheck
npm test
npm run test:ui:react
npm run build:react
node scripts/generate-react-slice1-visual-evidence.mjs
npm run test:ui:extension
npm run test:ui:extension:react
npm run fixture:test:react
npm run measure:react-panel
```

Latest integrated results:

- typecheck: passed;
- unit suite: 488/488 passed;
- React browser matrix: 21/21 passed with no browser diagnostics and no serious
  or critical axe findings;
- React-only production build and renderer isolation audit: passed;
- visual-evidence runner: 4/4 base/changed/diff scenario packets regenerated;
- React extension smoke: passed;
- official-client React fixture: 1/1 passed;
- performance gate: passed — cold semantic control 101.9 ms mean / 107.0 ms
  p95, maximum panel task 0 ms, visible Evidence refresh gap 12.9 ms maximum /
  9.7 ms p95, and non-monotonic retained heap across the lifecycle window;
- React panel JavaScript: 361,976 bytes raw; packaged React ZIP: 473,866 bytes.

## Independent-review record

The independent review performed before this evidence repair is recorded as
**BLOCKED**. At that point the packet contained current screenshots only, had
no generated base/changed/diff images, and described the prototype as a base
without providing inspectable pairings or truthful artifact-level
dispositions. The renderer also did not connect the existing theme manager, so
Auto could not be verified against the Chrome DevTools theme boundary.

That historical result remains part of the record and is not retroactively
rewritten. The third independent review inspected the corrected four-case base,
changed, and diff packet together with the browser, accessibility, keyboard,
extension, fixture, and performance evidence and returned **ACCEPTED**. It found
no material P0 or P1 findings and verified all five final repairs:

1. loading and zero-Evidence states expose no stale Evidence rows;
2. compact, normal, shallow, and wide thresholds keep Scope, Evidence, and
   Context non-starving;
3. forced-colors presentation keeps focus and selection visibly separate;
4. runtime lifecycle text uses the canonical lifecycle vocabulary; and
5. repeated keyboard operation at retained-Evidence boundaries preserves
   visible, deterministic focus.

This acceptance closes the independent visual-QA gate for React Slice 1.
