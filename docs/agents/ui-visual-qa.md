# Independent visual QA

Independent visual QA is required for Material UI changes under the
[`Workbench UI Standard`](../WORKBENCH_UI_STANDARD.md). The
reviewer receives only the acceptance criteria, the base and changed
screenshots, the visual diffs, the tested viewport/theme matrix, and the
browser/a11y results. The implementation rationale is intentionally omitted
so the review checks the user-visible result rather than confirming the
author's explanation.

## Review packet

Create a packet from deterministic local scenarios containing:

- source acceptance criteria and changed workflows;
- base, changed, and diff images for every affected visual state;
- compact, normal, and wide viewport sizes plus representative Dark and Light
  themes;
- browser test output, axe serious/critical results, and keyboard/focus notes;
- the exact command used to produce the artifacts and whether a baseline was
  intentionally changed.

The maintained packet command is `npm run test:ui:visual`. It writes
`test-results/workbench-visual-qa/reference/`, `current/`, `diff/`,
`contact-sheets/`, and a manifest that identifies the accepted prototype
state, production scenario, viewport, theme, pixel-delta summary, and contact
sheet paths. The visual diff is an inspectable reference delta, not a parity
threshold: compare hierarchy, reachability, protected Local Injection
boundaries, and semantic meaning against the accepted prototype and UI
standard. The affected Material UI scenarios are also arranged in labeled
reference/current/diff contact sheets so an independent reviewer can inspect
the compact focused confirmation, normal focused confirmation, and compact
memory-fallback states without opening each artifact separately.

The reviewer checks clipping, reachability, discoverability, accessible names
and state labels, visual hierarchy, empty states, high-volume states, offline
Export behavior, keyboard traversal, and focus visibility. Passing automated
tests or updating a baseline is not sufficient. A material finding blocks
readiness until fixed or explicitly accepted as an intentional design
decision. Record the findings and outcome in the pull request or the related
Project ticket.

## This batch

The workbench-repair-01 through workbench-repair-05 batch used
`tests/ui/visual-matrix.json`. `npm run test:ui:visual` generated and the
independent reviewer inspected all 12 reference, current, and diff artifacts:

- Evidence density — Dark, 900×700;
- captured Local Injection Draft — Light, 563×700;
- authored Local Injection Review — Dark, 900×320;
- promoted COMMAND projection comparison — Light, 1440×900.

The reviewer also inspected all eight maintained Darwin and pinned-Linux
Playwright baselines for those states. The first review blocked the batch
because the shallow Review body was clipped and the keyboard proof did not
make every protected line readable. The layout was repaired to keep the
five protected boundary groups shallow, and the regression now uses physical
ArrowDown input while asserting that scrolling changed, the local-only line
is unobscured, and no Review paragraph is partially clipped. A later browser
diagnostic found a missing favicon request; the shipped panel now declares its
title icon and the extension fixture asserts the successful resource load.

The final independent follow-up passed the corrected 12-artifact packet and
eight platform baselines. It found no clipped or overlapping operation, hidden
focus target, illegible protected value, unexplained blank panel region, or
loss of distinction between Observed Server COMMAND State and Local Effective
COMMAND State. Local and pinned-Linux `npm run test:ui` each passed all 39
checks with no serious or critical axe findings, and the baseline hashes were
unchanged by normal verification. Future material changes must attach the
prior images and actual diffs using the same packet format.

Exact commands used for this batch:

```text
npm run test:ui:update
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update'
npm run test:ui
npm run test:ui:visual
npm run test:ui:extension
npm run fixture:test:browser
```

## Field UX batch

The `field-ux-01` through `field-ux-05` batch extended the maintained matrix
to eight deterministic states. In addition to the four states above, the
packet includes:

- complete retained-Evidence Find — Dark, 900×700;
- 4,000 long-identity Evidence events — Light, 563×700;
- reversible More actions — Dark, 900×320;
- matching ordinary COMMAND projection summary — Light, 1440×900.

`npm run test:ui:visual` produced 24 reference, current, and diff artifacts.
The committed visual gate contains 16 separately generated Darwin and pinned-
Linux baselines. The first read-only visual comparison failed as expected:
the four existing images reflected the intentional control-hierarchy and
Context changes, and the four new field-UX states had no baseline. Deliberate
platform-specific updates were then generated with `npm run test:ui:update`
locally and in the pinned Playwright container. Normal comparison runs passed
all 47 checks on both platforms. A final contributor-attribution correction
deliberately removed the unsupported Reveal Evidence action from the matching
comparison baseline; that single Darwin/Linux baseline pair was regenerated
through the gated update commands and then passed normal comparison.

An independent reviewer inspected every packet image, the manifest, and all
16 platform baselines. The review passed with no material findings: retained
Find remained bounded and legible, long identities truncated only in the
ledger while their exact values remained visible in Context, Find and Filter
retained a clear operating hierarchy, matching and divergent COMMAND
projection meanings remained distinct and non-authoritative without duplicate
tables, and More actions stayed compact with a visible return route and a
separated destructive Clear operation. The reviewer found no clipping,
overlap, horizontal shell overflow, hidden focus target, contrast problem, or
platform-specific regression.

The shipped DevTools-panel smoke passed, and the official Lightstreamer-client
fixture passed its complete captured and source-free Local Injection journey in
both 900×700 normal and 563×700 compact panel geometries. The release package
audit also passed within the one-megabyte ZIP budget.

Exact visual commands used for this batch:

```text
CI=1 npm run test:ui -- --grep "visual baseline"
CI=1 npm run test:ui:update
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update'
CI=1 npm run test:ui
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui'
npm run test:ui:visual
```

## Stream UX batch

The `stream-ux-01` through `stream-ux-04` batch retained the eight prior
matrix states, changed the compact captured-Draft state to exercise an encoded
JSON-string source, and added a ninth wide selected-JSON state. The resulting
packet contains 27 reference, current, and diff images, with 18 separately
generated Darwin and pinned-Linux baselines.

Five existing baseline pairs changed intentionally: the Evidence ledger now
shows `COMMAND key` instead of `Change`, selected Item Update data precedes the
existing Context metadata and concise COMMAND projection summary, and the
compact captured Draft now shows a structured JSON-string field. The new wide
state proves the `JSON string` marker, wrapped structured payload, exact key,
and single Context scroll boundary together.

Local and pinned-Linux read-only Playwright runs each passed the full browser suite.
The asserted browser coverage includes a 220-subscription live Scope, 4,000
long-identity Evidence events, compact/normal/wide selected-data restoration,
passive high-volume growth plus a leading-insertion topology reorder at normal
and wide geometry without displaced selection, off-window Scope focus, or
scroll position, exact/long/missing COMMAND keys across compact/normal/wide,
Filter-hidden selected Fields/Changed fields/JSON patches,
physical PageDown/PageUp, wheel, and caret-driven movement in the Local
Injection editor, one shared editor scroll owner, and no serious or critical
axe findings. The shipped extension smoke, release package, docs check, and
official-client fixture passed; the latter proved captured encoded JSON round
trips as a string through direct wire, message-channel fallback, and listener
fallback delivery.

An independent reviewer inspected all packet images and platform baselines
and passed the batch with no material findings. The reviewer found no blank
Scope band, clipping, overlap, hidden focus state, lost projection meaning, or
platform-specific layout regression.

Exact visual commands used for this batch:

```text
CI=1 npm run test:ui:update
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update'
CI=1 npm run test:ui
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui'
npm run test:ui:visual
npm run test:ui:extension
npm run fixture:test:browser
npm run release:package
npm run docs:check
```

## Readability UX batch

The `readability-ui-01` batch adds the approved `workbench-ui-12` Variant C
Scope priority blocks and Ordered Evidence reading order to the maintained
matrix. The Scope row now presents type and lifecycle first, identity on its
own primary line, and facts second; compact pressure may visually truncate the
identity because the exact value remains available from the owning tree item.
Evidence now separates the authoritative retained History sequence from exact
Evidence identity, then presents semantic meaning, timestamp/provenance/phase,
COMMAND operation, object, and key. The same batch keeps a shallow mixed-size
diagnostic complete and dismissible without obscuring the remaining Evidence
row.

The final packet contains 82 reference/current/diff scenario captures,
including approved normal and compact Variant C references and affected
contact sheets. It reported zero browser diagnostics, zero shell or document
overflows, 71 axe-checked states with zero serious or critical violations, and
62 focus-checked states whose controls were visible and unobscured. The
independent reviewer inspected both Variant C reference/current/diff trios,
high-volume ordered Evidence, shallow diagnostics, forced colors, long
identities, corresponding Darwin/Linux baselines, and contact sheets. The
review passed with no material findings.

The maintained Darwin and pinned-Linux snapshot suites each passed all 194
checks after deliberate baseline updates. Browser coverage also proves the
58px virtual Scope row, 52px virtual Evidence row, one-viewport Page Up/Down,
exact accessible identities, authoritative sequence values that differ from
event-id suffixes, and complete diagnostic disclosure under 320px shallow
pressure. The shipped DevTools-panel smoke, official-client fixture, release
package, documentation check, and full unit suite passed.

Exact visual commands used for this batch:

```text
CI=1 npm run test:ui:update
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update'
CI=1 npm run test:ui
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui'
npm run test:ui:visual
npm run test:ui:extension
npm run fixture:test:browser
npm run release:package
npm run docs:check
npm test
```

## COMMAND projection removal and direct Local Injection batch

The `projection-ui-01` batch removes the general user-visible COMMAND
projection summary and comparison. Ordered Evidence, selected Fields, and
diagnostics remain the developer-facing COMMAND inspection path. Internal
derived state remains available to Draft validation, Scenarios, Checkpoints,
and diagnostics.

The batch also removes the separate standalone Local Injection Review step.
Captured Drafts open with Source comparison active. Source-free authored
Drafts show only the editable Draft. The exact target, validation, expected
delivery, and local-only boundary remain next to the direct **Inject locally**
action. Scenario Review remains unchanged.

The maintained packet contains 83 reference/current/diff captures. It reports
zero browser diagnostics, zero shell or document overflows, zero serious or
critical axe findings across 76 checked states, and visible unobscured controls
across 67 focus-checked states. Darwin and pinned-Linux baselines remove the
obsolete projection and standalone Review states and add captured and authored
direct-Draft states at compact, normal, shallow, and wide geometry in Dark,
Light, and forced colors.

The first independent review failed the shallow authored Draft because the
JSON looked blank and a source-free Draft showed an irrelevant **Compare
Source** control. The corrected layout makes the JSON readable, omits that
control for authored Drafts, and keeps the protected boundary in one compact
row. The final independent review passed with no material findings. It also
confirmed that captured comparison remains available, compact Scenario editing
is bounded, and no COMMAND projection doorway remains.

The detailed review record and exact verification results are in
[`projection-ui-removal-evidence.md`](projection-ui-removal-evidence.md).

## Standalone Local Injection direct-delivery batch

This Material UI batch simplifies only standalone Local Injection. A captured
Draft now opens with immutable Source and editable Draft comparison visible by
default, while a source-free authored Draft remains a single editable pane.
Both surfaces expose one direct **Inject locally** action. Delivery still runs
the protected review, fingerprint freeze, and last-moment target revalidation
atomically before execution; the explicit reviewed-run contract for Scenarios
is unchanged.

The maintained matrix replaces the former captured-Draft and authored-review
states with five focused states: captured default preview at compact geometry,
authored direct delivery under shallow pressure, changed captured comparison
at normal and wide geometry, and authored direct delivery in forced colors.
The visual packet passed `5/5` with zero browser diagnostics, zero shell or
document overflows, zero serious or critical axe findings, and visible,
unobscured focus in all five states. An independent reviewer inspected every
reference/current/diff triplet and all ten Darwin/Linux baselines and passed
the batch with no material findings.

Read-only Darwin and pinned-Linux snapshot comparisons each passed `5/5`.
Ten focused semantic browser checks passed, as did the shipped panel smoke,
the direct Lightstreamer transport proof, and all `7/7` loaded-extension
official-client journeys. The serialized release package passed `127` test
files with `1,611` tests passed and one skipped, then produced a ZIP below the
one-megabyte budget. Type checking, the production build, and documentation
validation also passed.

Exact visual commands used for this batch:

```text
CI=1 npm run test:ui -- --grep "visual baseline: local-injection"
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui -- --grep "visual baseline: local-injection"'
npm run test:ui:visual -- --grep local-injection-
npm run test:ui:extension
LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run fixture:test:browser
npm run release:package
npm run docs:check
```
