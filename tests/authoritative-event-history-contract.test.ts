import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate,
  type EventHistory,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

function candidate(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "sub-contract", mode: "COMMAND" },
    update: { key: id, command: "ADD" }
  };
}

type HistoryLifecycleOptions = Readonly<{
  clearJournal?: () => Promise<void | boolean> | boolean;
  closeJournal?: () => Promise<void>;
  commitBatch?: (batch: readonly EvidenceCandidate[]) => Promise<void>;
  byteEstimator?: (candidate: EvidenceCandidate) => number;
  capacity?: Readonly<{
    maxRetainedCount?: number;
    maxRetainedBytes?: number;
    pendingStopBytes?: number;
  }>;
}>;

type HistoryFactory = (options?: HistoryLifecycleOptions) => Promise<EventHistory>;

function sharedContract(name: string, createHistory: HistoryFactory): void {
  describe(`${name} authoritative EventHistory contract`, () => {
    it("commits, reads, and follows the same ordered Evidence", async () => {
      const history = await createHistory();
      const publications: string[] = [];
      history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
        if (publication.type === "committed-evidence") {
          publications.push(...publication.evidence.map((entry) => entry.eventId));
        }
      });

      const first = history.offer(candidate("contract-1"));
      const second = history.offer(candidate("contract-2"));
      await expect(Promise.all([first.settled, second.settled])).resolves.toMatchObject([
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2 } }
      ]);
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ eventId: "contract-1" }),
            expect.objectContaining({ eventId: "contract-2" })
          ]
        }
      });
      expect(publications).toEqual(["contract-1", "contract-2"]);
      await history.close();
    });

    it("rejoins captures offered during a successful Clear after a pending commit in capture order", async () => {
      let releaseCommit!: () => void;
      let commitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const commitStartedPromise = new Promise<void>((resolve) => {
        commitStarted = resolve;
      });
      const history = await createHistory({
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "clear-race-in-flight")) {
            commitStarted();
            await commitGate;
          }
        }
      });

      await expect(history.offer(candidate("clear-race-before")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "clear-race-before" }
      });

      const inFlight = history.offer(candidate("clear-race-in-flight"));
      await commitStartedPromise;
      const clear = history.clear();
      const duringClearFirst = history.offer(candidate("clear-race-during-first"));
      const duringClearSecond = history.offer(candidate("clear-race-during-second"));
      expect(duringClearFirst.intake).toBe("QUEUED");
      expect(duringClearSecond.intake).toBe("QUEUED");

      releaseCommit();

      await expect(clear).resolves.toMatchObject({
        ok: true,
        value: {
          previousInterval: { ordinal: 1 },
          interval: { ordinal: 2 }
        }
      });
      await expect(Promise.all([inFlight.settled, duringClearFirst.settled, duringClearSecond.settled])).resolves.toMatchObject([
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: "clear-race-in-flight", intervalId: expect.stringContaining(":interval-1") } },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 3, eventId: "clear-race-during-first", intervalId: expect.stringContaining(":interval-2") } },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 4, eventId: "clear-race-during-second", intervalId: expect.stringContaining(":interval-2") } }
      ]);
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          interval: { ordinal: 2 },
          total: 2,
          evidence: [
            expect.objectContaining({ eventId: "clear-race-during-first", sequence: 3 }),
            expect.objectContaining({ eventId: "clear-race-during-second", sequence: 4 })
          ]
        }
      });
      await history.close();
    });

    it("keeps clear-race Capture ordered when a pending commit falls back to memory", async () => {
      let releaseCommit!: () => void;
      let commitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => {
        releaseCommit = resolve;
      });
      const commitStartedPromise = new Promise<void>((resolve) => {
        commitStarted = resolve;
      });
      const history = await createHistory({
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "clear-failure-in-flight")) {
            commitStarted();
            await commitGate;
            throw new Error("commit failed");
          }
        }
      });

      await expect(history.offer(candidate("clear-failure-before")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "clear-failure-before" }
      });
      const inFlight = history.offer(candidate("clear-failure-in-flight"));
      await commitStartedPromise;
      const clear = history.clear();
      const duringClear = history.offer(candidate("clear-failure-during"));
      expect(duringClear.intake).toBe("QUEUED");

      releaseCommit();

      await expect(clear).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
      await expect(inFlight.settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "clear-failure-in-flight" }
      });
      await expect(duringClear.settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 3, eventId: "clear-failure-during", intervalId: expect.stringContaining(":interval-2") }
      });
      const afterFallback = history.offer(candidate("clear-failure-after"));
      expect(afterFallback.intake).toBe("QUEUED");
      await expect(afterFallback.settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 4, eventId: "clear-failure-after" }
      });
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          interval: { ordinal: 2 },
          evidence: [
            expect.objectContaining({ eventId: "clear-failure-during", sequence: 3 }),
            expect.objectContaining({ eventId: "clear-failure-after", sequence: 4 })
          ],
          committedEvidenceBoundary: { sequence: 4, eventId: "clear-failure-after" }
        }
      });
      await history.close();
    });

    it("orders an exact pending-overflow gap between its preceding and following Evidence", async () => {
      let releaseCommit!: () => void;
      let markCommitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
      const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
      const history = await createHistory({
        byteEstimator: (entry) => entry.id === "after-gap" ? 4 : 6,
        capacity: { maxRetainedCount: 10, maxRetainedBytes: 100, pendingStopBytes: 10 },
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "before-gap")) {
            markCommitStarted();
            await commitGate;
          }
        }
      });
      const publications: Array<
        | { type: "committed"; eventIds: string[] }
        | { type: "gap"; eventId: string; afterEventId: string | null }
      > = [];
      history.follow({ from: "NOW" }, (publication) => {
        if (publication.type === "committed-evidence") {
          publications.push({ type: "committed", eventIds: publication.evidence.map(({ eventId }) => eventId) });
        } else if (publication.type === "acceptance-gap") {
          publications.push({ type: "gap", eventId: publication.gap.eventId, afterEventId: publication.gap.afterEvidence?.eventId ?? null });
        }
      });

      const before = history.offer(candidate("before-gap"));
      await commitStarted;
      const gap = history.offer(candidate("pending-overflow"));
      const after = history.offer(candidate("after-gap"));
      expect(gap.intake).toBe("REFUSED");
      expect(after.intake).toBe("QUEUED");
      let gapSettled = false;
      void gap.settled.then(() => { gapSettled = true; });
      await Promise.resolve();
      expect(gapSettled).toBe(false);
      expect(publications).toEqual([]);

      releaseCommit();
      await expect(Promise.all([before.settled, gap.settled, after.settled])).resolves.toMatchObject([
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 1, eventId: "before-gap" } },
        { outcome: "NOT_EVIDENCE", problem: { code: "PENDING_OVERFLOW" }, committedEvidenceBoundary: { sequence: 1, eventId: "before-gap" } },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: "after-gap" } }
      ]);
      expect(publications).toEqual([
        { type: "committed", eventIds: ["before-gap"] },
        { type: "gap", eventId: "pending-overflow", afterEventId: "before-gap" },
        { type: "committed", eventIds: ["after-gap"] }
      ]);
      expect(history.status()).toMatchObject({
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          firstGap: { captureOrdinal: 2, eventId: "pending-overflow", afterEvidence: { eventId: "before-gap" } },
          latestGap: { captureOrdinal: 2, eventId: "pending-overflow", afterEvidence: { eventId: "before-gap" } }
        }
      });
      await history.close();
    });

    it("coalesces adjacent pending-overflow gaps behind one exact Evidence boundary", async () => {
      let releaseCommit!: () => void;
      let markCommitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
      const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
      const history = await createHistory({
        byteEstimator: () => 6,
        capacity: { maxRetainedCount: 10, maxRetainedBytes: 100, pendingStopBytes: 10 },
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "coalesce-before")) {
            markCommitStarted();
            await commitGate;
          }
        }
      });
      const gapPublications: Array<Extract<HistoryPublication, { type: "acceptance-gap" }>> = [];
      history.follow({ from: "NOW" }, (publication) => {
        if (publication.type === "acceptance-gap") gapPublications.push(publication);
      });

      const before = history.offer(candidate("coalesce-before"));
      await commitStarted;
      const first = history.offer(candidate("coalesce-first"));
      const middle = history.offer(candidate("coalesce-middle"));
      const latest = history.offer(candidate("coalesce-latest"));
      expect(first.intake).toBe("REFUSED");
      expect(middle.settled).toBe(first.settled);
      expect(latest.settled).toBe(first.settled);

      releaseCommit();
      await before.settled;
      await expect(first.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        committedEvidenceBoundary: { sequence: 1, eventId: "coalesce-before" }
      });
      expect(gapPublications).toHaveLength(1);
      expect(gapPublications[0]).toMatchObject({
        gap: { eventId: "coalesce-first", afterEvidence: { eventId: "coalesce-before" } },
        status: {
          continuity: {
            gapCount: 3,
            firstGap: { captureOrdinal: 2, eventId: "coalesce-first", afterEvidence: { eventId: "coalesce-before" } },
            latestGap: { captureOrdinal: 4, eventId: "coalesce-latest", afterEvidence: { eventId: "coalesce-before" } }
          }
        }
      });
      await history.close();
    });

    it("assigns an overflow offered during successful Clear to the new interval without reordering it", async () => {
      let releaseCommit!: () => void;
      let markCommitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
      const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
      const history = await createHistory({
        byteEstimator: () => 6,
        capacity: { maxRetainedCount: 10, maxRetainedBytes: 100, pendingStopBytes: 10 },
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "clear-gap-before")) {
            markCommitStarted();
            await commitGate;
          }
        }
      });
      const publications: Array<{ type: string; intervalOrdinal: number }> = [];
      history.follow({ from: "NOW" }, (publication) => {
        if (publication.type === "interval-cleared") {
          publications.push({ type: publication.type, intervalOrdinal: publication.interval.ordinal });
        } else if (publication.type === "acceptance-gap") {
          publications.push({ type: publication.type, intervalOrdinal: publication.gap.interval.ordinal });
        }
      });

      const before = history.offer(candidate("clear-gap-before"));
      await commitStarted;
      const clear = history.clear();
      const gap = history.offer(candidate("clear-gap-during"));
      expect(gap.intake).toBe("REFUSED");
      releaseCommit();

      await before.settled;
      await expect(clear).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
      await expect(gap.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        committedEvidenceBoundary: { sequence: 1, eventId: "clear-gap-before" }
      });
      expect(publications).toEqual([
        { type: "interval-cleared", intervalOrdinal: 2 },
        { type: "acceptance-gap", intervalOrdinal: 2 }
      ]);
      expect(history.status()).toMatchObject({
        interval: { ordinal: 2 },
        continuity: { state: "GAPPED", gapCount: 1, firstGap: { interval: { ordinal: 2 }, eventId: "clear-gap-during" } }
      });
      await history.close();
    });

    it("keeps an overflow offered during failed Clear in the existing interval", async () => {
      let releaseCommit!: () => void;
      let markCommitStarted!: () => void;
      const commitGate = new Promise<void>((resolve) => { releaseCommit = resolve; });
      const commitStarted = new Promise<void>((resolve) => { markCommitStarted = resolve; });
      const history = await createHistory({
        byteEstimator: () => 6,
        capacity: { maxRetainedCount: 10, maxRetainedBytes: 100, pendingStopBytes: 10 },
        clearJournal: () => false,
        commitBatch: async (batch) => {
          if (batch.some((entry) => entry.id === "failed-clear-gap-before")) {
            markCommitStarted();
            await commitGate;
          }
        }
      });

      const before = history.offer(candidate("failed-clear-gap-before"));
      await commitStarted;
      const clear = history.clear();
      const gap = history.offer(candidate("failed-clear-gap-during"));
      releaseCommit();

      await before.settled;
      await expect(clear).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_FAILED" } });
      await expect(gap.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        committedEvidenceBoundary: { sequence: 1, eventId: "failed-clear-gap-before" }
      });
      expect(history.status()).toMatchObject({
        interval: { ordinal: 1 },
        phase: "RUNNING",
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          firstGap: { interval: { ordinal: 1 }, eventId: "failed-clear-gap-during", afterEvidence: { eventId: "failed-clear-gap-before" } }
        }
      });
      await history.close();
    });

    it("turns an in-batch duplicate event identity into one exact gap and continues", async () => {
      const history = await createHistory();
      const publications: Array<
        | { type: "committed"; eventIds: string[] }
        | { type: "gap"; eventId: string; dimension: string; afterEventId: string | null }
        | { type: "fallback" }
      > = [];
      history.follow({ from: "NOW" }, (publication) => {
        if (publication.type === "committed-evidence") {
          publications.push({ type: "committed", eventIds: publication.evidence.map(({ eventId }) => eventId) });
        } else if (publication.type === "acceptance-gap") {
          publications.push({
            type: "gap",
            eventId: publication.gap.eventId,
            dimension: publication.gap.dimension,
            afterEventId: publication.gap.afterEvidence?.eventId ?? null
          });
        } else if (publication.type === "persistence-state" && publication.transition === "MEMORY_FALLBACK") {
          publications.push({ type: "fallback" });
        }
      });

      const first = history.offer(candidate("duplicate-x"));
      const duplicate = history.offer(candidate("duplicate-x"));
      const later = history.offer(candidate("identity-y"));
      await expect(Promise.all([first.settled, duplicate.settled, later.settled])).resolves.toMatchObject([
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 1, eventId: "duplicate-x" } },
        {
          outcome: "NOT_EVIDENCE",
          problem: { code: "INVALID_CANDIDATE", dimension: "EVENT_IDENTITY" },
          committedEvidenceBoundary: { sequence: 1, eventId: "duplicate-x" }
        },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: "identity-y" } }
      ]);

      expect(publications).toEqual([
        { type: "committed", eventIds: ["duplicate-x"] },
        { type: "gap", eventId: "duplicate-x", dimension: "EVENT_IDENTITY", afterEventId: "duplicate-x" },
        { type: "committed", eventIds: ["identity-y"] }
      ]);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        captureOperation: "RUNNING",
        accepted: 2,
        notAccepted: 1,
        persistence: { mode: "JOURNAL", health: "HEALTHY" },
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          firstGap: {
            captureOrdinal: 2,
            eventId: "duplicate-x",
            dimension: "EVENT_IDENTITY",
            afterEvidence: { sequence: 1, eventId: "duplicate-x" }
          }
        }
      });
      await expect(history.read({ order: "asc" })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ sequence: 1, eventId: "duplicate-x" }),
            expect.objectContaining({ sequence: 2, eventId: "identity-y" })
          ]
        }
      });
      await history.close();
    });

    it("rejects a retained duplicate event identity and accepts the next candidate", async () => {
      const history = await createHistory();
      await expect(history.offer(candidate("retained-x")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "retained-x" }
      });

      const duplicate = history.offer(candidate("retained-x"));
      const later = history.offer(candidate("retained-y"));
      await expect(Promise.all([duplicate.settled, later.settled])).resolves.toMatchObject([
        {
          outcome: "NOT_EVIDENCE",
          problem: { code: "INVALID_CANDIDATE", dimension: "EVENT_IDENTITY" },
          committedEvidenceBoundary: { sequence: 1, eventId: "retained-x" }
        },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: "retained-y" } }
      ]);
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        accepted: 2,
        notAccepted: 1,
        persistence: { mode: "JOURNAL", health: "HEALTHY" },
        continuity: {
          state: "GAPPED",
          gapCount: 1,
          latestGap: {
            captureOrdinal: 2,
            eventId: "retained-x",
            dimension: "EVENT_IDENTITY",
            afterEvidence: { sequence: 1, eventId: "retained-x" }
          }
        }
      });
      await history.close();
    });

    it("releases event identities when rolling retention or successful Clear removes their Evidence", async () => {
      let releaseClear!: () => void;
      const clearGate = new Promise<void>((resolve) => { releaseClear = resolve; });
      const history = await createHistory({
        capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
        clearJournal: () => clearGate
      });

      await history.offer(candidate("identity-old")).settled;
      await history.offer(candidate("identity-middle")).settled;
      await history.offer(candidate("identity-new")).settled;
      expect(history.status()).toMatchObject({ retained: 1, retention: { evicted: { count: 2 } } });
      await expect(history.offer(candidate("identity-old")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 4, eventId: "identity-old" }
      });

      const clear = history.clear();
      const reusedDuringClear = history.offer(candidate("identity-new"));
      releaseClear();
      await expect(clear).resolves.toMatchObject({ ok: true, value: { interval: { ordinal: 2 } } });
      await expect(reusedDuringClear.settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 5, eventId: "identity-new", intervalId: expect.stringContaining(":interval-2") }
      });
      await history.close();
    });

    it("keeps an event identity reserved when Clear fails", async () => {
      const history = await createHistory({ clearJournal: () => false });
      await history.offer(candidate("failed-clear-identity")).settled;

      const clear = history.clear();
      const duplicate = history.offer(candidate("failed-clear-identity"));
      await expect(clear).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_FAILED" } });
      await expect(duplicate.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "INVALID_CANDIDATE", dimension: "EVENT_IDENTITY" },
        committedEvidenceBoundary: { sequence: 1, eventId: "failed-clear-identity" }
      });
      expect(history.status()).toMatchObject({
        phase: "RUNNING",
        persistence: { mode: "JOURNAL", health: "HEALTHY" },
        continuity: { state: "GAPPED", gapCount: 1 }
      });
      await history.close();
    });

    it("rejects malformed Topology Checkpoint candidates before admission", async () => {
      const history = await createHistory();
      const malformedCandidates = [
        { kind: "topology-checkpoint", id: "", checkpoint: { pageEpoch: "invalid-id" } } as EvidenceCandidate,
        { kind: "topology-checkpoint", id: "malformed-shape", checkpoint: [] as unknown as Record<string, unknown> } as EvidenceCandidate,
        { kind: "topology-checkpoint", id: "malformed-shape", checkpoint: "invalid" as unknown as Record<string, unknown> } as EvidenceCandidate
      ];
      for (const malformed of malformedCandidates) {
        await expect(history.offer(malformed).settled).resolves.toMatchObject({
          outcome: "NOT_EVIDENCE",
          problem: { code: "INVALID_CANDIDATE" }
        });
      }
      await history.close();
    });

    it("rejects an Evidence identity that cannot fit the bounded reference contract", async () => {
      const history = await createHistory();
      await expect(history.offer(candidate("e".repeat(257))).settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "INVALID_CANDIDATE" }
      });
      expect(history.status().committedEvidenceBoundary).toBeNull();
      await history.close();
    });

    it("keeps recent paging equivalent", async () => {
      const history = await createHistory();
      await history.offer(candidate("alpha")).settled;
      await history.offer(candidate("beta")).settled;
      await history.offer({ ...candidate("other"), subscription: { id: "other", mode: "MERGE" } }).settled;

      await expect(history.read({ offsetFromNewest: 1, limit: 1 })).resolves.toMatchObject({
        ok: true,
        value: { total: 3, evidence: [expect.objectContaining({ eventId: "beta" })] }
      });
      await expect(history.read({ order: "desc", offsetFromNewest: 1, limit: 2 })).resolves.toMatchObject({
        ok: true,
        value: {
          evidence: [expect.objectContaining({ eventId: "beta" }), expect.objectContaining({ eventId: "alpha" })]
        }
      });

      const pagingCases = [
        { query: { order: "asc" as const, limit: 2 }, ids: ["alpha", "beta"], total: 3 },
        { query: { order: "desc" as const, limit: 2 }, ids: ["other", "beta"], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: 0, limit: 2 }, ids: ["beta", "other"], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: 1, limit: 2 }, ids: ["alpha", "beta"], total: 3 },
        { query: { order: "desc" as const, offsetFromNewest: 1, limit: 2 }, ids: ["beta", "alpha"], total: 3 },
        { query: { order: "desc" as const, afterSequence: 1, limit: 1 }, ids: ["other"], total: 2 },
        { query: { order: "asc" as const, limit: 0 }, ids: [], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: -1, limit: -1 }, ids: [], total: 3 }
      ];
      for (const pagingCase of pagingCases) {
        const result = await history.read(pagingCase.query);
        expect(result).toMatchObject({ ok: true });
        if (result.ok) {
          expect(result.value.total).toBe(pagingCase.total);
          expect(result.value.evidence.map((entry) => entry.eventId)).toEqual(pagingCase.ids);
        }
      }

      const checkpoint = {
        kind: "topology-checkpoint" as const,
        id: "checkpoint-filtered",
        checkpoint: { pageEpoch: "epoch-command" }
      };
      await history.offer(checkpoint).settled;
      await expect(history.read({ candidateKind: "lightstreamer" })).resolves.toMatchObject({ ok: true, value: { total: 3 } });

      const firstRead = await history.read({});
      const firstInterval = firstRead.ok ? firstRead.value.interval.id : "";
      await history.clear();
      await history.offer(candidate("after-clear")).settled;
      await expect(history.read({ intervalId: firstInterval })).resolves.toMatchObject({
        ok: true,
        value: { total: 0, evidence: [] }
      });
      await history.close();
    });

    it("excludes topology checkpoints before calculating Lightstreamer Evidence totals and pages", async () => {
      const history = await createHistory();
      await history.offer(candidate("first-event")).settled;
      await history.offer({
        kind: "topology-checkpoint",
        id: "between-events",
        checkpoint: { pageEpoch: "epoch-paging" }
      }).settled;
      await history.offer(candidate("last-event")).settled;

      await expect(history.read({ candidateKind: "lightstreamer", order: "asc", limit: 1 })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [expect.objectContaining({ eventId: "first-event" })]
        }
      });
      await expect(history.read({
        candidateKind: "lightstreamer",
        order: "desc",
        offsetFromNewest: 1,
        limit: 1
      })).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [expect.objectContaining({ eventId: "first-event" })]
        }
      });
      await history.close();
    });

    it("propagates Clear-confirmation failures without stopping intake", async () => {
      const history = await createHistory({
        clearJournal: async () => {
          return false;
        }
      });
      await history.offer(candidate("clear-failing")).settled;
      const publications: unknown[] = [];
      history.follow({ from: "NOW" }, (publication) => publications.push(publication));
      const clearResult = await history.clear();
      expect(clearResult).toMatchObject({ ok: false, problem: { code: "CLEAR_FAILED" } });
      expect(publications).toContainEqual(expect.objectContaining({ type: "status", problem: expect.objectContaining({ code: "CLEAR_FAILED" }) }));
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: { evidence: [expect.objectContaining({ eventId: "clear-failing" })] }
      });
      await expect(history.offer(candidate("after-failed-clear")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2 }
      });
      await history.close();
    });

    it("reports close failure consistently and refuses post-close offers", async () => {
      const history = await createHistory({
        closeJournal: async () => {
          throw new Error("close failed");
        }
      });
      await history.offer(candidate("close-failing")).settled;
      const closeResult = await history.close();
      expect(closeResult).toMatchObject({ ok: false, problem: { code: "CLOSE_FAILED" } });
      expect(history.offer(candidate("after-close-fail")).intake).toBe("REFUSED");
      await history.close();
    });

    it("Finds canonical replay key order case-insensitively across adapters", async () => {
      const history = await createHistory();
      await historyFactoryOfferAndReadCanonicalReplay(history);
    });
  });
}

async function historyFactoryOfferAndReadCanonicalReplay(history: EventHistory): Promise<void> {
  await history.offer({
    ...candidate("canonical-order"),
    raw: { zulu: "LAST", alpha: "FIRST" }
  }).settled;

  await expect(history.read({})).resolves.toMatchObject({
    ok: true,
    value: { total: 1, evidence: [expect.objectContaining({ eventId: "canonical-order" })] }
  });
  await history.close();
}

sharedContract("memory", (options = {}) => createMemoryEventHistoryForTests(options));
let sharedIndexedDbSessionOrdinal = 0;
sharedContract("fake IndexedDB", async (options = {}) => {
  const panelSessionId = `shared-contract-indexeddb-${++sharedIndexedDbSessionOrdinal}`;
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId, ...options });
});
