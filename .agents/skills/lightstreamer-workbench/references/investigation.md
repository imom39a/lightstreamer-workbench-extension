# Evidence-guided investigation

Use this workflow when the question depends on a sequence of Lightstreamer
updates or when an ordered Scenario is a useful reproduction. First check
`get_status.capabilities`; tool availability follows the connected panel's
matching extension and companion build.

## Discover, inspect and validate

1. Use `list_scope` / `get_scope` to read the exact Workbench `scopeId`,
   Subscription's declared fields and item identities. `describe_stream` can
   profile a bounded matching Evidence sample:
   it reports declared fields separately from observed fields, raw value types,
   JSON-encoded shapes, observed mode/provenance/phase values and exact Evidence
   references. Its `scopeIdentity` is only a stable profile grouping identity;
   it is not a Workbench `scopeId` and must not be used as one. Treat its completeness as
   sample coverage and inspect `profileOmissions` for fields, shapes, streams or
   examples the profiler bounded. Omission counters can be lower bounds when a
   bounded scan stops early. JSON array shapes describe their first element
   only; they are representative hints, not exhaustive element schemas.
   A sample never proves that an unshown field,
   operation or event does not exist.
2. Use `query_evidence` with the relevant typed `filter`, `at` read point and
   `order` to inspect the exact representative records. Include payloads only
   when field values are needed. This tranche supports free text and canonical
   Evidence-facet filters, not predicates over Item Update payload field values.
   To discover available canonical values, call `query_evidence` with the exact
   `panelSessionId`, optional `scopeId`, `limit: 1` and
   `discover: [{facet: "kind", limit: 10}, {facet: "mode", limit: 10}]`.
   Each available `discoveries.<facet>.values[].value` supplies `facet`, `type`,
   `value` and `label`. Copy those four fields into a criterion and add
   `polarity: "include"` or `"exclude"`; do not copy its internal `identity`.
   Facet discovery has its own `nextCursor`: continue it inside the same
   `discover` entry with `cursor`, pinning `at` to the returned read point and
   preserving the original scope/filter. Evidence-page continuation instead
   uses only `{panelSessionId, cursor: result.nextCursor}`.
   Choose source Evidence deliberately; a profile is a discovery aid, not an
   executable plan. Treat observed mode, provenance and phase as raw canonical
   facet values, not inferred application meaning.
3. For a one-update candidate, call `validate_agent_candidate` with
   `{pageEpoch, draft: {evidence}}` (or an explicit `scopeId`/document). For an
   ordered plan, pass `{pageEpoch, members}`. Validation reports target and
   diagnostics without publishing into a protected Draft or Scenario.
4. Inspect validation against the intended target and hypothesis. Resolve
   unavailable values and target mismatches from Workbench Evidence; never turn
   redacted, ambiguous or unavailable values into authored values.
5. Prepare the reviewed Draft with `prepare_local_injection`, or prepare the
   explicit ordered members with `prepare_scenario`. The reviewed document and
   immutable Run are the execution basis. Existing authorization covers the
   explicitly scoped experiment; do not add a separate approval request for
   each Step.
6. Run one Step at a time when each result matters. Use `control_scenario` with
   the exact `runId` and a fresh `requestId`; retrieve a prior receipt with the
   same id instead of retrying a possibly delivered operation under a new id.
7. Observe the resulting Local Evidence in Workbench, then verify the inspected
   application's DOM through the browser tool. A checkpoint evaluates
   Workbench facts; it is not an application DOM assertion or proof of server
   state.

This generic example shows the actual `validate_agent_candidate` member shape.
Every angle-bracket value is a placeholder to replace with the exact value
discovered in `get_status`, `query_evidence` or `get_scope`; the sequence number
`123` is an integer placeholder. Replace all placeholders before calling the
tool; do not send placeholder text literally.

```json
{
  "panelSessionId": "<list_panel_sessions.panelSessionId>",
  "pageEpoch": "<get_status.pageEpoch>",
  "members": [
    {
      "kind": "step",
      "id": "deliver-captured-update",
      "evidence": {
        "intervalId": "<EvidenceIdentity.intervalId>",
        "pageId": "<EvidenceIdentity.pageId>",
        "ownerId": "<EvidenceIdentity.ownerId>",
        "sequence": 123,
        "eventId": "<EvidenceIdentity.eventId>"
      }
    },
    {
      "kind": "checkpoint",
      "id": "confirm-local-evidence",
      "name": "Captured update reached the local listener",
      "assertions": [
        {
          "id": "step-produced-local-evidence",
          "kind": "correlated-local-evidence-exists",
          "stepId": "deliver-captured-update",
          "withinActiveMs": 5000
        }
      ]
    }
  ]
}
```

`prepare_scenario` accepts the same ordered `members`, `panelSessionId` and `pageEpoch` after
candidate validation. It returns the reviewed Scenario and Run. The checkpoint
above checks for correlated Local Evidence only. Use browser observation for an
application-visible result.

## Waiting for later Evidence

When `wait_for_evidence` appears in capabilities, anchor each wait with the
current `pageEpoch` and an `after` `EvidenceReadPoint`. Supply the same typed
`filter` used by `query_evidence`, a limit no greater than 100, and
`timeoutMs` from 0 through 20,000. A wait is bounded and does not replace a
query at a chosen read point. Its result carries a status, read point and bounded
Evidence records.

Handle the returned status explicitly:

| Status | Interpretation and next action |
| --- | --- |
| `MATCHED` | Inspect exact Evidence identities and `mayHaveMoreMatches`; recover omitted matches as described below. |
| `TIMED_OUT` | No match was returned during this wait; continue from the returned read point or query the retained range. |
| `CANCELLED` | The wait ended by cancellation; decide whether to start a new bounded wait. |
| `HISTORY_CHANGED` | The history interval changed; read current status and establish a new read point. |
| `HISTORY_INCOMPLETE` | An Evidence Gap or incomplete range limits continuity claims; use available recovery/checkpoint Evidence before continuing. |
| `HISTORY_UNAVAILABLE` | The requested history cannot be read; diagnose availability before relying on the wait. |
| `TARGET_CHANGED` | The page epoch changed; rediscover the target and start from its current page epoch. |
| `QUERY_FAILED` | The query did not complete; inspect the failure and retry only as a new read. |

Companion or Panel-link loss is an MCP tool error, not a wait status. While the
MCP transport remains available, it returns `isError: true` with
`structuredContent.error.code: "COMPANION_UNAVAILABLE"` and
`automaticRetry: false`. If the MCP process or stdio transport also closes, the
client may only receive a transport failure; treat that as unavailable, not as
proof of non-delivery. For an interrupted mutation, reconnect, rediscover the
exact Panel Session and inspect the existing `requestId` receipt when available.
Its outcome may remain unknown; never automatically retry it with a new id.

Never interpret a timeout, a bounded sample, or incomplete history as proof of
absence. A `MATCHED` Workbench result still does not prove that the application
rendered or accepted the update; check the same inspected tab with browser
tools.

When `mayHaveMoreMatches` is true, the newest-first wait page may omit earlier
matches after the original boundary. To recover all retained matches, call
`query_evidence` with the same scope/filter, `at: result.readPoint`, and
`order: "OLDEST_FIRST"`; follow its Evidence-page cursors and keep only records
in the original interval whose sequence exceeds the original
`after.committedEvidenceBoundary.sequence` (or zero for an empty boundary).
Do not advance the wait anchor to the returned read point until those pages
are accounted for: that would skip omitted matches. Retention or a Gap may
still make a complete reconstruction unavailable; report that limitation.

## Availability in current releases

The investigation workflow is present in this repository's source skill. The
published `lightstreamer-workbench-agent@0.1.0` package and published Workbench
extension 2.0.4 predate these tools. Use a matching source-built extension and
companion to exercise them; confirm the available names with
`get_status.capabilities`. The existing npm setup, companion process and
authentication configuration do not change for this workflow.
