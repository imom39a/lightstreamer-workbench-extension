import {
  historyCapacityLimits,
  MIB,
  type HistoryCapacityLimits,
  type HistoryPressureMeasurements,
  type HistoryTerminalReason
} from "../../core/event-history-capacity";
import type {
  HistoryProblem,
  HistoryStatus
} from "../../core/event-history-authoritative";

export type HistoryConditionKind =
  | "journal-failure"
  | "capacity-stop"
  | "draining-to-stop"
  | "pending-pressure"
  | "retained-pressure"
  | "lower-capacity-fallback";

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
}>;

const JOURNAL_FAILURE_REASONS: readonly HistoryTerminalReason[] = [
  "JOURNAL_COMMIT_FAILED",
  "QUOTA_EXCEEDED"
];

export function historyConditionFor(
  input: HistoryConditionInput
): WorkbenchHistoryCondition | null {
  const { status, problem } = input;
  const terminal = status.terminal ?? problem?.terminal;
  const terminalReason = terminal?.reason ?? problem?.reason;
  const limits = status.capacity.limits ?? historyCapacityLimits(status.capacity.tier);
  const measurements = status.capacity.measurements;

  if (status.phase === "STOPPED" && terminalReason && JOURNAL_FAILURE_REASONS.includes(terminalReason)) {
    return journalFailureCondition(status, terminal, terminalReason);
  }

  if (status.phase === "STOPPED" && terminalReason) {
    return capacityStopCondition(status, terminal, terminalReason);
  }

  if (status.phase === "DRAINING_TO_STOP") {
    return drainingCondition(status, problem, limits, measurements);
  }

  if (status.phase === "RUNNING" && measurements) {
    const pendingPressure =
      measurements.pendingBytes >= limits.pendingWarningBytes ||
      (measurements.oldestPendingAgeMs !== null &&
        measurements.oldestPendingAgeMs >= limits.pendingAgeWarningMs);
    if (pendingPressure) {
      return pendingPressureCondition(status, limits, measurements);
    }

    const retainedPressure =
      measurements.retainedCount >= limits.retainedWarningCount ||
      measurements.retainedBytes >= limits.retainedWarningBytes;
    if (retainedPressure) {
      return retainedPressureCondition(status, limits, measurements);
    }
  }

  if (status.phase === "RUNNING" && status.fallback !== null) {
    return fallbackCondition(status);
  }

  return null;
}

function fallbackCondition(status: HistoryStatus): WorkbenchHistoryCondition {
  const reason = status.fallback === "UNKNOWN_NEWER_SCHEMA"
    ? "UNKNOWN_NEWER_SCHEMA · the journal schema is newer than this Workbench version"
    : "PRIMARY_JOURNAL_UNAVAILABLE · the primary session journal is unavailable";
  const announcementReason = status.fallback === "UNKNOWN_NEWER_SCHEMA"
    ? "the journal schema is newer than this Workbench version"
    : "the primary session journal is unavailable";
  const limits = historyCapacityLimits("LOWER");
  return condition({
    kind: "lower-capacity-fallback",
    severity: "Warning",
    title: "Lower History Capacity",
    affected: "Current Panel Session",
    detail: `${reason}. Memory is limited to ${limits.maxRetainedCount.toLocaleString()} Evidence records or ${bytesInMiB(limits.maxRetainedBytes)}. Event History remains Complete through the Committed Evidence Boundary. Observation Coverage is unchanged.`,
    recovery: status.fallback === "UNKNOWN_NEWER_SCHEMA"
      ? "Use a Workbench build that understands the newer journal generation, then reopen DevTools"
      : "Restore primary session storage or safe session coordination, allow guarded cleanup to retry, then reopen DevTools",
    announcement: `History is using lower capacity because ${announcementReason}.`
  });
}

function retainedPressureCondition(
  status: HistoryStatus,
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements
): WorkbenchHistoryCondition {
  return condition({
    kind: "retained-pressure",
    severity: "Warning",
    title: "History near capacity",
    affected: intervalLabel(status),
    detail: `Retained ${measurements.retainedCount.toLocaleString()} / ${limits.maxRetainedCount.toLocaleString()} Evidence records and ${formatBytes(measurements.retainedBytes)} / ${formatBytes(limits.maxRetainedBytes)} replay-complete bytes. Capture continues, but the first crossing offer stops it at ${boundaryLabel(status.committedEvidenceBoundary)}.`,
    recovery: "Copy or export retained Evidence, then deliberately Clear retained Evidence before the hard limit when a new History Interval is acceptable",
    announcement: "History is near retained capacity; Capture continues until the first crossing offer."
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
    title: "History backlog near stop",
    affected: intervalLabel(status),
    detail: `Pending ${formatBytes(measurements.pendingBytes)} / ${formatBytes(limits.pendingStopBytes)} and oldest pending age ${age} / ${limits.pendingAgeStopMs.toLocaleString()} ms. Current ${boundaryLabel(status.committedEvidenceBoundary)}. Capture continues while commits catch up.`,
    recovery: "Inspect retained Evidence while Workbench catches up; if Capture stops, preserve the Retained Range before reopening DevTools",
    announcement: "History backlog pressure is near its stop threshold; Capture continues while commits catch up."
  });
}

function drainingCondition(
  status: HistoryStatus,
  problem: HistoryProblem | undefined,
  limits: HistoryCapacityLimits,
  measurements: HistoryPressureMeasurements | undefined
): WorkbenchHistoryCondition {
  const reason = problem?.reason ?? status.terminal?.reason ?? "HISTORY_STOPPED";
  const pending = measurements ?? {
    retainedCount: status.retained,
    retainedBytes: 0,
    pendingCount: status.awaitingAcceptance,
    pendingBytes: 0,
    oldestPendingAgeMs: null
  };
  return condition({
    kind: "draining-to-stop",
    severity: "Warning",
    title: "History stopping",
    affected: intervalLabel(status),
    detail: `Typed trigger ${reason}; ${firstMissingLabel(status, problem)}. The ${boundaryLabel(status.committedEvidenceBoundary)} is provisional. queued ${pending.pendingCount.toLocaleString()} / ${pending.pendingBytes.toLocaleString()} bytes may still settle through the already-queued prefix. Capture is no longer accepting new activity and Coverage becomes LIMITED at the first missing capture. Clear cannot restart Capture.`,
    recovery: "Wait for the final boundary, preserve retained Evidence, and reopen DevTools; Clear is not a restart",
    announcement: "History is stopping at a provisional committed boundary."
  });
}

function capacityStopCondition(
  status: HistoryStatus,
  terminal: HistoryStatus["terminal"] | HistoryProblem["terminal"],
  reason: HistoryTerminalReason
): WorkbenchHistoryCondition {
  if (!terminal) {
    return condition({
      kind: "capacity-stop",
      severity: "Error",
      title: "Capture stopped — History Capacity exhausted",
      affected: intervalLabel(status),
      detail: `Typed cause ${reason}. Capture stopped at ${boundaryLabel(status.committedEvidenceBoundary)}. Clear cannot restart Capture.`,
      recovery: "Copy or export retained Evidence, then reopen DevTools for a new Panel Session",
      announcement: "Capture stopped because History Capacity is exhausted."
    });
  }
  return condition({
    kind: "capacity-stop",
    severity: "Error",
    title: "Capture stopped — History Capacity exhausted",
    affected: intervalLabel(status),
    detail: `Typed cause ${terminal.reason}. Final ${boundaryLabel(terminal.committedEvidenceBoundary)}. ${rangeLabel(terminal.retainedRange)}. First missing captured-event identity: ${terminal.firstMissingEventId ?? "none recorded"}. Rejected ${terminal.rejected.count.toLocaleString()} / ${terminal.rejected.bytes.toLocaleString()} bytes; discarded ${terminal.discarded.count.toLocaleString()} / ${terminal.discarded.bytes.toLocaleString()} bytes. The Retained Range remains Complete History through the boundary and no later event is Evidence. Clear cannot restart Capture.`,
    recovery: "Copy or export retained Evidence and reopen DevTools for a new Panel Session",
    announcement: "Capture stopped because History Capacity is exhausted."
  });
}

function journalFailureCondition(
  status: HistoryStatus,
  terminal: HistoryStatus["terminal"] | HistoryProblem["terminal"],
  reason: HistoryTerminalReason
): WorkbenchHistoryCondition {
  if (!terminal) {
    return condition({
      kind: "journal-failure",
      severity: "Error",
      title: "Capture stopped — History commit failed",
      affected: intervalLabel(status),
      detail: `Typed cause ${reason}. Capture stopped at ${boundaryLabel(status.committedEvidenceBoundary)}. The failed batch and tail were not Evidence and did not affect Topology or COMMAND projections.`,
      recovery: "Preserve retained Evidence, restore storage if needed, and reopen DevTools; there is no mid-session adapter switch or resume",
      announcement: "Capture stopped because the Event History journal failed."
    });
  }
  return condition({
    kind: "journal-failure",
    severity: "Error",
    title: "Capture stopped — History commit failed",
    affected: intervalLabel(status),
    detail: `Typed cause ${terminal.reason}. Failed batch first captured-event identity: ${terminal.firstMissingEventId ?? "none recorded"}. Final ${boundaryLabel(terminal.committedEvidenceBoundary)}. ${rangeLabel(terminal.retainedRange)}. rejected ${terminal.rejected.count.toLocaleString()} / ${terminal.rejected.bytes.toLocaleString()} bytes; discarded ${terminal.discarded.count.toLocaleString()} / ${terminal.discarded.bytes.toLocaleString()} bytes. The failed batch and tail were not Evidence and did not affect Topology or COMMAND projections. Clear cannot restart Capture.`,
    recovery: "Preserve retained Evidence, restore storage if needed, and reopen DevTools; there is no mid-session adapter switch or resume",
    announcement: "Capture stopped because the Event History journal failed."
  });
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

function rangeLabel(range: HistoryStatus["retainedRange"]): string {
  return range
    ? `Retained Range ${range.first.sequence}–${range.last.sequence} (${range.first.eventId}–${range.last.eventId})`
    : "Retained Range none";
}

function firstMissingLabel(status: HistoryStatus, problem: HistoryProblem | undefined): string {
  return `first missing captured-event identity ${status.terminal?.firstMissingEventId ?? problem?.terminal?.firstMissingEventId ?? "not yet known"}`;
}

function bytesInMiB(bytes: number): string {
  return `${Math.round(bytes / MIB).toLocaleString()} MiB`;
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} bytes (${bytesInMiB(bytes)})`;
}
