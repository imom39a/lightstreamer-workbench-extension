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
  includePayload?: boolean;
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
    ...(request.find === undefined ? {} : { find: request.find }),
    ...(request.includePayload === true ? { includePayload: true } : {})
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
      const compatible = scopeValue !== undefined &&
        (user.include.length === 0 || user.include.some((value) => structuralValueMatches(scopeValue, value)));
      const excluded = scopeValue !== undefined && user.exclude.some((value) => structuralValueMatches(scopeValue, value));
      if (!compatible) {
        criteria[facet] = Object.freeze({
          include: Object.freeze([typedFacetValue(facet, "structural-none", "\u0000workbench:no-filter-intersection")]),
          exclude: Object.freeze([])
        });
      } else if (excluded) {
        criteria[facet] = Object.freeze({
          include: Object.freeze([typedFacetValue(facet, "structural-none", "\u0000workbench:no-filter-intersection")]),
          exclude: Object.freeze([])
        });
      } else {
        // The structural value is the narrower side of the intersection. In
        // particular, an Item Scope carries both name and position; retaining
        // only a matching legacy item-name criterion would silently widen it.
        criteria[facet] = group;
      }
      continue;
    }
    criteria[facet] = group;
  }
  return Object.freeze({ ...filter, criteria: criteria as EvidenceFilter["criteria"] });
}

function structuralValueMatches(
  scopeValue: ReturnType<typeof typedFacetValue>,
  criterion: ReturnType<typeof typedFacetValue>
): boolean {
  if (criterion.type === "structural-none") return false;
  if (scopeValue.type === "structural-item") {
    const scope = parseStructuralItem(scopeValue.value);
    if (!scope) return false;
    if (criterion.facet === "legacy:item-position" && criterion.type === "number") {
      return scope[1] === Number(criterion.value);
    }
    if (criterion.facet !== "item") return false;
    if (criterion.type === "structural-item") {
      const wanted = parseStructuralItem(criterion.value);
      return wanted !== null &&
        (wanted[0] === null || wanted[0] === scope[0]) &&
        (wanted[1] === null || wanted[1] === scope[1]);
    }
    if (criterion.type === "item") {
      const observed = parseObservedItem(criterion.value);
      return observed !== null &&
        (observed[0] === null || observed[0] === scope[0]) &&
        (observed[1] === null || observed[1] === scope[1]);
    }
    return criterion.type === "string" && scope[0] === criterion.label;
  }
  return scopeValue.label === criterion.label;
}

function parseObservedItem(value: string): readonly [string | null, number | null] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed[0] !== "owner-v1" || parsed[1] !== "subscription") return null;
    const parts = parsed[4];
    if (!Array.isArray(parts)) return null;
    const nameEntry = parts.find((part) => Array.isArray(part) && part[0] === "name");
    const positionEntry = parts.find((part) => Array.isArray(part) && part[0] === "position");
    return [
      Array.isArray(nameEntry) && typeof nameEntry[1] === "string" ? nameEntry[1] : null,
      Array.isArray(positionEntry) && typeof positionEntry[1] === "number" ? positionEntry[1] : null
    ];
  } catch {
    return null;
  }
}

function parseStructuralItem(value: string): readonly [string | null, number | null] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const name = parsed[0] === null ? null : typeof parsed[0] === "string" ? parsed[0] : null;
    const position = parsed[1] === null ? null : typeof parsed[1] === "number" ? parsed[1] : null;
    return (name !== null || parsed[0] === null) && (position !== null || parsed[1] === null)
      ? [name, position]
      : null;
  } catch {
    return null;
  }
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
  const include = (facet: string, value: string | number, type = `structural-${facet}`, label = String(value)): void => {
    criteria[facet] = Object.freeze({
      include: Object.freeze([typedFacetValue(facet, type, String(value), label)]),
      exclude: Object.freeze([])
    });
  };
  if (scope.clientId !== undefined) include("client", scope.clientId === null ? "\u0000workbench:no-client" : scope.clientId);
  if (scope.sessionId !== undefined) include("session", scope.sessionId === null ? "\u0000workbench:no-session" : scope.sessionId);
  if (scope.subscriptionId !== undefined) include("subscription", scope.subscriptionId);
  if (scope.item !== undefined || scope.itemPosition !== undefined) {
    include(
      "item",
      JSON.stringify([scope.item ?? null, scope.itemPosition ?? null]),
      "structural-item",
      scope.item ?? String(scope.itemPosition)
    );
  }
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
