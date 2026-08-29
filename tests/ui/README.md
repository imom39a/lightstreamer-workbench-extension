# Workbench UI verification

`npm run test:ui` exercises the accepted React Scoped Evidence Workspace with
deterministic scenarios from `tests/support/workbench-scenarios.ts`. The
suite contains no production Capture data or third-party visual assets.

The browser checks cover Diagnose, structural Scope, Ordered Evidence,
Context, Live/Frozen behavior, degraded operation, responsive geometry,
keyboard and focus restoration, accessibility, export, one protected
standalone Local Injection Draft through both accepted entry paths, including
default captured Source/Draft comparison and direct execution from the
authoring surface, and the temporary Local Injection Scenario document.
Scenario coverage includes
explicit membership, 100-Step and accounted-state capacity, immutable Review,
serial clock controls and hidden auto-pause, drift, fail-closed terminal
outcomes, and Checkpoint authoring, evaluation, and retained-Evidence routes.

Select a scenario, viewport, or theme when diagnosing a case:

```bash
npm run test:ui -- --scenario=local-injection-authored --viewport=900x700 --theme=dark
```

The suite uses fixed scenario data, timestamps, viewport sizes, themes,
`deviceScaleFactor: 1`, and disabled animations. It retains screenshots,
traces, video, page HTML, and console output when a check fails.

`visual-regression.spec.ts` is the small committed production baseline matrix.
Its original four states cover normal `900×700` Evidence density (Dark),
compact `563×700` captured Draft (Light), shallow `900×320` authored direct
injection Draft (Dark), and wide `1440×900` COMMAND comparison (Light). Four field-UX
states cover complete retained Find at normal geometry (Dark), long identities
at compact geometry (Light), reversible More actions at shallow geometry
(Dark), and a matching COMMAND projection summary in runtime-object Context at
wide geometry (Light).
`npm run test:ui` can only compare those images.

Additional Scenario baseline matrices cover authored Edit, Review, completion,
clock controls, terminal outcomes, membership preview, undo, capacity refusal,
and Checkpoint authoring, Review, waiting, pass, fail, unavailable,
ambiguous-value, and high-volume states across the required compact, normal,
shallow, and wide geometries. Use the generated manifest as the authoritative
inventory rather than relying on a hand-maintained image count.
Use `npm run test:ui:update` for a deliberate baseline creation or update and
record the inspected artifacts and reason in the Project item or pull request.

Run `npm run test:ui:visual` for the independent Material-UI review packet.
It captures every manifest-selected state from the accepted `workbench-ui-10`
prototype, the production harness, and inspectable visual diffs in
`test-results/workbench-visual-qa/`. The prototype diff is evidence for
semantic review, not a pixel-parity threshold.
