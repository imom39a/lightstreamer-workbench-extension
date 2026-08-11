import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EvidenceCandidate,
  type EventHistory
} from "../src/core/event-history-authoritative";
import { estimateHistoryCandidateBytes } from "../src/core/event-history-capacity";
import { serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import {
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

const REPRESENTATIVE_PAYLOAD_BYTES = 256;
const NEAR_TWO_MEBIBYTE_PAYLOAD_BYTES = 2_110_000;

type AdapterFactory = (panelSessionId: string, options?: Record<string, unknown>) => Promise<{
  history: EventHistory;
  panelSessionId: string;
  fakeIndexedDb: boolean;
}>;

type AdapterRow = [string, boolean, AdapterFactory];

function topologyCheckpointFixture(id: string, payloadBytes: number): EvidenceCandidate {
  return {
    kind: "topology-checkpoint",
    id,
    checkpoint: {
      pageEpoch: "impl-08-lifecycle",
      records: [{ id, payload: "x".repeat(payloadBytes) }]
    }
  };
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(panelSessionId: string): Promise<IDBDatabase> {
  const request = indexedDB.open(authoritativeEventDatabaseName(panelSessionId));
  return requestValue(request);
}

function createMemoryAdapter(): AdapterFactory {
  return async (panelSessionId, options = {}) => ({
    history: await createMemoryEventHistoryForTests({ panelSessionId, ...options }),
    panelSessionId,
    fakeIndexedDb: false
  });
}

function createIndexedDbAdapter(): AdapterFactory {
  return async (panelSessionId, options = {}) => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
    return {
      history: await openEventHistory({ panelSessionId, ...options }),
      panelSessionId,
      fakeIndexedDb: true
    };
  };
}

const adapters: AdapterRow[] = [
  ["memory", false, createMemoryAdapter()],
  ["fake IndexedDB", true, createIndexedDbAdapter()]
];

function nextSessionId(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2);
  return `${prefix}-${suffix}`;
}

describe.each(adapters)("history-impl-08 lifecycle (%s)", (_name, fakeIndexedDb, create) => {
  it("commits representative and near-2MiB topology checkpoints with batch shape and byte accounting", async () => {
    const batchLengths: number[] = [];
    const sessionId = nextSessionId("impl-08-batch");
    const { history, panelSessionId, fakeIndexedDb: isFake } = await create(sessionId, {
      commitBatch: async (batch) => {
        batchLengths.push(batch.length);
      }
    });

    const first = topologyCheckpointFixture(`checkpoint-${panelSessionId}-one`, REPRESENTATIVE_PAYLOAD_BYTES);
    const second = topologyCheckpointFixture(`checkpoint-${panelSessionId}-two`, REPRESENTATIVE_PAYLOAD_BYTES);
    const nearLimit = topologyCheckpointFixture(`checkpoint-${panelSessionId}-near-2m`, NEAR_TWO_MEBIBYTE_PAYLOAD_BYTES);
    const third = topologyCheckpointFixture(`checkpoint-${panelSessionId}-three`, REPRESENTATIVE_PAYLOAD_BYTES);

    if (isFake) {
      const promises = [first, second, nearLimit, third].map((candidate) => history.offer(candidate).settled);
      await Promise.all(promises);
      expect(batchLengths).toEqual([2, 1, 1]);
    } else {
      await expect(history.offer(first).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 1, eventId: first.id } });
      await expect(history.offer(second).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 2, eventId: second.id } });
      await expect(history.offer(nearLimit).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 3, eventId: nearLimit.id } });
      await expect(history.offer(third).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 4, eventId: third.id } });
      expect(batchLengths).toEqual([1, 1, 1, 1]);
    }

    const read = await history.read({});
    expect(read).toMatchObject({
      ok: true,
      value: {
        total: 4,
        evidence: [
          expect.objectContaining({ eventId: first.id }),
          expect.objectContaining({ eventId: second.id }),
          expect.objectContaining({ eventId: nearLimit.id }),
          expect.objectContaining({ eventId: third.id })
        ]
      }
    });

    if (!isFake) {
      await history.close();
      return;
    }

    const expectedSerializedBytes = [first, second, nearLimit, third]
      .map((candidate) => serializeJournalEvidenceCandidate(candidate).bytes)
      .reduce((sum, bytes) => sum + bytes, 0);
    const expectedAccountedBytes = [first, second, nearLimit, third]
      .map(estimateHistoryCandidateBytes)
      .reduce((sum, bytes) => sum + bytes, 0);

    const database = await openDatabase(panelSessionId);
    const controlTransaction = database.transaction("historyControl", "readonly");
    const control = await requestValue<Record<string, unknown>>(controlTransaction.objectStore("historyControl").get("control") as IDBRequest<Record<string, unknown>>);
    const evidenceTransaction = database.transaction("evidence", "readonly");
    const records = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        requestValue<Record<string, unknown>>(evidenceTransaction.objectStore("evidence").get(index + 1) as IDBRequest<Record<string, unknown>>)
      )
    );
    database.close();

    expect(control).toMatchObject({
      retainedCount: 4,
      retainedRange: {
        first: { intervalId: `${panelSessionId}:interval-1`, sequence: 1, eventId: first.id },
        last: { intervalId: `${panelSessionId}:interval-1`, sequence: 4, eventId: third.id }
      },
      replayPayloadBytes: expectedSerializedBytes,
      accountedBytes: expectedAccountedBytes
    });
    expect(records.every((record) => record !== undefined)).toBe(true);
    expect(
      records.reduce(
        (sum, record) => sum + (typeof record?.accountedBytes === "number" ? record.accountedBytes : 0),
        0
      )
    ).toBe(expectedAccountedBytes);
    expect(
      records.reduce(
        (sum, record) => sum + (typeof record?.serializedBytes === "number" ? record.serializedBytes : 0),
        0
      )
    ).toBe(expectedSerializedBytes);
    await history.close();
  });

  it("preserves clear success and clear failure behavior", async () => {
    const passSession = nextSessionId("impl-08-clear-pass");
    const pass = await create(passSession);
    const passHistory = pass.history;

    await expect(passHistory.offer(topologyCheckpointFixture(`clear-${passSession}-prior`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });

    const clearSuccess = await passHistory.clear();
    expect(clearSuccess).toMatchObject({ ok: true, value: { previousInterval: { ordinal: 1 }, interval: { ordinal: 2 } } });
    await expect(passHistory.offer(topologyCheckpointFixture(`clear-${passSession}-after`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2 }
    });

    let finishClear: () => void;
    const clearHold = new Promise<void>((resolve) => {
      finishClear = resolve;
    });
    const failingSession = nextSessionId("impl-08-clear-fail");
    const fail = await create(failingSession, {
      clearJournal: async () => {
        await clearHold;
        return false;
      }
    });
    const failHistory = fail.history;
    await expect(failHistory.offer(topologyCheckpointFixture(`clear-${failingSession}-prior`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });

    const clearInProgress = failHistory.clear();
    const duringClear = failHistory.offer(topologyCheckpointFixture(`clear-${failingSession}-during`, REPRESENTATIVE_PAYLOAD_BYTES));
    expect(duringClear.intake).toBe("QUEUED");

    finishClear();
    await expect(clearInProgress).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_FAILED" } });
    await expect(duringClear.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 2 } });
    const failRead = await failHistory.read({});
    expect(failRead).toMatchObject({ ok: true, value: { total: 2 } });

    await passHistory.close();
    await failHistory.close();
  });

  it("handles commit failure and retained-capacity refusal distinctly", async () => {
    const commitSession = nextSessionId("impl-08-commit");
    const commit = await create(commitSession, {
      commitBatch: async (batch) => {
        if (batch.some((candidate) => candidate.id.includes("commit-fail"))) {
          throw new Error("commit failed");
        }
      }
    });
    const commitHistory = commit.history;

    await expect(commitHistory.offer(topologyCheckpointFixture(`commit-${commitSession}-prior`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const failed = commitHistory.offer(topologyCheckpointFixture(`commit-fail-${commitSession}`, REPRESENTATIVE_PAYLOAD_BYTES));
    const tail = commitHistory.offer(topologyCheckpointFixture(`commit-tail-${commitSession}`, REPRESENTATIVE_PAYLOAD_BYTES));
    await expect(failed.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(tail.settled).resolves.toMatchObject({ outcome: "NOT_EVIDENCE", problem: { code: "JOURNAL_COMMIT_FAILED" } });
    await expect(commitHistory.read({})).resolves.toMatchObject({ ok: true, value: { total: 1 } });

    const capacitySession = nextSessionId("impl-08-capacity");
    const capacity = await create(capacitySession, {
      capacity: { maxRetainedBytes: 5_000, maxRetainedCount: 100 }
    });
    const capacityHistory = capacity.history;
    await expect(capacityHistory.offer(topologyCheckpointFixture(`capacity-${capacitySession}-prior`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const refuses = capacityHistory.offer(topologyCheckpointFixture(`capacity-${capacitySession}-refusal`, NEAR_TWO_MEBIBYTE_PAYLOAD_BYTES));
    expect(refuses.intake).toBe("REFUSED");
    await expect(refuses.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_BYTE_LIMIT", dimension: "RETAINED_BYTES" },
      committedEvidenceBoundary: { sequence: 1 }
    });
    await expect(capacityHistory.offer(topologyCheckpointFixture(`capacity-${capacitySession}-after`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "RETAINED_BYTE_LIMIT" }
    });
    await expect(commitHistory.close()).resolves.toMatchObject({ ok: true });
    await expect(capacityHistory.close()).resolves.toMatchObject({ ok: true });
  });

  it("keeps close idempotent on repeated success and failure", async () => {
    const pass = await create(nextSessionId("impl-08-close-pass"));
    const passHistory = pass.history;
    await expect(passHistory.offer(topologyCheckpointFixture(`close-${pass.panelSessionId}-one`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE"
    });
    const closeSuccessOne = await passHistory.close();
    const closeSuccessTwo = await passHistory.close();
    expect(closeSuccessTwo).toEqual(closeSuccessOne);

    const fail = await create(nextSessionId("impl-08-close-fail"), {
      closeJournal: async () => {
        throw new Error("close failed");
      }
    });
    const failHistory = fail.history;
    await expect(failHistory.offer(topologyCheckpointFixture(`close-${fail.panelSessionId}-one`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE"
    });
    const closeFailureOne = await failHistory.close();
    const closeFailureTwo = await failHistory.close();
    expect(closeFailureOne).toMatchObject({ ok: false, problem: { code: "CLOSE_FAILED" } });
    expect(closeFailureTwo).toEqual(closeFailureOne);
  });

  it("accepts invalid topology checkpoints without boundary side effects", async () => {
    const invalidSession = nextSessionId("impl-08-invalid");
    const { history } = await create(invalidSession);
    let terminalSeen = false;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "terminal") {
        terminalSeen = true;
      }
    });

    const first = topologyCheckpointFixture(`invalid-${invalidSession}-prior`, REPRESENTATIVE_PAYLOAD_BYTES);
    await expect(history.offer(first).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } });
    const invalid = history.offer({ kind: "topology-checkpoint", id: "", checkpoint: [] as never });
    await expect(invalid.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "INVALID_CANDIDATE" },
      committedEvidenceBoundary: { sequence: 1, eventId: first.id }
    });

    await expect(history.offer(topologyCheckpointFixture(`invalid-${invalidSession}-after`, REPRESENTATIVE_PAYLOAD_BYTES)).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2 }
    });

    const read = await history.read({});
    expect(read).toMatchObject({
      ok: true,
      value: {
        total: 2,
        committedEvidenceBoundary: { sequence: 2, eventId: `invalid-${invalidSession}-after` }
      }
    });
    expect(terminalSeen).toBe(false);
    await history.close();
  });
});
