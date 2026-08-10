---
status: accepted
---

# Make one session-owned journal the Evidence acceptance boundary

Workbench will use one Event History owned by each Panel Session as the acceptance boundary for Evidence. A captured event is not Evidence, does not extend the Committed Evidence Boundary, and cannot influence Topology or COMMAND projections until a successful ordered journal transaction accepts it. The journal publishes only committed Evidence in Capture order, and reads and replay use committed snapshots. This is the implementation contract for the later production cutover; this documentation increment does not change the current shipped architecture.

One Panel Session owns exactly one Event History and may contain multiple History Intervals separated by Clear. Clear is an ordered interval cut: a successful Clear ends the prior History Interval, publishes the reset, and starts the next interval while preserving the panel-lifetime Evidence sequence. Panel Session Close ends the Event History; no captured event awaiting acceptance can become Evidence after the close cut. A new Panel Session starts a new, empty Event History and never replays or recovers a prior session's Evidence.

## Adapter and capacity contract

Event History chooses exactly one startup Adapter before the first offer. It tries the primary IndexedDB Adapter, and selects the startup memory Adapter if primary startup, ownership coordination, or guarded cleanup cannot be confirmed. The choice is never migrated or changed during the Panel Session. Startup memory fallback lowers History Capacity but does not change Observation Coverage.

There is no mid-session Adapter switch. A journal failure does not silently move a running Event History to the memory Adapter.

Count and retained-byte capacity are independent, and the first limit reached controls admission. Equality is allowed; an offer is refused when accepting it would exceed either limit. A MiB is 1,048,576 bytes.

| Adapter tier | Maximum Evidence count | Maximum retained serialized bytes | Meaning |
| --- | ---: | ---: | --- |
| Primary IndexedDB (`NORMAL`) | 10,000 | 64 MiB | Normal supported History Capacity |
| Startup memory fallback (`LOWER`) | 5,000 | 32 MiB | Truthful lower-capacity History Capacity |

`NEAR_LIMIT` begins when either retained dimension reaches 80% of its hard limit. It returns to `AVAILABLE` only when every retained and pending pressure dimension is below its warning threshold. A warning does not refuse an offer.

Pending backlog pressure uses the canonical replay-payload bytes of Evidence candidates awaiting acceptance and a monotonic oldest-pending age:

| Adapter tier | Pending-byte warning | Pending-byte stop | Age warning | Pending-age stop |
| --- | ---: | ---: | ---: | ---: |
| Primary IndexedDB (`NORMAL`) | 16 MiB | 32 MiB | 10 seconds | 30 seconds |
| Startup memory fallback (`LOWER`) | 16 MiB | 32 MiB | 1 second | 5 seconds |

Pending-byte warning and age warning set `NEAR_LIMIT` and allow Capture to continue while commits catch up. A pending-byte offer is allowed when the resulting total is exactly 32 MiB and refused when it would exceed 32 MiB. An age stop latches when the oldest pending age reaches its tier's limit.

## Commit, publication, and fail-closed stop

The Capture offer is synchronous and bounded. It copies and validates the candidate, reserves capacity, and returns a queued or refused receipt without waiting for the Adapter, a batch, a panel consumer, or the inspected page. Workbench never applies backpressure to the inspected application.

On a proactive retained-count, retained-byte, pending-byte, or pending-age stop, Event History immediately refuses the crossing or first post-latch offer and all later offers, then enters `DRAINING_TO_STOP`. Candidates already returned as queued remain eligible to commit in Capture order. The final Committed Evidence Boundary may advance through that queued prefix; after it settles, one terminal publication records the final boundary and Event History becomes irreversibly stopped. If the drain encounters a journal failure, the journal-failure boundary supersedes the proactive drain boundary. The first refused capture is where the runtime derives `Capture Operation` `STOPPED` and `Observation Coverage` `LIMITED`. Clear is not a restart.

An atomic transaction either accepts the whole ordered batch or accepts none of it. A transaction failure commits no member of the failed batch, publishes no member, and settles the failed batch and every queued tail candidate as not Evidence. Event History refuses later offers and stops at the Committed Evidence Boundary immediately preceding the failed batch. There is no invisible transaction retry and no later commit after the first failed batch. No failed, discarded, or refused candidate receives an Evidence sequence, publication, Topology effect, or COMMAND projection effect. The retained Event History remains Complete History through its final Committed Evidence Boundary.

Typed terminal reasons include `RETAINED_COUNT_LIMIT`, `RETAINED_BYTE_LIMIT`, `PENDING_BYTE_LIMIT`, `PENDING_AGE_LIMIT`, `QUOTA_EXCEEDED`, and `JOURNAL_COMMIT_FAILED`.

Topology and both COMMAND projections advance only from committed Event History publication. A Topology Checkpoint Evidence record is subject to the same acceptance boundary as an ordinary captured event; its staging inputs are not Evidence. A delivered Local Injection remains truthful about its delivery outcome when recording fails, but it creates no Local Evidence and does not change Local Effective COMMAND State unless the synthetic candidate is accepted.

## Panel Session ownership and cleanup

The Panel Session is the ownership boundary, not the inspected tab. The Event History journal is isolated per Panel Session, and tab identity is routing metadata rather than journal ownership. Controlled Close makes a final synchronous intake cut, refuses later offers, settles the accepted prefix where possible, erases retained and pending Capture data, releases ownership, and reports whether erasure was confirmed and whether cleanup completed. Workbench never claims asynchronous erasure completed without evidence of that result.

Abnormal termination cannot rely on an unload callback. A guarded cleanup sweep later considers only recognized Workbench journal generations, acquires the corresponding ownership guard, skips an active owner, and deletes an orphan only while ownership is available. It preserves unknown newer generations rather than deleting them speculatively. A pagehide Close is best effort; a crash, renderer termination, extension reload, or blocked cleanup may defer cleanup and leave data until a later guarded sweep. The sweep never reads, exports, projects, or replays the abandoned Evidence.

## Considered Options

- **Threshold migration.** Rejected. Moving a running history from memory to IndexedDB at a threshold would introduce a second acceptance path, a migration boundary, and opportunities for blocking, gaps, duplicates, or ambiguous capacity and cleanup semantics. Adapter selection is therefore made once at startup.
- **Split-store or hybrid query.** Rejected. Keeping pending, live, or newer Evidence in one store while querying another would give publication, replay, Clear, and read paths different boundaries and could make a query or projection omit committed facts. One journal owns acceptance, publication, and committed-snapshot reads.
- **Tab-owned database.** Rejected. A tab is not a Panel Session owner: simultaneous panels for one tab could clear or close one another's history, and reused tab identifiers could address unrelated residue. Per-Panel-Session ownership preserves isolation.
- **Shared database.** Rejected. A database shared by panels would couple their schema upgrades, transaction pressure, ownership predicates, and cleanup lifecycles; one panel's Clear or teardown could compete with or erase another panel's Event History. One journal per Panel Session makes whole-session ownership and erasure local.
- **Cross-session recovery.** Rejected. Reopening a panel with prior Evidence would blur Panel Session and History Interval boundaries, create stale-data and privacy surprises, and make Complete History and provenance claims ambiguous. A new Panel Session starts empty; abandoned journals are cleanup targets, never replay sources.

## Consequences

- Evidence acceptance, publication, projection advancement, replay, and reads have one committed boundary. Pending work remains outside Evidence until the transaction completes.
- A lower-capacity startup Adapter changes History Capacity only. Capture, Observation Coverage, Complete History through the accepted boundary, and Live/Frozen view state remain separate concerns.
- A bounded nonblocking offer protects the inspected application from journal latency, but a workload or transaction failure can stop Capture at a truthful final Committed Evidence Boundary and cannot be resumed by Clear or by switching Adapters.
- One Panel Session has one owned Event History, and cleanup is explicitly controlled or guarded rather than promised unconditionally. Abnormal cleanup may be deferred, but no cross-session replay is available.
- Future production work must preserve the exact capacity envelope, fail-closed transaction boundary, ownership unit, and committed-publication contract recorded here. Current-behavior documents and shipped claims remain unchanged until the later production cutover.
