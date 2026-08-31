# Server Injection Material UI evidence

Status: implementation and contributor verification complete; independent visual QA and explicit maintainer approval pending.

## Change record

- **Class:** Material UI.
- **Journey:** clone a captured Client Message or author a new one, review one exact `LightstreamerClient.sendMessage` call against the current Client and Session, submit it once, and inspect the correlated outbound outcomes in Evidence.
- **Boundary:** Server Injection sends a Client Message through the inspected client's public `sendMessage` API. It does not manufacture an inbound Server Update. The fixture's Metadata Adapter deliberately turns the test message into a real Data Adapter update only to prove the complete server round trip.
- **Protected state:** one Draft; immutable Source or authored origin; exact page epoch, client, Session, status, sequence, delay timeout, enqueue policy, and public-API provenance; one active Workbench operation across Local Injection, Scenarios, and Server Injection.

Acceptance criteria:

1. Captured Client Message Evidence remains observational and immutable. Draft edits never alter the Source.
2. Review freezes the exact target and `sendMessage` arguments. Execution revalidates that target immediately before one claimed call.
3. Disconnected, retired, changed, or non-public-API targets block without attempting delivery. No relay fallback or automatic retry can follow a possibly executed call.
4. Sent, Processed, Denied, Discarded, Aborted, Error, and Unknown outcomes use the normal Capture pipeline and retain request correlation. Processed is not described as proof of an application-side effect.
5. Unknown permits only a separate deliberate Repeat with fresh identities. Edited Draft discard requires inline confirmation and restores focus on cancellation.
6. Compact, normal, shallow, and wide geometry; Dark, Light, and forced colors; keyboard focus; accessible names and states; large messages; and degraded targets remain usable without shell overflow.
7. Bulk Evidence copies redact Client Message body, response, and denial/error text. A deliberate single-Evidence raw copy remains available.

## Deterministic browser matrix

| Scenario | Viewport | Theme | Purpose |
| --- | ---: | --- | --- |
| `server-injection-edit-compact-light` | 563×700 | Light | authored editing, explicit arguments, bounded document |
| `server-injection-review-normal-dark` | 900×700 | Dark | immutable exact-call Review and single submit action |
| `server-injection-degraded-shallow-light` | 900×320 | Light | disconnected target and visible blocked reason |
| `server-injection-unknown-shallow-forced-dark` | 900×320 | Dark + forced colors | uncertain terminal state and deliberate Repeat boundary |
| `server-injection-high-volume-wide-light` | 1440×900 | Light | message larger than 64 KiB and one document scroll owner |

`npm run test:ui:visual -- --grep server-injection-` produced five reference/current/diff trios plus contact sheets under `test-results/workbench-visual-qa/`. The manifest records `5/5` captures, zero browser diagnostics, zero shell/document horizontal overflows, zero serious or critical axe findings, and visible unobscured focus in all five states. The contributor manually inspected the ten Server Injection Darwin/Linux baselines and the five Darwin packet trios.

## Verification results

- `npm run typecheck` — passed.
- `npm test` — 1,612 passed and one skipped across the ordinary and IndexedDB suites.
- `CI=1 npm run test:ui:update` — 202 browser checks passed while intentionally writing the affected Darwin baselines.
- `CI=1 npm run test:ui` — 202/202 behavior and Darwin baseline checks passed in the final read-only run.
- `CI=1 npm run test:ui -- --grep "visual baseline:"` — 83/83 Darwin comparisons passed read-only.
- Pinned Linux `CI=1 npm run test:ui -- --grep "visual baseline:"` — 83/83 comparisons passed read-only in `mcr.microsoft.com/playwright:v1.62.1-noble`.
- `npm run test:ui:visual -- --grep server-injection-` — 5/5 packet scenarios passed.
- `npm run test:ui:extension` — passed the built MV3 panel smoke, two-panel isolation, and disposal checks.
- `CI=1 LSEW_BROWSER_CACHE_DIR=.cache/lsew-browsers npm run fixture:test:browser` — 8/8 loaded-extension journeys passed in one run. The Server Injection journey proved client → Metadata Adapter → Data Adapter → subscribed official client, with exactly one page-bridge claim.
- `npm run test:site` — 5/5 public-site browser checks passed.
- `npm run docs:check` — passed with 18 static pages.
- `npm run build` — passed. The Server Injection document remains a lazy 9.07 kB production chunk.
- `git diff --check` — passed.

The full fixture run initially revealed that its new server-published value could influence later tests sharing the same COMMAND item. The fixture now uses the dedicated `scenario.server-injection` item, retaining a real server round trip while keeping every existing journey's initial snapshot deterministic.

## Intentional baseline changes

Five new Server Injection baselines were created for each maintained platform. Existing scenarios also changed where the truthful public-API target now exposes **Author Client Message**, reviewed Scenario fingerprints include the fuller target identity, or bulk-copy privacy text explains Client Message redaction.

The resulting working tree contains 29 Darwin baseline changes (24 existing plus five new) and 83 Linux baseline changes (78 existing plus five new). The pinned Linux update normalized additional renderer output beyond the semantic Darwin set; the complete 83-image read-only Linux comparison passes against that regenerated set. This broad platform refresh must be included in independent review rather than treated as automatically accepted.

## Required independent outcome

The independent reviewer receives the acceptance criteria above, `test-results/workbench-visual-qa/manifest.json`, its reference/current/diff artifacts and contact sheets, the ten Server Injection platform baselines, and the complete list of changed existing baselines without implementation rationale. The reviewer records clipping, reachability, hierarchy, forced-color meaning, keyboard/focus, high-volume behavior, and any platform-rendering findings.

This Material UI change is not release-ready until that review passes and the primary maintainer explicitly approves it. No Workbench UI Standard exception or amendment is requested.
