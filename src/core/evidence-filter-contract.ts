/** Storage- and renderer-neutral query contracts for Evidence filtering. */

// Ticket filter-impl-02's canonical algebra is exported from this contract
// boundary for storage/query consumers. EvidenceFilter below remains the
// Build 2 query snapshot shape until the later history integration tickets.
export {
  FILTER_VERSION,
  applyFilterMutations,
  canonicalFilterFromLegacyScalars,
  canonicalizeFilter,
  createFilter,
  createTypedFilterValue,
  evaluateFilter,
  filterEquals,
  matchesFilter,
  serializeFilter,
  type Filter,
  type FilterAround,
  type FilterEvaluation,
  type FilterInput,
  type FilterMutation,
  type FilterMutationResult,
  type FilterRecord,
  type FilterScalar,
  type FilterValueType,
  type LegacyScalarFilter,
  type TypedFilterValue,
  type UnsupportedFilterCriterion
} from "./filter-algebra";

export type EvidenceFilterFacet = string;
export type FilterPolarity = "include" | "exclude";

export type TypedFacetValue = Readonly<{ facet: EvidenceFilterFacet; type: string; value: string; label: string; identity: string }>;
export function typedFacetValue(facet: EvidenceFilterFacet, type: string, value: string, label = value): TypedFacetValue {
  return Object.freeze({ facet, type, value, label, identity: JSON.stringify(["v1", facet, type, value]) });
}
export type FilterCriterion = Readonly<{ id: string; facet: EvidenceFilterFacet; polarity: FilterPolarity; value: TypedFacetValue }>;
export type EvidenceFilter = Readonly<{ revision: number; text: string; criteria: Readonly<Partial<Record<EvidenceFilterFacet, Readonly<{ include: readonly TypedFacetValue[]; exclude: readonly TypedFacetValue[] }>>>>; around: AroundEvidence | null; unsupported: readonly UnsupportedCriterion[] }>;
export type AroundEvidence = Readonly<{ intervalId: string; start: number; end: number; anchor?: EvidenceIdentity; anchorSequence?: number; anchorTimestamp?: number }>;
export type UnsupportedCriterion = Readonly<{ id: string; label: string; reason: "UNSUPPORTED_FACET" | "UNSUPPORTED_VALUE" | "UNSUPPORTED_OPERATOR" }>;
export type EvidenceIdentity = Readonly<{ intervalId: string; pageId: string; ownerId: string; sequence: number; eventId: string }>;
export const MAX_EVIDENCE_PAGE_SIZE = 100;
export type EvidenceReadPoint = Readonly<{ interval: Readonly<{ id: string; ordinal: number }>; committedEvidenceBoundary: EvidenceIdentity | null; retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }> | null }>;
export type EvidencePageRequest = Readonly<{ order: "NEWEST_FIRST" | "OLDEST_FIRST"; size: number; cursor?: string }>;
export type FacetDiscoveryRequest = Readonly<{ facet: EvidenceFilterFacet; search?: string; size: number; cursor?: string }>;
export type FacetCount = Readonly<{ value: TypedFacetValue; count: number; pinned: boolean }>;
export type FacetDiscoveryResult = Readonly<{ state: "AVAILABLE"; facet: EvidenceFilterFacet; values: readonly FacetCount[]; distinctTotal: number; nextCursor: string | null; baseEvidenceCount: number }> | Readonly<{ state: "UNAVAILABLE"; facet: EvidenceFilterFacet; reason: "NO_CONCRETE_VALUES" | "DISCOVERY_FAILED" | "UNSUPPORTED_AT_READ_POINT"; values: readonly []; distinctTotal: null; nextCursor: null; baseEvidenceCount: number | null }>;
export type RevealBlocker = Readonly<{ id: string; criterion: FilterCriterion | UnsupportedCriterion | "free-text" | "around-evidence" }>;
export type DeterministicEvidenceRecord = Readonly<{ identity: EvidenceIdentity; timestamp: number; summary: string; searchText: string; facets: Readonly<Partial<Record<EvidenceFilterFacet, TypedFacetValue>>>; payload?: unknown }>;
export type EvidenceLookupResult = Readonly<{ state: "RETAINED"; evidence: DeterministicEvidenceRecord; inScope: boolean; matchesFilter: boolean; blockingCriteria: readonly RevealBlocker[] }> | Readonly<{ state: "NOT_RETAINED" | "OTHER_INTERVAL"; identity: EvidenceIdentity }>;
export type EvidenceFindRequest = Readonly<{ text: string; current?: EvidenceIdentity }>;
export type EvidenceFindResult = Readonly<{ text: string; total: number; current: EvidenceIdentity | null; previous: EvidenceIdentity | null; next: EvidenceIdentity | null }>;
export type EvidenceQueryTelemetry = Readonly<{ postingReads: number; postingCandidates: number; evidenceCursorReads: number; payloadHydrations: number; candidateBound: number; pageBound: number; retainedCount: number; cursorWorkBound: number; fullRetainedScan: boolean; shortFindFallback: boolean; residualScan: boolean; aroundIndexReads: number; aroundCandidates: number; aroundAnchorValidated: boolean; elapsedMs: number }>;
export type EvidenceSnapshot = Readonly<{ readPoint: EvidenceReadPoint; page: Readonly<{ evidence: readonly DeterministicEvidenceRecord[]; nextCursor: string | null }>; totals: Readonly<{ matching: number; inScope: number }>; discoveries: ReadonlyMap<EvidenceFilterFacet, FacetDiscoveryResult>; lookup: EvidenceLookupResult | null; find: EvidenceFindResult | null; evaluation: "COMPLETE" | "UNSUPPORTED_FILTER"; coverage: "COMPLETE" | "LIMITED"; storage: "INDEXED_DB" | "MEMORY_FALLBACK"; telemetry?: EvidenceQueryTelemetry }>;
export type EvidenceQueryRequest = Readonly<{ at: "LATEST_COMMITTED" | EvidenceReadPoint; page: EvidencePageRequest; filter: EvidenceFilter; discover?: readonly FacetDiscoveryRequest[]; lookup?: EvidenceIdentity; find?: EvidenceFindRequest }>;
export interface EvidenceFilterQueryAdapter { query(request: EvidenceQueryRequest): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>>; }
export type EvidenceFilterReadProblem = Readonly<{ code: "HISTORY_INTERVAL_UNAVAILABLE" | "READ_POINT_UNAVAILABLE" | "QUERY_FAILED" | "HISTORY_TERMINAL" | "AROUND_ANCHOR_UNAVAILABLE"; message: string }>;
export type EvidenceFilterLifecycleState = Readonly<{ phase: "ACTIVE" | "CLEARED" | "TERMINAL"; interval: Readonly<{ id: string; ordinal: number }>; committedEvidenceBoundary: EvidenceIdentity | null; retainedRange: Readonly<{ first: EvidenceIdentity; last: EvidenceIdentity }> | null; coverage: "COMPLETE" | "LIMITED"; storage: "INDEXED_DB" | "MEMORY_FALLBACK" }>;
