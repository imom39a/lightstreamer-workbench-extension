import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";
import {
  createIndexedDbEventHistory,
} from "../src/core/event-history-indexeddb";
import type { EvidenceCandidate, HistoryPublication } from "../src/core/event-history-authoritative";

function candidate(sequence: number): EvidenceCandidate {
  return {
    id: `history-100k-04-idb-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "idb-recovery-subscription", mode: "MERGE" },
    update: { isSnapshot: false, fields: { sequence } }
  };
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function freshHistory(panelSessionId: string) {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return createIndexedDbEventHistory({
    panelSessionId,
    capacity: { maxRetainedCount: 2_000, maxRetainedBytes: 8 * 1024 * 1024 }
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error("Timed out waiting for IndexedDB replay.");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("history-100k-04 IndexedDB committed-Evidence replay", () => {
  it("replays bounded chunks, merges a live commit, and resumes after an exact identity", async () => {
    const history = await freshHistory("history-100k-04-indexeddb-live");
    try {
      const receipts = Array.from({ length: 600 }, (_, index) => history.offer(candidate(index + 1)));
      await Promise.all(receipts.map(({ settled }) => settled));

      const publications: HistoryPublication[] = [];
      const received: number[] = [];
      let liveReceipt: ReturnType<typeof history.offer> | undefined;
      let replayComplete = false;
      history.follow({ from: "CURRENT_INTERVAL_START", chunkSize: 64 }, (publication) => {
        publications.push(publication);
        if (publication.type === "committed-evidence") {
          received.push(...publication.evidence.map((entry) => entry.sequence));
          if (publication.evidence[0]?.sequence === 1) liveReceipt = history.offer(candidate(601));
        }
        if (publication.type === "replay-complete") replayComplete = true;
      });

      await waitFor(() => replayComplete && liveReceipt !== undefined);
      await liveReceipt!.settled;
      await waitFor(() => received.at(-1) === 601);

      const chunks = publications
        .filter((publication) => publication.type === "committed-evidence")
        .map((publication) => publication.evidence.length);
      expect(Math.max(...chunks)).toBeLessThanOrEqual(64);
      expect(received).toEqual(Array.from({ length: 601 }, (_, index) => index + 1));
      expect(publications.some((publication) => publication.type === "replay-started")).toBe(true);
      expect(publications.some((publication) => publication.type === "replay-complete")).toBe(true);

      const resumed: number[] = [];
      let resumedComplete = false;
      history.follow({
        from: "CURRENT_INTERVAL_START",
        after: {
          intervalId: "history-100k-04-indexeddb-live:interval-1",
          sequence: 550,
          eventId: "history-100k-04-idb-550"
        },
        chunkSize: 32
      }, (publication) => {
        if (publication.type === "committed-evidence") resumed.push(...publication.evidence.map((entry) => entry.sequence));
        if (publication.type === "replay-complete") resumedComplete = true;
      });
      await waitFor(() => resumedComplete);
      expect(resumed).toEqual(Array.from({ length: 51 }, (_, index) => index + 551));
    } finally {
      await history.close();
    }
  }, 30_000);

  it("cancels before the next chunk and fails closed on a corrupt replay payload", async () => {
    const history = await freshHistory("history-100k-04-indexeddb-corrupt");
    try {
      const receipts = Array.from({ length: 300 }, (_, index) => history.offer(candidate(index + 1)));
      await Promise.all(receipts.map(({ settled }) => settled));

      const cancelled = new AbortController();
      const cancelledPublications: HistoryPublication[] = [];
      history.follow({ from: "CURRENT_INTERVAL_START", chunkSize: 1, signal: cancelled.signal }, (publication) => {
        cancelledPublications.push(publication);
      });
      cancelled.abort();
      await waitFor(() => cancelledPublications.some((publication) => publication.type === "replay-cancelled"));
      expect(cancelledPublications.filter((publication) => publication.type === "committed-evidence")).toHaveLength(0);

      const database = await requestValue(indexedDB.open(authoritativeEventDatabaseName("history-100k-04-indexeddb-corrupt")));
      const transaction = database.transaction("evidence", "readwrite");
      transaction.objectStore("evidence").put({
        intervalId: "history-100k-04-indexeddb-corrupt:interval-1",
        sequence: 1,
        eventId: "history-100k-04-idb-1",
        replayPayload: "{corrupt-replay-payload",
        serializedBytes: 24,
        accountedBytes: 32,
        facets: []
      });
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error("Mutation aborted."));
      });
      database.close();

      const failure: HistoryPublication[] = [];
      const received: number[] = [];
      history.follow({ from: "CURRENT_INTERVAL_START", chunkSize: 32 }, (publication) => {
        failure.push(publication);
        if (publication.type === "committed-evidence") received.push(...publication.evidence.map((entry) => entry.sequence));
      });
      await waitFor(() => failure.some((publication) => publication.type === "replay-failed"));
      expect(received).toEqual([]);
      expect(failure.some((publication) => publication.type === "replay-failed" && publication.problem.code === "REPLAY_FAILED")).toBe(true);
      expect(history.status()).toMatchObject({ phase: "RUNNING", committedEvidenceBoundary: { sequence: 300 } });
    } finally {
      await history.close();
    }
  }, 30_000);
});
