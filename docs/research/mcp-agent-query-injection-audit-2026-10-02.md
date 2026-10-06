# MCP agent query and injection audit

October 2, 2026. Reviewed repository commit `22943ba2eb158d2cfb6cc02d7117e0ef7800fdef`, extension 2.0.7, companion 0.1.6, and installed MCP SDK 1.30.1.

Workbench already provides a useful foundation for agents to investigate retained Lightstreamer Evidence and run deliberate Local Injection experiments. The strongest improvements are to make its recommended scoped queries use selective indexes, make generated Item Update change flags faithful to the chosen delivery semantics, and make document preparation recoverable after cancellation or a lost reply. Increasing the number of tools before addressing these issues would increase capability without making the agent loop dependable.

This report ranks improvements by their expected effect on agent reliability, large-history work, developer usefulness, and implementation effort. The ranking and effort estimates are engineering judgments. Each finding distinguishes reproduced behavior, a source-backed limitation, and a proposed capability. Domain neutrality here means application neutrality within Lightstreamer: the core understands Subscriptions, items, fields, keys, updates, snapshots, delivery and Evidence, while application meaning stays outside it.

## Scope and verification

The review followed the stdio MCP server through the loopback broker, panel service, canonical Evidence query adapter, memory and IndexedDB histories, Local Injection coordinator, Scenario authoring and checkpoints, and page listener delivery. It also examined the bundled agent workflow and relevant architectural decisions.

- `npm run agent:build` completed.
- All 31 existing `tests/agent-*.test.ts` files passed, with 185 tests. This includes the built stdio companion and real panel runtime over a synthetic 10,000-record memory history.
- Three additional history query regression files passed, with 35 tests.
- Seven existing injection and Scenario suites passed, with 200 tests. Across the three groups, 420 existing tests passed.
- Three temporary audit probes reproduced cancelled preparation leaving protected documents and request saturation blocking status/stop. The probes were removed from the repository afterward.
- Disposable probes used unmodified production query implementations with 2,000 synthetic records, including fake IndexedDB, and production injection document functions. They establish operation counts and contract behavior, not Chrome latency or a live application's response.

No production implementation was changed and no live page Injection was performed. This is Non-UI work. Loaded-Chrome MCP performance at the 100,000-record normal limit and 25,000-record memory limit was not newly verified in this audit. Existing unit tests passing does not establish those performance properties.

## Current capabilities worth preserving

The companion routes into the owning Panel Session; it does not maintain another Event History or COMMAND state engine. The interface already supports structural Scope discovery, compact Evidence queries, text search, exact lookup, selected fields, counts and distinct facets, bounded stream profiles, exact derived COMMAND key reads, candidate validation, Draft preparation, ordered single-target Scenarios, checkpoints, and bounded Evidence/operation waits. [Tool contract](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/protocol.ts#L64), [read workflow](../../agent/READS.md).

Fresh reads require an explicit Scope or page/current-investigation boundary. Opaque continuations bind the query, selected fields, byte budget, page epoch and committed read point. New Capture does not move that boundary. Agent reads preserve the human's Scope, Filter, Find and selection. Retention Advance, Evidence Gaps and Observation Coverage have distinct meanings. Counts represent retained Evidence records; they are not automatically logical update counts or active COMMAND row counts.

Responses already contain structured JSON and compatibility text, with a default 8 KiB serialized MCP result limit and an advertised maximum of 64 KiB. Effects reserve request IDs before dispatch, suppress repeated same-signature execution, and reject changed targets or human edits. The generic core already distinguishes Observed Server COMMAND State from Local Effective COMMAND State. These are valuable contracts to extend, not replace. [Results and budgets](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/tool-result.ts#L1), [agent ownership decision](../adr/0016-panel-owned-agent-access.md).

## Ranked opportunities

Effort is relative: S means a bounded contract or adapter change; M crosses a few existing modules; L requires broader storage or delivery design and browser verification. Priority describes recommended sequencing, not a GitHub triage label.

| Rank | Opportunity | Evidence classification | Priority | Effort | Main benefit |
| --- | --- | --- | --- | --- | --- |
| 1 | Preserve selective indexes for scoped reads and continuations | Reproduced work amplification | P1 | M | Large histories stop penalizing the recommended narrow queries |
| 2 | Make generated change flags faithful to Item Update semantics | Reproduced fidelity limitation | P1 | M | Changed-field listeners receive a meaningful experiment |
| 3 | Recover preparation and editing after cancellation or lost replies | Reproduced cancellation defect and recovery gap | P1 | M | Agents can recover without stranded protected documents |
| 4 | Fit byte budgets once and bound query computation | Reproduced repeated work plus proposed work limits | P1 | M to L | Small responses also have predictable execution cost |
| 5 | Reserve admission for status, receipts, pause and stop | Reproduced capacity limitation | P1 | S to M | Heavy reads do not block inspection or stopping a Run |
| 6 | Add delta reads, correlated receipts and Scenario progress waits | Source-backed orchestration opportunity | P2 | M | Agents observe each experiment without rescanning or polling |
| 7 | Generate deterministic candidates and test matrices from declared schemas | New application-neutral capability | P2 | M | Less JSON authoring and reproducible event generation |
| 8 | Add bounded field analytics and current COMMAND row discovery | New application-neutral capability | P2 | M to L | Agents answer large-history questions without downloading events |
| 9 | Combine dependent reads at one explicit boundary | New orchestration capability | P2 | M | Fewer calls and more consistent comparisons |
| 10 | Make schemas, recovery errors and workflow guidance precise | Reproduced schema mismatch and contract opportunities | P2 | S to M | Fewer invalid calls and better automatic recovery choices |
| 11 | Extend authoring modes and temporal assertions deliberately | Optional product expansion | P3 | L | Broader local tests with explicit fidelity and coverage limits |
| 12 | Add reviewed agent Server Injection through normal Client Messages | Optional expansion requiring an ADR change | P3 | L | Agent-assisted backend experiments using the actual application contract |
| 13 | Add optional MCP resources and modern protocol integration | Host-dependent integration opportunity | P3 | M to L | Better host integration after the core workflow is dependable |

## Evidence from the query probes

The fixture accepted 2,000 COMMAND Item Updates, alternating between the target and an unrelated Subscription. Each Subscription had 1,000 records; every hundredth record had key `RARE`, giving 20 rare-key matches, all in the target. Both storage adapters returned correct matching identities. The difference below is computation, not demonstrated result corruption.

| Request | IndexedDB projection reads | Memory projection reads | Returned |
| --- | ---: | ---: | --- |
| Page boundary plus rare key, first page | 20 | 20 | 2 records |
| Exact Subscription Scope plus the same rare key | 2,000 | 2,000 | 2 records |
| Page plus rare key, continued page | 21 including anchor validation | 2,000 | 2 records |
| Plain page, first page | 2 | 2 | 2 records |
| Plain page, continued page | 3 including anchor validation | 2,000 | 2 records |
| Scoped key facet summary | 4,000 plus 1,000 posting validations | 2,000 plus discovery evaluation | 5 distinct values |
| Panel service scoped query with one selected field and limit 100 at the default byte budget | 12,000 across 6 storage calls | 12,000 across 6 storage calls | 3 records |

The last IndexedDB request hydrated 196 payloads across the six size attempts: `100 + 50 + 25 + 12 + 6 + 3`. These are synthetic fixture work counters. A real browser benchmark is required before claiming any corresponding latency improvement.

## 1 Preserve selective query planning

An exact Scope becomes structural client/session/Subscription/item criteria. The IndexedDB planner abandons every posting driver if any criterion is not postable, including these structural criteria. Thus a selective key or operation index is discarded when the agent follows the documented advice to narrow to an exact Scope. Memory has the same first-page behavior. Memory continuation additionally falls back to full retained evaluation even for some initially indexed queries. [Scope compilation lines 234 to 251](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/evidence-investigation-query.ts#L234), [IndexedDB planning lines 3114 to 3145](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/event-history-indexeddb.ts#L3114), [memory query selection lines 1694 to 1706](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/event-history-authoritative.ts#L1694).

First choose a driver from usable include predicates independently of residual predicates. Use that driver to obtain a safe candidate superset, then evaluate every original Scope and Filter condition. Later, compile structural identities into exact owner-qualified postings or dedicated structural indexes. Never substitute a Subscription label for its page/client/Session identity. Reuse indexed selection during continuation, and reuse exact totals at a frozen read point through a bounded query cache rather than recomputing every candidate for every page.

Agents benefit because rare-key examples and repeated pages scale with relevant candidates. Developers benefit through the same canonical query engine. Validate output/count parity and scanned work with duplicate labels across Sessions, include/exclude combinations, item name and position, Gaps, retention, Clear and concurrent Capture. A fix must retain complete filtering even when only one predicate supplies the driver.

## 2 Define faithful change flags for generated events

Unchanged captured Drafts preserve their original change bitmap. Edited Drafts derive changed fields by comparing against the immutable source's field values. Source-free Steps each compare against their own initial authored baseline. Those rules are implemented deliberately, but they can produce an Item Update whose values and changed-field flags disagree with a generated COMMAND sequence. [Document application lines 227 to 251 and comparison lines 439 to 443](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/local-injection-document.ts#L227).

The probe demonstrated three cases: an authored ADD omitted a concrete null optional field from changed fields; an authored subsequent UPDATE with the same quantity still marked that quantity and key as changed against the initial baseline; and a captured UPDATE with quantity 10 changed into an ADD for a fresh key omitted quantity 10 from the change bitmap. Synthetic listener delivery uses that bitmap directly for `forEachChangedField` and `isValueChanged`. An application that consumes changed fields can therefore see a different experiment from one reading all values. [Synthetic Item Update lines 4287 to 4336](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/injected/lightstreamer-instrumentation.ts#L4287).

Official COMMAND change tracking is relative to the same key: ADD establishes changed fields; UPDATE compares with the previous key update; DELETE has its own clearing behavior. [Official ItemUpdate semantics](https://sdk.lightstreamer.com/ls-web-client/9.0.0/api/ItemUpdate.html#isValueChanged).

Introduce an explicit versioned change policy. Preserve captured-bitmap reproduction where it is intended, and offer mode-aware derivation for authored sequences against a clearly identified local baseline. Show the effective bitmap and its basis during validation/review. Revalidate drift; an incomplete baseline must produce a limitation or refusal rather than guessed flags. Test null, unchanged values, DELETE, schema field positions, second-level COMMAND and interleaved Server Updates through both supported delivery paths. This improves agent experiments and ordinary developer-authored Scenarios without changing original Capture.

Also disclose listener API fidelity. The synthetic `getValueAsJSONPatchIfAvailable` currently always returns null, even though Capture can record JSON patches. A captured value can therefore be reproduced without exercising the application's original patch-handling branch. Supporting that branch requires a consistent patch and baseline; otherwise candidate validation should state the limitation.

## 3 Make preparation recoverable

Cancellation is propagated to the service, but the authorization callback passed into preparation checks only the grant and generation. It ignores the request signal. The outer wrapper rejects after preparation returns, when a document and token may already have been created. The temporary real-runtime probes cancelled during the retained-source lookup: both Local Draft and Scenario preparation returned `QUERY_CANCELLED`, yet left a protected document behind. Repeating preparation then failed because that document existed. [Preparation authorization lines 440 to 483](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L440), [post-call cancellation lines 608 to 634](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L608).

There is also a broader lost-reply gap. Prepare and edit calls do not have recoverable request IDs. A successful edit rotates its token. Losing that reply leaves the agent unable to use its old token, and no read recovers the current token. Finishing requires an existing token and a completed document; it does not resolve an unchanged unexecuted Draft. [Editing lines 434 to 438 and finishing lines 598 to 602](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L434).

Carry cancellation through candidate resolution and publication. Add idempotent preparation/edit receipts bound to an exact document revision and input digest, a read that recovers the current agent-owned document/version, and a token-guarded abort for unchanged unexecuted agent documents. Do not discard a human edit or imply that cancelling execution reverses a delivered update. Publication racing cancellation needs a recoverable receipt, not an undisclosed token.

Agents gain a deterministic repair path; developers regain control of the single protected-work boundary. Tests should drop prepare/edit responses, cancel before and after publication, race a human edit, revoke access, reconnect, and confirm zero accidental delivery.

## 4 Bound computation as well as response size

`query_evidence` runs storage at the requested size, sanitizes/project records, measures the response, halves the size, and repeats until it fits. Summary and stream description fitting can also repeat evaluation. `search_evidence` already uses a better approach: evaluate one match page, fit its prefix in memory, and continue after the last returned identity. [Query fitting lines 294 to 348](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L294), [existing search prefix fitting lines 270 to 289](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L270).

Reuse one evaluation and fit the longest returned prefix. Derive continuations from returned records so no unreturned tail is skipped. Where practical, pass the output budget into paging so selected values are hydrated only as needed. Avoid cloning a whole wide payload just to select one field. Keep the explicit error for a single record that cannot fit; do not silently truncate concrete values.

Add optional safe plan metadata and computation controls such as maximum evaluated records/blocks or deadline. Storage already records scan, posting and hydration telemetry, but public query results omit it. Budget exhaustion must return an explicit failure or a resumable partial evaluation with `scannedThrough`; it cannot be presented as an exact total or zero matches. Memory scans need cooperative chunks or a worker if cancellation is to interrupt CPU work after it starts. [Existing telemetry](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/evidence-filter-contract.ts#L84).

This reduces allocation and repeated work for developers, and helps agents choose narrower windows rather than retrying expensive requests. Validate escaped text, oversized records, wide omitted fields, stable totals, correct page continuation, bounded cache bytes and prompt cancellation at maximum memory retention.

## 5 Preserve control access under saturation

The panel reserves capacity for immediate inspection, but the broker first applies a common limit of 16 pending calls per agent and 64 globally. Those limits do not distinguish urgent inspection or Scenario pause/stop. A router probe held 16 unanswered reads, then sent status and stop: both returned `REQUEST_CAPACITY` without reaching the panel. Cancellation helps release routes, but the same client may still need to inspect or stop work before knowing which reads to cancel. [Broker admission lines 85 to 97](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/companion/router.ts#L85), [panel reserves lines 24 to 30 and 108 to 117](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-connection.ts#L24).

Carry a small reserved class through every admission layer for status, existing receipts, and pause/stop. Add fair scheduling so one reader cannot repeatedly monopolize expensive work. Expose remaining operation and wait capacity in status. The 256-operation ledger intentionally retains IDs for duplicate suppression; compact old receipts or separate summary/tombstone accounting before considering a larger bound. [Operation limits and duplicate suppression](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L181).

Multi-agent ownership should also be explicit: one panel supports one protected Draft/Scenario. A future document lease can report who owns it and why another preparation conflicts. Keep effect deduplication tied to stable operation identity across reconnect; partitioning the ledger by a new ephemeral connection ID would undermine recovery. These are concurrency controls, not a reason to reintroduce the mandatory authentication workflow removed in ADR 0016.

## 6 Observe deltas and actual Run progress

Evidence waits already subscribe before reading and coalesce changes. However, they query matching retained history newest first and only afterward discard sequences at or before the requested lower boundary. They do not pass that lower bound to the rich query engine. Operation waits correctly distinguish Local Injection receipt completion from Scenario control acceptance, but there is no equivalent bounded wait for a Run changing or completing. [Evidence wait lines 75 to 92](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-evidence-wait.ts#L75), [receipt waits lines 510 to 556](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L510).

Add canonical sequence reads over `(after, through]`, retaining the current read point as the upper boundary. Waits can evaluate each new suffix, record what was scanned, and fail explicitly if retention or a Gap overtakes the window. Add `wait_for_scenario` for an exact Run and trace revision, returning changed, terminal, timed out, revoked or unavailable. It should subscribe before its first read and reuse current wait limits.

Expose the Local Injection coordinator's committed-Evidence settlement and exact reference in operation receipts. Currently the service stores the Draft outcome while the coordinator separately retains Evidence settlement. Correlated references would avoid a new search just to find the event caused by a known local operation. [Coordinator terminal record](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/local-injection-execution-coordinator.ts#L66), [outcome-only receipt refresh](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-service.ts#L154).

Agents can then execute once, await settlement, inspect exact Evidence, and observe the application separately. Developers gain a clearer record of delivery, evidence acceptance, checkpoints and app response. None of these states implies Authoritative COMMAND State or causal attribution of later Server Updates.

## 7 Generate deterministic candidates from declared streams

The interface can already author JSON, validate a complete candidate without publishing, and prepare an explicit Scenario. It lacks a concise deterministic way to generate a family of candidate events from an exact target schema and captured examples. A new LLM inside the companion is unnecessary: the connected agent can propose the experiment, and Workbench can expand and validate it deterministically. [Candidate and Scenario tools](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/protocol.ts#L85).

Provide a candidate builder over an exact captured source or supported live Scope: explicit field assignments, a key choice, an ordered command sequence, bounded delays, and optional bounded parameter combinations. Return an immutable preview containing the expanded members, effective changes, target, field value states, seed when randomness is requested, validation and limitations. Preparation remains a separate action. Default to the smallest experiment, and enforce existing Step/member/byte limits after expansion.

Useful generic recipes include ADD then UPDATE then DELETE for a fresh key; null versus empty-string assignments; one changed field versus repeated equal values; and declared delay variations. Application-specific JSON meaning and value constraints should be optional application-supplied metadata. A sampled profile is not a complete schema, and redacted or ambiguous values must not become executable replacements.

Agents produce valid repeatable events with fewer full-document rewrites. Developers can review a compact parameter change and reproduce a failing seed. Implement this after change-flag and document-recovery fixes; assert deterministic expansion, exact target identity, whole-plan validation and no effect during candidate generation.

## 8 Add field analytics and projected row discovery

Current summaries count retained records and one canonical facet. Field selection controls returned data, not filtering. There are no arbitrary payload predicates, bounded multidimensional histograms, or explicit logical-update count units. Exact `query_command_state` already exists, but an agent must know the item/key; historical key enumeration is not active row discovery. [Read contract](../../agent/READS.md), [exact COMMAND state boundary](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/agent-command-state.ts#L55).

Start with a small typed predicate grammar for exact declared Item Update fields: equality, membership, existence, value state, changed-field membership, and explicitly typed ranges. Lightstreamer values often remain strings, so numeric conversion must be requested and failure counted. Separate concrete null from redacted, ambiguous and unavailable. Avoid arbitrary JavaScript, SQL or implicit business decoders. Add bounded group counts/time buckets and `evidence-records` versus `distinct-logical-updates` units, with missing-ID and omitted-group counts. Index selected useful fields only with bounded cardinality and accounted write/memory cost.

Separately page current COMMAND rows for one exact item and chosen projection, with selected fields and a frozen applied boundary or a revision that rejects drift. Retain presence certainty and provenance availability. A bounded multi-key read can compare observed-server and local-effective rows without a call per key. This uses the existing projection; it must not reconstruct another model or call it authoritative.

Agents answer questions such as which observed keys had a concrete field value or how local delivery changed projected rows without downloading the event base. Developers gain useful stream-wide diagnosis. These features depend on selective planning and computation budgets; exact partial-result semantics matter more than adding many aggregate operators.

## 9 Combine reads at an aligned boundary

Existing tools can already reuse `at`, but an agent must carry that read point through several separate calls. Add a bounded read bundle, or extend summaries to request a few facets and examples together. Limit the operation count, total output and total computation; allow only reads and report each sub-result explicitly.

For example, one request could return operation counts, a few rare-key examples and selected fields at the same retained boundary. Comparing COMMAND projections requires additional care: their applied boundary can lag Event History. The bundle must align them, wait within a bound, or state that an aligned result is unavailable. Freezing a query read point alone does not create a snapshot of every live map.

Agents gain fewer round trips and fewer mixed-boundary conclusions; developers gain consistent before/after reports. Avoid a general-purpose workflow interpreter or executing arbitrary tool names. Keep discovery, validation, preparation and execution separate so a read bundle cannot perform an effect.

## 10 Publish precise schemas and recovery guidance

All tools already have output schemas, but most success branches remain generic objects. Draft input is opaque JSON text. Assertions also advertise limits that differ from core validation: MCP accepts a `withinActiveMs` of 3,600,000, while checkpoints require 1 to 300,000. The direct probe passed protocol validation and failed core validation for that advertised upper value. Member identity bounds similarly diverge. [MCP input and output schemas](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/protocol.ts#L40), [checkpoint limits](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/local-injection-scenario-checkpoint.ts#L183).

Generate the MCP constraints and reusable result shapes from canonical domain definitions. Advertise typed field states, exact targets, validation reasons, token/revision transitions and receipt boundaries, including compact omission variants. Add a typed document option while preserving JSON-text compatibility. Keep the existing 80 KiB tool-discovery gate; better schemas should not duplicate the whole domain model in every tool description.

**Approved amendment, 2026-10-02:** After review measured the precise 37-tool catalog at 135,097 bytes, the user approved raising the complete-catalog discovery ceiling to **160 KiB (163,840 bytes)** while retaining the current tools and schemas. This supersedes the original 80 KiB discovery constraint above. Per-call response/query limits and separate human approval of each Server Client Message remain governed by their existing contracts. See the recorded decision and verification (`.scratch/mcp-agent-audit/evidence/discovery-budget-decision.md`, local artifact).

Provide a versioned injection descriptor on status or the exact Scope: supported captured/source-free modes, schema and encoded JSON fields, field/value certainty, change policies, Scenario limits, visibility requirements, delivery-path limitations and remaining operation capacity. Validate plan reachability too: the contract accepts a checkpoint expecting a prior failed/partial/unknown outcome, but those outcomes stop the Run before the next checkpoint. Reject an unreachable expectation or evaluate it as a terminal observation while keeping all further Injection stopped. [Fail-stop behavior lines 799 to 817](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/local-injection-scenario.ts#L799).

Differentiate read timeout, document-publication uncertainty and effect uncertainty. The companion's 35-second timer currently emits `DELIVERY_UNKNOWN` for every call, including counts that have no operation receipt. Return bounded trusted recovery metadata and stable conflict/readiness codes while retaining conservative execution retry behavior. [Companion timeout](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/agent/companion/mcp.ts#L35).

Add short MCP initialization instructions drawn from READS and the bundled skill, so hosts without the skill learn summary first, then examples, then exact lookup. Refine per-tool annotations to describe actual effects; listener execution may invoke application code with external effects. Preserve structured results and serialized text compatibility, which the installed protocol supports. [MCP tools contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [initialization instructions](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

These changes are relatively accessible and can ship alongside earlier fixes even though richer capabilities rank lower. Agents make fewer malformed calls; integration developers gain useful types and deterministic recovery.

## 11 Broaden authoring and assertions with explicit fidelity

Source-free agent authoring currently requires a supported live COMMAND Scope. Captured Item Update sources support COMMAND, MERGE and DISTINCT; RAW is explicitly excluded. Broadening source-free authoring to MERGE and DISTINCT, and separately deciding RAW support, would let agents create tests before a convenient source event arrives. Obtain exact item/field schema and delivery capability from the live target, then define mode-specific value, snapshot and change behavior. Retain the COMMAND-only source-free path until these semantics are verified rather than exposing unsupported authoring through a generic mode enum. [Supported source modes](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/extension/panel/workbench-runtime.ts#L8157).

Checkpoints already support outcomes, listener counts where available, correlated Local Evidence, COMMAND key presence/absence, primitive equality and normalized diagnostics. Possible additions are field assertions for non-COMMAND streams and temporal assertions such as a key remaining absent or a diagnostic not occurring during a defined active-time window. A current absent-key check is not a temporal absence guarantee. Temporal evaluation must identify the observed window and become inconclusive after insufficient coverage, a relevant Gap, unavailable history or target change. [Current assertion semantics](https://github.com/imom39a/lightstreamer-workbench-extension/blob/22943ba2eb158d2cfb6cc02d7117e0ef7800fdef/src/core/local-injection-scenario-checkpoint.ts#L111).

Modeled lifecycle/snapshot delivery, multi-target coordinated plans, hidden-panel execution and failure simulation are separate product expansions. Cross-Subscription Scenarios and hidden execution would reopen accepted agent/Scenario decisions. Do not simulate a disconnect by merely inserting an Evidence record: exercising an application's actual lifecycle callback requires its own modeled delivery contract.

Keep arbitrary application assertions in a browser tool. A useful agent recipe joins Workbench Evidence and Injection receipts with DOM/console observations on the same inspected tab, without adding arbitrary page evaluation to this MCP. Developers gain broader test coverage while knowing what each experiment actually exercises.

## 12 Treat Server Injection as a separate reviewed capability

Server Injection exists in the product but is deliberately excluded from agent access by ADR 0016. Exposing it would require changing that decision and defining a separate grant/review contract. Its lower rank reflects that prerequisite and broader consequences, not lack of potential value. [Agent boundary](../adr/0016-panel-owned-agent-access.md), [normal Client Message delivery](../adr/0004-send-server-injections-as-client-messages.md).

An application-neutral design would prepare an exact Client Message from captured permitted input, explicitly authored text, or an application-supplied Message Recipe. Review the page/client/current Session, message text, sequence, timeout and enqueue choice. Bind execution to that review fingerprint, reserve a request ID, reuse the existing normal `sendMessage` coordinator, and make repeat execution a separate deliberate operation. Do not infer an application Metadata Adapter command from an Item Update.

The official method sends a message interpreted by the Metadata Adapter for the current Session. It does not insert arbitrary inbound Item Updates. Successful processing also does not prove a particular later update or app effect; causal linkage needs application-supported attribution. Unknown outcomes must not be automatically resent with a new ID. [Official sendMessage contract](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html#sendMessage), [unknown outcome decision](../adr/0003-do-not-automatically-retry-unknown-server-injections.md).

Agents could help developers prepare and test backend-supported workflows, but the server's application contract must supply their meaning. Any permanent UI surface or changed review semantics must also satisfy the Workbench UI standard before implementation.

## 13 Add protocol conveniences after demonstrated host need

Optional resources can expose the read contract and reviewed bounded context; resource links for exact Evidence should retain the same panel/epoch/identity, access, redaction, retention and byte constraints as tools. Optional prompts can reuse the existing investigation/reproduction instructions. Neither resources nor prompts guarantee an agent wakeup or replace a tool result. Retain the text/structured representation for clients using the current contract. [MCP resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), [MCP prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts).

The installed SDK and current companion use the older protocol generation. The official SDK now documents a newer stable line and a separate modern protocol integration path. Treat an upgrade as compatibility work, with actual supported agent hosts, stdio/EOF, errors, cancellation and budgets in the matrix. Tasks are optional: the dated modern Tasks extension differs from v1 experimental APIs. Prefer bounded native Run waits first; adopt Tasks only if a supported host needs a longer-lived operation interface. Panel Session lifetime still bounds work and Evidence. [Official SDK](https://github.com/modelcontextprotocol/typescript-sdk), [modern protocol migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28), [dated Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/2026-07-28/tasks).

## Recommended agent workflow

The following sequence mostly works today. The proposed additions reduce cost and improve recovery; they do not require a second orchestrator inside the companion.

1. Discover Panel Sessions and read status. Match the inspected browser tab, current page epoch, capabilities and read contract.
2. Locate the exact Subscription/item Scope. Read target schema and capabilities. Do not equate structural items with COMMAND keys.
3. Ask for counts or distinct values first. Preserve the returned read point, Coverage and retention limitations.
4. Read a few matching examples with only relevant fields. Use exact lookup only when a specific payload detail is needed.
5. Form the smallest candidate. Prefer captured evidence when useful; use source-free authoring only where supported. Validate the entire ordered plan without publishing it.
6. Prepare a visible immutable Draft/Scenario. Record its token, revision and exact target. Proposed preparation receipts make this stage recoverable.
7. Execute once with a unique request ID. Await the existing receipt. Proposed Scenario waits observe Run progress separately from control acceptance.
8. Follow correlated Local Evidence and inspect local-effective versus observed-server projection with explicit boundaries. Proposed delta reads limit work to the experiment window.
9. Observe the same application's DOM/console with a browser tool. Report delivery, Evidence acceptance, projection/checkpoint results and application response separately.
10. Finish the completed agent document. Use a deliberate new candidate and execution for another experiment; never infer that a lost reply authorizes a repeat effect.

## Implementation order and acceptance evidence

Start with ranks 1 to 5, sharing the canonical engine and existing protected-work boundary. Ship schema-limit alignment and precise error codes from rank 10 alongside them. Extend the performance proof through the actual MCP Scope adapter, not only direct storage filters. Then implement rank 6, so the generate/inject/observe loop has efficient causal reads and Run progress. Add deterministic generation and selected analytics next. Broader delivery modes, Server Injection and optional protocol surfaces should follow explicit product decisions and observed agent needs.

Use four acceptance layers:

| Layer | Required evidence |
| --- | --- |
| Contract correctness | Exact target/source identity, advertised/core limits aligned, certainty and omission variants schema-valid, same query/read boundary, no human workspace mutation |
| Query work | Projection/block reads, payload hydrations and evaluations per returned page; selective first and continued pages; one byte-fit evaluation; exact/partial distinctions; bounded caches and cancellation |
| Browser performance | Loaded extension and installed companion with 100k normal/25k memory retained histories; cold/warm p50/p95/p99, queued time, Capture throughput, memory, panel Long Tasks, ongoing retention and Gaps |
| Agent task outcomes | Calls and bytes to answer count/rare-key questions; valid first candidates; recovered dropped replies; no duplicate delivery; correct provenance/absence claims; actual host/model token counts where available |

Include many unrelated Scopes, high-cardinality keys, wide JSON-string fields, duplicated listener delivery, second-level COMMAND, null/ambiguous/redacted values, burst Capture, revoked access, page navigation, lost replies and concurrent agents. Establish browser baselines before setting numerical latency targets; this audit does not supply maximum-history Chrome timings. Byte limits are not token estimates.
