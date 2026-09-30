# Efficient Evidence reads

Read contract **2** is a small set of composable reads over Workbench's existing
Lightstreamer model. Check `get_status.readContract.version` and `capabilities`
on the intended Panel Session before using it. Use matching extension and
companion builds; reload the extension and reconnect MCP to refresh tool schemas.
Installing a new companion alone does not update Chrome.

## Building blocks

| Question | Tool | Result |
| --- | --- | --- |
| Which Subscription or item? | `search_scope` | Exact `scopeId`, kind, label and ancestor path |
| How many records / which keys? | `summarize_evidence` | Counts and optional distinct facet values; no events |
| Show a few matching examples | `query_evidence` | Compact matching records and exact Evidence identities |
| Find this text in that Scope | `search_evidence` | Matching records with shareable match explanations |
| Read more from this one example | `get_evidence` | One exact retained record, with selected fields if requested |
| Inspect one derived COMMAND key | `query_command_state` | Exact item/key, chosen projection, certainty and Evidence provenance |
| Wait for an existing operation receipt | `wait_for_operation` | Bounded receipt completion without repeating execution |

Filtering, indexed counting, field projection and paging execute in the
extension's owning DevTools panel. The companion validates and routes calls and
applies a final response-size cap. It does not maintain another Evidence store,
replicate the Lightstreamer model, or download events to compute counts.

## One short investigation

After `list_panel_sessions` and `get_status`, locate a Subscription:

```json
{"panelSessionId":"<panel>","text":"customerDetail","kind":"subscription"}
```

Use the exact `scopeId` returned by `search_scope`, not a guessed Subscription
label. `parentScopeId` optionally restricts search to direct children of a known
Scope. Structural items are not COMMAND keys.

Ask `summarize_evidence` for the observed key values:

```json
{"panelSessionId":"<panel>","scopeId":"<scope>","where":{"kind":["ITEM-UPDATE"],"mode":["COMMAND"]},"facet":"key"}
```

Then request a few matching examples with `query_evidence`, copying an observed
key and declared field names:

```json
{"panelSessionId":"<panel>","scopeId":"<scope>","where":{"key":["<observed-key>"]},"fields":["quantity","status"],"limit":3}
```

These are placeholders, not identifiers to send literally. Supply `at` from the
summary's `readPoint` when the examples must use the same retained boundary.
Stop once the question is answered. Use an example's exact `identity` with
`get_evidence` for more fields, or as the source of a validated Local Injection
candidate. Mutation and delivery rules are unchanged.

## Shared rules

- Fresh `query_evidence`, `search_evidence` and `summarize_evidence` require an
  exact `scopeId` or explicit `within:"page"` / `within:"current-investigation"`.
  An unscoped request fails with `SCOPE_REQUIRED`.
- `within:"current-investigation"` freezes the human's Scope and Filter. Do not
  override it with `where` or `filter`; choose your own explicit Scope instead.
  `search_evidence.text` is independent Find text within that frozen Filter.
- `where` supports `kind`, `mode`, `key`, `operation`, `phase` and `provenance`.
  Each array is OR; different facets are AND. For other canonical facets or
  exclusions, use advanced `filter.criteria` on query/summary instead. Do not
  combine those criteria with `where`. There are no arbitrary payload predicates.
- `fields` selects exact Item Update field names, not JSON paths. Each selected
  entry carries its value state; redacted, unavailable and ambiguous values are
  not invented as concrete values. Credential omission is not a general secret
  detector.
- `query_evidence`, `search_evidence` and `get_evidence` return compact metadata
  by default. `fields` and `includePayload:true` are mutually exclusive. Full
  permitted envelopes are opt-in; raw transport text and Client Message bodies
  remain omitted/redacted.
- Every tool defaults to **8192 bytes** for the serialized MCP `CallToolResult`
  (compatibility text plus structured data, including escaping). Tools that
  advertise `maxBytes` allow 4096–65536 bytes. `get_status.responseContract`
  reports these limits. JSON-RPC framing is additional. These byte counts are
  not model-token estimates. The companion enforces the final limit even when
  connected to an older panel.
- `get_status` exposes operational status only. Cached Evidence queries,
  search text, captured field values and Client Message bodies are not status.
- `list_scope` pages shrink to the byte budget; continue with its `nextOffset`,
  not the requested `limit`. Diagnostic pages similarly use `nextAfter` and
  Scenario pages use `nextOffset`. These offset/boundary pages are separate
  from the opaque Evidence cursors described below.
- For many connected panels or pending pairings, call `list_panel_sessions` or
  `get_pairing_requests` with `offset:0` to request a byte-bounded page of
  `items`, `total`, `offset` and `nextOffset`. Follow `nextOffset` until null.
  Calls without `offset` or `limit` retain their array response; if that array
  exceeds the budget, switch to paging. These connection lists are live, so
  restart discovery if panels connect or disconnect during enumeration.
- `limit` is a maximum of 100, not a promised page size. Pages shrink to fit the
  budget. A record that cannot fit yields `RESULT_BUDGET_EXCEEDED`; select fewer
  fields or deliberately choose a larger budget. Do not silently truncate values.
- Continue with **only** `panelSessionId` and `cursor`. Scope, filters, field
  selection, budget, order and read point remain bound. New Capture does not
  move that read point. To change options, start fresh without the cursor,
  optionally preserving `at`. `QUERY_OPTIONS_CHANGED` is not a signal to retry
  unchanged. Clear, retention, navigation, revocation or bounded cache expiry
  may require a fresh read.

## What counts mean

`summarize_evidence` without `facet` returns matching/in-Scope totals only.
With a canonical `facet`, it additionally returns `values`, Evidence-record
counts, `distinctTotal` and an opaque `nextCursor`. Pagination enumerates
distinct values, not all source events. Every filter remains applied, including
one on the facet being counted. This differs from the legacy UI Filter-picker
semantics of `query_evidence.discover`, which ignores that facet's own criterion.

Counts describe **retained Evidence records**, not unique logical updates or
currently active COMMAND rows. A deleted key remains a historical observed key.
One item can have many keys; the same key can occur under several items. Use an
item Scope when its identity matters. Read `coverage`, `evaluation`, read point
and discovery availability before making absence claims. Unavailable discovery
is not a zero-key result.

`describe_stream` remains a field-shape profiler, not a counting query. Its
sample may shrink to fit the byte budget; read its completeness and omissions.
`wait_for_evidence` remains an observation primitive. A match whose payload
cannot fit returns its identity with an explicit omission; use `get_evidence`
to inspect it. Neither tool inherits the `where` or `fields` options.

## One derived COMMAND key

When `query_command_state` appears in capabilities, pass the exact live COMMAND
Subscription or item `scopeId`, current `pageEpoch`, exact item name/position,
opaque `key`, and explicit `projection`: `observed-server` or `local-effective`.
Whitespace in keys is significant. Request up to 32 exact field names in
`fields`; omitted selection returns a bounded field prefix. This read leaves
the human's investigation unchanged.

The result is derived Workbench state. Inspect `presence.state`, its `basis`
and provenance before making a presence claim. Missing prior Evidence, an
Evidence Gap, or evicted historical detail can make presence `inconclusive`.
Each field carries its value state, certainty and provenance. `last-observed`
does not establish continuity through a Gap; `output-budget` and `truncated`
identify omitted detail. `evidenceRetained:false` means the referenced Evidence
can no longer be retrieved. These projections do not prove application or
Lightstreamer Server state.

If credential protection would change an opaque target identity, the read fails
with `CREDENTIAL_IDENTITY_UNAVAILABLE` rather than returning a different key as
an exact target. Inspect that target locally in Workbench; the failure includes
neither the credential nor a substitute identity.

Its canonical `readPoint` identifies the applied projection boundary. Reuse it
as `query_evidence.at` or `wait_for_evidence.after` while that boundary remains
available. Use a field's exact provenance identity with `get_evidence` to inspect
the captured basis. Older tombstones, lifecycle history and diagnostics have
explicit count and byte limits; active projected rows remain separate from
rolling Event History retention.

## Operation receipts and recovery

Large Draft and Scenario previews may omit document details explicitly while
preserving preparation tokens, identities and operation outcomes. Review the
existing document in Workbench when a preview is omitted. A lost or oversized
execution reply is never permission to repeat execution with a new request ID;
inspect the existing receipt with `get_operation`. Operation receipts remain
reserved for duplicate suppression even when the session reaches its limit.

`wait_for_operation` accepts an existing `requestId` and waits up to 20 seconds
(10 seconds by default). `COMPLETE` means the receipt settled; inspect its
operation outcome. `TIMED_OUT` leaves the current receipt pending.
`SCENARIO_CONTROL_RECEIPT` acknowledges a Scenario control, not completion of
the whole Run; use `get_scenario_trace` for Run progress. `OPERATION_UNKNOWN`
never proves non-delivery. Cancellation and revoked access stop the wait without
repeating an effect. Each agent connection can hold two combined Evidence or
operation waits and 16 pending requests; each Panel Session permits four waits.

Recoverable errors carry stable codes, including `CURSOR_EXPIRED`,
`TARGET_CHANGED`, `TARGET_RETIRED`, `ACCESS_REVOKED`, `REQUEST_CAPACITY`,
`OPERATION_BUDGET_EXCEEDED`, and `COMPANION_INCOMPATIBLE`. Rediscover or repair the
identified boundary before starting a fresh read. A mutation failure or lost
reply retains `automaticRetry:false`; inspect its existing receipt first.

`validate_agent_candidate` evaluates the complete ordered plan. If its detailed
result is too large, it returns the overall verdict and member counts with an
explicit omission. Increase `maxBytes` to retrieve details when they fit; do not
validate fragments and assume that proves the original plan is valid.

## Verification

The compact-query regressions use the real panel service and Event History.
The efficiency proof launches the built stdio MCP executable, sends actual MCP
calls through an isolated loopback broker, and routes them into the real panel
service/runtime with synthetic retained Evidence. It checks unrelated-Scope
exclusion, selected fields, response bytes, and stable continuations after new
Capture. A separate IndexedDB regression first populates the real history query
cache, then checks that status stays small through the built stdio companion.
All advertised tools, escaped error messages, page continuations and oversized
mutation previews have response-budget regressions. Tool schema discovery has
a separate 80 KiB ceiling. These checks are not model-token benchmarks or a
substitute for the separate installed-package/loaded-Chrome proof.

```sh
npm run agent:build
npx vitest run tests/agent-*.test.ts --maxWorkers=1 --no-file-parallelism
```

CI also runs `agent:test:extension` with the installed npm artifact and a loaded
Chrome panel on Windows, macOS and Linux. The package and Chrome checks do not
publish from a development branch.
