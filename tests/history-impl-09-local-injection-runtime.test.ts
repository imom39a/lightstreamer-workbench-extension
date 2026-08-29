import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createMemoryEventHistoryForTests,
  type EvidenceCandidate,
  type EventHistory
} from "../src/core/event-history-authoritative";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import {
  createWorkbenchRuntime,
  type LocalInjectionExecutionResult
} from "../src/extension/panel/workbench-runtime";

const identity = {
  clientId: "orders-client",
  sessionId: "orders-session",
  subscriptionId: "orders-sub",
  itemName: "orders",
  listenerId: "orders-listener"
} as const;

function commandEvent(
  id: string,
  kind: LightstreamerEventEnvelope["kind"]
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
      : {})
  };
}

const commandHistory = [
  commandEvent("journey-1", "client-created"),
  commandEvent("journey-2", "client-status"),
  commandEvent("journey-3", "subscription-created"),
  commandEvent("journey-4", "subscription-started"),
  commandEvent("journey-5", "listener-added"),
  commandEvent("source-6", "item-update")
] as const;

function updateDocument(qty: number): string {
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

function successResult(requestId: string): LocalInjectionExecutionResult {
  return {
    requestId,
    ok: true,
    status: "success",
    timestamp: 100,
    attemptedCount: 1,
    deliveredCount: 1,
    failedCount: 0
  };
}

async function prepareAndExecute(
  runtime: ReturnType<typeof createWorkbenchRuntime>,
  qty: number
): Promise<void> {
  await flushAsync();
  runtime.dispatch({ type: "select-evidence", eventId: "source-6" });
  runtime.dispatch({ type: "open-context" });
  runtime.dispatch({ type: "begin-local-injection-from-selection" });
  runtime.dispatch({ type: "set-local-injection-json", text: updateDocument(qty) });
  runtime.dispatch({ type: "execute-local-injection" });
  await flushAsync();
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function syntheticEvidence(history: EventHistory) {
  const result = await history.read({});
  if (!result.ok) throw new Error(result.problem.message);
  return result.value.evidence.filter(({ candidate }) => candidate.kind !== "topology-checkpoint" && candidate.synthetic);
}

describe("history-impl-09 Local Injection committed Evidence boundary", () => {
  it("publishes delivered Local Injection only after Local Evidence commits", async () => {
    const history = createAuthoritativeHistory({ precommitted: commandHistory });
    const executor = { execute: vi.fn(async () => successResult("committed-1")) };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });

    await prepareAndExecute(runtime, 9);

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY"
    });
    expect((await syntheticEvidence(history)).map(({ eventId }) => eventId)).toEqual([
      "synthetic-committed-1"
    ]);

    runtime.dispose();
  });

  it("keeps DELIVERED independent when synthetic Evidence is NOT_EVIDENCE", async () => {
    const history = createAuthoritativeHistory({
      precommitted: commandHistory,
      decideOffer: (candidate) => (isSyntheticCandidate(candidate) ? "refuse" : "commit")
    });
    const executor = { execute: vi.fn(async () => successResult("not-retained-1")) };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });

    await prepareAndExecute(runtime, 17);

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY",
      detail: expect.stringContaining("could not be retained")
    });
    expect(await syntheticEvidence(history)).toHaveLength(0);

    runtime.dispose();
  });

  it("keeps a delivered Local Injection pending while its Evidence commit is delayed", async () => {
    const commit = deferred<void>();
    const history = await createMemoryEventHistoryForTests({
      panelSessionId: "history-impl-09-local-injection",
      commitBatch: (batch) =>
        batch.some(isSyntheticCandidate) ? commit.promise : Promise.resolve()
    });
    for (const event of commandHistory) {
      await history.offer(event).settled;
    }
    const executor = { execute: vi.fn(async () => successResult("delayed-1")) };
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      localInjectionExecutor: executor
    });

    await prepareAndExecute(runtime, 23);

    expect(runtime.getSnapshot().localInjection.draft?.phase).toBe("pending");
    expect(runtime.getSnapshot().localInjection.draft?.outcome).toBeNull();
    expect(await syntheticEvidence(history)).toHaveLength(0);

    commit.resolve();
    await flushAsync();

    expect(runtime.getSnapshot().localInjection.draft?.outcome).toMatchObject({
      disposition: "delivered",
      headline: "DELIVERED LOCALLY"
    });
    expect((await syntheticEvidence(history)).map(({ eventId }) => eventId)).toEqual([
      "synthetic-delayed-1"
    ]);

    runtime.dispose();
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function isSyntheticCandidate(
  candidate: EvidenceCandidate
): boolean {
  return candidate.kind !== "topology-checkpoint" && candidate.synthetic;
}
