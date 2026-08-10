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
    expect(duringClear.intake).toBe("QUEUED");
    expect(afterWindow.intake).toBe("QUEUED");
    release();

    await expect(clear).resolves.toMatchObject({
      ok: false,
      problem: { code: "CLEAR_FAILED" }
    });
    expect(phases).toContain("DRAINING_TO_STOP");
    await expect(duringClear.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
    await expect(afterWindow.settled).resolves.toMatchObject({
      outcome: "NOT_EVIDENCE",
      problem: { code: "JOURNAL_COMMIT_FAILED" }
    });
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
});
