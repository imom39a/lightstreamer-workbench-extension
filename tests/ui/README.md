# Workbench UI baselines

These screenshots are generated from the local deterministic scenarios in
`tests/support/panel-scenarios.ts` and the shipped panel source. They contain
no production Capture data or third-party visual assets.

The Linux Chromium gate uses the checked-in `*-snapshots-linux` baselines for
both the existing panel scenes and the visual matrix; other local platforms
use the default snapshot directories so the same command remains usable
without cross-platform font-rendering noise.

Run `npm run test:ui` to verify them. Run `npm run test:ui:update` deliberately
when a reviewed visual change is intended.

## Visual matrix

`visual-matrix.ts` is the intentionally small visual-regression matrix. It
covers compact (563×137), medium (900×700), and wide (1280×800 / 1440×900)
layouts, with representative Dark and Light coverage rather than a Cartesian
explosion of every state. The baselines cover Timeline Live and Frozen,
Topology expanded and collapsed, bounded high-cardinality COMMAND evidence,
and the compact Topology Export surface.

Visual checks use fixed scenario data, timestamps, viewport sizes, themes,
`deviceScaleFactor: 1`, Chromium animation disabling, and the pinned Linux
container (`mcr.microsoft.com/playwright:v1.62.1-noble` in CI). A baseline
update must be accompanied by an inspected screenshot and a short explanation
in the pull request or internal Project ticket. Normal `test:ui` never rewrites
baselines.
