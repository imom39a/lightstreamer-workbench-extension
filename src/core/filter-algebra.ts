/**
 * The storage- and renderer-neutral Filter algebra.
 *
 * Scope is deliberately not a Filter field. Callers provide it to the
 * evaluator, which keeps structural Scope independent from user criteria.
 */

export const FILTER_VERSION = 1 as const;

export type FilterScalar = string | number | boolean | null;
export type FilterValueType = "string" | "enum" | "number" | "boolean" | "null";

export type TypedFilterValue = Readonly<{
  facet: string;
  type: FilterValueType;
  value: FilterScalar;
  label: string;
  identity: string;
}>;

export type FilterCriterionSet = Readonly<{
  include: readonly TypedFilterValue[];
  exclude: readonly TypedFilterValue[];
}>;

export type FilterAround = Readonly<{ intervalId: string; start: number; end: number }>;
export type UnsupportedFilterCriterion = Readonly<{
  id: string;
  reason: string;
  facet?: string;
  detail?: string;
}>;

export type Filter = Readonly<{
  version: typeof FILTER_VERSION;
  revision: number;
  text: string;
  criteria: Readonly<Record<string, FilterCriterionSet>>;
  around: FilterAround | null;
  unsupported: readonly UnsupportedFilterCriterion[];
}>;

export type FilterInput = Readonly<{
  version?: number;
  revision: number;
  text?: string;
  criteria?: Readonly<Record<string, Readonly<Partial<FilterCriterionSet>>>>;
  around?: FilterAround | null;
  unsupported?: readonly UnsupportedFilterCriterion[];
}>;

export type FilterRecord = Readonly<{
  timestamp: number;
  intervalId: string;
  searchText: string;
  facets: Readonly<Record<string, TypedFilterValue | undefined>>;
}>;

export type FilterEvaluation = Readonly<{
  evaluation: "COMPLETE" | "UNSUPPORTED_FILTER";
  inScope: boolean;
  matches: boolean;
}>;

export type FilterMutation =
  | Readonly<{ type: "add-criterion"; facet: string; value: TypedFilterValue; polarity?: FilterPolarity }>
  | Readonly<{ type: "remove-criterion"; facet: string; value: TypedFilterValue }>
  | Readonly<{ type: "set-polarity"; facet: string; value: TypedFilterValue; polarity: FilterPolarity }>
  | Readonly<{ type: "clear-facet"; facet: string }>
  | Readonly<{ type: "set-text"; text: string }>
  | Readonly<{ type: "set-around"; around: FilterAround }>
  | Readonly<{ type: "clear-around" }>
  | Readonly<{ type: "add-unsupported"; criterion: UnsupportedFilterCriterion }>
  | Readonly<{ type: "clear-unsupported"; id?: string }>
  | Readonly<{ type: "reset" | "clear" }>;

export type FilterPolarity = "include" | "exclude";

export type FilterMutationResult =
  | Readonly<{ ok: true; filter: Filter; changed: boolean }>
  | Readonly<{ ok: false; filter: Filter; problem: Readonly<{ code: "STALE_FILTER_REVISION" | "INVALID_FILTER_MUTATION"; message: string }> }>;

/** The deliberately small compatibility shape used by the Build 1 matcher. */
export type LegacyScalarFilter = Readonly<{
  query?: string;
  clientId?: string | null;
  sessionId?: string | null;
  subscriptionId?: string;
  mode?: string;
  item?: string;
  itemPosition?: number;
  key?: string;
  command?: string;
  snapshot?: boolean;
  synthetic?: boolean;
  kind?: string;
  listenerId?: string;
}>;

/**
 * Temporary Build 1 delegation. It is an authoring adapter only; the legacy
 * EventFilterState matcher remains the production compatibility path until
 * the Evidence facet catalog owns these identities (ticket filter-impl-03).
 */
export function canonicalFilterFromLegacyScalars(legacy: LegacyScalarFilter, revision = 1): Filter {
  const criteria: Record<string, { include: TypedFilterValue[]; exclude: TypedFilterValue[] }> = {};
  const add = (facet: string, type: FilterValueType, value: FilterScalar): void => {
    const typed = createTypedFilterValue(facet, type, value);
    criteria[facet] = { include: [typed], exclude: [] };
  };
  if (legacy.clientId !== undefined && legacy.clientId !== null) add("client", "string", legacy.clientId);
  if (legacy.sessionId !== undefined && legacy.sessionId !== null) add("session", "string", legacy.sessionId);
  if (legacy.subscriptionId !== undefined) add("subscription", "string", legacy.subscriptionId);
  if (legacy.mode !== undefined) add("mode", "enum", legacy.mode);
  if (legacy.item !== undefined) add("item", "string", legacy.item);
  if (legacy.itemPosition !== undefined) add("legacy:item-position", "number", legacy.itemPosition);
  if (legacy.key !== undefined) add("key", "string", legacy.key);
  if (legacy.command !== undefined) add("operation", "enum", legacy.command);
  if (legacy.snapshot !== undefined) add("phase", "enum", legacy.snapshot ? "SNAPSHOT" : "LIVE");
  if (legacy.synthetic !== undefined) add("provenance", "enum", legacy.synthetic ? "LOCAL" : "SERVER");
  if (legacy.kind !== undefined) add("kind", "string", legacy.kind);
  if (legacy.listenerId !== undefined) add("listener", "string", legacy.listenerId);
  return canonicalizeFilter({ version: FILTER_VERSION, revision, text: legacy.query ?? "", criteria });
}

export function createTypedFilterValue(
  facet: string,
  type: FilterValueType,
  value: FilterScalar,
  label = String(value)
): TypedFilterValue {
  assertNonEmptyString(facet, "facet");
  assertNonEmptyString(type, "type");
  const normalized = normalizeValue(type, value);
  return Object.freeze({
    facet,
    type,
    value: normalized,
    label: String(label),
    identity: JSON.stringify(["v1", facet, type, normalized])
  });
}

export function createFilter(revision = 1): Filter {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Filter revision must be a positive safe integer.");
  return freezeFilter({ version: FILTER_VERSION, revision, text: "", criteria: {}, around: null, unsupported: [] });
}

export function canonicalizeFilter(input: FilterInput): Filter {
  if (input.version !== undefined && input.version !== FILTER_VERSION) {
    throw new Error(`Unsupported Filter version ${String(input.version)}.`);
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error("Filter revision must be a positive safe integer.");
  const criteria: Record<string, FilterCriterionSet> = {};
  for (const facet of Object.keys(input.criteria ?? {}).sort()) {
    assertNonEmptyString(facet, "facet");
    const source = input.criteria?.[facet];
    const include = canonicalValues(facet, source?.include ?? []);
    const exclude = canonicalValues(facet, source?.exclude ?? []);
    if (include.length || exclude.length) criteria[facet] = Object.freeze({ include, exclude });
  }
  const unsupported = [...(input.unsupported ?? [])]
    .map((criterion) => canonicalUnsupported(criterion))
    .sort((left, right) => left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason));
  return freezeFilter({
    version: FILTER_VERSION,
    revision: input.revision,
    text: normalizeText(input.text ?? ""),
    criteria,
    around: input.around === undefined || input.around === null ? null : canonicalAround(input.around),
    unsupported
  });
}

export function serializeFilter(filter: FilterInput): string {
  return JSON.stringify(canonicalizeFilter(filter));
}

export function filterEquals(left: FilterInput, right: FilterInput): boolean {
  return serializeFilter(left) === serializeFilter(right);
}

export function evaluateFilter(
  filterInput: FilterInput,
  record: FilterRecord,
  scope: (record: FilterRecord) => boolean = () => true
): FilterEvaluation {
  const filter = canonicalizeFilter(filterInput);
  if (filter.unsupported.length > 0) return { evaluation: "UNSUPPORTED_FILTER", inScope: false, matches: false };
  const inScope = Boolean(scope(record));
  if (!inScope) return { evaluation: "COMPLETE", inScope: false, matches: false };
  if (filter.text && !normalizeText(record.searchText).includes(filter.text)) return { evaluation: "COMPLETE", inScope: true, matches: false };
  if (filter.around && (record.intervalId !== filter.around.intervalId || record.timestamp < filter.around.start || record.timestamp >= filter.around.end)) {
    return { evaluation: "COMPLETE", inScope: true, matches: false };
  }
  for (const [facet, criterion] of Object.entries(filter.criteria)) {
    const value = record.facets[facet];
    if (criterion.include.length > 0 && (!value || !criterion.include.some((candidate) => candidate.identity === value.identity))) {
      return { evaluation: "COMPLETE", inScope: true, matches: false };
    }
    if (value && criterion.exclude.some((candidate) => candidate.identity === value.identity)) {
      return { evaluation: "COMPLETE", inScope: true, matches: false };
    }
  }
  return { evaluation: "COMPLETE", inScope: true, matches: true };
}

export function matchesFilter(filter: FilterInput, record: FilterRecord): boolean {
  return evaluateFilter(filter, record).matches;
}

export function applyFilterMutations(currentInput: FilterInput, expectedRevision: number, operations: readonly FilterMutation[]): FilterMutationResult {
  const current = canonicalizeFilter(currentInput);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, filter: current, problem: { code: "STALE_FILTER_REVISION", message: "The Filter revision is stale." } };
  }
  try {
    let next: Filter = current;
    for (const operation of operations) next = applyMutation(next, operation);
    const changed = !filterEquals(current, next);
    return { ok: true, filter: canonicalizeFilter({ ...next, revision: current.revision + 1 }), changed };
  } catch (error) {
    return { ok: false, filter: current, problem: { code: "INVALID_FILTER_MUTATION", message: error instanceof Error ? error.message : "Invalid Filter mutation." } };
  }
}

function applyMutation(current: Filter, operation: FilterMutation): Filter {
  switch (operation.type) {
    case "set-text": return canonicalizeFilter({ ...current, text: operation.text });
    case "set-around": return canonicalizeFilter({ ...current, around: operation.around });
    case "clear-around": return canonicalizeFilter({ ...current, around: null });
    case "reset":
    case "clear": return createFilter(current.revision);
    case "clear-facet": {
      const criteria = { ...current.criteria };
      delete criteria[operation.facet];
      return canonicalizeFilter({ ...current, criteria });
    }
    case "add-criterion": return setCriterion(current, operation.facet, operation.value, operation.polarity ?? "include");
    case "set-polarity": return setCriterion(current, operation.facet, operation.value, operation.polarity);
    case "remove-criterion": {
      const criteria = { ...current.criteria };
      const existing = criteria[operation.facet];
      if (existing) criteria[operation.facet] = { include: existing.include.filter((value) => value.identity !== operation.value.identity), exclude: existing.exclude.filter((value) => value.identity !== operation.value.identity) };
      return canonicalizeFilter({ ...current, criteria });
    }
    case "add-unsupported": return canonicalizeFilter({ ...current, unsupported: [...current.unsupported, operation.criterion] });
    case "clear-unsupported": return canonicalizeFilter({ ...current, unsupported: operation.id === undefined ? [] : current.unsupported.filter((criterion) => criterion.id !== operation.id) });
    default: return assertNever(operation);
  }
}

function setCriterion(current: Filter, facet: string, value: TypedFilterValue, polarity: FilterPolarity): Filter {
  if (value.facet !== facet) throw new Error("Criterion facet does not match its value facet.");
  if (polarity !== "include" && polarity !== "exclude") throw new Error("Invalid Filter polarity.");
  const criteria = { ...current.criteria };
  const existing = criteria[facet] ?? { include: [], exclude: [] };
  const include = existing.include.filter((candidate) => candidate.identity !== value.identity);
  const exclude = existing.exclude.filter((candidate) => candidate.identity !== value.identity);
  (polarity === "include" ? include : exclude).push(canonicalValue(facet, value));
  criteria[facet] = { include, exclude };
  return canonicalizeFilter({ ...current, criteria });
}

function canonicalValues(facet: string, values: readonly TypedFilterValue[]): readonly TypedFilterValue[] {
  const deduped = new Map<string, TypedFilterValue>();
  for (const value of values) {
    const canonical = canonicalValue(facet, value);
    deduped.set(canonical.identity, canonical);
  }
  return Object.freeze([...deduped.values()].sort((left, right) => left.identity.localeCompare(right.identity)));
}

function canonicalValue(facet: string, value: TypedFilterValue): TypedFilterValue {
  if (!value || value.facet !== facet) throw new Error("Criterion value has the wrong facet.");
  return createTypedFilterValue(facet, value.type, value.value, value.label);
}

function canonicalUnsupported(value: UnsupportedFilterCriterion): UnsupportedFilterCriterion {
  assertNonEmptyString(value.id, "unsupported criterion id");
  assertNonEmptyString(value.reason, "unsupported criterion reason");
  return Object.freeze({ ...value });
}

function canonicalAround(value: FilterAround): FilterAround {
  if (!value || typeof value.intervalId !== "string" || !value.intervalId || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start >= value.end) {
    throw new Error("Around must be a finite, non-empty half-open range.");
  }
  return Object.freeze({ intervalId: value.intervalId, start: value.start, end: value.end });
}

function normalizeValue(type: FilterValueType, value: FilterScalar): FilterScalar {
  if (type === "enum") {
    if (typeof value !== "string") throw new Error("Enum Filter values must be strings.");
    return value.toUpperCase();
  }
  if (type === "string" && typeof value !== "string") throw new Error("String Filter values must be strings.");
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Number Filter values must be finite numbers.");
  if (type === "boolean" && typeof value !== "boolean") throw new Error("Boolean Filter values must be booleans.");
  if (type === "null" && value !== null) throw new Error("Null Filter values must be null.");
  return value;
}

function normalizeText(value: string): string {
  if (typeof value !== "string") throw new Error("Filter text must be a string.");
  return value.trim().toLowerCase();
}

function freezeFilter(value: Omit<Filter, "version"> & { version: typeof FILTER_VERSION }): Filter {
  const criteria = Object.fromEntries(Object.entries(value.criteria).map(([facet, criterion]) => [facet, Object.freeze({ include: Object.freeze([...criterion.include]), exclude: Object.freeze([...criterion.exclude]) })]));
  return Object.freeze({ ...value, text: normalizeText(value.text), criteria: Object.freeze(criteria), unsupported: Object.freeze([...value.unsupported]) });
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Filter mutation: ${JSON.stringify(value)}.`);
}
