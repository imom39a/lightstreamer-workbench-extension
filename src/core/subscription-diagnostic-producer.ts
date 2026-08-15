import type { CommittedEvidence } from "./event-history-authoritative";
import {
  DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH,
  normalizeDiagnosticObservationInput,
  type DiagnosticAffectedIdentity,
  type DiagnosticConditionResolution,
  type DiagnosticObservationInput,
  type DiagnosticObservationJournal
} from "./diagnostic-observation";
import type { LightstreamerEventEnvelope } from "./event-envelope";
import { toPersistableEventEnvelope } from "./event-envelope";
import { createCommandStateProjections } from "./command-state";
import { isTopologyAbsoluteRecord, type TopologyAbsoluteRecord } from "../bridge/messages";

export type DiagnosticObservationProposal = Readonly<{
  kind: "observe";
  observation: DiagnosticObservationInput;
}>;

export type DiagnosticConditionResolutionProposal = Readonly<{
  kind: "resolve";
  resolution: DiagnosticConditionResolution;
}>;

export type SubscriptionDiagnosticProposal = DiagnosticObservationProposal | DiagnosticConditionResolutionProposal;

export type SubscriptionDiagnosticProducer = Readonly<{
  applyCommittedEvidence(entry: CommittedEvidence): readonly SubscriptionDiagnosticProposal[];
  clear(): void;
}>;

export type DiagnosticProposalCommitOutcome = Readonly<{ committed: number; failed: number }>;

/**
 * Commits normalized proposals without allowing diagnostic persistence to
 * change Capture, Local Injection, or Scenario execution outcomes.
 */
export async function commitSubscriptionDiagnosticProposalsAdvisory(
  journal: DiagnosticObservationJournal,
  proposals: readonly SubscriptionDiagnosticProposal[],
  onFailure: (error: unknown, proposal: SubscriptionDiagnosticProposal) => void = () => undefined
): Promise<DiagnosticProposalCommitOutcome> {
  let committed = 0;
  let failed = 0;
  for (const proposal of proposals) {
    try {
      if (proposal.kind === "observe") await journal.observe(proposal.observation);
      else await journal.resolveCondition(proposal.resolution);
      committed += 1;
    } catch (error) {
      failed += 1;
      try { onFailure(error, proposal); } catch { /* Diagnostic reporting remains advisory. */ }
    }
  }
  return Object.freeze({ committed, failed });
}

export function createSubscriptionDiagnosticProducer(): SubscriptionDiagnosticProducer {
  const subscriptionIdentities = new Map<string, Readonly<{ pageId: string; clientId: string }>>();
  const snapshotPhases = new Map<string, "snapshot" | "live" | "complete" | "cleared">();
  const snapshotConditions = new Map<string, Readonly<{ code: string; conditionId: string; affected: DiagnosticAffectedIdentity }>>();
  const commandProjections = createCommandStateProjections();
  const reducerConditions = new Map<string, Readonly<{ code: string; conditionId: string; affected: DiagnosticAffectedIdentity }>>();
  const establishmentCounts = new Map<string, number>();
  let topologyCoverage: Readonly<{ status: "complete" | "partial"; boundary: Readonly<{ intervalId: string; sequence: number; eventId: string }> }> | null = null;
  return Object.freeze({
    applyCommittedEvidence(entry) {
      try {
        if (entry.candidate.kind === "topology-checkpoint") {
          const checkpoint = entry.candidate.checkpoint;
          indexCommittedTopologyCheckpoint(checkpoint, subscriptionIdentities);
          const status = checkpointCoverageStatus(checkpoint);
          if (status) topologyCoverage = Object.freeze({ status, boundary: evidenceBoundary(entry) });
          if (status !== "complete" || reducerConditions.size === 0) return Object.freeze([]);
          const proposals = [...reducerConditions.values()].map((condition): SubscriptionDiagnosticProposal => Object.freeze({
            kind: "resolve",
            resolution: Object.freeze({
              code: condition.code,
              ruleVersion: 1,
              conditionId: condition.conditionId,
              affected: condition.affected,
              observedAt: checkpointObservedAt(checkpoint),
              evidenceBoundary: evidenceBoundary(entry)
            })
          }));
          reducerConditions.clear();
          return Object.freeze(proposals);
        }
        const event = entry.candidate;
        const commandEvent = Object.freeze({ ...toPersistableEventEnvelope(event), id: commandReducerEventId(entry) });
        commandProjections.apply(commandEvent);
        const establishment = subscriptionEstablishmentProposals(entry, event, subscriptionIdentities, snapshotPhases, snapshotConditions, establishmentCounts);
        const snapshot = snapshotDiagnosticProposals(entry, event, subscriptionIdentities, snapshotPhases, snapshotConditions);
        const proposals: SubscriptionDiagnosticProposal[] = [...establishment, ...(snapshot === null ? [] : snapshot)];
        const secondLevel = event.raw?.callback === "onCommandSecondLevelSubscriptionError";
        const secondLevelLoss = event.raw?.callback === "onCommandSecondLevelItemLostUpdates";
        const boundary = Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
        if (event.kind === "lost-updates" || secondLevelLoss) {
          const args = Array.isArray(event.raw?.args) ? event.raw.args : [];
          const key = secondLevelLoss && typeof args[1] === "string" ? args[1] : undefined;
          const reportedCount = Number.isSafeInteger(event.update?.lostUpdates) && Number(event.update?.lostUpdates) >= 0
            ? Number(event.update?.lostUpdates)
            : undefined;
          const safeMessage = safeDiagnosticMessage(event.raw?.safeMessage);
          const observation = normalizeDiagnosticObservationInput({
            code: secondLevelLoss ? "ls.subscription.second-level.lost-updates" : "ls.subscription.lost-updates",
            ruleVersion: 1,
            severity: "warning",
            lifecycle: occurrenceLifecycle(entry),
            affected: affectedIdentity(event, boundary, subscriptionIdentities, key),
            observedAt: event.timestamp,
            evidenceBoundary: boundary,
            observed: reportedCount === undefined
              ? `SubscriptionListener reported lost updates${key ? ` for second-level key ${key}.` : "."}`
              : `SubscriptionListener reported ${reportedCount} lost update${reportedCount === 1 ? "" : "s"}${key ? ` for second-level key ${key}.` : "."}`,
            limitation: "The callback reports a count at this boundary but does not enumerate missing values or every server-filtered or conflated update.",
            consequence: "The retained local view may omit updates for the affected Subscription or key.",
            route: { kind: "inspect-evidence", evidence: boundary },
            resultRef: { kind: "evidence", ...boundary },
            ...(safeMessage ? { safeMessage } : {})
          });
          proposals.push(Object.freeze({ kind: "observe" as const, observation }));
          return Object.freeze(proposals);
        }
        if (event.kind === "subscription-error" || secondLevel) {
          const rawCode = Array.isArray(event.raw?.args) ? event.raw.args[0] : event.raw?.code;
          const originalCode = typeof rawCode === "number" && Number.isSafeInteger(rawCode) ? rawCode : undefined;
          const key = secondLevel && Array.isArray(event.raw?.args) && typeof event.raw.args[2] === "string"
            ? event.raw.args[2]
            : undefined;
          const code = subscriptionErrorCode(secondLevel, originalCode);
          const affected = affectedIdentity(event, boundary, subscriptionIdentities, key);
          const safeMessage = safeDiagnosticMessage(event.raw?.safeMessage);
          const observation = normalizeDiagnosticObservationInput({
            code,
            ruleVersion: 1,
            severity: "error",
            lifecycle: occurrenceLifecycle(entry),
            affected,
            observedAt: event.timestamp,
            evidenceBoundary: boundary,
            observed: originalCode === undefined
              ? `SubscriptionListener reported a ${secondLevel ? "second-level" : "first-level"} subscription error${key ? ` for key ${key}.` : "."}`
              : `SubscriptionListener reported ${secondLevel ? "second-level" : "first-level"} subscription error code ${originalCode}${key ? ` for key ${key}.` : "."}`,
            limitation: "The callback does not expose server-side application state or prove the state of later subscription attempts.",
            consequence: "Updates for this Subscription establishment may be unavailable.",
            route: { kind: "inspect-evidence", evidence: boundary },
            resultRef: { kind: "evidence", ...boundary },
            ...(originalCode === undefined ? {} : { originalCode }),
            ...(safeMessage ? { safeMessage } : {})
          });
          proposals.push(Object.freeze({ kind: "observe" as const, observation }));
          return Object.freeze(proposals);
        }
        const projection = event.synthetic ? "local-effective" : "observed-server";
        const commandDiagnostics = commandProjections.snapshot(projection).diagnostics.filter((diagnostic) => diagnostic.eventId === commandEvent.id);
        commandDiagnostics.forEach((diagnostic, index) => {
          proposals.push(observationProposal({
            code: `ls.command.${diagnostic.code}`,
            ruleVersion: 1,
            severity: diagnostic.severity,
            lifecycle: {
              kind: "occurrence",
              occurrenceId: boundedDiagnosticIdentity("command-evidence", entry.intervalId, String(entry.sequence), entry.eventId, diagnostic.code, String(index))
            },
            affected: affectedIdentity(event, boundary, subscriptionIdentities),
            observedAt: event.timestamp,
            evidenceBoundary: boundary,
            observed: `COMMAND reducer recorded ${diagnostic.code} for committed Evidence ${entry.eventId}.`,
            limitation: "The reducer uses committed Workbench Evidence and is not Authoritative COMMAND State.",
            consequence: "The retained COMMAND projection is incomplete or the captured operation is malformed.",
            route: { kind: "inspect-evidence", evidence: boundary },
            resultRef: {
              kind: "projection",
              projection: event.synthetic ? "local-effective-command-state" : "observed-server-command-state",
              key: boundedProjectionKey(
                event.subscription?.id ?? "subscription-unavailable",
                String(event.item?.name ?? event.item?.position ?? "item-unavailable"),
                event.update?.key ?? "key-unavailable"
              )
            }
          }));
        });
        if (event.subscription?.mode === "COMMAND" && topologyCoverage?.status === "partial") {
          const affected = affectedIdentity(event, boundary, subscriptionIdentities);
          const conditionId = boundedDiagnosticIdentity("command-reducer", entry.intervalId, event.subscription.id);
          proposals.push(observationProposal({
            code: "ls.command.reducer-incomplete",
            ruleVersion: 1,
            severity: "warning",
            lifecycle: { kind: "condition", conditionId },
            affected,
            observedAt: event.timestamp,
            evidenceBoundary: topologyCoverage.boundary,
            observed: "The latest committed topology checkpoint reports partial coverage for this COMMAND reducer.",
            limitation: "Workbench cannot prove that all earlier COMMAND generations or callbacks were captured.",
            consequence: "Unknown-key and current-row conclusions remain advisory until complete topology coverage is committed.",
            route: { kind: "inspect-evidence", evidence: topologyCoverage.boundary },
            resultRef: {
              kind: "projection",
              projection: event.synthetic ? "local-effective-command-state" : "observed-server-command-state",
              key: boundedProjectionKey(event.subscription.id)
            }
          }));
          reducerConditions.set(conditionId, Object.freeze({ code: "ls.command.reducer-incomplete", conditionId, affected }));
        }
        return Object.freeze(proposals);
      } catch {
        // Diagnostic production is advisory and cannot change an already-
        // committed Evidence, Local Injection, or Scenario outcome.
        return Object.freeze([]);
      }
    },
    clear() {
      subscriptionIdentities.clear();
      snapshotPhases.clear();
      snapshotConditions.clear();
      commandProjections.clear();
      reducerConditions.clear();
      establishmentCounts.clear();
      topologyCoverage = null;
    }
  });
}

function subscriptionEstablishmentProposals(
  entry: CommittedEvidence,
  event: LightstreamerEventEnvelope,
  identities: ReadonlyMap<string, Readonly<{ pageId: string; clientId: string }>>,
  phases: Map<string, "snapshot" | "live" | "complete" | "cleared">,
  activeConditions: Map<string, Readonly<{ code: string; conditionId: string; affected: DiagnosticAffectedIdentity }>>,
  establishmentCounts: Map<string, number>
): readonly SubscriptionDiagnosticProposal[] {
  if (event.kind !== "subscription-started" || !event.subscription?.id) return Object.freeze([]);
  const subscriptionId = event.subscription.id;
  const priorCount = establishmentCounts.get(subscriptionId) ?? 0;
  establishmentCounts.set(subscriptionId, priorCount + 1);
  const prefix = `${entry.intervalId}\u0000${subscriptionId}\u0000`;
  for (const key of [...phases.keys()]) if (key.startsWith(prefix)) phases.delete(key);
  const boundary = evidenceBoundary(entry);
  const proposals: SubscriptionDiagnosticProposal[] = [];
  for (const [key, active] of [...activeConditions.entries()]) {
    if (!key.startsWith(prefix)) continue;
    proposals.push(Object.freeze({
      kind: "resolve",
      resolution: Object.freeze({
        code: active.code,
        ruleVersion: 1,
        conditionId: active.conditionId,
        affected: active.affected,
        observedAt: event.timestamp,
        evidenceBoundary: boundary
      })
    }));
    activeConditions.delete(key);
  }
  if (priorCount > 0) {
    proposals.unshift(observationProposal({
      code: "ls.subscription.snapshot.resubscribed",
      ruleVersion: 1,
      severity: "information",
      lifecycle: occurrenceLifecycle(entry),
      affected: affectedIdentity(event, boundary, identities),
      observedAt: event.timestamp,
      evidenceBoundary: boundary,
      observed: "A new server-established Subscription epoch was captured.",
      limitation: "The establishment callback invalidates prior snapshot data but does not expose a server-side sequence number.",
      consequence: "Snapshot and COMMAND phase tracking restarts for this Subscription epoch.",
      route: { kind: "inspect-evidence", evidence: boundary },
      resultRef: { kind: "evidence", ...boundary }
    }));
  }
  return Object.freeze(proposals);
}

function evidenceBoundary(entry: CommittedEvidence): Readonly<{ intervalId: string; sequence: number; eventId: string }> {
  return Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
}

function commandReducerEventId(entry: CommittedEvidence): string {
  return `${entry.intervalId}:${entry.sequence}:${entry.eventId}`;
}

function checkpointCoverageStatus(checkpoint: Readonly<Record<string, unknown>>): "complete" | "partial" | null {
  if (!checkpoint.coverage || typeof checkpoint.coverage !== "object") return null;
  const status = (checkpoint.coverage as Record<string, unknown>).status;
  return status === "complete" || status === "partial" ? status : null;
}

function checkpointObservedAt(checkpoint: Readonly<Record<string, unknown>>): number {
  if (!Array.isArray(checkpoint.records)) return 0;
  for (const record of checkpoint.records) {
    if (record && typeof record === "object" && Number.isSafeInteger((record as Record<string, unknown>).timestamp)) {
      return Number((record as Record<string, unknown>).timestamp);
    }
  }
  return 0;
}

function snapshotDiagnosticProposals(
  entry: CommittedEvidence,
  event: LightstreamerEventEnvelope,
  identities: ReadonlyMap<string, Readonly<{ pageId: string; clientId: string }>>,
  phases: Map<string, "snapshot" | "live" | "complete" | "cleared">,
  activeConditions: Map<string, Readonly<{ code: string; conditionId: string; affected: DiagnosticAffectedIdentity }>>
): readonly SubscriptionDiagnosticProposal[] | null {
  if (event.synthetic || event.source === "synthetic") return null;
  const participates = event.kind === "end-of-snapshot" || event.kind === "clear-snapshot" ||
    (event.kind === "item-update" && typeof event.update?.isSnapshot === "boolean");
  if (!participates) return null;
  const subscriptionId = event.subscription?.id;
  const item = event.item?.name ?? (event.item?.position === undefined || event.item.position === null ? null : `#${event.item.position}`);
  if (!subscriptionId || item === null) return Object.freeze([]);
  const boundary = Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
  const affected = affectedIdentity(event, boundary, identities);
  const phaseKey = `${entry.intervalId}\u0000${subscriptionId}\u0000${item}`;
  const conditionId = boundedDiagnosticIdentity("snapshot-phase", entry.intervalId, subscriptionId, item);
  const prior = phases.get(phaseKey);
  const proposals: SubscriptionDiagnosticProposal[] = [];
  const observeOccurrence = (code: string, severity: "information" | "warning", observed: string, limitation: string, consequence: string): void => {
    proposals.push(observationProposal({
      code,
      severity,
      lifecycle: occurrenceLifecycle(entry),
      affected,
      observedAt: event.timestamp,
      evidenceBoundary: boundary,
      observed,
      limitation,
      consequence,
      route: { kind: "inspect-evidence", evidence: boundary },
      resultRef: { kind: "evidence", ...boundary }
    }));
  };
  const observeCondition = (code: string, observed: string): void => {
    const priorCondition = activeConditions.get(phaseKey);
    if (priorCondition && priorCondition.code !== code) {
      proposals.push(Object.freeze({
        kind: "resolve" as const,
        resolution: Object.freeze({
          code: priorCondition.code,
          ruleVersion: 1,
          conditionId: priorCondition.conditionId,
          affected: priorCondition.affected,
          observedAt: event.timestamp,
          evidenceBoundary: boundary
        })
      }));
    }
    const observation = observationProposal({
      code,
      severity: "warning",
      lifecycle: { kind: "condition", conditionId },
      affected,
      observedAt: event.timestamp,
      evidenceBoundary: boundary,
      observed,
      limitation: "Workbench only orders committed callback Evidence; late listener attachment, incomplete Capture, or retention may hide an earlier phase transition.",
      consequence: "The captured snapshot phase is insufficient for a complete local reconstruction.",
      route: { kind: "inspect-evidence", evidence: boundary },
      resultRef: { kind: "evidence", ...boundary }
    });
    proposals.push(observation);
    activeConditions.set(phaseKey, Object.freeze({ code, conditionId, affected }));
  };
  const resolveCondition = (): void => {
    const active = activeConditions.get(phaseKey);
    if (!active) return;
    proposals.push(Object.freeze({
      kind: "resolve" as const,
      resolution: Object.freeze({
        code: active.code,
        ruleVersion: 1,
        conditionId: active.conditionId,
        affected: active.affected,
        observedAt: event.timestamp,
        evidenceBoundary: boundary
      })
    }));
    activeConditions.delete(phaseKey);
  };

  if (event.kind === "item-update" && event.update?.isSnapshot === true) {
    if (event.subscription?.mode === "RAW") {
      observeOccurrence("ls.subscription.snapshot.raw-inconsistent", "warning", "Captured Evidence marked a RAW update as snapshot data.", "RAW mode does not support snapshot delivery; Workbench cannot determine which source produced the inconsistent flag.", "Snapshot-phase conclusions for this update are unreliable.");
    }
    if (prior === "complete" || prior === "cleared" || prior === "live") {
      observeCondition("ls.subscription.snapshot.phase-inconsistent", "Captured snapshot data after the retained item phase had already advanced.");
    }
    phases.set(phaseKey, "snapshot");
    return Object.freeze(proposals);
  }
  if (event.kind === "item-update") {
    if (prior === "snapshot") observeCondition("ls.subscription.snapshot.phase-incomplete", "Captured live data before an end-of-snapshot callback for this item.");
    phases.set(phaseKey, "live");
    return Object.freeze(proposals);
  }
  if (event.kind === "end-of-snapshot") {
    observeOccurrence("ls.subscription.snapshot.completed", "information", "SubscriptionListener reported end of snapshot for this item.", prior === undefined ? "No earlier item snapshot phase is retained; an empty snapshot, late attachment, incomplete Capture, or retention can produce this boundary." : "The callback marks only the captured item boundary and does not expose a server-side sequence.", "Later captured updates are treated as live for this item.");
    if (prior === undefined) {
      observeOccurrence("ls.subscription.snapshot.phase-insufficient", "information", "End of snapshot was captured without an earlier retained phase for this item.", "Workbench cannot distinguish an empty snapshot from late attachment, incomplete Capture, or retention loss.", "No complete snapshot sequence can be reconstructed from retained Evidence alone.");
    }
    resolveCondition();
    phases.set(phaseKey, "complete");
    return Object.freeze(proposals);
  }
  observeOccurrence("ls.subscription.snapshot.cleared", "information", "SubscriptionListener reported snapshot state cleared for this item.", "The callback does not identify a server-side update sequence or enumerate the state that was cleared.", "Prior snapshot state for this item must not be treated as current.");
  if (prior === undefined) {
    observeOccurrence("ls.subscription.snapshot.phase-insufficient", "information", "Snapshot clear was captured without an earlier retained phase for this item.", "Workbench cannot distinguish late attachment, incomplete Capture, or retention loss.", "The preceding snapshot phase cannot be reconstructed from retained Evidence alone.");
  }
  resolveCondition();
  phases.set(phaseKey, "cleared");
  return Object.freeze(proposals);
}

function observationProposal(input: DiagnosticObservationInput): DiagnosticObservationProposal {
  return Object.freeze({ kind: "observe", observation: normalizeDiagnosticObservationInput({ ...input, ruleVersion: input.ruleVersion ?? 1 }) });
}

function occurrenceLifecycle(entry: CommittedEvidence): Readonly<{ kind: "occurrence"; occurrenceId: string }> {
  return Object.freeze({
    kind: "occurrence",
    occurrenceId: boundedDiagnosticIdentity("evidence", entry.intervalId, String(entry.sequence), entry.eventId)
  });
}

function boundedDiagnosticIdentity(kind: string, ...components: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(components.join("\u0000"))) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${kind}:${hash.toString(16).padStart(16, "0")}`;
}

function boundedProjectionKey(...components: readonly string[]): string {
  const readable = components.join(":");
  return [...readable].length <= 128 && !/[\u0000-\u001f\u007f]/u.test(readable)
    ? readable
    : boundedDiagnosticIdentity("projection", ...components);
}

function safeDiagnosticMessage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > DIAGNOSTIC_SAFE_MESSAGE_MAX_LENGTH) return undefined;
  if (/\p{Cc}/u.test(value)) return undefined;
  return value;
}

function subscriptionErrorCode(secondLevel: boolean, code: number | undefined): string {
  const prefix = secondLevel ? "ls.subscription.second-level" : "ls.subscription";
  if (code !== undefined && code <= 0) return `${prefix}.application-refused`;
  if (code !== undefined && [26, 27, 28].includes(code)) return `${prefix}.unfiltered-refused`;
  if (!secondLevel && code === 15) return "ls.subscription.command-key-missing";
  if (!secondLevel && code === 16) return "ls.subscription.command-field-missing";
  if (secondLevel && code === 14) return `${prefix}.invalid-item`;
  if (secondLevel && code === 17) return `${prefix}.data-adapter-refused`;
  if (secondLevel && code !== undefined && [21, 22, 23].includes(code)) return `${prefix}.group-schema-refused`;
  if (secondLevel && code === 24) return `${prefix}.mode-refused`;
  return `${prefix}.error`;
}

function affectedIdentity(
  event: LightstreamerEventEnvelope,
  boundary: Readonly<{ intervalId: string; sequence: number; eventId: string }>,
  identities: ReadonlyMap<string, Readonly<{ pageId: string; clientId: string }>>,
  secondLevelKey?: string
): DiagnosticAffectedIdentity {
  const subscriptionId = event.subscription?.id;
  const committed = subscriptionId ? identities.get(subscriptionId) : undefined;
  if (!subscriptionId || !committed || (event.client?.id && event.client.id !== committed.clientId)) {
    return Object.freeze({ kind: "evidence", ...boundary });
  }
  if (secondLevelKey) {
    return Object.freeze({ kind: "item", pageId: committed.pageId, clientId: committed.clientId, subscriptionId, item: secondLevelKey });
  }
  return Object.freeze({
    kind: "subscription",
    pageId: committed.pageId,
    clientId: committed.clientId,
    ...(event.client?.sessionId ? { sessionId: event.client.sessionId } : {}),
    subscriptionId
  });
}

function indexCommittedTopologyCheckpoint(
  checkpoint: Readonly<Record<string, unknown>>,
  identities: Map<string, Readonly<{ pageId: string; clientId: string }>>
): void {
  if (
    typeof checkpoint.pageEpoch !== "string" ||
    !Array.isArray(checkpoint.records) ||
    !checkpoint.records.every(isTopologyAbsoluteRecord)
  ) return;
  const next = new Map<string, Readonly<{ pageId: string; clientId: string }>>();
  for (const record of checkpoint.records as readonly TopologyAbsoluteRecord[]) {
    if (
      record.kind === "subscription" &&
      typeof record.clientId === "string" &&
      record.pageEpoch === checkpoint.pageEpoch
    ) {
      next.set(record.id, Object.freeze({ pageId: checkpoint.pageEpoch, clientId: record.clientId }));
    }
  }
  identities.clear();
  for (const [id, identity] of next) identities.set(id, identity);
}
