# Workbench panel verification

This is the browser-evidence procedure for the change classes defined by the
[`Workbench UI Standard`](../WORKBENCH_UI_STANDARD.md). The standard decides
whether work is Non-UI, Bounded UI, or Material UI and which evidence is
required. This procedure explains how to collect that evidence without
duplicating the product rules.

Unit tests are necessary, but they cannot prove Chromium layout, clipped
controls, real downloads, focus visibility, or keyboard behavior.

## When the browser gate is required

Use the real browser gate for every Bounded or Material UI change. This
includes panel behavior, styling, layout, scenarios, screenshots,
accessibility, Topology, Timeline, COMMAND State, Export, or DevTools-panel
wiring. A Non-UI documentation change may use link and command review instead.

Before changing user-facing UI behavior, add or update a failing user-facing
test at the lowest seam that can observe the defect. Browser-only behavior must
be covered in Chromium; jsdom tests may supplement it but cannot replace it.
Every defect discovered manually receives regression coverage at that lowest
capable seam.

## Required evidence

Run the relevant fast test while iterating, then run the complete required
checks before handoff:

```text
npm run typecheck
npm test
npm run test:ui
npm run build
```

Extension-specific changes also run `npm run test:ui:extension`. Fixture and
instrumentation changes run the appropriate `fixture:*` browser proof.

Bounded UI changes exercise the affected deterministic scene and the geometry,
theme, keyboard, and accessibility evidence required by the standard.
Material UI changes cover compact and normal viewports, relevant shallow and
wide geometry, and representative Dark and Light themes defined in
`tests/ui/visual-matrix.ts`. Inspect the generated screenshots and, when a
visual diff exists, inspect expected, actual, and diff artifacts. Do not update
baselines during normal verification; use only `npm run test:ui:update` for an
intentional baseline change and record why it changed. Every baseline creation
or update is a Material UI change.

Record the changed workflows, scenarios, viewport sizes, themes, browser
tests, screenshot artifacts, accessibility results, and any intentional
baseline updates in the pull request or the related internal Project ticket.

## Independent visual QA

An independent reviewer is required for Material UI changes: new controls,
layout changes, visual hierarchy, high-volume states, Export, Timeline state,
Topology behavior, COMMAND State behavior, keyboard/focus behavior, or any
baseline change. The reviewer receives the acceptance criteria, base and
changed screenshots, visual diffs, tested viewports, and themes without the
implementation rationale.

The reviewer checks clipping, reachability, discoverability, accessible names
and state labels, empty and high-volume states, hierarchy, keyboard traversal,
focus visibility, and offline/export behavior. Passing automated tests or
updating a baseline is not sufficient. Findings and the outcome are recorded
with the pull request or Project ticket. A material finding blocks readiness
until it is fixed or explicitly accepted as an intentional design decision.

The review uses deterministic local scenarios only; private production Capture
data is never required.
