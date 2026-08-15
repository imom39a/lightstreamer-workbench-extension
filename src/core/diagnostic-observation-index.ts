import type { DiagnosticAffectedIdentity, DiagnosticObservation, DiagnosticObservationInput, DiagnosticSeverity } from "./diagnostic-observation";
import { typedFacetValue, type TypedFacetValue } from "./evidence-filter-contract";

export const DIAGNOSTIC_FILTER_FACETS = Object.freeze([
  "diagnosticCode",
  "diagnosticSeverity",
  "diagnosticAffected"
] as const);
export type DiagnosticFilterFacet = (typeof DIAGNOSTIC_FILTER_FACETS)[number];

export type DiagnosticObservationIndexRecord = Readonly<{
  observation: DiagnosticObservation | DiagnosticObservationInput;
  facets: Readonly<Record<DiagnosticFilterFacet, readonly TypedFacetValue[]>>;
}>;

export type DiagnosticFilterCriterionSet = Readonly<{
  include: readonly TypedFacetValue[];
  exclude: readonly TypedFacetValue[];
}>;
export type DiagnosticFilterCriteria = Readonly<Partial<Record<
  DiagnosticFilterFacet,
  readonly TypedFacetValue[] | DiagnosticFilterCriterionSet
>>>;

export type DiagnosticObservationIndex = Readonly<{
  records: readonly DiagnosticObservationIndexRecord[];
  query(criteria?: DiagnosticFilterCriteria): readonly DiagnosticObservationIndexRecord[];
  discover(facet: DiagnosticFilterFacet): readonly Readonly<{ value: TypedFacetValue; count: number }>[];
}>;

export function diagnosticCodeFacetValue(code: string): TypedFacetValue {
  return typedFacetValue("diagnosticCode", "diagnostic-code", code, code);
}

export function diagnosticSeverityFacetValue(severity: DiagnosticSeverity): TypedFacetValue {
  const label = severity.slice(0, 1).toUpperCase() + severity.slice(1);
  return typedFacetValue("diagnosticSeverity", "diagnostic-severity", severity, label);
}

export function diagnosticAffectedFacetValue(kind: string, value: string, label: string): TypedFacetValue {
  return typedFacetValue("diagnosticAffected", `diagnostic-${kind}`, value, label);
}

export function createDiagnosticObservationIndex(
  observations: readonly (DiagnosticObservation | DiagnosticObservationInput)[]
): DiagnosticObservationIndex {
  const records = Object.freeze(observations.map((observation) => Object.freeze({
    observation,
    facets: Object.freeze({
      diagnosticCode: Object.freeze([diagnosticCodeFacetValue(observation.code)]),
      diagnosticSeverity: Object.freeze([diagnosticSeverityFacetValue(observation.severity)]),
      diagnosticAffected: affectedFacetValues(observation.affected)
    })
  })));
  return Object.freeze({
    records,
    query(criteria = {}) {
      return Object.freeze(records.filter((record) => DIAGNOSTIC_FILTER_FACETS.every((facet) => {
        const criterion = criteria[facet] ?? [];
        const include = "include" in criterion ? criterion.include : criterion;
        const exclude = "exclude" in criterion ? criterion.exclude : Object.freeze([]);
        if (include.length === 0 && exclude.length === 0) return true;
        const actual = new Set(record.facets[facet].map(({ identity }) => identity));
        return (include.length === 0 || include.some(({ identity }) => actual.has(identity))) &&
          exclude.every(({ identity }) => !actual.has(identity));
      })));
    },
    discover(facet) {
      const counts = new Map<string, { value: TypedFacetValue; count: number }>();
      for (const record of records) {
        const seen = new Set<string>();
        for (const value of record.facets[facet]) {
          if (seen.has(value.identity)) continue;
          seen.add(value.identity);
          const prior = counts.get(value.identity);
          if (prior) prior.count += 1;
          else counts.set(value.identity, { value, count: 1 });
        }
      }
      return Object.freeze([...counts.values()]
        .sort((left, right) => right.count - left.count || left.value.value.localeCompare(right.value.value))
        .map((entry) => Object.freeze({ value: entry.value, count: entry.count })));
    }
  });
}

function affectedFacetValues(affected: DiagnosticAffectedIdentity): readonly TypedFacetValue[] {
  if (affected.kind === "unavailable") return Object.freeze([]);
  if (affected.kind === "evidence") {
    return Object.freeze([diagnosticAffectedFacetValue("evidence", `${affected.intervalId}/${affected.sequence}/${affected.eventId}`, `Evidence ${affected.eventId}`)]);
  }
  const values: TypedFacetValue[] = [diagnosticAffectedFacetValue("page", affected.pageId, `Page ${affected.pageId}`)];
  if (affected.kind === "page") return Object.freeze(values);
  values.push(diagnosticAffectedFacetValue("client", `${affected.pageId}/${affected.clientId}`, `Client ${affected.clientId}`));
  if (affected.kind === "client") return Object.freeze(values);
  if (affected.kind === "session") {
    values.push(diagnosticAffectedFacetValue("session", `${affected.pageId}/${affected.clientId}/${affected.sessionId}`, `Session ${affected.sessionId}`));
    return Object.freeze(values);
  }
  if (affected.kind === "subscription") {
    if (affected.sessionId) values.push(diagnosticAffectedFacetValue("session", `${affected.pageId}/${affected.clientId}/${affected.sessionId}`, `Session ${affected.sessionId}`));
    values.push(diagnosticAffectedFacetValue("subscription", `${affected.pageId}/${affected.clientId}/${affected.subscriptionId}`, `Subscription ${affected.subscriptionId}`));
    return Object.freeze(values);
  }
  values.push(diagnosticAffectedFacetValue("subscription", `${affected.pageId}/${affected.clientId}/${affected.subscriptionId}`, `Subscription ${affected.subscriptionId}`));
  values.push(diagnosticAffectedFacetValue("item", `${affected.pageId}/${affected.clientId}/${affected.subscriptionId}/${affected.item}`, `Item ${affected.item}`));
  return Object.freeze(values);
}
