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
- Find and Filter remain separate controls and state.
- No dedicated keyboard shortcuts are part of the accepted feature; ordinary
  Tab traversal, native button activation, and nested Escape remain accessible.
- `node --check prototype.js` and `git diff --check` — passed.

The screenshots and browser checks are prototype decision evidence, not the
production Material UI gate. Production work still requires failing user-facing
tests first, the maintained baseline/diff packet, extension/fixture/package/docs
proof, and independent visual QA under `docs/WORKBENCH_UI_STANDARD.md`.

Build 7 subsequently repaired the comparison mock's semantic shortcuts (draft
isolation, additive same-facet authoring, global exact search, active-zero
pinning, provenance vocabulary, focus restoration, Clear/retired/terminal
states) without changing the selected Variant A direction. Its review record is
the authoritative integrated prototype evidence.
