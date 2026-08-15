# Diagnostics release evidence

Date: 2026-08-15

Scope: `diagnostics-impl-02` through `diagnostics-impl-06`, including committed-observation coordination, contextual presentation, Subscription/topology diagnostics, anomaly follow-up, and the Material UI release matrix. The implementation candidate before this evidence record is `232a558`.

## Integrated behavior

- Client `onServerError` and `onServerKeepalive` callbacks are observed without changing listener identity, `this`, arguments, return values, or thrown values. Their dedicated payloads are bounded and omit generic raw arguments. Server-error text uses a positive allowlist; Bearer values, labelled tokens, query secrets, and unlabelled high-entropy values are irreversibly redacted.
- Keepalives produce a deterministic first occurrence plus fixed Session/window aggregation. Each closing window retains its own bounded Client/Session attribution across a Session transition. They never imply a connection-health verdict. A missing exact Session remains an explicit limitation.
- One diagnostic journal owns normalized occurrence/condition lifecycle in memory and IndexedDB. One authoritative History Clear advances it exactly once, clears producer caches, latches, diagnostic Filter state, and churn windows, and emits one cleared subscriber transition; replay builds fresh producers and adopts them atomically.
- Committed Evidence and topology boundaries drive immutable Subscription inputs. Exact duplicate, semantic overlap, listener churn, mode/buffer/snapshot lint, late attachment, observation-path limits, unsupported shapes, lower capacity, and terminal History remain bounded and scope-relevant.
- Snapshot, COMMAND, and lost-update diagnostics use exact establishment epochs and committed evidence. Resubscription resolves prior-epoch conditions without cross-resolving another producer.
- Context owns affected-object explanation, stable multi-valued diagnostic Code/Severity/Affected Include and Exclude filtering, affected-Scope routes, and supporting-Evidence routes. The footer owns only global/current Session/runtime/History relevance. Exact Evidence lookup is authoritative beyond the 256-envelope presentation cache and reports Clear/eviction unavailability explicitly; Back restores the prior investigation.

## Deterministic test proof

All commands used Node 25.9.0.

| Gate | Result |
| --- | --- |
| `npm test` | PASS — 107 ordinary files, 1,288 tests; 13 serialized IndexedDB files, 219 passed and 1 expected skip. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS — MV3 CSP, local scripts, React panel, lazy editor, and both self-contained content scripts verified. |
| `npm run docs:check` | PASS — 4 documents and 10 maintained commands. |
| `npm run site:check` | PASS — 16 static pages verified. |
| `npm run release:package` | PASS — full package workflow completed and emitted `release/lightstreamer-workbench-v2.0.1.zip`. |
| `LSEW_BROWSER_CACHE_DIR=... npm run test:ui:extension` | PASS — two same-tab DevTools panels retained separate ordered journals, authentic panel disposal cleaned only its journal, and the production panel exposed semantic Scope, Evidence, and Context. |
| Exact Node 25 Darwin `CI=1 npm run test:ui:update` then `CI=1 npm run test:ui` | PASS — independent 148/148 baseline update and 148/148 comparison. |
| Exact Node 25 pinned Linux `CI=1 npm run test:ui:update` then `CI=1 npm run test:ui` | PASS — independent 148/148 baseline update and 148/148 fresh-container comparison. |
| Exact Node 25 / Chrome for Testing 151 `npm run test:ui:visual` | PASS — 60/60 current/reference/diff captures; 49 axe-checked states, 31 focus-checked states, zero browser diagnostics, shell/document horizontal overflows, or serious/critical axe violations. |

The production extension proof loaded the official Lightstreamer client fixture and exercised the shipped instrumentation boundary. Focused callback tests also prove listener installation before, after, and dynamically during client use; proxy removal identity; callback parity; safe payload bounds; Session attribution; aggregation; memory/IndexedDB persistence; and Clear/replay behavior.

## Material UI evidence

Classification: **Material UI**. The tracked matrix and generated packet cover:

- server error and keepalive callback diagnostics at compact Dark, normal Light, shallow forced-colors Dark, and wide Light geometries;
- exact duplicate, semantic overlap, listener churn, and RAW/non-RAW Subscription lint at the same four proportional geometries;
- resubscription, incomplete snapshot phase, unknown COMMAND key update, and lost updates at the same four proportional geometries;
- late-attachment, observation-path, lower-capacity, and terminal-History limitations in the integrated matrix;
- Evidence routing, Back restoration, multi-valued diagnostic Filter facets, contextual ownership, bounded footer scrolling, focus, and forced-colors meaning.

The generated packet is at `test-results/workbench-visual-qa/manifest.json`; its current/reference/diff contact sheets are under `test-results/workbench-visual-qa/contact-sheets/`. It records headless Chrome 151.0.7922.138, non-interactive evidence mode, 60/60 captures, 49 axe-checked states, 31 focus-checked states, zero browser diagnostics, zero horizontal overflows, and zero serious/critical axe violations. All 12 server, Subscription/topology, and anomaly states have axe and focus evidence and appear in the contact sheets. The eight Context-owned Subscription and anomaly images were also inspected individually at original resolution; compact, normal, shallow forced-colors, and wide layouts preserve a usable Evidence workspace and a reachable `Open Scope Context` action.

## Known limitations preserved as product truth

- A callback without a committed Session identity is attributed only as far as captured Evidence permits.
- Keepalive aggregation describes observed callback frequency, not connection health or server liveness.
- Historical comparison uses saved committed latches only; unavailable getters remain explicitly unavailable.
- Capture attached after application activity cannot reconstruct earlier callbacks or topology.
- Lower-capacity and terminal History conditions retain their dedicated footer ownership and do not duplicate contextual diagnostic cards.

Fresh independent Spec, Standards, and Visual reviews must target the final commit containing this record and the packet-generator integration; their dispositions belong in the implementation tickets.
