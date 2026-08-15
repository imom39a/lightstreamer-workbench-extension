import type {
  DiagnosticAffectedIdentity,
  DiagnosticConditionResolution,
  DiagnosticEvidenceBoundary,
  DiagnosticObservationInput
} from "./diagnostic-observation";
import { diagnosticObservationIdentity, normalizeDiagnosticObservationInput } from "./diagnostic-observation";

export type TopologyDescriptor =
  | Readonly<{ kind: "list"; values: readonly string[] }>
  | Readonly<{ kind: "schema"; name: string }>
  | Readonly<{ kind: "unset" }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export type UnavailableTopologyFact = Readonly<{ kind: "unavailable"; reason: string }>;
export type TopologyScalar<T> = T | UnavailableTopologyFact;

export type TopologySubscriptionConfiguration = Readonly<{
  mode: TopologyScalar<"MERGE" | "DISTINCT" | "RAW" | "COMMAND">;
  items: TopologyDescriptor;
  fields: TopologyDescriptor;
  dataAdapter: TopologyScalar<string | null>;
  selector: TopologyScalar<string | null>;
  requestedSnapshot: TopologyScalar<string | number | null>;
  requestedMaxFrequency: TopologyScalar<string | number | null>;
  requestedBufferSize: TopologyScalar<string | number | null>;
  secondLevelFields: TopologyDescriptor;
  secondLevelDataAdapter: TopologyScalar<string | null>;
}>;

export type TopologySubscriptionFact = Readonly<{
  affected: Extract<DiagnosticAffectedIdentity, Readonly<{ kind: "subscription" }>>;
  current: boolean;
  activeAtBoundary: boolean;
  configuration: TopologySubscriptionConfiguration;
  evidence: DiagnosticEvidenceBoundary;
}>;

export type TopologyChurnWindow = Readonly<{
  id: string;
  kind: "listener" | "subscription";
  affected: DiagnosticAffectedIdentity;
  startedAt: number;
  endedAt: number;
  threshold: number;
  totalChanges: number;
  retainedChanges: readonly Readonly<{ operation: "add" | "remove"; evidence: DiagnosticEvidenceBoundary }>[];
  current: boolean;
  complete: boolean;
  lateAttachment: boolean;
}>;

export type DiagnosticConclusion =
  | "listener-presence"
  | "subscription-configuration"
  | "topology-completeness"
  | "history-after-terminal-boundary"
  | "snapshot-state"
  | "update-delivery-attribution"
  | "pre-attachment-churn";

export type TopologyCoverageLimitation = Readonly<{
  id: string;
  kind: "late-attachment" | "observation-path" | "history-capacity" | "unsupported-shape";
  affected: DiagnosticAffectedIdentity;
  current: boolean;
  detail: string;
  weakens: readonly DiagnosticConclusion[];
  evidence?: DiagnosticEvidenceBoundary;
}>;

export type TopologyContextDiagnosticInput = Readonly<{
  boundary: Readonly<{ observedAt: number; sequence: number; evidence?: DiagnosticEvidenceBoundary }>;
  subscriptions: readonly TopologySubscriptionFact[];
  churnWindows: readonly TopologyChurnWindow[];
  limitations: readonly TopologyCoverageLimitation[];
}>;

export type TopologyContextDiagnosticEvaluation = Readonly<{
  observations: readonly DiagnosticObservationInput[];
  resolutions: readonly DiagnosticConditionResolution[];
}>;

export function evaluateTopologyContextDiagnostics(
  input: TopologyContextDiagnosticInput,
  previouslyActive: readonly DiagnosticObservationInput[] = []
): TopologyContextDiagnosticEvaluation {
  const observations = exactDuplicateObservations(input);
  const active = new Set(observations.flatMap((observation) =>
    observation.lifecycle.kind === "condition" ? [diagnosticObservationIdentity(observation)] : []));
  const resolutions = previouslyActive.flatMap((observation): DiagnosticConditionResolution[] => {
    if (observation.lifecycle.kind !== "condition" || active.has(diagnosticObservationIdentity(observation))) return [];
    return [Object.freeze({
      code: observation.code,
      ruleVersion: observation.ruleVersion,
      conditionId: observation.lifecycle.conditionId,
      affected: observation.affected,
      observedAt: input.boundary.observedAt,
      evidenceBoundary: input.boundary.evidence
    })];
  });
  return Object.freeze({ observations: Object.freeze(observations), resolutions: Object.freeze(resolutions) });
}

function exactDuplicateObservations(input: TopologyContextDiagnosticInput): DiagnosticObservationInput[] {
  const current = input.subscriptions
    .filter((subscription) => subscription.activeAtBoundary && configurationAvailable(subscription.configuration))
    .sort((left, right) => left.affected.subscriptionId.localeCompare(right.affected.subscriptionId));
  const observations: DiagnosticObservationInput[] = [];
  for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
      const left = current[leftIndex]!;
      const right = current[rightIndex]!;
      if (!sameScope(left, right) || semanticConfigurationSignature(left.configuration) !== semanticConfigurationSignature(right.configuration)) continue;
      const ids = [left.affected.subscriptionId, right.affected.subscriptionId].sort();
      const exact = configurationSignature(left.configuration) === configurationSignature(right.configuration);
      const evidence = laterEvidence(left.evidence, right.evidence);
      const lifecycle = left.current && right.current
        ? { kind: "condition" as const, conditionId: `${ids[0]}:${ids[1]}` }
        : { kind: "occurrence" as const, occurrenceId: `${evidence.eventId}:${ids[0]}:${ids[1]}` };
      const differing = differingConfiguration(left.configuration, right.configuration);
      observations.push(normalizeDiagnosticObservationInput({
        code: exact ? "ls.subscription.exact-duplicate" : "ls.subscription.semantic-overlap",
        ruleVersion: 1,
        severity: "information",
        lifecycle,
        affected: ids[0] === left.affected.subscriptionId ? left.affected : right.affected,
        observedAt: input.boundary.observedAt,
        evidenceBoundary: evidence,
        observed: exact
          ? `Subscriptions \`${ids[0]}\` and \`${ids[1]}\` are active exact duplicates. Matching configuration: mode, item/field descriptors, Data Adapter, selector, snapshot, frequency, buffer, and second-level settings.`
          : `Subscriptions \`${ids[0]}\` and \`${ids[1]}\` overlap semantically. Matching configuration: mode, items, fields, Data Adapter, selector. Differing configuration: ${differing.join(", ")}.`,
        limitation: exact
          ? "This comparison uses immutable committed topology facts and does not infer why the application created either Subscription."
          : "This is an informational comparison; the differing requests may be intentional and Workbench does not infer application intent.",
        consequence: exact
          ? "The same semantic Subscription configuration is active more than once and may produce separate deliveries."
          : "The active Subscriptions address the same semantic stream with different delivery or second-level requests.",
        route: { kind: "inspect-evidence", evidence },
        resultRef: { kind: "evidence", ...evidence }
      }));
    }
  }
  return observations;
}

function sameScope(left: TopologySubscriptionFact, right: TopologySubscriptionFact): boolean {
  return left.affected.pageId === right.affected.pageId &&
    left.affected.clientId === right.affected.clientId &&
    left.affected.sessionId !== undefined &&
    left.affected.sessionId === right.affected.sessionId;
}

function configurationAvailable(configuration: TopologySubscriptionConfiguration): boolean {
  return Object.values(configuration).every((value) =>
    !(typeof value === "object" && value !== null && value.kind === "unavailable"));
}

function configurationSignature(configuration: TopologySubscriptionConfiguration): string {
  return JSON.stringify(configuration);
}

function semanticConfigurationSignature(configuration: TopologySubscriptionConfiguration): string {
  return JSON.stringify({
    mode: configuration.mode,
    items: configuration.items,
    fields: configuration.fields,
    dataAdapter: configuration.dataAdapter,
    selector: configuration.selector
  });
}

function differingConfiguration(
  left: TopologySubscriptionConfiguration,
  right: TopologySubscriptionConfiguration
): string[] {
  const candidates = [
    ["requested snapshot", left.requestedSnapshot, right.requestedSnapshot],
    ["requested maximum frequency", left.requestedMaxFrequency, right.requestedMaxFrequency],
    ["requested buffer size", left.requestedBufferSize, right.requestedBufferSize],
    ["second-level fields", left.secondLevelFields, right.secondLevelFields],
    ["second-level Data Adapter", left.secondLevelDataAdapter, right.secondLevelDataAdapter]
  ] as const;
  return candidates.flatMap(([label, leftValue, rightValue]) =>
    JSON.stringify(leftValue) === JSON.stringify(rightValue) ? [] : [label]);
}

function laterEvidence(left: DiagnosticEvidenceBoundary, right: DiagnosticEvidenceBoundary): DiagnosticEvidenceBoundary {
  return left.intervalId === right.intervalId && right.sequence > left.sequence ? right : left;
}
