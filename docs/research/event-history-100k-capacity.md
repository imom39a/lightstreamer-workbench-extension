# Event History capacity at 100,000 events

Status: decision-ready research, 2026-08-13. Change class: **Non-UI**. This note proposes an implementation and verification boundary; it does not itself change runtime behavior.

Implementation note, 2026-08-29: [ADR 0014](../adr/0014-continue-event-history-with-rolling-retention.md)
supersedes the stop-at-capacity behavior described here. The 100,000-record /
256 MiB normal and 5,000-record / 32 MiB memory values now bound rolling retained
Evidence while Capture continues.

## Executive decision

Support **up to 100,000 retained events in the normal IndexedDB tier**, initially bounded by **256 MiB of canonical accounted payload**, whichever limit is reached first. Keep IndexedDB as the only normal authority. This is a 10× count increase, not a count-only promise: arbitrary evidence payloads can exhaust the byte envelope before 100,000 events, and **256 MiB is a measured target, not guaranteed coverage for every possible payload mix**.

Do not merely change `10_000` to `100_000`. The storage layer can represent that count, but several reads and projections currently scale by materializing or replaying the complete interval. Address those paths, then pass a real-Chrome 100k gate before changing the product contract.

Use **512 MiB only as a later, evidence-backed adjustment** if measured, representative sessions show that 256 MiB rejects valuable ordinary workloads. Keep the startup memory fallback at **5,000 events / 32 MiB** until it is separately measured; disk capacity is not evidence that the heap-backed adapter can safely grow.

## Why 100,000 needs a byte envelope

Capacity admission already counts the canonical UTF-8 replay payload plus a stable eight-byte logical frame, and stops before either the record or byte maximum is exceeded ([serialization](../../src/core/event-history-serialization.ts#L8-L25), [admission](../../src/core/event-history-capacity.ts#L148-L169)). Current measured workload shapes imply:

| 100,000-event shape | Canonical accounted bytes/event | Canonical total |
| --- | ---: | ---: |
| Small lifecycle | 330 B | **31.5 MiB** |
| Ordinary item update | 827 B | **78.9 MiB** |
| Large JSON-rich update | 13,290 B | **1,267.4 MiB** |
| Current IndexedDB heap-gate mix (50% small / 40% ordinary / 10% large) | weighted | **about 174.0 MiB** |

The totals are `accounted bytes/event × 100,000 ÷ 1,048,576`, rounded to one decimal place. The current IndexedDB retained-heap fixture cycles through five small, four ordinary, and one large event ([heap fixture](../../benchmarks/event-history-performance-harness.ts#L1139-L1147)); its weighted canonical total is approximately `0.5 × 31.5 + 0.4 × 78.9 + 0.1 × 1,267.4 = 174.1 MiB`. These are deterministic workload shapes, not a claim about all inspected applications; the existing source evidence records 315/807/13,125-byte persisted JSON examples and substantial per-event index fan-out ([workload evidence](event-history-workload-evidence.md#L7-L17)). A 256 MiB ceiling allows an average canonical record of about **2,684 bytes** across 100,000 events and gives this measured mix roughly 47% logical-byte headroom. Physical IndexedDB/index use is separate and must be measured.

Therefore:

- `100,000 events` is the count ceiling.
- `256 MiB canonical accounted bytes` is the initial normal-tier safety envelope.
- A session containing many large JSON-rich updates can stop well below 100,000, with the existing exact terminal reason and first-missing-event semantics.
- The panel should communicate both count and bytes; it must not advertise 100,000 as unconditional payload coverage.

## Current mechanics

The normal tier currently stops at **10,000 records / 64 MiB**, warns at 80%, and the lower tier stops at **5,000 / 32 MiB** ([capacity defaults](../../src/core/event-history-capacity.ts#L74-L95)). Admission includes retained and pending count/bytes, while backlog protection separately stops at 32 MiB pending or excessive pending age ([capacity admission](../../src/core/event-history-capacity.ts#L135-L177)). Those pending limits should not automatically rise with retained capacity.

IndexedDB commits replay-complete records in bounded batches of at most 256 records and a soft 2 MiB serialized payload ([batch bounds](../../src/core/event-history-indexeddb.ts#L61-L63), [commit loop](../../src/core/event-history-indexeddb.ts#L773-L815)). Each record stores its canonical replay payload, byte accounting, event identity, and exact facets; the control record persists the committed boundary and totals ([record schema](../../src/core/event-history-indexeddb.ts#L68-L92), [commit](../../src/core/event-history-indexeddb.ts#L1215-L1237)). `QuotaExceededError` is already classified as a terminal journal failure and capture remains fail-closed ([commit failure](../../src/core/event-history-indexeddb.ts#L816-L833)). Preserve that behavior.

IndexedDB is an appropriate authority: the platform defines records, indexes, transactions, key ranges, and directional cursors for indexed lookup and iteration ([W3C IndexedDB 3.0](https://www.w3.org/TR/IndexedDB/)). Nothing in IndexedDB itself imposes a 10,000-record limit; Workbench's limit is its own admission and performance contract.

## Blockers before the capacity switch

### 1. Find and live refresh materialize the interval

Normal Evidence rendering is already a bounded 60-row query ([runtime window](../../src/extension/panel/workbench-runtime.ts#L73-L74), [bounded refresh](../../src/extension/panel/workbench-runtime.ts#L2095-L2149)). Find is not: it reads all scoped evidence, retains every event plus every matching index, and reruns after passive live refresh ([Find](../../src/extension/panel/workbench-runtime.ts#L1213-L1260), [refresh coupling](../../src/extension/panel/workbench-runtime.ts#L2161-L2163)). At 100k this causes repeated deserialization, allocation, and scanning. Replace it with an authority-owned result contract: total match count plus current/previous/next match and a bounded surrounding window. Coalesce or incrementally advance live Find rather than rescanning the interval.

### 2. Facet intersection materializes sequence sets

Multi-facet reads currently open one index cursor per token, build a `Set<number>` containing every match, intersect all sets in JavaScript, then fetch selected sequences ([facet path](../../src/core/event-history-indexeddb.ts#L1609-L1647)). At 100k, common facets can create several large sets. Use keyset pagination (`beforeSequence`/`afterSequence`) instead of deep `offsetFromNewest` scans. Choose the most selective indexed token, stream it in requested order, validate residual facets, and stop after the requested page; compute an exact total in a cancellable compact-key pass and cache it for the active filter generation. Do not retain one full sequence set per facet.

The current record colocates the replay payload and facets. A schema revision should split compact query metadata (sequence, identity, kind, exact facet fields) from the canonical replay payload, both keyed by sequence. Facet cursors can then scan metadata or keys without cloning a potentially large payload; only the bounded visible page fetches and deserializes payload records. Benchmark this split against a smaller set of compound indexes before committing to the migration.

### 3. Full-history operations are unbounded

An unbounded IndexedDB read first collects every record, sorts it, then cooperatively materializes every matching envelope ([materialization](../../src/core/event-history-indexeddb.ts#L1483-L1522), [unbounded cursor](../../src/core/event-history-indexeddb.ts#L1728-L1783)). Export preparation also reads the full interval and rebuilds Topology in one in-memory collection ([export](../../src/extension/panel/workbench-runtime.ts#L1372-L1403)). Full Evidence copy/export must become a paged or streamed operation with an explicit latched committed boundary, incremental serialization/redaction, cancellation, progress, and a byte guard. Ordinary UI queries must remain bounded.

### 4. Rebind, recovery, and validation can walk all records

Opening a journal validates every retained record against the control record ([load](../../src/core/event-history-indexeddb.ts#L1156-L1165), [validation](../../src/core/event-history-indexeddb.ts#L1329-L1399)). `follow(CURRENT_INTERVAL_START)` opens another full cursor and publishes one reconstructed record at a time ([replay](../../src/core/event-history-indexeddb.ts#L1033-L1115)). A normal new Panel Session starts empty, so this is not the steady-state 100k intake path. It does matter when a populated history is rebound in tests or recovery and when the follower restarts after a projection error. Preserve atomic transaction/control invariants, but make populated-history validation and replay chunked, cancellable, and explicitly measured. Projection checkpoints followed by deltas are preferable to reconstructing all runtime state before the UI becomes useful. Keep corruption fail-closed when actually detected.

### 5. Pipeline and projections retain history-shaped state

The committed-evidence pipeline keeps a `seen` key for every replayed entry ([pipeline](../../src/extension/panel/committed-evidence-pipeline.ts#L228-L302)). Replace this with the interval identity and highest contiguous applied sequence, plus only a bounded retry gap set.

COMMAND state is more serious: every command appends a lifecycle entry to both per-key and per-item arrays; snapshots copy those lifecycle arrays and fields ([append](../../src/core/command-state.ts#L427-L469), [snapshot copying](../../src/core/command-state.ts#L650-L685)). A hot COMMAND key can therefore make projection memory and snapshot cost grow with event count. Retain current row state and bounded recent lifecycle summaries in memory; query older lifecycle evidence from Event History on demand. The journal remains the complete evidence authority.

### 6. The performance artifact duplicates identities

The current gate retains complete expected, published, and retained identifier arrays in its artifact ([harness](../../benchmarks/event-history-performance-harness.ts#L1591-L1613)). Three 100k string arrays per sample add avoidable heap and report size. Preserve exact correctness with counts, first/last identities, rolling/order digests, deterministic sampled identities, and targeted mismatch diagnostics; keep full arrays only for small/terminal scenarios.

## Quota and permission policy

Chrome says extension web storage is subject to normal quota restrictions by default, `navigator.storage.estimate()` reports the extension origin's current estimate, and storage may rarely be evicted under pressure. It also says `unlimitedStorage` exempts extension and web storage, including IndexedDB, from quota restrictions and eviction ([Chrome: Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)). Chrome's permission reference confirms that `unlimitedStorage` applies to IndexedDB, Cache Storage, OPFS, and `chrome.storage.local` ([Chrome: permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list)). The current manifest declares no permissions ([manifest](../../public/manifest.json#L1-L28)).

Policy for the first 100k release:

- **Do not require `unlimitedStorage` initially.** First test 100k/256 MiB across clean, constrained, low-free-space, managed, and incognito profiles. Adding a permission changes the manifest, privacy, and release-review contract; capacity alone does not justify that change without failure evidence.
- At startup and periodically at coarse thresholds, record `navigator.storage.estimate()` telemetry (`usage` and `quota`) and show a useful early warning when estimated headroom is below the remaining Workbench envelope.
- Never treat the estimate as a reservation or admission guarantee. The Storage Standard defines usage as an implementation-defined rough estimate and quota as a conservative estimate ([WHATWG Storage, §6](https://storage.spec.whatwg.org/#usage-and-quota)); Chrome likewise warns that usage/quota are unstable estimates affected by allocation, compression, and changing conditions ([Chrome: estimating storage](https://developer.chrome.com/blog/estimating-available-storage-space)).
- Continue canonical byte admission regardless of the estimate, and continue to stop exactly and fail closed if the write itself raises `QuotaExceededError`.
- If the low-quota matrix proves that normal target environments cannot reliably hold the measured 100k envelope, make `unlimitedStorage` a separate explicit product/privacy decision with release notes and tests; do not silently add it as an implementation detail.

## Staged implementation

1. **Define the candidate contract without shipping it.** Add 100,000 / 256 MiB as a named benchmark/test profile with 80% warnings; leave production defaults, pending limits, and lower-tier limits unchanged.
2. **Bound query memory.** Implement keyset/range-based Evidence and Find navigation, the compact metadata/payload split, streaming single-driver facet filtering, and cancellable exact counts.
3. **Bound full-history work.** Add a latched-boundary page/stream API; move Complete History copy and export onto it with progress, cancellation, and output-size protection.
4. **Bound projection recovery and state.** Make populated-history replay chunked/checkpointed, compact pipeline deduplication, and bound COMMAND lifecycle retention behind on-demand history queries.
5. **Add quota telemetry without changing admission truth.** Record estimates before capture and near 80%/90% canonical pressure; test write-time quota failure and abnormal-cleanup residue behavior.
6. **Run the 100k Chrome gate.** Only after it passes should the production normal defaults and product documentation change to the conditional 100k/256 MiB contract.

## Consequence for Build 2

Treat this as **capacity hardening inside the Build 2 dependency**, not as an unrelated later feature. Contextual facets require exact shown/total counts and responsive navigation; the current JavaScript set intersection happens to be tolerable at 10k but should not become the permanent 100k query contract. Implement the metadata/payload split, keyset page API, bounded facet plan, and cancellation semantics before completing the faceted-filter UI. The existing Scope/Filter/Find separation and committed-boundary semantics remain unchanged.

## Required 100k Chrome gate

Run in visible pinned Chrome through the production React panel and real IndexedDB, following the existing fail-closed procedure ([manual workflow](../reference/event-history-performance-manual-workflow.md#L1-L51)). The new gate must cover small, ordinary, large, and the current 50/40/10 representative mix, with at least three independent samples where practical, and prove:

- exactly 100,000 accepted, ordered, queryable records for payload mixes that remain within 256 MiB;
- exact byte-limit refusal below 100k for an oversized mix, one terminal publication, correct committed boundary, and correct first missing event;
- sustained capture while paging, Find navigation, multi-facet queries, Frozen/Live transitions, selection, clear, and controlled close remain correct;
- recent-page and indexed/facet queries stay bounded, Find navigation does not retain the interval, and no operation creates a 100k-element payload or identity collection;
- populated-history rebind/recovery reaches useful UI promptly without a synchronous full-history replay;
- IndexedDB panel heap remains bounded after GC; COMMAND hot-key/update churn does not produce linear snapshot growth;
- full copy/export streams to completion or stops at its explicit output guard without freezing capture;
- quota estimates are recorded only as telemetry, while injected `QuotaExceededError` still proves the fail-closed path;
- the unchanged 5k/32 MiB memory fallback still passes its own gate.

Keep the current absolute responsiveness limits as upper bounds, and add time-to-first-result/window-completion limits for the new bounded Find and facet operations. Pin clean 100k baselines for relative-regression review rather than extrapolating the 10k medians. The existing historical 10k evidence took about 87 seconds to append in IndexedDB and measured Find near 390 ms ([workload evidence](event-history-workload-evidence.md#L32-L35)), so a 10× count increase without the bounded-path work would be a predictable regression.

## Explicitly deferred

- **Rolling retention/eviction:** changes Complete History into a retained-window contract. It is not required for the 100k increase, but it is the follow-up design decision if the product goal becomes “Capture must continue indefinitely” rather than “retain at least 100k before a fail-closed stop.”
- **Compression:** complicates synchronous admission accounting, query/search, corruption diagnosis, and CPU behavior. Measure after bounded queries are complete.
- **OPFS:** does not remove the need for indexes, transactional metadata, quota handling, and bounded projections. IndexedDB already matches the access model.
- **512 MiB normal tier:** reserve until real workload measurements demonstrate that 256 MiB excludes a common valuable mix and the Chrome gate proves the larger footprint.

## Uncertainties

Physical IndexedDB usage is browser/version/profile dependent and includes record/index amplification that canonical logical bytes intentionally do not model. Quota and usage estimates are not reservations. Payload distributions in real Lightstreamer applications may differ materially from the three measured shapes, and COMMAND key cardinality/churn can dominate heap independently of journal bytes. Resolve these uncertainties through the stated Chrome matrix and telemetry; do not turn the representative 174 MiB figure or the 256 MiB target into a universal storage guarantee.
