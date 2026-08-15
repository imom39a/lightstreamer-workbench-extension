import type {
  DiagnosticAffectedIdentity,
  DiagnosticConditionResolution,
  DiagnosticEvidenceBoundary,
  DiagnosticObservationInput
} from "./diagnostic-observation";
import {
  DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH,
  DIAGNOSTIC_TEXT_MAX_LENGTH,
  diagnosticObservationIdentity,
  normalizeDiagnosticObservationInput
} from "./diagnostic-observation";

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
  | "future-evidence-retention"
  | "history-after-terminal-boundary"
  | "snapshot-state"
  | "update-delivery-attribution"
  | "pre-attachment-churn";

type TopologyCoverageLimitationBase = Readonly<{
  id: string;
  affected: DiagnosticAffectedIdentity;
  current: boolean;
  detail: string;
  weakens: readonly DiagnosticConclusion[];
  evidence?: DiagnosticEvidenceBoundary;
}>;

export type TopologyCoverageLimitation =
  | TopologyCoverageLimitationBase & Readonly<{ kind: "late-attachment"; attachedAt: number }>
  | TopologyCoverageLimitationBase & Readonly<{ kind: "observation-path"; path: "wire" | "unknown" }>
  | TopologyCoverageLimitationBase & Readonly<{ kind: "history-capacity"; state: "lower-capacity" | "terminal" }>
  | TopologyCoverageLimitationBase & Readonly<{ kind: "unsupported-shape"; shape: string }>;

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

export const MAX_DIAGNOSTIC_CHURN_WINDOW_MS = 60_000;
export const MAX_RETAINED_DIAGNOSTIC_CHANGES = 100;
export const TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES = Object.freeze({
  exactDuplicate: "ls.subscription.exact-duplicate",
  semanticOverlap: "ls.subscription.semantic-overlap",
  listenerChurn: "ls.listener.registration-churn",
  subscriptionChurn: "ls.subscription.lifecycle-churn",
  lateAttachment: "workbench.capture.late-attachment",
  observationPathLimited: "workbench.capture.observation-path-limited",
  lowerHistoryCapacity: "workbench.history.lower-capacity",
  terminalHistory: "workbench.history.terminal",
  unsupportedShape: "workbench.capture.unsupported-shape"
} as const);

export function evaluateTopologyContextDiagnostics(
  input: TopologyContextDiagnosticInput,
  previouslyActive: readonly DiagnosticObservationInput[] = []
): TopologyContextDiagnosticEvaluation {
  const observations = uniqueObservations([
    ...subscriptionComparisonObservations(input),
    ...churnObservations(input),
    ...limitationObservations(input)
  ]);
  const active = new Set(observations.flatMap((observation) =>
    observation.lifecycle.kind === "condition" ? [diagnosticObservationIdentity(observation)] : []));
  const resolutions = previouslyActive.flatMap((observation): DiagnosticConditionResolution[] => {
    if (!isOwnedCode(observation.code) || observation.lifecycle.kind !== "condition" || active.has(diagnosticObservationIdentity(observation))) return [];
    return [Object.freeze({
      code: observation.code,
      ruleVersion: observation.ruleVersion,
      conditionId: observation.lifecycle.conditionId,
      affected: observation.affected,
      observedAt: input.boundary.observedAt,
      evidenceBoundary: input.boundary.evidence
    })];
  });
  return Object.freeze({ observations: Object.freeze(observations), resolutions: Object.freeze(uniqueResolutions(resolutions)) });
}

function limitationObservations(input: TopologyContextDiagnosticInput): DiagnosticObservationInput[] {
  const observations: DiagnosticObservationInput[] = [];
  for (const limitation of input.limitations) {
    const weakened = [...new Set(limitation.weakens.filter((conclusion) => permittedConclusion(limitation, conclusion)))].sort();
    if (weakened.length === 0) continue;
    const semantics = limitationSemantics(limitation);
    const lifecycle = limitation.current
      ? { kind: "condition" as const, conditionId: limitation.id }
      : { kind: "occurrence" as const, occurrenceId: limitation.id };
    observations.push(normalized({
      code: semantics.code,
      ruleVersion: 1,
      severity: semantics.severity,
      lifecycle,
      affected: limitation.affected,
      observedAt: input.boundary.observedAt,
      evidenceBoundary: limitation.evidence,
      observed: semantics.observed,
      limitation: `This limitation weakens only: ${weakened.join(", ")}. It does not globally degrade unrelated Workbench conclusions.`,
      consequence: `Workbench cannot treat ${weakened.join(", ")} as complete at this boundary.`,
      route: limitation.evidence ? { kind: "inspect-evidence", evidence: limitation.evidence } : { kind: "inspect-affected" },
      resultRef: limitation.evidence ? { kind: "evidence", ...limitation.evidence } : undefined
    }));
  }
  return observations;
}

function permittedConclusion(limitation: TopologyCoverageLimitation, conclusion: DiagnosticConclusion): boolean {
  switch (limitation.kind) {
    case "late-attachment": return conclusion === "pre-attachment-churn" || conclusion === "topology-completeness" ||
      conclusion === "listener-presence" || conclusion === "subscription-configuration" || conclusion === "snapshot-state";
    case "observation-path": return conclusion === "listener-presence" || conclusion === "subscription-configuration" ||
      conclusion === "topology-completeness" || conclusion === "snapshot-state" || conclusion === "update-delivery-attribution";
    case "history-capacity": return limitation.state === "terminal"
      ? conclusion === "history-after-terminal-boundary"
      : conclusion === "future-evidence-retention";
    case "unsupported-shape": return conclusion !== "history-after-terminal-boundary" && conclusion !== "future-evidence-retention";
  }
}

function limitationSemantics(limitation: TopologyCoverageLimitation): Readonly<{
  code: string;
  severity: "information" | "warning" | "error";
  observed: string;
}> {
  switch (limitation.kind) {
    case "late-attachment": return {
      code: TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.lateAttachment,
      severity: "information",
      observed: `Capture attached at ${limitation.attachedAt}; ${limitation.detail}`
    };
    case "observation-path": return {
      code: TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.observationPathLimited,
      severity: "information",
      observed: `Captured observation path is ${limitation.path}; ${limitation.detail}`
    };
    case "history-capacity": return limitation.state === "terminal" ? {
      code: TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.terminalHistory,
      severity: "error",
      observed: `Event History reached its terminal committed boundary; ${limitation.detail}`
    } : {
      code: TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.lowerHistoryCapacity,
      severity: "information",
      observed: `Event History is using the lower-capacity tier; ${limitation.detail}`
    };
    case "unsupported-shape": return {
      code: TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.unsupportedShape,
      severity: "warning",
      observed: `Captured shape \`${limitation.shape}\` is unsupported; ${limitation.detail}`
    };
  }
}

function churnObservations(input: TopologyContextDiagnosticInput): DiagnosticObservationInput[] {
  const observations: DiagnosticObservationInput[] = [];
  for (const window of input.churnWindows) {
    const duration = window.endedAt - window.startedAt;
    const ageAtBoundary = input.boundary.observedAt - window.endedAt;
    if (!Number.isSafeInteger(window.threshold) || window.threshold <= 0 ||
        !Number.isSafeInteger(window.totalChanges) || window.totalChanges < window.threshold ||
        !Number.isSafeInteger(duration) || duration < 0 || duration > MAX_DIAGNOSTIC_CHURN_WINDOW_MS ||
        !Number.isSafeInteger(ageAtBoundary) || ageAtBoundary > MAX_DIAGNOSTIC_CHURN_WINDOW_MS ||
        window.retainedChanges.length === 0 || window.retainedChanges.length > MAX_RETAINED_DIAGNOSTIC_CHANGES) continue;
    const latest = window.retainedChanges.reduce((candidate, change) =>
      change.evidence.intervalId === candidate.evidence.intervalId && change.evidence.sequence > candidate.evidence.sequence
        ? change
        : candidate);
    const code = window.kind === "listener" ? TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.listenerChurn : TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.subscriptionChurn;
    const affectedKey = affectedIdentityKey(window.affected);
    const lifecycle = window.current
      ? { kind: "condition" as const, conditionId: `${window.kind}:${affectedKey}:${window.id}` }
      : { kind: "occurrence" as const, occurrenceId: window.id };
    const completeness = window.complete
      ? "The bounded observation window is complete through its committed Evidence boundary."
      : "The bounded observation window is incomplete, so the captured count is a lower bound.";
    const attachment = window.lateAttachment
      ? " Workbench attached after application startup; earlier changes are unavailable."
      : " Capture was attached for the full stated window.";
    observations.push(normalized({
      code,
      ruleVersion: 1,
      severity: "information",
      lifecycle,
      affected: window.affected,
      observedAt: input.boundary.observedAt,
      evidenceBoundary: latest.evidence,
      observed: `${window.totalChanges} captured add/remove changes from ${window.startedAt} through ${window.endedAt} (${duration} ms), meeting the configured threshold of ${window.threshold}. Window state: ${window.current ? "current condition" : "historical occurrence"}.`,
      limitation: `${completeness}${attachment} Counts describe captured registration activity and do not establish application intent.`,
      consequence: `Repeated ${window.kind === "listener" ? "listener registration" : "Subscription lifecycle"} activity occurred within the stated bounded window.`,
      route: { kind: "inspect-evidence", evidence: latest.evidence },
      resultRef: { kind: "evidence", ...latest.evidence }
    }));
  }
  return observations;
}

function affectedIdentityKey(affected: DiagnosticAffectedIdentity): string {
  switch (affected.kind) {
    case "unavailable": return affected.reason;
    case "page": return affected.pageId;
    case "client": return affected.clientId;
    case "session": return affected.sessionId;
    case "subscription": return affected.subscriptionId;
    case "item": return `${affected.subscriptionId}:${affected.item}`;
    case "evidence": return affected.eventId;
  }
}

function subscriptionComparisonObservations(input: TopologyContextDiagnosticInput): DiagnosticObservationInput[] {
  if (!input.boundary.evidence) return [];
  const current = input.subscriptions
    .filter((subscription) => subscription.activeAtBoundary && configurationAvailable(subscription.configuration))
    .sort((left, right) => left.affected.subscriptionId.localeCompare(right.affected.subscriptionId));
  const observations: DiagnosticObservationInput[] = [];
  for (let leftIndex = 0; leftIndex < current.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < current.length; rightIndex += 1) {
      const left = current[leftIndex]!;
      const right = current[rightIndex]!;
      if (!sameScope(left, right) || semanticConfigurationSignature(left.configuration) !== semanticConfigurationSignature(right.configuration)) continue;
      if (sameAffected(left.affected, right.affected)) continue;
      const ids = [left.affected.subscriptionId, right.affected.subscriptionId].sort();
      const exact = configurationSignature(left.configuration) === configurationSignature(right.configuration);
      const evidence = input.boundary.evidence;
      const lifecycle = left.current && right.current
        ? { kind: "condition" as const, conditionId: `${ids[0]}:${ids[1]}` }
        : { kind: "occurrence" as const, occurrenceId: `historical:${ids[0]}:${ids[1]}` };
      const differing = differingConfiguration(left.configuration, right.configuration);
      const temporalState = left.current && right.current ? "current active" : "historical active-at-boundary";
      observations.push(normalized({
        code: exact ? TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.exactDuplicate : TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES.semanticOverlap,
        ruleVersion: 1,
        severity: "information",
        lifecycle,
        affected: ids[0] === left.affected.subscriptionId ? left.affected : right.affected,
        observedAt: input.boundary.observedAt,
        evidenceBoundary: evidence,
        observed: exact
          ? `Subscriptions \`${ids[0]}\` and \`${ids[1]}\` are ${temporalState} exact duplicates. Matching configuration: mode, item/field descriptors, Data Adapter, selector, snapshot, frequency, buffer, and second-level settings.`
          : `Subscriptions \`${ids[0]}\` and \`${ids[1]}\` have a ${temporalState} semantic overlap. Matching configuration: mode, items, fields, Data Adapter, selector. Differing configuration: ${differing.join(", ")}.`,
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

function sameAffected(left: DiagnosticAffectedIdentity, right: DiagnosticAffectedIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

function normalized(input: DiagnosticObservationInput): DiagnosticObservationInput {
  return normalizeDiagnosticObservationInput({
    ...input,
    lifecycle: input.lifecycle.kind === "condition"
      ? { kind: "condition", conditionId: boundedIdentity(input.lifecycle.conditionId) }
      : { kind: "occurrence", occurrenceId: boundedIdentity(input.lifecycle.occurrenceId) },
    observed: boundedText(input.observed),
    limitation: boundedText(input.limitation),
    consequence: boundedText(input.consequence)
  });
}

function uniqueObservations(observations: readonly DiagnosticObservationInput[]): DiagnosticObservationInput[] {
  const unique = new Map<string, DiagnosticObservationInput>();
  for (const observation of observations) {
    const identity = diagnosticObservationIdentity(observation);
    const existing = unique.get(identity);
    if (!existing || JSON.stringify(observation).localeCompare(JSON.stringify(existing)) < 0) unique.set(identity, observation);
  }
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, observation]) => observation);
}

function uniqueResolutions(resolutions: readonly DiagnosticConditionResolution[]): DiagnosticConditionResolution[] {
  const unique = new Map<string, DiagnosticConditionResolution>();
  for (const resolution of resolutions) unique.set(`${resolution.code}:${resolution.conditionId}:${JSON.stringify(resolution.affected)}`, resolution);
  return [...unique.values()];
}

function isOwnedCode(code: string): boolean {
  return (Object.values(TOPOLOGY_CONTEXT_DIAGNOSTIC_CODES) as readonly string[]).includes(code);
}

function boundedIdentity(value: string): string {
  if ([...value].length <= DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH) return value;
  const suffix = stableHash(value);
  return `${[...value].slice(0, DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH - suffix.length - 1).join("")}:${suffix}`;
}

function boundedText(value: string): string {
  return [...value].slice(0, DIAGNOSTIC_TEXT_MAX_LENGTH).join("");
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
