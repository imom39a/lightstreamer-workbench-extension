import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type EvidenceCandidate,
  type HistoryPublication,
  type OpenEventHistoryOptions
} from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

type Factory = (options?: OpenEventHistoryOptions) => Promise<EventHistory>;

const factories: readonly [string, Factory][] = [
  ["memory", (options = {}) => createMemoryEventHistoryForTests(options)],
  ["indexeddb", (options = {}) => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    return createIndexedDbEventHistory({
      ...options,
      panelSessionId: options.panelSessionId ?? `lifecycle-continuity-${Date.now()}-${Math.random()}`
    });
  }]
];

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

describe.each(factories)("history-impl-09 continuity lifecycle (%s)", (_name, createHistory) => {
  it("deeply freezes retention publications before the first subscriber receives them", async () => {
    const history = await createHistory({
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000 }
    });
    const rollovers: Array<Extract<HistoryPublication, { type: "retention-advanced" }>> = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "retention-advanced") rollovers.push(publication);
    });
    try {
      await history.offer(candidate("one")).settled;
      await history.offer(candidate("two")).settled;
      await history.offer(candidate("three")).settled;
      const rollover = rollovers.at(-1);
      expect(rollover).toBeDefined();
      if (!rollover) throw new Error("Expected a retention publication.");
      expect(Object.isFrozen(rollover)).toBe(true);
      expect(Object.isFrozen(rollover.status)).toBe(true);
      expect(Object.isFrozen(rollover.evicted)).toBe(true);
      expect(Object.isFrozen(rollover.status.retention)).toBe(true);
    } finally {
      await history.close();
    }
  });

  it("deeply freezes memory-fallback status while keeping later offers eligible", async () => {
    const history = await createHistory({
      commitBatch: async () => { throw new Error("journal unavailable"); }
    });
    const fallbacks: Array<Extract<HistoryPublication, { type: "persistence-state" }>> = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "persistence-state" && publication.transition === "MEMORY_FALLBACK") fallbacks.push(publication);
    });
    try {
      await expect(history.offer(candidate("first")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
      await expect(history.offer(candidate("later")).settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
      const fallback = fallbacks.at(-1);
      expect(fallback).toBeDefined();
      if (!fallback) throw new Error("Expected a memory-fallback publication.");
      expect(Object.isFrozen(fallback)).toBe(true);
      expect(Object.isFrozen(fallback.persistence)).toBe(true);
      expect(Object.isFrozen(fallback.status)).toBe(true);
      expect(history.status()).toMatchObject({ phase: "RUNNING", accepted: 2 });
    } finally {
      await history.close();
    }
  });

  it("replays the newest retained Evidence after rollover without inventing terminal state", async () => {
    const history = await createHistory({
      byteEstimator: () => 10,
      capacity: { maxRetainedCount: 3, maxRetainedBytes: 1_000 }
    });
    try {
      for (const id of ["one", "two", "three", "four"]) await history.offer(candidate(id)).settled;
      const replayed: string[] = [];
      history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
        if (publication.type === "committed-evidence") replayed.push(...publication.evidence.map(({ eventId }) => eventId));
      });
      await vi.waitFor(() => expect(replayed).toEqual(["three", "four"]));
      expect(history.status()).toMatchObject({ phase: "RUNNING", captureOperation: "RUNNING" });
    } finally {
      await history.close();
    }
  });
});
