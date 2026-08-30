# COMMAND projection UI removal evidence

Date: 2026-08-29. Internal Project item: `projection-ui-01 — Remove user-visible COMMAND projection comparison` in [Project #2](https://github.com/users/imom39a/projects/2).

Classification: **Material UI**. The maintainer decided that a general reconstructed COMMAND-state view does not give enough value to a Lightstreamer developer. The change removes that view instead of replacing it with an empty state, neutral message, or another doorway. The same change removes the separate standalone Local Injection Review step and keeps the exact target, validation, local-only boundary, Source comparison, and delivery action on the Draft surface.

## Changed workflow and acceptance

- No Subscription shows a general COMMAND projection section or a `Compare COMMAND projections` action.
- Ordered Evidence remains the source for captured `ADD`, `UPDATE`, and `DELETE` operations, key identities, snapshot/live phase, Fields, and diagnostics.
- Internal derived COMMAND state remains available to Draft validation, Scenarios, Checkpoints, and diagnostics. The UI does not present this derivation as current or authoritative server state.
- A captured Local Injection Draft opens with **Compare Source** active. The developer can close and reopen this comparison.
- A source-free authored Draft shows only its editable Draft. It does not show a disabled or irrelevant comparison control.
- The Draft surface shows the exact target, Session, Source or authored state, validation, expected delivery, and local-only boundary before **Inject locally**.
- **Inject locally** freezes and revalidates the Draft and target before one delivery attempt. Invalid, stale, failed, partial, and uncertain results retain their existing fail-closed behavior.
- Scenarios keep their explicit Review because Review seals an immutable multi-Step Run.

The Workbench UI Standard and directly affected workspace, density, keyboard, visual-semantics, developer-journey, architecture, public documentation, store copy, and release notes were updated in the same change.

## Browser and visual evidence

The deterministic matrix covers captured and authored Drafts at compact, normal, shallow, and wide geometry in Dark, Light, and forced colors. It also covers selected COMMAND Evidence, high-volume Evidence, delivered Local Evidence, Scenario editing, failure states, and the absence of the removed projection doorway.

Intentional Darwin and pinned-Linux baseline changes:

- removed `wide-command-comparison-light` and `wide-matching-summary-light`;
- removed the obsolete `shallow-authored-review-dark` state;
- added direct authored-Draft shallow states in Dark and forced colors;
- added captured-Draft preview and comparison states at compact, normal, and wide geometry.

The final maintained packet at `test-results/workbench-visual-qa/manifest.json` contains 83 reference/current/diff captures. It reports zero browser diagnostics, zero shell or document overflows, zero serious or critical axe findings across 76 checked states, and visible unobscured controls across 67 focus-checked states.

The first independent visual review found two material problems in the shallow authored Draft: the editable JSON looked blank and an irrelevant **Compare Source** control appeared for a source-free Draft. The implementation then made the JSON visible, removed the source-free comparison control, reduced the shallow header, and kept the protected boundary in one compact row. The obsolete Review baselines were deleted. The final independent review passed with no material findings. It confirmed that authored JSON is readable in Dark and forced colors, captured comparison remains available, compact Scenario editing remains bounded, and no COMMAND projection doorway remains.

## Verification results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 127 files passed; 1,607 tests passed and 1 skipped |
| `npm run test:ui` | Full read-only Darwin comparison passed after the intentional baseline update |
| Darwin targeted baseline update and read-only comparison | Three changed captured-Draft states passed |
| Pinned-Linux targeted baseline update and read-only comparison | Three changed captured-Draft states passed |
| `npm run test:ui:visual` | 83/83 captures passed; zero diagnostics or overflows; zero serious/critical axe findings |
| `npm run test:ui:extension` | Production DevTools panel, two Panel Sessions, and controlled disposal passed |
| `npm run fixture:test:browser` | Transport proof and all 7 official-client panel journeys passed |
| `npm run site:check` | 17 static pages passed the isolated-route, local-asset, policy-link, and no-tracking checks |
| `npm run test:site` | 5/5 public-site browser checks passed |
| `npm run docs:check` | Passed |
| `npm run release:package` | Passed; final ZIP is 435,767 bytes, below the 1 MiB budget |
| `git diff --check` | Passed before the final evidence record |

## Review outcome

Independent visual QA: **PASS — no material findings after the shallow authored-Draft correction**. Maintainer approval is recorded in the decision to remove the projection UI and use the direct Draft surface.

The visual packet is ignored by git. It contains deterministic fixture data only and no private production Capture data.
