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
`test-results/workbench-visual-qa/reference/`, `current/`, `diff/`, and a
manifest that identifies the accepted prototype state, production scenario,
viewport, theme, and pixel-delta summary. The visual diff is an inspectable
reference delta, not a parity threshold: compare hierarchy, reachability,
protected Local Injection boundaries, and semantic meaning against the
accepted prototype and UI standard.

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
