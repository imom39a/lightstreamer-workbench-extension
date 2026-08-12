# Event History query interface comparison

Status: disposable design evidence for `evidence-filter-05`; not a production
contract.

## Question

What is the smallest external Event History interface that can return an
Ordered Evidence page, exact totals, contextual facet discovery, and selected
Evidence facts from one History Interval and one committed Evidence boundary,
while keeping memory and IndexedDB substitutable?

The accepted algebra, twelve-facet catalog, discovery/count semantics, Around
semantics, and investigation restoration rules from Builds 1–4 are inputs. This
prototype does not reopen them.

## Alternative A — one atomic query

```ts
interface EventHistory {
  query(request: EvidenceQueryRequest): Promise<Outcome<EvidenceSnapshot>>;
}

type EvidenceQueryRequest = Readonly<{
  at: "LATEST_COMMITTED" | EvidenceReadPoint;
  scope: EvidenceScope;
  filter: EvidenceFilter;
  page: EvidencePageRequest;
  discover?: readonly FacetDiscoveryRequest[];
  lookup?: EvidenceIdentity;
  find?: EvidenceFindRequest;
}>;

type EvidenceSnapshot = Readonly<{
  readPoint: EvidenceReadPoint;
  page: EvidencePage;
  totals: Readonly<{ matching: number; inScope: number }>;
  discoveries: ReadonlyMap<FacetId, FacetDiscoveryResult>;
  lookup: EvidenceLookupResult | null;
  find: EvidenceFindResult | null;
}>;
```

`query()` is one deep, storage-neutral seam. A request omits `discover` and
`lookup`, and `find` when the caller only needs the common newest page, so that
path does not enumerate facets, evaluate residual Find text, or hydrate an
unrelated record. All requested sections share the returned `readPoint`.

The result is deliberately not a storage cursor or open transaction. Page and
facet cursors are opaque, signed-by-shape continuation values scoped to the
read point and request fingerprint. They can be submitted to a later query;
they do not expose sequence intersections, object stores, or transaction
lifetime.

**Complexity hidden:** snapshot latching, typed token encoding, posting-list
intersection, residual predicates, exact counterfactual facet counts, storage
transactions, cooperative scan yielding, and adapter selection.

**Failure boundary:** the outer `Outcome` fails only when the base snapshot
cannot be read. Optional discoveries carry their own `AVAILABLE` or
`UNAVAILABLE` state so a discovery problem never blanks a valid ledger page.

## Alternative B — prepared Evidence view

```ts
interface EventHistory {
  prepare(request: EvidenceViewRequest): Promise<Outcome<PreparedEvidenceView>>;
}

interface PreparedEvidenceView {
  readonly readPoint: EvidenceReadPoint;
  page(request: EvidencePageRequest): Promise<Outcome<EvidencePage>>;
  totals(): Promise<Outcome<EvidenceTotals>>;
  discover(request: FacetDiscoveryRequest): Promise<Outcome<FacetDiscoveryResult>>;
  lookup(identity: EvidenceIdentity): Promise<Outcome<EvidenceLookupResult>>;
  close(): void;
}
```

This makes incremental work natural: create one view, then ask only for what a
surface reveals. It also gives every method an obvious shared read point.

It is rejected because a useful implementation either holds an IndexedDB
transaction across user think-time (not viable), materializes every candidate
sequence in memory (unbounded relative to the request), or silently reopens
transactions and must reconstruct the snapshot. It introduces lifecycle,
staleness, and cleanup obligations into every caller. `close()` is a storage
concern masquerading as a domain concern.

## Alternative C — task-oriented reads with an explicit pin

```ts
interface EventHistory {
  pin(at: "LATEST_COMMITTED"): Promise<Outcome<EvidenceReadPoint>>;
  readPage(point: EvidenceReadPoint, request: PageQuery): Promise<Outcome<EvidencePage>>;
  count(point: EvidenceReadPoint, request: CountQuery): Promise<Outcome<EvidenceTotals>>;
  discover(point: EvidenceReadPoint, request: FacetQuery): Promise<Outcome<FacetDiscoveryResult>>;
  lookup(point: EvidenceReadPoint, request: LookupQuery): Promise<Outcome<EvidenceLookupResult>>;
}
```

Each method is easy to name, benchmark, and call independently. This is the
most flexible shape and appears cheap for the common page path.

It is rejected as the public seam because the caller becomes a query planner:
it must fan out calls, propagate the read point, merge partial failures, ensure
all requested facets were fetched, and avoid rendering page N with totals from
N+1. The guided prototype demonstrates how one omitted pin or one accidental
`LATEST_COMMITTED` call creates a plausible but torn answer. The internal
adapters may still use task-oriented private helpers.

## Comparison

| Force | A — atomic query | B — prepared view | C — task methods |
| --- | --- | --- | --- |
| Coherent page/totals/discovery/lookup | By construction | By read point plus lifecycle | By caller discipline |
| Common newest page | Omits optional work | Cheap after prepare | Cheap |
| IndexedDB fit | One bounded transaction | Poor across think-time | Several transactions |
| Memory fit | One latched boundary | Easy, but needless object | Easy |
| Partial discovery failure | Section state | Method failure | Caller merge policy |
| Caller complexity | Low | Medium | High |
| Storage leakage | Low | Lifecycle leaks | Read point/fan-out leaks |
| Future query extensions | Add optional result section | Add method/lifecycle state | Add method/orchestration |

## Recommendation

Choose **Alternative A — one atomic query**. Keep the existing `offer`,
`status`, `follow`, `clear`, and `close` operations independent; replace the
scalar-filter `read` contract with one `query` for accepted Evidence reads.
Memory and IndexedDB remain private adapters behind the same interface.

The interface is deep because its small surface absorbs substantial policy. It
also makes the atomicity statement testable: every returned section names one
identical read point.

## Proposed contract details

### Typed request

```ts
type EvidenceReadPoint = Readonly<{
  intervalId: string;
  committedBoundary: EvidenceRef | null;
}>;

type EvidencePageRequest = Readonly<{
  order: "NEWEST_FIRST" | "OLDEST_FIRST";
  size: number;                 // 1..200
  cursor?: OpaquePageCursor;
}>;

type FacetDiscoveryRequest = Readonly<{
  facet: FacetId;
  search?: string;              // searches exact display labels, not Evidence
  size: number;                 // 1..100
  cursor?: OpaqueFacetCursor;
}>;

type FacetDiscoveryResult =
  | Readonly<{
      state: "AVAILABLE";
      facet: FacetId;
      values: readonly FacetCount[];
      distinctTotal: number;
      nextCursor: OpaqueFacetCursor | null;
      baseEvidenceCount: number;
    }>
  | Readonly<{
      state: "UNAVAILABLE";
      facet: FacetId;
      reason: "NO_CONCRETE_VALUES" | "DISCOVERY_FAILED" | "UNSUPPORTED_AT_READ_POINT";
      baseEvidenceCount: number | null;
    }>;

type EvidenceLookupResult =
  | Readonly<{
      state: "RETAINED";
      evidence: CommittedEvidence;
      inScope: boolean;
      matchesFilter: boolean;
      blockingCriteria: readonly CriterionIdentity[];
    }>
  | Readonly<{
      state: "NOT_RETAINED" | "OTHER_INTERVAL";
      identity: EvidenceIdentity;
    }>;

type EvidenceFindRequest = Readonly<{
  text: string;
  current?: EvidenceIdentity;
}>;

type EvidenceFindResult = Readonly<{
  text: string;
  total: number;
  current: EvidenceIdentity | null;
  previous: EvidenceIdentity | null;
  next: EvidenceIdentity | null;
}>;
```

Facet values use the collision-safe typed identities from Build 1. Display text
is data carried beside identity, never the comparison key. Missing values are
not synthesized as choices. Active include/exclude values are pinned from the
request's own Filter and returned with exact zero counts when necessary; there
is no UI-maintained catalog.

`shown` is `page.evidence.length`; it is not a third count query. `matching` is
Scope plus the complete Filter. `inScope` ignores Filter and Find. Find remains
an independent investigation control and never changes either count, but its
optional current/previous/next navigation result is evaluated inside the same
snapshot so it cannot silently navigate a different committed boundary.

### One read point

For `LATEST_COMMITTED`, the adapter latches the current History Interval,
committed Evidence boundary, and retained range before evaluating anything.
Every page row, total, discovery count, lookup, and requested Find result is
restricted to that latch. Capture may commit later without changing the result.

An explicit read point is valid only while its interval remains current and
its boundary is still addressable under retention. Clear makes every earlier
read point unavailable with `HISTORY_INTERVAL_UNAVAILABLE`; adapters never
reinterpret it against the new interval or label partial data complete.

### Planner and bounded work

1. Validate and canonicalize Scope, Filter, cursors, and requested facets. An
   unknown/unsupported criterion produces a coherent fail-closed zero snapshot
   plus a diagnostic; it is never ignored.
2. Intersect the smallest exact typed posting lists first. Includes of the same
   facet union; facets intersect; exclusions subtract. Scope, free text, Around,
   and residual predicates are then applied once.
3. Produce the requested bounded page and exact `matching`/`inScope` totals.
4. For discovery of facet F, reuse the base but remove both include and exclude
   predicates for F, then count concrete F identities. Each requested facet is
   exact and independently recoverable.
5. Evaluate lookup with the same predicate implementation and return the exact
   blocking criterion identities used by Reveal.
6. When requested, evaluate Find only within the matching set and return exact
   circular previous/next identities at the same read point; it never changes
   page or total semantics.

The newest-page fast path does no discovery enumeration. Exact discovery is
on-demand, searchable, and cursor-paged with an exact distinct total; it never
samples, truncates silently, invents `Other`, or returns approximate counts.
At the fixed 10,000-record ceiling, residual/free-text/Around and high-cardinality
aggregation may scan the latched retained interval cooperatively but may not
materialize more than one bounded sequence set plus requested facet maps.

### Adapter strategy

**Memory.** Latch interval, boundary, retained range, and the immutable accepted
Evidence array. Maintain the same collision-safe posting maps as IndexedDB.
Intersect sequence sets, then run the shared canonical predicate evaluator.

**IndexedDB.** Keep one authoritative Evidence store and the existing
multi-entry facet index shape. Persist one typed token per catalog facet on
each accepted Lightstreamer Evidence record. A single readonly transaction
reads the control latch and every requested section. Private planner helpers
may use task-oriented operations, but their storage cursors never escape.

The token namespace is versioned. Because Event History is Panel Session-owned
and not recovered across sessions, a token-layout change does not migrate
user history: a newly opened session writes the current token version, and an
unknown newer schema continues to select the established session-wide memory
fallback. A normal schema upgrade must preserve the accepted capacity accounting
and the ownership-safe residual cleanup rules.

The twelve persisted catalog tokens replace legacy presentation-oriented token
choices; do not add a public facet repository. Worst-case logical fan-out stays
fixed at twelve facet postings per Lightstreamer Evidence record plus the unique
event identity index.

### Performance and cancellation

- recent bounded page without discovery: p95 at or below 50 ms;
- exact structured facet query: p95 at or below 100 ms;
- residual free-text/Around/full exact discovery: p95 at or below 500 ms;
- page size at most 200, facet page size at most 100, retained Evidence at the
  existing 10,000-record/64 MiB normal or 5,000-record/32 MiB fallback cap.

The runtime assigns a monotonically increasing query generation. A superseded
query may be cooperatively cancelled; its result is discarded, not merged with
the new generation. Cancellation does not change Event History or active Filter.

### Failure semantics

- Invalid mutation never reaches Event History; the investigation stays
  unchanged.
- Unsupported query criterion fails closed as an exact zero state with an
  identified diagnostic.
- Base read failure returns outer `Outcome` failure and retains the last coherent
  UI snapshot.
- Discovery failure returns `UNAVAILABLE` only for that facet; page and totals
  remain usable.
- A stale/cleared read point is unavailable; it is never silently upgraded.
- Terminal Capture state returns one final exact query result at its final
  committed boundary.
- Memory fallback has semantic parity; only capacity/coverage differs.

### Interface-level proof

Run the same contract suite against memory and fake-IndexedDB adapters:

1. page, totals, every requested discovery, and lookup share one read point
   while Capture commits concurrently;
2. all Filter algebra laws and typed-identity collision cases match;
3. self-facet counterfactual counts ignore both polarities only for that facet;
4. active zero values remain pinned; missing/unavailable/no-values states differ;
5. exact high-cardinality search/paging has stable typed order and exact totals;
6. lookup reports retained state and exact Reveal blockers without duplicating
   predicates in the runtime;
7. optional discovery failure does not blank the page;
8. unsupported criteria fail closed in both adapters;
9. Clear invalidates prior read points and creates no cross-interval rows;
10. terminal and memory-fallback results remain exact and adapter-equivalent;
11. Find navigation shares the snapshot read point while remaining independent
    from Filter totals, selection, and focus;
12. common page reads prove no facet or Find aggregation work; benchmark all
    three latency classes and the twelve-token fan-out bound.

### Integrated validation amendment

Build 7 found one coherence gap in the original comparison: describing Find as
entirely outside `query()` would require a second read and could navigate H7/N+1
while the ledger still rendered H7/N. The selected interface is amended with the
optional `find` request/result section above. This does not merge Find into
Filter: Find still changes no criterion or total. It only makes its navigation
answer part of the same atomic Evidence Snapshot.

The executable Build 7 prototype validates this amendment with an exact deep
comparison of canonical memory and IndexedDB public snapshots for `Find at same
read point`; diagnostic digests are not used as the equality oracle. The common
newest-page path still omits Find when inactive.

### UI-to-runtime mutation seam

Build 6 should emit domain commands, not construct `EvidenceQueryRequest` or
index tokens:

```ts
runtime.mutateFilter({
  expectedRevision,
  operations: readonly FilterMutation[]
}): Outcome<InvestigationState>
```

The runtime applies the Build 4 atomic mutation rules, assigns a new revision,
then issues Alternative A's query from the resulting canonical state. This
keeps UI drafts, Event History reads, and storage indexing separate.

## Typed future leverage

The same optional-section pattern can later add exact Direction or diagnostic
discovery, export a query-bound snapshot, or compare two read points without
introducing a second storage API. New facets require a typed extractor, token,
predicate, and parity fixtures; callers do not learn a new repository.
