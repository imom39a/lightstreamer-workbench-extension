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
traces, video, page HTML, and console output when a check fails; there is no
separate baseline-update command. Collect and review intentional visual
evidence through `docs/agents/ui-verification.md` and
`docs/agents/ui-visual-qa.md` according to the Workbench UI Standard.
