# Prototype review record

## Scope and classification

Disposable Material UI exploration for `evidence-filter-06`. The prototype does
not change the accepted UI standard, production panel, or visual baselines.

## Browser matrix

Deterministic Chromium screenshots:

- `review/inline-normal-dark.png`
- `review/inline-compact-high-cardinality-light.png`
- `review/inline-wide-unavailable-dark.png`
- `review/inline-compact-hidden-light.png`
- `review/context-lens-normal-light.png`
- `review/worksheet-shallow-dark.png`
- `review/inline-wide-terminal-light.png`

The interactive state selector also exposes zero, valid conflict, passive Live
growth, and memory-fallback states. The frame selector covers `563×700`,
`900×700`, `900×320`, and `1440×900`; theme covers Dark and Light. CSS includes
an explicit forced-colors treatment.

## Browser and accessibility checks

- Browser page/console errors — none across the matrix.
- Axe serious/critical findings — none across all seven captured cases.
- Nested Escape restoration — value explorer → `Choose values`; add-criterion
  step → `Add structured criterion`; composer → labelled `Filter` trigger.
- Ordered Evidence ArrowDown — focus and selection move together to the next
  retained row.
- Find and Filter remain separate controls and state.
- Pointer and keyboard value actions share the same mutation path in the
  prototype.
- `node --check prototype.js` and `git diff --check` — passed.

The screenshots and browser checks are prototype decision evidence, not the
production Material UI gate. Production work still requires failing user-facing
tests first, the maintained baseline/diff packet, extension/fixture/package/docs
proof, and independent visual QA under `docs/WORKBENCH_UI_STANDARD.md`.
