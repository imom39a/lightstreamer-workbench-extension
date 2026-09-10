import {
  historyCapacityLimits,
  MIB,
  type HistoryCapacityLimits,
  type HistoryPressureMeasurements
} from "../../core/event-history-capacity";
import type {
  EvidenceRef,
  HistoryAcceptanceGap,
  HistoryProblem,
  HistoryStatus
} from "../../core/event-history-authoritative";

export type HistoryConditionKind =
  | "evidence-gap"
  | "pending-pressure"
  | "memory-fallback"
  | "history-unavailable";

export type WorkbenchHistoryCondition = Readonly<{
  kind: HistoryConditionKind;
  severity: "Warning" | "Error";
  title: string;
  affected: string;
  detail: string;
  recovery: string;
  announcement: string;
  announcementKey: string;
}>;

export type HistoryConditionInput = Readonly<{
  status: HistoryStatus;
  problem?: HistoryProblem;
  topologyBasisRestoredAt?: EvidenceRef | null;
}>;

/** Maps Event History facts to each active low-attention footer condition. */
export function historyConditionsFor(
  input: HistoryConditionInput
): readonly WorkbenchHistoryCondition[] {
  const { status, problem, topologyBasisRestoredAt = null } = input;
  const limits = status.capacity.limits ?? historyCapacityLimits(status.capacity.tier);
  const measurements = status.capacity.measurements;
  const conditions: WorkbenchHistoryCondition[] = [];

  if (status.continuity?.state === "GAPPED" && status.continuity.latestGap) {
    conditions.push(evidenceGapCondition(
      status,
      status.continuity.latestGap,
      topologyBasisRestoredAt
    ));
  }

  if (status.phase === "RUNNING" && measurements && hasPendingPressure(limits, measurements)) {
    conditions.push(pendingPressureCondition(status, limits, measurements));
  }

  if (
    status.phase === "RUNNING" &&
    (status.persistence?.mode === "MEMORY_ONLY" || status.fallback !== null)
  ) {
    conditions.push(memoryFallbackCondition(status, problem));
  }

  if (status.phase !== "RUNNING" && status.phase !== "CLOSED") {
    conditions.push(condition({
      kind: "history-unavailable",
      severity: "Error",
      title: "Event History unavailable",
      affected: intervalLabel(status),
      detail: `Event History cannot currently accept activity. ${boundaryLabel(status.committedEvidenceBoundary)}.`,
      recovery: "Keep DevTools open while Workbench attempts recovery; retained Evidence remains available",
      announcement: "Event History is temporarily unavailable."
    }));
  }

  return Object.freeze(conditions);
}

/** Compatibility helper for callers that need only the highest-priority condition. */
export function historyConditionFor(
  input: HistoryConditionInput
): WorkbenchHistoryCondition | null {
  return historyConditionsFor(input)[0] ?? null;
}

function evidenceGapCondition(
  status: HistoryStatus,
  gap: HistoryAcceptanceGap,
  topologyBasisRestoredAt: EvidenceRef | null
): WorkbenchHistoryCondition {
  const gapCount = status.continuity?.gapCount ?? 1;
  const firstGap = status.continuity?.firstGap ?? gap;
  const gapSummary = gapCount === 1
    ? `1 Evidence gap in this History Interval: captured activity #${gap.captureOrdinal.toLocaleString()} (${gap.eventId}) could not become Evidence because of ${gap.dimension}.`
    : `${gapCount.toLocaleString()} Evidence gaps in this History Interval. First gap: captured activity #${firstGap.captureOrdinal.toLocaleString()} (${firstGap.eventId}). Latest gap: captured activity #${gap.captureOrdinal.toLocaleString()} (${gap.eventId}) could not become Evidence because of ${gap.dimension}.`;
  const projectionDetail = topologyBasisRestoredAt
    ? `Topology basis was restored by a full checkpoint at ${boundaryLabel(topologyBasisRestoredAt)}. COMMAND and COMMAND-dependent Scenario conclusions remain LIMITED.`
    : "Continuity-dependent Topology and COMMAND conclusions are LIMITED.";
  return condition({
    kind: "evidence-gap",
    severity: "Warning",
    title: "History has an Evidence gap",
    affected: intervalLabel(status),
    detail: `${gapSummary} Later Capture continues. ${boundaryLabel(gap.afterEvidence)} immediately before the latest gap. ${projectionDetail}`,
    recovery: topologyBasisRestoredAt
      ? "Use a later trustworthy COMMAND Snapshot before relying on COMMAND-dependent conclusions; Complete History remains incomplete because the Evidence Gap is not restored"
      : "Inspect the gap in Notifications and use a later trustworthy snapshot or checkpoint before relying on continuity-dependent conclusions",
    announcement: "History has an Evidence gap; Capture continues with limited continuity."
  });
}

function memoryFallbackCondition(
  status: HistoryStatus,
  problem: HistoryProblem | undefined
): WorkbenchHistoryCondition {
  const limits = status.retention?.highWater ?? {
    count: historyCapacityLimits("LOWER").maxRetainedCount,
    bytes: historyCapacityLimits("LOWER").maxRetainedBytes
  };
  const failure = status.persistence?.lastProblem ?? problem;
  const reason = failure?.code ?? status.fallback ?? "PRIMARY_JOURNAL_UNAVAILABLE";
  const cause = failure?.message ? ` ${failure.message.replace(/[.!?]$/, "")}.` : "";
  const attempts = status.persistence?.failureCount
    ? ` ${status.persistence.failureCount.toLocaleString()} failed journal attempt${status.persistence.failureCount === 1 ? "" : "s"}; ${status.persistence.retryCount.toLocaleString()} retries. IndexedDB writes remain disabled for this Panel Session.`
    : "";
  return condition({
    kind: "memory-fallback",
    severity: "Warning",
    title: "History using memory",
    affected: intervalLabel(status),
    detail: `${reason}.${cause}${attempts} Capture continues with a rolling memory Retained Range of ${limits.count.toLocaleString()} Evidence records or ${bytesInMiB(limits.bytes)}. No Evidence Gap was created by this storage change, and Observation Coverage is unchanged.`,
    recovery: "Keep investigating; reopen DevTools later if durable session storage is required",
    announcement: "History is using bounded memory; Capture continues."
  });
}

function pendingPressureCondition(
  status: HistoryStatus,
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements
): WorkbenchHistoryCondition {
  const age = measurements.oldestPendingAgeMs === null
    ? "none"
    : `${measurements.oldestPendingAgeMs.toLocaleString()} ms`;
  return condition({
    kind: "pending-pressure",
    severity: "Warning",
    title: "History catching up",
    affected: intervalLabel(status),
    detail: `Pending ${formatBytes(measurements.pendingBytes)} and oldest pending age ${age}. ${boundaryLabel(status.committedEvidenceBoundary)}. Capture remains running while bounded commit recovery catches up.`,
    recovery: `Keep investigating recent Evidence. Workbench bounds pending work at ${formatBytes(limits.pendingStopBytes)} and reports an exact gap only if a candidate cannot enter any canonical segment`,
    announcement: "History is catching up; Capture continues."
  });
}

function hasPendingPressure(
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements
): boolean {
  return measurements.pendingBytes >= limits.pendingWarningBytes ||
    (measurements.oldestPendingAgeMs !== null &&
      measurements.oldestPendingAgeMs >= limits.pendingAgeWarningMs);
}

function condition(
  value: Omit<WorkbenchHistoryCondition, "announcementKey">
): WorkbenchHistoryCondition {
  return Object.freeze({ ...value, announcementKey: `${value.kind}:${value.title}` });
}

function intervalLabel(status: HistoryStatus): string {
  return `History Interval ${status.interval.id}`;
}

function boundaryLabel(boundary: HistoryStatus["committedEvidenceBoundary"]): string {
  return boundary
    ? `Committed Evidence Boundary ${boundary.intervalId} #${boundary.sequence} (${boundary.eventId})`
    : "Committed Evidence Boundary none";
}

function bytesInMiB(bytes: number): string {
  return `${Math.round(bytes / MIB).toLocaleString()} MiB`;
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} bytes (${bytesInMiB(bytes)})`;
}
