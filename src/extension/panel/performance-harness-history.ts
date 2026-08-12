import {
  type EvidenceCandidate,
  type EventHistory,
  type HistoryPublication
} from "../../core/event-history-authoritative";

type CommittedBoundary = Extract<HistoryPublication, { type: "committed-evidence" }>['committedEvidenceBoundary'];
type CommittedBoundaryResult = CommittedBoundary | null;

export type CommittedBoundaryWaiter = Readonly<{
  promise: Promise<CommittedBoundaryResult>;
  cancel(reason?: unknown): void;
}>;

export function waitForCommittedCount(
  history: EventHistory,
  expectedCount: number
): CommittedBoundaryWaiter {
  if (expectedCount === 0) {
    return { promise: Promise.resolve(null), cancel() {} };
  }

  let resolveWaiter!: (boundary: CommittedBoundaryResult) => void;
  let rejectWaiter!: (reason: unknown) => void;
  let settled = false;
  let removeAfterSubscribe = false;
  let unsubscribe: () => void = () => { removeAfterSubscribe = true; };
  let committedCount = 0;
  const promise = new Promise<CommittedBoundaryResult>((resolve, reject) => {
    resolveWaiter = resolve;
    rejectWaiter = reject;
  });

  const settle = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    unsubscribe();
    callback();
  };

  unsubscribe = history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
    if (publication.type === "terminal") {
      settle(() => rejectWaiter(new Error("Authoritative harness history reached terminal state before the committed boundary.")));
      return;
    }
    if (publication.type !== "committed-evidence") return;
    committedCount += publication.evidence.length;
    if (committedCount >= expectedCount) {
      settle(() => resolveWaiter(publication.committedEvidenceBoundary));
    }
  });
  if (removeAfterSubscribe) unsubscribe();

  return {
    promise,
    cancel(reason = new Error("Authoritative harness committed-boundary wait was cancelled.")) {
      settle(() => rejectWaiter(reason));
    }
  };
}

export async function offerAndAwaitCommitted(
  history: EventHistory,
  candidates: readonly EvidenceCandidate[]
): Promise<CommittedBoundary | null> {
  if (candidates.length === 0) return null;
  const waiter = waitForCommittedCount(history, candidates.length);
  try {
    const receipts = candidates.map((candidate) => history.offer(candidate));
    const [, boundary] = await Promise.all([
      Promise.all(receipts.map((receipt) =>
        receipt.settled.then(
          (outcome) => {
            if (outcome.outcome !== "BECAME_EVIDENCE") {
              const error = new Error("Authoritative harness offer was not committed as Evidence.");
              waiter.cancel(error);
              throw error;
            }
            return outcome;
          },
          (error) => {
            waiter.cancel(error);
            throw error;
          }
        )
      )),
      waiter.promise
    ]);
    const read = await history.read({ order: "asc" });
    if (!boundary || !read.ok || read.value.total < candidates.length || read.value.committedEvidenceBoundary?.eventId !== boundary.eventId) {
      throw new Error("Authoritative harness committed boundary did not cover the offered Evidence.");
    }
    return boundary;
  } catch (error) {
    waiter.cancel(error);
    throw error;
  }
}
