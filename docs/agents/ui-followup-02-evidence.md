# UI follow-up 02 evidence

Date: 2026-08-20

Scope: clarify the shallow diagnostic footer clipping reported by the
`history-100k-06` storage-headroom follow-up and retain fresh storage-headroom
visual evidence. The Project context was read-only; no Project ticket was
edited.

## Disposition

- Product code changed: **No**. The existing footer layout already has one
  scroll owner, `.workbench-react__status-diagnostics`; the footer status line
  remains outside that scrollport.
- Evidence/test harness changed: **Yes**. Five visual-evidence-only matrix
  states now generate clean reference, current warning, and diff images. The
  clean reference omits the advisory estimate through a test-server-only query
  override; it is not a production storage mode.
- Tracked visual baselines changed: **No**. The five states are explicitly
  `visualEvidenceOnly`; no Darwin or Linux snapshot was created or rewritten.

## Bounded approaches

Two approaches were used within the three-approach limit:

1. Measure the shipped shallow footer before changing it. At 900×320, the
   footer occupies y=239–320, the diagnostic scrollport occupies y=240–296,
   and the fixed status line begins at y=296. The diagnostic owner has
   `clientHeight=56` and `scrollHeight=94`; its content is clipped by the
   intentional scroll viewport, not covered by the status line.
2. Add a deterministic evidence packet and a keyboard reachability regression.
   Physical `End` moves the owner to `scrollTop=38` and exposes the recovery
   line at y=275.75–291.9375 inside the owner’s y=240–296 bounds. `Home`
   restores the top view. Because the content is reachable and unobscured,
   there was no third, product-fix approach.

The shallow geometry has exactly one overflowing footer descendant. The owner
stays inside the footer, its bottom coincides with the status-line top, and the
shell/document have no horizontal overflow. The same conclusion holds in
forced-colors mode. Normal, compact, and wide warning cards fit without an
active overflow owner.

## Visual packet

Command:

```text
npm run test:ui:visual -- --grep storage-headroom
```

Manifest: `test-results/workbench-visual-qa/manifest.json`

The packet contains base/reference, current, and diff images for:

| State | Reference | Current | Diff |
| --- | --- | --- | --- |
| Normal, 900×700, Dark | `reference/normal-storage-headroom-warning-dark.png` | `current/normal-storage-headroom-warning-dark.png` | `diff/normal-storage-headroom-warning-dark.png` |
| Compact, 563×700, Light | `reference/compact-storage-headroom-warning-light.png` | `current/compact-storage-headroom-warning-light.png` | `diff/compact-storage-headroom-warning-light.png` |
| Shallow, 900×320, Dark | `reference/shallow-storage-headroom-warning-dark.png` | `current/shallow-storage-headroom-warning-dark.png` | `diff/shallow-storage-headroom-warning-dark.png` |
| Wide, 1440×900, Light | `reference/wide-storage-headroom-warning-light.png` | `current/wide-storage-headroom-warning-light.png` | `diff/wide-storage-headroom-warning-light.png` |
| Shallow, 900×320, forced-colors Dark | `reference/shallow-storage-headroom-warning-forced-dark.png` | `current/shallow-storage-headroom-warning-forced-dark.png` | `diff/shallow-storage-headroom-warning-forced-dark.png` |

Manifest changed-pixel ratios are 28.5%, 21.4%, 31.8%, 7.7%, and 28.6% in
the table’s order. These are expected warning-presence deltas, not parity
thresholds.

Contact sheets are retained at:

- `test-results/workbench-visual-qa/contact-sheets/affected-reference.png`
- `test-results/workbench-visual-qa/contact-sheets/affected-current.png`
- `test-results/workbench-visual-qa/contact-sheets/affected-diff.png`
- `test-results/workbench-visual-qa/contact-sheets/affected-reference-current-diff.png`

The focused browser attachments are under
`test-results/ui/workbench-Workbench-keeps--9a493-obal-and-keyboard-reachable/`:
the four normal/compact/shallow/wide captures, the shallow scrolled capture,
and `storage-headroom-forced-colors.png`.

## Diff disposition

All five packet diffs are **intentional**. Each clean reference omits the
advisory warning while the current production scenario includes the warning;
the shallow diff also records the intentional top-of-scroll viewport clipping.
No non-intentional overlap, hidden recovery content, shell overflow,
forced-colors readability problem, or focus obstruction was found. The packet
is evidence for review, not approval to rewrite tracked baselines.

## Headless checks

- `npm run typecheck` — PASS.
- `npm run build` — PASS; MV3 CSP and shipped extension assets verified.
- `npm test` — PASS; 107 ordinary files / 1,307 tests, then 13 serialized
  IndexedDB files / 219 passed and 1 skipped.
- `npx vitest run tests/workbench-visual-evidence-runner.test.ts tests/history-100k-06-storage-headroom.test.ts --no-file-parallelism --maxWorkers=1` — PASS; 14 tests.
- `CI=1 npm run test:ui -- tests/ui/workbench.spec.ts --grep 'low storage headroom|mixed-size footer'` — PASS; 2 tests, headless.
- `npm run test:ui:visual -- --grep storage-headroom` — PASS; 5 captures with
  zero browser diagnostics, zero serious/critical axe violations, and focus
  evidence for the warning states.
- `CI=1 npm run test:ui` — the read-only comparison was run before the final
  `visualEvidenceOnly` marker was added. It reported the five new packet states
  without approved snapshots plus unrelated visual-baseline mismatches; no
  snapshot files were changed. The final tree explicitly excludes those five
  evidence-only states from the tracked-baseline loop.

All browser checks used the repository’s headless Playwright configuration and
no visible Chrome window.
