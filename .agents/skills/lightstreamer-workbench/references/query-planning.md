# Answer questions about an unfamiliar stream

Use this guide when a user asks about captured data and the application's
Subscriptions or field meanings are unfamiliar. Workbench supplies Lightstreamer
structure and Evidence; application code, an application guide, or the user
supplies business meaning.

## Discover enough context

Select the intended Panel Session and check its `get_status` capabilities,
Observation Coverage, retention and Evidence Gaps. Use `search_scope` for a known
item or Subscription label; otherwise browse a bounded `list_scope` page.
Do not assume the source uses COMMAND or a particular key/model convention.

Call `get_scope` with an exact returned `scopeId`. Its `readContext` gives source
identities, adapter names, mode, an exact item when selected, and configured
schema independently of Local Injection availability. A Subscription with
multiple items has `item:null`; discover its items with `search_scope`, narrowing
by `kind:"item"` and `parentScopeId`. An unavailable injection target does not
prevent scoped Evidence reads.

`readContext.schema` distinguishes:

- `declared-field-list`: exact field names in declaration order. Follow
  `nextOffset` with another `get_scope`, the same `scopeId`, and
  `fieldOffset:nextOffset` for more names. `fieldLimit` is 1–32. A page of names
  is not the whole schema when `nextOffset` is present.
- `named-field-schema`: a server-side schema name, with unresolved field names.
  Inspect the application's Subscription setup or mapping before using field
  predicates. Do not turn positional names or a schema identifier into guessed
  application properties.
- `unavailable`: Workbench has no declared list or schema name for this Scope.
  Read available Evidence and application context; report the missing schema.

Configured second-level COMMAND fields appear separately in
`readContext.secondLevelSchema`. They are also eligible for exact declared-field
queries. Its field-name page uses the same `fieldOffset`/`fieldLimit`; follow
that schema's `nextOffset` when more second-level names are needed.

`readContext` describes current Topology, not a historical schema at `at`.
Older panels may omit it. Use `describe_stream` and an exact example's permitted
Subscription metadata as the fallback; missing context does not imply an empty
schema.

Profile a small scoped sample with `describe_stream` to learn observed value
types, value states, encoded JSON shapes and representative Evidence identities.
It accepts typed `filter.criteria`, rather than `where`. For Item Updates use
`{facet:"kind",polarity:"include",type:"enum",value:"ITEM-UPDATE"}`.
Its `scopeIdentity` is a profile group, not a usable Workbench `scopeId`.
Inspect selected fields from an example with `get_evidence`. Profile omissions,
array shapes and a bounded sample do not establish a complete payload schema.
On a profile budget error, use its measured `maxBytes` suggestion or narrow to
one item and selected-field reads.

## Choose the read from the question

| User needs | Appropriate read | Meaning to preserve |
| --- | --- | --- |
| How many retained records, or which keys/operations occurred? | `summarize_evidence`, optionally with a facet | Evidence records; historical keys include deleted keys. |
| How many Logical Updates, or counts grouped by a field/time bucket? | `aggregate_evidence` with an explicit `unit` | Listener deliveries can duplicate a Logical Update; inspect missing IDs and group omissions. |
| Examples whose fields satisfy a condition | `query_evidence` with `fieldPredicates` and selected `fields` | Historical observed field values, including their certainty. |
| Where does a name or phrase occur? | `search_evidence` in a relevant Scope | Case-insensitive substring matches; confirm identity from fields and application context. |
| Which COMMAND rows exist, or what is one key's derived value? | `query_command_rows`, `query_command_keys`, or `query_command_state` | Exact item, current page epoch and explicit observed-server/local-effective projection. |
| What changed during a sequence? | Scoped ordered Evidence with `sequenceWindow` | Committed order, not a causal link to an application action. |
| Did a later event arrive? | `wait_for_evidence` from an exact read point | A bounded wait; timeout cannot establish absence. |
| Did the application display or accept a value? | Browser observation of the same inspected tab | Workbench Evidence and delivery do not prove UI or server state. |

MERGE, DISTINCT and RAW Evidence is queryable. The COMMAND projection tools do
not reconstruct those modes. A newest matching historical update is not an
authoritative current application value, especially when updates omit fields,
retention has advanced, or Capture coverage is limited.

## Form predicates from actual fields and types

`where` selects canonical facets: kind, mode, key, operation, phase and provenance.
Use summary-returned values. Arrays OR within a facet; facets AND together.
For other facets or exclusions, copy a summary value's `facet`, `type`, `value`
and `label` into `filter.criteria`, adding `polarity`. Do not combine those
criteria with `where`.

`fieldPredicates` combines conditions with AND over exact declared Item Update
fields. Operators are `eq`, `in`, `exists`, `value-state`, `changed` and `range`.
Equality preserves types. Ranges require `type:"number"` or `type:"string"`;
numeric strings need explicit `convert:"number-string"`. Inspect
`fieldEvaluation` for conversion failures or unavailable fields. Null comparisons
match concrete null only; ambiguous null and redacted values remain uncertain.

For example, after discovering a declared numeric-string field, a query can use
this shape. Replace every placeholder with a discovered identifier and the
user's actual threshold before calling the tool:

```json
{
  "panelSessionId": "<selected panel>",
  "scopeId": "<discovered item scope>",
  "where": {"kind": ["ITEM-UPDATE"]},
  "fieldPredicates": [
    {"field": "<declared field>", "op": "range", "type": "number", "convert": "number-string", "min": 10}
  ],
  "fields": ["<declared field>"],
  "limit": 3
}
```

Fields and predicates do not accept nested JSON paths. When a relevant property
is inside an encoded JSON field, narrow by verified Scope, key, model field or
text first, then inspect that field in bounded matching examples. Report sample
coverage instead of claiming a nested-property count that the engine cannot
compute. Do not scan the whole history to emulate an unsupported query.

Reuse an earlier `readPoint` as `at` when comparing counts and examples at the
same retained boundary. Continue cursors with only `panelSessionId` and `cursor`;
start a fresh query to change predicates, fields, Scope or limits. Use
`read_bundle` if several supported facts must align at one boundary.

## Resolve business meaning only when it is missing

Read [application-context.md](application-context.md) when field names, model
identifiers or key suffixes do not establish the requested meaning. Ask a
focused question only for a material unresolved choice: which entity/stream,
what a field or model represents, which count unit/time window the user wants,
or which projection includes Local Injections. Continue independent discovery
while waiting. Do not ask the user to supply facts already available through
Workbench or the application code, and do not invent mappings from names.

Before reporting a business conclusion, confirm the entity with verified values
or a stable identifier. A single text hit or `NO_SHAREABLE_EXCERPT` does not do
that. Report the selected source, query conditions, read boundary, count unit
and any coverage or value-certainty limit that affects the answer.
