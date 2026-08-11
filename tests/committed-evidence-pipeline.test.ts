import { describe, expect, it, vi } from "vitest";

import {
  createCommittedEvidencePipeline,
  createLocalDeliveryHelper
} from "../src/extension/panel/committed-evidence-pipeline";
import {
  createMemoryEventHistoryForTests,
  type EvidenceCandidate,
  type EventHistory,
  type CaptureReceipt
} from "../src/core/event-history-authoritative";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function lightstreamerCandidate(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "command-sub", mode: "COMMAND" },
    update: { key: id, command: "ADD" },
    raw: { id }
  };
}

function asMissingIdentityCandidate(id: string): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "command-sub", mode: "COMMAND" },
    update: { key: id, command: "ADD" }
  } as unknown as EvidenceCandidate;
}

function createReplayableHistory(initial: EvidenceCandidate[]): EventHistory {
  const intervalId = "pipeline:interval-1";
  let sequence = 1;
  let clearCount = 1;
  const interval = { id: intervalId, ordinal: 1 };
  const evidence = initial.map((candidate) => ({
    intervalId,
    sequence: sequence++,
    eventId: candidate.id,
    candidate
  }));
  const subscribers = new Set<(publication: unknown) => void>();

  function publish(publication: unknown): void {
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(publication);
      } catch {
        subscribers.delete(subscriber);
      }
    }
  }

  return {
    offer(candidate) {
      const snapshot = {
        intervalId,
        sequence: sequence++,
        eventId: candidate.id,
        candidate
      };
      evidence.push(snapshot);
      publish({
        type: "committed-evidence",
        interval,
        evidence: [snapshot],
        committedEvidenceBoundary: snapshot
      });
      return {
        intake: "QUEUED",
        settled: Promise.resolve({ outcome: "BECAME_EVIDENCE", evidence: snapshot })
      };
    },
    read: async (query) => ({
      ok: true,
      value: {
        interval,
        evidence,
        total: evidence.length,
        committedEvidenceBoundary: evidence[evidence.length - 1] ?? null,
        retainedRange: evidence.length === 0 ? null : { first: evidence[0], last: evidence[evidence.length - 1] }
      } as const
    }),
    clear: async () => {
      clearCount += 1;
      const previousInterval = { ...interval };
      return {
        ok: true,
        value: {
          previousInterval,
          interval: { ...interval, ordinal: clearCount, id: `pipeline:interval-${clearCount}` }
        }
      };
    },
    follow: (options, observer) => {
      const subscriber = (publication: unknown): void => {
        observer(publication as never);
      };
      subscribers.add(subscriber);
      if (options.from === "CURRENT_INTERVAL_START") {
        if (evidence.length > 0) {
          publish({
            type: "committed-evidence",
            interval,
            evidence,
            committedEvidenceBoundary: evidence[evidence.length - 1]
          });
        }
      }
      return () => {
        subscribers.delete(subscriber);
      };
    },
    close: async () => ({
      ok: true,
      value: {
        finalCommittedEvidenceBoundary: evidence[evidence.length - 1] ?? null,
        dataDisposition: "ERASED",
        cleanupDisposition: "COMPLETE"
      }
    })
  };
}

describe("committed-evidence pipeline", () => {
  it("starts follow from CURRENT_INTERVAL_START and replays committed entries in order", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-current-start" });
    await history.offer(lightstreamerCandidate("before-a")).settled;
    await history.offer(lightstreamerCandidate("before-b")).settled;

    const committed: string[] = [];
    const follow = vi.spyOn(history, "follow");

    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: (entry) => {
        committed.push(entry.eventId);
      }
    });

    pipeline.start();
    await Promise.resolve();

    expect(committed).toEqual(["before-a", "before-b"]);
    expect(follow).toHaveBeenCalledWith(
      { from: "CURRENT_INTERVAL_START" },
      expect.any(Function)
    );
    await pipeline.close();
  });

  it("reports startup metadata as useful even when running in memory-backed mode", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-memory-metadata" });
    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: () => undefined
    });

    expect(pipeline.startupMetadata().coverage).toBe("USEFUL");
    pipeline.start();
    await Promise.resolve();
    expect(pipeline.startupMetadata().coverage).toBe("USEFUL");
    await pipeline.close();
  });

  it("suppresses duplicate committed callbacks while preserving sequence", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-duplicate" });
    await history.offer(lightstreamerCandidate("dup-a")).settled;
    await history.offer(lightstreamerCandidate("dup-b")).settled;

    const committed: string[] = [];
    const originalFollow = history.follow;
    const wrappedFollow = vi.spyOn(history, "follow").mockImplementation((options, observer) => {
      return originalFollow(options, (publication) => {
        observer(publication);
        observer(publication);
      });
    });

    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: (entry) => {
        committed.push(entry.eventId);
      }
    });
    pipeline.start();

    await Promise.resolve();
    expect(committed).toEqual(["dup-a", "dup-b"]);
    expect(wrappedFollow).toHaveBeenCalledWith(
      { from: "CURRENT_INTERVAL_START" },
      expect.any(Function)
    );
    await pipeline.close();
  });

  it("restarts from CURRENT on observer failure and only replays unseen refs", async () => {
    const history = createReplayableHistory([
      lightstreamerCandidate("first"),
      lightstreamerCandidate("second")
    ]);
    const follow = vi.spyOn(history, "follow");

    const committed: string[] = [];
    const failures: string[] = [];
    let shouldFailOnSecond = true;

    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: (entry) => {
        committed.push(entry.eventId);
        if (entry.eventId === "second" && shouldFailOnSecond) {
          shouldFailOnSecond = false;
          failures.push("second");
          throw new Error("observer-failure");
        }
      }
    });

    pipeline.start();
    await Promise.resolve();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual(["second"]);
    expect(follow).toHaveBeenCalledTimes(2);
    expect(committed).toEqual(["first", "second", "second"]);
    expect(committed.filter((eventId) => eventId === "first")).toEqual(["first"]);
    await pipeline.close();
  });

  it("replays a failing committed entry at most once", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-fail-once" });
    await history.offer(lightstreamerCandidate("flaky")).settled;

    const follow = vi.spyOn(history, "follow");
    const committed: string[] = [];
    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: () => {
        committed.push("flaky");
        throw new Error("persistent-failure");
      }
    });

    pipeline.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(committed).toEqual(["flaky", "flaky"]);
    expect(follow).toHaveBeenCalledTimes(3);
    await pipeline.close();
  });

  it("reports first refused/rejected missing identity on receipt and preserves first value", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-missing-id" });
    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: () => undefined
    });

    const valid = pipeline.offer(lightstreamerCandidate("ok-1"));
    expect(valid.firstRefusedOrRejectedMissingIdentity).toBeNull();

    const missing = pipeline.offer(asMissingIdentityCandidate(""));
    await expect(missing.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "INVALID_CANDIDATE" }
    });

    expect(missing.firstRefusedOrRejectedMissingIdentity).toBe("<missing-identity>");

    const anotherMissing = pipeline.offer(asMissingIdentityCandidate(""));
    await expect(anotherMissing.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "INVALID_CANDIDATE" }
    });

    expect(anotherMissing.firstRefusedOrRejectedMissingIdentity).toBe("<missing-identity>");
    expect(pipeline.firstMissingIdentity()).toBe("<missing-identity>");
    await pipeline.close();
  });

  it("captures first refused candidate identity before settled", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-refused-identity" });
    vi.spyOn(history, "offer").mockImplementationOnce(() => ({
      intake: "REFUSED",
      settled: Promise.resolve({
        outcome: "NOT_EVIDENCE",
        problem: { code: "INVALID_CANDIDATE", message: "mock rejection" },
        committedEvidenceBoundary: null
      })
    }));

    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: () => undefined
    });

    const refused = pipeline.offer(lightstreamerCandidate("refused-id"));
    expect(refused.firstRefusedOrRejectedMissingIdentity).toBe("refused-id");
    expect(pipeline.firstMissingIdentity()).toBe("refused-id");
    await pipeline.close();
  });

  it("delegates clear/read and closes by unsubscribing before typed close", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "pipeline-clear-close" });

    const followOriginal = history.follow;
    const unsubscribed = vi.fn();
    const follow = vi.spyOn(history, "follow").mockImplementation((options, observer) => {
      const unsubscribe = followOriginal(options, observer);
      return () => {
        unsubscribed();
        unsubscribe();
      };
    });

    const readSpy = vi.spyOn(history, "read");
    const clearSpy = vi.spyOn(history, "clear");
    const closeSpy = vi.spyOn(history, "close");

    const pipeline = await createCommittedEvidencePipeline({
      history,
      onCommittedEvidence: () => undefined
    });

    pipeline.start();
    await Promise.resolve();

    const readResult = await pipeline.read({ order: "asc", limit: 10 });
    expect(readResult).toMatchObject({ ok: true, value: { evidence: [] } });
    expect(readSpy).toHaveBeenCalledWith({ order: "asc", limit: 10 });

    const clearResult = await pipeline.clear();
    expect(clearResult.ok).toBe(true);
    expect(clearSpy).toHaveBeenCalledTimes(1);

    await pipeline.close();
    expect(unsubscribed).toHaveBeenCalledOnce();
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(unsubscribed.mock.invocationCallOrder[0]).toBeLessThan(closeSpy.mock.invocationCallOrder[0]);
    expect(follow).toHaveBeenCalledWith(
      { from: "CURRENT_INTERVAL_START" },
      expect.any(Function)
    );
  });

  it("creates local delivery outcomes that stay DELIVERED while callbacking only on BECAME_EVIDENCE", async () => {
    const successOnly = createLocalDeliveryHelper("exec-success", {
      requestId: "request-success",
      ok: true,
      status: "success",
      timestamp: 1_700_000_000_100
    });

    const callback = vi.fn();
    const withEvidence: CaptureReceipt = {
      intake: "QUEUED",
      settled: Promise.resolve({
        outcome: "BECAME_EVIDENCE",
        evidence: {
          intervalId: "test",
          sequence: 1,
          eventId: "evidence"
        }
      })
    };

    const firstRun = await successOnly.withSyntheticReceipt(withEvidence, callback);
    expect(successOnly.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      status: "success"
    });
    expect(firstRun).toBe(true);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      intervalId: "test",
      sequence: 1,
      eventId: "evidence"
    } as const);

    const failedSynthetic = createLocalDeliveryHelper("exec-failed", {
      requestId: "request-failed",
      ok: false,
      status: "success",
      timestamp: 1_700_000_000_200,
      error: "server rejected"
    });

    const notEvidence: CaptureReceipt = {
      intake: "REFUSED",
      settled: Promise.resolve({
        outcome: "NOT_EVIDENCE",
        problem: {
          code: "INVALID_CANDIDATE",
          message: "bad candidate"
        },
        committedEvidenceBoundary: null
      })
    };

    const callbackRejects = vi.fn();
    const second = await failedSynthetic.withSyntheticReceipt(notEvidence, callbackRejects);

    expect(failedSynthetic.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      status: "success"
    });
    expect(second).toBe(false);
    expect(callbackRejects).not.toHaveBeenCalled();
  });
});
