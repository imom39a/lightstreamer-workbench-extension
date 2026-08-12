import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import {
  offerAndAwaitCommitted,
  waitForCommittedCount
} from "../src/extension/panel/performance-harness-history";

function candidate(id: string) {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound" as const,
    source: "server" as const,
    synthetic: false,
    kind: "item-update" as const
  };
}

function observableHistory(inner: EventHistory) {
  let activeSubscriptions = 0;
  const history = {
    ...inner,
    follow(options: Parameters<EventHistory["follow"]>[0], observer: Parameters<EventHistory["follow"]>[1]) {
      activeSubscriptions += 1;
      const unsubscribe = inner.follow(options, observer);
      return () => {
        activeSubscriptions -= 1;
        unsubscribe();
      };
    }
  } as EventHistory;
  return { history, activeSubscriptions: () => activeSubscriptions };
}

describe("authoritative panel performance harness history seam", () => {
  it("resolves an empty committed boundary as null without subscribing", async () => {
    const inner = await createMemoryEventHistoryForTests();
    const observed = observableHistory(inner);
    const waiter = waitForCommittedCount(observed.history, 0);

    await expect(waiter.promise).resolves.toBeNull();
    expect(observed.activeSubscriptions()).toBe(0);
    await inner.close();
  });

  it("rejects a refused receipt and unsubscribes instead of hanging", async () => {
    const inner = await createMemoryEventHistoryForTests({
      commitBatch: async () => { throw new Error("commit rejected"); }
    });
    const observed = observableHistory(inner);

    await expect(offerAndAwaitCommitted(observed.history, [candidate("rejected")])).rejects.toThrow(/not committed|terminal/);
    expect(observed.activeSubscriptions()).toBe(0);
    await inner.close();
  });

  it("fails before a later unsettled receipt and removes the follow subscription", async () => {
    let unsubscribeCount = 0;
    let resolveLater!: (value: never) => void;
    const later = new Promise<never>((resolve) => { resolveLater = resolve; });
    const refusal = {
      intake: "REFUSED" as const,
      settled: Promise.resolve({
        outcome: "NOT_EVIDENCE" as const,
        problem: { code: "CAPACITY_EXHAUSTED", message: "refused" },
        committedEvidenceBoundary: null
      })
    };
    const history = {
      storage: { mode: "memory" as const },
      offer: vi.fn()
        .mockReturnValueOnce(refusal)
        .mockReturnValueOnce({ intake: "QUEUED", settled: later }),
      read: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
      follow: vi.fn(() => () => { unsubscribeCount += 1; })
    } as unknown as EventHistory;

    const pending = offerAndAwaitCommitted(history, [candidate("refused"), candidate("later")]);
    await Promise.resolve();
    try {
      expect(unsubscribeCount).toBe(1);
      await expect(pending).rejects.toThrow("not committed");
    } finally {
      resolveLater(undefined as never);
    }
  });

  it("fails on a rejected receipt and removes the follow subscription", async () => {
    let unsubscribeCount = 0;
    const history = {
      storage: { mode: "memory" as const },
      offer: vi.fn().mockReturnValue({
        intake: "QUEUED" as const,
        settled: Promise.reject(new Error("receipt rejected"))
      }),
      read: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
      follow: vi.fn(() => () => { unsubscribeCount += 1; })
    } as unknown as EventHistory;

    await expect(offerAndAwaitCommitted(history, [candidate("rejected-receipt")])).rejects.toThrow("receipt rejected");
    expect(unsubscribeCount).toBe(1);
  });

  it("fails immediately when terminal arrives while another receipt never settles", async () => {
    const observerRef: { current: ((publication: HistoryPublication) => void) | null } = { current: null };
    let unsubscribeCount = 0;
    const accepted = {
      intake: "QUEUED" as const,
      settled: Promise.resolve({
        outcome: "BECAME_EVIDENCE" as const,
        evidence: { intervalId: "interval", sequence: 1, eventId: "accepted" }
      })
    };
    const neverSettles = new Promise<never>(() => undefined);
    const history = {
      storage: { mode: "memory" as const },
      offer: vi.fn()
        .mockReturnValueOnce(accepted)
        .mockReturnValueOnce({ intake: "QUEUED", settled: neverSettles }),
      read: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
      follow: vi.fn((_options, next) => {
        observerRef.current = next;
        return () => { unsubscribeCount += 1; };
      })
    } as unknown as EventHistory;

    const pending = offerAndAwaitCommitted(history, [candidate("accepted"), candidate("pending")]);
    observerRef.current?.({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        tier: "LOWER",
        triggerTime: 1,
        triggerInterval: { id: "interval", ordinal: 1 },
        interval: { id: "interval", ordinal: 1 },
        committedEvidenceBoundary: null,
        retainedRange: null,
        firstMissingEventId: "pending",
        rejected: { count: 1, bytes: 1 },
        discarded: { count: 0, bytes: 0 },
        triggerMeasurements: {
          retainedCount: 0,
          retainedBytes: 0,
          pendingCount: 1,
          pendingBytes: 1,
          oldestPendingAgeMs: 1
        }
      },
      status: {} as never
    });

    const result = await Promise.race([
      pending.then(() => "resolved", () => "rejected"),
      new Promise<"timed-out">((resolve) => setTimeout(() => resolve("timed-out"), 50))
    ]);
    expect(result).toBe("rejected");
    expect(unsubscribeCount).toBe(1);
  });

  it("rejects a terminal publication and unsubscribes promptly", async () => {
    const observerRef: { current: ((publication: HistoryPublication) => void) | null } = { current: null };
    let unsubscribeCount = 0;
    const history = {
      storage: { mode: "memory" as const },
      offer: vi.fn(),
      read: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(async () => ({ ok: true, value: { finalCommittedEvidenceBoundary: null, dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } })),
      follow: vi.fn((_options, next) => {
        observerRef.current = next;
        return () => { unsubscribeCount += 1; };
      })
    } as unknown as EventHistory;

    const waiter = waitForCommittedCount(history, 1);
    observerRef.current?.({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        tier: "LOWER",
        triggerTime: 1,
        triggerInterval: { id: "interval", ordinal: 1 },
        interval: { id: "interval", ordinal: 1 },
        committedEvidenceBoundary: null,
        retainedRange: null,
        firstMissingEventId: "terminal-missing",
        rejected: { count: 1, bytes: 1 },
        discarded: { count: 0, bytes: 0 },
        triggerMeasurements: {
          retainedCount: 0,
          retainedBytes: 0,
          pendingCount: 0,
          pendingBytes: 0,
          oldestPendingAgeMs: null
        },
      },
      status: {} as never
    });

    await expect(waiter.promise).rejects.toThrow("terminal");
    expect(unsubscribeCount).toBe(1);
  });

  it("cancels an outstanding waiter and removes its follow subscription", async () => {
    const inner = await createMemoryEventHistoryForTests();
    const observed = observableHistory(inner);
    const waiter = waitForCommittedCount(observed.history, 1);

    waiter.cancel(new Error("disposed"));

    await expect(waiter.promise).rejects.toThrow("disposed");
    expect(observed.activeSubscriptions()).toBe(0);
    await inner.close();
  });
});
