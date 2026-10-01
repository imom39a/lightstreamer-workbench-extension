# Panel simplification verification

The maintainer authorized both UI audit lists and the outstanding scratch work
through tickets `panel-simplification-01`–`18` in the configured
[GitHub Project #2](https://github.com/users/imom39a/projects/2), with a local
execution ledger. This is a Material UI batch under the
[Workbench UI Standard](../WORKBENCH_UI_STANDARD.md), starting at
`5f5fed755e434b35d2dffa6c5ed2014437c22dcd`. Sol 6.1 high workers implemented
separate runtime, workspace and Injection slices; the orchestrator owns
integration, deliberate baseline updates and closure.

All 18 draft tickets are Done. Project readback at `2026-10-01 04:55 UTC` verifies
all 72 acceptance criteria checked and the 173 earlier items unchanged.

## Delivered behavior

| Tickets | Result |
| --- | --- |
| 01–02 | Removed the superseded standalone Activity document and extracted focused Activity, runtime Context, Filter, session-operation and diagnostic presentation modules. |
| 03 | Checkpoint inputs preserve unfinished JSON text and exact primitive types. UI and programmatic Review refuse invalid pending values through Park/Resume. |
| 04–05 | Short captured Source and Draft remain readable; Park is the sole return route and preserves the editor, undo, focus and scroll. |
| 06–07 | Filter facet actions use native buttons. Copy and Export lead More actions, with confirmed destructive Clear separated last. |
| 08–10 | Scope and equal counts appear once; differing counts retain their meaning. Draft readiness sits beside Inject, with the specific blocking cause. Explorer counts qualify their actual discovery base. |
| 11–13 | Scenario and Server outcomes lead with operational facts; trace identities use native Details. Notifications and session operations avoid repeated explanatory copy. |
| 14–15 | Runtime Context prioritizes identity, lifecycle and fields. Settings, counters and technical measurements remain available in Details; consequences and recovery stay visible. |
| 16–17 | Controlled heap measurements found and verified a bounded Topology deleted-key fix; historical scratch work was reconciled with its external publishing disposition. |
| 18 | Integrated regression, browser, extension, package and independent review gate. |

Capture remains observational. The integrated Activity timeline and Context
summary use the existing committed/Frozen read point and canonical Filter.
Local Injection retains its exact target, Session, Source, current listeners,
Local-only boundary and one-attempt revalidation. Server Injection remains a
normal reviewed Client Message through `sendMessage`. Clear retains explicit
global Panel Session scope and confirmation. No execution shortcut, permanent
destination or shared component library was introduced.

## Regression and independent review

Physical browser regressions reproduced primitive-text loss, hidden short
comparisons, stale programmatic Review and absent trace disclosure before the
fixes. Independent Standards review found a compact protected-boundary CSS
regression; Spec review found an incorrectly qualified explorer count and lost
cleared-Evidence availability. Each was corrected with targeted regression
evidence.

Independent visual QA initially blocked the batch because narrow Source/Draft
comparisons reserved blank space and scrolled Source away, and blocked actions
did not show their specific cause. Fresh geometry checks prove initial Source,
labelled editable Draft, shared scrolling, and reachable validation at compact
and shallow sizes. A final Spec finding restricted initial comparison-heading
focus to authoring phases; first-mounted pending and delivered regressions both
failed before that guard and passed afterward.

The preserved base packet contains 238 same-platform images. Deliberate updates
produce 232 changed base/current/diff trios and 30 platform contact sheets.
The maintained generated packet contains 107 scenes and 321 images, with 28
contact sheets. Its manifest records zero browser diagnostics or shell/document
overflow, 101 axe-checked scenes with zero serious/critical findings, and 88
focus-checked scenes. Accepted Dark-only and forced-colors contracts apply;
legacy Light-labelled scenes also prove that the panel remains Dark.

Local artifacts are under `.scratch/panel-simplification/` and
`test-results/workbench-visual-qa/`. The separate Standards, Spec and visual
review reports identify their evidence and limitations. Screenshots, diff
packets, browser logs and heap snapshots contain deterministic fixture data.

Final independent visual QA passes after inspecting 260 unique artifacts:
58 contact sheets, 87 full-size actual baseline images, 51 generated comparison
images and 38 supplementary captures, plus eight long-field captures and fifteen
fresh comparison artifacts and three qualified-count Context captures. Both
initial visual blockers are resolved; the reviewer found no remaining material
issue. Browser pass results are a separate gate from this offline visual
acceptance.

The long-field regression also exposed clipping inside the merge editor. The
editor now contributes its intrinsic width to the shared scroll owner. Four
physical browser checks reach a long JSON field's final characters at compact,
normal, wide and shallow forced-colors geometry, keep internal editor scrollers
at zero, and return to immutable Source with the owner's keyboard navigation.
The five affected generated comparison scenes were recaptured and independently
accepted; their fifteen artifacts are preserved separately from the full packet.

## Verification

The final runs after the deleted-key fix pass:

- Type checking and the release build pass.
- The complete unit suite passes 1,974 tests in 185 files, with one existing
  opt-in stress case skipped.
- Normal UI verification passes all 389 checks on macOS and all 389 on Linux,
  without updating baselines.
- The official-client fixture passes 13 cases, with one existing opt-in case
  skipped. Direct wire, message-channel fallback and listener fallback delivery
  proofs pass.
- The real DevTools-panel smoke proves two independent Panel Session journals,
  ordered capture, and cleanup of one closed panel while the other continues.
- The package audit passes MV3 CSP, local scripts, lazy editor and self-contained
  instrumentation checks; the review ZIP is 517,050 bytes, below one MiB.
- Documentation validation passes four command guides, ten maintained commands
  and 124 Markdown files; `git diff --check` passes.

## Controlled heap ownership

Three fresh browser runs before and after the fix use the same rolling memory
history and deterministic workload. At 10,000 and 50,000 Item Updates, retained
Evidence remains 900 records and about 7.6 MB of canonical accounted bytes.
Both current and legacy Topology indexes previously retained 5,000 then 25,000
deleted COMMAND identities. Each index now shares a 2,048-identity / 2 MiB
auxiliary-history budget across its Items. Active keys remain exact; omitted
deleted history is explicitly qualified in Context and version-1 JSON/HTML
exports. Duplicate DELETE, reactivation, oversized keys, Session changes,
snapshot clear and observation reset have focused regression coverage.

All three corrected runs retain exactly 2,048 identities in both live owners at
both checkpoints; the actual global trackers hold no extra discarded records.
All 51,500 discarded-object WeakRefs collect in every run. Runtime/history collect
after controlled disposal plus release of the mock application's owner graph.
The bounded live-fingerprint cache warms from 10,000 to 16,384 entries, accounting
for most remaining total-heap growth; browser JS heap still rises from about
122.6 MB to 149.9 MB. These are different measurements from canonical Evidence
bytes and do not establish constant total memory. The preserved report includes
raw heaps, input hashes, dominator/root paths, GC procedure and scope limits.

Independent Spec review found no blocker in the five-file fix. Three Context
geometry/axe checks and independent visual review accept the retained-count
qualification at compact, normal and shallow forced-colors geometry. The probe
excludes Chrome IndexedDB, rendering, actual MV3 process layout, real-server and
production-payload behavior, long idle sessions and cross-machine guarantees.

## Final gate commands

```sh
CI=1 LSEW_UI_PORT=4181 npm run test:ui -- --output=.scratch/panel-simplification/ui-final-darwin --reporter=line
docker run --rm --ipc=host --tmpfs /work/node_modules:exec -e CHROME_PATH=/ms-playwright/chromium-1234/chrome-linux/chrome -e LSEW_BROWSER_CACHE_DIR=/tmp/panel-simplification-browsers -e CI=1 -e LSEW_UI_UPDATE=0 -e LSEW_UI_PORT=4183 -v "$PWD:/work" -w /work mcr.microsoft.com/playwright:v1.62.1-noble bash -lc 'npm ci && npm run test:ui -- --output=.scratch/panel-simplification/ui-final-linux --reporter=line'
npm run test:ui:visual
npm run test:ui:extension
LSEW_LIGHTSTREAMER_CONTAINER=lsew-panel-simplification-fixture LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run fixture:test:browser
npm run release:package -- --out-dir=.scratch/panel-simplification/package
npm run docs:check
git diff --check
```

Intentional platform images were updated only with `npm run test:ui:update`,
including the final 37 affected Injection/Scenario scenes on each platform.
The final package gate includes type checking, all 1,974 passing unit tests,
the build and packaging audits after the heap fix. The authoring-only focus and
long-field corrections retain their meaningful browser regressions. Normal
comparison runs left all 238 recorded baseline hashes unchanged, verified after
both final 389-check runs.

## Historical publishing disposition

Earlier audit implementation, site setup and 2.0.7 package/npm/site publication
were already complete and were reconciled without repeating publication.
The prior authenticated Store record documents a 2.0.7 submission pending Google
review. At `2026-10-01 04:46 UTC`, the
[official public listing](https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf)
still shows 2.0.6. The current private API refresh was unavailable because the
credential consumer project returned `SERVICE_DISABLED`; current private review
state is not newly verified. Google approval remains externally owned.

The maintainer authorized committing this simplification batch and the subsequent
captured-update Scenario workspace to main on 2026-10-01. This integration does
not publish a new version or replace the existing Store submission.
