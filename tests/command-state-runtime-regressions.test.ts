import { describe, expect, it } from "vitest";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";

function event(id: string, kind: LightstreamerEventEnvelope["kind"], command = "ADD", key = "kept"): LightstreamerEventEnvelope {
  return {
    id, timestamp: 1, direction: "inbound", source: "server", synthetic: false, captureSource: "listener", kind,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "subscription", mode: "COMMAND", items: ["orders"], fields: ["command", "key", "value"], active: true, subscribed: true },
    listener: { id: "listener", callbacks: ["onItemUpdate"] },
    item: { name: "orders", position: 1 },
    ...(id === "setup-item-update" ? { topology: { version: 1 as const, kind: "item-observed" as const, pageEpoch: "rolling-page", captureSequence: 6,
      provenance: { instrumentationSource: "official-public-api" as const }, coverage: { status: "complete" as const, getters: {} } } } : {}),
    ...(kind === "item-update" ? { update: { command, key, isSnapshot: false, fields: { command, key, value: id }, changedFields: { command, key, value: id } } } : {})
  };
}

function controlledScheduler(): WorkbenchRuntimeScheduler & { flush(): void } {
  const frames = new Set<() => void>();
  return {
    requestFrame(callback) { frames.add(callback); return callback; },
    cancelFrame(handle) { frames.delete(handle as () => void); },
    setTimeout() { return 0; }, clearTimeout() {},
    flush() { const pending = [...frames]; frames.clear(); pending.forEach((callback) => callback()); }
  };
}

async function settle(scheduler: ReturnType<typeof controlledScheduler>): Promise<void> {
  await import("../src/extension/panel/evidence-history-operation");
  for (let count = 0; count < 30; count += 1) await Promise.resolve();
  scheduler.flush();
  for (let count = 0; count < 30; count += 1) await Promise.resolve();
}

describe("COMMAND projection through authoritative rolling runtime", () => {
  it("keeps active keys after retention advances and invalidates an UPDATE draft after clear-snapshot", async () => {
    const history = createInMemoryEventHistory({ capacity: { maxRetainedCount: 32 } });
    const scheduler = controlledScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
    for (const kind of ["client-created", "client-status", "subscription-created", "subscription-started", "listener-added", "item-update"] as const) {
      await history.offer(event(`setup-${kind}`, kind)).settled;
    }
    await settle(scheduler);
    for (let number = 0; number < 2_100; number += 1) {
      const first = history.offer(event(`add-${number}`, "item-update", "ADD", `churn-${number}`));
      const second = history.offer(event(`delete-${number}`, "item-update", "DELETE", `churn-${number}`));
      await Promise.all([first.settled, second.settled]);
    }
    await settle(scheduler);
    expect(history.status().retained).toBeLessThanOrEqual(32);
    expect(history.status().retainedRange?.first.sequence).toBeGreaterThan(1);
    const subscription = runtime.getSnapshot().scope.nodes.find(({ kind }) => kind === "subscription");
    const commandRead = (projection: "observed-server" | "local-effective") => runtime.agent!.commandState!({
      scopeId: subscription!.id, pageEpoch: "rolling-page", projection, item: { name: "orders", position: 1 }, key: "unobserved"
    });
    for (const projection of ["observed-server", "local-effective"] as const) {
      expect(commandRead(projection)).toMatchObject({ presence: { state: "inconclusive", basis: "limited-history" } });
    }
    runtime.dispatch({ type: "set-scope", scopeId: subscription?.id ?? null });
    runtime.dispatch({ type: "begin-local-injection-from-scope" });
    const draft = (key: string) => JSON.stringify({ command: "UPDATE", key, isSnapshot: false, fields: { command: "UPDATE", key, value: "reviewed" } });
    runtime.dispatch({ type: "set-local-injection-json", text: draft("kept") });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ ready: true, diagnostics: [] });
    await history.offer(event("clear-orders", "clear-snapshot")).settled;
    await settle(scheduler);
    for (const projection of ["observed-server", "local-effective"] as const) {
      expect(commandRead(projection)).toMatchObject({ presence: { state: "absent", basis: "clear-snapshot", provenance: { eventId: "clear-orders", evidenceRetained: true } }, history: { deletedKeysHasOlder: false, lifecycleHasOlder: true } });
    }
    runtime.dispatch({ type: "set-local-injection-json", text: draft("kept") });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ ready: false, diagnostics: [expect.objectContaining({ code: "unknown-key-update" })] });
    await history.offer(event("fresh-after-clear", "item-update", "ADD", " row")).settled;
    await settle(scheduler);
    runtime.dispatch({ type: "set-local-injection-json", text: draft(" row") });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ ready: true, diagnostics: [] });
    runtime.dispatch({ type: "set-local-injection-json", text: draft("row") });
    expect(runtime.getSnapshot().localInjection.draft).toMatchObject({ ready: false, diagnostics: [expect.objectContaining({ code: "unknown-key-update" })] });
    await runtime.disposeAndWait();
  });
});
