import {
  openEventHistory,
  type CaptureReceipt,
  type ClearResult,
  type CommittedEvidence,
  type CloseResult,
  type EvidenceCandidate,
  type EvidenceQuery,
  type EvidenceRead,
  type EvidenceRef,
  type EventHistory,
  type HistoryPublication,
  type Outcome
} from "../../core/event-history-authoritative";

export type CommittedEvidencePipelineOfferReceipt = CaptureReceipt & Readonly<{
  /**
   * The first evidence identity that was refused because it is missing or invalid.
   * Preserved from the first observed refused/rejected case for visibility.
   */
  firstRefusedOrRejectedMissingIdentity: string | null;
}>;

export type CommittedEvidencePipelineStartupMetadata = Readonly<{
  /**
   * Capture coverage status reported at startup. Memory-mode startup never marks
   * this as LIMITED.
   */
  coverage: "USEFUL" | "LIMITED";
}>;

export type CommittedEvidencePipeline = Readonly<{
  /**
   * Starts a single follower over the current interval with full replay.
   */
  start(): void;

  /**
   * Offers one candidate into authoritative EventHistory.
   */
  offer(candidate: EvidenceCandidate): CommittedEvidencePipelineOfferReceipt;

  /**
   * Delegates to authoritative `read`.
   */
  read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>>;

  /**
   * Delegates to authoritative `clear`.
   */
  clear(): Promise<Outcome<ClearResult>>;

  /**
   * Delegates to authoritative `close`.
   */
  close(): Promise<Outcome<CloseResult>>;

  /**
   * Returns startup metadata captured before any committed callback handling.
   */
  startupMetadata(): CommittedEvidencePipelineStartupMetadata;

  /**
   * Returns the first missing identity reported during refused/rejected offers.
   */
  firstMissingIdentity(): string | null;
}>;

export type CommittedEvidencePipelineBinderOptions = Readonly<{
  history: EventHistory;
  onCommittedEvidence(entry: CommittedEvidence): void;
  onHistoryPublication?(publication: HistoryPublication): void;
}>;

export type CommittedEvidencePipelineOptions = Readonly<{
  onCommittedEvidence(entry: CommittedEvidence): void;
  onHistoryPublication?(publication: HistoryPublication): void;
  history?: EventHistory;
  panelSessionId?: string;
}>;

type DeliveryStatus =
  | "success"
  | "stale-target"
  | "listener-error"
  | "wire-error"
  | "bridge-error"
  | "acknowledgement-unknown";

export type LocalDeliveryExecutionResult = Readonly<{
  requestId: string;
  ok: boolean;
  status: DeliveryStatus;
  timestamp: number;
  error?: string;
  attemptedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}>;

export type LocalDeliveryOutcome = Readonly<{
  disposition: "delivered" | "blocked" | "failed" | "partial" | "acknowledgement-unknown";
  headline: "DELIVERED LOCALLY" | "NOT RUN" | "DELIVERY FAILED" | "PARTIALLY DELIVERED" | "DELIVERY UNKNOWN";
  status: DeliveryStatus;
  executionId: string;
  requestId: string | null;
  timestamp: number;
  detail: string;
  attemptedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}>;

export type LocalDeliveryHelperResult = Readonly<{
  outcome: LocalDeliveryOutcome;
  withSyntheticReceipt(
    receipt: CaptureReceipt,
    callback: (evidence: EvidenceRef) => void
  ): Promise<boolean>;
}>;

function evidenceIdentityLabel(candidate: unknown): string {
  if (!candidate || typeof candidate !== "object") {
    return "<missing-identity>";
  }
  const candidateObject = candidate as { id?: unknown };
  const id = candidateObject.id;
  if (typeof id === "string" && id.length > 0) {
    return id;
  }
  return "<missing-identity>";
}

function evidenceKey(reference: EvidenceRef): string {
  return `${reference.intervalId}::${reference.sequence}`;
}

function localDeliveryCounts(result: LocalDeliveryExecutionResult): Pick<LocalDeliveryOutcome, "attemptedCount" | "deliveredCount" | "failedCount"> {
  return {
    ...(result.attemptedCount !== undefined ? { attemptedCount: result.attemptedCount } : {}),
    ...(result.deliveredCount !== undefined ? { deliveredCount: result.deliveredCount } : {}),
    ...(result.failedCount !== undefined ? { failedCount: result.failedCount } : {})
  };
}

function localDeliveryOutcome(executionId: string, result: LocalDeliveryExecutionResult): LocalDeliveryOutcome {
  if (result.status === "success") {
    return Object.freeze({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      status: result.status,
      executionId,
      requestId: result.requestId,
      timestamp: result.timestamp,
      detail: "The update was delivered through the protected local page target. No server was contacted.",
      ...localDeliveryCounts(result)
    });
  }
  if (result.status === "stale-target") {
    return Object.freeze({
      disposition: "blocked",
      headline: "NOT RUN",
      status: result.status,
      executionId,
      requestId: result.requestId,
      timestamp: result.timestamp,
      detail: `BLOCKED · ${result.error ?? "The protected target is stale."}`,
      ...localDeliveryCounts(result)
    });
  }
  if (result.status === "acknowledgement-unknown") {
    return Object.freeze({
      disposition: "acknowledgement-unknown",
      headline: "DELIVERY UNKNOWN",
      status: result.status,
      executionId,
      requestId: result.requestId,
      timestamp: result.timestamp,
      detail: result.error ?? "The page may have executed the request, but Workbench did not receive a trustworthy acknowledgement. No retry was attempted.",
      ...localDeliveryCounts(result)
    });
  }
  if (result.status === "listener-error" && (result.deliveredCount ?? 0) > 0) {
    return Object.freeze({
      disposition: "partial",
      headline: "PARTIALLY DELIVERED",
      status: result.status,
      executionId,
      requestId: result.requestId,
      timestamp: result.timestamp,
      detail: result.error ?? "Some captured listeners received the update and at least one listener failed.",
      ...localDeliveryCounts(result)
    });
  }
  return Object.freeze({
    disposition: "failed",
    headline: "DELIVERY FAILED",
    status: result.status,
    executionId,
    requestId: result.requestId,
    timestamp: result.timestamp,
    detail: result.error ?? "The local delivery target rejected the update.",
    ...localDeliveryCounts(result)
  });
}

export function createLocalDeliveryHelper(
  executionId: string,
  executionResult: LocalDeliveryExecutionResult
): LocalDeliveryHelperResult {
  const outcome = localDeliveryOutcome(executionId, executionResult);
  return {
    outcome,
    async withSyntheticReceipt(
      syntheticReceipt: CaptureReceipt,
      callback: (evidence: EvidenceRef) => void
    ): Promise<boolean> {
      const settled = await syntheticReceipt.settled;
      if (settled.outcome === "BECAME_EVIDENCE") {
        callback(settled.evidence);
        return true;
      }
      return false;
    }
  };
}

export function bindCommittedEvidencePipeline(
  options: CommittedEvidencePipelineBinderOptions
): CommittedEvidencePipeline {
  const onCommittedEvidence = options.onCommittedEvidence;
  const onHistoryPublication = options.onHistoryPublication;
  const history = options.history;
  const seen = new Set<string>();
  const retriableFailures = new Set<string>();
  let subscribe: (() => void) | null = null;
  let running = false;
  let closed = false;
  let restarting = false;
  let closePromise: Promise<Outcome<CloseResult>> | null = null;
  let firstMissingIdentity: string | null = null;
  let startupMetadata: CommittedEvidencePipelineStartupMetadata = Object.freeze({ coverage: "USEFUL" });
  const activeReads = new Set<Promise<unknown>>();

  function trackRead<T>(operation: Promise<T>): Promise<T> {
    activeReads.add(operation);
    void operation.then(
      () => activeReads.delete(operation),
      () => activeReads.delete(operation)
    );
    return operation;
  }

  function startFollowing(): void {
    if (closed || !running) {
      return;
    }
    if (subscribe !== null) {
      subscribe();
      subscribe = null;
    }

    const observer = (publication: Parameters<Parameters<EventHistory["follow"]>[1]>[0]) => {
      if (publication.type === "status") {
        onHistoryPublication?.(publication);
        if (publication.status.fallback === "PRIMARY_JOURNAL_UNAVAILABLE") {
          startupMetadata = Object.freeze({ coverage: "USEFUL" });
        }
        return;
      }
      if (publication.type === "terminal") {
        onHistoryPublication?.(publication);
        return;
      }
      if (publication.type !== "committed-evidence") {
        onHistoryPublication?.(publication);
        return;
      }
      for (const entry of publication.evidence) {
        const key = evidenceKey(entry);
        if (seen.has(key)) {
          continue;
        }
        try {
          onCommittedEvidence(entry);
          if (retriableFailures.has(key)) {
            retriableFailures.delete(key);
          }
          seen.add(key);
        } catch (error) {
          if (retriableFailures.has(key)) {
            seen.add(key);
          } else {
            retriableFailures.add(key);
          }
          scheduleRestart(error);
          throw error;
        }
      }
    };

    subscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, observer);
  }

  function scheduleRestart(cause: unknown): void {
    if (closed || restarting) {
      return;
    }
    if (subscribe !== null) {
      const current = subscribe;
      subscribe = null;
      current();
    }
    restarting = true;
    queueMicrotask(() => {
      restarting = false;
      if (!closed) {
        startFollowing();
      }
    });
  }

  return Object.freeze({
    start() {
      if (running || closed) {
        return;
      }
      running = true;
      startFollowing();
    },
    offer(candidate: EvidenceCandidate): CommittedEvidencePipelineOfferReceipt {
      const label = evidenceIdentityLabel(candidate);
      const receipt = history.offer(candidate);
      if (receipt.intake === "REFUSED") {
        if (firstMissingIdentity === null) {
          firstMissingIdentity = label;
        }
      } 
      if (receipt.intake !== "REFUSED") {
        void receipt.settled.then((result): void => {
          if (firstMissingIdentity === null && result.outcome === "NOT_EVIDENCE") {
            firstMissingIdentity = label;
          }
        }).catch(() => undefined);
      }
      const tracked = {
        ...receipt,
        get firstRefusedOrRejectedMissingIdentity(): string | null {
          return firstMissingIdentity;
        }
      } as CommittedEvidencePipelineOfferReceipt;
      return tracked;
    },
    async read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>> {
      if (closed) {
        return {
          ok: false,
          problem: {
            code: "HISTORY_CLOSED",
            message: "The committed-evidence pipeline is closed and cannot read evidence."
          }
        };
      }
      return trackRead(history.read(query));
    },
    async clear(): Promise<Outcome<ClearResult>> {
      return history.clear();
    },
    async close(): Promise<Outcome<CloseResult>> {
      if (closePromise) return closePromise;
      closed = true;
      if (subscribe !== null) {
        subscribe();
        subscribe = null;
      }
      closePromise = Promise.allSettled([...activeReads]).then(() => history.close());
      return closePromise;
    },
    startupMetadata() {
      return startupMetadata;
    },
    firstMissingIdentity() {
      return firstMissingIdentity;
    }
  });
}

export async function createCommittedEvidencePipeline(
  options: CommittedEvidencePipelineOptions
): Promise<CommittedEvidencePipeline> {
  const history = options.history ?? await openEventHistory({ panelSessionId: options.panelSessionId });
  return bindCommittedEvidencePipeline({
    history,
    onCommittedEvidence: options.onCommittedEvidence,
    onHistoryPublication: options.onHistoryPublication
  });
}
