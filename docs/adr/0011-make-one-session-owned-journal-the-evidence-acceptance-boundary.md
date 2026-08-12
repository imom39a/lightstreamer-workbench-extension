---
status: accepted
---

# Make one session-owned journal the Evidence acceptance boundary

Workbench will use one Event History owned by each Panel Session as the acceptance boundary for Evidence. A captured event is not Evidence, does not extend the Committed Evidence Boundary, and cannot influence Topology or COMMAND projections until a successful ordered journal transaction accepts it. The journal publishes only committed Evidence in Capture order, and reads and replay use committed snapshots. This is the implementation contract for the later production cutover; this documentation increment does not change the current shipped architecture.

> Historical context: the preceding sentence records the state when this ADR
> was authored. The production cutover is complete; the current implementation
> outcome is recorded below and is authoritative for shipped behavior.

One Panel Session owns exactly one Event History and may contain multiple History Intervals separated by Clear. Clear is an ordered interval cut: a successful Clear ends the prior History Interval, publishes the reset, and starts the next interval while preserving the panel-lifetime Evidence sequence. Panel Session Close makes a final synchronous intake cut: it refuses post-cut offers, while candidates offered before the cut and already returned as `QUEUED` may still commit in Capture order. Close then applies the accepted drain or journal-failure boundary, performs controlled cleanup, and ends the Panel Session; a post-cut offer can never become Evidence. A new Panel Session starts a new, empty Event History and never replays or recovers a prior session's Evidence.

Clear has an atomic failure rule. If a failed Clear transaction proves that the prior History Interval is unchanged, it publishes no reset and re-joins post-cut candidates to that old History Interval in Capture order; Capture continues. If preservation of the prior interval cannot be proven, the failure becomes a terminal journal failure at the preceding Committed Evidence Boundary, with no reset or later acceptance.

## Event History journal implementation and capacity contract

Event History chooses exactly one startup journal implementation before the first offer. It tries the primary IndexedDB journal implementation, and selects the startup memory journal implementation if primary startup, ownership coordination, or guarded cleanup cannot be confirmed. The choice is never migrated or changed during the Panel Session. Startup memory fallback lowers History Capacity but does not change Observation Coverage.

There is no mid-session journal implementation switch. A journal failure does not silently move a running Event History to the memory journal implementation.

Count and retained-byte capacity are independent, and the first limit reached controls admission. Equality is allowed; an offer is refused when accepting it would exceed either limit. A MiB is 1,048,576 bytes. Retained serialized bytes are the UTF-8 size of the canonical replay-complete journal payload plus one deterministic logical record frame. The v1 logical frame is eight bytes: a four-byte payload length followed by a four-byte framing-version value. This framing is computed synchronously before admission and is shared by the memory and IndexedDB journals. It includes projection-relevant Topology and value-state facts and Topology Checkpoint Evidence facts. It excludes derived facets, indexes, and filesystem amplification; capacity never uses sanitized export bytes.

| Journal implementation tier | Maximum Evidence count | Maximum retained serialized bytes | Meaning |
| --- | ---: | ---: | --- |
| Primary IndexedDB (`NORMAL`) | 10,000 | 64 MiB | Normal supported History Capacity |
| Startup memory fallback (`LOWER`) | 5,000 | 32 MiB | Truthful lower-capacity History Capacity |

`NEAR_LIMIT` begins when either retained dimension reaches 80% of its hard limit. It returns to `AVAILABLE` only when every retained and pending pressure dimension is below its warning threshold. A warning does not refuse an offer.

Pending backlog pressure uses the same canonical replay-complete journal payload and eight-byte logical framing bytes for Evidence candidates awaiting acceptance, plus a monotonic oldest-pending age:

| Journal implementation tier | Pending-byte warning | Pending-byte stop | Age warning | Pending-age stop |
| --- | ---: | ---: | ---: | ---: |
| Primary IndexedDB (`NORMAL`) | 16 MiB | 32 MiB | 10 seconds | 30 seconds |
| Startup memory fallback (`LOWER`) | 16 MiB | 32 MiB | 1 second | 5 seconds |

Pending-byte warning and age warning set `NEAR_LIMIT` and allow Capture to continue while commits catch up. A pending-byte offer is allowed when the resulting total is exactly 32 MiB and refused when it would exceed 32 MiB. An age stop latches when the oldest pending age reaches its tier's limit.

## Supported workload and developer-run gate

History Capacity is bounded by this measured workload envelope, not by elapsed time. It covers these Lightstreamer-native Evidence shapes:

| Evidence shape | Reference shape anchor | Workload requirement |
| --- | --- | --- |
| Small lifecycle | 315 UTF-8 bytes in the sanitized export envelope; not capacity accounting | 50 offered events/second sustained and an immediate 1,692-event burst when interval capacity remains |
| Ordinary COMMAND Item Update | 807 UTF-8 bytes in the sanitized export envelope; not capacity accounting | 50 offered events/second sustained and an immediate 1,692-event burst when interval capacity remains |
| Large JSON-rich Item Update | 13,125 UTF-8 bytes in the sanitized export envelope; not capacity accounting | 50 offered events/second sustained and an immediate 1,692-event burst when interval capacity remains; backlog is supported and must not silently lose Evidence |
| Topology Checkpoint Evidence | A representative validated outcome and the maximum 2 MiB staged outcome | Measure the checkpoint alone, including the oversized-batch case beyond the soft 1 MiB target, and interleaved with live 50-offered-events/second Capture |

The full replay-complete Topology Checkpoint Evidence payload counts toward retained and pending byte limits. The maximum 2 MiB checkpoint may form one oversized batch by itself.

For every supported shape, duration is bounded by accepted count and canonical replay-complete serialized bytes, not by wall-clock session length. The immediate burst is supported whenever enough History Interval capacity remains. The normal journal implementation envelope is 10,000 Evidence records or 64 MiB; the startup memory journal implementation envelope is 5,000 Evidence records or 32 MiB, with the first independent limit reached controlling admission.

The visible-latency contract is defined as follows. `offer-to-visible` starts when `offer` receives the captured event and ends at the first animation frame whose rendered Committed Evidence Boundary includes it; rendering may coalesce committed batches. A hidden-panel run reports `offer-to-publication` instead and does not fabricate paint timing.

- Sustained visible Capture offer-to-visible p95 is at most 100 ms for the primary IndexedDB journal implementation and 50 ms for the startup memory journal implementation.
- The final boundary of an immediate 1,692-event burst is visible within 30 seconds for the primary IndexedDB journal implementation and 1 second for the startup memory journal implementation.
- Settled query p95 is at most 50 ms for a recent page, 100 ms for a structured/indexed query, and 500 ms for Find or full-history retrieval. Time deliberately queued behind accepted writes is excluded from settled-query budgets, but behind-backlog latency is reported separately.
- Capture, commit, and paint produce no Long Task over 50 ms. A query phase may produce at most one Long Task over 50 ms for one large JSON-rich workload, no Long Task may exceed 125 ms, and small and ordinary query workloads permit none over 50 ms.
- Post-GC Event History JS-heap delta is at most 8 MiB for the primary IndexedDB journal implementation at the 10,000-event mixed checkpoint and 32 MiB for the startup memory journal implementation at the 5,000-event mixed checkpoint.
- Repeated Panel Session lifecycle samples show no strict monotonic retained-heap growth.

Before the production cutover, a deliberate developer-run real-Chrome report exercises three independent samples for every journal implementation tier, workload kind, and payload shape through the actual Event History journal implementation and actual React panel path. An unpacked-extension DevTools-panel smoke verifies shipped integration but is not a timing baseline. The report records shape bytes, rates and burst pattern, count/order proofs, pressure transitions and limits, publication/visible and behind-backlog latency, query classes, Long Tasks by phase, post-GC heap, lifecycle samples, and every terminal boundary fact.

The report produces one actionable judgment:

- `FAIL` means any count/order/correctness mismatch, incorrect terminal boundary or outcome, unhandled error, or absolute workload-tolerance breach.
- `REVIEW` means all absolute gates pass but the median of three comparable samples regresses by more than 20% from the pinned reference, or the environment is not comparable enough for a relative judgment.
- `PASS` means correctness and every absolute gate pass without a review trigger.

Relative comparison uses the pinned reference for the same journal implementation tier, workload, shape, Chrome major, and platform/architecture class. A new report never adopts itself as the reference; baseline changes require an explicit rationale and maintainer disposition.

## Commit, publication, and fail-closed stop

The Capture offer is synchronous and bounded. It copies and validates the candidate, reserves capacity, and returns a queued or refused receipt without waiting for the journal implementation, a batch, a panel consumer, or the inspected page. Workbench never applies backpressure to the inspected application.

On a proactive retained-count, retained-byte, pending-byte, or pending-age stop, Event History immediately refuses the crossing or first post-latch offer and all later offers, then enters `DRAINING_TO_STOP`. Candidates already returned as queued remain eligible to commit in Capture order. The final Committed Evidence Boundary may advance through that queued prefix; after it settles, one terminal publication records the final boundary and Event History becomes irreversibly stopped. If the drain encounters a journal failure, the journal-failure boundary supersedes the proactive drain boundary. The first refused capture is where the runtime derives `Capture Operation` `STOPPED` and `Observation Coverage` `LIMITED`. Clear is not a restart.

An atomic transaction either accepts the whole ordered batch or accepts none of it. A transaction failure commits no member of the failed batch, publishes no member, and settles the failed batch and every queued tail candidate as not Evidence. Event History refuses later offers and stops at the Committed Evidence Boundary immediately preceding the failed batch. There is no invisible transaction retry and no later commit after the first failed batch. No failed, discarded, or refused candidate receives an Evidence sequence, publication, Topology effect, or COMMAND projection effect. The retained Event History remains Complete History through its final Committed Evidence Boundary.

Typed terminal reasons include `RETAINED_COUNT_LIMIT`, `RETAINED_BYTE_LIMIT`, `PENDING_BYTE_LIMIT`, `PENDING_AGE_LIMIT`, `QUOTA_EXCEEDED`, and `JOURNAL_COMMIT_FAILED`.

Topology and both COMMAND projections advance only from committed Event History publication. A Topology Checkpoint Evidence record is subject to the same acceptance boundary as an ordinary captured event; its staging inputs are not Evidence. ADR 0006 remains the accepted separate-projection decision, but this ADR partially qualifies its delivery rule for the target Event History contract: a delivered Local Injection remains truthful about its delivery outcome when recording fails, yet delivery alone does not change Local Effective COMMAND State. The corresponding Local Injected Update must first be accepted as committed Evidence; this target qualification does not claim that current production behavior changed.

## Panel Session ownership and cleanup

The Panel Session is the ownership boundary, not the inspected tab. The Event History journal is isolated per Panel Session, and tab identity is routing metadata rather than journal ownership. Controlled Close makes a final synchronous intake cut, refuses later offers, settles the accepted prefix where possible, erases retained and pending Capture data, releases ownership, and reports whether erasure was confirmed and whether cleanup completed. Workbench never claims asynchronous erasure completed without evidence of that result.

Abnormal termination cannot rely on an unload callback. A guarded cleanup sweep later considers only recognized Workbench journal generations, acquires the corresponding ownership guard, skips an active owner, and deletes an orphan only while ownership is available. It preserves unknown newer generations rather than deleting them speculatively. A pagehide Close is best effort; a crash, renderer termination, extension reload, or blocked cleanup may defer cleanup and leave data until a later guarded sweep. The sweep never reads, exports, projects, or replays the abandoned Evidence.

## Considered Options

- **Threshold migration.** Rejected. Moving a running history from memory to IndexedDB at a threshold would introduce a second acceptance path, a migration boundary, and opportunities for blocking, gaps, duplicates, or ambiguous capacity and cleanup semantics. Journal implementation selection is therefore made once at startup.
- **Split-store or hybrid query.** Rejected. Keeping pending, live, or newer Evidence in one store while querying another would give publication, replay, Clear, and read paths different boundaries and could make a query or projection omit committed facts. One journal owns acceptance, publication, and committed-snapshot reads.
- **Tab-owned database.** Rejected. A tab is not a Panel Session owner: simultaneous panels for one tab could clear or close one another's history, and reused tab identifiers could address unrelated residue. Per-Panel-Session ownership preserves isolation.
- **Shared database.** Rejected. A database shared by panels would couple their schema upgrades, transaction pressure, ownership predicates, and cleanup lifecycles; one panel's Clear or teardown could compete with or erase another panel's Event History. One journal per Panel Session makes whole-session ownership and erasure local.
- **Cross-session recovery.** Rejected. Reopening a panel with prior Evidence would blur Panel Session and History Interval boundaries, create stale-data and privacy surprises, and make Complete History and provenance claims ambiguous. A new Panel Session starts empty; abandoned journals are cleanup targets, never replay sources.

## Consequences

- Evidence acceptance, publication, projection advancement, replay, and reads have one committed boundary. Pending work remains outside Evidence until the transaction completes.
- A lower-capacity startup journal implementation changes History Capacity only. Capture, Observation Coverage, Complete History through the accepted boundary, and Live/Frozen view state remain separate concerns.
- A bounded nonblocking offer protects the inspected application from journal latency, but a workload or transaction failure can stop Capture at a truthful final Committed Evidence Boundary and cannot be resumed by Clear or by switching journal implementations.
- One Panel Session has one owned Event History, and cleanup is explicitly controlled or guarded rather than promised unconditionally. Abnormal cleanup may be deferred, but no cross-session replay is available.
- Future production work must preserve the exact capacity envelope, fail-closed transaction boundary, ownership unit, and committed-publication contract recorded here. Current-behavior documents and shipped claims remain unchanged until the later production cutover.

## Current production outcome (2026-08-12)

The acceptance boundary described by this ADR is now the shipped Event History
contract. One Panel Session owns one temporary journal. The normal IndexedDB
tier supports 10,000 Evidence records or 64 MiB of retained serialized journal
bytes; startup memory fallback supports 5,000 records or 32 MiB. The selected
adapter is fixed before the first offer, and fallback changes History Capacity
only, not Observation Coverage.

Complete History means all accepted candidates in the current History Interval
through its Committed Evidence Boundary. Clear is an exact interval cut after
accepted work settles and cannot restart a stopped history. Capacity pressure or
journal failure refuses later offers, settles any queued prefix, records the
final boundary and terminal cause, and stops fail-closed; no adapter switch or
later Clear resumes it.

Controlled Close makes a final intake cut, attempts erasure, and reports whether
data erasure and cleanup were confirmed. Abnormal termination can defer cleanup
until a later ownership-safe guarded sweep, which never replays abandoned
Evidence. A new Panel Session starts empty and has no cross-session recovery.
