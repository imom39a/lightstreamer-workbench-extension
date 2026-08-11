import { describe, expect, it } from "vitest";

import { createMemoryEventHistoryForTests, type EvidenceCandidate } from "../src/core/event-history-authoritative";

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

describe("history-impl-06 memory contract", () => {
  it("reads only committed Evidence without flushing a pending commit", async () => {
    let commitStarted!: () => void;
    let releaseCommit!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const history = await createMemoryEventHistoryForTests({
      commitBatch: async () => {
        commitStarted();
        await commitGate;
      }
    });

    const pending = history.offer(candidate("pending"));
    await started;
    await expect(history.read({ candidateKind: "lightstreamer" })).resolves.toMatchObject({
      ok: true,
      value: { total: 0, evidence: [] }
    });
    releaseCommit();
    await expect(pending.settled).resolves.toMatchObject({ outcome: "BECAME_EVIDENCE" });
    await history.close();
  });

  it("returns identical outcomes for repeated failed close attempts", async () => {
    const history = await createMemoryEventHistoryForTests({
      clearJournal: async () => {
        throw new Error("close unavailable");
      }
    });
    const firstClose = await history.close();
    const repeatedClose = await history.close();

    expect(firstClose).toMatchObject({ ok: false, problem: { code: "CLOSE_FAILED" } });
    expect(repeatedClose).toEqual(firstClose);
  });

  it("cuts intake immediately when close is requested during clear", async () => {
    const panelSessionId = "impl-06-close-during-clear-cuts-intake";
    let clearStarted!: () => void;
    let clearCalls = 0;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId,
      clearJournal: async () => {
        clearCalls += 1;
        if (clearCalls === 1) {
          clearStarted();
          await gate;
        }
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const clear = history.clear();
    await started;
    const close = history.close();
    const duringClear = history.offer(candidate("during-clear"));
    expect(duringClear.intake).toBe("REFUSED");
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "HISTORY_CLOSED" }
    });
    release();
    await expect(clear).resolves.toMatchObject({ ok: true });
    await expect(close).resolves.toMatchObject({ ok: true });
  });

  it("continues in the prior interval when clear uncertainty is explicit", async () => {
    const panelSessionId = "impl-06-clear-uncertain";
    let release!: () => void;
    let clearStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId,
      clearJournal: async () => {
        clearStarted();
        await gate;
        return false;
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const clear = history.clear();
    await started;
    await expect(history.read({})).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_IN_PROGRESS" }
    });
    const duringClear = history.offer(candidate("during-clear"));
    expect(duringClear.intake).toBe("QUEUED");
    release();

    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 2 }
    });
    await expect(history.offer(candidate("after-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 3 }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        interval: { id: `${panelSessionId}:interval-1` },
        evidence: [
          { eventId: "pre-clear", sequence: 1 },
          { eventId: "during-clear", sequence: 2 },
          { eventId: "after-clear", sequence: 3 }
        ]
      }
    });
    await history.close();
  });

  it("terminalizes clear failure and rejects clear-window capture", async () => {
    const panelSessionId = "impl-06-clear-terminal";
    let release!: () => void;
    let clearStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      clearStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const history = await createMemoryEventHistoryForTests({
      panelSessionId,
      clearJournal: async () => {
        clearStarted();
        await gate;
        throw new Error("clear unavailable");
      }
    });
    const phases: string[] = [];
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") {
        phases.push(publication.status.phase);
      }
    });

    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1 }
    });
    const clear = history.clear();
    await started;
    await expect(history.read({})).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_IN_PROGRESS" }
    });
    const duringClear = history.offer(candidate("during-clear"));
    const afterWindow = history.offer(candidate("after-window"));
    let duringClearSettlementCount = 0;
    let afterWindowSettlementCount = 0;
    void duringClear.settled.finally(() => {
      duringClearSettlementCount += 1;
    });
    void afterWindow.settled.finally(() => {
      afterWindowSettlementCount += 1;
    });
    expect(duringClear.intake).toBe("QUEUED");
    expect(afterWindow.intake).toBe("QUEUED");
    release();

    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    expect(phases.some((phase) => phase !== "RUNNING")).toBe(true);
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(afterWindow.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    expect(duringClearSettlementCount).toBe(1);
    expect(afterWindowSettlementCount).toBe(1);
    const postTerminal = history.offer(candidate("post-terminal"));
    expect(postTerminal.intake).toBe("REFUSED");
    await expect(postTerminal.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: [{ eventId: "pre-clear", sequence: 1 }],
        interval: { id: `${panelSessionId}:interval-1` }
      }
    });
    await history.close();
  });

  it("settles clear-window captures as terminal when commit fails while clear waits", async () => {
    const panelSessionId = "impl-06-clear-waiting-commit-fails";
    let release!: () => void;
    let commitStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      commitStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const phases: string[] = [];
    const history = await createMemoryEventHistoryForTests({
      panelSessionId,
      commitBatch: async (batch) => {
        if (batch.some((entry) => entry.id === "in-flight")) {
          commitStarted();
          await gate;
          throw new Error("commit failed");
        }
      }
    });
    await expect(history.offer(candidate("pre-clear")).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { sequence: 1, eventId: "pre-clear" }
    });
    const inFlight = history.offer(candidate("in-flight"));
    await started;
    history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") {
        phases.push(publication.status.phase);
      }
    });
    const clear = history.clear();
    const duringClear = history.offer(candidate("during-clear"));
    expect(duringClear.intake).toBe("QUEUED");
    await expect(history.read({})).resolves.toMatchObject({ ok: false, problem: { code: "CLEAR_IN_PROGRESS" } });

    let duringClearSettledCount = 0;
    let inFlightSettledCount = 0;
    void duringClear.settled.finally(() => { duringClearSettledCount += 1; });
    void inFlight.settled.finally(() => { inFlightSettledCount += 1; });

    release();
    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "HISTORY_STOPPED" }
    });
    expect(phases).toContain("STOPPED");
    await expect(inFlight.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
    });
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" },
      committedEvidenceBoundary: { sequence: 1, eventId: "pre-clear" }
    });
    expect(inFlightSettledCount).toBe(1);
    expect(duringClearSettledCount).toBe(1);
    const postTerminal = history.offer(candidate("post-terminal"));
    expect(postTerminal.intake).toBe("REFUSED");
    await expect(postTerminal.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(history.read({})).resolves.toMatchObject({
      ok: true,
      value: { interval: { id: `${panelSessionId}:interval-1` }, evidence: [{ eventId: "pre-clear", sequence: 1 }] }
    });
    await history.close();
  });
});
