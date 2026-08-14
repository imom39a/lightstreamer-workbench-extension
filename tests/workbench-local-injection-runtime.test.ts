import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { ScenarioClock } from "../src/core/local-injection-scenario-runner";
import {
  createWorkbenchRuntime,
  settleScenarioCoordinatorExecution,
  type LocalInjectionExecutionResult,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

type Identity = {
  clientId: string;
  sessionId: string;
  subscriptionId: string;
  itemName: string;
  listenerId: string;
};

const identity: Identity = {
  clientId: "orders-client",
  sessionId: "orders-session",
  subscriptionId: "orders-sub",
  itemName: "orders",
  listenerId: "orders-listener"
};

function commandEvent(
  id: string,
  kind: LightstreamerEventEnvelope["kind"],
  overrides: Partial<LightstreamerEventEnvelope> = {}
): LightstreamerEventEnvelope {
  const itemUpdate = kind === "item-update";
  return {
    id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind,
    client: {
      id: identity.clientId,
      status: "CONNECTED:WS-STREAMING",
      sessionId: identity.sessionId,
      transport: "WS-STREAMING"
    },
    ...(kind !== "client-created" && kind !== "client-status"
      ? {
          subscription: {
            id: identity.subscriptionId,
            mode: "COMMAND",
            items: [identity.itemName],
            fields: ["command", "key", "qty"],
            active: true,
            subscribed: true
          }
        }
      : {}),
    ...(kind === "listener-added" || itemUpdate
      ? { listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] } }
      : {}),
    ...(itemUpdate
      ? {
          item: { name: identity.itemName, position: 1 },
          update: {
            isSnapshot: false,
            command: "ADD",
            key: "order-1",
            fields: { command: "ADD", key: "order-1", qty: 1 },
            changedFields: { command: "ADD", key: "order-1", qty: 1 }
          }
        }
      : {}),
    ...overrides
  };
}

function historyWithCommandTarget(
  sourceOverrides: Partial<LightstreamerEventEnvelope> = {}
) {
  return createAuthoritativeHistory({
    precommitted: [
      commandEvent("journey-1", "client-created"),
      commandEvent("journey-2", "client-status"),
      commandEvent("journey-3", "subscription-created"),
      commandEvent("journey-4", "subscription-started"),
      commandEvent("journey-5", "listener-added"),
      commandEvent("source-6", "item-update", sourceOverrides)
    ]
  });
}

function historyWithMergeTarget() {
  const subscription = {
    id: identity.subscriptionId,
    mode: "MERGE",
    items: [identity.itemName],
    fields: ["price", "halted"],
    active: true,
    subscribed: true
  };
  return createAuthoritativeHistory({
    precommitted: [
      commandEvent("merge-1", "client-created"),
      commandEvent("merge-2", "client-status"),
      commandEvent("merge-3", "subscription-created", { subscription }),
      commandEvent("merge-4", "subscription-started", { subscription }),
      commandEvent("merge-5", "listener-added", { subscription }),
      commandEvent("merge-source-6", "item-update", {
        subscription,
        update: {
          isSnapshot: false,
          fields: { price: 101, halted: false },
          changedFields: { price: 101, halted: false }
        }
      })
    ]
  });
}

function beginSelected(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  runtime.dispatch({ type: "select-evidence", eventId: "source-6" });
  runtime.dispatch({ type: "open-context" });
  runtime.dispatch({ type: "begin-local-injection-from-selection" });
}

function updateDocument(qty: number | null = 2): string {
  return JSON.stringify(
    {
      command: "UPDATE",
      key: "order-1",
      isSnapshot: false,
      fields: { command: "UPDATE", key: "order-1", qty }
    },
    null,
    2
  );
}

function result(
  status: LocalInjectionExecutionResult["status"],
  overrides: Partial<LocalInjectionExecutionResult> = {}
): LocalInjectionExecutionResult {
  return {
    requestId: `request-${status}`,
    ok: status === "success",
    status,
    timestamp: 100,
    ...overrides
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function scheduler(): WorkbenchRuntimeScheduler & { flush(): void } {
  const callbacks: Array<() => void> = [];
  return {
    requestFrame(callback) {
      callbacks.push(callback);
      return callback;
    },
    cancelFrame() {},
    setTimeout() {
      return 0;
    },
    clearTimeout() {},
    flush() {
      callbacks.splice(0).forEach((callback) => callback());
    }
  };
}

class ScenarioTestClock implements ScenarioClock {
  private current = 0;
  private sequence = 0;
  private readonly timers = new Map<number, { due: number; callback: () => void }>();
  now(): number { return this.current; }
  setTimer(callback: () => void, delayMs: number): number {
    const id = ++this.sequence;
    this.timers.set(id, { due: this.current + delayMs, callback });
    return id;
  }
  clearTimer(handle: unknown): void { this.timers.delete(Number(handle)); }
  advance(ms: number): void {
    this.current += ms;
    for (const [id, timer] of [...this.timers].filter(([, value]) => value.due <= this.current).sort((left, right) => left[1].due - right[1].due)) {
      if (this.timers.delete(id)) timer.callback();
    }
  }
}

describe("WorkbenchRuntime Local Injection", () => {
  it("maps a pre-dispatch stale target to not-run without any Injection identity", () => {
    const settlement = settleScenarioCoordinatorExecution({
      kind: "terminal",
      record: {
        outcome: {
          disposition: "blocked", headline: "NOT RUN", status: "stale-target", executionId: "reserved-execution",
          requestId: null, timestamp: 41, detail: "Subscription retired before dispatch."
        },
        evidence: { state: "not-created" },
        correlation: { executionId: "reserved-execution", requestId: null, sourceEventId: "source-6" },
        executionResult: null
      }
    }, 99);
    expect(settlement).toEqual({ kind: "not-run", reason: "TARGET NOT RUN", timestamp: 41, detail: "Subscription retired before dispatch." });
    expect(settlement).not.toHaveProperty("injectionId");
  });
  it("converts a protected Draft, adds one same-target update, and steps the immutable Run one Injection at a time", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [
        commandEvent("journey-1", "client-created"),
        commandEvent("journey-2", "client-status"),
        commandEvent("journey-3", "subscription-created"),
        commandEvent("journey-4", "subscription-started"),
        commandEvent("journey-5", "listener-added"),
        commandEvent("source-6", "item-update"),
        commandEvent("source-7", "item-update", {
          update: {
            isSnapshot: false,
            command: "UPDATE",
            key: "order-1",
            fields: { command: "UPDATE", key: "order-1", qty: 2 },
            changedFields: { command: "UPDATE", qty: 2 }
          }
        })
      ]
    });
    let request = 0;
    const executor = { execute: vi.fn(async () => result("success", {
      requestId: `scenario-request-${++request}`,
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    })) };
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: executor });
    await flushAsync();
    runtime.dispatch({ type: "select-evidence", eventId: "source-6" });
    await flushAsync();
    runtime.dispatch({ type: "begin-local-injection-from-selection" });
    const original = runtime.getSnapshot().localInjection.draft;
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({
      phase: "edit",
      scenario: { revision: 1, steps: [{ draft: { id: original?.id, rawText: original?.rawText, sourceEventId: "source-6" } }] }
    });

    runtime.dispatch({ type: "open-scenario-evidence-picker" });
    runtime.dispatch({ type: "select-evidence", eventId: "source-7" });
    await flushAsync();
    runtime.dispatch({ type: "add-selected-evidence-to-scenario" });
    expect(runtime.getSnapshot().scenario?.scenario.steps.map(({ draft }) => draft.sourceEventId)).toEqual(["source-6", "source-7"]);

    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "review", run: { scenarioRevision: 2, nextOrdinal: 1, steps: [{ ordinal: 1 }, { ordinal: 2 }] } });
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "paused", run: { nextOrdinal: 2, trace: [{
      ordinal: 1,
      kind: "attempted",
      outcome: { status: "success", requestId: "scenario-request-1", attemptedCount: 1, deliveredCount: 1, failedCount: 0, detail: expect.any(String) },
      evidence: { eventId: "synthetic-scenario-request-1" }
    }] } });
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "complete", run: { trace: [{ injectionId: expect.any(String) }, { injectionId: expect.any(String) }] } });
    const attempted = runtime.getSnapshot().scenario?.run?.trace.filter((entry) => entry.kind === "attempted") ?? [];
    expect(attempted[0]?.injectionId).not.toBe(attempted[1]?.injectionId);
    runtime.dispose();
  });

  it("plays on the injected Scenario Clock, pauses while hidden, and requires explicit Resume", async () => {
    const clock = new ScenarioTestClock();
    const executor = { execute: vi.fn(async () => result("success", {
      requestId: "timed-runtime",
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    })) };
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing", localInjectionExecutor: executor, scenarioClock: clock });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    const stepId = runtime.getSnapshot().scenario!.scenario.steps[0]!.id;
    runtime.dispatch({ type: "set-scenario-step-delay", stepId, delayMs: 100 });
    runtime.dispatch({ type: "set-scenario-speed", speed: 2 });
    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "review", run: { speed: 2 }, runner: { phase: "paused", remainingDelayMs: 50 } });

    runtime.dispatch({ type: "play-scenario" });
    clock.advance(20);
    runtime.dispatch({ type: "set-visible", visible: false });
    expect(runtime.getSnapshot().scenario?.runner).toMatchObject({ phase: "paused", pauseReason: "HIDDEN", remainingDelayMs: 30 });
    clock.advance(1_000);
    runtime.dispatch({ type: "set-visible", visible: true });
    clock.advance(1_000);
    expect(executor.execute).not.toHaveBeenCalled();

    runtime.dispatch({ type: "play-scenario" });
    clock.advance(29);
    expect(executor.execute).not.toHaveBeenCalled();
    clock.advance(1);
    await flushAsync();
    await flushAsync();
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "complete", run: { trace: [{ timing: {
      originalDelayMs: 100,
      scaledDelayMs: 50,
      plannedDispatchActiveOffsetMs: 50,
      actualDispatchActiveOffsetMs: 50,
      latenessMs: 0
    } }] } });
    runtime.dispose();
  });

  it("revalidates a Scenario target before allocating Injection or execution identities", async () => {
    const history = historyWithCommandTarget();
    const clock = new ScenarioTestClock();
    const executor = { execute: vi.fn(async () => result("success", { requestId: "authorized-after-rereview" })) };
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: executor, scenarioClock: clock });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    history.offer(commandEvent("scenario-listener-race", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] }
    }));
    runtime.dispatch({ type: "step-next-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "paused", runner: { pauseReason: "DRIFT_REVIEW_REQUIRED" }, run: { trace: [] } });
    expect(executor.execute).not.toHaveBeenCalled();

    const immutableSteps = runtime.getSnapshot().scenario!.run!.steps;
    const rereviewedRunId = runtime.getSnapshot().scenario!.run!.id;
    runtime.dispatch({ type: "re-review-scenario" });
    expect(runtime.getSnapshot().scenario!.run!.id).toBe(rereviewedRunId);
    expect(runtime.getSnapshot().scenario!.run!.steps).toBe(immutableSteps);
    expect(runtime.getSnapshot().scenario!.run!.authorizations).toHaveLength(2);
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    const trace = runtime.getSnapshot().scenario!.run!.trace[0]!;
    expect(trace).toMatchObject({ kind: "attempted" });
    if (trace.kind === "attempted") {
      expect(Number(trace.injectionId.split("-").at(-1))).toBe(Number(rereviewedRunId.split("-").at(-1)) + 1);
    }
    expect(executor.execute).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("terminalizes a retired exact target before allocating an Injection identity", async () => {
    const history = historyWithCommandTarget();
    const executor = { execute: vi.fn(async () => result("success")) };
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: executor });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    history.offer(commandEvent("retire-subscription", "subscription-ended", { subscription: { id: identity.subscriptionId, active: false, subscribed: false } }));
    await flushAsync();
    runtime.dispatch({ type: "step-next-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "stopped", run: { trace: [{ kind: "not-run", evidence: null }] } });
    expect(executor.execute).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("pauses on exact committed Server Evidence and preserves its full reference for re-review", async () => {
    const history = historyWithCommandTarget();
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    history.offer(commandEvent("server-interleave-7", "item-update", { update: { isSnapshot: false, command: "UPDATE", key: "order-1", fields: { command: "UPDATE", key: "order-1", qty: 7 }, changedFields: { qty: 7 } } }));
    await flushAsync();
    runtime.dispatch({ type: "step-next-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "paused", runner: { pauseReason: "DRIFT_REVIEW_REQUIRED" }, run: { drifts: [{ kind: "SERVER_ITEM_UPDATE", evidence: { eventId: "server-interleave-7", sequence: 7 } }] } });
    runtime.dispose();
  });

  it("rejects Clear for an active Run and later marks retained trace Evidence unavailable without erasing it", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing", localInjectionExecutor: { execute: vi.fn(async () => result("success", { attemptedCount: 1, deliveredCount: 1, failedCount: 0 })) } });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    runtime.dispatch({ type: "request-clear-history" });
    expect(runtime.getSnapshot().retention).toMatchObject({ clearState: "error" });
    expect(runtime.getSnapshot().retention.clearError).toContain("unavailable while a Scenario Run is active");
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    expect(runtime.getSnapshot().scenario?.run?.trace[0]).toMatchObject({ kind: "attempted", evidenceAvailability: "RETAINED" });
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushAsync();
    expect(runtime.getSnapshot().scenario?.run?.trace[0]).toMatchObject({ kind: "attempted", evidence: { eventId: expect.any(String) }, evidenceAvailability: "UNAVAILABLE_AFTER_CLEAR" });
    runtime.dispose();
  });

  it("Run again performs a fresh Review and allocates new Run and Injection identities", async () => {
    const clock = new ScenarioTestClock();
    let request = 0;
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing", scenarioClock: clock, localInjectionExecutor: {
      execute: vi.fn(async () => result("success", { requestId: `run-again-${++request}`, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }))
    } });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    const firstRunId = runtime.getSnapshot().scenario!.run!.id;
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    const firstInjectionId = runtime.getSnapshot().scenario!.run!.trace[0]!;
    runtime.dispatch({ type: "run-scenario-again" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "review", priorRuns: [{ id: firstRunId }] });
    const secondRunId = runtime.getSnapshot().scenario!.run!.id;
    expect(secondRunId).not.toBe(firstRunId);
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    const secondInjection = runtime.getSnapshot().scenario!.run!.trace[0]!;
    expect(firstInjectionId).toMatchObject({ kind: "attempted" });
    expect(secondInjection).toMatchObject({ kind: "attempted" });
    if (firstInjectionId.kind === "attempted" && secondInjection.kind === "attempted") {
      expect(secondInjection.injectionId).not.toBe(firstInjectionId.injectionId);
    }
    runtime.dispose();
  });

  it("previews filtered Evidence without mutation, then confirms compatible members in retained order", async () => {
    const history = createAuthoritativeHistory({ precommitted: [
      commandEvent("journey-1", "client-created"),
      commandEvent("journey-2", "client-status"),
      commandEvent("journey-3", "subscription-created"),
      commandEvent("journey-4", "subscription-started"),
      commandEvent("journey-5", "listener-added"),
      commandEvent("source-6", "item-update"),
      commandEvent("source-7", "item-update", { update: { isSnapshot: false, command: "UPDATE", key: "order-1", fields: { command: "UPDATE", key: "order-1", qty: 2 }, changedFields: { qty: 2 } } }),
      commandEvent("source-8", "item-update", { update: { isSnapshot: false, command: "UPDATE", key: "order-1", fields: { command: "UPDATE", key: "order-1", qty: 3 }, changedFields: { qty: 3 } } })
    ] });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "open-scenario-evidence-picker" });
    runtime.dispatch({ type: "preview-visible-evidence-for-scenario" });

    const preview = runtime.getSnapshot().scenario?.membershipPreview;
    expect(runtime.getSnapshot().scenario?.scenario.steps).toHaveLength(1);
    expect(preview?.members.filter(({ available }) => available).map(({ eventId }) => eventId)).toEqual(["source-7", "source-8"]);
    expect(preview?.members.find(({ eventId }) => eventId === "source-6")?.reason).toContain("Already");

    runtime.dispatch({ type: "confirm-scenario-membership-preview" });
    expect(runtime.getSnapshot().scenario?.scenario.steps.map(({ draft }) => draft.sourceEventId)).toEqual(["source-6", "source-7", "source-8"]);
    expect(runtime.getSnapshot().scenario?.scenario.revision).toBe(2);
    runtime.dispose();
  });

  it("refuses an exact bulk preview after Clear invalidates its full Evidence identities", async () => {
    const history = createAuthoritativeHistory({ precommitted: [
      commandEvent("journey-1", "client-created"), commandEvent("journey-2", "client-status"),
      commandEvent("journey-3", "subscription-created"), commandEvent("journey-4", "subscription-started"),
      commandEvent("journey-5", "listener-added"), commandEvent("source-6", "item-update"),
      commandEvent("source-7", "item-update", { update: { isSnapshot: false, command: "UPDATE", key: "order-1", fields: { command: "UPDATE", key: "order-1", qty: 2 }, changedFields: { qty: 2 } } })
    ] });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "open-scenario-evidence-picker" });
    runtime.dispatch({ type: "preview-visible-evidence-for-scenario" });
    const identity = runtime.getSnapshot().scenario?.membershipPreview?.members.find(({ eventId }) => eventId === "source-7");
    expect(identity).toMatchObject({ intervalId: expect.any(String), retainedSequence: 7, available: true });
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushAsync();
    runtime.dispatch({ type: "confirm-scenario-membership-preview" });
    expect(runtime.getSnapshot().scenario?.scenario.steps).toHaveLength(1);
    expect(runtime.getSnapshot().scenario?.membershipError).toContain("no Steps were added");
    runtime.dispose();
  });

  it("keys Draft ownership by stable Step identity through author, reorder, duplicate, remove, and Undo", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    const firstId = runtime.getSnapshot().scenario!.scenario.steps[0]!.id;
    runtime.dispatch({ type: "set-scenario-step-editor-presentation", stepId: firstId, presentation: {
      cursor: 12, selectionFrom: 11, selectionTo: 14, scrollTop: 90, scrollLeft: 3, compareOpen: false,
      serializedState: { undo: ["typed"], folds: [4] }
    } });
    runtime.dispatch({ type: "add-authored-scenario-step" });
    const authored = runtime.getSnapshot().scenario!.scenario.steps[1]!;
    expect(authored.draft.sourceEventId).toBeNull();
    runtime.dispatch({ type: "move-scenario-step", stepId: authored.id, direction: "earlier" });
    expect(runtime.getSnapshot().scenario!.scenario.steps.map(({ id }) => id)).toEqual([authored.id, firstId]);
    runtime.dispatch({ type: "duplicate-scenario-step", stepId: firstId });
    const duplicate = runtime.getSnapshot().scenario!.scenario.steps[2]!;
    expect(duplicate.draft.editor).toMatchObject({ cursor: 12, scrollTop: 90, serializedState: { undo: ["typed"], folds: [4] } });
    runtime.dispatch({ type: "remove-scenario-step", stepId: firstId });
    expect(runtime.getSnapshot().scenario?.canUndoRemoval).toBe(true);
    runtime.dispatch({ type: "undo-scenario-step-removal" });
    expect(runtime.getSnapshot().scenario!.scenario.steps.map(({ id }) => id)).toEqual([authored.id, firstId, duplicate.id]);
    expect(runtime.getSnapshot().scenario!.scenario.steps[1]!.draft.editor.serializedState).toEqual({ undo: ["typed"], folds: [4] });
    runtime.dispose();
  });

  it("creates a new revision for timing and payload changes and rejects oversized edit growth atomically", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    const step = runtime.getSnapshot().scenario!.scenario.steps[0]!;
    runtime.dispatch({ type: "set-scenario-step-delay", stepId: step.id, delayMs: 250 });
    expect(runtime.getSnapshot().scenario?.scenario).toMatchObject({ revision: 2, steps: [{ draft: { relativeDelayMs: 250 } }] });
    const beforeText = runtime.getSnapshot().scenario!.scenario.steps[0]!.draft.rawText;
    runtime.dispatch({ type: "set-scenario-step-json", stepId: step.id, text: "x".repeat(8 * 1024 * 1024) });
    expect(runtime.getSnapshot().scenario!.scenario.steps[0]!.draft.rawText).toBe(beforeText);
    expect(runtime.getSnapshot().scenario?.membershipError).toContain("8 MiB");
    runtime.dispose();
  });

  it("accounts serialized editor state and refuses undo growth before it crosses capacity", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    const before = runtime.getSnapshot().scenario!.scenario;
    const stepId = before.steps[0]!.id;
    runtime.dispatch({ type: "set-scenario-step-editor-presentation", stepId, presentation: {
      cursor: 1, selectionFrom: 1, selectionTo: 1, scrollTop: 0, scrollLeft: 0, compareOpen: false,
      serializedState: { undo: "x".repeat(8 * 1024 * 1024) }
    } });
    const after = runtime.getSnapshot().scenario!.scenario;
    expect(after.accountedBytes).toBe(before.accountedBytes);
    expect(after.steps[0]!.draft.editor.serializedState).toEqual(before.steps[0]!.draft.editor.serializedState);
    expect(runtime.getSnapshot().scenario?.membershipError).toContain("8 MiB");
    runtime.dispose();
  });

  it("retains a prior immutable Run and Trace when Edit starts a new revision", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing", localInjectionExecutor: {
      execute: vi.fn(async () => result("success", { requestId: "archive-run", attemptedCount: 1, deliveredCount: 1, failedCount: 0 }))
    } });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    const completed = runtime.getSnapshot().scenario!.run!;
    expect(completed.trace).toHaveLength(1);
    runtime.dispatch({ type: "edit-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "edit", run: null, retainedRunBytes: expect.any(Number) });
    expect(runtime.getSnapshot().scenario!.priorRuns[0]).toBe(completed);
    expect(runtime.getSnapshot().scenario!.priorRuns[0]!.trace).toEqual(completed.trace);
    runtime.dispose();
  });

  it("terminalizes the exact unattempted remainder before archiving a paused Run", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing", localInjectionExecutor: {
      execute: vi.fn(async () => result("success", { requestId: "partial-archive", attemptedCount: 1, deliveredCount: 1, failedCount: 0 }))
    } });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    runtime.dispatch({ type: "add-authored-scenario-step" });
    runtime.dispatch({ type: "review-scenario" });
    runtime.dispatch({ type: "step-next-scenario" });
    await flushAsync();
    await flushAsync();
    expect(runtime.getSnapshot().scenario?.run).toMatchObject({ status: "paused", trace: [{ kind: "attempted" }] });
    runtime.dispatch({ type: "edit-scenario" });
    expect(runtime.getSnapshot().scenario?.priorRuns[0]).toMatchObject({
      status: "stopped",
      trace: [{ kind: "attempted", stepId: "step-1" }, { kind: "not-run", stepId: "step-2", evidence: null }]
    });
    runtime.dispose();
  });

  it("refuses oversized first-Draft conversion without closing or broadening the standalone Draft", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: "x".repeat(8 * 1024 * 1024) });
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    expect(runtime.getSnapshot().scenario).toBeNull();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ open: true, rawText: expect.stringMatching(/^x+$/) });
    expect(runtime.getSnapshot().localInjection.entryError).toContain("8 MiB");
    runtime.dispose();
  });

  it("does not call a custom executor with an unchanged non-concrete Source field", async () => {
    const history = historyWithCommandTarget({
      update: {
        isSnapshot: false,
        command: "ADD",
        key: "order-1",
        fields: { command: "ADD", key: "order-1", qty: "[redacted]" },
        fieldValueStates: {
          command: "concrete",
          key: "concrete",
          qty: "redacted"
        },
        changedFields: { command: "ADD", key: "order-1", qty: "[redacted]" }
      }
    });
    const executor = { execute: vi.fn(async (_request: unknown) => result("success")) };
    const runtime = createWorkbenchRuntime({ history, localInjectionExecutor: executor });
    await flushAsync();
    beginSelected(runtime);

    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(executor.execute).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "blocked",
      detail: expect.stringContaining("explicit concrete replacement")
    });
    runtime.dispose();
  });

  it("executes an explicit concrete null replacement after a value-equal final edit", async () => {
    const history = historyWithCommandTarget({
      update: {
        isSnapshot: false,
        command: "ADD",
        key: "order-1",
        fields: { command: "ADD", key: "order-1", qty: null },
        fieldValueStates: {
          command: "concrete",
          key: "concrete",
          qty: "ambiguous-null"
        },
        changedFields: { command: "ADD", key: "order-1", qty: null }
      }
    });
    const executor = { execute: vi.fn(async (_request: unknown) => result("success")) };
    const runtime = createWorkbenchRuntime({ history, localInjectionExecutor: executor });
    await flushAsync();
    beginSelected(runtime);

    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(2) });
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(null) });
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0]?.[0]).toMatchObject({
      draft: {
        fields: { qty: null },
        fieldValueStates: { qty: "concrete" }
      }
    });
    runtime.dispose();
  });

  it("publishes semantic entry availability for selected updates and live COMMAND Scope", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.availability).toEqual({
      selectedUpdate: {
        available: false,
        reason: "Select one captured Item Update to create a Local Injection draft."
      },
      commandScope: {
        available: false,
        reason: "Select a live COMMAND Item Scope, Listener Scope, or a Subscription with exactly one current item and a captured listener context."
      }
    });

    runtime.dispatch({ type: "select-evidence", eventId: "source-6" });
    expect(runtime.getSnapshot().localInjection.availability.selectedUpdate).toEqual({
      available: true,
      reason: null
    });
    const item = runtime.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    runtime.dispatch({ type: "set-scope", scopeId: item?.id ?? null });
    expect(runtime.getSnapshot().localInjection.availability.commandScope).toEqual({
      available: true,
      reason: null
    });
    runtime.dispose();

    const merge = createWorkbenchRuntime({ history: historyWithMergeTarget(), captureStatus: "capturing" });
    await flushAsync();
    merge.dispatch({ type: "select-evidence", eventId: "merge-source-6" });
    const mergeItem = merge.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    merge.dispatch({ type: "set-scope", scopeId: mergeItem?.id ?? null });
    expect(merge.getSnapshot().localInjection.availability).toEqual({
      selectedUpdate: { available: true, reason: null },
      commandScope: {
        available: false,
        reason: "Select a live COMMAND Item Scope, Listener Scope, or a Subscription with exactly one current item and a captured listener context."
      }
    });
    merge.dispose();
  });

  it("creates one protected draft from exactly the selected compatible Item Update", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);

    expect(runtime.getSnapshot().localInjection).toMatchObject({
      state: "active",
      draft: {
        phase: "edit",
        ready: true,
        compareStatus: "unchanged",
        source: { kind: "captured-event" },
        anchor: {
          sourceEventId: "source-6",
          clientId: identity.clientId,
          sessionId: identity.sessionId,
          subscriptionId: identity.subscriptionId,
          itemName: identity.itemName,
          listenerId: identity.listenerId,
          executionTarget: "captured-listener",
          fieldSchema: ["command", "key", "qty"]
        },
        restorationOrigin: {
          selectionEventId: "source-6",
          contextId: "context:source-6"
        }
      }
    });
    expect(runtime.getSnapshot().localInjection.draft?.document).toEqual({
      command: "ADD",
      key: "order-1",
      isSnapshot: false,
      fields: { command: "ADD", key: "order-1", qty: 1 }
    });

    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(0) });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      ready: true,
      compareStatus: "changed",
      document: { fields: { qty: 0 } }
    });
    runtime.dispose();
  });

  it("creates a valid captured MERGE draft without COMMAND-only diagnostics", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithMergeTarget(), captureStatus: "capturing" });
    await flushAsync();
    runtime.dispatch({ type: "select-evidence", eventId: "merge-source-6" });
    runtime.dispatch({ type: "begin-local-injection-from-selection" });

    expect(runtime.getSnapshot().localInjection).toMatchObject({
      entryError: null,
      draft: {
        ready: true,
        diagnostics: [],
        anchor: { subscriptionMode: "MERGE", fieldSchema: ["price", "halted"] },
        document: {
          command: null,
          key: null,
          isSnapshot: false,
          fields: { price: 101, halted: false }
        }
      }
    });
    runtime.dispatch({ type: "review-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft?.phase).toBe("review");
    runtime.dispose();
  });

  it("blocks invalid raw JSON, then becomes ready after a corrected edit", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({
      type: "set-local-injection-json",
      text: '{"command":"UPDATE","key":"missing","isSnapshot":false,"fields":{"command":"UPDATE","key":"missing","qty":2}}'
    });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      ready: false,
      diagnostics: [expect.objectContaining({ code: "unknown-key-update" })]
    });
    runtime.dispatch({ type: "review-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft?.phase).toBe("edit");

    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument() });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ ready: true, diagnostics: [] });
    runtime.dispatch({ type: "review-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "review",
      preflightFingerprint: expect.stringMatching(/^li-/)
    });
    runtime.dispose();
  });

  it("authors one no-source Draft from a live single-item COMMAND Subscription or Item Scope", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    const subscription = runtime.getSnapshot().scope.nodes.find(({ kind }) => kind === "subscription");
    runtime.dispatch({ type: "set-scope", scopeId: subscription?.id ?? null });
    expect(runtime.getSnapshot().localInjection.availability.commandScope).toEqual({
      available: true,
      reason: null
    });
    runtime.dispatch({ type: "begin-local-injection-from-scope" });

    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      source: { kind: "authored", rawText: null },
      compareStatus: "no-source",
      ready: false,
      anchor: {
        sourceEventId: null,
        subscriptionId: identity.subscriptionId,
        itemName: identity.itemName,
        listenerId: identity.listenerId
      }
    });
    runtime.dispose();

    const itemRuntime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    const item = itemRuntime.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    itemRuntime.dispatch({ type: "set-scope", scopeId: item?.id ?? null });
    itemRuntime.dispatch({ type: "begin-local-injection-from-scope" });

    expect(itemRuntime.getSnapshot().localInjection.draft).toMatchObject({
      source: { kind: "authored", rawText: null },
      compareStatus: "no-source",
      ready: false,
      anchor: {
        sourceEventId: null,
        subscriptionId: identity.subscriptionId,
        itemName: identity.itemName,
        listenerId: identity.listenerId
      }
    });
    expect(itemRuntime.getSnapshot().localInjection.draft?.document).toEqual({
      command: null,
      key: null,
      isSnapshot: false,
      fields: { command: null, key: null, qty: null }
    });
    itemRuntime.dispose();

    const ambiguousHistory = historyWithCommandTarget();
    ambiguousHistory.offer(commandEvent("source-7", "item-update", {
      subscription: {
        id: identity.subscriptionId,
        mode: "COMMAND",
        items: [identity.itemName, "orders-secondary"],
        fields: ["command", "key", "qty"],
        active: true,
        subscribed: true
      },
      item: { name: "orders-secondary", position: 2 },
      update: {
        isSnapshot: false,
        command: "ADD",
        key: "order-2",
        fields: { command: "ADD", key: "order-2", qty: 2 },
        changedFields: { command: "ADD", key: "order-2", qty: 2 }
      }
    }));
    const ambiguousRuntime = createWorkbenchRuntime({ history: ambiguousHistory, captureStatus: "capturing" });
    await flushAsync();
    const ambiguousSubscription = ambiguousRuntime.getSnapshot().scope.nodes.find(({ kind }) => kind === "subscription");
    ambiguousRuntime.dispatch({ type: "set-scope", scopeId: ambiguousSubscription?.id ?? null });
    expect(ambiguousRuntime.getSnapshot().localInjection.availability.commandScope).toMatchObject({
      available: false,
      reason: expect.stringContaining("exactly one current item")
    });
    ambiguousRuntime.dispatch({ type: "begin-local-injection-from-scope" });
    expect(ambiguousRuntime.getSnapshot().localInjection).toMatchObject({
      state: "idle",
      draft: null,
      entryError: expect.stringContaining("exactly one current item")
    });
    const secondItem = ambiguousRuntime.getSnapshot().scope.nodes.find(
      ({ kind, label }) => kind === "item" && label.includes("orders-secondary")
    );
    ambiguousRuntime.dispatch({ type: "set-scope", scopeId: secondItem?.id ?? null });
    expect(ambiguousRuntime.getSnapshot().localInjection.availability.commandScope).toEqual({
      available: true,
      reason: null
    });
    ambiguousRuntime.dispatch({ type: "begin-local-injection-from-scope" });
    expect(ambiguousRuntime.getSnapshot().localInjection.draft?.anchor).toMatchObject({
      subscriptionId: identity.subscriptionId,
      itemName: "orders-secondary",
      itemPosition: 2
    });
    ambiguousRuntime.dispose();

    const mergeRuntime = createWorkbenchRuntime({
      history: historyWithMergeTarget(),
      captureStatus: "capturing"
    });
    await flushAsync();
    const mergeItem = mergeRuntime.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    mergeRuntime.dispatch({ type: "set-scope", scopeId: mergeItem?.id ?? null });
    mergeRuntime.dispatch({ type: "begin-local-injection-from-scope" });
    expect(mergeRuntime.getSnapshot().localInjection).toMatchObject({
      state: "idle",
      draft: null,
      entryError: expect.stringContaining("COMMAND Item")
    });
    mergeRuntime.dispose();
  });

  it("reveals the existing draft on a second entry and replaces it only after confirmed discard", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    const originalId = runtime.getSnapshot().localInjection.draft?.id;
    const originalAnchor = runtime.getSnapshot().localInjection.draft?.anchor;
    const item = runtime.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    runtime.dispatch({ type: "set-scope", scopeId: item?.id ?? null });
    runtime.dispatch({ type: "begin-local-injection-from-scope" });

    expect(runtime.getSnapshot().localInjection).toMatchObject({
      blockedEntry: { kind: "scope-author" },
      discardConfirmation: false,
      draft: { id: originalId, anchor: originalAnchor, open: true }
    });
    runtime.dispatch({ type: "resume-local-injection" });
    expect(runtime.getSnapshot().localInjection.blockedEntry).toBeNull();
    runtime.dispatch({ type: "begin-local-injection-from-scope" });
    runtime.dispatch({ type: "request-discard-local-injection" });
    runtime.dispatch({ type: "confirm-discard-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      source: { kind: "authored" },
      anchor: { sourceEventId: null }
    });
    expect(runtime.getSnapshot().localInjection.draft?.id).not.toBe(originalId);
    runtime.dispose();
  });

  it("parks, resumes, minimizes, and discards without losing the safe draft or investigation origin", async () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(7) });
    const before = runtime.getSnapshot().localInjection.draft;
    runtime.dispatch({ type: "set-local-injection-minimized", minimized: true });
    runtime.dispatch({ type: "park-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      id: before?.id,
      rawText: before?.rawText,
      open: false,
      parked: true,
      minimized: false,
      restorationOrigin: before?.restorationOrigin
    });
    runtime.dispatch({ type: "resume-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ open: true, parked: false });
    runtime.dispatch({ type: "request-discard-local-injection" });
    runtime.dispatch({ type: "cancel-discard-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft?.id).toBe(before?.id);
    runtime.dispatch({ type: "request-discard-local-injection" });
    runtime.dispatch({ type: "confirm-discard-local-injection" });
    expect(runtime.getSnapshot().localInjection).toMatchObject({ state: "idle", draft: null });
    expect(runtime.getSnapshot().selectionEventId).toBe("source-6");
    runtime.dispose();
  });

  it("refreshes target retirement in edit and invalidates Review without calling the executor", async () => {
    const beforeHistory = historyWithCommandTarget();
    const beforeScheduler = scheduler();
    const beforeExecutor = { execute: vi.fn(async () => result("success")) };
    const before = createWorkbenchRuntime({
      history: beforeHistory,
      scheduler: beforeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: beforeExecutor
    });
    await flushAsync();
    beginSelected(before);
    beforeHistory.offer(commandEvent("retire-10", "subscription-ended", {
      subscription: {
        id: identity.subscriptionId,
        mode: "COMMAND",
        fields: ["command", "key", "qty"],
        active: false,
        subscribed: false
      }
    }));
    await flushAsync();
    beforeScheduler.flush();
    before.dispatch({ type: "review-local-injection" });
    expect(before.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      diagnostics: [expect.objectContaining({ code: "stale-subscription" })]
    });
    expect(beforeExecutor.execute).not.toHaveBeenCalled();
    before.dispose();

    const betweenHistory = historyWithCommandTarget();
    const betweenScheduler = scheduler();
    const betweenExecutor = { execute: vi.fn(async () => result("success")) };
    const between = createWorkbenchRuntime({
      history: betweenHistory,
      scheduler: betweenScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: betweenExecutor
    });
    await flushAsync();
    beginSelected(between);
    between.dispatch({ type: "review-local-injection" });
    betweenHistory.offer(commandEvent("retire-11", "subscription-ended", {
      subscription: {
        id: identity.subscriptionId,
        mode: "COMMAND",
        fields: ["command", "key", "qty"],
        active: false,
        subscribed: false
      }
    }));
    await flushAsync();
    betweenScheduler.flush();
    await flushAsync();
    expect(between.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      preflightFingerprint: null,
      diagnostics: [expect.objectContaining({ code: "stale-subscription" })]
    });
    between.dispatch({ type: "execute-local-injection" });
    expect(between.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      outcome: null
    });
    expect(betweenExecutor.execute).not.toHaveBeenCalled();
    between.dispose();
  });

  it("keeps the captured listener as provenance when another current item listener replaces it", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const executor = {
      execute: vi.fn(async (_request: unknown) => result("success", {
        attemptedCount: 1,
        deliveredCount: 1,
        failedCount: 0
      }))
    };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);

    history.offer(commandEvent("listener-replacement-20", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] }
    }));
    history.offer(commandEvent("source-listener-retired-21", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: true,
      anchor: { listenerId: identity.listenerId },
      diagnostics: []
    });
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute.mock.calls[0]?.[0]).toMatchObject({
      draft: { target: { listenerId: identity.listenerId } }
    });
    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY"
    });
    runtime.dispose();
  });

  it("becomes stale when the source retires and only lifecycle listeners remain", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const executor = { execute: vi.fn(async () => result("success")) };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);

    history.offer(commandEvent("lifecycle-listener-22", "listener-added", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    history.offer(commandEvent("source-listener-retired-23", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      diagnostics: [expect.objectContaining({ code: "stale-listener" })]
    });
    expect(runtime.getSnapshot().localInjection.availability.selectedUpdate).toEqual({
      available: false,
      reason: "The protected Subscription has no current Item Update listeners."
    });
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    expect(executor.execute).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it.each([
    [
      "page delivery",
      (runtime: ReturnType<typeof createWorkbenchRuntime>) =>
        runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" }),
      "stale-page-delivery"
    ],
    [
      "Session",
      (_runtime: ReturnType<typeof createWorkbenchRuntime>, history: ReturnType<typeof historyWithCommandTarget>) =>
        history.offer(commandEvent("stale-session-20", "client-status", {
          client: {
            id: identity.clientId,
            status: "CONNECTED:WS-STREAMING",
            sessionId: "replacement-session",
            transport: "WS-STREAMING"
          },
          subscription: undefined,
          item: undefined,
          listener: undefined,
          update: undefined
        })),
      "stale-session"
    ],
    [
      "listener",
      (_runtime: ReturnType<typeof createWorkbenchRuntime>, history: ReturnType<typeof historyWithCommandTarget>) =>
        history.offer(commandEvent("stale-listener-21", "listener-removed", {
          listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
          item: { name: identity.itemName, position: 1 }
        })),
      "stale-listener"
    ]
  ] as const)("blocks a stale %s target before Review", async (_label, makeStale, code) => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing"
    });
    await flushAsync();
    beginSelected(runtime);
    makeStale(runtime, history);
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.availability.selectedUpdate).toMatchObject({
      available: false,
      reason: expect.any(String)
    });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code })])
    });
    runtime.dispatch({ type: "review-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code })])
    });
    runtime.dispose();
  });

  it("requires a new Review when the current Subscription listener set changes but remains nonempty", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const executor = { execute: vi.fn(async () => result("success")) };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(7) });
    runtime.dispatch({ type: "review-local-injection" });
    const reviewedFingerprint = runtime.getSnapshot().localInjection.draft?.preflightFingerprint;
    const reviewedText = runtime.getSnapshot().localInjection.draft?.rawText;

    history.offer(commandEvent("listener-change-30", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: true,
      preflightFingerprint: null,
      rawText: reviewedText,
      diagnostics: []
    });
    runtime.dispatch({ type: "execute-local-injection" });
    expect(executor.execute).not.toHaveBeenCalled();

    runtime.dispatch({ type: "review-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "review",
      ready: true,
      diagnostics: [],
      preflightFingerprint: expect.stringMatching(/^li-/)
    });
    expect(runtime.getSnapshot().localInjection.draft?.preflightFingerprint).not.toBe(
      reviewedFingerprint
    );
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("does not invalidate Review when only lifecycle listeners are added or removed", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const executor = { execute: vi.fn(async () => result("success")) };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    const reviewedFingerprint = runtime.getSnapshot().localInjection.draft?.preflightFingerprint;

    history.offer(commandEvent("lifecycle-listener-added-36", "listener-added", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "review",
      ready: true,
      preflightFingerprint: reviewedFingerprint,
      diagnostics: []
    });

    history.offer(commandEvent("lifecycle-listener-removed-37", "listener-removed", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "review",
      ready: true,
      preflightFingerprint: reviewedFingerprint,
      diagnostics: []
    });

    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("returns to edit instead of reporting stale when a nonempty listener set changes before passive publication", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    const executor = { execute: vi.fn(async () => result("success")) };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });

    history.offer(commandEvent("listener-race-35", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] }
    }));
    runtime.dispatch({ type: "execute-local-injection" });

    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "edit",
      ready: true,
      preflightFingerprint: null,
      diagnostics: [],
      outcome: null
    });
    expect(executor.execute).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("preserves pending and outcome truth across later passive target retirement", async () => {
    const history = historyWithCommandTarget();
    const runtimeScheduler = scheduler();
    let resolveExecution!: (value: LocalInjectionExecutionResult) => void;
    const pending = new Promise<LocalInjectionExecutionResult>((resolve) => {
      resolveExecution = resolve;
    });
    const executor = { execute: vi.fn(() => pending) };
    const runtime = createWorkbenchRuntime({
      history,
      scheduler: runtimeScheduler,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(11) });
    const retainedText = runtime.getSnapshot().localInjection.draft?.rawText;
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });

    history.offer(commandEvent("pending-listener-retired-40", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "pending",
      rawText: retainedText,
      outcome: null
    });

    resolveExecution(result("success", {
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    }));
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "outcome",
      rawText: retainedText,
      outcome: { disposition: "delivered", headline: "DELIVERED LOCALLY" }
    });

    history.offer(commandEvent("outcome-subscription-retired-41", "subscription-ended", {
      subscription: {
        id: identity.subscriptionId,
        mode: "COMMAND",
        fields: ["command", "key", "qty"],
        active: false,
        subscribed: false
      }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "outcome",
      rawText: retainedText,
      outcome: { disposition: "delivered", headline: "DELIVERED LOCALLY" }
    });
    runtime.dispose();
  });

  it.each([
    [result("stale-target", { error: "Subscription retired" }), "blocked", "NOT RUN"],
    [result("listener-error", { attemptedCount: 2, deliveredCount: 1, failedCount: 1 }), "partial", "PARTIALLY DELIVERED"],
    [result("listener-error", { attemptedCount: 1, deliveredCount: 0, failedCount: 1 }), "failed", "DELIVERY FAILED"],
    [result("wire-error", { error: "wire rejected" }), "failed", "DELIVERY FAILED"],
    [result("bridge-error", { error: "bridge unavailable" }), "failed", "DELIVERY FAILED"],
    [result("acknowledgement-unknown", { error: "result lost" }), "acknowledgement-unknown", "DELIVERY UNKNOWN"]
  ] as const)("maps %s without appending synthetic success", async (executionResult, disposition, headline) => {
    const history = historyWithCommandTarget();
    const executor = { execute: vi.fn(async () => executionResult) };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({ disposition, headline });
    const read = await history.read({});
    expect(read.ok && read.value.evidence.some(({ candidate }) => candidate.kind !== "topology-checkpoint" && candidate.synthetic)).toBe(false);
    runtime.dispose();
  });

  it("does not append Local Evidence for a zero-delivery counted success", async () => {
    const history = historyWithCommandTarget();
    const executor = {
      execute: vi.fn(async () => result("success", {
        attemptedCount: 0,
        deliveredCount: 0,
        failedCount: 0
      }))
    };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "failed",
      headline: "DELIVERY FAILED",
      detail: expect.stringContaining("did not confirm any listener delivery")
    });
    const read = await history.read({});
    expect(read.ok && read.value.evidence.some(({ candidate }) => candidate.kind !== "topology-checkpoint" && candidate.synthetic)).toBe(false);
    runtime.dispose();
  });

  it("does not surface delivery counts for acknowledgement-unknown standalone outcomes", async () => {
    const runtime = createWorkbenchRuntime({
      history: historyWithCommandTarget(),
      captureStatus: "capturing",
      localInjectionExecutor: {
        execute: vi.fn(async () => result("acknowledgement-unknown", {
          attemptedCount: 3,
          deliveredCount: 1,
          failedCount: 2
        }))
      }
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    const outcome = runtime.getSnapshot().localInjection.draft?.outcome;
    expect(outcome).toMatchObject({ disposition: "acknowledgement-unknown", headline: "DELIVERY UNKNOWN" });
    expect(outcome).not.toHaveProperty("attemptedCount");
    expect(outcome).not.toHaveProperty("deliveredCount");
    expect(outcome).not.toHaveProperty("failedCount");
    runtime.dispose();
  });

  it("executes once, appends one marked Local Evidence only on success, and advances only Local Effective COMMAND State", async () => {
    const history = historyWithCommandTarget();
    let resolveExecution!: (value: LocalInjectionExecutionResult) => void;
    const pending = new Promise<LocalInjectionExecutionResult>((resolve) => {
      resolveExecution = resolve;
    });
    const executor = { execute: vi.fn(() => pending) };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(9) });
    runtime.dispatch({ type: "review-local-injection" });
    const reviewedText = runtime.getSnapshot().localInjection.draft?.rawText;
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(99) });
    expect(runtime.getSnapshot().localInjection.draft?.rawText).toBe(reviewedText);
    runtime.dispatch({ type: "execute-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    expect(runtime.getSnapshot().localInjection.draft?.phase).toBe("pending");
    expect(executor.execute).toHaveBeenCalledTimes(1);

    resolveExecution(result("success", {
      requestId: "delivered-1",
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    }));
    await flushAsync();
    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      requestId: "delivered-1"
    });
    const read = await history.read({});
    expect(read.ok && read.value.evidence.some(({ eventId }) => eventId === "synthetic-delivered-1")).toBe(true);
    expect(runtime.getSnapshot().commandProjections.observed.rows[0]?.[1]).toContain("qty=1");
    expect(runtime.getSnapshot().commandProjections.localEffective.rows[0]?.[1]).toContain("qty=9");
    runtime.dispatch({ type: "execute-local-injection" });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(runtime.getSnapshot().localInjection.draft?.outcome)).toBe(true);
    runtime.dispatch({ type: "finish-local-injection" });
    expect(runtime.getSnapshot().localInjection.state).toBe("idle");
    expect(runtime.getSnapshot().selectionEventId).toBe("source-6");
    runtime.dispose();
  });

  it("does not advance Local Effective COMMAND State when delivered Evidence retention fails", async () => {
    const retainedHistory = createAuthoritativeHistory({
      precommitted: [
        commandEvent("journey-1", "client-created"),
        commandEvent("journey-2", "client-status"),
        commandEvent("journey-3", "subscription-created"),
        commandEvent("journey-4", "subscription-started"),
        commandEvent("journey-5", "listener-added"),
        commandEvent("source-6", "item-update"),
        commandEvent("synthetic-prior-7", "item-update", {
          source: "synthetic",
          synthetic: true,
          update: {
            isSnapshot: false,
            command: "UPDATE",
            key: "order-1",
            fields: { command: "UPDATE", key: "order-1", qty: 9 },
            changedFields: { qty: 9 }
          }
        }),
        commandEvent("server-overwrite-8", "item-update", {
          update: {
            isSnapshot: false,
            command: "UPDATE",
            key: "order-1",
            fields: { command: "UPDATE", key: "order-1", qty: 1 },
            changedFields: { qty: 1 }
          }
        })
      ],
      decideOffer(candidate) {
        return candidate.kind !== "topology-checkpoint" && candidate.synthetic ? "refuse" : "commit";
      }
    });
    const executor = {
      execute: vi.fn(async () => result("success", {
        requestId: "delivered-without-history",
        attemptedCount: 1,
        deliveredCount: 1,
        failedCount: 0
      }))
    };
    const runtime = createWorkbenchRuntime({
      history: retainedHistory,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(17) });
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      detail: expect.stringContaining("could not be retained")
    });
    expect(runtime.getSnapshot().commandProjections.observed.rows[0]?.[1]).toContain("qty=1");
    expect(runtime.getSnapshot().commandProjections.localEffective.rows[0]?.[1]).toContain("qty=1");
    expect(runtime.getSnapshot().commandProjections.localEffective.rows[0]?.[1]).not.toContain("qty=17");
    expect(
      runtime.getSnapshot().commandProjections.localEffective.supportingLocalEvidenceId
    ).toBeUndefined();
    const read = await retainedHistory.read({});
    expect(read.ok && read.value.evidence.some(({ eventId }) => eventId === "synthetic-prior-7")).toBe(true);
    runtime.dispose();
  });

  it("does not offer Local Evidence when the runtime is disposed while delivery is pending", async () => {
    let syntheticOffers = 0;
    const history = createAuthoritativeHistory({
      precommitted: [
        commandEvent("journey-1", "client-created"),
        commandEvent("journey-2", "client-status"),
        commandEvent("journey-3", "subscription-created"),
        commandEvent("journey-4", "subscription-started"),
        commandEvent("journey-5", "listener-added"),
        commandEvent("source-6", "item-update")
      ],
      decideOffer(candidate) {
        if (candidate.kind !== "topology-checkpoint" && candidate.synthetic) syntheticOffers += 1;
        return "commit";
      }
    });
    let resolveExecution!: (value: LocalInjectionExecutionResult) => void;
    const pending = new Promise<LocalInjectionExecutionResult>((resolve) => { resolveExecution = resolve; });
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: { execute: vi.fn(() => pending) }
    });
    await flushAsync();
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });

    runtime.dispose();
    resolveExecution(result("success", { attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
    await flushAsync();

    expect(syntheticOffers).toBe(0);
  });
});
