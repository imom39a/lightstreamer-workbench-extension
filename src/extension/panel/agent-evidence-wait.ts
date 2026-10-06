import type { DeterministicEvidenceRecord, EvidenceReadPoint, EvidenceSnapshot, EvidenceSequenceWindow } from "../../core/evidence-filter-contract";
import type { HistoryStatus } from "../../core/event-history-authoritative";

export type AgentEvidenceWaitStatus = "MATCHED" | "TIMED_OUT" | "CANCELLED" | "HISTORY_CHANGED" | "HISTORY_INCOMPLETE" | "HISTORY_UNAVAILABLE" | "TARGET_CHANGED" | "QUERY_FAILED";
export type AgentEvidenceWaitResult = Readonly<{
  status: AgentEvidenceWaitStatus;
  reason: string;
  after: EvidenceReadPoint;
  readPoint: EvidenceReadPoint | null;
  evidence: readonly DeterministicEvidenceRecord[];
  mayHaveMoreMatches: boolean;
  sequenceWindow: Readonly<{ after: number; through: number }>;
}>;

/** Notify-only subscription, installed before the first bounded canonical query. */
export type AgentEvidenceWaitSource = Readonly<{
  status(): { pageEpoch: string | null; history: HistoryStatus };
  subscribe(listener: () => void): () => void;
  query(signal: AbortSignal, window: EvidenceSequenceWindow): Promise<EvidenceSnapshot>;
}>;

/**
 * Wait for a positive observation, not proof of application state or absence.
 * Queries are newest-first bounded pages. No page traversal, timers per event,
 * retained-history copies, or reads concurrent with another read are needed.
 */
export function waitForAgentEvidence(
  source: AgentEvidenceWaitSource,
  input: { after: EvidenceReadPoint; pageEpoch: string; timeoutMs: number; signal?: AbortSignal }
): Promise<AgentEvidenceWaitResult> {
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 0 || input.timeoutMs > 20000) throw new Error("Wait timeout must be between 0 and 20000 ms.");
  const afterSequence = input.after.committedEvidenceBoundary?.sequence ?? 0;
  return new Promise(resolve => {
    const controller = new AbortController();
    let finished = false;
    let reading = false;
    let dirty = false;
    let lastSignature: string | undefined;
    let latest: EvidenceSnapshot | null = null;
    let scannedThrough = afterSequence;
    let unsubscribe = () => {};
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    function finish(status: AgentEvidenceWaitStatus, reason: string, evidence: readonly DeterministicEvidenceRecord[] = []) {
      if (finished) return;
      finished = true;
      clearTimeout(scheduled); clearTimeout(deadline);
      unsubscribe();
      input.signal?.removeEventListener("abort", cancelled);
      controller.abort();
      resolve({ status, reason, after: input.after, readPoint: latest?.readPoint ?? null, evidence,
        sequenceWindow: { after: afterSequence, through: scannedThrough },
        mayHaveMoreMatches: evidence.length > 0 && Boolean(latest?.page.nextCursor) && evidence.at(-1)!.identity.sequence > afterSequence });
    }
    function cancelled() { finish("CANCELLED", "The observation request was cancelled; no Injection was performed."); }
    function checkContinuity(): ReturnType<AgentEvidenceWaitSource["status"]> | null {
      const current = source.status();
      if (current.pageEpoch !== input.pageEpoch) { finish("TARGET_CHANGED", "The inspected page changed. Inspect the new target before continuing."); return null; }
      if (current.history.interval.id !== input.after.interval.id || current.history.interval.ordinal !== input.after.interval.ordinal) {
        finish("HISTORY_CHANGED", "The History Interval changed; the supplied boundary no longer describes this history."); return null;
      }
      if (current.history.phase !== "RUNNING") { finish("HISTORY_UNAVAILABLE", "Event History is no longer accepting Evidence."); return null; }
      if (afterSequence > (current.history.committedEvidenceBoundary?.sequence ?? 0)) {
        finish("HISTORY_CHANGED", "The supplied boundary is ahead of committed Event History."); return null;
      }
      if ((current.history.retainedRange?.first.sequence ?? 1) > afterSequence + 1) {
        finish("HISTORY_INCOMPLETE", "Retention advanced past part of the requested observation window. This is not an Evidence Gap."); return null;
      }
      const gap = current.history.continuity?.latestGap;
      if (current.history.continuity?.state === "GAPPED" && (!gap || (gap.afterEvidence?.sequence ?? 0) >= afterSequence)) {
        finish("HISTORY_INCOMPLETE", "Event History reports an Evidence Gap; this wait cannot establish a continuous observation window. Query retained Evidence directly."); return null;
      }
      return current;
    }
    function changed() {
      if (finished) return;
      dirty = true;
      if (!reading && scheduled === undefined) scheduled = setTimeout(() => { scheduled = undefined; void read(); }, 100);
    }
    async function read() {
      if (finished || reading) return;
      reading = true; dirty = false;
      try {
        const current = checkContinuity();
        if (!current) return;
        const signature = JSON.stringify([current.pageEpoch, current.history.interval, current.history.committedEvidenceBoundary, current.history.retainedRange?.first, current.history.continuity]);
        if (signature === lastSignature) return;
        lastSignature = signature;
        const through = current.history.committedEvidenceBoundary?.sequence ?? 0;
        const snapshot = await source.query(controller.signal, { after: scannedThrough, through });
        if (finished || !checkContinuity()) return;
        latest = snapshot;
        if (snapshot.readPoint.interval.id !== input.after.interval.id) { finish("HISTORY_CHANGED", "The query crossed a History Interval change."); return; }
        if (snapshot.evaluation !== "COMPLETE") { finish("QUERY_FAILED", "The query could not evaluate all requested criteria."); return; }
        scannedThrough = Math.min(through, snapshot.readPoint.committedEvidenceBoundary?.sequence ?? through);
        const evidence = snapshot.page.evidence.filter(record => record.identity.intervalId === input.after.interval.id && record.identity.sequence > afterSequence);
        if (evidence.length) { finish("MATCHED", "Matching committed Evidence was observed after the supplied boundary. This does not prove application behavior.", evidence); return; }
        if (input.timeoutMs === 0) finish("TIMED_OUT", "No match was observed through the returned read point; no absence claim extends beyond it.");
      } catch (error) {
        if (!finished) finish("QUERY_FAILED", error instanceof Error ? error.message : "The observation query failed.");
      } finally {
        reading = false;
        if (dirty && !finished) changed();
      }
    }
    if (input.signal?.aborted) { cancelled(); return; }
    input.signal?.addEventListener("abort", cancelled, { once: true });
    // Observe before reading, so a commit racing the read always schedules a recheck.
    try { unsubscribe = source.subscribe(changed); }
    catch { finish("QUERY_FAILED", "Evidence observation is unavailable."); return; }
    deadline = setTimeout(() => {
      // A target/history change in the coalescing window still takes precedence
      // over timeout, even when its scheduled recheck has not run yet.
      if (!checkContinuity()) return;
      finish(latest ? "TIMED_OUT" : "QUERY_FAILED", latest
        ? "No match was observed through the returned read point before timeout; later commits may exist."
        : "No Evidence read completed within the bounded observation window.");
    }, input.timeoutMs === 0 ? 1000 : input.timeoutMs);
    void read();
  });
}
