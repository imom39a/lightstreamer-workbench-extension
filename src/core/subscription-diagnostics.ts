import type {
  DiagnosticAffectedIdentity,
  DiagnosticConditionResolution,
  DiagnosticEvidenceBoundary,
  DiagnosticObservationInput
} from "./diagnostic-observation";
import {
  DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH,
  DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH,
  diagnosticObservationIdentity,
  normalizeDiagnosticObservationInput
} from "./diagnostic-observation";

export type SubscriptionMode = "MERGE" | "DISTINCT" | "RAW" | "COMMAND";

export type CaptureProvenance = Readonly<{
  source: "getter" | "constructor" | "setter" | "listener" | "topology";
  capturedAt: number;
  evidence?: DiagnosticEvidenceBoundary;
}>;

export type CapturedValue<T> =
  | Readonly<{ kind: "available"; value: T; provenance: CaptureProvenance }>
  | Readonly<{ kind: "unavailable"; reason: string; provenance: CaptureProvenance }>
  | Readonly<{ kind: "not-applicable"; reason: string; provenance: CaptureProvenance }>;

export function available<const T>(value: T, provenance: CaptureProvenance): CapturedValue<T> {
  return Object.freeze({ kind: "available", value, provenance: freezeProvenance(provenance) });
}

export type CapturedDescriptor =
  | Readonly<{ kind: "list"; values: readonly string[]; provenance: CaptureProvenance }>
  | Readonly<{ kind: "schema"; name: string; provenance: CaptureProvenance }>
  | Readonly<{ kind: "unset"; provenance: CaptureProvenance }>
  | Readonly<{ kind: "unavailable"; reason: string; provenance: CaptureProvenance }>;

export type SubscriptionDiagnosticError = Readonly<{
  level: "first" | "second";
  code: number;
  safeMessage: string;
  key?: string;
  epoch: string;
  evidence: DiagnosticEvidenceBoundary;
}>;

export type SubscriptionConfigurationAttempt = Readonly<{
  kind: "raw-snapshot" | "command-key-missing" | "command-command-missing";
  occurrenceId: string;
  evidence?: DiagnosticEvidenceBoundary;
}>;

export type RelatedSubscriptionLatch = Readonly<{
  affected: Extract<DiagnosticAffectedIdentity, Readonly<{ kind: "subscription" }>>;
  current: boolean;
  sessionId: CapturedValue<string>;
  adapterSet: CapturedValue<string>;
  dataAdapter: CapturedValue<string | null>;
  mode: CapturedValue<SubscriptionMode>;
  items: CapturedDescriptor;
  active: CapturedValue<boolean>;
  establishmentEpoch: string;
}>;

export type SubscriptionDiagnosticInput = Readonly<{
  boundary: Readonly<{ id: string; observedAt: number; sequence: number; evidence?: DiagnosticEvidenceBoundary }>;
  affected: Extract<DiagnosticAffectedIdentity, Readonly<{ kind: "subscription" }>>;
  configuration: Readonly<{
    mode: CapturedValue<SubscriptionMode>;
    items: CapturedDescriptor;
    fields: CapturedDescriptor;
    dataAdapter: CapturedValue<string | null>;
    requestedSnapshot: CapturedValue<string | number | null>;
    requestedBufferSize: CapturedValue<number | "unlimited" | null>;
    requestedMaxFrequency: CapturedValue<number | "unlimited" | "unfiltered" | null>;
    secondLevelFields: CapturedDescriptor;
    secondLevelDataAdapter: CapturedValue<string | null>;
    sessionId: CapturedValue<string>;
    adapterSet: CapturedValue<string>;
  }>;
  runtimeState: Readonly<{
    establishmentEpoch: string;
    active: CapturedValue<boolean>;
    subscribed: CapturedValue<boolean>;
    realMaxFrequency: Readonly<{ value: number | "unlimited"; epoch: string; evidence?: DiagnosticEvidenceBoundary }> | null;
    errors: readonly SubscriptionDiagnosticError[];
    configurationAttempts: readonly SubscriptionConfigurationAttempt[];
  }>;
  coverage: Readonly<{ kind: "useful" | "limited" | "unavailable"; reason?: string }>;
  historical: boolean;
  relatedSubscriptions: readonly RelatedSubscriptionLatch[];
}>;

export const SUBSCRIPTION_DIAGNOSTIC_RULE_CODES = Object.freeze({
  rawSnapshotUnavailable: "ls.sub.raw-snapshot-unavailable",
  bufferNotApplicableMode: "ls.sub.buffer-not-applicable-mode",
  bufferNotApplicableUnfiltered: "ls.sub.buffer-not-applicable-unfiltered",
  mergeUnlimitedBufferRisk: "ls.sub.merge-unlimited-buffer-risk",
  distinctBoundedBufferRisk: "ls.sub.distinct-bounded-buffer-risk",
  commandKeyMissing: "ls.sub.command-key-missing",
  commandCommandMissing: "ls.sub.command-command-missing",
  secondLevelFieldNameConflict: "ls.sub.2l-field-name-conflict",
  secondLevelInvalidItem: "ls.sub.2l-invalid-item",
  secondLevelDataAdapterRefused: "ls.sub.2l-data-adapter-refused",
  secondLevelGroupSchemaRefused: "ls.sub.2l-group-schema-refused",
  secondLevelModeRefused: "ls.sub.2l-mode-refused",
  activeNotEstablished: "ls.sub.active-not-established",
  unfilteredRefused: "ls.sub.unfiltered-refused",
  secondLevelUnfilteredRefused: "ls.sub.2l-unfiltered-refused",
  applicationRefused: "ls.sub.application-refused",
  unfilteredActuallyLimited: "ls.sub.unfiltered-actually-limited",
  nonRawModeOverlap: "ls.sub.nonraw-mode-overlap"
} as const);

type RuleCode = typeof SUBSCRIPTION_DIAGNOSTIC_RULE_CODES[keyof typeof SUBSCRIPTION_DIAGNOSTIC_RULE_CODES];

export const SUBSCRIPTION_DIAGNOSTIC_RULE_CLASSIFICATION: Readonly<Record<RuleCode, "exact" | "heuristic">> = Object.freeze({
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.rawSnapshotUnavailable]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.bufferNotApplicableMode]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.bufferNotApplicableUnfiltered]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.mergeUnlimitedBufferRisk]: "heuristic",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.distinctBoundedBufferRisk]: "heuristic",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandKeyMissing]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandCommandMissing]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelFieldNameConflict]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelInvalidItem]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelDataAdapterRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelGroupSchemaRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelModeRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.activeNotEstablished]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.unfilteredRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelUnfilteredRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.applicationRefused]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.unfilteredActuallyLimited]: "exact",
  [SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.nonRawModeOverlap]: "heuristic"
});

export function lintSubscription(input: SubscriptionDiagnosticInput): readonly DiagnosticObservationInput[] {
  const observations: DiagnosticObservationInput[] = [];
  const mode = valueOf(input.configuration.mode);
  const buffer = valueOf(input.configuration.requestedBufferSize);
  const frequency = valueOf(input.configuration.requestedMaxFrequency);

  if (mode === "RAW") observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.rawSnapshotUnavailable,
    "information", "RAW mode has no snapshot capability at the captured boundary.",
    snapshotLimitation(input), "No snapshot Evidence can be produced for this RAW Subscription."));
  if ((mode === "RAW" || mode === "COMMAND") && buffer !== undefined && buffer !== null) {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.bufferNotApplicableMode,
      "information", `Captured requested buffer is \`${String(buffer)}\` for ${mode} mode.`,
      "The request is retained configuration; this does not say the setter failed.",
      "The requested buffer does not govern this mode; the server buffer is unlimited subject to robustness protection."));
  }
  if ((mode === "MERGE" || mode === "DISTINCT") && buffer !== undefined && buffer !== null && frequency === "unfiltered") {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.bufferNotApplicableUnfiltered,
      "information", `Captured requested buffer is \`${String(buffer)}\` with unfiltered dispatching.`,
      "The captured request does not prove the server accepted unfiltered dispatching.",
      "The requested buffer does not constrain unfiltered dispatching."));
  }
  if (mode === "MERGE" && buffer === "unlimited" && frequency !== undefined && frequency !== "unfiltered") {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.mergeUnlimitedBufferRisk,
      "warning", "Captured requested buffer is `unlimited` for filtered MERGE dispatching.",
      "This is advisory: Workbench did not observe server queue occupancy, inbound rate, or the server robustness limit.",
      "An unlimited MERGE buffer can accumulate delay and memory pressure when inbound rate stays above dispatch rate."));
  }
  if (mode === "DISTINCT" && typeof buffer === "number" && Number.isSafeInteger(buffer) && buffer > 0 && frequency !== undefined && frequency !== "unfiltered") {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.distinctBoundedBufferRisk,
      "information", `Captured requested buffer is \`${buffer}\` for filtered DISTINCT dispatching.`,
      "This is advisory: Workbench did not observe application loss tolerance, supplier rate, or queue occupancy.",
      "Buffer overflow can silently suppress DISTINCT events."));
  }

  addConfigurationAttempts(input, observations);
  addFieldConflict(input, observations);
  addStateRules(input, observations, frequency);
  addErrors(input, observations);
  addOverlapRules(input, observations, mode);
  return Object.freeze(uniqueObservations(observations));
}

export function reconcileSubscriptionDiagnostics(
  input: SubscriptionDiagnosticInput,
  previouslyActive: readonly DiagnosticObservationInput[]
): SubscriptionDiagnosticReconciliation {
  const observations = lintSubscription(input);
  const currentConditions = new Set(observations.flatMap((observation) =>
    observation.lifecycle.kind === "condition" ? [diagnosticObservationIdentity(observation)] : []));
  const resolutions = previouslyActive.flatMap((observation): DiagnosticConditionResolution[] => {
    if (observation.lifecycle.kind !== "condition" || currentConditions.has(diagnosticObservationIdentity(observation))) return [];
    return [Object.freeze({
      code: observation.code,
      ruleVersion: observation.ruleVersion,
      conditionId: observation.lifecycle.conditionId,
      affected: observation.affected,
      observedAt: input.boundary.observedAt,
      evidenceBoundary: input.boundary.evidence
    })];
  });
  return Object.freeze({ observations, resolutions: Object.freeze(uniqueResolutions(resolutions)) });
}

function addConfigurationAttempts(input: SubscriptionDiagnosticInput, observations: DiagnosticObservationInput[]): void {
  const codes = {
    "raw-snapshot": SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.rawSnapshotUnavailable,
    "command-key-missing": SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandKeyMissing,
    "command-command-missing": SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandCommandMissing
  } as const;
  const facts = {
    "raw-snapshot": "The official client locally rejected a RAW snapshot configuration attempt.",
    "command-key-missing": "The official client locally rejected an explicit COMMAND Field List without `key`.",
    "command-command-missing": "The official client locally rejected an explicit COMMAND Field List without `command`."
  } as const;
  for (const attempt of input.runtimeState.configurationAttempts) {
    observations.push(occurrence(input, codes[attempt.kind], attempt.occurrenceId, facts[attempt.kind],
      "This finding describes only the captured configuration attempt.",
      attempt.kind === "raw-snapshot" ? "RAW cannot produce snapshot Evidence." : "The attempted COMMAND configuration cannot be established.",
      attempt.evidence));
  }
}

function addFieldConflict(input: SubscriptionDiagnosticInput, observations: DiagnosticObservationInput[]): void {
  const first = input.configuration.fields;
  const second = input.configuration.secondLevelFields;
  if (first.kind !== "list" || second.kind !== "list") return;
  const secondNames = new Set(second.values);
  for (const field of new Set(first.values.filter((name) => secondNames.has(name)))) {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelFieldNameConflict,
      "warning", `Captured first- and second-level Field Lists both contain \`${field}\`.`,
      "This exact name-access conflict does not make the Subscription invalid.",
      "Name lookup resolves to the first-level field; access to the second-level field requires its position.", field));
  }
}

function addStateRules(
  input: SubscriptionDiagnosticInput,
  observations: DiagnosticObservationInput[],
  frequency: number | "unlimited" | "unfiltered" | null | undefined
): void {
  if (valueOf(input.runtimeState.active) === true && valueOf(input.runtimeState.subscribed) === false) {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.activeNotEstablished,
      "information", `Client-active; not server-established at boundary ${input.boundary.sequence}.`,
      "This may be normal pending, disconnect/recovery, or refusal; duration and cause require adjacent Evidence.",
      "Updates are not currently established for this Subscription."));
  }
  const real = input.runtimeState.realMaxFrequency;
  if (frequency === "unfiltered" && real && real.epoch === input.runtimeState.establishmentEpoch &&
      typeof real.value === "number" && Number.isFinite(real.value) && real.value >= 0) {
    observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.unfilteredActuallyLimited,
      "warning", `Server reported a finite Subscription-level maximum frequency of ${real.value}.`,
      "This is an applied Subscription-level limit, not a measured per-item update rate; its cause is unknown without refusal or server Evidence.",
      "The established Subscription is limited despite the captured unfiltered request."));
  }
}

function addErrors(input: SubscriptionDiagnosticInput, observations: DiagnosticObservationInput[]): void {
  for (const error of input.runtimeState.errors) {
    if (error.epoch !== input.runtimeState.establishmentEpoch) continue;
    const code = errorRuleCode(error);
    if (!code) continue;
    const affected = error.level === "second" && error.key !== undefined
      ? Object.freeze({ kind: "item" as const, pageId: input.affected.pageId, clientId: input.affected.clientId,
        subscriptionId: input.affected.subscriptionId, item: error.key })
      : input.affected;
    const detail = code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelDataAdapterRefused
      ? adapterContext(input.configuration.secondLevelDataAdapter)
      : "The callback establishes only this refusal occurrence and its captured scope.";
    observations.push(occurrence(input, code, `${error.epoch}:${error.evidence.eventId}`,
      errorFact(code, error.code, error.key), detail, errorConsequence(code), error.evidence,
      affected, error.code, boundedText(error.safeMessage, DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH)));
  }
}

function errorRuleCode(error: SubscriptionDiagnosticError): RuleCode | null {
  if (error.code <= 0) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.applicationRefused;
  if (error.level === "first") {
    if (error.code === 15) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandKeyMissing;
    if (error.code === 16) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandCommandMissing;
    if (error.code >= 26 && error.code <= 28) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.unfilteredRefused;
    return null;
  }
  if (error.code === 14) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelInvalidItem;
  if (error.code === 17) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelDataAdapterRefused;
  if (error.code >= 21 && error.code <= 23) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelGroupSchemaRefused;
  if (error.code === 24) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelModeRefused;
  if (error.code >= 26 && error.code <= 28) return SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelUnfilteredRefused;
  return null;
}

function errorFact(code: RuleCode, originalCode: number, key?: string): string {
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandKeyMissing) return "Server reported that the expanded COMMAND schema has no key field (15).";
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.commandCommandMissing) return "Server reported that the expanded COMMAND schema has no command field (16).";
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.applicationRefused) return `Metadata Adapter refused the request with application-defined code ${originalCode}.`;
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.unfilteredRefused) return `Server refused unfiltered dispatching (${originalCode}).`;
  return `Server refused the implicit second-level item${key === undefined ? "" : ` for key \`${key}\``} (${originalCode}).`;
}

function errorConsequence(code: RuleCode): string {
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelInvalidItem) return "This key cannot be used as the implicit literal second-level item name; other keys are not implicated.";
  if (code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.secondLevelUnfilteredRefused) return "Inherited unfiltered dispatching was refused for this key only.";
  if (code.startsWith("ls.sub.2l-")) return "The implicit second-level Subscription was not established for this key.";
  return "The requested Subscription was not established by this callback.";
}

function adapterContext(adapter: CapturedValue<string | null>): string {
  if (adapter.kind !== "available") return `Second-level Data Adapter is unavailable: ${adapter.reason}; Workbench did not substitute DEFAULT.`;
  return adapter.value === null
    ? "Captured second-level Data Adapter request is null; Workbench does not substitute or assert DEFAULT."
    : `Captured second-level Data Adapter is \`${adapter.value}\`.`;
}

function addOverlapRules(
  input: SubscriptionDiagnosticInput,
  observations: DiagnosticObservationInput[],
  mode: SubscriptionMode | undefined
): void {
  if (input.historical || mode === undefined || mode === "RAW" || valueOf(input.runtimeState.active) !== true) return;
  const session = valueOf(input.configuration.sessionId);
  const adapterSet = valueOf(input.configuration.adapterSet);
  const adapter = valueOf(input.configuration.dataAdapter);
  const items = input.configuration.items;
  if (session === undefined || adapterSet === undefined || adapter === undefined || items.kind !== "list") return;
  for (const peer of input.relatedSubscriptions) {
    const peerMode = valueOf(peer.mode);
    if (!peer.current || peerMode === undefined || peerMode === "RAW" || peerMode === mode || valueOf(peer.active) !== true ||
        valueOf(peer.sessionId) !== session || valueOf(peer.adapterSet) !== adapterSet || valueOf(peer.dataAdapter) !== adapter ||
        peer.items.kind !== "list") continue;
    const peerItems = new Set(peer.items.values);
    for (const item of new Set(items.values.filter((name) => peerItems.has(name)))) {
      observations.push(condition(input, SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.nonRawModeOverlap,
        "information", `Suspicious overlap: current active ${mode} and ${peerMode} Subscriptions contain literal item \`${item}\`.`,
        "This is advisory: authorization, refusal, timing, or incomplete capture may explain the overlap; Workbench does not declare either Subscription wrong.",
        "The server model assigns an item to one non-RAW mode family within the same Session, Adapter Set, and Data Adapter.",
        `${peer.affected.subscriptionId}:${peer.establishmentEpoch}:${item}`));
    }
  }
}

function occurrence(
  input: SubscriptionDiagnosticInput,
  code: RuleCode,
  occurrenceId: string,
  observed: string,
  limitation: string,
  consequence: string,
  evidenceBoundary?: DiagnosticEvidenceBoundary,
  affected: DiagnosticAffectedIdentity = input.affected,
  originalCode?: number,
  safeMessage?: string
): DiagnosticObservationInput {
  return normalizeDiagnosticObservationInput({
    code, ruleVersion: 1, severity: code === SUBSCRIPTION_DIAGNOSTIC_RULE_CODES.rawSnapshotUnavailable ? "information" : "error",
    lifecycle: { kind: "occurrence", occurrenceId: boundedIdentity(occurrenceId) }, affected, observedAt: input.boundary.observedAt,
    evidenceBoundary, observed, limitation, consequence,
    route: evidenceBoundary ? { kind: "inspect-evidence", evidence: evidenceBoundary } : { kind: "inspect-affected" },
    resultRef: evidenceBoundary ? { kind: "evidence", ...evidenceBoundary } : undefined,
    originalCode, safeMessage
  });
}

function uniqueObservations(observations: DiagnosticObservationInput[]): DiagnosticObservationInput[] {
  const unique = new Map<string, DiagnosticObservationInput>();
  for (const observation of observations) unique.set(diagnosticObservationIdentity(observation), observation);
  return [...unique.values()];
}

function uniqueResolutions(resolutions: DiagnosticConditionResolution[]): DiagnosticConditionResolution[] {
  const unique = new Map<string, DiagnosticConditionResolution>();
  for (const resolution of resolutions) unique.set(`${resolution.code}:${resolution.conditionId}:${JSON.stringify(resolution.affected)}`, resolution);
  return [...unique.values()];
}

function boundedIdentity(value: string): string {
  if ([...value].length <= DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH) return value;
  const suffix = stableHash(value);
  return `${[...value].slice(0, DIAGNOSTIC_IDENTITY_COMPONENT_MAX_LENGTH - suffix.length - 1).join("")}:${suffix}`;
}

function boundedText(value: string, maximum: number): string {
  return [...value].slice(0, maximum).join("");
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function condition(
  input: SubscriptionDiagnosticInput,
  code: RuleCode,
  severity: DiagnosticObservationInput["severity"],
  observed: string,
  limitation: string,
  consequence: string,
  suffix = ""
): DiagnosticObservationInput {
  return normalizeDiagnosticObservationInput({
    code,
    ruleVersion: 1,
    severity,
    lifecycle: { kind: "condition", conditionId: conditionIdentity(input, suffix) },
    affected: input.affected,
    observedAt: input.boundary.observedAt,
    evidenceBoundary: input.boundary.evidence,
    observed,
    limitation,
    consequence,
    route: { kind: "inspect-affected" }
  });
}

function conditionIdentity(input: SubscriptionDiagnosticInput, suffix: string): string {
  return boundedIdentity([input.affected.subscriptionId, input.runtimeState.establishmentEpoch, suffix].filter(Boolean).join(":"));
}

function snapshotLimitation(input: SubscriptionDiagnosticInput): string {
  return input.configuration.requestedSnapshot.kind === "unavailable"
    ? `Snapshot preference is unavailable: ${input.configuration.requestedSnapshot.reason}.`
    : "Snapshot preference is supporting configuration only; RAW mode capability is exact.";
}

function valueOf<T>(captured: CapturedValue<T>): T | undefined {
  return captured.kind === "available" ? captured.value : undefined;
}

function freezeProvenance(provenance: CaptureProvenance): CaptureProvenance {
  return Object.freeze({
    source: provenance.source,
    capturedAt: provenance.capturedAt,
    evidence: provenance.evidence ? Object.freeze({ ...provenance.evidence }) : undefined
  });
}

export type SubscriptionDiagnosticReconciliation = Readonly<{
  observations: readonly DiagnosticObservationInput[];
  resolutions: readonly DiagnosticConditionResolution[];
}>;
