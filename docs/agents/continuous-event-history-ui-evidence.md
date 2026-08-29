# Continuous Event History UI evidence

Status: implementation evidence checklist. Change class: **Material UI** because
History status, warning semantics, Notifications content, and retained-Evidence
copy change. This feature reuses the accepted footer and Notifications document;
it adds no permanent surface or control.

## Accepted presentation contract

| State | Footer | Notifications |
| --- | --- | --- |
| Routine Retention Advance | None | One coalesced `Older Evidence removed` informational episode per History Interval |
| Commit retry recovered | None | `History storage recovered`, with the technical `JOURNAL_COMMIT_FAILED` code in Details |
| Active retry or pending pressure | `History catching up` warning while active | Same condition lifecycle |
| Sustained memory fallback | `History using memory` warning | Same condition lifecycle with smaller budget and recovery outcome |
| Evidence Gap | Persistent `History has an Evidence gap` warning | Same condition with exact capture range and projection limitation |

The normal compact History status is `<retained>/<accepted> Evidence ·
<storage>`, with an accessible label spelling out retained and accepted counts.
It must not announce routine rollover or move focus, selection, scroll, or an
open detail.

## Deterministic scenarios

- `history-rolling-high-volume`: latest retained Evidence remains ordered after
  rollover; Capture remains running; one coalesced informational entry; no footer.
- `history-journal-recovered`: a definitive one-shot commit failure retries with
  no duplicate or reorder; recovery remains notification-only.
- `history-memory-fallback`: persistent journal failure continues in bounded
  memory with one warning and unchanged Observation Coverage.
- `history-evidence-gap`: one exact gap, later Evidence visible, continuity-based
  projection marked limited, one stable footer/Notifications condition.
- Existing Notifications empty and bounded-volume states remain valid.

## Required verification record

Do not mark an item complete without the named artifact or command result.

- [ ] Focused runtime and panel tests cover the five presentation states.
- [ ] Wide Light live high-volume screenshot and diff inspected.
- [ ] Normal Dark Notifications rollover/recovery screenshot and diff inspected.
- [ ] Compact Light or Dark memory-fallback screenshot and diff inspected.
- [ ] Shallow forced-colors Dark expanded Evidence-gap footer screenshot and diff inspected.
- [ ] Keyboard dismissal, Notifications Back, and focus restoration verified.
- [ ] Passive Capture preserves selection, ledger scroll, and open detail.
- [ ] No serious or critical automated accessibility findings.
- [ ] No clipping, overlap, inaccessible operation, or repeated polite announcement.
- [ ] `npm run test:ui`, `npm run test:ui:extension`, and the official-client
  fixture browser check pass.
- [ ] `npm run test:ui:visual` packet inspected; intentional baseline changes are recorded.
- [ ] Independent visual reviewer receives criteria, scenario identifiers,
  base/current/diff images, geometries, themes, and accessibility results without
  implementation rationale.

## Evidence outcome

Pending implementation and verification. Record exact commands, artifact paths,
review findings, and maintainer disposition here before release.
