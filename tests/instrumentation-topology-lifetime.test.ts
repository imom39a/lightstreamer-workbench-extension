import { afterEach, describe, expect, it, vi } from "vitest";
import { isTopologySyncFrame, type CaptureMessage } from "../src/bridge/messages";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

const PANEL = "panel-00000000-0000-4000-8000-000000000019";
const runtimes: ReturnType<typeof createWorkbenchRuntime>[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
class Client {
  readonly connectionDetails = { getSessionId: () => "session" };
  subscribe(subscription: unknown) { return subscription; }
  getStatus() { return "CONNECTED:WS-STREAMING"; }
}
class Subscription {
  listeners: Array<{ onItemUpdate?(update: unknown): void; onClearSnapshot?(name: string, pos: number): void }> = [];
  constructor(readonly mode: string, readonly items: string[], readonly fields: string[]) {}
  getMode() { return this.mode; }
  getItems() { return this.items; }
  getFields() { return this.fields; }
  isActive() { return true; }
  isSubscribed() { return true; }
  getRequestedSnapshot() { return "yes"; }
  getListeners() { return this.listeners; }
  addListener(listener: typeof this.listeners[number]) { this.listeners.push(listener); }
}
function update(command: string, key: string, position = 1) {
  return {
    forEachField(iterator: (name: string, position: number, value: string) => void) { iterator("command", 1, command); iterator("key", 2, key); },
    forEachChangedField(iterator: (name: string, position: number, value: string) => void) { this.forEachField(iterator); },
    getItemName: () => position === 1 ? "orders" : "other", getItemPos: () => position, isSnapshot: () => false
  };
}
function fixture(maxRetainedCount = 32) {
  const history = createInMemoryEventHistory({ panelSessionId: PANEL, capacity: { maxRetainedCount } });
  const frames = new Set<() => void>();
  const scheduler = { requestFrame(callback: () => void) { frames.add(callback); return callback; }, cancelFrame(handle: unknown) { frames.delete(handle as () => void); }, setTimeout() { return 0; }, clearTimeout() {} };
  const runtime = createWorkbenchRuntime({ history, scheduler, visible: false, captureStatus: "capturing" });
  runtimes.push(runtime);
  const callbacks: Array<(event: MessageEvent) => void> = [];
  const host = { LightstreamerClient: Client, Subscription, addEventListener(type: string, callback: (event: MessageEvent) => void) { if (type === "message") callbacks.push(callback); }, postMessage(message: unknown) { if (isTopologySyncFrame(message)) runtime.dispatch({ type: "apply-topology-sync-frame", frame: message }); } };
  installLightstreamerInstrumentation(host as unknown as LightstreamerHost, message => runtime.dispatch({ type: "ingest-capture-message", message: message as CaptureMessage }));
  const client = new host.LightstreamerClient();
  const subscription = new host.Subscription("COMMAND", ["orders", "other"], ["command", "key"]);
  client.subscribe(subscription); subscription.addListener({ onItemUpdate() {}, onClearSnapshot() {} });
  return { history, runtime, subscription, sync: () => callbacks.forEach(callback => callback({ source: host, data: { type: "lsew:page-capture-sync-request", panelSessionId: PANEL } } as unknown as MessageEvent)), async settle() { for (let count = 0; count < 40; count++) await Promise.resolve(); const pending = [...frames]; frames.clear(); pending.forEach(callback => callback()); await vi.waitFor(() => expect((runtime as any).committedEvidenceBoundary?.sequence, JSON.stringify({progress: (runtime as any).evidencePipeline.progress(), problem: (runtime as any).investigationProblem})).toBe(history.status().accepted)); } };
}
function generations(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  const state = (runtime as any).topologyProjection.snapshot();
  return [...state.unassignedSubscriptions, ...state.clients.flatMap((client: any) => [...client.waitingSubscriptions, ...client.sessions.flatMap((session: any) => session.subscriptions)])].flatMap((subscription: any) => subscription.commandGenerations);
}

describe("official instrumentation through rolling semantic Topology", () => {
  it("does not retain one panel generation counter per historical key", async () => {
    const maps = new Set<Map<unknown, unknown>>();
    const original = Map.prototype.set;
    vi.spyOn(Map.prototype, "set").mockImplementation(function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (typeof key === "string" && key.startsWith("item:subscription-1:1\u0000") && typeof value === "number") maps.add(this);
      return Reflect.apply(original, this, [key, value]);
    });
    const target = fixture();
    target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", " k "));
    await target.settle();
    const first = generations(target.runtime).find((generation: any) => generation.key === " k ").id;
    for (let count = 0; count < 800; count++) {
      target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", `churn-${count}`));
      target.subscription.listeners[0]?.onItemUpdate?.(update("DELETE", `churn-${count}`));
      if (count % 50 === 49) await target.settle();
    }
    await target.settle();
    expect(target.history.status().retained).toBeLessThanOrEqual(32);
    expect(Math.max(0, ...[...maps].map(map => map.size))).toBeLessThanOrEqual(1);
    target.subscription.listeners[0]?.onItemUpdate?.(update("UPDATE", " k "));
    await target.settle();
    expect(generations(target.runtime).find((generation: any) => generation.key === " k ").id).toBe(first);
    target.subscription.listeners[0]?.onItemUpdate?.(update("DELETE", " k "));
    target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", " k "));
    await target.settle();
    expect(generations(target.runtime).find((generation: any) => generation.key === " k ").id).not.toBe(first);
  }, 20_000);

  it("clears the affected live item generations before any subsequent checkpoint", async () => {
    const target = fixture();
    for (const key of ["k", " k ", " "]) target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", key));
    target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", "kept", 2));
    await target.settle();
    target.subscription.listeners[0]?.onClearSnapshot?.("orders", 1);
    await target.settle();
    expect(generations(target.runtime).map((generation: any) => generation.key)).toEqual(["kept"]);
  });

  it("bounds checkpoint aggregate dispatch deduplication while preserving current counts", async () => {
    const sets = new Set<Set<string>>();
    const original = Set.prototype.add;
    vi.spyOn(Set.prototype, "add").mockImplementation(function (this: Set<string>, value: string) {
      if (typeof value === "string" && /^update-\d+$/.test(value)) sets.add(this);
      return Reflect.apply(original, this, [value]);
    });
    const target = fixture(10_000);
    await target.settle(); target.sync(); await target.settle();
    for (let count = 0; count < 4_200; count++) {
      target.subscription.listeners[0]?.onItemUpdate?.(update("UPDATE", "live"));
      if (count % 100 === 99) await target.settle();
    }
    await target.settle();
    expect(Math.max(0, ...[...sets].map(set => set.size))).toBeLessThanOrEqual(4_096);
    const topology = (target.runtime as any).topologyProjection.snapshot();
    expect(topology.clients[0].sessions[0].subscriptions[0].updateCount).toBe(4_200);
  }, 30_000);
});
