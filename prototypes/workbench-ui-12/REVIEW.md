# Prototype review — Scope and Ordered Evidence readability

Status: visually reviewed; Variant C approved for production implementation on 2026-08-29.

## Compared directions

| Variant | Scope treatment | Ordered Evidence treatment | Main tradeoff |
| --- | --- | --- | --- |
| A — Targeted two-line fix | Only the selected page row stacks identity over counts; children retain the current compact ledger. | Timestamp and `event-N` use a measured two-line cell. | Smallest change; long child identities still truncate. |
| B — Root summary + split order/time | Page identity and counts move into the fixed pane header; the tree begins at Client. | Sequence and timestamp become separate columns. | Dense children; more pane/header structure and horizontal columns. |
| C — Priority blocks + order rail | Type, identity, status, and facts form explicit hierarchy blocks. | Sequence anchors a rail; event meaning leads and time becomes secondary. | Best semantic scanning; largest departure from today's ledger. |

## Review recommendation before selection

Start with **A**. It directly repairs the two reported defects, preserves the accepted Plain Ledger and Elastic Triad structure, and creates the smallest verification and migration surface. Choose B if keeping the root fixed during Scope scrolling is more valuable than preserving root membership in the tree. Choose C only if the denser semantic reordering is an intentional broader redesign.

The maintainer intentionally selected **C** after live review, superseding this conservative recommendation.

## Browser evidence

The live prototype was inspected at a 1440×900 browser viewport with the Normal 1360×760 Workbench frame, and at a 1024×820 browser viewport with the Compact 920×710 Workbench frame.

- All three compact variants keep the complete `Inspected page` label and its count summary inside Scope.
- Variant A keeps the timestamp and event ID in separate, non-overlapping line boxes.
- All variants keep the Workbench inside the browser viewport with no page-level horizontal overflow.
- Each direction has exactly one selected Scope representation.
- Browser console warnings/errors: none.

Screenshots:

- [A normal](./screenshots/A-normal.jpg) · [A compact](./screenshots/A-compact.jpg)
- [B normal](./screenshots/B-normal.jpg) · [B compact](./screenshots/B-compact.jpg)
- [C normal](./screenshots/C-normal.jpg) · [C compact](./screenshots/C-compact.jpg)

Validation commands:

```sh
npm run prototype:scope-evidence-readability
node --check prototypes/workbench-ui-12/prototype.js
git diff --check
```
