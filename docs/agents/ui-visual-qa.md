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

The reviewer checks clipping, reachability, discoverability, accessible names
and state labels, visual hierarchy, empty states, high-volume states, offline
Export behavior, keyboard traversal, and focus visibility. Passing automated
tests or updating a baseline is not sufficient. A material finding blocks
readiness until fixed or explicitly accepted as an intentional design
decision. Record the findings and outcome in the pull request or the related
Project ticket.

## This batch

The UI guardrail batch used the deterministic `tests/ui/visual-matrix.ts`
scenes and inspected the six changed screenshots in both the local snapshot
directory and the pinned Linux directory:

- Timeline Live — Dark, 900×700;
- Timeline Frozen — Light, 900×700;
- Topology expanded — Dark, 1280×800;
- Topology collapsed — Light, 1280×800;
- high-cardinality COMMAND evidence — Dark, 1440×900;
- compact Export open — Light, 563×137.

The first introduction of these six states has no prior visual baseline, so it
is recorded as an intentional baseline creation rather than a claimed diff.
The compact Export, sustained Timeline, keyboard/focus, and accessibility
workflows were then rerun against those baselines in the pinned Chromium
container; all 20 UI checks passed, with no serious or critical axe findings.
An independent visual pass also checked the corrected artifacts after the
first baseline review identified and the implementation fixed the panel icon
MIME type, Timeline Live/Codes overlap, and truncated Topology overview
values. The corrected local and Linux packets passed that follow-up review.
The shared header-asset correction also refreshed the three existing
`panel.spec.ts` screenshots; those legacy scenarios were rerun and inspected
alongside the six new matrix states.
Future material changes must attach the prior images and actual diffs using
the same packet format.

Exact commands used for this batch:

```text
npm run test:ui:update
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e HOME=/tmp/playwright-home -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/playwright-browsers -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui:update'
npm run test:ui
```
