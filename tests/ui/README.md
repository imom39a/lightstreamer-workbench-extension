# Workbench UI verification

`npm run test:ui` exercises the accepted React Scoped Evidence Workspace with
deterministic scenarios from `tests/support/workbench-scenarios.ts`. The
suite contains no production Capture data or third-party visual assets.

The browser checks cover Diagnose, structural Scope, Ordered Evidence,
Context, Live/Frozen behavior, degraded operation, responsive geometry,
keyboard and focus restoration, accessibility, export, and exactly one Local
Injection Draft through both accepted entry paths. Local Injection scenarios
include raw JSON editing, immutable Source comparison, validation, Review,
stale targets, pending execution, and truthful outcomes.

Select a scenario, viewport, or theme when diagnosing a case:

```bash
npm run test:ui -- --scenario=local-injection-authored --viewport=900x700 --theme=dark
```

The suite uses fixed scenario data, timestamps, viewport sizes, themes,
`deviceScaleFactor: 1`, and disabled animations. It retains screenshots,
traces, video, page HTML, and console output when a check fails.

`visual-regression.spec.ts` is the small committed production baseline matrix.
Its original four states cover normal `900×700` Evidence density (Dark),
compact `563×700` captured Draft (Light), shallow `900×320` authored
Review (Dark), and wide `1440×900` COMMAND comparison (Light). Four field-UX
states cover complete retained Find at normal geometry (Dark), long identities
at compact geometry (Light), reversible More actions at shallow geometry
(Dark), and a matching COMMAND projection summary in runtime-object Context at
wide geometry (Light).
`npm run test:ui` can only compare those images.
Use `npm run test:ui:update` for a deliberate baseline creation or update and
record the inspected artifacts and reason in the Project item or pull request.

Run `npm run test:ui:visual` for the independent Material-UI review packet.
It captures the same eight states from the accepted `workbench-ui-10`
prototype, the production harness, and inspectable visual diffs in
`test-results/workbench-visual-qa/`. The prototype diff is evidence for
semantic review, not a pixel-parity threshold.
