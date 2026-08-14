/**
 * The storage- and renderer-neutral Filter algebra.
 *
 * Scope is deliberately not a Filter field. Callers provide it to the
 * evaluator, which keeps structural Scope independent from user criteria.
 */

export const FILTER_VERSION = 1 as const;

export type FilterScalar = string | number | boolean | null;
export type FilterValueType = "string" | "enum" | "number" | "boolean" | "null" | (string & {});

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
  | Readonly<{ type: "replace-facet"; facet: string; criterion: Readonly<Partial<FilterCriterionSet>> }>
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

export type FilterBuilder = Readonly<{
  add(facet: string, value: TypedFilterValue, polarity?: FilterPolarity): void;
  remove(facet: string, value: TypedFilterValue): void;
  setPolarity(facet: string, value: TypedFilterValue, polarity: FilterPolarity): void;
  setFacet(facet: string, criterion: Readonly<Partial<FilterCriterionSet>>): void;
  setText(text: string): void;
  setAround(around: FilterAround): void;
  clearAround(): void;
  reset(): void;
  apply(expectedRevision: number): FilterMutationResult;
}>;

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
    .filter((criterion, index, all) => all.findIndex((candidate) => serializeUnsupported(candidate) === serializeUnsupported(criterion)) === index)
    .sort(compareUnsupported);
  return freezeFilter({
    version: FILTER_VERSION,
    revision: input.revision,
    text: input.text === undefined ? "" : normalizeText(input.text),
    criteria,
    around: input.around === undefined || input.around === null ? null : canonicalAround(input.around),
    unsupported
  });
}

export function serializeFilter(filter: FilterInput): string {
  const canonical = canonicalizeFilter(filter);
  return JSON.stringify({
    ...canonical,
    criteria: Object.fromEntries(Object.entries(canonical.criteria).map(([facet, criterion]) => [facet, {
      include: criterion.include.map(serializeValue),
      exclude: criterion.exclude.map(serializeValue)
    }]))
  });
}

export function filterEquals(left: FilterInput, right: FilterInput): boolean {
  return serializeFilter(left) === serializeFilter(right);
}

/**
 * Creates a renderer-neutral draft. Draft operations are kept separate from
 * the committed Filter and are applied as one expected-revision transaction.
 */
export function createFilterBuilder(current: FilterInput): FilterBuilder {
  const base = canonicalizeFilter(current);
  const operations: FilterMutation[] = [];
  const builder: FilterBuilder = {
    add(facet, value, polarity) { operations.push({ type: "add-criterion", facet, value, ...(polarity === undefined ? {} : { polarity }) }); },
    remove(facet, value) { operations.push({ type: "remove-criterion", facet, value }); },
    setPolarity(facet, value, polarity) { operations.push({ type: "set-polarity", facet, value, polarity }); },
    setFacet(facet, criterion) { operations.push({ type: "replace-facet", facet, criterion }); },
    setText(text) { operations.push({ type: "set-text", text }); },
    setAround(around) { operations.push({ type: "set-around", around }); },
    clearAround() { operations.push({ type: "clear-around" }); },
    reset() { operations.push({ type: "reset" }); },
    apply(expectedRevision) { return applyFilterMutations(base, expectedRevision, operations); }
  };
  return Object.freeze(builder);
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
    if (criterion.include.length > 0 && (!value || !criterion.include.some((candidate) => filterValueMatches(value, candidate)))) {
      return { evaluation: "COMPLETE", inScope: true, matches: false };
    }
    if (value && criterion.exclude.some((candidate) => filterValueMatches(value, candidate))) {
      return { evaluation: "COMPLETE", inScope: true, matches: false };
    }
  }
  return { evaluation: "COMPLETE", inScope: true, matches: true };
}

export function matchesFilter(filter: FilterInput, record: FilterRecord): boolean {
  return evaluateFilter(filter, record).matches;
}

/** Compares a retained facet with an ordinary user or structural criterion. */
export function filterValueMatches(
  candidate: TypedFilterValue | undefined,
  criterion: TypedFilterValue
): boolean {
  if (!candidate || criterion.type === "structural-none") return false;
  if (!criterion.type.startsWith("structural-")) {
    if (candidate.identity === criterion.identity) return true;
    return false;
  }
  if (criterion.type === "structural-item") {
    const wanted = parseStructuralItem(String(criterion.value));
    const observed = parseObservedItem(candidate.value);
    if (!wanted || !observed) return false;
    return (wanted[0] === null || observed[0] === wanted[0]) &&
      (wanted[1] === null || observed[1] === wanted[1]);
  }
  return candidate.label === criterion.label;
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

function parseObservedItem(value: FilterScalar): readonly [string | null, number | null] | null {
  if (typeof value !== "string") return null;
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

export function applyFilterMutations(currentInput: FilterInput, expectedRevision: number, operations: readonly FilterMutation[]): FilterMutationResult {
  const current = canonicalizeFilter(currentInput);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) {
    return { ok: false, filter: current, problem: { code: "STALE_FILTER_REVISION", message: "The Filter revision is stale." } };
  }
  try {
    let next: Filter = current;
    for (const operation of operations) next = applyMutation(next, operation);
    const changed = !filterEquals(current, next);
    return { ok: true, filter: changed ? canonicalizeFilter({ ...next, revision: current.revision + 1 }) : current, changed };
  } catch (error) {
    return { ok: false, filter: current, problem: { code: "INVALID_FILTER_MUTATION", message: error instanceof Error ? error.message : "Invalid Filter mutation." } };
  }
}

function applyMutation(current: Filter, operation: FilterMutation): Filter {
  switch (operation.type) {
    case "set-text": return canonicalizeFilter({ ...current, text: operation.text });
    case "set-around": return canonicalizeFilter({ ...current, around: canonicalAround(operation.around) });
    case "clear-around": return canonicalizeFilter({ ...current, around: null });
    case "reset":
    case "clear": return createFilter(current.revision);
    case "clear-facet": {
      assertNonEmptyString(operation.facet, "facet");
      const criteria = { ...current.criteria };
      delete criteria[operation.facet];
      return canonicalizeFilter({ ...current, criteria });
    }
    case "add-criterion": return setCriterion(current, operation.facet, operation.value, operation.polarity === undefined ? "include" : operation.polarity);
    case "set-polarity": return setCriterion(current, operation.facet, operation.value, operation.polarity);
    case "replace-facet": {
      assertNonEmptyString(operation.facet, "facet");
      const criteria = { ...current.criteria };
      if (!operation.criterion || typeof operation.criterion !== "object") throw new Error("Facet replacement must be an object.");
      const source = operation.criterion;
      const include = canonicalValues(operation.facet, source.include ?? []);
      const exclude = canonicalValues(operation.facet, source.exclude ?? []);
      if (include.length || exclude.length) criteria[operation.facet] = { include, exclude };
      else delete criteria[operation.facet];
      return canonicalizeFilter({ ...current, criteria });
    }
    case "remove-criterion": {
      const value = canonicalValue(operation.facet, operation.value);
      const criteria = { ...current.criteria };
      const existing = criteria[operation.facet];
      if (existing) criteria[operation.facet] = { include: existing.include.filter((candidate) => candidate.identity !== value.identity), exclude: existing.exclude.filter((candidate) => candidate.identity !== value.identity) };
      return canonicalizeFilter({ ...current, criteria });
    }
    case "add-unsupported": return canonicalizeFilter({ ...current, unsupported: [...current.unsupported, operation.criterion] });
    case "clear-unsupported": {
      if (operation.id !== undefined) assertNonEmptyString(operation.id, "unsupported criterion id");
      return canonicalizeFilter({ ...current, unsupported: operation.id === undefined ? [] : current.unsupported.filter((criterion) => criterion.id !== operation.id) });
    }
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
    const existing = deduped.get(canonical.identity);
    if (!existing || compareStrings(canonical.label, existing.label) < 0) deduped.set(canonical.identity, canonical);
  }
  return Object.freeze([...deduped.values()].sort((left, right) => compareStrings(left.identity, right.identity)));
}

function canonicalValue(facet: string, value: TypedFilterValue): TypedFilterValue {
  if (!value || value.facet !== facet) throw new Error("Criterion value has the wrong facet.");
  return createTypedFilterValue(facet, value.type, value.value, value.label === undefined ? String(value.value) : value.label);
}

function canonicalUnsupported(value: UnsupportedFilterCriterion): UnsupportedFilterCriterion {
  assertNonEmptyString(value.id, "unsupported criterion id");
  assertNonEmptyString(value.reason, "unsupported criterion reason");
  if (value.facet !== undefined) assertNonEmptyString(value.facet, "unsupported criterion facet");
  if (value.detail !== undefined) assertNonEmptyString(value.detail, "unsupported criterion detail");
  return Object.freeze({
    id: value.id,
    reason: value.reason,
    ...(value.facet === undefined ? {} : { facet: value.facet }),
    ...(value.detail === undefined ? {} : { detail: value.detail })
  });
}

function serializeUnsupported(value: UnsupportedFilterCriterion): string {
  return JSON.stringify([value.id, value.reason, value.facet ?? null, value.detail ?? null]);
}

function serializeValue(value: TypedFilterValue): Omit<TypedFilterValue, "label"> {
  return {
    facet: value.facet,
    type: value.type,
    value: value.value,
    identity: value.identity
  };
}

function compareUnsupported(left: UnsupportedFilterCriterion, right: UnsupportedFilterCriterion): number {
  return compareStrings(left.id, right.id)
    || compareStrings(left.reason, right.reason)
    || compareOptionalStrings(left.detail, right.detail)
    || compareOptionalStrings(left.facet, right.facet);
}

function compareOptionalStrings(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareStrings(left, right);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalAround(value: FilterAround): FilterAround {
  if (!value || typeof value.intervalId !== "string" || !value.intervalId || !Number.isFinite(value.start) || !Number.isFinite(value.end) || value.start >= value.end) {
    throw new Error("Around must be a finite, non-empty half-open range.");
  }
  return Object.freeze({ intervalId: value.intervalId, start: value.start, end: value.end });
}

function normalizeValue(type: FilterValueType, value: FilterScalar): FilterScalar {
  switch (type) {
    case "enum":
      if (typeof value !== "string") throw new Error("Enum Filter values must be strings.");
      return value.toUpperCase();
    case "string":
      if (typeof value !== "string") throw new Error("String Filter values must be strings.");
      return value;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Number Filter values must be finite numbers.");
      return value;
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Boolean Filter values must be booleans.");
      return value;
    case "null":
      if (value !== null) throw new Error("Null Filter values must be null.");
      return value;
    default:
      if (typeof value !== "string") throw new Error(`Custom Filter values must be strings.`);
      return value;
  }
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
