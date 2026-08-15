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
    .filter((subscription) => subscription.current && subscription.activeAtBoundary && configurationAvailable(subscription.configuration))
    .sort((left, right) => left.affected.subscriptionId.localeCompare(right.affected.subscriptionId));
  const observations: DiagnosticObservationInput[] = [];
  for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
      const left = current[leftIndex]!;
      const right = current[rightIndex]!;
      if (!sameScope(left, right) || configurationSignature(left.configuration) !== configurationSignature(right.configuration)) continue;
      const ids = [left.affected.subscriptionId, right.affected.subscriptionId].sort();
      observations.push(normalizeDiagnosticObservationInput({
        code: "ls.subscription.exact-duplicate",
        ruleVersion: 1,
        severity: "information",
        lifecycle: { kind: "condition", conditionId: `${ids[0]}:${ids[1]}` },
        affected: ids[0] === left.affected.subscriptionId ? left.affected : right.affected,
        observedAt: input.boundary.observedAt,
        evidenceBoundary: laterEvidence(left.evidence, right.evidence),
        observed: `Subscriptions \`${ids[0]}\` and \`${ids[1]}\` are active exact duplicates. Matching configuration: mode, item/field descriptors, Data Adapter, selector, snapshot, frequency, buffer, and second-level settings.`,
        limitation: "This comparison uses immutable committed topology facts and does not infer why the application created either Subscription.",
        consequence: "The same semantic Subscription configuration is active more than once and may produce separate deliveries.",
        route: { kind: "inspect-evidence", evidence: laterEvidence(left.evidence, right.evidence) },
        resultRef: { kind: "evidence", ...laterEvidence(left.evidence, right.evidence) }
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

function laterEvidence(left: DiagnosticEvidenceBoundary, right: DiagnosticEvidenceBoundary): DiagnosticEvidenceBoundary {
  return left.intervalId === right.intervalId && right.sequence > left.sequence ? right : left;
}
