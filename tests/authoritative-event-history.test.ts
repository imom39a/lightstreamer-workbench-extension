import { describe, expect, it, vi } from "vitest";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate
} from "../src/core/event-history-authoritative";

function candidate(id: string): EvidenceCandidate {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update"
  };
}

describe("commit-authoritative EventHistory", () => {
  it("captures a large candidate snapshot without synchronous structured cloning", async () => {
    let releaseCommit!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const clone = vi.spyOn(globalThis, "structuredClone");
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "large-offer-snapshot",
      commitBatch: async () => commitGate
    });
    const candidate = createEventHistoryWorkloadEvent("large-json-rich", 1, "large-offer");

    const receipt = history.offer(candidate);

    expect(receipt.intake).toBe("QUEUED");
    expect(clone).not.toHaveBeenCalled();
    releaseCommit();
    await expect(receipt.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { eventId: candidate.id }
    });

    expect(clone).not.toHaveBeenCalled();
    await history.close();
  });

  it("opens the dormant memory adapter through the backend-independent public factory", async () => {
    const history = await openEventHistory({ panelSessionId: "public-factory" });
    let initialStatus: unknown;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") {
        initialStatus = publication.status;
      }
    });
    expect(initialStatus).toMatchObject({
      phase: "RUNNING",
      capacity: { tier: "LOWER" },
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });
    expect(history.storage).toEqual({ mode: "memory", reason: "IndexedDB is unavailable" });
    await history.close();
  });

  it("offers without waiting and keeps a stalled candidate outside Evidence", async () => {
    let markCommitStarted: () => void = () => undefined;
    const commitStarted = new Promise<void>((resolve) => {
      markCommitStarted = resolve;
    });
    let releaseCommit: () => void = () => undefined;
    const commit = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const history = await createMemoryEventHistoryForTests({
      commitBatch: async () => {
        markCommitStarted();
        await commit;
      }
    });
    const publications: unknown[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    const receipt = history.offer(candidate("event-1"));
    expect(receipt.intake).toBe("QUEUED");
    await commitStarted;
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [], committedEvidenceBoundary: null }
    });
    expect(publications).not.toContainEqual(expect.objectContaining({ type: "committed-evidence" }));

    releaseCommit();
    await expect(receipt.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "event-1" }
    });
    expect(publications).toContainEqual(
      expect.objectContaining({
        type: "committed-evidence",
        evidence: [expect.objectContaining({ sequence: 1, eventId: "event-1" })]
      })
    );
    await history.close();
  });

  it("commits a whole offered batch in Capture order with contiguous sequences", async () => {
    const history = await createMemoryEventHistoryForTests();
    const committed: number[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") {
        committed.push(...publication.evidence.map((entry) => entry.sequence));
      }
    });

    const receipts = ["one", "two", "three"].map((id) => history.offer(candidate(id)));
    await expect(Promise.all(receipts.map((receipt) => receipt.settled))).resolves.toEqual([
      expect.objectContaining({ outcome: "BECAME_EVIDENCE", evidence: expect.objectContaining({ sequence: 1 }) }),
      expect.objectContaining({ outcome: "BECAME_EVIDENCE", evidence: expect.objectContaining({ sequence: 2 }) }),
      expect.objectContaining({ outcome: "BECAME_EVIDENCE", evidence: expect.objectContaining({ sequence: 3 }) })
    ]);
    expect(committed).toEqual([1, 2, 3]);
    await history.close();
  });

  it("reports the full retained interval for a paged read", async () => {
    const history = await openEventHistory({ panelSessionId: "retained-range" });
    await history.offer(candidate("first")).settled;
    await history.offer(candidate("second")).settled;

    await expect(history.read({ afterSequence: 1, limit: 1 })).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [expect.objectContaining({ sequence: 2, eventId: "second" })],
        committedEvidenceBoundary: expect.objectContaining({ sequence: 2, eventId: "second" }),
        retainedRange: {
          first: expect.objectContaining({ sequence: 1, eventId: "first" }),
          last: expect.objectContaining({ sequence: 2, eventId: "second" })
        }
      }
    });
    await history.close();
  });

  it("replays a committed prefix and delivers a concurrent commit once", async () => {
    const history = await createMemoryEventHistoryForTests();
    await history.offer(candidate("before-1")).settled;
    await history.offer(candidate("before-2")).settled;
    const seen: string[] = [];
    let afterReplaySettled: Promise<unknown> | undefined;
    history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
      if (publication.type === "committed-evidence") {
        seen.push(...publication.evidence.map((entry) => entry.eventId));
        if (publication.evidence.some((entry) => entry.eventId === "before-1")) {
          afterReplaySettled = history.offer(candidate("after-replay")).settled;
        }
      }
    });

    expect(afterReplaySettled).toBeDefined();
    await expect(afterReplaySettled!).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    expect(seen).toEqual(["before-1", "before-2", "after-replay"]);
    await history.close();
  });

  it("detaches a throwing subscriber without affecting another subscriber", async () => {
    const history = await createMemoryEventHistoryForTests();
    const healthy: string[] = [];
    history.follow({ from: "NOW" }, () => {
      throw new Error("subscriber defect");
    });
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "committed-evidence") {
        healthy.push(publication.evidence[0].eventId);
      }
    });
    await history.offer(candidate("survives-subscriber")).settled;
    expect(healthy).toEqual(["survives-subscriber"]);
    await history.close();
  });

  it("returns typed, idempotent lifecycle outcomes and never reuses Evidence sequences", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "lifecycle" });
    await history.offer(candidate("old-interval")).settled;
    const firstClear = await history.clear();
    expect(firstClear).toMatchObject({ ok: true, value: { previousInterval: { ordinal: 1 }, interval: { ordinal: 2 } } });
    const repeatedClear = await history.clear();
    expect(repeatedClear).toEqual(firstClear);
    const next = await history.offer(candidate("new-interval")).settled;
    expect(next).toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, intervalId: "lifecycle:interval-2" } });

    const firstClose = await history.close();
    const repeatedClose = await history.close();
    expect(firstClose).toMatchObject({ ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } });
    expect(repeatedClose).toEqual(firstClose);
    expect(history.offer(candidate("after-close")).intake).toBe("REFUSED");
  });

  it("stops at the prior committed boundary when an atomic batch fails", async () => {
    const history = await createMemoryEventHistoryForTests({
      commitBatch: async (batch) => {
        if (batch.some((entry) => entry.id === "fails")) {
          throw new Error("memory journal failure");
        }
      }
    });
    await history.offer(candidate("committed")).settled;
    const failed = history.offer(candidate("fails"));
    const tail = history.offer(candidate("tail"));

    await expect(failed.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1 }
    });
    await expect(tail.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "committed" })] }
    });
    expect(history.offer(candidate("after-stop")).intake).toBe("REFUSED");
    await history.close();
  });

  it("keeps the prior interval when Clear cannot be confirmed", async () => {
    const history = await createMemoryEventHistoryForTests({
      clearJournal: async () => {
        throw new Error("clear unavailable");
      }
    });
    await history.offer(candidate("retained")).settled;

    const publications: unknown[] = [];
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));
    await expect(history.clear()).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    expect(publications).toContainEqual(
      expect.objectContaining({
        type: "status",
        problem: expect.objectContaining({ code: "CLEAR_FAILED" })
      })
    );
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { evidence: [expect.objectContaining({ eventId: "retained" })] }
    });
    await history.close();
  });

  it("accepts checkpoint candidates through the same immutable Evidence seam", async () => {
    const history = await createMemoryEventHistoryForTests();
    const checkpoint = {
      kind: "topology-checkpoint" as const,
      id: "checkpoint-1",
      checkpoint: { pageEpoch: "page-1", records: [{ id: "subscription-1" }] }
    };
    const receipt = history.offer(checkpoint);
    checkpoint.checkpoint.records[0].id = "mutated-after-offer";

    await expect(receipt.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { eventId: "checkpoint-1" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [
          { candidate: { checkpoint: { records: [{ id: "subscription-1" }] } } }
        ]
      }
    });
    await history.close();
  });
});
