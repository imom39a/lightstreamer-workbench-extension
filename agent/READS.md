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
- Compact reads, including `search_scope` and summaries, default to **8192 bytes**
  for the serialized MCP `CallToolResult` (compatibility text plus structured
  data, including escaping). `maxBytes` allows 4096–65536 bytes. JSON-RPC framing
  is additional. These byte counts are not model-token estimates.
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

`describe_stream` remains a bounded field-shape profiler, not a counting query.
`wait_for_evidence` remains a bounded observation primitive. They do not inherit
the new `where`, `fields` or 8 KiB read budget options in this slice. No current
COMMAND-state export, application-specific schema engine, or new mutation tool
is introduced.

## Verification

The compact-query regressions use the real panel service and Event History.
The efficiency proof launches the built stdio MCP executable, sends actual MCP
calls through an isolated loopback broker, and routes them into the real panel
service/runtime with synthetic retained Evidence. It checks unrelated-Scope
exclusion, selected fields, response bytes, and stable continuations after new
Capture. It is not a model-token benchmark or a substitute for the separate
installed-package/loaded-Chrome proof.

```sh
npm run agent:build
npx vitest run tests/agent-read-contract.test.ts tests/agent-compact-query.test.ts tests/agent-mcp-budget.test.ts tests/agent-mcp-efficiency.test.ts --maxWorkers=1 --no-file-parallelism
```

CI also runs `agent:test:extension` with the installed npm artifact and a loaded
Chrome panel on Windows, macOS and Linux. The package and Chrome checks do not
publish from a development branch.
