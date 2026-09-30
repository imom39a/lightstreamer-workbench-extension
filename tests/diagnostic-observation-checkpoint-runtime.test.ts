import { afterEach, describe, expect, it, vi } from "vitest";
import { isTopologySyncFrame, type CaptureMessage } from "../src/bridge/messages";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

const PANEL = "panel-00000000-0000-4000-8000-000000000019";
const runtimes: ReturnType<typeof createWorkbenchRuntime>[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait()));
});
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
function fixture() {
  const history = createInMemoryEventHistory({ panelSessionId: PANEL, capacity: { maxRetainedCount: 10_000 } });
  const frames = new Set<() => void>();
  const scheduler = {
    requestFrame(callback: () => void) { frames.add(callback); return callback; },
    cancelFrame(handle: unknown) { frames.delete(handle as () => void); },
    setTimeout() { return 0; }, clearTimeout() {}
  };
  const runtime = createWorkbenchRuntime({ history, scheduler, visible: false, captureStatus: "capturing" });
  runtimes.push(runtime);
  const callbacks: Array<(event: MessageEvent) => void> = [];
  const host = {
    LightstreamerClient: Client, Subscription,
    addEventListener(type: string, callback: (event: MessageEvent) => void) { if (type === "message") callbacks.push(callback); },
    postMessage(message: unknown) {
      if (isTopologySyncFrame(message)) runtime.dispatch({ type: "apply-topology-sync-frame", frame: message });
    }
  };
  installLightstreamerInstrumentation(host as unknown as LightstreamerHost, message => runtime.dispatch({ type: "ingest-capture-message", message: message as CaptureMessage }));
  const client = new host.LightstreamerClient();
  const subscription = new host.Subscription("COMMAND", ["orders", "other"], ["command", "key"]);
  client.subscribe(subscription); subscription.addListener({ onItemUpdate() {}, onClearSnapshot() {} });
  return {
    history, runtime, subscription,
    sync: () => callbacks.forEach(callback => callback({
      source: host, data: { type: "lsew:page-capture-sync-request", panelSessionId: PANEL }
    } as unknown as MessageEvent)),
    async settle() {
      for (let count = 0; count < 40; count++) await Promise.resolve();
      const pending = [...frames]; frames.clear(); pending.forEach(callback => callback());
      await vi.waitFor(() => {
        const progress = (runtime as any).evidencePipeline.progress();
        expect(progress.appliedBoundary?.sequence, JSON.stringify(progress)).toBe(history.status().accepted);
      });
    }
  };
}
describe("checkpoint diagnostic Evidence identity through the committed runtime", () => {
  it("keeps the observer live after a diagnostic-producing native checkpoint and subsequent update", async () => {
    const target = fixture();
    await target.settle();
    expect(target.history.status().accepted).toBe(4);
    target.sync();
    await target.settle();
    const progress = (target.runtime as any).evidencePipeline.progress();
    expect(progress.phase).toBe("LIVE");
    expect(progress.appliedBoundary.sequence).toBe(5);
    const checkpointId = progress.appliedBoundary.eventId;
    expect(new TextEncoder().encode(checkpointId).byteLength).toBeGreaterThan(128);
    expect(new TextEncoder().encode(checkpointId).byteLength).toBeLessThanOrEqual(256);
    const diagnostics = await target.runtime.agent!.diagnostics();
    expect(diagnostics.observations).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "ls.sub.active-not-established", evidenceBoundary: expect.objectContaining({ sequence: 5, eventId: checkpointId })
    })]));
    target.subscription.listeners[0]?.onItemUpdate?.(update("ADD", "next"));
    await target.settle();
    expect(target.history.status().accepted).toBe(6);
    expect((target.runtime as any).evidencePipeline.progress()).toMatchObject({ phase: "LIVE", appliedBoundary: { sequence: 6 } });
  });
});
