import { describe, expect, it, vi } from "vitest";

import { createLocalInjectionScenarioRunner, type ScenarioClock } from "../src/core/local-injection-scenario-runner";
import { addScenarioCheckpoint, addScenarioStep, createScenarioFromDraft, moveScenarioMember, reviewScenario, SCENARIO_MAX_ACCOUNTED_BYTES, updateScenarioSpeed, type ScenarioDraftInput } from "../src/core/local-injection-scenario";
import type { ScenarioCommittedBoundaryFeed, ScenarioCommittedBoundarySnapshot } from "../src/core/local-injection-scenario-checkpoint";
import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";

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

class FakeBoundaryFeed implements ScenarioCommittedBoundaryFeed {
  private current: ScenarioCommittedBoundarySnapshot = Object.freeze({ boundary: null, intervalId: "interval-1", retainedRange: null, history: "accepting", projection: "live" });
  private readonly listeners = new Set<(snapshot: ScenarioCommittedBoundarySnapshot) => void>();
  snapshot() { return this.current; }
  subscribe(_after: ScenarioCommittedBoundarySnapshot["boundary"], listener: (snapshot: ScenarioCommittedBoundarySnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(snapshot: ScenarioCommittedBoundarySnapshot) {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
  size() { return this.listeners.size; }
}

function checkpointRun(withinActiveMs?: number) {
  const initial = createScenarioFromDraft(input("draft-1", "ADD", 0), { scenarioId: "scenario-checkpoint" });
  const added = addScenarioCheckpoint(initial, {
    id: "checkpoint-1", kind: "checkpoint", name: "Local Evidence committed",
    assertions: [{ id: "assertion-1", kind: "correlated-local-evidence-exists", stepId: "step-1", ...(withinActiveMs === undefined ? {} : { withinActiveMs }) }]
  });
  if (!added.ok) throw new Error(added.reason);
  const reviewed = reviewScenario(added.scenario, { runId: "run-checkpoint", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
}

function conjunctionCheckpointRun() {
  const initial = createScenarioFromDraft(input("draft-1", "ADD", 0), { scenarioId: "scenario-checkpoint-conjunction" });
  const added = addScenarioCheckpoint(initial, {
    id: "checkpoint-1", kind: "checkpoint", name: "Common boundary",
    assertions: [
      { id: "evidence", kind: "correlated-local-evidence-exists", stepId: "step-1", withinActiveMs: 50 },
      { id: "key", kind: "command-key-exists", item: { name: "orders", position: 1 }, key: "order-7", expected: "present", withinActiveMs: 100 }
    ]
  });
  if (!added.ok) throw new Error(added.reason);
  const reviewed = reviewScenario(added.scenario, { runId: "run-conjunction", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
}

function checkpointThenStepRun() {
  const initial = createScenarioFromDraft(input("draft-1", "ADD", 0), { scenarioId: "scenario-checkpoint-next-step" });
  const checkpoint = addScenarioCheckpoint(initial, {
    id: "checkpoint-1", kind: "checkpoint", name: "Captured while hidden",
    assertions: [{ id: "evidence", kind: "correlated-local-evidence-exists", stepId: "step-1", withinActiveMs: 100 }]
  });
  if (!checkpoint.ok) throw new Error(checkpoint.reason);
  const next = addScenarioStep(checkpoint.scenario, input("draft-2", "UPDATE", 25));
  if (!next.ok) throw new Error(next.reason);
  const reviewed = reviewScenario(next.scenario, { runId: "run-hidden-checkpoint", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
}

function highVolumeCheckpointRun() {
  let scenario = createScenarioFromDraft(input("draft-1", "ADD", 0), { scenarioId: "scenario-high-volume-checkpoints" });
  for (let ordinal = 1; ordinal <= 100; ordinal += 1) {
    const stepId = scenario.steps.at(-1)!.id;
    const checkpoint = addScenarioCheckpoint(scenario, {
      id: `checkpoint-${ordinal}`, kind: "checkpoint", name: `Boundary ${ordinal}`,
      assertions: [{ id: `assertion-${ordinal}`, kind: "correlated-local-evidence-exists", stepId }]
    });
    if (!checkpoint.ok) throw new Error(checkpoint.reason);
    scenario = checkpoint.scenario;
    if (ordinal < 100) {
      const next = addScenarioStep(scenario, input(`draft-${ordinal + 1}`, "UPDATE", 0));
      if (!next.ok) throw new Error(next.reason);
      scenario = next.scenario;
    }
  }
  const reviewed = reviewScenario(scenario, { runId: "run-high-volume-checkpoints", committedEvidenceSeed: null, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
}

function diagnosticCheckpointRun(diagnosticObservationBoundary: Readonly<{ intervalId: string; sequence: number }>) {
  const initial = createScenarioFromDraft(input("draft-1", "ADD", 0), { scenarioId: "scenario-diagnostic-checkpoint" });
  const added = addScenarioCheckpoint(initial, {
    id: "checkpoint-diagnostic", kind: "checkpoint", name: "Lost update observed",
    assertions: [{
      id: "diagnostic", kind: "diagnostic-observation-exists", contractVersion: 1,
      ruleCode: "subscription.lost-updates", lifecycle: "occurrence", minimumSeverity: "warning",
      affected: { kind: "subscription", pageId: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1" },
      withinActiveMs: 100
    }]
  });
  if (!added.ok) throw new Error(added.reason);
  const moved = moveScenarioMember(added.scenario, "checkpoint-diagnostic", "earlier");
  if (!moved.ok) throw new Error(moved.reason);
  const reviewed = reviewScenario(moved.scenario, { runId: "run-diagnostic", committedEvidenceSeed: null, diagnosticObservationBoundary, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
}

function maximumDiagnosticCheckpointRun(diagnosticObservationBoundary: Readonly<{ intervalId: string; sequence: number }>, code: string, affected: Readonly<{ kind: "item"; pageId: string; clientId: string; subscriptionId: string; item: string }>) {
  const initial = createScenarioFromDraft(input("draft-maximum-diagnostic", "ADD", 0), { scenarioId: "scenario-maximum-diagnostic-checkpoint" });
  const added = addScenarioCheckpoint(initial, {
    id: "checkpoint-maximum-diagnostic", kind: "checkpoint", name: "Maximum compact diagnostic",
    assertions: [{ id: "maximum-diagnostic", kind: "diagnostic-observation-exists", contractVersion: 1, ruleCode: code, lifecycle: "occurrence", minimumSeverity: "information", affected }]
  });
  if (!added.ok) throw new Error(added.reason);
  const moved = moveScenarioMember(added.scenario, "checkpoint-maximum-diagnostic", "earlier");
  if (!moved.ok) throw new Error(moved.reason);
  const reviewed = reviewScenario(moved.scenario, { runId: "run-maximum-diagnostic", committedEvidenceSeed: null, diagnosticObservationBoundary, targetFingerprint: "fp", activeCommandKeysByItem: [] });
  if (!reviewed.ok) throw new Error(reviewed.reason);
  return reviewed.run;
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
  it("appends a maximum-shaped compact diagnostic reference within its pre-admitted 8 MiB Trace", async () => {
    const component = "🧭".repeat(128);
    const code = "a".repeat(96);
    const affected = { kind: "item", pageId: component, clientId: component, subscriptionId: component, item: component } as const;
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: component });
    const authorization = journal.currentBoundary();
    const run = maximumDiagnosticCheckpointRun(authorization, code, affected);
    await journal.observe({
      code, ruleVersion: Number.MAX_SAFE_INTEGER, severity: "error", lifecycle: { kind: "occurrence", occurrenceId: component }, affected,
      observedAt: Number.MAX_SAFE_INTEGER, observed: "x", limitation: "x", consequence: "x",
      evidenceBoundary: { intervalId: component, sequence: Number.MAX_SAFE_INTEGER, eventId: component },
      route: { kind: "inspect-evidence", evidence: { intervalId: component, sequence: Number.MAX_SAFE_INTEGER, eventId: component } },
      resultRef: { kind: "projection", projection: "local-effective-command-state", key: component }
    });
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const runner = createLocalInjectionScenarioRunner(run, {
      clock, allocateInjectionId: () => "must-not-allocate", execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: () => ({ priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }),
        diagnostics: { currentBoundary: journal.currentBoundary.bind(journal), query: journal.query.bind(journal), subscribe: journal.subscribe.bind(journal) }
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.trace[0]).toMatchObject({ kind: "checkpoint", status: "pass" }));
    const settled = runner.snapshot().run;
    const traceBytes = new TextEncoder().encode(JSON.stringify(settled.trace)).byteLength;
    expect(traceBytes).toBeLessThanOrEqual(settled.traceReservationBytes);
    expect(settled.accountedBytes).toBeLessThanOrEqual(SCENARIO_MAX_ACCOUNTED_BYTES);
    expect(settled.trace[0]).toMatchObject({ assertions: [{ relatedDiagnostics: [{ affected, route: { kind: "inspect-evidence" } }] }] });
  });

  for (const pauseDuringLoad of ["user", "hidden"] as const) {
    it(`preserves ${pauseDuringLoad} pause intent while the initial Diagnostic Observation query is blocked`, async () => {
      const clock = new FakeClock();
      const feed = new FakeBoundaryFeed();
      const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: `scenario-diagnostic-loading-${pauseDuringLoad}` });
      const authorization = journal.currentBoundary();
      let releaseQuery!: () => void;
      let queryResolved = false;
      const queryBlocked = new Promise<void>((resolve) => { releaseQuery = resolve; });
      const query = vi.fn(async (request: Parameters<typeof journal.query>[0]) => {
        await queryBlocked;
        const read = await journal.query(request);
        queryResolved = true;
        return read;
      });
      const runner = createLocalInjectionScenarioRunner(diagnosticCheckpointRun(authorization), {
        clock,
        allocateInjectionId: () => "must-not-allocate",
        execute: async () => delivered(1),
        checkpoint: {
          feed,
          observations: () => ({ priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }),
          diagnostics: { currentBoundary: journal.currentBoundary.bind(journal), query, subscribe: journal.subscribe.bind(journal) }
        }
      });

      runner.play();
      clock.advance(0);
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
      clock.advance(40);
      if (pauseDuringLoad === "user") runner.pause();
      else runner.setVisible(false);
      expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60, pauseReason: pauseDuringLoad === "user" ? "USER" : "HIDDEN" });
      expect(clock.pending()).toBe(0);

      releaseQuery();
      await vi.waitFor(() => expect(queryResolved).toBe(true));
      expect(runner.snapshot().activeCheckpoint).toMatchObject({ checkpointId: "checkpoint-diagnostic", deadlineActiveOffsetMs: 100 });
      expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60, pauseReason: pauseDuringLoad === "user" ? "USER" : "HIDDEN" });
      expect(clock.pending()).toBe(0);
      clock.advance(10_000);
      expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60 });

      if (pauseDuringLoad === "hidden") runner.setVisible(true);
      runner.play();
      expect(runner.snapshot().phase).toBe("checkpoint-waiting");
      expect(clock.pending()).toBe(1);
      clock.advance(59);
      expect(runner.snapshot().phase).toBe("checkpoint-waiting");
      clock.advance(1);
      expect(runner.snapshot()).toMatchObject({ phase: "stopped", activeOffsetMs: 100 });
      expect(runner.snapshot().run.trace[0]).toMatchObject({ kind: "checkpoint", status: "expired" });
      expect(clock.pending()).toBe(0);
    });
  }

  it("cannot resurrect a Diagnostic Observation Checkpoint after Stop while its initial query is blocked", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostic-loading-stop" });
    const authorization = journal.currentBoundary();
    let releaseQuery!: () => void;
    let queryResolved = false;
    const queryBlocked = new Promise<void>((resolve) => { releaseQuery = resolve; });
    const query = vi.fn(async (request: Parameters<typeof journal.query>[0]) => {
      await queryBlocked;
      const read = await journal.query(request);
      queryResolved = true;
      return read;
    });
    const allocateInjectionId = vi.fn(() => "must-not-allocate");
    const runner = createLocalInjectionScenarioRunner(diagnosticCheckpointRun(authorization), {
      clock, allocateInjectionId, execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: () => ({ priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }),
        diagnostics: { currentBoundary: journal.currentBoundary.bind(journal), query, subscribe: journal.subscribe.bind(journal) }
      }
    });

    runner.play();
    clock.advance(0);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    runner.stop();
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", activeCheckpoint: null, remainingDelayMs: 0 });
    const stoppedTrace = runner.snapshot().run.trace;
    releaseQuery();
    await vi.waitFor(() => expect(queryResolved).toBe(true));
    clock.advance(10_000);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", activeCheckpoint: null, remainingDelayMs: 0 });
    expect(runner.snapshot().run.trace).toBe(stoppedTrace);
    expect(clock.pending()).toBe(0);
    expect(feed.size()).toBe(0);
    expect(allocateInjectionId).not.toHaveBeenCalled();
  });

  it("queries the authorized Diagnostic Observation range and cannot lose a racing feed commit", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostic" });
    const authorization = journal.currentBoundary();
    const originalQuery = journal.query.bind(journal);
    let releaseFirstQuery!: () => void;
    const firstQueryBlocked = new Promise<void>((resolve) => { releaseFirstQuery = resolve; });
    let first = true;
    const query = vi.fn(async (request: Parameters<typeof journal.query>[0]) => {
      if (first) {
        first = false;
        await firstQueryBlocked;
      }
      return originalQuery(request);
    });
    const runner = createLocalInjectionScenarioRunner(diagnosticCheckpointRun(authorization), {
      clock,
      allocateInjectionId: () => "must-not-allocate",
      execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: () => ({ priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }),
        diagnostics: { currentBoundary: journal.currentBoundary.bind(journal), query, subscribe: journal.subscribe.bind(journal) }
      }
    });

    runner.play();
    clock.advance(0);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    await journal.observe({
      code: "subscription.lost-updates", severity: "warning", lifecycle: { kind: "occurrence", occurrenceId: "lost-1" },
      affected: { kind: "subscription", pageId: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1" },
      observedAt: 1, observed: "Lost updates", limitation: "Count only", consequence: "Projection may be incomplete", route: { kind: "inspect-affected" }
    });
    releaseFirstQuery();

    await vi.waitFor(() => expect(runner.snapshot().run.trace[0]).toMatchObject({ kind: "checkpoint", status: "pass" }));
    expect(runner.snapshot().phase).toBe("waiting");
    expect(query.mock.calls[0]?.[0]).toMatchObject({ after: authorization, through: authorization, codes: ["subscription.lost-updates"], lifecycle: "occurrence", minimumSeverity: "warning" });
    expect(query.mock.calls.at(-1)?.[0]).toMatchObject({ after: authorization, through: { sequence: 1 } });
    expect(runner.snapshot().run.trace).toMatchObject([{ kind: "checkpoint", status: "pass", assertions: [{ relatedDiagnostics: [{ id: expect.stringContaining("lost-1") }] }] }]);
  });

  it("uses the latest drift re-review diagnostic cursor and keeps the eventual window on active time", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostic-rereview" });
    const affected = { kind: "subscription", pageId: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "sub-1" } as const;
    let drift = true;
    const query = vi.fn(journal.query.bind(journal));
    const runner = createLocalInjectionScenarioRunner(diagnosticCheckpointRun(journal.currentBoundary()), {
      clock,
      allocateInjectionId: () => "injection-after-checkpoint",
      execute: async () => delivered(1),
      beforeDispatch: () => drift ? { allow: false, reason: "DRIFT", detail: "Listener changed." } : { allow: true },
      checkpoint: {
        feed,
        observations: () => ({ priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }),
        diagnostics: { currentBoundary: journal.currentBoundary.bind(journal), query, subscribe: journal.subscribe.bind(journal) }
      }
    });
    runner.play();
    clock.advance(0);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "DRIFT_REVIEW_REQUIRED" });
    await journal.observe({ code: "subscription.lost-updates", severity: "warning", lifecycle: { kind: "occurrence", occurrenceId: "before-rereview" }, affected, observedAt: 1, observed: "Earlier loss", limitation: "Count only", consequence: "May be incomplete", route: { kind: "inspect-affected" } });
    const reauthorized = journal.currentBoundary();
    expect(runner.reReview({ targetFingerprint: "fingerprint-2", listenerIds: ["listener-1"], committedEvidenceBoundary: null, diagnosticObservationBoundary: reauthorized })).toEqual({ ok: true });
    drift = false;
    runner.stepNext();
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("checkpoint-waiting"));
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ after: reauthorized, through: reauthorized }));
    clock.advance(40);
    runner.setVisible(false);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60, pauseReason: "HIDDEN" });
    clock.advance(10_000);
    await journal.observe({ code: "subscription.lost-updates", severity: "warning", lifecycle: { kind: "occurrence", occurrenceId: "after-rereview" }, affected, observedAt: 2, observed: "Later loss", limitation: "Count only", consequence: "May be incomplete", route: { kind: "inspect-affected" } });
    await vi.waitFor(() => expect(runner.snapshot().run.trace[0]).toMatchObject({ kind: "checkpoint", status: "pass", settledActiveOffsetMs: 40, assertions: [{ relatedDiagnostics: [{ lifecycle: { occurrenceId: "after-rereview" } }] }] }));
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "HIDDEN", activeOffsetMs: 40 });
  });
  it("evaluates a zero-Injection Checkpoint without allocating an Injection identity", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const allocateInjectionId = vi.fn(({ ordinal }) => `injection-${ordinal}`);
    const evidence = { intervalId: "interval-1", sequence: 1, eventId: "local-1" };
    const runner = createLocalInjectionScenarioRunner(checkpointRun(), {
      clock, allocateInjectionId, execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: (run) => ({
          priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])),
          correlatedLocalEvidence: new Map([["step-1", evidence]]),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("complete"));
    expect(allocateInjectionId).toHaveBeenCalledTimes(1);
    expect(runner.snapshot().run.trace).toMatchObject([
      { kind: "attempted", stepId: "step-1" },
      { kind: "checkpoint", checkpointId: "checkpoint-1", status: "pass", resultBoundary: null }
    ]);
    expect(feed.size()).toBe(0);
  });

  it("waits on post-batch committed boundaries, freezes expiry while paused, and satisfies while Capture continues", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    let evidence: { intervalId: string; sequence: number; eventId: string } | null = null;
    const runner = createLocalInjectionScenarioRunner(checkpointRun(100), {
      clock, allocateInjectionId: () => "injection-1", execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: (run) => ({
          priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])),
          correlatedLocalEvidence: new Map(evidence ? [["step-1", evidence]] : []),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("checkpoint-waiting"));
    expect(runner.snapshot().activeCheckpoint).toMatchObject({ checkpointId: "checkpoint-1", deadlineActiveOffsetMs: 100, status: "waiting" });
    clock.advance(40); runner.pause(); clock.advance(500);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40 });
    evidence = { intervalId: "interval-1", sequence: 2, eventId: "local-2" };
    feed.publish({ boundary: evidence, intervalId: "interval-1", retainedRange: { first: evidence, last: evidence }, history: "accepting", projection: "live" });
    expect(runner.snapshot()).toMatchObject({ phase: "complete", run: { trace: [{ kind: "attempted" }, { kind: "checkpoint", status: "pass" }] } });
    expect(feed.size()).toBe(0);
  });
  it("preserves the hidden auto-pause reason when Capture satisfies a Checkpoint before Resume", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    let evidence: { intervalId: string; sequence: number; eventId: string } | null = null;
    const runner = createLocalInjectionScenarioRunner(checkpointThenStepRun(), {
      clock, allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`, execute: async ({ ordinal }) => delivered(ordinal),
      checkpoint: {
        feed,
        observations: (run) => ({
          priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])),
          correlatedLocalEvidence: new Map(evidence ? [["step-1", evidence]] : []),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("checkpoint-waiting"));
    runner.setVisible(false);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "HIDDEN" });
    evidence = { intervalId: "interval-1", sequence: 2, eventId: "local-2" };
    feed.publish({ boundary: evidence, intervalId: "interval-1", retainedRange: { first: evidence, last: evidence }, history: "accepting", projection: "live" });
    expect(runner.snapshot()).toMatchObject({ phase: "paused", pauseReason: "HIDDEN", run: { nextMemberIndex: 2 } });
  });

  it("expires at the final active boundary and unsubscribes on Stop", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const runner = createLocalInjectionScenarioRunner(checkpointRun(50), {
      clock, allocateInjectionId: () => "injection-1", execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: (run) => ({ priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) })
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("checkpoint-waiting"));
    clock.advance(50);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", run: { trace: [{ kind: "attempted" }, { kind: "checkpoint", status: "expired" }] } });
    expect(feed.size()).toBe(0);
  });
  it("expires a mixed-window conjunction at its first missed common boundary instead of waiting forever", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const evidence = { intervalId: "interval-1", sequence: 1, eventId: "local-1" };
    const runner = createLocalInjectionScenarioRunner(conjunctionCheckpointRun(), {
      clock, allocateInjectionId: () => "injection-1", execute: async () => delivered(1),
      checkpoint: {
        feed,
        observations: (run) => ({
          priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])),
          correlatedLocalEvidence: new Map([["step-1", evidence]]),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    expect(runner.snapshot().phase).toBe("checkpoint-waiting");
    clock.advance(50);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", run: { trace: [{ kind: "attempted" }, { kind: "checkpoint", status: "expired" }] } });
    expect(clock.pending()).toBe(0);
    expect(feed.size()).toBe(0);
  });
  it("resumes an unsatisfied Checkpoint with only its remaining active-time window", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const runner = createLocalInjectionScenarioRunner(checkpointRun(50), {
      clock, allocateInjectionId: () => "injection-1", execute: async () => delivered(1),
      checkpoint: { feed, observations: (run) => ({ priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }) }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0);
    expect(runner.snapshot().phase).toBe("checkpoint-waiting");
    clock.advance(20); runner.pause();
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 20, remainingDelayMs: 30, activeCheckpoint: { deadlineActiveOffsetMs: 50 } });
    clock.advance(500);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 20, remainingDelayMs: 30 });
    runner.play(); clock.advance(29);
    expect(runner.snapshot().phase).toBe("checkpoint-waiting");
    clock.advance(1);
    expect(runner.snapshot()).toMatchObject({ phase: "stopped", activeOffsetMs: 50, run: { trace: [{ kind: "attempted" }, { kind: "checkpoint", status: "expired" }] } });
  });

  it("reports the frozen assertion window when hidden and does not restart a paused Checkpoint with Step next", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const runner = createLocalInjectionScenarioRunner(checkpointRun(100), {
      clock, allocateInjectionId: () => "injection-1", execute: async () => delivered(1),
      checkpoint: { feed, observations: (run) => ({ priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence: null }) }) }
    });
    runner.play(); clock.advance(0);
    await vi.waitFor(() => expect(runner.snapshot().run.nextMemberIndex).toBe(1));
    clock.advance(0); clock.advance(40); runner.setVisible(false);
    expect(runner.snapshot()).toMatchObject({ phase: "paused", visible: false, pauseReason: "HIDDEN", activeOffsetMs: 40, remainingDelayMs: 60, activeCheckpoint: { deadlineActiveOffsetMs: 100 } });
    expect(feed.size()).toBe(1);
    runner.setVisible(true);
    runner.stepNext();
    expect(runner.snapshot()).toMatchObject({ phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60, activeCheckpoint: { deadlineActiveOffsetMs: 100 } });
    expect(feed.size()).toBe(1);
  });

  it("consumes Step next at a Checkpoint without corrupting the next timed Injection", async () => {
    const clock = new FakeClock();
    const feed = new FakeBoundaryFeed();
    const evidence = { intervalId: "interval-1", sequence: 1, eventId: "local-1" };
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(checkpointThenStepRun(), {
      clock, allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`, execute,
      checkpoint: {
        feed,
        observations: (run) => ({
          priorOutcomes: new Map(run.trace.flatMap((entry) => entry.kind === "attempted" ? [[entry.stepId, entry.outcome] as const] : [])),
          correlatedLocalEvidence: new Map([["step-1", evidence]]),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    runner.stepNext();
    await vi.waitFor(() => expect(runner.snapshot()).toMatchObject({ phase: "paused", run: { nextMemberIndex: 1 } }));
    runner.stepNext();
    expect(runner.snapshot()).toMatchObject({ phase: "paused", run: { nextMemberIndex: 2 }, remainingDelayMs: 25 });
    runner.play(); clock.advance(24);
    expect(execute).toHaveBeenCalledTimes(1);
    clock.advance(1);
    await vi.waitFor(() => expect(runner.snapshot().phase).toBe("complete"));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(runner.snapshot().run.trace[2]).toMatchObject({
      kind: "attempted",
      timing: { manualOverride: false, bypassedDelayMs: 0, plannedDispatchActiveOffsetMs: 25, actualDispatchActiveOffsetMs: 25 }
    });
  });
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
    expect(runner.reReview({ targetFingerprint: "fingerprint-2", listenerIds: ["listener-1", "listener-2"], committedEvidenceBoundary: { intervalId: "interval-1", sequence: 7, eventId: "server-7" }, diagnosticObservationBoundary: { intervalId: "diagnostic-interval-1", sequence: 23 } })).toEqual({ ok: true });
    expect(runner.snapshot().run.steps).toBe(originalPlan);
    expect(runner.snapshot().run.authorizations).toHaveLength(2);
    expect(runner.snapshot().run.authorizations[1]).toMatchObject({ kind: "DRIFT_REVIEW", targetFingerprint: "fingerprint-2", authorizedRemainingFromOrdinal: 1, diagnosticObservationBoundary: { intervalId: "diagnostic-interval-1", sequence: 23 } });
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

  it("admits enough control Trace to Step next through 100 Steps and 100 Checkpoints", async () => {
    const clock = new FakeClock();
    const run = highVolumeCheckpointRun();
    const evidence = { intervalId: "interval-1", sequence: 1, eventId: "local-evidence" };
    const execute = vi.fn(async ({ ordinal }: { ordinal: number }) => delivered(ordinal));
    const runner = createLocalInjectionScenarioRunner(run, {
      clock,
      allocateInjectionId: ({ ordinal }) => `injection-${ordinal}`,
      execute,
      checkpoint: {
        feed: new FakeBoundaryFeed(),
        observations: () => ({
          priorOutcomes: new Map(),
          correlatedLocalEvidence: new Map(run.steps.map(({ id }) => [id, evidence] as const)),
          inspectCommand: () => ({ state: "key-absent", certainty: "certain", provenance: "local-effective", evidence })
        })
      }
    });
    expect(run.members).toHaveLength(200);
    expect(runner.snapshot().run.controlReservationBytes).toBeGreaterThanOrEqual(202 * 512);
    for (let memberIndex = 0; memberIndex < run.members.length; memberIndex += 1) {
      runner.stepNext();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(runner.snapshot().run.trace).toHaveLength(memberIndex + 1);
    }
    expect(runner.snapshot().phase).toBe("complete");
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
