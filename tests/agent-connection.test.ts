import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConnection } from "../src/extension/panel/agent-connection";
import type { WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const receive = new Set<(message: unknown) => void>(), disconnect = new Set<() => void>();
  const port = { onMessage: { addListener: (callback: (message: unknown) => void) => receive.add(callback) }, onDisconnect: { addListener: (callback: () => void) => disconnect.add(callback) }, postMessage: vi.fn(), disconnect: vi.fn(() => disconnect.forEach(callback => callback())) };
  const agent = { status: () => ({ pageEpoch: "page-1", visible: true }), local: () => ({ draft: null }), scenario: () => null } as unknown as AgentRuntime;
  const unsubscribe = vi.fn();
  const runtime = { agent, subscribe: () => unsubscribe } as unknown as WorkbenchRuntime;
  const connectNative = vi.fn(() => port);
  vi.stubGlobal("chrome", { runtime: { connectNative }, devtools: { inspectedWindow: { tabId: 7, eval: (_expression: string, callback: (value: string) => void) => callback("https://fixture.test/app") } } });
  const connection = createAgentConnection(runtime, "panel-1");
  return { connection, port, agent, connectNative, unsubscribe, receive: (value: unknown) => receive.forEach(callback => callback(value)), closed: () => disconnect.forEach(callback => callback()) };
}
describe("per-panel agent grants", () => {
  it("starts off, shares exact page identity only after connect, and closes with the panel", async () => {
    const f = fixture();
    expect(f.connectNative).not.toHaveBeenCalled();
    f.connection.connect("read");
    expect(f.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ panelSessionId: "panel-1", permission: "read", tabId: 7 }));
    f.receive({ type: "ready" });
    f.receive({ id: "status", name: "get_status", args: { panelSessionId: "panel-1" } });
    await vi.waitFor(() => expect(f.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "status", result: expect.objectContaining({ inspectedPage: { chromeTabId: 7, urlWithoutQuery: "https://fixture.test/app" } }) })));
    f.connection.dispose(); expect(f.connection.getSnapshot().permission).toBe("off");
    expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
  it("drops delayed replies when the native connection is revoked", async () => {
    const f = fixture(); let release!: (value: unknown) => void;
    f.agent.diagnostics = () => new Promise(resolve => { release = resolve as (value: unknown) => void; });
    f.connection.connect("read"); f.receive({ type: "ready" });
    f.receive({ id: "old-read", name: "query_diagnostics", args: { panelSessionId: "panel-1" } });
    f.connection.disconnect();
    release({ observations: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.port.postMessage.mock.calls.some(([message]) => message.id === "old-read")).toBe(false);
    f.connection.dispose();
  });
});
