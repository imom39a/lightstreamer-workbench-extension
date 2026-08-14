import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate,
  type EventHistory
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

    it("keeps clear-race captures terminal when the pending commit fails", async () => {
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

      await expect(clear).resolves.toMatchObject({
        ok: false,
        problem: { code: "HISTORY_STOPPED" }
      });
      await expect(inFlight.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "JOURNAL_COMMIT_FAILED" },
        committedEvidenceBoundary: { sequence: 1, eventId: "clear-failure-before" }
      });
      await expect(duringClear.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "JOURNAL_COMMIT_FAILED" },
        committedEvidenceBoundary: { sequence: 1, eventId: "clear-failure-before" }
      });
      const afterTerminal = history.offer(candidate("clear-failure-after"));
      expect(afterTerminal.intake).toBe("REFUSED");
      await expect(afterTerminal.settled).resolves.toMatchObject({
        outcome: "NOT_EVIDENCE",
        problem: { code: "JOURNAL_COMMIT_FAILED" },
        committedEvidenceBoundary: { sequence: 1, eventId: "clear-failure-before" }
      });
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          interval: { ordinal: 1 },
          evidence: [expect.objectContaining({ eventId: "clear-failure-before", sequence: 1 })],
          committedEvidenceBoundary: { sequence: 1, eventId: "clear-failure-before" }
        }
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
sharedContract("fake IndexedDB", async (options = {}) => {
  const panelSessionId = "shared-contract-indexeddb";
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId, ...options });
});
