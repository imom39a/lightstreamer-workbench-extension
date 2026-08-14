import { describe, expect, it, vi } from "vitest";

import { createLocalInjectionScenarioRunner, type ScenarioClock } from "../src/core/local-injection-scenario-runner";
import { addScenarioStep, createScenarioFromDraft, reviewScenario, updateScenarioSpeed, type ScenarioDraftInput } from "../src/core/local-injection-scenario";

const target = Object.freeze({
  pageEpoch: "page-1",
  clientId: "client-1",
  sessionId: "session-1",
  subscriptionId: "sub-1",
  deliveryPath: "listener" as const,
  listenerId: "listener-1",
  mode: "COMMAND",
  schemaFields: Object.freeze(["command", "key", "qty"])
});

function input(id: string, command: "ADD" | "UPDATE", delayMs: number): ScenarioDraftInput {
  const document = { command, key: "order-7", isSnapshot: false, fields: { command, key: "order-7", qty: id } } as const;
  return {
    id,
    sourceEventId: `source-${id}`,
    sourceRawText: JSON.stringify(document),
    rawText: JSON.stringify(document),
    document,
    ready: true,
    diagnostics: [],
    target,
    item: { name: "orders", position: 1 },
    editor: { cursor: 0, selectionFrom: 0, selectionTo: 0, scrollTop: 0, scrollLeft: 0, compareOpen: false, serializedState: null },
    restorationOrigin: { scopeId: "sub:1", selectionEventId: null, focusedEventId: null, contextId: null },
    relativeDelayMs: delayMs
  };
}

function reviewedRun(delays: readonly number[] = [100, 200], speed: 0.25 | 0.5 | 1 | 2 | 4 = 1) {
  let scenario = createScenarioFromDraft(input("draft-1", "ADD", delays[0]!), { scenarioId: "scenario-1" });
  for (let index = 1; index < delays.length; index += 1) {
    const addition = addScenarioStep(scenario, input(`draft-${index + 1}`, "UPDATE", delays[index]!));
    if (!addition.ok) throw new Error(addition.reason);
    scenario = addition.scenario;
  }
  const speedResult = updateScenarioSpeed(scenario, speed);
  if (!speedResult.ok) throw new Error(speedResult.reason);
  scenario = speedResult.scenario;
  const result = reviewScenario(scenario, {
    runId: "run-1",
    committedEvidenceSeed: null,
    targetFingerprint: "fingerprint-1",
    activeCommandKeysByItem: []
  });
  if (!result.ok) throw new Error(result.reason);
  return result.run;
}

class FakeClock implements ScenarioClock {
  private current = 0;
  private sequence = 0;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();

  now(): number { return this.current; }
  setTimer(callback: () => void, delayMs: number): number {
    const id = ++this.sequence;
    this.timers.set(id, { due: this.current + delayMs, callback });
    return id;
  }
  clearTimer(id: unknown): void { this.timers.delete(Number(id)); }
  advance(ms: number): void {
    this.current += ms;
    const due = [...this.timers.entries()].filter(([, timer]) => timer.due <= this.current).sort((a, b) => a[1].due - b[1].due);
    for (const [id, timer] of due) {
      if (!this.timers.delete(id)) continue;
      timer.callback();
    }
  }
  pending(): number { return this.timers.size; }
}

function delivered(stepOrdinal: number) {
  return {
    kind: "attempted" as const,
    outcome: {
      headline: "DELIVERED LOCALLY" as const,
      disposition: "delivered" as const,
      status: "success" as const,
      executionId: `execution-${stepOrdinal}`,
      requestId: `request-${stepOrdinal}`,
      detail: "settled",
      timestamp: 10_000 + stepOrdinal,
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    },
    evidence: { intervalId: "interval-1", sequence: stepOrdinal, eventId: `local-${stepOrdinal}` }
  };
}

describe("Local Injection Scenario runner", () => {
  it("starts the first relative delay at Play and schedules the next only after Evidence settlement", async () => {
    const clock = new FakeClock();
    let settle!: (value: ReturnType<typeof delivered>) => void;
    const execute = vi.fn(({ ordinal }: { ordinal: number }) => new Promise<ReturnType<typeof delivered>>((resolve) => {
      if (ordinal === 1) settle = resolve;
      else resolve(delivered(ordinal));
    }));
    const runner = createLocalInjectionScenarioRunner(reviewedRun(), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute
    });

    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 0, remainingDelayMs: 100 });
    runner.play();
    clock.advance(99);
    expect(execute).not.toHaveBeenCalled();
    clock.advance(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(0);

    clock.advance(5_000);
    expect(execute).toHaveBeenCalledTimes(1);
    settle(delivered(1));
    await vi.waitFor(() => expect(runner.snapshot()).toMatchObject({ phase: "waiting", nextOrdinal: 2, remainingDelayMs: 200 }));
    expect(clock.pending()).toBe(1);
    clock.advance(199);
    expect(execute).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("scales delays with ceiling, records timer lateness, and never catch-up bursts", async () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([101, 100], 2), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute
    });
    runner.play();
    clock.advance(60);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("waiting"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.snapshot().run.trace[0]).toMatchObject({ timing: {
      originalDelayMs: 101,
      scaledDelayMs: 51,
      plannedDispatchActiveOffsetMs: 51,
      actualDispatchActiveOffsetMs: 60,
      latenessMs: 9
    } });
    expect(clock.pending()).toBe(1);
    expect(runner.snapshot().remainingDelayMs).toBe(50);
  });

  it("cancels a waiting timer and resumes with the exact remaining active delay", () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([100]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute
    });
    runner.play();
    clock.advance(35);
    runner.pause();
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 35, remainingDelayMs: 65, pauseReason: "USER" });
    clock.advance(5_000);
    runner.play();
    clock.advance(64);
    expect(execute).not.toHaveBeenCalled();
    clock.advance(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.snapshot().run.controls.map(({ kind }) => kind)).toEqual(["PLAY", "PAUSE", "RESUME"]);
  });

  it("lets an in-flight Injection settle before honoring Pause", async () => {
    const clock = new FakeClock();
    let settle!: (value: ReturnType<typeof delivered>) => void;
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute: () => new Promise((resolve) => { settle = resolve; })
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot().phase).toBe("in-flight");
    runner.pause();
    expect(runner.snapshot().phase).toBe("pause-pending");
    settle(delivered(1));
    await vi.waitFor(() => expect(runner.snapshot()).toMatchObject({ phase: "paused", nextOrdinal: 2, remainingDelayMs: 100 }));
    expect(runner.snapshot().run.trace[0]).toMatchObject({ evidence: { eventId: "local-1" } });
  });

  it("steps exactly one member immediately and returns to Paused with a manual override", async () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([500, 500]), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute
    });
    runner.stepNext();
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("paused"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.snapshot()).toMatchObject({ nextOrdinal: 2, remainingDelayMs: 500 });
    expect(runner.snapshot().run.trace[0]).toMatchObject({ timing: { manualOverride: true, bypassedDelayMs: 500 } });
    expect(runner.snapshot().run.controls[0]).toMatchObject({ kind: "STEP NEXT" });
  });

  it("stops a waiting Run without dispatch and marks every remaining member NOT RUN", () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([100, 100]), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute
    });
    runner.play();
    clock.advance(20);
    runner.stop("Operator stopped the Run.");
    clock.advance(1_000);
    expect(execute).not.toHaveBeenCalled();
    expect(runner.snapshot().run.trace).toEqual([
      expect.objectContaining({ kind: "not-run", stepId: "step-1" }),
      expect.objectContaining({ kind: "not-run", stepId: "step-2" })
    ]);
  });

  it("preserves an in-flight result when stopped and marks only the remainder NOT RUN", async () => {
    const clock = new FakeClock();
    let settle!: (value: ReturnType<typeof delivered>) => void;
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute: () => new Promise((resolve) => { settle = resolve; })
    });
    runner.play();
    clock.advance(0);
    runner.stop("Stop after current Injection.");
    expect(runner.snapshot().phase).toBe("stop-pending");
    settle(delivered(1));
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("stopped"));
    expect(runner.snapshot().run.trace).toMatchObject([
      { kind: "attempted", stepId: "step-1", evidence: { eventId: "local-1" } },
      { kind: "not-run", stepId: "step-2" }
    ]);
  });

  it("auto-pauses synchronously when hidden and never resumes implicitly", () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([100]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute
    });
    runner.play();
    clock.advance(30);
    runner.setVisible(false);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", visible: false, pauseReason: "HIDDEN", remainingDelayMs: 70 });
    clock.advance(1_000);
    runner.setVisible(true);
    clock.advance(1_000);
    expect(execute).not.toHaveBeenCalled();
    expect(runner.snapshot().run.controls.at(-1)).toMatchObject({ kind: "HIDDEN AUTO-PAUSE", reason: "HIDDEN" });
  });

  it("pauses before identity allocation when a synchronous pre-dispatch guard detects drift", () => {
    const clock = new FakeClock();
    const allocateInjectionId = vi.fn(() => "must-not-exist");
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0]), {
      clock,
      allocateInjectionId,
      execute,
      beforeDispatch: () => ({ allow: false, reason: "DRIFT", detail: "Listener membership changed." })
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "DRIFT" });
    expect(allocateInjectionId).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("disposes timer and promise continuations without a later dispatch", async () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([100]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute
    });
    runner.play();
    runner.dispose();
    clock.advance(1_000);
    await Promise.resolve();
    expect(runner.snapshot().phase).toBe("disposed");
    expect(execute).not.toHaveBeenCalled();
  });
});
