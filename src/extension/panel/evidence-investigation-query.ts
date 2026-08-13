import {
  typedFacetValue,
  type EvidenceFilter,
  type EvidenceFilterFacet,
  type EvidenceFilterQueryAdapter,
  type EvidenceFilterReadProblem,
  type EvidenceFindRequest,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceLookupResult,
  type EvidencePageRequest,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot,
  type FacetDiscoveryRequest,
  type FacetDiscoveryResult
} from "../../core/evidence-filter-contract";
import {
  canonicalizeFilter,
  type Filter,
  type TypedFilterValue
} from "../../core/filter-algebra";

/** Structural Scope is deliberately separate from the canonical user Filter. */
export type StructuralEvidenceScope = Readonly<{
  kind: "PAGE" | "CLIENT" | "SESSION" | "SUBSCRIPTION" | "ITEM" | "LISTENER" | "NONE";
  clientId?: string | null;
  sessionId?: string | null;
  subscriptionId?: string;
  item?: string;
  itemPosition?: number;
  listenerId?: string;
}>;

export type EvidenceInvestigationQueryRequest = Readonly<{
  at: "LATEST_COMMITTED" | EvidenceReadPoint;
  scope: StructuralEvidenceScope;
  filter: Filter;
  page: EvidencePageRequest;
  discover: readonly FacetDiscoveryRequest[];
  lookup?: EvidenceIdentity;
  find?: EvidenceFindRequest;
}>;

export type EvidenceInvestigationQueryResult =
  | Readonly<{ ok: true; value: EvidenceSnapshot }>
  | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>;

export interface EvidenceInvestigationQuery {
  query(request: EvidenceInvestigationQueryRequest): Promise<EvidenceInvestigationQueryResult>;
}

/**
 * The panel-owned adapter is the only place where canonical Filter and
 * structural Scope become the ticket09 storage-neutral EvidenceFilter shape.
 * Event History remains unaware of WorkbenchRuntime presentation state.
 */
export function createEvidenceInvestigationQuery(
  adapter: EvidenceFilterQueryAdapter
): EvidenceInvestigationQuery {
  return Object.freeze({
    query(request: EvidenceInvestigationQueryRequest): Promise<EvidenceInvestigationQueryResult> {
      return adapter.query(toEvidenceQueryRequest(request));
    }
  });
}

export function toEvidenceQueryRequest(
  request: EvidenceInvestigationQueryRequest
): EvidenceQueryRequest {
  const filter = canonicalFilterToEvidenceFilter(request.filter);
  return Object.freeze({
    at: request.at,
    page: request.page,
    filter: mergeStructuralScope(filter, request.scope),
    ...(request.discover.length > 0 ? { discover: request.discover } : {}),
    ...(request.lookup === undefined ? {} : { lookup: request.lookup }),
    ...(request.find === undefined ? {} : { find: request.find })
  });
}

/** Exposed for focused adapter tests and compatibility bridges. */
export function canonicalFilterToEvidenceFilter(filterInput: Filter): EvidenceFilter {
  const filter = canonicalizeFilter(filterInput);
  const criteria: Record<string, {
    include: readonly ReturnType<typeof typedFacetValue>[];
    exclude: readonly ReturnType<typeof typedFacetValue>[];
  }> = {};
  for (const [facet, criterion] of Object.entries(filter.criteria)) {
    criteria[facet] = Object.freeze({
      include: Object.freeze(criterion.include.map(toEvidenceFacetValue)),
      exclude: Object.freeze(criterion.exclude.map(toEvidenceFacetValue))
    });
  }
  return Object.freeze({
    revision: filter.revision,
    text: filter.text,
    criteria: criteria as EvidenceFilter["criteria"],
    around: filter.around === null ? null : Object.freeze({ ...filter.around }),
    unsupported: Object.freeze(filter.unsupported.map((criterion) => Object.freeze({
      id: criterion.id,
      label: criterion.detail ?? criterion.reason,
      reason: unsupportedReason(criterion.reason)
    })))
  });
}

function toEvidenceFacetValue(value: TypedFilterValue): ReturnType<typeof typedFacetValue> {
  const serialized = value.value === null ? "null" : String(value.value);
  return typedFacetValue(value.facet, value.type, serialized, value.label);
}

function unsupportedReason(reason: string): "UNSUPPORTED_FACET" | "UNSUPPORTED_VALUE" | "UNSUPPORTED_OPERATOR" {
  if (reason.includes("VALUE")) return "UNSUPPORTED_VALUE";
  if (reason.includes("OPERATOR")) return "UNSUPPORTED_OPERATOR";
  return "UNSUPPORTED_FACET";
}

function mergeStructuralScope(
  filter: EvidenceFilter,
  scope: StructuralEvidenceScope
): EvidenceFilter {
  const scopeCriteria = structuralScopeCriteria(scope);
  if (Object.keys(scopeCriteria).length === 0) return filter;
  const criteria: Record<string, {
    include: readonly ReturnType<typeof typedFacetValue>[];
    exclude: readonly ReturnType<typeof typedFacetValue>[];
  }> = {};
  for (const [facet, group] of Object.entries(filter.criteria)) {
    if (group) criteria[facet] = group;
  }
  for (const [facet, group] of Object.entries(scopeCriteria)) {
    const user = criteria[facet];
    if (user && (user.include.length > 0 || user.exclude.length > 0)) {
      const scopeValue = group.include[0];
      const compatible = scopeValue !== undefined && user.include.some((value) => value.identity === scopeValue.identity);
      if (!compatible) {
        criteria[facet] = Object.freeze({
          include: Object.freeze([typedFacetValue(facet, "string", "\u0000workbench:no-filter-intersection")]),
          exclude: Object.freeze([])
        });
      }
      continue;
    }
    criteria[facet] = group;
  }
  return Object.freeze({ ...filter, criteria: criteria as EvidenceFilter["criteria"] });
}

function structuralScopeCriteria(
  scope: StructuralEvidenceScope
): Readonly<Record<EvidenceFilterFacet, Readonly<{ include: readonly ReturnType<typeof typedFacetValue>[]; exclude: readonly ReturnType<typeof typedFacetValue>[] }>>> {
  if (scope.kind === "PAGE") return {};
  if (scope.kind === "NONE") return {
    client: Object.freeze({
      include: Object.freeze([typedFacetValue("client", "string", "\u0000workbench:no-structural-scope")]),
      exclude: Object.freeze([])
    })
  };
  const criteria: Record<string, { include: readonly ReturnType<typeof typedFacetValue>[]; exclude: readonly ReturnType<typeof typedFacetValue>[] }> = {};
  const include = (facet: string, value: string | number): void => {
    criteria[facet] = Object.freeze({
      include: Object.freeze([typedFacetValue(facet, typeof value === "number" ? "number" : "string", String(value))]),
      exclude: Object.freeze([])
    });
  };
  if (scope.clientId !== undefined) include("client", scope.clientId === null ? "\u0000workbench:no-client" : scope.clientId);
  if (scope.sessionId !== undefined) include("session", scope.sessionId === null ? "\u0000workbench:no-session" : scope.sessionId);
  if (scope.subscriptionId !== undefined) include("subscription", scope.subscriptionId);
  if (scope.item !== undefined) include("item", scope.item);
  if (scope.itemPosition !== undefined) include("legacy:item-position", scope.itemPosition);
  if (scope.listenerId !== undefined) include("listener", scope.listenerId);
  return criteria;
}

// Keep these imports type-visible in generated declaration output when the
// adapter is consumed by panel tests without leaking storage implementation.
export type EvidenceInvestigationFacts = Readonly<{
  discoveries: ReadonlyMap<EvidenceFilterFacet, FacetDiscoveryResult>;
  lookup: EvidenceLookupResult | null;
  find: EvidenceFindResult | null;
}>;
