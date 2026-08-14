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
  type HistoryFollowOptions,
  type HistoryInterval,
  type HistoryPublication,
  type Outcome
} from "../../core/event-history-authoritative";
import {
  type EvidenceFilterQueryAdapter,
  type EvidenceFilterReadProblem,
  type EvidenceQueryRequest,
  type EvidenceSnapshot
} from "../../core/evidence-filter-contract";

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

export type CommittedEvidencePipelineProgress = Readonly<{
  phase: "IDLE" | "RECOVERING" | "LIVE" | "CANCELLED" | "FAILED";
  intervalId: string | null;
  highestContiguousAppliedSequence: number | null;
  appliedBoundary: EvidenceRef | null;
  exceptionalGapCount: number;
  maxExceptionalGapCount: number;
}>;

export type CommittedEvidencePipelineFollowerState = Readonly<{
  progress: CommittedEvidencePipelineProgress;
  interval: HistoryInterval | null;
  problem?: Readonly<{ code: string; message: string }>;
}>;

export type CommittedEvidencePipeline = Readonly<{
  /**
   * Starts a single follower over the current interval with full replay.
   */
  start(): void;

  /** Restarts or resumes the follower strictly after an applied boundary. */
  restart(after?: EvidenceRef): void;

  /** Cancels an in-flight replay without publishing stale recovery effects. */
  cancelRecovery(): void;

  /** Returns bounded applied progress for the current History Interval. */
  progress(): CommittedEvidencePipelineProgress;

  /**
   * Offers one candidate into authoritative EventHistory.
   */
  offer(candidate: EvidenceCandidate): CommittedEvidencePipelineOfferReceipt;

  /**
   * Delegates to authoritative `read`.
   */
  read(query: EvidenceQuery): Promise<Outcome<EvidenceRead>>;

  /**
   * Delegates one storage-neutral, read-point-latched Evidence investigation
   * query. The pipeline never falls back to legacy `read` for this seam.
   */
  query(request: EvidenceQueryRequest): Promise<
    | Readonly<{ ok: true; value: EvidenceSnapshot }>
    | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>
  >;

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
  replayChunkSize?: number;
  onFollowerState?(state: CommittedEvidencePipelineFollowerState): void;
}>;

export type CommittedEvidencePipelineOptions = Readonly<{
  onCommittedEvidence(entry: CommittedEvidence): void;
  onHistoryPublication?(publication: HistoryPublication): void;
  history?: EventHistory;
  panelSessionId?: string;
  replayChunkSize?: number;
  onFollowerState?(state: CommittedEvidencePipelineFollowerState): void;
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

function normalizeReplayChunkSize(value: number | undefined): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) return 256;
  return Math.min(2_048, value);
}

export function bindCommittedEvidencePipeline(
  options: CommittedEvidencePipelineBinderOptions
): CommittedEvidencePipeline {
  const onCommittedEvidence = options.onCommittedEvidence;
  const onHistoryPublication = options.onHistoryPublication;
  const onFollowerState = options.onFollowerState;
  const history = options.history;
  const replayChunkSize = normalizeReplayChunkSize(options.replayChunkSize);
  const exceptionalGaps = new Map<number, CommittedEvidence>();
  const MAX_EXCEPTIONAL_GAPS = 64;
  let subscribe: (() => void) | null = null;
  let running = false;
  let closed = false;
  let restarting = false;
  let followGeneration = 0;
  let replayLifecycleObserved = false;
  let requestedRestartBoundary: EvidenceRef | null | undefined;
  let followerInterval: HistoryInterval | null = null;
  let progressPhase: CommittedEvidencePipelineProgress["phase"] = "IDLE";
  let progressIntervalId: string | null = null;
  let highestContiguousAppliedSequence: number | null = null;
  let appliedBoundary: EvidenceRef | null = null;
  let nextExpectedSequence: number | null = null;
  let maxExceptionalGapCount = 0;
  let failedEntryKey: string | null = null;
  let failedEntryAttempts = 0;
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

  function progressSnapshot(): CommittedEvidencePipelineProgress {
    return Object.freeze({
      phase: progressPhase,
      intervalId: progressIntervalId,
      highestContiguousAppliedSequence,
      appliedBoundary,
      exceptionalGapCount: exceptionalGaps.size,
      maxExceptionalGapCount
    });
  }

  function publishFollowerState(problem?: Readonly<{ code: string; message: string }>): void {
    try {
      onFollowerState?.({
        progress: progressSnapshot(),
        interval: followerInterval,
        ...(problem ? { problem } : {})
      });
    } catch {
      // A diagnostic observer cannot change the Evidence acceptance boundary.
    }
  }

  function setFollowerPhase(
    phase: CommittedEvidencePipelineProgress["phase"],
    problem?: Readonly<{ code: string; message: string }>
  ): void {
    progressPhase = phase;
    publishFollowerState(problem);
  }

  function resetAppliedProgress(after: EvidenceRef | null, interval: HistoryInterval | null = null): void {
    exceptionalGaps.clear();
    followerInterval = interval;
    progressIntervalId = after?.intervalId ?? interval?.id ?? null;
    highestContiguousAppliedSequence = after?.sequence ?? null;
    appliedBoundary = after;
    nextExpectedSequence = after === null ? null : after.sequence + 1;
  }

  function sameEvidenceReference(left: EvidenceRef | null, right: EvidenceRef): boolean {
    return left !== null && left.intervalId === right.intervalId && left.sequence === right.sequence && left.eventId === right.eventId;
  }

  function entryKey(entry: CommittedEvidence): string {
    return evidenceKey(entry);
  }

  function unsubscribeCurrent(): void {
    const current = subscribe;
    subscribe = null;
    followGeneration += 1;
    current?.();
  }

  function failFollower(message: string, code = "REPLAY_FAILED"): void {
    if (progressPhase === "FAILED" || closed) return;
    setFollowerPhase("FAILED", { code, message });
    unsubscribeCurrent();
  }

  function applyOne(entry: CommittedEvidence): void {
    onCommittedEvidence(entry);
    appliedBoundary = Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
    progressIntervalId = entry.intervalId;
    highestContiguousAppliedSequence = entry.sequence;
    nextExpectedSequence = entry.sequence + 1;
  }

  function applyInOrder(entry: CommittedEvidence): void {
    if (progressPhase === "FAILED" || progressPhase === "CANCELLED" || closed) return;
    if (progressIntervalId === null) {
      progressIntervalId = entry.intervalId;
      nextExpectedSequence = entry.sequence;
    }
    if (entry.intervalId !== progressIntervalId) {
        failFollower("Committed publication crossed interval.");
      return;
    }
    if (nextExpectedSequence === null) nextExpectedSequence = entry.sequence;
    if (entry.sequence < nextExpectedSequence) {
      // The applied boundary is the only retained identity needed to suppress
      // ordinary duplicate publications. Older duplicates cannot create an
      // additional projection effect because they are below the contiguous
      // boundary.
      return;
    }
    if (entry.sequence > nextExpectedSequence) {
      const previous = exceptionalGaps.get(entry.sequence);
      if (previous && entryKey(previous) !== entryKey(entry)) {
        failFollower("Conflicting identity.");
        return;
      }
      if (!previous) {
        if (exceptionalGaps.size >= MAX_EXCEPTIONAL_GAPS) {
          failFollower("Gap limit exceeded.");
          return;
        }
        exceptionalGaps.set(entry.sequence, entry);
        maxExceptionalGapCount = Math.max(maxExceptionalGapCount, exceptionalGaps.size);
        publishFollowerState();
      }
      return;
    }
    try {
      applyOne(entry);
      while (nextExpectedSequence !== null) {
        const next = exceptionalGaps.get(nextExpectedSequence);
        if (!next) break;
        exceptionalGaps.delete(nextExpectedSequence);
        applyOne(next);
      }
      publishFollowerState();
    } catch (error) {
      handleObserverFailure(entry, error);
    }
  }

  function handleObserverFailure(entry: CommittedEvidence, error: unknown): void {
    const key = entryKey(entry);
    if (failedEntryKey !== key) {
      failedEntryKey = key;
      failedEntryAttempts = 0;
    }
    failedEntryAttempts += 1;
    if (failedEntryAttempts <= 2) {
      scheduleRestart(error);
      return;
    }
    failFollower(
      error instanceof Error ? error.message : "Observer failed.",
      "REPLAY_FAILED"
    );
  }

  function handleReplayStarted(publication: Extract<HistoryPublication, { type: "replay-started" }>): void {
    replayLifecycleObserved = true;
    followerInterval = publication.interval;
    resetAppliedProgress(publication.after, publication.interval);
    nextExpectedSequence = publication.after?.sequence !== undefined
      ? publication.after.sequence + 1
      : publication.retainedRange?.first.sequence ?? null;
    setFollowerPhase("RECOVERING");
  }

  function handleReplayComplete(publication: Extract<HistoryPublication, { type: "replay-complete" }>): void {
    replayLifecycleObserved = true;
    if (exceptionalGaps.size > 0) {
      failFollower("Replay gap.");
      return;
    }
    followerInterval = publication.interval;
    setFollowerPhase("LIVE");
  }

  function handleReplayCancelled(publication: Extract<HistoryPublication, { type: "replay-cancelled" }>): void {
    replayLifecycleObserved = true;
    followerInterval = publication.interval;
    setFollowerPhase("CANCELLED");
  }

  function handleReplayFailed(publication: Extract<HistoryPublication, { type: "replay-failed" }>): void {
    replayLifecycleObserved = true;
    followerInterval = publication.interval;
    failFollower(publication.problem.message, publication.problem.code);
  }

  function startFollowing(): void {
    if (closed || !running) {
      return;
    }
    unsubscribeCurrent();
    const generation = ++followGeneration;
    replayLifecycleObserved = false;
    const after = requestedRestartBoundary !== undefined
      ? requestedRestartBoundary
      : appliedBoundary;
    requestedRestartBoundary = undefined;
    resetAppliedProgress(after, followerInterval);
    setFollowerPhase("RECOVERING");

    const observer = (publication: Parameters<Parameters<EventHistory["follow"]>[1]>[0]) => {
      if (generation !== followGeneration || closed) return;
      if (publication.type === "replay-started") {
        handleReplayStarted(publication);
        onHistoryPublication?.(publication);
        return;
      }
      if (publication.type === "replay-complete") {
        handleReplayComplete(publication);
        onHistoryPublication?.(publication);
        return;
      }
      if (publication.type === "replay-cancelled") {
        handleReplayCancelled(publication);
        onHistoryPublication?.(publication);
        return;
      }
      if (publication.type === "replay-failed") {
        handleReplayFailed(publication);
        onHistoryPublication?.(publication);
        return;
      }
      if (publication.type === "interval-cleared") {
        const previousBoundary = publication.status.committedEvidenceBoundary ?? appliedBoundary;
        followerInterval = publication.interval;
        resetAppliedProgress(null, publication.interval);
        nextExpectedSequence = previousBoundary?.sequence !== undefined ? previousBoundary.sequence + 1 : null;
        setFollowerPhase("LIVE");
        onHistoryPublication?.(publication);
        return;
      }
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
      onHistoryPublication?.(publication);
      for (const entry of publication.evidence) {
        if (failedEntryKey === entryKey(entry) && failedEntryAttempts >= 2) {
          failFollower("Observer failed twice.");
          return;
        }
        applyInOrder(entry);
        if (progressPhase === "FAILED") return;
      }
    };

    const followOptions: HistoryFollowOptions = {
      from: "CURRENT_INTERVAL_START",
      ...(options.replayChunkSize !== undefined ? { chunkSize: replayChunkSize } : {}),
      ...(after ? { after } : {})
    };
    subscribe = history.follow(followOptions, observer);
    // Small test doubles and legacy adapters may complete replay synchronously
    // without the lifecycle publications. Treat that path as a coherent
    // boundary while the authoritative adapters use explicit lifecycle events.
    if (!replayLifecycleObserved && generation === followGeneration && progressPhase === "RECOVERING") {
      setFollowerPhase("LIVE");
    }
  }

  function scheduleRestart(cause: unknown): void {
    if (closed || restarting || progressPhase === "FAILED" || progressPhase === "CANCELLED") {
      return;
    }
    unsubscribeCurrent();
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
    restart(after?: EvidenceRef) {
      if (closed) return;
      running = true;
      failedEntryKey = null;
      failedEntryAttempts = 0;
      const current = appliedBoundary;
      const effectiveBoundary = after && current && after.intervalId === current.intervalId && after.sequence < current.sequence
        ? current
        : (after === undefined ? current : after);
      requestedRestartBoundary = effectiveBoundary;
      unsubscribeCurrent();
      restarting = true;
      queueMicrotask(() => {
        restarting = false;
        if (!closed) startFollowing();
      });
    },
    cancelRecovery() {
      if (closed) return;
      unsubscribeCurrent();
      running = false;
      setFollowerPhase("CANCELLED");
    },
    progress() {
      return progressSnapshot();
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
    query(request: EvidenceQueryRequest) {
      if (closed) {
        return Promise.resolve({
          ok: false as const,
          problem: {
            code: "HISTORY_TERMINAL" as const,
            message: "The committed-evidence pipeline is closed and cannot query Evidence."
          }
        });
      }
      const queryAdapter = history.query as EvidenceFilterQueryAdapter["query"] | undefined;
      if (!queryAdapter) {
        return Promise.resolve({
          ok: false as const,
          problem: {
            code: "QUERY_FAILED" as const,
            message: "The committed Event History does not expose the canonical Evidence query capability."
          }
        });
      }
      return trackRead(queryAdapter.call(history, request));
    },
    async clear(): Promise<Outcome<ClearResult>> {
      return history.clear();
    },
    async close(): Promise<Outcome<CloseResult>> {
      if (closePromise) return closePromise;
      closed = true;
      running = false;
      if (subscribe !== null) {
        unsubscribeCurrent();
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
    onHistoryPublication: options.onHistoryPublication,
    ...(options.replayChunkSize !== undefined ? { replayChunkSize: options.replayChunkSize } : {}),
    onFollowerState: options.onFollowerState
  });
}
