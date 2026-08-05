import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history";
import {
  createWorkbenchRuntime,
  type LocalInjectionExecutionResult,
  type WorkbenchRuntimeScheduler
} from "../src/extension/panel/workbench-runtime";

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

function historyWithCommandTarget() {
  const history = createInMemoryEventHistory();
  history.append(commandEvent("journey-1", "client-created"));
  history.append(commandEvent("journey-2", "client-status"));
  history.append(commandEvent("journey-3", "subscription-created"));
  history.append(commandEvent("journey-4", "subscription-started"));
  history.append(commandEvent("journey-5", "listener-added"));
  history.append(commandEvent("source-6", "item-update"));
  return history;
}

function historyWithMergeTarget() {
  const history = createInMemoryEventHistory();
  history.append(commandEvent("merge-1", "client-created"));
  history.append(commandEvent("merge-2", "client-status"));
  const subscription = {
    id: identity.subscriptionId,
    mode: "MERGE",
    items: [identity.itemName],
    fields: ["price", "halted"],
    active: true,
    subscribed: true
  };
  history.append(commandEvent("merge-3", "subscription-created", { subscription }));
  history.append(commandEvent("merge-4", "subscription-started", { subscription }));
  history.append(commandEvent("merge-5", "listener-added", { subscription }));
  history.append(commandEvent("merge-source-6", "item-update", {
    subscription,
    update: {
      isSnapshot: false,
      fields: { price: 101, halted: false },
      changedFields: { price: 101, halted: false }
    }
  }));
  return history;
}

function beginSelected(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  runtime.dispatch({ type: "select-evidence", eventId: "source-6" });
  runtime.dispatch({ type: "open-context" });
  runtime.dispatch({ type: "begin-local-injection-from-selection" });
}

function updateDocument(qty = 2): string {
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

describe("WorkbenchRuntime Local Injection", () => {
  it("publishes semantic entry availability for selected updates and live COMMAND Scope", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    expect(runtime.getSnapshot().localInjection.availability).toEqual({
      selectedUpdate: {
        available: false,
        reason: "Select one captured Item Update to create a Local Injection draft."
      },
      commandScope: {
        available: false,
        reason: "Select a live COMMAND Item or Listener Scope with captured field and listener context."
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
    merge.dispatch({ type: "select-evidence", eventId: "merge-source-6" });
    const mergeItem = merge.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    merge.dispatch({ type: "set-scope", scopeId: mergeItem?.id ?? null });
    expect(merge.getSnapshot().localInjection.availability).toEqual({
      selectedUpdate: { available: true, reason: null },
      commandScope: {
        available: false,
        reason: "Select a live COMMAND Item or Listener Scope with captured field and listener context."
      }
    });
    merge.dispose();
  });

  it("creates one protected draft from exactly the selected compatible Item Update", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
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

  it("creates a valid captured MERGE draft without COMMAND-only diagnostics", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithMergeTarget(), captureStatus: "capturing" });
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

  it("blocks invalid raw JSON, then becomes ready after a corrected edit", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
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

  it("authors a no-source draft only from a live COMMAND Item Scope", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
    const item = runtime.getSnapshot().scope.nodes.find(({ kind }) => kind === "item");
    runtime.dispatch({ type: "set-scope", scopeId: item?.id ?? null });
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
    expect(runtime.getSnapshot().localInjection.draft?.document).toEqual({
      command: null,
      key: null,
      isSnapshot: false,
      fields: { command: null, key: null, qty: null }
    });
    runtime.dispose();

    const mergeRuntime = createWorkbenchRuntime({
      history: historyWithMergeTarget(),
      captureStatus: "capturing"
    });
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

  it("reveals the existing draft on a second entry and replaces it only after confirmed discard", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
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

  it("parks, resumes, minimizes, and discards without losing the safe draft or investigation origin", () => {
    const runtime = createWorkbenchRuntime({ history: historyWithCommandTarget(), captureStatus: "capturing" });
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
    beginSelected(before);
    beforeHistory.append(commandEvent("retire-10", "subscription-ended", {
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
    beginSelected(between);
    between.dispatch({ type: "review-local-injection" });
    betweenHistory.append(commandEvent("retire-11", "subscription-ended", {
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
    beginSelected(runtime);

    history.append(commandEvent("listener-replacement-20", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] }
    }));
    history.append(commandEvent("source-listener-retired-21", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();

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
    beginSelected(runtime);

    history.append(commandEvent("lifecycle-listener-22", "listener-added", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    history.append(commandEvent("source-listener-retired-23", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();

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
        history.append(commandEvent("stale-session-20", "client-status", {
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
        history.append(commandEvent("stale-listener-21", "listener-removed", {
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
    beginSelected(runtime);
    makeStale(runtime, history);
    await flushAsync();
    runtimeScheduler.flush();
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
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(7) });
    runtime.dispatch({ type: "review-local-injection" });
    const reviewedFingerprint = runtime.getSnapshot().localInjection.draft?.preflightFingerprint;
    const reviewedText = runtime.getSnapshot().localInjection.draft?.rawText;

    history.append(commandEvent("listener-change-30", "listener-added", {
      listener: { id: "orders-listener-2", callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();
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
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    const reviewedFingerprint = runtime.getSnapshot().localInjection.draft?.preflightFingerprint;

    history.append(commandEvent("lifecycle-listener-added-36", "listener-added", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({
      phase: "review",
      ready: true,
      preflightFingerprint: reviewedFingerprint,
      diagnostics: []
    });

    history.append(commandEvent("lifecycle-listener-removed-37", "listener-removed", {
      listener: { id: "orders-lifecycle-listener", callbacks: ["onSubscription"] }
    }));
    await flushAsync();
    runtimeScheduler.flush();
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
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });

    history.append(commandEvent("listener-race-35", "listener-added", {
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
    beginSelected(runtime);
    runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(11) });
    const retainedText = runtime.getSnapshot().localInjection.draft?.rawText;
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });

    history.append(commandEvent("pending-listener-retired-40", "listener-removed", {
      listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
      item: { name: identity.itemName, position: 1 }
    }));
    await flushAsync();
    runtimeScheduler.flush();
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

    history.append(commandEvent("outcome-subscription-retired-41", "subscription-ended", {
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
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({ disposition, headline });
    const synthetic = await history.queryEvents({ filters: { synthetic: true } }).toPromise();
    expect(synthetic.total).toBe(0);
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
    beginSelected(runtime);
    runtime.dispatch({ type: "review-local-injection" });
    runtime.dispatch({ type: "execute-local-injection" });
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "failed",
      headline: "DELIVERY FAILED",
      detail: expect.stringContaining("did not confirm any listener delivery")
    });
    const synthetic = await history.queryEvents({ filters: { synthetic: true } }).toPromise();
    expect(synthetic.total).toBe(0);
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
    const synthetic = await history.queryEvents({ filters: { synthetic: true } }).toPromise();
    expect(synthetic.events).toHaveLength(1);
    expect(synthetic.events[0]).toMatchObject({
      id: "synthetic-delivered-1",
      source: "synthetic",
      synthetic: true,
      raw: { sourceListenerId: identity.listenerId },
      update: { command: "UPDATE", key: "order-1", fields: { qty: 9 } }
    });
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

  it("advances Local Effective COMMAND State once when delivered Evidence retention fails", async () => {
    const retainedHistory = historyWithCommandTarget();
    const retentionFailure = new Error("synthetic retention failed");
    const history: EventHistory = {
      ...retainedHistory,
      append(event) {
        if (!event.synthetic) return retainedHistory.append(event);
        return {
          receive(_onValue, onError) {
            onError(retentionFailure);
          },
          toPromise() {
            return Promise.reject(retentionFailure);
          }
        };
      }
    };
    const executor = {
      execute: vi.fn(async () => result("success", {
        requestId: "delivered-without-history",
        attemptedCount: 1,
        deliveredCount: 1,
        failedCount: 0
      }))
    };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });
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
    expect(runtime.getSnapshot().commandProjections.localEffective.rows[0]?.[1]).toContain("qty=17");
    const synthetic = await retainedHistory.queryEvents({ filters: { synthetic: true } }).toPromise();
    expect(synthetic.total).toBe(0);
    runtime.dispose();
  });
});
