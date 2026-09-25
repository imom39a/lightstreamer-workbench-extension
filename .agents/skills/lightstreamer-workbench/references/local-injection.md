# Local Injection and Scenarios

## One Item Update

1. Capture the baseline app observation and Workbench committed Evidence boundary.
2. Call `prepare_local_injection` with the current `pageEpoch` and exactly one
   `evidence` identity or `scopeId`. An optional `document` is JSON text containing
   `command`, `key`, `isSnapshot` and `fields`; use the actual target schema.
3. Inspect the returned anchor, source relationship and validation. Correct an
   unexecuted agent Draft through `update_agent_document` using its current token.
   Use the replacement token. Human edits invalidate the agent's prepared version.
4. Call `execute_local_injection` with that token and a fresh stable `requestId`.
5. Read `get_operation` until it leaves pending. Repeating the same request id
   retrieves the operation; it must not create another delivery. Partial, failed,
   blocked and unknown outcomes require diagnosis. A new request id is a new
   deliberate experiment, never a transport retry.
6. Verify corresponding Local Evidence and the concrete app behavior separately.
   `DELIVERED LOCALLY` with unretained Evidence is not an Evidence-backed success.
7. `finish_agent_document` closes only an unchanged, completed agent-owned document.
   Existing human Drafts are protected; conflicts require resolution in Workbench.

## Ordered reproduction

Use `prepare_scenario` with 1–100 explicitly chosen Steps on the same exact target.
Each Step has an Evidence source or Scope, optional JSON document and `delayMs`.
Review validates COMMAND Steps in their planned order, so an UPDATE can follow a
planned ADD. Inspect validation and the returned immutable Run before executing.
Use `update_agent_document` with `stepId` to correct an unexecuted Step.

Use `control_scenario` with exact `runId`, action and a fresh `requestId` for
each new deliberate command. After a timeout, call `get_operation` with the
original request id for its receipt and `get_scenario_trace` for progress.
Repeating the identical control with the same id returns its original receipt;
never use a new id to retry a lost reply. An unknown operation after remount
cannot establish non-delivery and stops further dispatch until resolved.
`step` is useful for observing the app after each update; `play` runs frozen
relative delays. `pause` prevents the next dispatch, and `stop` ends scheduling.
Neither rolls back an update already delivered. Query `get_scenario_trace` for
per-Step outcomes and Evidence references.
Continue with `nextOffset` when the returned Step/trace page is incomplete.
Large document previews can be explicitly omitted; inspect the visible Draft or
request a smaller page instead of assuming an omitted document has no fields.

Keep Workbench visible. Hiding it pauses scheduling. A changed listener set or an
interleaving Server Update can pause for drift: inspect the new Evidence before
deliberately using `re-review`. Partial delivery, unknown delivery, unavailable
Evidence and retired targets stop progress. Do not bypass these states through
page globals, raw callbacks, direct WebSocket writes or an automatic new Run.

Scenario checkpoints concern Workbench facts; application DOM assertions belong
to the browser tool. These tools do not set arbitrary app state or server state.
