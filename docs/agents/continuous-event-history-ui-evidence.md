# Continuous Event History UI evidence

Status: verified implementation evidence, 2026-08-29. Change class: **Material UI** because
History status, warning semantics, Notifications content, and retained-Evidence
copy change. This feature reuses the accepted footer and Notifications document;
it adds no permanent surface or control.

## Accepted presentation contract

| State | Footer | Notifications |
| --- | --- | --- |
| Routine Retention Advance | None | One coalesced `Older Evidence removed` informational episode per History Interval |
| Commit retry recovered | None | `History storage recovered`, with the technical `JOURNAL_COMMIT_FAILED` code in Details |
| Pending pressure | `History catching up` warning while active | Same condition lifecycle |
| Sustained memory fallback | `History using memory` warning | Same condition lifecycle with smaller budget and recovery outcome |
| Evidence Gap | Persistent `History has an Evidence gap` warning | Same condition with the rejected candidate, gap count, and projection limitation |

The normal compact History status is `<retained>/<accepted> Evidence ·
<storage>`, with an accessible label spelling out retained and accepted counts.
It must not announce routine rollover or move focus, selection, scroll, or an
open detail.

## Deterministic scenarios

- `history-rolling-high-volume`: latest retained Evidence remains ordered after
  rollover; Capture remains running; one coalesced informational entry; no footer.
- `history-journal-recovered`: two definitive commit failures recover on the
  third and final attempt with
  no duplicate or reorder; recovery remains notification-only.
- `history-journal-memory-fallback`: persistent journal failure continues in bounded
  memory with one warning and unchanged Observation Coverage.
- `history-evidence-gap`: one exact gap, later Evidence visible, continuity-based
  projection marked limited, one stable footer/Notifications condition.
- Existing Notifications empty and bounded-volume states remain valid.

## Required verification record

Do not mark an item complete without the named artifact or command result.

- [x] Focused runtime and panel tests cover the five presentation states.
- [x] Wide Light live high-volume screenshot and diff inspected.
- [x] Normal Dark Notifications rollover/recovery screenshot and diff inspected.
- [x] Compact Light memory-fallback screenshot and diff inspected.
- [x] Shallow forced-colors Dark expanded Evidence-gap footer screenshot and diff inspected.
- [x] Keyboard dismissal, Notifications Back, and focus restoration verified.
- [x] Passive Capture preserves selection, ledger scroll, and open detail.
- [x] No serious or critical automated accessibility findings.
- [x] No clipping, overlap, inaccessible operation, or repeated polite announcement.
- [x] `npm run test:ui`, `npm run test:ui:extension`, and the official-client
  fixture browser check pass.
- [x] `npm run test:ui:visual` packet inspected; intentional baseline changes are recorded.
- [x] Independent visual reviewer receives criteria, scenario identifiers,
  base/current/diff images, geometries, themes, and accessibility results without
  implementation rationale.

## Evidence outcome

The accepted low-attention workflow is implemented without another permanent
surface or control. Routine rollover and recovered commits remain in
Notifications. Sustained memory fallback and actual Evidence gaps use one
dismissible footer condition and remain recorded in Notifications. Notifications
Back restores the prior investigation; passive Capture does not move selection,
ledger scroll, focus, or an open detail.

Verification results:

- `npm test`: 129 files; 1,592 passed and 1 intentionally skipped (1,427
  ordinary plus 165 serialized IndexedDB tests).
- `npm run typecheck`, `npm run docs:check`, `git diff --check`, and
  `npm run build`: passed. The release build transformed 115 modules and passed
  the MV3/CSP/self-contained-script verification.
- `LSEW_UI_PORT=4423 CI=1 npm run test:ui`: 196/196 passed, including all 78
  maintained Darwin visual baselines.
- `npm run test:ui:extension`: passed the production panel, same-tab dual-panel,
  authentic panel-disposal, and session-journal cleanup proofs.
- `CI=1 npm run fixture:test:browser`: 7/7 official-client browser tests passed.
- `npm run release:package`: passed and produced the 442,146-byte deterministic
  ZIP within the 1 MiB release budget.
- `npm run test:ui:visual`: 87/87 captures; 0 browser diagnostics; 0 shell or
  document horizontal overflows; 0 serious or critical findings across 80
  axe-checked states; 71/71 focus-checked states remained visible and unobscured.

The packet is rooted at `test-results/workbench-visual-qa/` with
`manifest.json`, `reference/`, `current/`, `diff/`, and `contact-sheets/`.
Reference/current/diff images and the affected contact sheet were inspected for:

- `wide-history-rollover-notifications-light` — 1440×900, Light;
- `normal-history-recovered-notifications-dark` — 900×700, Dark;
- `compact-history-journal-memory-light` — 563×700, Light;
- `shallow-history-gap-forced-dark` — 900×320, Dark forced colors.

The independent reviewer reported: **No material visual findings.** It confirmed
the intended Notifications/footer ownership, legible retained/accepted/storage
meter, clear hierarchy and focus cues, and no visible clipping, overlap,
inaccessible action, misleading severity, or duplicate announcement.

All 78 maintained Darwin baselines changed intentionally because the compact
History meter moved into the existing footer as `<retained>/<accepted> Evidence · <storage>`.
The change does not add a surface or control. Maintainer disposition: accepted.
