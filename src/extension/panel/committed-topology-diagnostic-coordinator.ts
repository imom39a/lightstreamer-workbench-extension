import type { CommittedEvidence, HistoryStatus } from "../../core/event-history-authoritative";
import { diagnosticObservationIdentity, type DiagnosticObservationInput } from "../../core/diagnostic-observation";
import {
  available,
  lintSubscription,
  reconcileSubscriptionDiagnostics,
  type CapturedDescriptor,
  type CapturedValue,
  type CaptureProvenance,
  type RelatedSubscriptionLatch,
  type SubscriptionDiagnosticInput,
  type SubscriptionMode
} from "../../core/subscription-diagnostics";
import {
  evaluateTopologyContextDiagnostics,
  MAX_RETAINED_DIAGNOSTIC_CHANGES,
  type TopologyChurnWindow,
  type TopologyContextDiagnosticInput,
  type TopologyCoverageLimitation,
  type DiagnosticConclusion,
  type TopologyDescriptor,
  type TopologyScalar,
  type TopologySubscriptionConfiguration,
  type TopologySubscriptionFact
} from "../../core/topology-context-diagnostics";
import type { LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { TopologyClient, TopologySession, TopologyState, TopologySubscription } from "../../core/topology-state";
import type { SubscriptionDiagnosticProposal } from "../../core/subscription-diagnostic-producer";

export type CommittedTopologyDiagnosticCoordinator = Readonly<{
  apply(
    entry: CommittedEvidence,
    topology: TopologyState,
    pageId: string | null,
    context?: Readonly<{ historyStatus: HistoryStatus }>
  ): readonly SubscriptionDiagnosticProposal[];
  clear(): void;
}>;

type LatchedSubscription = Readonly<{
  client: TopologyClient | null;
  session: TopologySession | null;
  subscription: TopologySubscription;
}>;

type ChurnChange = Readonly<{
  timestamp: number;
  operation: "add" | "remove";
  evidence: Readonly<{ intervalId: string; sequence: number; eventId: string }>;
}>;

const CHURN_THRESHOLD = 6;

/**
 * Owns only configuration/topology diagnostic lifecycle. The caller supplies
 * an immutable projection after accepted Evidence; no page-owned object or
 * React state crosses this boundary.
 */
export function createCommittedTopologyDiagnosticCoordinator(): CommittedTopologyDiagnosticCoordinator {
  const active04 = new Map<string, readonly DiagnosticObservationInput[]>();
  let active05: readonly DiagnosticObservationInput[] = Object.freeze([]);
  const lastCurrent05 = new Map<string, TopologySubscriptionFact>();
  const emittedOccurrences = new Set<string>();
  const errorsBySubscription = new Map<string, SubscriptionDiagnosticInput["runtimeState"]["errors"] extends readonly (infer E)[] ? E[] : never>();
  const realFrequencyBySubscription = new Map<string, NonNullable<SubscriptionDiagnosticInput["runtimeState"]["realMaxFrequency"]>>();
  const churnByKey = new Map<string, ChurnChange[]>();
  let lateAttachment = false;
  let lateAttachmentBoundary: Readonly<{ attachedAt: number; evidence: ReturnType<typeof evidenceBoundary> }> | null = null;
  let wireObservationBoundary: ReturnType<typeof evidenceBoundary> | null = null;

  const clear = (): void => {
    active04.clear();
    active05 = Object.freeze([]);
    lastCurrent05.clear();
    emittedOccurrences.clear();
    errorsBySubscription.clear();
    realFrequencyBySubscription.clear();
    churnByKey.clear();
    lateAttachment = false;
    lateAttachmentBoundary = null;
    wireObservationBoundary = null;
  };

  return Object.freeze({
    apply(entry, topology, pageId, runtimeContext) {
      const boundary = evidenceBoundary(entry);
      const event = isEvent(entry.candidate) ? entry.candidate : null;
      if (event?.topology?.coverage.reason === "late-attachment") {
        lateAttachment = true;
        lateAttachmentBoundary ??= Object.freeze({ attachedAt: event.timestamp, evidence: boundary });
      }
      if (event?.captureSource === "wire") wireObservationBoundary ??= boundary;
      if (event) retainCallbackFacts(event, boundary, topology, errorsBySubscription, realFrequencyBySubscription);
      if (event) retainChurn(event, boundary, churnByKey);
      if (!pageId) return Object.freeze([]);

      const latches = topologySubscriptions(topology);
      const proposals: SubscriptionDiagnosticProposal[] = [];
      const seen = new Set<string>();
      const inputs = latches.map((latch) => subscriptionInput(latch, latches, pageId, entry, errorsBySubscription, realFrequencyBySubscription));
      for (const input of inputs) {
        const subscriptionKey = affectedSubscriptionKey(input.affected);
        seen.add(subscriptionKey);
        const prior = active04.get(subscriptionKey) ?? Object.freeze([]);
        const evaluation = reconcileSubscriptionDiagnostics(input, prior);
        proposals.push(...newObservations(evaluation.observations, prior, emittedOccurrences).map(observeProposal), ...evaluation.resolutions.map(resolveProposal));
        const current = evaluation.observations.filter(({ lifecycle }) => lifecycle.kind === "condition");
        if (current.length) active04.set(subscriptionKey, Object.freeze(current));
        else active04.delete(subscriptionKey);
      }
      for (const [subscriptionKey, prior] of [...active04]) {
        if (seen.has(subscriptionKey)) continue;
        for (const observation of prior) {
          if (observation.lifecycle.kind !== "condition") continue;
          proposals.push(resolveProposal({
            code: observation.code,
            ruleVersion: observation.ruleVersion,
            conditionId: observation.lifecycle.conditionId,
            affected: observation.affected,
            observedAt: event?.timestamp ?? 0,
            evidenceBoundary: boundary
          }));
        }
        active04.delete(subscriptionKey);
      }

      const facts = inputs.map((input, index) => topologyFact(input, latches[index]!.subscription));
      const presentFacts = new Set<string>();
      const committedFacts = facts.map((fact) => {
        const key = affectedSubscriptionKey(fact.affected);
        presentFacts.add(key);
        if (fact.current) {
          lastCurrent05.set(key, fact);
          return fact;
        }
        const saved = lastCurrent05.get(key);
        return saved
          ? Object.freeze({ ...saved, current: false })
          : Object.freeze({ ...fact, activeAtBoundary: false });
      });
      for (const [key, saved] of lastCurrent05) {
        if (!presentFacts.has(key)) committedFacts.push(Object.freeze({ ...saved, current: false }));
      }
      const contextInput: TopologyContextDiagnosticInput = Object.freeze({
        boundary: Object.freeze({ observedAt: event?.timestamp ?? 0, sequence: entry.sequence, evidence: boundary }),
        subscriptions: Object.freeze(committedFacts),
        churnWindows: Object.freeze(churnWindows(churnByKey, latches, pageId, event?.timestamp ?? 0, lateAttachment)),
        limitations: Object.freeze(topologyLimitations(pageId, event, boundary, runtimeContext?.historyStatus, lateAttachmentBoundary, wireObservationBoundary))
      });
      const evaluation = evaluateTopologyContextDiagnostics(contextInput, active05);
      proposals.push(...newObservations(evaluation.observations, active05, emittedOccurrences).map(observeProposal), ...evaluation.resolutions.map(resolveProposal));
      active05 = Object.freeze(evaluation.observations.filter(({ lifecycle }) => lifecycle.kind === "condition"));
      for (const proposal of proposals) {
        if (proposal.kind === "observe" && proposal.observation.lifecycle.kind === "occurrence") {
          emittedOccurrences.add(diagnosticObservationIdentity(proposal.observation));
        }
      }
      return Object.freeze(proposals);
    },
    clear
  });
}

function subscriptionInput(
  latch: LatchedSubscription,
  all: readonly LatchedSubscription[],
  pageId: string,
  entry: CommittedEvidence,
  errors: ReadonlyMap<string, readonly SubscriptionDiagnosticInput["runtimeState"]["errors"][number][]>,
  frequencies: ReadonlyMap<string, NonNullable<SubscriptionDiagnosticInput["runtimeState"]["realMaxFrequency"]>>
): SubscriptionDiagnosticInput {
  const { client, session, subscription } = latch;
  const boundary = evidenceBoundary(entry);
  const observedAt = isEvent(entry.candidate) ? entry.candidate.timestamp : subscription.lastUpdateAt ?? subscription.createdAt;
  const provenance: CaptureProvenance = Object.freeze({ source: "topology", capturedAt: observedAt, evidence: boundary });
  const affected = Object.freeze({
    kind: "subscription" as const,
    pageId,
    clientId: client?.id ?? subscription.clientId ?? "client-unavailable",
    ...(session?.id || subscription.lastSessionId ? { sessionId: session?.id ?? subscription.lastSessionId ?? undefined } : {}),
    subscriptionId: subscription.id
  });
  const mode = capturedMode(subscription.mode, subscription.semanticValueStates?.mode, provenance);
  const configuration = Object.freeze({
    mode,
    items: capturedDescriptor(subscription.configuredItems, subscription.itemGroup, subscription.semanticValueStates?.items, provenance),
    fields: capturedDescriptor(subscription.fields, subscription.fieldSchema, subscription.semanticValueStates?.fields, provenance),
    dataAdapter: capturedNullableString(subscription.dataAdapter, subscription.semanticValueStates?.dataAdapter, provenance),
    requestedSnapshot: capturedSnapshot(subscription.requestedSnapshot, subscription.semanticValueStates?.requestedSnapshot, provenance),
    requestedBufferSize: capturedBuffer(subscription.requestedBufferSize, subscription.semanticValueStates?.requestedBufferSize, provenance),
    requestedMaxFrequency: capturedFrequency(subscription.requestedMaxFrequency, subscription.semanticValueStates?.requestedMaxFrequency, provenance),
    secondLevelFields: capturedDescriptor(subscription.commandSecondLevelFields, subscription.commandSecondLevelFieldSchema, subscription.semanticValueStates?.commandSecondLevelFields, provenance),
    secondLevelDataAdapter: capturedNullableString(subscription.commandSecondLevelDataAdapter, subscription.semanticValueStates?.commandSecondLevelDataAdapter, provenance),
    sessionId: session?.id || subscription.lastSessionId
      ? available<string>((session?.id ?? subscription.lastSessionId) as string, provenance)
      : unavailable<string>("session-id-unavailable", provenance),
    adapterSet: typeof client?.adapterSet === "string"
      ? available(client.adapterSet, provenance)
      : unavailable<string>("adapter-set-unavailable", provenance)
  });
  const epoch = subscription.establishments.at(-1)?.id ?? `${affected.sessionId ?? "session-unavailable"}:${subscription.id}:${subscription.startedAt ?? subscription.createdAt}`;
  const relatedSubscriptions = all.flatMap((candidate): RelatedSubscriptionLatch[] => {
    const relatedInput = subscriptionInputShallow(candidate, pageId, provenance);
    if (affectedSubscriptionKey(relatedInput.affected) === affectedSubscriptionKey(affected)) return [];
    return [relatedInput];
  });
  return Object.freeze({
    boundary: Object.freeze({ id: entry.eventId, observedAt, sequence: entry.sequence, evidence: boundary }),
    affected,
    configuration,
    runtimeState: Object.freeze({
      establishmentEpoch: epoch,
      active: available(subscription.active, provenance),
      subscribed: available(subscription.serverEstablished, provenance),
      realMaxFrequency: frequencies.get(subscription.id) ?? null,
      errors: Object.freeze((errors.get(subscription.id) ?? []).filter((error) => error.epoch === epoch)),
      configurationAttempts: Object.freeze([])
    }),
    coverage: Object.freeze({ kind: "useful" as const }),
    historical: subscription.historical,
    relatedSubscriptions: Object.freeze(relatedSubscriptions)
  });
}

function subscriptionInputShallow(
  latch: LatchedSubscription,
  pageId: string,
  provenance: CaptureProvenance
): RelatedSubscriptionLatch {
  const { client, session, subscription } = latch;
  return Object.freeze({
    affected: Object.freeze({
      kind: "subscription" as const,
      pageId,
      clientId: client?.id ?? subscription.clientId ?? "client-unavailable",
      ...(session?.id || subscription.lastSessionId ? { sessionId: session?.id ?? subscription.lastSessionId ?? undefined } : {}),
      subscriptionId: subscription.id
    }),
    current: !subscription.historical,
    sessionId: session?.id || subscription.lastSessionId ? available<string>((session?.id ?? subscription.lastSessionId) as string, provenance) : unavailable<string>("session-id-unavailable", provenance),
    adapterSet: typeof client?.adapterSet === "string" ? available<string>(client.adapterSet, provenance) : unavailable<string>("adapter-set-unavailable", provenance),
    dataAdapter: capturedNullableString(subscription.dataAdapter, subscription.semanticValueStates?.dataAdapter, provenance),
    mode: capturedMode(subscription.mode, subscription.semanticValueStates?.mode, provenance),
    items: capturedDescriptor(subscription.configuredItems, subscription.itemGroup, subscription.semanticValueStates?.items, provenance),
    active: available(subscription.active, provenance),
    establishmentEpoch: subscription.establishments.at(-1)?.id ?? `${subscription.lastSessionId ?? "session-unavailable"}:${subscription.id}:${subscription.startedAt ?? subscription.createdAt}`
  });
}

function topologyFact(input: SubscriptionDiagnosticInput, subscription: TopologySubscription): TopologySubscriptionFact {
  const scalar = <T>(value: CapturedValue<T>): TopologyScalar<T> => value.kind === "available" ? value.value : Object.freeze({ kind: "unavailable", reason: value.reason });
  const descriptor = (value: CapturedDescriptor): TopologyDescriptor => value.kind === "list"
    ? Object.freeze({ kind: "list", values: value.values })
    : value.kind === "schema"
      ? Object.freeze({ kind: "schema", name: value.name })
      : value.kind === "unset"
        ? Object.freeze({ kind: "unset" })
        : Object.freeze({ kind: "unavailable", reason: value.reason });
  const configuration: TopologySubscriptionConfiguration = Object.freeze({
    mode: scalar(input.configuration.mode),
    items: descriptor(input.configuration.items),
    fields: descriptor(input.configuration.fields),
    dataAdapter: scalar(input.configuration.dataAdapter),
    selector: typeof subscription.selector === "string" || subscription.selector === null
      ? subscription.selector
      : Object.freeze({ kind: "unavailable", reason: unavailableReason(subscription.semanticValueStates?.selector, "selector-unavailable") }),
    requestedSnapshot: scalar(input.configuration.requestedSnapshot),
    requestedMaxFrequency: scalar(input.configuration.requestedMaxFrequency),
    requestedBufferSize: scalar(input.configuration.requestedBufferSize),
    secondLevelFields: descriptor(input.configuration.secondLevelFields),
    secondLevelDataAdapter: scalar(input.configuration.secondLevelDataAdapter)
  });
  return Object.freeze({
    affected: input.affected,
    current: !input.historical && subscription.endedAt === null,
    activeAtBoundary: input.runtimeState.active.kind === "available" && input.runtimeState.active.value,
    configuration,
    evidence: input.boundary.evidence!
  });
}

function topologySubscriptions(topology: TopologyState): LatchedSubscription[] {
  const byId = new Map<string, LatchedSubscription>();
  for (const client of topology.clients) {
    for (const subscription of client.waitingSubscriptions) byId.set(`${client.id}\u0000waiting\u0000${subscription.id}`, Object.freeze({ client, session: null, subscription }));
    for (const session of client.sessions) {
      for (const subscription of session.subscriptions) byId.set(`${client.id}\u0000${session.id ?? session.key}\u0000${subscription.id}`, Object.freeze({ client, session, subscription }));
    }
  }
  for (const subscription of topology.unassignedSubscriptions) byId.set(`unassigned\u0000${subscription.id}`, Object.freeze({ client: null, session: null, subscription }));
  return [...byId.values()].sort((left, right) => left.subscription.id.localeCompare(right.subscription.id));
}

function retainCallbackFacts(
  event: LightstreamerEventEnvelope,
  evidence: Readonly<{ intervalId: string; sequence: number; eventId: string }>,
  topology: TopologyState,
  errors: Map<string, SubscriptionDiagnosticInput["runtimeState"]["errors"][number][]>,
  frequencies: Map<string, NonNullable<SubscriptionDiagnosticInput["runtimeState"]["realMaxFrequency"]>>
): void {
  const subscriptionId = event.subscription?.id;
  if (!subscriptionId) return;
  const latch = topologySubscriptions(topology).find(({ subscription }) => subscription.id === subscriptionId);
  if (!latch) return;
  const epoch = latch.subscription.establishments.at(-1)?.id ?? `${latch.subscription.lastSessionId ?? "session-unavailable"}:${subscriptionId}:${latch.subscription.startedAt ?? latch.subscription.createdAt}`;
  const callback = event.raw?.callback;
  if (event.kind === "subscription-error" || callback === "onCommandSecondLevelSubscriptionError") {
    const args = Array.isArray(event.raw?.args) ? event.raw.args : [];
    const code = typeof args[0] === "number" && Number.isSafeInteger(args[0]) ? args[0] : typeof event.raw?.code === "number" && Number.isSafeInteger(event.raw.code) ? event.raw.code : null;
    if (code !== null) {
      const second = callback === "onCommandSecondLevelSubscriptionError";
      const safeMessage = typeof event.raw?.safeMessage === "string" ? event.raw.safeMessage : "Message unavailable";
      const key = second && typeof args[2] === "string" ? args[2] : undefined;
      const next = errors.get(subscriptionId) ?? [];
      next.push(Object.freeze({ level: second ? "second" : "first", code, safeMessage, ...(key ? { key } : {}), epoch, evidence }));
      while (next.length > 100) next.shift();
      errors.set(subscriptionId, next);
    }
  }
  if (event.kind === "subscription-frequency" && (typeof event.subscription?.realMaxFrequency === "number" || event.subscription?.realMaxFrequency === "unlimited")) {
    frequencies.set(subscriptionId, Object.freeze({ value: event.subscription.realMaxFrequency, epoch, evidence }));
  }
}

function retainChurn(
  event: LightstreamerEventEnvelope,
  evidence: Readonly<{ intervalId: string; sequence: number; eventId: string }>,
  windows: Map<string, ChurnChange[]>
): void {
  const kind = event.kind === "listener-added" || event.kind === "listener-removed"
    ? "listener"
    : event.kind === "subscription-created" || event.kind === "subscription-ended"
      ? "subscription"
      : null;
  if (!kind) return;
  const owner = event.subscription?.id ?? event.client?.id;
  if (!owner) return;
  const key = `${kind}:${owner}`;
  const changes = windows.get(key) ?? [];
  changes.push(Object.freeze({
    timestamp: event.timestamp,
    operation: event.kind === "listener-added" || event.kind === "subscription-created" ? "add" : "remove",
    evidence
  }));
  const cutoff = event.timestamp - 60_000;
  while (changes.length && changes[0]!.timestamp < cutoff) changes.shift();
  while (changes.length > MAX_RETAINED_DIAGNOSTIC_CHANGES) changes.shift();
  windows.set(key, changes);
}

function churnWindows(
  windows: ReadonlyMap<string, readonly ChurnChange[]>,
  latches: readonly LatchedSubscription[],
  pageId: string,
  now: number,
  lateAttachment: boolean
): TopologyChurnWindow[] {
  const output: TopologyChurnWindow[] = [];
  for (const [key, changes] of windows) {
    if (changes.length < CHURN_THRESHOLD) continue;
    const [kind, owner] = key.split(":", 2) as ["listener" | "subscription", string];
    const subscription = latches.find((latch) => latch.subscription.id === owner);
    const affected = subscription
      ? Object.freeze({
          kind: "subscription" as const,
          pageId,
          clientId: subscription.client?.id ?? subscription.subscription.clientId ?? "client-unavailable",
          ...(subscription.session?.id || subscription.subscription.lastSessionId
            ? { sessionId: subscription.session?.id ?? subscription.subscription.lastSessionId ?? undefined }
            : {}),
          subscriptionId: subscription.subscription.id
        })
      : Object.freeze({ kind: "page" as const, pageId });
    output.push(Object.freeze({
      id: `${kind}:${owner}:${changes[0]!.evidence.eventId}`,
      kind,
      affected,
      startedAt: changes[0]!.timestamp,
      endedAt: Math.max(changes.at(-1)!.timestamp, Math.min(now, changes[0]!.timestamp + 60_000)),
      threshold: CHURN_THRESHOLD,
      totalChanges: changes.length,
      retainedChanges: Object.freeze(changes.map(({ operation, evidence }) => Object.freeze({ operation, evidence }))),
      current: true,
      complete: !lateAttachment,
      lateAttachment
    }));
  }
  return output;
}

function topologyLimitations(
  pageId: string,
  event: LightstreamerEventEnvelope | null,
  boundary: ReturnType<typeof evidenceBoundary>,
  historyStatus: HistoryStatus | undefined,
  lateAttachment: Readonly<{ attachedAt: number; evidence: ReturnType<typeof evidenceBoundary> }> | null,
  wireObservation: ReturnType<typeof evidenceBoundary> | null
): TopologyCoverageLimitation[] {
  const affected = Object.freeze({ kind: "page" as const, pageId });
  const limitations: TopologyCoverageLimitation[] = [];
  if (lateAttachment) {
    limitations.push(Object.freeze({
      id: `late-attachment:${lateAttachment.evidence.intervalId}`,
      kind: "late-attachment",
      affected,
      current: true,
      attachedAt: lateAttachment.attachedAt,
      detail: "page activity before attachment was not observed",
      weakens: conclusions("pre-attachment-churn", "topology-completeness", "listener-presence", "subscription-configuration", "snapshot-state"),
      evidence: lateAttachment.evidence
    }));
  }
  if (wireObservation) {
    limitations.push(Object.freeze({
      id: `wire-observation:${wireObservation.intervalId}`,
      kind: "observation-path",
      path: "wire",
      affected,
      current: true,
      detail: "wire fallback cannot establish every official client API topology fact",
      weakens: conclusions("listener-presence", "subscription-configuration", "topology-completeness", "snapshot-state", "update-delivery-attribution"),
      evidence: wireObservation
    }));
  }
  if (event?.topology?.coverage.reason === "unsupported-shape") {
    limitations.push(Object.freeze({
      id: `unsupported-shape:${boundary.intervalId}:${boundary.sequence}`,
      kind: "unsupported-shape",
      shape: event.kind,
      affected,
      current: false,
      detail: "the committed callback shape was retained without inferring unavailable topology values",
      weakens: conclusions("topology-completeness", "subscription-configuration"),
      evidence: boundary
    }));
  }
  if (historyStatus?.fallback !== null && historyStatus?.capacity.tier === "LOWER") {
    limitations.push(Object.freeze({
      id: `lower-history:${historyStatus.interval.id}`,
      kind: "history-capacity",
      state: "lower-capacity",
      affected,
      current: true,
      detail: "future retained Evidence is bounded by the fixed memory fallback tier",
      weakens: conclusions("future-evidence-retention"),
      evidence: boundary
    }));
  }
  if (historyStatus?.phase === "STOPPED") {
    limitations.push(Object.freeze({
      id: `terminal-history:${historyStatus.interval.id}`,
      kind: "history-capacity",
      state: "terminal",
      affected,
      current: true,
      detail: "later captured activity cannot become Evidence in this Panel Session",
      weakens: conclusions("history-after-terminal-boundary"),
      evidence: historyStatus.committedEvidenceBoundary ?? boundary
    }));
  }
  return limitations;
}

function conclusions(...values: DiagnosticConclusion[]): readonly DiagnosticConclusion[] {
  return Object.freeze(values);
}

function capturedMode(value: unknown, state: unknown, provenance: CaptureProvenance): CapturedValue<SubscriptionMode> {
  return value === "MERGE" || value === "DISTINCT" || value === "RAW" || value === "COMMAND"
    ? available(value, provenance)
    : unavailable(unavailableReason(state, "mode-unavailable"), provenance);
}

function capturedDescriptor(values: readonly string[] | undefined, schema: string | null | undefined, state: unknown, provenance: CaptureProvenance): CapturedDescriptor {
  if (values) return Object.freeze({ kind: "list", values: Object.freeze([...values]), provenance });
  if (typeof schema === "string") return Object.freeze({ kind: "schema", name: schema, provenance });
  if (schema === null) return Object.freeze({ kind: "unset", provenance });
  return Object.freeze({ kind: "unavailable", reason: unavailableReason(state, "descriptor-unavailable"), provenance });
}

function capturedNullableString(value: unknown, state: unknown, provenance: CaptureProvenance): CapturedValue<string | null> {
  return typeof value === "string" || value === null ? available(value, provenance) : unavailable(unavailableReason(state, "value-unavailable"), provenance);
}

function capturedSnapshot(value: unknown, state: unknown, provenance: CaptureProvenance): CapturedValue<string | number | null> {
  if (value === true) return available("yes", provenance);
  if (value === false || value === null) return available(null, provenance);
  return typeof value === "string" || typeof value === "number" ? available(value, provenance) : unavailable(unavailableReason(state, "snapshot-unavailable"), provenance);
}

function capturedBuffer(value: unknown, state: unknown, provenance: CaptureProvenance): CapturedValue<number | "unlimited" | null> {
  return value === "unlimited" || value === null || (typeof value === "number" && Number.isFinite(value))
    ? available(value, provenance)
    : unavailable(unavailableReason(state, "buffer-unavailable"), provenance);
}

function capturedFrequency(value: unknown, state: unknown, provenance: CaptureProvenance): CapturedValue<number | "unlimited" | "unfiltered" | null> {
  return value === "unlimited" || value === "unfiltered" || value === null || (typeof value === "number" && Number.isFinite(value))
    ? available(value, provenance)
    : unavailable(unavailableReason(state, "frequency-unavailable"), provenance);
}

function unavailable<T>(reason: string, provenance: CaptureProvenance): CapturedValue<T> {
  return Object.freeze({ kind: "unavailable", reason, provenance });
}

function unavailableReason(state: unknown, fallback: string): string {
  if (state && typeof state === "object" && "state" in state && typeof state.state === "string") return state.state;
  return fallback;
}

function observeProposal(observation: DiagnosticObservationInput): SubscriptionDiagnosticProposal {
  return Object.freeze({ kind: "observe", observation });
}

function newObservations(
  observations: readonly DiagnosticObservationInput[],
  previouslyActive: readonly DiagnosticObservationInput[],
  emittedOccurrences: ReadonlySet<string>
): DiagnosticObservationInput[] {
  const prior = new Set(previouslyActive.map(diagnosticObservationIdentity));
  return observations.filter((observation) =>
    observation.lifecycle.kind === "occurrence"
      ? !emittedOccurrences.has(diagnosticObservationIdentity(observation))
      : !prior.has(diagnosticObservationIdentity(observation))
  );
}

function affectedSubscriptionKey(affected: Extract<DiagnosticObservationInput["affected"], Readonly<{ kind: "subscription" }>>): string {
  return `${affected.pageId}\u0000${affected.clientId}\u0000${affected.sessionId ?? "session-unavailable"}\u0000${affected.subscriptionId}`;
}

function resolveProposal(resolution: Extract<SubscriptionDiagnosticProposal, { kind: "resolve" }>["resolution"]): SubscriptionDiagnosticProposal {
  return Object.freeze({ kind: "resolve", resolution });
}

function evidenceBoundary(entry: CommittedEvidence): Readonly<{ intervalId: string; sequence: number; eventId: string }> {
  return Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
}

function isEvent(candidate: CommittedEvidence["candidate"]): candidate is LightstreamerEventEnvelope {
  return candidate.kind !== "topology-checkpoint";
}
