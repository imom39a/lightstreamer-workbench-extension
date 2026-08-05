# PROTOTYPE — Integrated Workbench direction

This disposable prototype answers `workbench-ui-10 — Validate the integrated DevTools UI direction`: do the accepted workspace, Local Injection, docked-layout, keyboard, and visual-semantic decisions work as one coherent debugging instrument?

The product owner completed the three-journey review and accepted this direction as implementation-ready on 2026-08-04. See [REVIEW-MATRIX.md](./REVIEW-MATRIX.md) for the verification coverage, accepted findings, and corrections made during validation.

The design decisions are already closed, so the prototype switcher exercises three canonical journeys rather than reopening competing layouts:

- **A — Diagnose:** Live orientation, selected Evidence, COMMAND projections, Frozen high volume, raw Evidence, export, and empty Scope.
- **B — Local Injection:** edit, synchronized Source comparison, invalid/stale Drafts, Review, delivered-local outcome, and failure.
- **C — Recover:** limited Coverage, disconnected inspected page, in-memory fallback, retired historical selection, and Session recovery.

Run:

```sh
npm run prototype:integrated-ui
```

Open:

- `http://127.0.0.1:4179/workbench-ui-10/?variant=A`
- `http://127.0.0.1:4179/workbench-ui-10/?variant=B`
- `http://127.0.0.1:4179/workbench-ui-10/?variant=C`

Use `state=`, `frame=auto|compact|normal|shallow|wide`, `theme=dark|light`, and `presentation=1`. The floating switcher changes journeys, scenario states, frames, and theme; left/right arrows outside the Workbench surface cycle journeys.

This is read-only, in-memory prototype code. It does not instrument a page, contact Lightstreamer Server, mutate production state, or define implementation architecture. The product owner requested work directly on `main`, so the prototype is isolated by directory and explicitly retained as Wayfinder evidence rather than production panel code.
