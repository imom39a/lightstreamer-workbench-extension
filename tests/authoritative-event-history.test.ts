import { describe, expect, it, vi } from "vitest";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate
} from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

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
  it("settles Scenario Local Evidence in memory and clears it before Panel Session close", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "scenario-memory-lifecycle" });
    const receipt = history.offer({
      ...candidate("scenario-local-memory"), source: "synthetic", synthetic: true,
      raw: { scenarioId: "scenario-1", runId: "run-1", stepId: "step-1", ordinal: 1, injectionId: "injection-1", executionId: "execution-1" }
    } as LightstreamerEventEnvelope);
    // Correlations are part of the committed synthetic envelope in production;
    // this seam proves the Scenario admission lifecycle against memory storage.
    expect(receipt.intake).toBe("QUEUED");
    await expect(receipt.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { eventId: "scenario-local-memory" } });
    await expect(history.clear()).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { total: 0, committedEvidenceBoundary: { eventId: "scenario-local-memory" }, retainedRange: null }
    });
    await expect(history.close()).resolves.toMatchObject({ ok: true });
  });

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

  it("reuses deeply immutable committed candidates across repeated read wrappers", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "read-materialization" });
    const hostileNested = { value: "original" };
    const hostile = Object.freeze({
      ...createEventHistoryWorkloadEvent("large-json-rich", 1, "read-materialization"),
      raw: hostileNested
    });
    await history.offer(hostile).settled;
    hostileNested.value = "mutated-after-offer";

    const reads = await Promise.all([history.read({}), history.read({}), history.read({})]);
    const values = reads.map((read) => {
      expect(read.ok).toBe(true);
      if (!read.ok) throw new Error("Expected a successful read.");
      return read.value;
    });

    expect(values[0].evidence).not.toBe(values[1].evidence);
    expect(Object.isFrozen(values[0])).toBe(true);
    expect(Object.isFrozen(values[0].evidence)).toBe(true);
    expect(values[0].evidence[0]).toBe(values[1].evidence[0]);
    const committedCandidate = values[0].evidence[0].candidate;
    expect(committedCandidate.kind).not.toBe("topology-checkpoint");
    if (committedCandidate.kind === "topology-checkpoint") throw new Error("Expected Lightstreamer Evidence.");
    expect(Object.isFrozen(committedCandidate)).toBe(true);
    expect(Object.isFrozen(committedCandidate.raw)).toBe(true);
    expect(committedCandidate.raw).toEqual({ value: "original" });
    await history.close();
  });

  it("does not recursively revisit 1,692 committed JSON-rich payloads on three full reads", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "large-full-reads" });
    const receipts = Array.from({ length: 1_692 }, (_, sequence) =>
      history.offer(createEventHistoryWorkloadEvent("large-json-rich", sequence, "large-full-reads"))
    );
    await Promise.all(receipts.map(({ settled }) => settled));
    const frozenChecks = vi.spyOn(Object, "isFrozen");

    const reads = await Promise.all([history.read({ order: "asc" }), history.read({ order: "asc" }), history.read({ order: "asc" })]);

    expect(reads.every((read) => read.ok && read.value.total === 1_692)).toBe(true);
    expect(frozenChecks.mock.calls.length).toBeLessThan(100);
    frozenChecks.mockRestore();
    await history.close();
  }, 30_000);

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
