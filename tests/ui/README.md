# Workbench UI baselines

These screenshots are generated from the local deterministic scenarios in
`tests/support/panel-scenarios.ts` and the shipped panel source. They contain
no production Capture data or third-party visual assets.

The Linux Chromium gate uses the checked-in `panel.spec.ts-snapshots-linux`
baselines; other local platforms use the default snapshot directory so the
same command remains usable without cross-platform font-rendering noise.

Run `npm run test:ui` to verify them. Run `npm run test:ui:update` deliberately
when a reviewed visual change is intended.
