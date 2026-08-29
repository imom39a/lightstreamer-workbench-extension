# Notifications UI evidence

Date: 2026-08-28. Internal Project item: `notifications-ui-01 — Move recurring notices into Notifications` in [Project #2](https://github.com/users/imom39a/projects/2).

Classification: **Material UI**. The maintainer requested a separate Notifications page after repeated snapshot-completion cards obscured selected Evidence, then explicitly requested dismissible footer conditions with those conditions retained in Notifications. The implementation uses an existing promoted-document responsibility, with no permanent peer pane or shared-component addition. Independent specification, standards, and visual reviews are recorded below.

Base: `51e87ded1d9617a55df8be7c1050db1b95f6e5f0`.

## Changed workflow and acceptance

- Recurring Lightstreamer diagnostics and active Workbench conditions appear once in Notifications, accessed through a labelled footer entry with the active-or-recent count and highest Warning/Error severity. Context no longer contains repeated cards. Workbench conditions cover History pressure, storage headroom, Activity aggregation failure, Capture disconnection or limited Coverage, canonical current Session recovery, retired Scope, a cleared selection, and a failed History clear.
- Every one of those active footer conditions has a labelled `Dismiss` action. Dismissal changes presentation only: it does not alter Capture, Evidence, History, or the Notifications count. The notification remains reviewable until the condition ends. Resolution removes the active condition from Notifications and clears the dismissal, so a later recurrence becomes visible again instead of remaining silently suppressed.
- Repeated publication of an unchanged condition updates one stable condition notification instead of piling up duplicates. Event-like Lightstreamer notices remain bounded by the existing 100-presentation Panel Session limit.
- Notifications spans the current Panel Session, independently of Evidence Scope and Filter. The existing limit remains 100 recent diagnostic presentations. Shown/total counts, Code/Severity/Affected Include and Exclude filters, reset, empty, and filtered-empty states are explicit.
- Supporting Evidence and affected-Scope actions open the existing investigation. Back restores the prior selected identity and Notifications return destination, including after passive Capture or reopening Notifications from a different inspected record. Unavailable routes retain an explicit recovery message.
- Opening Notifications preserves Evidence Scope, Filter, Find, selection, scroll, Live/Frozen state, and a parked Draft. Returning restores focus to the entry. Evidence inspection deliberately focuses Context. Passive arrivals preserve the focused notice and scroll anchor; individual notices are not announced.
- Entries use neutral separators, visible severity and affected identity, a visible inspection action when supporting Evidence or a current Scope route was captured, a visible recovery instruction when no inspection route exists, and optional Details. Dark, Light, and forced-colors modes preserve the same meaning. The document owns one content scroll, with a fixed Back action.
- After footer dismissal, focus moves to the next dismissible condition or the previous one when the dismissed condition was last. Passive condition resolution uses the same ordinal recovery. When no condition remains, focus moves to the enabled Notifications trigger or, if Notifications is empty, to the Evidence mode control.
- Shallow footer conditions keep their complete heading, affected identity, Dismiss action, and a visible **Diagnostic details** cue. Longer observation, consequence, recovery, and action copy expands inside the existing diagnostic scroll owner and remains keyboard reachable.

The architecture and directly affected UI contracts are amended in this change. Capture, diagnostic-journal semantics, History capacity, and Local Injection delivery are unchanged.

## Regression evidence

The first Chromium regression failed because Context still rendered the old diagnostic region. Runtime and browser tests now cover the moved notices, independent filtering, exact Evidence and affected-Scope routes, return state, empty and high-volume states, keyboard focus, and parked 500-field Draft preservation.

The dismissal change was added test-first at two public seams. The History runtime test first required the exact backlog warning to enter Notifications, remain there after footer dismissal, disappear on resolution, and reappear on recurrence. It then hid the panel through resolution and recurrence to prove that dismissal expiry does not depend on a rendered snapshot. The browser test first required a visible labelled dismissal action, an unchanged Notifications count, retained notification copy, and deterministic focus recovery. Both tests failed before the implementation and pass afterward. Coverage LIMITED, simultaneous disconnected Capture plus limited Coverage, Activity aggregation failure, canonical current Session recovery, and the mixed History/Capture/retired-Scope footer receive regression coverage as well.

Two navigation defects found during verification received regression coverage:

1. After inspecting a notice while Capture continued, Back could leave the Evidence lookup pointing at the inspected record rather than the restored selection, repeatedly retrying the query. Checkpoints now preserve the exact selected Evidence identity and clear stale payload hydration.
2. Reopening Notifications from an inspected record could overwrite an earlier checkpoint's return destination. Checkpoints now preserve that destination as well. The regression first reported `context:notification-snapshot-51` instead of `context:notification-snapshot-100`.

Review also found three lifecycle and presentation gaps, each fixed with a failing regression first:

1. A condition that resolved and recurred while the panel was hidden could remain dismissed. Source resolution now clears the stable dismissal independently of rendering.
2. Activity summary aggregation failure was footer-only. It now uses the same stable active-condition journal lifecycle as the other operational conditions.
3. Historical recovering Sessions could leak into the footer while a current Session was connected. Footer and Notifications now share one canonical current, non-historical recovery-condition derivation.

## Browser and visual evidence

Primary scenarios: `notifications-volume`, `notifications-empty`, `notifications-operational`, `limited-capture`, `diagnostics-stress`, `diagnostic-server-callbacks`, `diagnostic-subscription-context`, `diagnostic-anomalies`, and `local-injection-large`.

The Notifications matrix covers 563×700 Dark, 900×700 Light, 900×320 forced-colors Dark, and 1440×900 Light. Startup memory fallback remains a separate compact operational scenario. The volume scenario starts with 150 snapshot callbacks, retains 100 notice presentations, and receives 40 more callbacks while a notice is focused and expanded. Keyboard Home/End, physical Enter activation, exact Context focus, inspection Back, and final return are asserted. The native scroll anchor remains within one CSS pixel during passive growth. The four mixed-severity footer states and storage-headroom states check every Dismiss action individually; shallow states also prove that the collapsed details cue is complete and that expanded recovery copy is reachable.

The maintained packet at `test-results/workbench-visual-qa/manifest.json` contains 80 reference/current/diff states, 69 axe-checked states, and 60 focus-checked states. Chrome for Testing 151.0.7922.71 recorded zero browser diagnostics, zero horizontal shell/document overflow, and zero serious/critical axe findings. Every footer Dismiss action in the four mixed diagnostic stress geometries has focused, visible, unobscured evidence.

Actual production-base comparison artifacts are separate from prototype references:

- `test-results/notifications-qa/base/` — all 140 prior Darwin/Linux baselines from the base revision.
- `test-results/notifications-qa/baseline-review/{darwin,linux}.json` — exact image paths, hashes, changed-pixel counts, and bounds.
- `test-results/notifications-qa/baseline-review/{current,diff,sheets}/` — current images, actual pixel diffs, and 30 paginated contact sheets.

Intentional baseline changes: all 70 existing states per platform gain the footer entry; 12 diagnostic states open Notifications; ordinary Context states lose repeated diagnostic lists where present. Five Notifications states per platform are new and are explicitly marked as having no prior production baseline. The resulting 150 baselines were generated separately on Darwin and pinned Linux, only through `test:ui:update`.

The implementer inspected every actual base/current/diff contact sheet on both platforms and the primary Notifications captures at original resolution. No additional clipping, overlap, lost action, or semantic regression was observed. Normal comparison runs left all baseline hashes unchanged.

An independent visual reviewer received an isolated packet containing the acceptance criteria, manifest, browser/accessibility results, and final reference/current/diff images without implementation rationale. The review passed with no blocking visual or accessibility concerns. It specifically confirmed complete shallow footer summaries, labelled Dismiss actions, reachable expanded recovery, truthful 0/0 and 100/100 Notifications states, and visible/unobscured focus evidence for all 12 Dismiss actions across the four diagnostic-stress geometries. The isolated packet is `test-results/diagnostic-dismiss-visual-qa-final-20260828/manifest.json`.

Independent specification and repository-standards reviews also passed on the final source, including the dismissal lifecycle, stable condition identity, focus recovery, operational-condition coverage, canonical current-Session recovery, and documentation contracts.

## Commands and results

Local logs and the isolated Playwright wrapper are in `test-results/notifications-qa/`. The final staged-only verification used a clean detached worktree and a fresh maintained server on port 4173; the earlier wrapper on port 4213 preserved the same test selection and browser policy while another checkout occupied the default port. Linux uses a separate artifact directory. The packet uses ports 4214/4215, and the official-client fixture uses a separate container and port 4216.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed on the final source through package refresh |
| `npm test` | Final staged-only run passed: 127 files, 1,608 tests passed, 1 skipped |
| `CI=1 npm run test:ui:update -- --grep 'visual baseline'` | 75 passed; intentional staged-only Darwin updates |
| `CI=1 npm run test:ui -- --grep 'visual baseline'` | 75 passed; normal Darwin comparison |
| `CI=1 LSEW_UI_UPDATE=0 npm run test:ui` | Final staged-only browser run passed all 192 tests, including all 75 visual comparisons |
| Final same browser command with `--grep 'Notifications\|500-field Draft'` | 11 passed after the final return-destination fix and affected-Scope route coverage |
| Pinned Linux `test:ui:update`, then `test:ui`, each with `--grep 'visual baseline'` | 75 passed on each run |
| `LSEW_VISUAL_PROTOTYPE_PORT=4214 LSEW_VISUAL_PANEL_PORT=4215 npm run test:ui:visual` | 80/80 captures passed |
| `npm run test:ui:extension` | Final-source repeat passed: authentic DevTools panel, two Panel Sessions, and controlled-disposal smoke |
| `LIGHTSTREAMER_PORT=4216 LSEW_LIGHTSTREAMER_CONTAINER=lsew-notifications-fixture-staged LSEW_FIXTURE_URL=http://localhost:4216/ LSEW_BROWSER_CACHE_DIR=<pinned-cache> npm run fixture:test:browser` | Direct/message-channel/listener transport proof and all 7 official-client panel journeys passed, including Notifications → server-error Evidence |
| Final `npm run release:package -- --skip-tests` after staged-only `npm test` | Typecheck, build, and ZIP audit passed on the final source; 437,398-byte ZIP, below the 1 MiB budget |
| `npm run docs:check` | Passed |

The first full unit run exposed two stale visual-runner expectations, which were updated for the added Notifications states. A concurrent rerun exceeded two existing 500 ms memory-query performance limits while browser jobs were active; thresholds were not changed. In the final staged-only worktree, the first unit attempt also reached two release-package checks before a production build existed; after building the exact staged source, the complete suite passed all 1,608 tests with the existing opt-in workload test skipped.

The pinned Linux image is `mcr.microsoft.com/playwright:v1.62.1-noble`, with `/ms-playwright/chromium-1234/chrome-linux/chrome`, a temporary node_modules mount, and the maintained fresh-profile policy. No user Chrome profile or unrelated fixture container was modified.

## Review gate

Independent specification, standards, and visual reviews passed. The Project item remains In Progress until the implementation is committed and handed back to the maintainer.

The local packet is ignored by git; attach its artifacts when sharing this change for review. No private production Capture data is included.
