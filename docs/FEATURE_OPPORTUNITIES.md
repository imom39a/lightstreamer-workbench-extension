# Lightstreamer Workbench Feature Opportunities

Original source review: 2026-07-28

Reassessment date: 2026-08-12

Status: product opportunity assessment, not an implementation commitment

## Recommendation

The redesign is complete. Workbench now has a stable product shape: compact live-session orientation, focused investigation in a **Scoped Evidence Workspace**, and deliberate scoped action. The next evolution should deepen that operating model rather than rebuild the old feature-first panel under new labels.

The highest-value direction is now:

1. Finish contextual faceted Evidence filtering, then add a scoped graphical **Observed Activity** dashboard that turns accepted Evidence into fast live-session orientation and reversible Evidence drill-down.
2. Make selected Evidence more conclusive through changed-field and delivery inspection, diagnostics, connection recovery, and snapshot explanation.
3. Add first-class Client Message Capture and the planned Server Injection workflow through the inspected client's normal `sendMessage` path.
4. Keep extending the implemented deterministic Local Injection Scenario workflow without weakening its explicit-membership, single-target, immutable-Run boundary.
5. Add deeper QoS, mode, two-level COMMAND, listener, and protocol diagnostics only after the primary Diagnose and Injection journeys remain coherent under the extra evidence.

The Observed Activity dashboard is not a permanent metric-card destination and does not replace Ordered Evidence. A concise runtime-dossier summary opens one temporary promoted document that inherits Scope, Filter, the current History Interval, Observation Coverage, and Live/Frozen position. It visualizes what Workbench actually observed and keeps every aggregate traceable to supporting Evidence; it does not manufacture a composite health score or call callback activity end-to-end performance.

The public Lightstreamer Web Client API remains the semantic source of truth. Raw TLCP and client logs are valuable opt-in evidence for difficult incidents, but they remain supplemental. Every new UI capability must fit Scope, Ordered Evidence, Context, a bounded transient, or a temporary promoted document unless it passes the permanent-surface gate in the [Workbench UI Standard](WORKBENCH_UI_STANDARD.md).

## What the Redesign Changed

The prior list treated Timeline, Topology, COMMAND State, diagnostics, and replay-like tooling as candidate feature destinations. That is no longer the product architecture.

The accepted contracts now require:

- Ordered Evidence to remain the dominant working surface.
- Structural Topology to choose Scope rather than compete as a peer destination.
- Runtime and selected-Evidence explanation to live in Context.
- COMMAND projections, raw evidence, export, and Injection to open contextually while preserving the investigation.
- Scope, Filter, Find, selection, focus, Capture Operation, Observation Coverage, History Capacity, and Live/Frozen position to remain distinct.
- One protected standalone target-anchored Local Injection Draft or one separate temporary Scenario. A Scenario is neither an inferred Draft Set nor a generic run-all queue.
- New permanent surfaces and shared UI abstractions to pass the explicit evidence and maintainer-approval gates.

Consequently, this reassessment removes already-shipped foundations, narrows several oversized proposals into contextual lenses, and demotes controls whose main use case is already solved by Frozen Evidence and accepted Evidence bounded by the current History Interval's Committed Evidence Boundary.

## Current Product Baseline

The redesigned production panel now provides:

- A React **Scoped Evidence Workspace** with structural Page → client → Session → Subscription → item → listener Scope.
- Live and retired runtime structure, Session recovery epochs, bounded historical Sessions, subscription configuration, duplicate/overlap findings, snapshot phase, listener and delivery counts, and COMMAND generation summaries.
- Accepted ordered Evidence through the current History Interval's Committed Evidence Boundary, backed by one Panel Session-owned Event History, with bounded query windows, high-volume navigation, and deliberate Clear. Normal capacity is 100,000 records/256 MiB; startup memory fallback is 5,000 records/32 MiB, and the adapter is fixed for the session.
- A committed Evidence boundary, History Intervals, exact Clear cuts, fail-closed terminal stops, fixed adapter selection, and ownership-safe abnormal cleanup now define the shipped history contract. New Panel Sessions start empty and never replay stale Evidence.
- Independent Scope, text Filter, Find, Evidence selection, Context, and Live/Frozen state. Frozen Evidence continues Capture and reports newer matching Evidence.
- Full committed-Evidence copy for the current interval plus versioned scoped JSON and offline HTML exports with bounded collections, opt-in interval-bounded evidence, category redaction, and unconditional credential exclusion.
- Named **Observed Server COMMAND State** and **Local Effective COMMAND State** projections.
- One protected standalone Local Injection Draft from a compatible Captured Item Update or live COMMAND Scope, with raw JSON editing, optional Source comparison, validation, Review, explicit local delivery, persistent outcome, and marked Local Evidence.
- Deterministic Local Injection Scenarios with one to 100 explicit single-target Steps, optional zero-Injection Checkpoints, an 8 MiB accounted-state boundary, immutable reviewed Runs, serial controls, Workbench-owned assertions, per-Step outcomes, and complete Scenario/Run/Step/Injection/request/Evidence correlation.
- The first Scenario release deliberately excludes diagnostic-presence assertions until a normalized diagnostic observation contract exists; richer selected-update inspection and full contextual diagnostics remain parallel enhancements rather than Scenario release gates.
- Primary public-API instrumentation plus WebSocket/TLCP fallback, including documented connection and subscription metadata, `onPropertyChange`, real maximum frequency, and second-level COMMAND error/loss callbacks.
- A single global footer for session- and runtime-level diagnostics, with workflow-local validation and outcomes kept at their decision boundaries.

The most important remaining gaps are:

- Event History acceptance, the Committed Evidence Boundary, History Intervals, Complete History, History Capacity, fail-closed terminal behavior, and Local Injection retention are delivered through the production state machine. Complete History is only the committed boundary of the current interval; Clear cannot restart stopped Capture, and a storage fallback changes History Capacity without automatically changing Observation Coverage.
- `ClientListener.onServerError` and `onServerKeepalive` are not captured as first-class Evidence.
- `LightstreamerClient.sendMessage` calls and `ClientMessageListener` outcomes are not captured, so Captured Client Messages and Server Injection are not yet available.
- The filter engine supports structured fields, but the redesigned panel primarily exposes Scope and free-text filtering rather than contextual facets and clickable values.
- Workbench already retains timestamps, Logical Update and Update Delivery identity, Server/Local provenance, snapshot/live phase, loss and subscription-error Evidence, client-status and Session transitions, requested/real bandwidth and frequency, and scoped runtime counts. It does not yet turn those facts into a graphical activity overview or provide chart-to-Evidence drill-down.
- Selected Item Update Context shows resolved fields but does not yet make changed fields, per-listener Update Deliveries, JSON Patch evidence, and value ambiguity equally easy to inspect.
- Snapshot, connection recovery, subscription configuration, and duplicate data exist, but most higher-order explanations remain facts rather than conclusions.
- Only COMMAND has reconstructed state. MERGE, DISTINCT, and RAW remain ordered Evidence without point-in-time state lenses.
- Export exists; import, offline investigation, fixture generation, and cross-capture comparison do not.

Relevant implementation and product seams:

- [Domain language](../CONTEXT.md)
- [Workbench UI Standard](WORKBENCH_UI_STANDARD.md)
- [Canonical Developer Journeys](CANONICAL_DEVELOPER_JOURNEYS.md)
- [Workspace information architecture](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md)
- [Production UI migration record](WORKBENCH_UI_MIGRATION_PLAN.md)
- [Architecture and extension guide](ARCHITECTURE.md)
- [Capture message contract](../src/bridge/messages.ts)
- [Normalized Evidence envelope](../src/core/event-envelope.ts)
- [Topology state](../src/core/topology-state.ts)
- [Page instrumentation](../src/injected/lightstreamer-instrumentation.ts)
- [Event History seam](../src/core/event-history-authoritative.ts)
- [Workbench runtime](../src/extension/panel/workbench-runtime.ts)
- [Event History workload evidence](research/event-history-workload-evidence.md)

## Prioritization Model

**Developer usefulness is the primary ranking.** The score combines:

- how broadly the opportunity applies across generic Lightstreamer applications;
- how often a developer is likely to need it;
- how much investigation or reproduction time it saves;
- how directly it helps the developer reach a supported conclusion or deliberate outcome.

The score does not include implementation effort, current readiness, or architectural dependency. It is directional rather than a measured product metric:

- **5.0**: core to nearly every investigation or reproduction workflow;
- **4.5–4.9**: high-value across a primary journey;
- **4.0–4.4**: strong value for a narrower recurring workflow;
- **3.5–3.9**: specialist or conditional value;
- **3.0–3.4**: specialized ecosystem value.

Equal scores are ordered by the accepted journey priority—Diagnose before Local Injection, then advanced workflows—and by breadth across operators.

**Build order is separate.** It is a dependency-safe topological order. Among opportunities whose dependencies are already satisfied, higher developer usefulness comes first. A lower-ranked prerequisite may therefore build earlier than a more useful dependent feature. The [delivery increments](#suggested-delivery-increments) follow that build order.

Effort includes the implementation and the proportional evidence required by the UI standard:

- **S**: localized aggregation or contextual UI using existing Capture.
- **M**: a new capture field/kind, reducer or derived projection, contextual or promoted lens, and browser verification.
- **L**: a workflow spanning instrumentation, history, runtime, bridge, UI, privacy, and failure semantics.
- **Design gate**: implementation must wait for an explicit domain and interaction decision; a prototype alone is not acceptance.
- **Material UI gate**: implementation must pass the complete Material UI evidence and maintainer-approval requirements in the Workbench UI Standard.

## Developer Usefulness Ranking

| Usefulness rank | Opportunity | Developer usefulness | Current state | Effort | Priority |
| ---: | --- | :---: | --- | :---: | :---: |
| 1 | Contextual faceted Evidence filtering | 5.0/5 | Filter engine exists; UI partial | S-M | P0 |
| 2 | Scoped Observed Activity Dashboard | 4.9/5 | Counts and metadata exist; aggregation and graphical lens absent | M + Material UI gate | P0 |
| 3 | Changed-field, delivery, provenance, and value-semantics inspection | 4.9/5 | Capture partial; Context partial | M | P0 |
| 4 | Contextual Lightstreamer diagnostics and subscription linting | 4.9/5 | Operational diagnostics exist; semantic explanation partial | M | P0 |
| 5 | Connection, transport, recovery, and Session-epoch lens | 4.8/5 | Topology facts exist; correlated lens absent | M | P0 |
| 6 | Deterministic multi-event Local Injection scenarios | 4.8/5 | Implemented and release-verified in the repository candidate | L + accepted design gate, delivered | Delivered |
| 7 | Snapshot bootstrap and resubscription correctness lens | 4.7/5 | Snapshot phases exist; explanation partial | M | P0 |
| 8 | Captured Client Messages and deliberate Server Injection | 4.6/5 | Planned, not implemented | L | P0 |
| 9 | Committed Evidence Boundary and fail-closed History Capacity | 4.5/5 | Delivered through the Event History implementation train; future refinements remain possible | M-L | P0 |
| 10 | Deep Delivery QoS and Loss Profiler | 4.4/5 | Metadata and basic activity Evidence exist; deeper profiler absent | M | P1 |
| 11 | Watch rules and conditional listener breakpoints | 4.3/5 | Not implemented | M | P1 |
| 12 | MERGE, DISTINCT, and RAW state reconstruction with point-in-time inspection | 4.3/5 | COMMAND only | M-L | P1 |
| 13 | Two-level COMMAND dependency and merged-row inspector | 4.2/5 | Capture/summary partial; deep inspection absent | M-L | P1 |
| 14 | Capture import, offline investigation, and fixture generation | 4.2/5 | Export exists; reverse workflow absent | M-L | P1 |
| 15 | Listener performance, exception, and registration-churn profiler | 4.0/5 | Counts exist; timing and exceptions absent | M | P1 |
| 16 | Correlated Lightstreamer client-log and TLCP evidence | 3.9/5 | Wire fallback partial; opt-in console absent | M-L | P1 |
| 17 | Multi-client, version, duplicate-session, and churn audit | 3.9/5 | Duplicate/overlap and Session history partial | M | P1 |
| 18 | Cross-capture comparison and regression diff | 3.8/5 | Depends on import | M | P2 |
| 19 | Cross-frame, worker, HTTP transport, and bundled-client coverage | 3.7/5 | Limited coverage reporting exists | L | P2 |
| 20 | Guarded live QoS and transport tuning lab | 3.5/5 | Not implemented; consequential | M-L | P2 |
| 21 | Mobile Push Notification Workbench | 3.0/5 | Not implemented; specialized | L | P2 |

## Dependency-Safe Build Order

This is the execution order for incremental delivery. Do not start an opportunity before its listed dependencies and design gates are complete. Work at the same satisfied dependency layer may proceed independently, but the higher-usefulness item should be selected first when capacity is limited.

| Build order | Opportunity | Depends on | Delivery increment |
| ---: | --- | --- | :---: |
| 1 | Committed Evidence Boundary and fail-closed History Capacity | Existing Event History vocabulary and workload evidence | A |
| 2 | Contextual faceted Evidence filtering | 1 | B |
| 3 | Scoped Observed Activity Dashboard | 1, 2 | B |
| 4 | Changed-field, delivery, provenance, and value-semantics inspection | 1 | B |
| 5 | Contextual Lightstreamer diagnostics and subscription linting | 1 | B |
| 6 | Connection, transport, recovery, and Session-epoch lens | 1, 5 | B |
| 7 | Snapshot bootstrap and resubscription correctness lens | 1, 4, 5 | B |
| 8 | Captured Client Messages and deliberate Server Injection | 1, 5, existing standalone Local Injection execution contract, accepted Server Injection ADRs | C |
| 9 | Deterministic multi-event Local Injection scenarios | 1, 2, accepted Scenario domain and interaction model, narrow Item Update replayability/value-semantics contract; diagnostic-presence assertion extension also requires the normalized diagnostic contract from 5 | D |
| 10 | Deep Delivery QoS and Loss Profiler | 1, 3, 4, 5, 6 | E |
| 11 | Watch rules and conditional listener breakpoints | 1, 2, 5 | E |
| 12 | MERGE, DISTINCT, and RAW state reconstruction with point-in-time inspection | 1, 4, 7 | E |
| 13 | Two-level COMMAND dependency and merged-row inspector | 1, 4, 5, 7 | E |
| 14 | Capture import, offline investigation, and fixture generation | 1; Scenario fixture generation also requires 9 | E |
| 15 | Listener performance, exception, and registration-churn profiler | 1, 3, 4 | E |
| 16 | Correlated Lightstreamer client-log and TLCP evidence | 1, 5, 6 | E |
| 17 | Multi-client, version, duplicate-session, and churn audit | 1, 5, 6 | E |
| 18 | Cross-capture comparison and regression diff | 3, 14 | F |
| 19 | Cross-frame, worker, HTTP transport, and bundled-client coverage | 1, 5 | F |
| 20 | Guarded live QoS and transport tuning lab | 6, 10 | F |
| 21 | Mobile Push Notification Workbench | 1, 5 | F |

Opportunity headings below carry the build number, not the usefulness rank. The two tables above are authoritative: feature names identify the work, developer usefulness determines value rank, and build order determines safe execution sequence.

## P0 Opportunity Details

### Build 1 — Committed Evidence Boundary and Fail-Closed History Capacity (delivered)

The implementation train delivered one Event History state machine that owns:

- primary-versus-fallback adapter selection;
- Capture Operation and the ability to accept new captured events;
- pending batch acceptance and contiguous Evidence sequencing;
- the Committed Evidence Boundary and Retained Range;
- explicit History Interval cuts for Clear;
- capacity exhaustion, journal failure, Clear failure, and teardown;
- publication of accepted Evidence to Topology and COMMAND projections.

The delivered contract guarantees:

- A captured event becomes Evidence only after its whole accepted batch commits.
- Only Evidence advances Topology or COMMAND projections.
- A journal failure or exceeded History Capacity stops acceptance at the prior committed boundary; it never drops an event silently and continues claiming Complete History.
- Memory fallback lowers History Capacity without automatically lowering Observation Coverage.
- Clear establishes an exact cut. Pre-cut acceptance settles before the old History Interval is removed, while post-cut events belong only to the new interval.
- A Local Injection may truthfully remain `DELIVERED LOCALLY` if retaining its synthetic event fails, but no Local Evidence or projection change may be manufactured from an unaccepted event.
- Material state reaches the existing operating strip or diagnostic footer without exposing IndexedDB mechanics as product language.

Why it was first:

- Every additional capture kind, scenario, import, projection, and profiler depends on trustworthy ordered Evidence.
- The workload measurements show that large JSON bursts can create long pending ages and material queued bytes. Capacity and overload need explicit behavior rather than an implicit performance assumption.

This delivered opportunity does not introduce rolling retention or a permanent history dashboard. The throwaway [Event History state-machine prototype](../prototypes/event-history-03/event-history-state-machine.html) remains decision evidence only. Release proof, including the real-Chrome verdict and any accepted `REVIEW` disposition, is retained on the internal Project ticket; `FAIL` remains a release blocker.

### Build 2 — Contextual Faceted Evidence Filtering

Expose the structured filters already supported by Event History:

- client, Session, Subscription, mode, event kind, item, listener, COMMAND key and operation;
- snapshot/live, Server/Local, and listener/wire source;
- inbound/outbound once Client Messages exist;
- captured error/loss code or severity once it is normalized onto the corresponding Evidence.

Required behavior:

- Clicking a meaningful value in Evidence or Context offers an explicit include/exclude filter action.
- Active criteria, shown/total counts, and one-step reset remain visible.
- “Only this key,” “Only this listener,” and “Events around this error” preserve current Scope and selection.
- Scope, Filter, and Find remain separate. Find navigates matches and never silently changes the visible set.
- A filtered-out selected event remains recoverable through the existing reveal-or-clear-selection pattern.

This replaces the old “faceted Timeline” proposal. It deepens Ordered Evidence and does not add a query-builder destination or permanent chip bar at every geometry.

### Build 3 — Scoped Observed Activity Dashboard

Give a developer a graphical answer to the initial diagnostic question: **where is observed activity or degradation concentrated, and which supporting Evidence should I inspect?** This is fast orientation over accepted Evidence, not a generic verdict that a Lightstreamer client is healthy or performing well.

The first release contains four coordinated views:

1. An activity timeline with aligned small multiples for Server Logical Updates and Update Deliveries. Logical Updates are divided into snapshot and live counts. Optional Local activity is a separate text-labelled series and is never blended into Server totals.
2. A discrete connection rail with captured client-status transitions and Lightstreamer Session boundaries. It does not fill the space between observations or calculate time in a state before the correlated interval model exists.
3. Timestamped markers for captured lost-update callbacks and subscription errors. A loss marker reports the captured count at that callback; it does not spread missing updates across earlier buckets or claim why they were lost.
4. A ranked breakdown of the busiest Subscriptions at Page, client, or Session Scope and the busiest items at Subscription Scope. Horizontal bars print exact counts and default to Server Logical Updates within the plotted Scope, Filter, and interval; Update Deliveries remain a separate sortable column. Graphical ranking shows the top 10 plus an explicit `Other`, ties use stable identity order, and a synchronized table exposes every identity.

Requested and real bandwidth and maximum-frequency values appear as labelled contextual facts. They become a plotted series only when Workbench has captured meaningful changes over time.

Truth and aggregation contract:

- A renderer-independent `ActivityProjection` consumes accepted Evidence only after commit and never reads pending capture messages as Evidence. Clear resets it with the other derived projections. It rebuilds from the current Event History rather than persisting a second aggregate history.
- Activity inherits the current Scope, Filter, History Interval, Retained Range, Committed Evidence Boundary, Observation Coverage, and Live/Frozen position. It has no parallel object selector, private Filter, private pause, or cross-session persistence.
- Page, client, Session, and Subscription Scope are supported. At Page Scope the connection rail keeps a bounded set of clients separate in recent-activity order and provides an explicit route to the remaining clients; client Scope shows its Session epochs; Session and Subscription Scope show only the owning Session. Multiple clients never become one synthetic connection state.
- With no provenance Filter, Server activity is the default and Local activity is an optional separate series. An explicit provenance Filter is authoritative and may require or exclude Local activity; a presentation toggle never silently changes the Filter.
- Logical Updates are counted once by logical identity. When object identity is unavailable, only the designated metric-owner observation contributes. Every listener callback remains a separate Update Delivery; one count is never estimated from the other.
- Exact counts use deterministic, consistently aligned bucket durations such as one second, five seconds, fifteen seconds, or one minute, selected from the retained time span rather than viewport width. Presentation is bounded to roughly 120 buckets without sampling Evidence. First, current, and final partial buckets remain explicit.
- A zero means zero matching accepted Evidence, not proof that the inspected client produced no activity. Limited or unavailable Observation Coverage remains visible and qualifies the conclusion. A metric Workbench cannot distinguish is `Unavailable`, not zero.
- A selected current bucket remains `LIVE · PARTIAL` and may grow until it closes. Deterministic rebucketing preserves a selected absolute interval rather than silently coercing it into a different bucket.
- A backward captured timestamp creates a textual clock discontinuity and splits the time visualization. Evidence sequence remains authoritative for supporting order; Workbench never smooths the regression or calculates an interval across it.
- Aggregation is exact within History Capacity. It never samples events, invents values, or silently presents a partial result as complete. An aggregation failure makes Activity explicitly unavailable without stopping Capture, acceptance, Ordered Evidence, or other projections.

Interaction and placement contract:

- A concise runtime-dossier summary exposes **Open Activity**. The full **Observed Activity** document is temporarily promoted and preserves the originating Scope, Filter, selection, scroll anchor, and Live/Frozen state. It is not a permanent peer destination.
- A deliberate Scope or Filter change recomputes every aggregate, clears any stale aggregate selection, preserves Panel Session-local presentation preferences, and creates a navigation entry that Back can restore.
- Selecting a bucket, marker, or ranked row first shows its exact interval, counts, provenance, and limitations. **Show supporting Evidence** then adds visible, removable time, type, provenance, Subscription, or item criteria as applicable; it never silently changes structural Scope.
- A time criterion uses `start <= timestamp < end`, clipped to the Retained Range, with Evidence sequence as the tie-breaker for equal timestamps. Back restores the prior dashboard selection, focus, chart and document scroll, Local-series visibility, ranked-table sort, Scope, Filter, and Live/Frozen boundary.
- Active Filters affect every view. A series excluded by Filter is named as excluded rather than silently replaced with unfiltered Scope data; **Show this context** may deliberately amend the visible Filter.
- Chart and table representations share one selection model. Each chart has a labelled synchronized data table, persistent textual selection detail, and a complete non-color meaning.
- Time charts use zero-based linear scales and no logarithmic fallback, clipping, normalization, or dual axes. Logical Updates, Update Deliveries, and Local activity remain distinct even when one series compresses another visually.
- Each chart is one keyboard composite: Left/Right moves between buckets, Up/Down moves between series or lanes, Home/End moves to the bounds, and Enter opens supporting Evidence. Tab and Shift+Tab remain the only cross-surface navigation commands.
- Live graphical publication is coalesced to approximately once per second even though every accepted event is aggregated. Hidden panels do not redraw; returning publishes one consolidated snapshot without replay animation. Passive updates never move focus, selection, or scroll and do not flash or pulse.
- Wide and normal layouts use the full canvas for aligned charts and the ranked breakdown. Compact and shallow layouts stack the same sections in one document scroll; an inherently two-dimensional time plot may own bounded horizontal scrolling, while the panel shell never scrolls horizontally.
- Confirmed Clear empties the prior interval and invalidates its aggregate selections; Back never manufactures removed Evidence. A capacity or journal stop leaves the final dashboard inspectable through its last Committed Evidence Boundary with the terminal limitation visible.

Explicitly deferred from this first release:

- end-to-end latency, source-to-client conflation, server throughput, server queue occupancy, and composite client-health scoring;
- synchronous listener duration, averages, percentiles, exceptions, and Long Task correlation;
- connection-state duration totals, recovery-loop conclusions, and complete server-error/keepalive analysis;
- changed-field density, approximate payload-byte profiling, buffering/loss correlation, and deeper requested-versus-real QoS conclusions;
- manual time-range editing or chart zoom, cross-capture comparison, and dashboard-specific import or export.

This is a Material UI change. Delivery requires deterministic primary, empty, limited-Coverage, aggregation-failure, clock-discontinuity, Clear, terminal-history, and 100,000-record scenarios; compact, normal, shallow, and wide geometry; Dark, Light, forced-colors, keyboard, focus, chart/table parity, and accessibility evidence; base/current/diff artifacts; independent visual QA; extension and official-client fixture proof; and explicit maintainer approval.

### Build 4 — Changed-Field, Delivery, Provenance, and Value-Semantics Inspection

Make a selected Item Update answer four questions without opening raw JSON:

1. What full field values were observed?
2. Which fields changed in this Logical Update?
3. Which listeners received Update Deliveries, in what order, and through which capture path?
4. Which distinctions are provable versus ambiguous?

Show contextually:

- full fields, changed fields, and captured JSON Patch values;
- Logical Update identity versus each Update Delivery and metric-owner limitations;
- snapshot/live and Server/Local provenance;
- first-level versus second-level origin where available;
- inherited or previously observed state only when a mode reducer proves it;
- explicit `unknown`, `unavailable`, `redacted`, `inferred`, and not-applicable states.

Important limitation:

- At the public API level, `null` may represent an explicit null, a value not yet received, or COMMAND delete context. Say “ambiguous null” unless command, prior-state, or optional wire evidence resolves it.

JSON Patch remains a specialist sub-lens. Verify that applying a patch to the previous JSON produces the captured result when both sides are actually available; do not imply that every delta or field has a reconstructible patch.

### Build 5 — Contextual Lightstreamer Diagnostics and Subscription Linting

Extend the existing diagnostic footer and runtime dossiers rather than create a permanent Diagnostics Center.

Capture and explain:

- `ClientListener.onServerError` and `onServerKeepalive`;
- subscription and second-level subscription errors;
- lost-update notifications and snapshot anomalies;
- COMMAND semantic warnings;
- Client Message outcomes after **Captured Client Messages and Deliberate Server Injection**;
- instrumentation, history-capacity, and coverage limitations;
- suspicious configuration, exact duplicates, overlaps, and churn.

Each diagnostic must identify:

- severity and affected runtime object or Evidence;
- original code and safely handled message where available;
- what Workbench observed;
- the consequence for the current conclusion;
- one relevant inspection or recovery route.

Subscription linting should explain:

- RAW snapshot restrictions;
- buffer constraints for filtered MERGE/DISTINCT subscriptions;
- COMMAND `key` and `command` requirements;
- two-level COMMAND constraints and field conflicts;
- active versus server-established state;
- suspicious mode/item overlaps and unfiltered-frequency refusal conditions.

Correctness limits:

- Non-positive server codes may be application-specific.
- Some server-initiated closes deliberately expose limited detail.
- A lost-update callback does not enumerate every update filtered or conflated by the server.
- A warning remains evidence-based guidance, not proof that an unusual configuration is wrong.

### Build 6 — Connection, Transport, Recovery, and Session-Epoch Lens

Provide a contextual client or Session lens over existing ordered Evidence:

- `CONNECTING`, streaming/polling transport, `STALLED`, recovery, retry, and disconnected intervals;
- time in each state;
- Session identity, server instance, socket name, masked client-IP change, and connection epochs;
- recovery attempts versus replacement Sessions;
- transport fallback or switch and resubscription boundaries;
- correlated server errors, keepalives, silence, and property changes.

Useful conclusions include repeated recovery loops, a new Session after failed recovery, transport churn, and server-instance changes consistent with affinity trouble.

Do not claim that a high-level recovery status proves the exact progressive position resumed. Exact proof requires optional protocol evidence.

This lens owns the correlated interval model and recovery conclusions. Once that model is accepted, it may enrich the Observed Activity connection rail with proven state segments and durations; the Build 3 rail remains limited to captured transitions until then.

### Build 7 — Snapshot Bootstrap and Resubscription Correctness Lens

Build on the shipped per-item snapshot phase and explain:

```text
waiting -> snapshot -> complete -> live -> cleared
```

Show:

- requested snapshot setting and DISTINCT history length;
- snapshot count, duration, end, clear, and first live update;
- empty snapshots and items still waiting for expected completion;
- the Session/subscription epoch to which the phase belongs;
- snapshot/live provenance on relevant Evidence;
- reset and new bootstrap after resubscription or Session replacement.

Mode-specific limits:

- MERGE has at most one snapshot update per item and no end-of-snapshot callback.
- DISTINCT may have zero or more snapshot events followed by end-of-snapshot.
- COMMAND snapshot is formed from `ADD` operations for active keys.
- RAW has no snapshot.
- First-level COMMAND end-of-snapshot does not prove that every second-level MERGE snapshot is complete.

This is an item/Subscription Context lens with related Evidence actions, not a new Snapshot destination.

Observed Activity may show snapshot/live counts and captured boundaries, but this lens owns mode-aware duration, completion, reset, and resubscription conclusions.

### Build 8 — Captured Client Messages and Deliberate Server Injection

Instrument `LightstreamerClient.sendMessage` and the associated `ClientMessageListener` as first-class outbound Evidence:

- immutable Captured Client Message;
- client and current Session identity;
- message sequence, delay timeout, and enqueue-while-disconnected choice;
- processed, denied, discarded, error, aborted, and unknown outcomes;
- call-to-outcome timing and connection/recovery context.

Then add the planned Server Injection workflow:

- Start from an immutable Captured Client Message or explicitly author a Client Message against one live client and Session.
- Copy it into a separate Injection Draft; never edit or suppress the application's original message.
- Reuse the one-active-Draft boundary. Starting Server Injection must not silently replace or coexist ambiguously with an active Local Injection Draft.
- Keep message, sequence, timeout, enqueue behavior, target client, and Session protected and reviewable at the correct boundary.
- Send exactly once through the inspected client's normal `sendMessage` path.
- Preserve `Unknown` as a terminal outcome. Never automatically retry; a deliberate Repeat Injection is a separate action with duplicate-effect guidance.
- Treat Observed Server COMMAND State as advisory only when an application-specific message is understood to represent a COMMAND action.
- Correlate later Server Updates only when application-supported Injection Attribution makes the causal link provable.

Presentation consequence:

- Outbound Evidence joins the existing ordered ledger.
- A sequence waterfall is a contextual lens for a client, Session, sequence, or selected message—not a new peer destination.
- Message bodies are arbitrary application data. Keep them local, make exposure deliberate, and include them in export redaction controls before any sharing workflow claims support.

Boundary:

- Server Injection sends a Client Message. It does not create an inbound Item Update, contact a Data Adapter directly, or generically translate an Item Update into a Client Message.

Accepted decisions: [observational Capture](adr/0001-keep-capture-observational.md), [unknown outcome handling](adr/0003-do-not-automatically-retry-unknown-server-injections.md), [Client Message boundary](adr/0004-send-server-injections-as-client-messages.md), and [advisory COMMAND state](adr/0005-treat-observed-command-state-as-advisory.md).

### Build 9 — Deterministic Multi-Event Local Injection Scenarios

Delivered through reviewed vertical slices under the accepted [single-target immutable Run-plan model](adr/0012-run-local-injection-scenarios-as-immutable-single-target-plans.md).

The accepted decision resolves the design gate as follows:

- membership is explicit, bounded, ordered, and independent of visible or filtered Evidence;
- every Step shares one exact Subscription, Session, page, and delivery-path target while retaining an independent Source and Draft;
- an immutable reviewed Run uses strictly serial relative delays and one monotonic active-time Scenario Clock;
- Step next, Play, Pause, Stop, hidden-panel auto-pause, and deliberate Run again never cancel an in-flight Injection, overlap, catch up, loop, or retry automatically;
- target retirement ends the Run, while listener drift or relevant interleaving Server Evidence pauses before another Step and requires explicit re-review;
- partial, failed, unknown, blocked, evidence-incomplete, and assertion-failed outcomes stop before the next Step without rollback or fabricated Local Evidence;
- initial assertions observe named Workbench Injection Outcomes, committed Evidence, or Local Effective COMMAND State, never arbitrary application or Authoritative COMMAND State; normalized-diagnostic presence is a later additive assertion after Build 5 supplies a stable observation contract;
- Scenario, Run, Step, Injection, request, outcome, assertion, and resulting Local Evidence identities remain independently correlated in a Panel Session-local Scenario Trace.

The repository release candidate now provides:

- previewing and confirming exact compatible Evidence membership;
- independent Source/Draft models per member;
- step, play, pause, speed, and stop;
- per-step target availability and outcome;
- session-local named zero-Injection Checkpoints;
- Workbench-owned Outcome, delivery-count, committed-Evidence, Local Effective COMMAND key, and strict primitive field assertions. Diagnostic presence remains omitted until Build 5's normalized diagnostic observation contract ships.

Guardrails:

- Visible Evidence is never implicit Scenario membership.
- A Scenario is not a Draft Set or automatic queue.
- Current Source comparison, validation, undo, Review, target, and outcome remain per Draft.
- Every execution remains Local Injection and never implies that an Item Update entered the server stream.

Accepted decision: [ADR 0012 — Run Local Injection Scenarios as immutable single-target plans](adr/0012-run-local-injection-scenarios-as-immutable-single-target-plans.md).

Dependency boundary: full Build 4 is not required to construct, execute, or trace a Scenario because the retained Item Update payload and current Local Injection contracts already carry the needed Source, Draft, target, provenance, outcome counts, and Evidence settlement. The only shared prerequisite is a narrow headless replayability/value-semantics contract that prevents sanitized, unavailable, or unresolved source fields from becoming executable values without explicit replacement; it serves Scenario Review and the later Build 4 inspector without requiring that inspector UI. Build 5's additional callback capture, explanations, and lint rules are likewise not execution gates. The first Scenario release deliberately omits diagnostic-presence assertions; that assertion family follows the narrow normalized diagnostic observation contract rather than blocking the rest of Build 9.

## P1 Opportunity Details

### Build 10 — Deep Delivery QoS and Loss Profiler

Extend Observed Activity with a separately labelled Delivery QoS layer. For a client or Subscription, compare requested and real bandwidth/frequency with measured application-boundary callback rates, changed-field density, approximate captured-payload bytes, requested buffer settings, lost-update intervals, and snapshot/live rates.

Keep each measurement qualified:

- callback rate is observed at the captured application boundary, not source or server throughput;
- real maximum frequency is a Subscription-level constraint, not a measured per-item server rate;
- approximate captured-payload bytes are not exact network or protocol bytes;
- lost-update callbacks do not enumerate every update filtered or conflated upstream;
- buffering, filtering, frequency, bandwidth, and loss may be correlated in time without claiming an unsupported cause.

Do not claim an exact source-to-client conflation ratio, per-item server frequency from a Subscription-wide callback, server queue occupancy, or end-to-end latency without a trustworthy application timestamp.

### Build 11 — Watch Rules and Conditional Listener Breakpoints

Define rules over status, error, Subscription, mode, item, listener, key, command, snapshot/live phase, field change/value/threshold, lost updates, or diagnostic severity.

Safe actions can freeze Evidence, pin the triggering event, increment a counter, or open Context. Pausing JavaScript with `debugger` is opt-in and must state whether it occurs before or after the application listener. Capture must remain observational and listener exceptions must still propagate normally.

### Build 12 — MERGE, DISTINCT, and RAW State Reconstruction With Point-in-Time Inspection

Add contextual reducers rather than permanent mode views:

- MERGE: current field state per item plus field history.
- DISTINCT: ordered snapshot/live segments and clear boundaries.
- RAW: exact delivered order with no reconstructed-state claim.
- All modes: inspect state immediately before and after selected Evidence.

Time travel is a lens anchored to Scope and Evidence selection. It must state where Capture began too late or a boundary makes reconstruction incomplete.

### Build 13 — Two-Level COMMAND Dependency and Merged-Row Inspector

Explain the relationship:

```text
first-level COMMAND item -> key -> implicit second-level MERGE item
```

Show first- and second-level fields with provenance, Data Adapters, automatic subscribe/unsubscribe behavior, second-level loss/errors, field-name conflicts, current merged row, and the key's lifecycle. Internal second-level subscriptions remain Evidence attached to structural Scope; they do not become ordinary Topology nodes or pretend to be returned by `getSubscriptions()`.

### Build 14 — Capture Import, Offline Investigation, and Fixture Generation

Extend the versioned export schema into an explicit imported-capture identity and offline investigation mode. Imported Evidence must be read-only, visibly separate from live Capture, and incapable of becoming a live Injection Target without an explicit compatible current-runtime selection.

First decide whether the existing structural snapshot schema is sufficient or a separate complete-capture bundle is required. Do not silently reinterpret a versioned Topology export as a lossless trace.

Useful generators:

- Vitest `ItemUpdate`-like fixture;
- JSON Scenario input after Scenario semantics are accepted;
- minimal TypeScript Subscription configuration;
- Markdown incident summary with scope, limitations, diagnostics, and timing.

Import requires schema migration, provenance, corruption handling, payload-size limits, and privacy review. It must not turn IndexedDB into implicit cross-session persistence.

### Build 15 — Listener Performance, Exception, and Registration-Churn Profiler

Measure synchronous callback duration, count/average/p95/max by listener and Subscription, exceptions recorded before rethrow, duplicate registration, add/remove churn, and optional Long Task correlation.

Use it to explain browser-side processing cost and duplicate Update Deliveries. Never call it end-to-end latency without a reliable source timestamp.

When integrated with Observed Activity, these measurements occupy a separately named **Listener execution cost** section. They never merge with delivery volume, connection reliability, or Workbench rendering into one health score.

### Build 16 — Correlated Lightstreamer Client-Log and TLCP Evidence

Offer two opt-in levels:

1. official client logs, correlated by client, Session, request, Subscription, and Client Message;
2. decoded TLCP evidence correlated with semantic Evidence.

The advanced lens may explain `SUBOK`, `SUBCMD`, `EOS`, `CS`, `OV`, `PROBE`, `LOOP`, request acknowledgements, recovery `PROG`, message completion, and wire encodings.

Detect the negotiated protocol version, treat decoding as stateful, tee rather than silently replace the application's logger provider, keep raw logging off by default, and redact credentials and application data from shared artifacts.

### Build 17 — Multi-Client, Version, Duplicate-Session, and Churn Audit

Extend the shipped duplicate/overlap and historical-Session facts to detect mixed discoverable Web Client versions, repeated client/session creation, repeated subscribe/unsubscribe cycles, duplicate listeners, and unusually high counts.

All findings remain heuristic. Multiple clients, overlapping Subscriptions, and churn can be intentional. Do not introduce a connection-sharing controller.

## P2 Opportunity Details

### Build 18 — Cross-Capture Comparison and Regression Diff

After import exists, compare two captures by client/connection configuration, Subscription sets, snapshot duration/completeness, diagnostics, loss, update rate, changed-field density, COMMAND end state, and Scenario outcomes. Primary uses are working-versus-broken, before-versus-after upgrade, and production-versus-local reproduction.

The comparison may extend Observed Activity with aligned graphical captures, but each side retains its own History Interval, Scope, Filter, Observation Coverage, provenance, and completeness limits. It does not reduce the two captures to one regression or health score.

### Build 19 — Cross-Frame, Worker, HTTP Transport, and Bundled-Client Coverage

Expand Observation Coverage reporting across same-origin/cross-origin frames, workers, ESM/bundled constructors, HTTP streaming/polling, and WebSocket fallback. Report what was observed and what may have been missed; never present an absent hook as proof that no client exists.

### Build 20 — Guarded Live QoS and Transport Tuning Lab

Allow explicit, reversible experiments with requested maximum frequency, requested session bandwidth, or forced transport where the public API permits it. Keep inspection read-only by default, state that each change performs a real client control operation, retain the observed baseline, and never imply that the client can raise a server-enforced limit.

### Build 21 — Mobile Push Notification Workbench

For applications using the optional MPN module, inspect device registration/suspension, MPN Subscription inventory, triggers, notification format, modification/unsubscription, and errors. This remains specialized and license-dependent.

## Disposition of the 2026-07-28 Backlog

| Previous opportunity | Reassessment |
| --- | --- |
| Client, Session, and Subscription Topology Inspector | Shipped as structural Scope and runtime Context; removed from backlog. |
| Unified Diagnostics Center | Keep the diagnostic work as **Contextual Lightstreamer Diagnostics and Subscription Linting**; reject a permanent Center. |
| Multi-Event Scenario Recorder and Deterministic Local Replay | Keep the value as **Deterministic Multi-Event Local Injection Scenarios**, replace replay language, and require an explicit Scenario design gate. |
| Connection, Transport, Rebind, and Recovery Timeline | Keep as the contextual **Connection, Transport, Recovery, and Session-Epoch Lens**. |
| Snapshot Bootstrap Visualizer and Correctness Checker | Snapshot phase shipped; keep the higher-order **Snapshot Bootstrap and Resubscription Correctness Lens**. |
| Faceted Timeline Filters and Clickable Filter Chips | Core filter support partially shipped; adapt it into **Contextual Faceted Evidence Filtering**. |
| Subscription Semantics Inspector and Configuration Linter | Inspector facts shipped; merge the remaining explanation into **Contextual Lightstreamer Diagnostics and Subscription Linting**. |
| Filtering, Frequency, Bandwidth, Buffer, and Loss Profiler | Move exact activity buckets and captured loss markers into **Scoped Observed Activity Dashboard**; retain richer measurement and correlation as **Deep Delivery QoS and Loss Profiler**. |
| Capture Freeze, Pause/Resume, and Retention Controls | Freeze and complete session-local history shipped. Do not prioritize pause/rolling retention without measured capacity pressure and a new completeness decision. |
| Conditional Event Breakpoints and Watch Rules | Still valuable as **Watch Rules and Conditional Listener Breakpoints**. |
| MERGE, DISTINCT, and RAW State Views With Time Travel | Keep reducers and point-in-time value as contextual state reconstruction; reject peer views. |
| Two-Level COMMAND Dependency Graph and Merged-Row Inspector | Capture and summaries partially shipped; keep the remaining depth in **Two-Level COMMAND Dependency and Merged-Row Inspector**. |
| Redacted Trace Export/Import and Test-Fixture Generation | Credential-safe scoped snapshot export shipped; a general trace schema, import, offline investigation, and generators remain in **Capture Import, Offline Investigation, and Fixture Generation**. |
| Field Provenance, Value Semantics, and JSON Patch Inspector | Elevated because the redesigned Context should make selected Evidence conclusive; retained as **Changed-Field, Delivery, Provenance, and Value-Semantics Inspection**. |
| Client-to-Server Message Sequence Waterfall | Expanded into **Captured Client Messages and Deliberate Server Injection**; the waterfall becomes one contextual lens. |
| Listener Performance, Exception, and Duplicate-Listener Profiler | Still valuable as **Listener Performance, Exception, and Registration-Churn Profiler**. |
| Correlated Lightstreamer Client-Log and TLCP Console | Keep as **Correlated Lightstreamer Client-Log and TLCP Evidence**, an opt-in contextual lens. |
| Multi-Client, Version, Duplicate-Session, and Churn Audit | Partially shipped; keep the remaining heuristics under the same opportunity. |
| Cross-Frame, Worker, HTTP Transport, and Bundled-Client Coverage Monitor | Still specialized and foundationally expensive; retain as **Cross-Frame, Worker, HTTP Transport, and Bundled-Client Coverage**. |
| Guarded Live QoS and Transport Tuning Lab | Still guarded and lower priority. |
| Mobile Push Notification Workbench | Still specialized. |
| Cross-Capture Comparison and Regression Diff | Keep after import. |

**Committed Evidence Boundary and Fail-Closed History Capacity** was delivered after the redesign and high-volume history work made the Evidence-acceptance and capacity boundary explicit. Its real-Chrome cutover disposition and release artifacts are retained on the internal Project ticket.

**Scoped Observed Activity Dashboard** is a newly identified opportunity in the 2026-08-12 reassessment rather than a renamed 2026-07-28 backlog row. It unifies already captured activity facts graphically while keeping the deeper QoS and listener measurements as separate later opportunities.

## Suggested Delivery Increments

### Increment A: Make Evidence Acceptance Truthful (delivered)

1. Delivered the single Event History state machine and Committed Evidence Boundary.
2. Made projections consume accepted Evidence only.
3. Defined fail-closed journal/capacity behavior and exact Clear cuts.
4. Surfaced only material Capture Operation, Observation Coverage, History Capacity, and completeness consequences.
5. Proved sustained, burst, failure, Clear, fallback, and teardown cases; retain the exact final release packet on the Project ticket.

### Increment B: Make the Redesigned Diagnose Journey Fast and Conclusive

1. Contextual filter facets and click-to-filter actions.
2. Scoped Observed Activity with exact accepted-Evidence aggregation and reversible graphical drill-down.
3. Changed fields, delivery identity, provenance, and value semantics.
4. Missing client callbacks and normalized diagnostic explanations.
5. Subscription linting.
6. Connection/recovery and snapshot correctness lenses.

### Increment C: Complete the Planned Server Boundary

1. Capture Client Messages and every listener outcome observationally.
2. Add outbound Evidence filters, Context, privacy handling, and export redaction.
3. Extend the single protected Injection Draft boundary to Client Messages and reviewed `sendMessage` execution.
4. Prove processed, denied, discarded, error, aborted, stale-Session, and unknown outcomes.
5. Add explicit Repeat Injection handling without automatic retry.

### Increment D: Delivered Multi-Event Local Scenarios

1. Resolved explicit membership, one exact target, monotonic active-time clock, partial-outcome, stop, drift, and assertion semantics in ADR 0012.
2. Added independent per-Step Drafts inside a temporary promoted Scenario document without weakening the protected standalone Draft boundary.
3. Implemented Step next, serial timed Play, Pause, Stop, hidden auto-pause, deliberate Run again, and bounded Scenario Traces.
4. Proved target retirement, inter-Step drift, terminal delivery and Evidence failures, and Workbench-owned Checkpoints without loops, automatic retry, rollback, or a batch bridge.

### Increment E: Add Deep Diagnostics and Sharing

1. Deep Delivery QoS and loss profiling as a separately bounded Observed Activity layer.
2. Watch rules and conditional listener breakpoints.
3. Mode reducers and point-in-time state.
4. Two-level COMMAND inspection.
5. Import, offline investigation, and fixture generation.
6. Listener profiling, client logs/TLCP, and broader client audits.

### Increment F: Expand Coverage and Specialized Workflows

1. Cross-capture comparison, including aligned graphical Activity only when each capture's boundaries remain explicit.
2. Frames, workers, HTTP transports, and bundled clients.
3. Guarded live tuning.
4. MPN tooling.

## Capture and State Changes Required

| Area | Additions or changes |
| --- | --- |
| Event History | Explicit pending/accepted states, Evidence sequence, Committed Evidence Boundary, History Interval, exact Clear cut, capacity/failure stop, adapter-independent state contract |
| Activity projection | Accepted-Evidence-only Logical Update deduplication, Update Delivery counts, deterministic time buckets, Scope/Filter aggregation, snapshot/live and Server/Local separation, connection/error/loss markers, ranked identities, Clear reset, clock-discontinuity handling, and explicit aggregation failure |
| Client listener | `onServerError` and `onServerKeepalive`; retain synchronous property reads in `onPropertyChange` |
| Outbound client API | `sendMessage` call, protected arguments, and every `ClientMessageListener` outcome |
| Event envelope | First-class Captured Client Message and Injection outcome data; accepted Evidence identity/sequence and History Interval |
| Connection/snapshot state | Correlated status intervals, transport and Session epochs, snapshot bootstrap epochs and completeness limits |
| Mode state | MERGE, DISTINCT, RAW, two-level COMMAND, and optional point-in-time reducers |
| Query/indexes | Visible bounded-time criteria, diagnostic severity/code, outbound sequence/outcome, QoS metrics, and imported-capture identity |
| Runtime/UI | Contextual lenses, the temporary promoted Observed Activity document, synchronized chart/table selection, and typed Evidence drill-down commands inside the existing Scope/Evidence/Context model; no feature-first peer navigation |

## Correctness and Product Guardrails

Workbench must not claim:

- that a captured event is Evidence before acceptance completes;
- Complete History beyond its History Interval and Committed Evidence Boundary;
- that History Capacity, Observation Coverage, Capture Operation, or Live/Frozen position are the same state;
- that zero matching accepted Evidence proves zero inspected-client activity when Observation Coverage cannot support that conclusion;
- that observed Logical Update or Update Delivery counts are server throughput, source-to-client delivery, end-to-end latency, or a composite client-performance score;
- that a Logical Update and its listener-specific Update Deliveries are interchangeable metrics;
- that captured connection transitions alone prove time in a state;
- that requested or real Subscription-level limits are measured per-item activity;
- that Server and Local activity may be blended into one unattributed total;
- that every missing source update was lost rather than filtered or conflated;
- that COMMAND operations preserve a dependable order across keys;
- that end-of-snapshot proves every two-level row is complete;
- that a null API value was explicitly sent without enough context;
- that internal second-level Subscriptions should appear in `getSubscriptions()`;
- that recovery status proves an exact resumed progressive position;
- that Local Injection enters the Lightstreamer Server update stream;
- that Server Injection directly creates an inbound Item Update;
- that a processed Client Message proves a downstream business effect;
- that a later Server Update was caused by Server Injection without Injection Attribution;
- that an Unknown Server Injection Outcome is safe to retry automatically.

Product boundaries to preserve:

- Lightstreamer-native primitives before optional application-specific adapters.
- Official Web Client API instrumentation first.
- Raw TLCP as supplemental diagnostics.
- Current-session operational storage, not implicit cross-session persistence.
- Observational Capture and immutable Evidence.
- Observed Activity derived from accepted Evidence only, with Scope, Filter, History Interval, Retained Range, Committed Evidence Boundary, Observation Coverage, and provenance visible at the aggregate decision boundary.
- Explicitly marked Local Evidence and separate COMMAND projections.
- One protected standalone Local Injection Draft or one explicitly authored Scenario; Workbench never activates or replaces either silently.
- Consequential client/server operations explicit, reviewed, and scoped.
- No permanent surface or navigation category without the accepted UI gate.
- No silent event sampling or partial aggregate presented as complete; Activity failure remains isolated from Capture and Event History.

## Not Recommended as Near-Term Core

- Reintroducing permanent Timeline, Topology, COMMAND State, Diagnostics, Snapshot, or Message peer destinations.
- A permanent card-style dashboard destination, decorative metric tiles, or a composite client-health score.
- A generic WebSocket inspector.
- Direct server-stream or Data Adapter Item Update injection.
- A generic Item-Update-to-Client-Message translator.
- Treating visible or selected Evidence as implicit Scenario membership.
- Adding a generic “run all” action that bypasses Scenario membership, Review, target, clock, or Trace semantics.
- Pause Capture or rolling retention as a substitute for Frozen Evidence and capacity work.
- Cross-session Capture persistence without a separate privacy, pruning, schema, and user-control decision.
- A privileged server-monitoring/JMX dashboard in the browser extension.
- Always-on DEBUG protocol logging.
- Automatic live mutation of transport, frequency, bandwidth, Subscription, or connection settings.
- A connection-sharing controller.
- Application-specific business-object interpretation in the core model.

## Evidence Used for This Reassessment

Repository decisions and implementation:

- [Domain language](../CONTEXT.md)
- [Canonical Developer Journeys](CANONICAL_DEVELOPER_JOURNEYS.md)
- [Workspace Information Architecture](WORKBENCH_WORKSPACE_INFORMATION_ARCHITECTURE.md)
- [Workbench UI Standard](WORKBENCH_UI_STANDARD.md)
- [Production UI Migration Plan](WORKBENCH_UI_MIGRATION_PLAN.md)
- [Architecture](ARCHITECTURE.md)
- [Normalized Evidence envelope](../src/core/event-envelope.ts)
- [Canonical Evidence filtering](../src/core/filter-algebra.ts) and [facet discovery](../src/core/evidence-filter-discovery.ts)
- [Topology state](../src/core/topology-state.ts)
- [Raw-JSON Local Injection editor research](research/local-injection-json-editor-patterns.md)
- [Event History workload facts](research/event-history-workload-facts.md)
- [Accepted ADRs](adr/)

Official product sources retained from the original review:

- [Lightstreamer Web Client 9.2.3 API](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/index.html)
- [LightstreamerClient](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LightstreamerClient.html)
- [ClientListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientListener.html)
- [ClientMessageListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ClientMessageListener.html)
- [ConnectionDetails](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionDetails.html)
- [ConnectionOptions](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ConnectionOptions.html)
- [Subscription](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/Subscription.html)
- [SubscriptionListener](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/SubscriptionListener.html)
- [ItemUpdate](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/ItemUpdate.html)
- [LoggerProvider](https://sdk.lightstreamer.com/ls-web-client/9.2.3/api/LoggerProvider.html)
- [General Concepts](https://lightstreamer.com/docs/ls-server/latest/General%20Concepts.pdf)
- [TLCP 2.5.0](https://www.lightstreamer.com/tlcp-2.5.0)
- [Web Client Guide](https://github.com/Lightstreamer/Lightstreamer-lib-client-haxe/blob/main/docs/WebClientGuide.adoc)
- [Web Client changelog](https://github.com/Lightstreamer/Lightstreamer-lib-client-haxe/blob/main/CHANGELOG-Web.md)
