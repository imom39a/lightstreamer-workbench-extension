import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import {
  createMemoryEventHistoryForTests,
  type EventHistory,
  type HistoryPublication
} from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import {
  bindCommittedEvidencePipeline
} from "../src/extension/panel/committed-evidence-pipeline";

function candidate(id: string) {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound" as const,
    source: "server" as const,
    synthetic: false,
    kind: "item-update" as const,
    subscription: { id: "lifecycle-sub", mode: "COMMAND" as const },
    update: { key: id, command: "ADD" as const }
  };
}

async function createHistory(
  kind: "memory" | "indexeddb",
  panelSessionId: string,
  options: Parameters<typeof createMemoryEventHistoryForTests>[0] = {}
): Promise<EventHistory> {
  if (kind === "memory") {
    return createMemoryEventHistoryForTests({ panelSessionId, ...options });
  }
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  return createIndexedDbEventHistory({ panelSessionId });
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("history-impl-09 shared lifecycle blockers", () => {
  it.each(["memory", "indexeddb"] as const)(
    "restarts the %s pipeline follower after a consumer throw and delivers later Evidence once",
    async (kind) => {
      const history = await createHistory(kind, `impl-09-consumer-${kind}`);
      const follow = vi.spyOn(history, "follow");
      const delivered: string[] = [];
      let throwOnce = true;
      const pipeline = bindCommittedEvidencePipeline({
        history,
        onCommittedEvidence: (entry) => {
          delivered.push(entry.eventId);
          if (entry.eventId === "first" && throwOnce) {
            throwOnce = false;
            throw new Error("consumer failed once");
          }
        }
      });

      pipeline.start();
      await expect(pipeline.offer(candidate("first")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 1, eventId: "first" }
      });
      await nextTask();

      await expect(pipeline.offer(candidate("later")).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { sequence: 2, eventId: "later" }
      });
      await nextTask();

      expect(follow).toHaveBeenCalledTimes(2);
      expect(delivered).toEqual(["first", "first", "later"]);
      expect(delivered.filter((eventId) => eventId === "later")).toHaveLength(1);
      await pipeline.close();
    }
  );

  it("publishes one stopped memory terminal with a journal failure after terminal intent persistence fails", async () => {
    const publications: HistoryPublication[] = [];
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "impl-09-memory-terminal-intent-failure",
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      persistTerminalIntent: () => {
        throw new Error("terminal intent persistence failed");
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await expect(history.offer(candidate("committed")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "committed" }
    });
    const advanced = history.offer(candidate("advanced"));
    const crossing = history.offer(candidate("crossing"));
    await expect(advanced.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "advanced" }
    });
    await crossing.settled;

    const terminalPublications = publications.filter((publication) => publication.type === "terminal");
    expect(terminalPublications).toHaveLength(1);
    expect(terminalPublications[0]).toMatchObject({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        committedEvidenceBoundary: { sequence: 2, eventId: "advanced" }
      },
      status: { phase: "STOPPED", captureOperation: "STOPPED" }
    });
    expect(publications.some((publication) => publication.type === "status" && publication.problem?.code === "JOURNAL_COMMIT_FAILED")).toBe(true);
    await expect(history.offer(candidate("after-stop")).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 2, eventId: "advanced" }
    });
    expect(publications.filter((publication) => publication.type === "terminal")).toHaveLength(1);
    await history.close();
  });

  it("publishes one stopped memory terminal with a journal failure after finalization persistence fails", async () => {
    const publications: HistoryPublication[] = [];
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "impl-09-memory-terminal-finalization-failure",
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      finalizeTerminal: () => {
        throw new Error("terminal finalization failed");
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await history.offer(candidate("committed")).settled;
    const advanced = history.offer(candidate("advanced"));
    const crossing = history.offer(candidate("crossing"));
    await expect(advanced.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "advanced" }
    });
    await crossing.settled;

    expect(publications.filter((publication) => publication.type === "terminal")).toHaveLength(1);
    expect(publications.find((publication) => publication.type === "terminal")).toMatchObject({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        committedEvidenceBoundary: { sequence: 2, eventId: "advanced" }
      },
      status: { phase: "STOPPED", captureOperation: "STOPPED" }
    });
    await expect(history.offer(candidate("after-stop")).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await history.close();
  });

  it("publishes one stopped IndexedDB terminal with a journal failure after finalization persistence fails", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const publications: HistoryPublication[] = [];
    const history = await createIndexedDbEventHistory({
      panelSessionId: "impl-09-indexeddb-terminal-finalization-failure",
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 },
      finalizeTerminal: () => {
        throw new Error("terminal finalization failed");
      }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await history.offer(candidate("committed")).settled;
    const advanced = history.offer(candidate("advanced"));
    const crossing = history.offer(candidate("crossing"));
    await expect(advanced.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "advanced" }
    });
    await crossing.settled;

    expect(publications.filter((publication) => publication.type === "terminal")).toHaveLength(1);
    expect(publications.find((publication) => publication.type === "terminal")).toMatchObject({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        committedEvidenceBoundary: { sequence: 2, eventId: "advanced" }
      },
      status: { phase: "STOPPED", captureOperation: "STOPPED" }
    });
    await expect(history.offer(candidate("after-stop")).settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await history.close();
  });

  it("publishes one stopped IndexedDB terminal with a journal failure after terminal intent persistence fails", async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const originalPut = IDBObjectStore.prototype.put;
    let failTerminalIntent = false;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (failTerminalIntent && this.name === "historyControl") {
        throw new Error("terminal intent persistence failed");
      }
      return originalPut.apply(this, args);
    });
    const publications: HistoryPublication[] = [];
    const history = await createIndexedDbEventHistory({
      panelSessionId: "impl-09-indexeddb-terminal-intent-failure",
      capacity: { maxRetainedCount: 2, maxRetainedBytes: 1_000_000 }
    });
    history.follow({ from: "NOW" }, (publication) => publications.push(publication));

    await history.offer(candidate("committed")).settled;
    const advanced = history.offer(candidate("advanced"));
    await expect(advanced.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2, eventId: "advanced" }
    });
    failTerminalIntent = true;
    const crossing = history.offer(candidate("crossing"));
    await crossing.settled;

    expect(publications.filter((publication) => publication.type === "terminal")).toHaveLength(1);
    expect(publications.find((publication) => publication.type === "terminal")).toMatchObject({
      type: "terminal",
      terminal: {
        reason: "JOURNAL_COMMIT_FAILED",
        dimension: "JOURNAL",
        committedEvidenceBoundary: { sequence: 2, eventId: "advanced" }
      },
      status: { phase: "STOPPED", captureOperation: "STOPPED" }
    });
    put.mockRestore();
    await history.close();
  });
});
