# Continuous Event History ingestion under capacity and journal failure

Status: decision-support research with maintainer-accepted direction,
2026-08-29. Change class: **Non-UI** for this note. This document records
primary-source facts and clearly separated design implications; it does not
change production behavior.

## Executive findings

1. **The checked-in normal limit is already 100,000 Evidence records or 256
   MiB, not 10,000.** The startup memory fallback remains 5,000 records or 32
   MiB ([capacity defaults](../../src/core/event-history-capacity.ts#L74-L95)).
   If a real session becomes unusable around 10,000 events, the immediate
   suspect is a journal/backlog failure, physical IndexedDB amplification, or a
   path outside the normal tier—not the current normal count constant.
2. **One commit failure permanently stopping Capture is a Workbench policy,
   not an IndexedDB requirement.** IndexedDB guarantees that a failed
   read/write transaction writes all of its changes or none of them. That
   protects the preceding Committed Evidence Boundary and makes a new
   transaction with the same immutable batch technically possible. The current
   implementation instead discards the failed batch and queued tail, enters
   `DRAINING_TO_STOP`, and never offers again
   ([current failure path](../../src/core/event-history-indexeddb.ts#L920-L937)).
3. **Canonical append is unnecessarily coupled to rebuildable indexes.** One
   IndexedDB transaction currently writes Evidence/control plus query
   projections, facet postings, and aggregates. Any derived-store failure can
   therefore abort the Evidence append. The proposed separation of those stores
   is a Workbench architectural inference, not a browser requirement.
4. **Removing every bound is not viable.** Browser storage has quota and can
   fail or be evicted, JavaScript heap is finite, and the IndexedDB usage/quota
   values are estimates rather than reservations. The useful replacement for
   a stop cap is a **bounded rolling Retained Range with exact loss/eviction
   accounting**, not an unbounded Event History.
5. **Primary observability systems explicitly separate intake from
   retention.** Perfetto's default ring buffer overwrites old trace packets
   when a writer catches the reader; its alternate `DISCARD` policy stops
   accepting new packets in that buffer. Chrome's tracing protocol reports
   when the trace ring wrapped and data was lost. OpenTelemetry says emission
   paths should not block or throw, long-running background work should not
   fail permanently after an internal error, and bounded queues may drop data
   with warnings and counters.
6. **Workbench should prefer continued, recent diagnostic value over a
   permanent fail-closed stop, while remaining explicit about evidence
   limitations.** Capacity rollover, a failed-batch recovery, and an adapter
   degradation must never be described as Complete History when they create a
   gap. Continued Capture is valuable only if the UI and query contracts tell
   the developer exactly what was retained, evicted, or not accepted.

## Current Workbench contract and why it is fragile

The public `EventHistory` interface synchronously `offer`s a candidate, returns
a queued/refused receipt, and settles the receipt only after journal acceptance
([interface](../../src/core/event-history-authoritative.ts#L129-L139),
[module seam](../../src/core/event-history-authoritative.ts#L264-L277)). Only
committed publications advance Topology, COMMAND projections, and the Evidence
window ([architecture](../ARCHITECTURE.md#L477-L484)).

The normal IndexedDB implementation serializes and reserves the candidate on
the calling path, batches pending candidates, then writes Evidence, query
projections, facet postings, facet aggregates, and the control record in one
read/write transaction
([commit transaction](../../src/core/event-history-indexeddb.ts#L3030-L3106)).
That transaction shape is coherent. The fragility comes from the state-machine
choice after rejection:

- a retained-count, retained-byte, pending-byte, or pending-age crossing starts
  an irreversible drain and refuses the crossing candidate
  ([admission](../../src/core/event-history-indexeddb.ts#L826-L862));
- any commit exception becomes `QUOTA_EXCEEDED` or the catch-all
  `JOURNAL_COMMIT_FAILED`, discards the complete failed batch plus every queued
  candidate, and begins terminal persistence
  ([commit catch](../../src/core/event-history-indexeddb.ts#L920-L937));
- every later offer is refused and `Clear` cannot restart the journal
  ([ADR 0011](../adr/0011-make-one-session-owned-journal-the-evidence-acceptance-boundary.md#commit-publication-and-fail-closed-stop)).

This behavior deliberately preserves Complete History through the last
Committed Evidence Boundary, but it turns a storage subsystem failure into a
permanent loss of all later debugging value. Raising the cap does not alter
that coupling: a single `UnknownError`, I/O failure, transaction timeout, quota
surprise, or implementation defect can still stop a one-minute or one-hour
session.

There is already a local precedent for a different retention contract. The
Diagnostic Observation journal bounds retained count and bytes, advances its
logical sequence while removing old records, reports `retention-gap` to stale
queries/subscribers, and recovers its mutation tail after an individual
operation rejects
([types](../../src/core/diagnostic-observation.ts#L92-L103),
[serialized mutation and retention](../../src/core/diagnostic-observation.ts#L228-L270),
[gap query](../../src/core/diagnostic-observation.ts#L320-L343)). Event History
is much higher volume and cannot copy its full-state persistence
implementation, but the explicit retention-gap semantics are relevant.

## What IndexedDB guarantees—and what it does not

### A failed batch has an exact atomic boundary

IndexedDB requires requests within one transaction to execute in request order.
On abort it rolls back all changes in the transaction; on commit it must write
all changes atomically or none, including when a disk-write error occurs
([IndexedDB 3.0 transaction lifecycle](https://www.w3.org/TR/IndexedDB/#transaction-lifetime-concept),
[commit algorithm](https://www.w3.org/TR/IndexedDB/#commit-transaction)). A
transaction's `complete` event fires only after changes were successfully
written, while `transaction.error` exposes the abort reason
([IDBTransaction](https://www.w3.org/TR/IndexedDB/#idbtransaction)).

Consequences for Workbench:

- the current Committed Evidence Boundary remains trustworthy after an aborted
  append;
- an immutable failed batch can be retried in a new transaction without first
  undoing a partial commit;
- retry identity and ordering must remain owned by Event History, not regenerated
  independently by an adapter;
- a retry is a policy decision. IndexedDB itself does not promise that the next
  attempt will succeed.

### Error names support classification, not one catch-all policy

The specification distinguishes malformed data and state errors from storage
conditions. `ConstraintError`, `DataCloneError`, and `DataError` identify
deterministic request problems; `NotReadableError` means underlying storage
could not be read; `UnknownError` is explicitly defined as a transient failure;
and `QuotaExceededError` means remaining space or quota was insufficient
([IndexedDB exceptions](https://www.w3.org/TR/IndexedDB/#exceptions)). The
commit algorithm specifically allows `QuotaExceededError` or `UnknownError`
when writing outstanding changes.

Workbench currently maps every non-quota exception—including errors injected by
its own projection/index preparation seam—to `JOURNAL_COMMIT_FAILED`. That is
useful as a user-facing umbrella but too coarse to drive recovery. Blindly
retrying deterministic schema/constraint corruption can loop forever; treating
a specified-transient `UnknownError` as permanent throws away recoverable
Capture.

### Durability is a supported transaction hint

IndexedDB transactions accept a durability hint of `default`, `strict`, or
`relaxed`. With `strict`, a user agent may wait until it has verified that the
changes reached persistent storage. With `relaxed`, it may report commit after
the changes have reached the operating system without a subsequent persistence
verification. The specification encourages `relaxed` for ephemeral caches or
quickly changing records, and `strict` when protection against operating-system
crash or power loss is worth the performance and power cost
([transaction durability](https://www.w3.org/TR/IndexedDB/#transaction-concept),
[`IDBTransactionOptions`](https://www.w3.org/TR/IndexedDB/#dom-idbdatabase-transaction)).

This hint changes when the user agent may consider a transaction committed; it
does not remove transactional atomicity, quota limits, request errors, or the
need to wait for `complete` before publishing Evidence.

### Rolling deletion can share the append transaction

IndexedDB object stores can delete a key range, and the deletion operation also
removes the corresponding records from indexes
([object-store `delete`](https://www.w3.org/TR/IndexedDB/#dom-idbobjectstore-delete),
[deletion operation](https://www.w3.org/TR/IndexedDB/#object-store-deletion-operation)).
Because deletes, additions, derived index writes, and the control record can be
placed in one read/write transaction, Event History can atomically replace an
old retained prefix with a new committed suffix. Either both the new Evidence
and the revised Retained Range become visible, or neither does.

This does not make storage infinite. It supplies a coherent implementation
primitive for a bounded rolling window.

## Chrome extension storage constraints

Chrome says extension-origin IndexedDB is subject to normal quota restrictions
by default, `navigator.storage.estimate()` reports the origin estimate, and
storage can rarely be evicted under heavy pressure. Extension storage is shared
across the extension origin, including extension pages and the service worker.
`unlimitedStorage` exempts IndexedDB from quota and eviction, while
`navigator.storage.persist()` can protect against eviction
([Chrome extension storage](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies),
[permission definition](https://developer.chrome.com/docs/extensions/reference/permissions-list#unlimitedStorage)).

The Storage Standard is deliberately weaker than a reservation: usage is an
implementation-defined rough estimate and quota is an implementation-defined
conservative estimate. Best-effort buckets may be cleared under storage
pressure; persistence changes eviction policy, not application correctness
([WHATWG Storage usage and quota](https://storage.spec.whatwg.org/#usage-and-quota),
[storage pressure](https://storage.spec.whatwg.org/#storage-pressure)).

Therefore:

- keep canonical count/byte accounting even if Workbench continues to sample
  `navigator.storage.estimate()`;
- treat an estimate as early warning only;
- neither `unlimitedStorage` nor persistence fixes transaction bugs, corruption,
  I/O errors, pending-queue growth, or unbounded heap;
- a temporary Panel Session journal does not automatically justify a new
  permission or a persistent-storage request. Those remain separate product and
  privacy decisions.

Moving the volatile intake queue into the Manifest V3 service worker is not a
durability shortcut. Chrome normally terminates an extension service worker
after inactivity and explicitly warns that global variables are lost on
shutdown; state required across termination must be stored
([service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
IndexedDB is accessible there, but the same commit, quota, and recovery policy
would still be required. The panel/DevTools page already has a lifetime aligned
with the open debugging window
([DevTools extension lifetime](https://developer.chrome.com/docs/extensions/how-to/devtools/extend-devtools)).

## Primary observability patterns

Perfetto exposes the core product choice directly. Its default `RING_BUFFER`
policy overwrites old packets when writers outpace readers; `DISCARD` accepts
until the buffer is full and then stops accepting new data
([Perfetto `TraceConfig.BufferConfig.FillPolicy`](https://perfetto.dev/docs/reference/trace-config-proto#TraceConfig.BufferConfig.FillPolicy)).
Chrome's DevTools Protocol likewise exposes `recordContinuously` versus
`recordUntilFull`, buffer-usage reporting, and a `dataLossOccurred` result when
the trace ring wraps
([CDP Tracing](https://chromedevtools.github.io/devtools-protocol/tot/Tracing/)).

OpenTelemetry's client-design rules are even closer to Workbench's observational
role:

- instrumentation should not significantly change the observed application;
- synchronous emission should not block or throw;
- long-running background tasks should not fail permanently because of one
  internal exception;
- clients must balance non-blocking behavior with bounded memory, and if they
  drop under overload they should warn on loss start/recovery and expose a loss
  metric;
- the standard batch log processor bounds its queue and drops after the queue
  is full.

See [OpenTelemetry error handling](https://opentelemetry.io/docs/specs/otel/error-handling/),
[performance and blocking](https://opentelemetry.io/docs/specs/otel/performance/),
and [Logs SDK batching](https://opentelemetry.io/docs/specs/otel/logs/sdk/#batching-processor).

These sources do not dictate Workbench's policy. They establish that a useful
diagnostic tool can keep producers non-blocking, bound resource use, and expose
data loss instead of terminating its entire observation pipeline.

## Analysis and design implications (inference, not source requirements)

The remainder is a reasoned Workbench proposal derived from the facts above.

### Replace “capacity stop” with “rolling retention”

Keep a count and canonical-byte **retention budget**, but when the next batch
would cross it, atomically commit the batch and evict the oldest complete prefix
needed to return below a lower target (for example, trim to 90% rather than one
record at a time). The control record should advance all of these facts in the
same transaction:

- Committed Evidence Boundary;
- Retained Range first and last Evidence references;
- retained count and canonical bytes;
- cumulative evicted count and bytes;
- the last eviction boundary and time.

The normal UI must remain page/query backed. “Remove the cap” must not mean
rendering or materializing every retained payload; the current 60-Evidence
window is appropriately bounded even when the queryable Retained Range is much
larger ([current architecture](../ARCHITECTURE.md#L484-L484)).

Once an old prefix is evicted, Workbench can still claim continuous acceptance
through the Committed Evidence Boundary if every Capture candidate was accepted
before later retention. It cannot claim that the current Event History is
Complete History from the History Interval start. Queries whose read point
predates the Retained Range should return an explicit retention-gap result, as
the Diagnostic Observation journal already does.

### Isolate one failed commit instead of terminalizing the Panel Session

A recovery state machine should classify the failed immutable batch:

| Failure class | Proposed handling | Truth exposed to developer |
| --- | --- | --- |
| Invalid candidate / deterministic serialization error | Refuse that candidate only; continue with the next candidate | Exact rejected identity and reason; Observation Coverage may become `LIMITED` |
| `UnknownError` or transaction timeout with an unknown/transient cause | Retry the identical batch in a fresh transaction a small bounded number of times | Retry count and duration; no Evidence publication before `complete` |
| `QuotaExceededError` | Evict an old committed prefix in a bounded cleanup transaction, then retry the unchanged batch once | Evicted range plus quota recovery result |
| Constraint/schema/invariant/corruption error | Do not blindly retry; retire the IndexedDB adapter and start a new memory-backed History Interval | Old interval's final boundary, new interval identity, storage degradation, and any missing Capture range |
| Memory fallback full or unable to accept one large record | Roll its Retained Range; if the single candidate itself cannot fit, reject only that candidate and continue | Exact dropped/oversize accounting and a continuing Capture Operation |

The pending intake queue must itself stay bounded. While the module retries or
opens a fallback adapter, keep a recent-first ring. If that ring fills, evict or
reject with an exact Capture sequence range and one coalesced active Diagnostic
Observation—not one notification per event. Prefer retaining the newest
diagnostic window by default; that matches a continuous trace ring and preserves
the developer's ability to inspect what is happening now.

If the failed transaction accepted none of its batch, the batch can become the
first Evidence in a new memory-backed History Interval without a silent hole.
If any candidate is lost before that rollover commits, close the old interval at
its last Committed Evidence Boundary and explicitly mark the new interval's
starting Capture discontinuity. Do not extend the old Committed Evidence
Boundary across unaccepted candidates.

### Keep four independent status dimensions

The current contract compresses too much into a terminal `HistoryStatus`. A
continuous design should keep these independent:

1. **Capture Operation** — still `RUNNING` while new activity is observed and
   offered.
2. **Observation Coverage** — `USEFUL` until a known missed candidate or bridge
   gap makes it `LIMITED`; storage degradation alone is not automatically a
   Capture gap.
3. **History retention** — complete for the requested read point, or a
   `retention-gap` with the earliest retained Evidence.
4. **Journal storage** — IndexedDB, memory fallback, recovering, or unavailable,
   with the last error and retry/rollover facts.

Useful status counters are `captured`, `accepted`, `awaitingAcceptance`,
`retained`, `evicted`, `notAccepted`, and `recoveryAttempts`, each with canonical
bytes where applicable. The panel should say, for example: “Capture running;
83,421 recent Evidence retained; 16,579 older Evidence evicted through #16,579”
or “Capture running in memory after IndexedDB commit failure; Observation
Coverage limited for captured range X–Y.”

### Keep canonical append/control separate from rebuildable indexes

The current commit transaction couples canonical Evidence and its control
record to query projections, facet postings, and facet aggregates. It follows
that a defect, constraint violation, or storage failure in any derived write can
abort the canonical append and trigger the terminal `JOURNAL_COMMIT_FAILED`
path. That coupling is visible in the checked-in implementation; the following
separation is an architectural inference, not an IndexedDB requirement.

Make the canonical transaction contain only the replay-complete Evidence
payload, stable Evidence identity and ordering, canonical byte accounting,
Retained Range/control state, and any atomic prefix trim. Publish Evidence only
after that transaction completes. Move query projections, facet postings, and
facet aggregates behind a rebuildable, idempotent indexer that consumes
committed canonical Evidence and records its own checkpoint.

An indexer failure should put query acceleration into a `DEGRADED` or
`REBUILDING` state while canonical Capture continues. A query should either
fall back to bounded scans over canonical pages or explicitly report that its
index coverage ends at an earlier Evidence boundary; it must not interpret an
index miss beyond that boundary as absence. Because the index stores remain
derived from the canonical Retained Range, they can be discarded and rebuilt
without changing Evidence truth. Atomicity remains mandatory inside the
canonical append/control transaction; the proposal only removes rebuildable
work from that transaction.

### Treat state projections separately from intake

Rolling retention does not invalidate current Topology or COMMAND projections
when they already consumed the evicted committed prefix. A true acceptance gap
can invalidate them. After such a gap, preserve the current projections only as
explicitly limited/advisory, request a fresh Topology checkpoint, and let
subsequent Lightstreamer snapshots rebuild what they can. A projection reducer
failure should fail/restart that reducer, not stop Event History ingestion.

### Evaluate relaxed durability as a bounded experiment

Because one Panel Session owns temporary, quickly changing Event History,
evaluate creating its write transactions with `{ durability: "relaxed" }` in
real Chrome. Measure batch latency, throughput, commit-error frequency, power,
and the recoverable boundary after abrupt renderer, browser, and operating-
system termination. Keep the durability choice behind the IndexedDB adapter so
it cannot alter the Event History interface.

This is a near-term performance experiment, **not the architecture fix**.
Relaxed durability cannot prevent quota exhaustion, a derived-index defect,
schema corruption, a bounded-queue overflow, or today's policy of permanently
stopping after one failed commit. Its weaker crash/power-loss persistence also
has to be reflected in the accepted Panel Session semantics before becoming a
default; it must not silently strengthen a Complete History claim.

### Do not increase the numeric budget first

The checked-in normal budget already covers 100,000 records/256 MiB. Changing it
to 250,000, 500,000, or an estimated-quota percentage before rolling retention
and recovery exist would increase storage and query pressure while leaving the
single-failure stop unchanged. First make capacity a rolling retention contract
and make commit failure survivable at the current measured budget. Then use the
existing real-Chrome performance gate and representative Lightstreamer payload
mixes to select a larger default or optional presets.

## Maintainer-accepted product direction (2026-08-29)

The maintainer accepted the following direction after a structured design
review. This records product intent for a later domain/ADR and implementation
change; it does not amend the shipped contract by itself.

- Event History becomes a continuous, bounded flight recorder. Normal capacity
  initially remains 100,000 Evidence records or 256 MiB, but those values become
  rolling retention high-water marks rather than terminal Capture limits.
- Valid Capture enters a bounded canonical memory segment without waiting for
  IndexedDB. IndexedDB supplies asynchronous capacity rather than deciding
  whether the live debugging workflow can continue.
- At high water, Workbench evicts sealed oldest prefixes to an initial 90%
  low-water target. Automatic adapter rollover and eviction remain internal
  Storage Segments; only deliberate Clear starts a new History Interval.
- Canonical Evidence/control commits are separated from rebuildable query
  projections, facet postings, and aggregates. Index lag or failure degrades
  the affected query capability and can rebuild without stopping intake.
- A definitively aborted transient commit may retry at most twice with smaller
  batches. Quota pressure trims and retries once. A deterministic journal fault
  opens the circuit and leaves the Panel Session memory-backed without repeated
  recovery prompts.
- Storage degradation alone does not reduce Observation Coverage while the
  accepted canonical memory copy remains intact. A candidate that cannot enter
  any canonical segment creates an exact gap; later Evidence continues and
  affected Topology and COMMAND projections remain explicitly `LIMITED` until
  a trustworthy checkpoint or snapshot restores confidence.
- Standalone Local Injection remains available with a limited-state warning.
  Scenario assertions or automated decisions requiring trustworthy COMMAND
  state remain blocked while the necessary projection is limited.
- The developer can browse every retained event through bounded, virtualized,
  keyset-backed rendering. Workbench never mounts or materializes the complete
  Retained Range merely to make it reachable. An evicted selected record may
  survive as one detached immutable detail; a larger Frozen read point expires
  explicitly.
- Export receives a bounded retention lease. If preserving its latched range
  would threaten Capture's memory budget, the export is cancelled with the
  exact eviction boundary; Capture is never paused for export.
- The first version adds no retention presets, retry controls, adapter controls,
  recovery buttons, lossless recording mode, or `unlimitedStorage` permission.
  A separately measured `relaxed`-durability experiment remains optional.

### Low-attention developer workflow

Normal Capture should require no developer attention. The primary surface uses
one compact summary such as `Capture running · 90k recent of 1.2M · IndexedDB`;
technical state remains available on demand.

The existing Notifications page is the bounded incident history:

- a transient error that recovers is written to diagnostic history without an
  interrupting notification;
- ordinary rolling eviction updates retained/captured counters quietly;
- sustained memory fallback creates one coalesced warning condition;
- an actual Evidence gap creates one coalesced warning plus an exact timeline
  marker;
- each condition episode retains its first/latest time, occurrence and retry
  counts, affected Capture/Evidence ranges, storage transitions, evictions, and
  recovery outcome;
- resolved episodes remain inspectable in the Notifications page's existing
  bounded history, but Workbench never creates one notification per event,
  retry, or failed batch.

Clear remains only a deliberate History Interval reset. It is not presented as
a storage-recovery action.

## Decision sequence and verification

1. **Amend the domain/ADR contract first.** ADR 0011 explicitly forbids
   mid-session adapter changes and mandates terminal failure. Define automatic
   History Interval rollover, retention-gap semantics, and the conditions that
   make Observation Coverage `LIMITED` before changing code.
2. **Split canonical commit from rebuildable indexes.** Prove canonical append
   + prefix deletion + control update are atomic, and that index failure or lag
   cannot stop Capture or create a false-negative query. Prove indexes rebuild
   idempotently from the canonical Retained Range.
3. **Make rolling retention authoritative.** Test both count and byte pressure,
   oversized single records, selected/filtered expired Evidence, and latched
   exports.
4. **Add classified bounded recovery.** Inject every named IndexedDB error at
   request and commit time; prove no duplicates, no reordered Evidence, no
   publication before `complete`, no infinite retry, and continued later
   ingestion.
5. **Add adapter rollover.** Prove failed IndexedDB batches either become the
   exact prefix of a new memory History Interval or produce an exact documented
   gap; prove old retained Evidence remains queryable or is explicitly retired.
6. **Stress 10k, 100k, and sustained-overflow runs.** Verify Capture continues
   through repeated rollovers, UI/query memory remains bounded, the newest
   retained window is reachable, Diagnostic Observations are coalesced, and
   COMMAND/Topology limitation states are truthful.
7. **Run the relaxed-durability experiment separately.** Compare `default` and
   `relaxed` with normal commits, injected failures, and abrupt termination. Do
   not use a throughput improvement to waive the recovery or truthfulness gates.
8. **Only then revisit capacity and permissions.** Benchmark larger count/byte
   presets separately. Evaluate `unlimitedStorage` or persistence only if real
   extension-profile evidence shows rolling retention cannot meet the product
   need without them.

## Bottom line

The valuable guarantee for a DevTools workbench is not “store every event until
the first error.” It is: **never interfere with the inspected application;
continue observing while the Panel Session is open; retain a large, ordered,
recent Evidence window; and make every eviction, gap, degradation, and
projection limitation explicit.** IndexedDB's atomic transactions can preserve
truth at each successful boundary, while a ring-style retention policy and a
bounded fallback path preserve usefulness after capacity pressure or one failed
commit.
