# Server Injection Message Recipe UI evidence

Status: implementation and contributor verification complete; independent visual QA and explicit maintainer approval pending.

## Change record

- **Class:** Material UI.
- **Journey:** author a Client Message from inbound Item Update Evidence, understand why the body cannot be inferred, deliberately apply one application-owned Message Recipe, edit and review the exact `sendMessage` arguments, and send once.
- **Boundary:** a Message Recipe prepares a Draft only. Workbench does not define the application message contract, contact a Data Adapter directly, auto-apply a recipe, or auto-send.
- **Fallback:** when no recipe is exposed or matched, manual authoring and captured outbound Client Message cloning remain available with visible guidance.

Acceptance criteria:

1. An empty authored Draft says that the message must be accepted by the application's Metadata Adapter and that an inbound Item Update cannot be generically translated into a Client Message.
2. The inspected application receives only bounded Lightstreamer context and may synchronously return at most 12 validated recipes.
3. A recipe changes the Draft only after its **Use …** action. Its exact body, sequence, timeout, and enqueue choice remain editable and pass through the existing Review and one-send boundary.
4. Missing, incompatible, throwing, asynchronous, malformed, duplicate, or oversized recipe output cannot bypass validation or block manual authoring.
5. The fixture proves selected beta snapshot Evidence → recipe → qty edit `20` to `25` → `sendMessage` → Metadata Adapter validation → Data Adapter COMMAND `UPDATE` → subscribed official client at version `2`.
6. The new semantic region remains keyboard reachable, accessible, bounded, and visually consistent with the existing plain-ledger Server Injection document.

## Deterministic browser matrix

The existing five-state Server Injection matrix remains unchanged. One state was added:

| Scenario | Viewport | Theme | Purpose |
| --- | ---: | --- | --- |
| `server-injection-recipe-normal-light` | 900×700 | Light | empty authored guidance, available application recipe, explicit Use action, and protected target |

The complete Server Injection visual packet now contains six states. `npm run test:ui:visual -- --grep server-injection-` produced six reference/current/diff trios with `0.0%` delta, zero browser diagnostics, zero shell/document horizontal overflows, zero serious or critical axe findings, and visible unobscured focus in every state. The contributor inspected the new Darwin and pinned-Linux baselines; neither shows clipping, overlap, ambiguous hierarchy, or an obscured action.

## Verification results

- `npm test` — 1,451 ordinary and 165 IndexedDB tests passed; one IndexedDB test skipped.
- `npm run typecheck` — passed.
- `npm run build` — passed; the Server Injection document remains lazy at 10.14 kB (2.96 kB gzip).
- `CI=1 npm run test:ui` — 203/203 behavior and Darwin baseline checks passed.
- Darwin `CI=1 npm run test:ui:update -- --grep "visual baseline: server-injection-recipe-normal-light"` followed by the read-only comparison — passed.
- Pinned Linux update and read-only comparison in `mcr.microsoft.com/playwright:v1.62.1-noble` for the new recipe baseline — passed.
- `npm run test:ui:visual -- --grep server-injection-` — 6/6 packet scenarios passed.
- `npm run fixture:test` — fixture smoke and Local Injection transport proofs passed; 9/9 loaded-extension journeys passed, including the real recipe-authored qty round trip.
- `npm run test:ui:extension` — passed the production panel smoke, two-panel isolation, and disposal checks.
- `npm run test:site` — 5/5 public-site browser checks passed.
- `npm run docs:check` and `npm run site:check` — passed; 18 static pages verified.
- `git diff --check` — passed before the final audit.

## Intentional baseline changes

Two new files are added: the Darwin and pinned-Linux baselines for `server-injection-recipe-normal-light`. All five prior Server Injection packet images compared at `0.0%` delta. No pre-existing baseline was regenerated.

## Required independent outcome

The independent reviewer receives the acceptance criteria above, `test-results/workbench-visual-qa/manifest.json`, the six Server Injection packet trios and contact sheets, and both new platform baselines without implementation rationale. The reviewer records clipping, reachability, hierarchy, keyboard/focus, application-owned boundary clarity, and platform-rendering findings.

This Material UI change is not release-ready until that review passes and the primary maintainer explicitly approves it. No Workbench UI Standard exception or amendment is requested.
