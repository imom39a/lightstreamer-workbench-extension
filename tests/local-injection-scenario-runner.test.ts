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
  it("halts a retired target before allocating identity and terminalizes every due Step", () => {
    const clock = new FakeClock();
    const allocateInjectionId = vi.fn(() => "must-not-exist");
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId,
      execute: async ({ ordinal }) => delivered(ordinal),
      beforeDispatch: () => ({ allow: false, reason: "TARGET_RETIRED", detail: "Session session-1 retired." })
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", run: { status: "stopped" } });
    expect(runner.snapshot().run.trace).toMatchObject([
      { kind: "not-run", stepId: "step-1", detail: "Session session-1 retired." },
      { kind: "not-run", stepId: "step-2" }
    ]);
    expect(allocateInjectionId).not.toHaveBeenCalled();
  });

  it("records exact listener drift, requires immutable-plan re-review, and then resumes", () => {
    const clock = new FakeClock();
    let drift = true;
    const run = reviewedRun([0]);
    const runner = createLocalInjectionScenarioRunner(run, {
      clock,
      allocateInjectionId: () => "injection-1",
      execute: async () => delivered(1),
      beforeDispatch: () => drift
        ? { allow: false, reason: "DRIFT", detail: "Listener set changed.", drift: { kind: "LISTENER_SET", addedListenerIds: ["listener-2"], removedListenerIds: [], evidence: null } }
        : { allow: true }
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "DRIFT_REVIEW_REQUIRED" });
    expect(runner.snapshot().run.drifts).toEqual([expect.objectContaining({ kind: "LISTENER_SET", addedListenerIds: ["listener-2"] })]);
    const originalPlan = runner.snapshot().run.steps;
    drift = false;
    expect(runner.reReview({ targetFingerprint: "fingerprint-2", listenerIds: ["listener-1", "listener-2"], committedEvidenceBoundary: { intervalId: "interval-1", sequence: 7, eventId: "server-7" } })).toEqual({ ok: true });
    expect(runner.snapshot().run.steps).toBe(originalPlan);
    expect(runner.snapshot().run.authorizations).toHaveLength(2);
    expect(runner.snapshot().run.authorizations[1]).toMatchObject({ kind: "DRIFT_REVIEW", targetFingerprint: "fingerprint-2", authorizedRemainingFromOrdinal: 1 });
  });

  it("fails closed before identity allocation when an exact drift record exceeds its reserved ledger", () => {
    const clock = new FakeClock();
    const allocateInjectionId = vi.fn(() => "must-not-exist");
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId,
      execute: async ({ ordinal }) => delivered(ordinal),
      beforeDispatch: () => ({
        allow: false,
        reason: "DRIFT",
        detail: "x".repeat(9 * 1024),
        drift: { kind: "LISTENER_SET", addedListenerIds: ["listener-2"], removedListenerIds: [], evidence: null }
      })
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", run: { status: "stopped", drifts: [] } });
    expect(runner.snapshot().run.trace).toMatchObject([
      { kind: "not-run", stepId: "step-1" },
      { kind: "not-run", stepId: "step-2" }
    ]);
    expect(allocateInjectionId).not.toHaveBeenCalled();
  });

  it("terminalizes the immutable remainder when drift re-review cannot retain its exact authorization", () => {
    const clock = new FakeClock();
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId: () => "must-not-exist",
      execute: async ({ ordinal }) => delivered(ordinal),
      beforeDispatch: () => ({ allow: false, reason: "DRIFT", detail: "Listener changed." })
    });
    runner.play();
    clock.advance(0);
    expect(runner.reReview({
      targetFingerprint: "x".repeat(9 * 1024),
      listenerIds: ["listener-1"],
      committedEvidenceBoundary: null
    })).toEqual({ ok: false, reason: "Bounded authorization ledger capacity reached." });
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", run: { status: "stopped", authorizations: [{ kind: "INITIAL_REVIEW" }] } });
    expect(runner.snapshot().run.trace).toHaveLength(2);
  });

  it.each([
    ["partial", { ...delivered(1).outcome, disposition: "partial" as const, headline: "PARTIALLY DELIVERED" as const, status: "listener-error" as const, attemptedCount: 3, deliveredCount: 2, failedCount: 1 }],
    ["listener failure", { ...delivered(1).outcome, disposition: "failed" as const, headline: "DELIVERY FAILED" as const, status: "listener-error" as const, attemptedCount: 1, deliveredCount: 0, failedCount: 1 }],
    ["stale target", { ...delivered(1).outcome, disposition: "blocked" as const, headline: "NOT RUN" as const, status: "stale-target" as const, requestId: null }],
    ["review blocked", { ...delivered(1).outcome, disposition: "blocked" as const, headline: "NOT RUN" as const, status: "review-blocked" as const, requestId: null }],
    ["wire failure", { ...delivered(1).outcome, disposition: "failed" as const, headline: "DELIVERY FAILED" as const, status: "wire-error" as const }],
    ["bridge failure", { ...delivered(1).outcome, disposition: "failed" as const, headline: "DELIVERY FAILED" as const, status: "bridge-error" as const }],
    ["unknown", { ...delivered(1).outcome, disposition: "acknowledgement-unknown" as const, headline: "DELIVERY UNKNOWN" as const, status: "acknowledgement-unknown" as const }],
    ["delivered-unretained", delivered(1).outcome]
  ])("stops truthfully for %s without advancing or fabricating Evidence", async (_name, outcome) => {
    const clock = new FakeClock();
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute: async () => ({
        kind: "attempted",
        outcome,
        evidence: outcome.disposition === "delivered" ? null : { intervalId: "must-not", sequence: 99, eventId: "must-not" }
      })
    });
    runner.play();
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("stopped"));
    expect(runner.snapshot().run.nextOrdinal).toBe(1);
    expect(runner.snapshot().run.trace[0]).toMatchObject({
      kind: "attempted",
      evidence: null,
      retention: outcome.disposition === "delivered" ? "DELIVERED_UNRETAINED" : "NOT_CREATED",
      evidenceAvailability: "NOT_APPLICABLE"
    });
    expect(runner.snapshot().run.trace[1]).toMatchObject({ kind: "not-run", stepId: "step-2" });
  });
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
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "DRIFT_REVIEW_REQUIRED" });
    expect(allocateInjectionId).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    runner.play();
    runner.stepNext();
    clock.advance(1_000);
    expect(allocateInjectionId).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(runner.snapshot().run.controls.map(({ kind }) => kind)).toEqual(["PLAY", "PAUSE"]);
  });

  it("bounds admitted control history and preserves reserved Pause and Stop capacity", () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([10_000]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute
    });
    for (let index = 0; index < 1_000; index += 1) {
      runner.play();
      runner.pause();
    }
    const beforeStop = runner.snapshot();
    expect(beforeStop.phase).toBe("paused");
    expect(beforeStop.run.controls.length).toBeLessThan(1_000);
    expect(beforeStop.run.controlReservationBytes).toBeGreaterThan(0);
    expect(beforeStop.controlCapacityReached).toBe(true);
    runner.stop();
    expect(runner.snapshot()).toMatchObject({ phase: "stopped" });
    expect(runner.snapshot().run.controls.at(-1)).toMatchObject({ kind: "STOP" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("marks bounded control details with truthful original and retained byte counts", () => {
    const clock = new FakeClock();
    const runner = createLocalInjectionScenarioRunner(reviewedRun([100]), {
      clock,
      allocateInjectionId: () => "injection-1",
      execute: async () => delivered(1)
    });
    runner.play();
    runner.pause("USER", "🧭".repeat(1_000));
    const control = runner.snapshot().run.controls.at(-1)!;
    expect(control.detailLimited).toMatchObject({ originalBytes: 4_000, retainedBytes: expect.any(Number) });
    expect(control.detailLimited!.retainedBytes).toBeLessThan(control.detailLimited!.originalBytes);
    expect(new TextEncoder().encode(JSON.stringify(control)).byteLength).toBeLessThanOrEqual(512);
  });

  it("admits enough control Trace capacity to Step next through all 100 reviewed members", async () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun(Array.from({ length: 100 }, () => 1_000)), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute
    });
    expect(runner.snapshot().run.controlReservationBytes).toBeGreaterThanOrEqual(102 * 512);
    for (let ordinal = 1; ordinal <= 100; ordinal += 1) {
      runner.stepNext();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(runner.snapshot().run.trace).toHaveLength(ordinal);
    }
    expect(runner.snapshot()).toMatchObject({ phase: "complete", run: { controls: expect.any(Array) } });
    expect(runner.snapshot().run.controls).toHaveLength(100);
    expect(execute).toHaveBeenCalledTimes(100);
  });

  it("allows post-settlement projection checks to pause before the next delay", async () => {
    const clock = new FakeClock();
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(reviewedRun([0, 100]), {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute,
      afterSettlement: async () => ({ continue: false, reason: "DRIFT", detail: "Committed Server Evidence interleaved after settlement." })
    });
    runner.play();
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "DRIFT_REVIEW_REQUIRED", nextOrdinal: 2, remainingDelayMs: 100 }));
    clock.advance(1_000);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(runner.snapshot().run.controls.at(-1)).toMatchObject({ kind: "PAUSE", reason: "DRIFT" });
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
