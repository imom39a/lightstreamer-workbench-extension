import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConnection } from "../src/extension/panel/agent-connection";
import type { WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { connectPortable, type CompanionChannel } from "../src/agent/portable-channel";
import { beginPanelPairing } from "../src/agent/panel-pairing";

vi.mock("../src/agent/panel-pairing", () => ({ beginPanelPairing: vi.fn() }));
vi.mock("../src/agent/portable-channel", () => ({ connectPortable: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const receive = new Set<(message: unknown) => void>(), disconnect = new Set<() => void>();
  const port = { onMessage: { addListener: (callback: (message: unknown) => void) => receive.add(callback) }, onDisconnect: { addListener: (callback: () => void) => disconnect.add(callback) }, postMessage: vi.fn(), disconnect: vi.fn(() => disconnect.forEach(callback => callback())) };
  const agent = { status: () => ({ pageEpoch: "page-1", visible: true }), local: () => ({ draft: null }), scenario: () => null } as unknown as AgentRuntime;
  const unsubscribe = vi.fn();
  const runtime = { agent, subscribe: () => unsubscribe } as unknown as WorkbenchRuntime;
  const connectNative = vi.fn(() => port);
  vi.stubGlobal("chrome", { runtime: { connectNative, getURL: () => `chrome-extension://${"a".repeat(32)}/` }, devtools: { inspectedWindow: { tabId: 7, eval: (_expression: string, callback: (value: string) => void) => callback("https://fixture.test/app") } } });
  const connection = createAgentConnection(runtime, "panel-1");
  return { connection, port, agent, connectNative, unsubscribe, receive: (value: unknown) => receive.forEach(callback => callback(value)), closed: () => disconnect.forEach(callback => callback()) };
}
describe("per-panel agent grants", () => {
  it("defaults to standalone without authentication and keeps access off until the broker is ready", async () => {
    const f = fixture(); let read!: (message: Record<string, unknown>) => void;
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: vi.fn() };
    vi.mocked(connectPortable).mockResolvedValueOnce(channel);
    f.connection.connect("read");
    expect(f.connection.getSnapshot().permission).toBe("off");
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());
    expect(connectPortable).toHaveBeenCalledWith({ auth: "off", port: 24817 }, "panel");
    expect(f.connectNative).not.toHaveBeenCalled();
    read({ type: "ready" });
    expect(f.connection.getSnapshot()).toMatchObject({ status: "connected", permission: "read", auth: "off" });
    f.connection.disconnect(); expect(channel.close).toHaveBeenCalledOnce();
    read({ type: "ready" }); expect(f.connection.getSnapshot().permission).toBe("off");
    f.connection.dispose();
  });
  it("uses the portable channel without contacting a native host and revokes on connection loss", async () => {
    const f = fixture(); let read!: (message: Record<string, unknown>) => void; let closed!: () => void;
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: callback => { closed = callback; } };
    let complete!: (value: CompanionChannel) => void;
    const approve = vi.fn();
    vi.mocked(beginPanelPairing).mockImplementationOnce((_port, _origin, showCode) => {
      queueMicrotask(() => showCode({ requestId: "pending", code: "1234 5678", expiresAt: Date.now() + 120000 }));
      return { ready: new Promise(resolve => { complete = resolve; }), approve, close: vi.fn() };
    });
    f.connection.connect("local", { transport: "portable", auth: "required" });
    await vi.waitFor(() => expect(f.connection.getSnapshot().status).toBe("pairing"));
    expect(f.connection.getSnapshot().permission).toBe("off");
    f.connection.approvePairing(); expect(approve).toHaveBeenCalledOnce();
    expect(f.connection.getSnapshot()).toMatchObject({ status: "awaiting-agent", permission: "off" });
    complete(channel);
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ role: "panel", permission: "local" })));
    expect(f.connectNative).not.toHaveBeenCalled();
    read({ type: "ready" }); expect(f.connection.getSnapshot()).toMatchObject({ status: "connected", transport: "portable", permission: "local" });
    closed(); expect(f.connection.getSnapshot()).toMatchObject({ status: "error", permission: "off" });
    expect(f.connection.getSnapshot().detail).not.toContain("private-test-code");
    f.connection.dispose();
  });
  it.each(["off", "required"] as const)("cannot restore a grant when auth %s connection resolves after the user disconnects", async auth => {
    const f = fixture(); let resolve!: (channel: CompanionChannel) => void;
    const ready = new Promise<CompanionChannel>(done => { resolve = done; });
    if (auth === "required") vi.mocked(beginPanelPairing).mockReturnValueOnce({ ready, approve: vi.fn(), close: vi.fn() });
    else vi.mocked(connectPortable).mockReturnValueOnce(ready);
    f.connection.connect("local", { transport: "portable", auth });
    f.connection.disconnect();
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
    resolve(channel);
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledOnce());
    expect(channel.send).not.toHaveBeenCalled(); expect(f.connection.getSnapshot().permission).toBe("off");
    f.connection.dispose();
  });
  it("starts off, shares exact page identity only after connect, and closes with the panel", async () => {
    const f = fixture();
    expect(f.connectNative).not.toHaveBeenCalled();
    f.connection.connect("read", { transport: "native" });
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
    f.connection.connect("read", { transport: "native" }); f.receive({ type: "ready" });
    f.receive({ id: "old-read", name: "query_diagnostics", args: { panelSessionId: "panel-1" } });
    f.connection.disconnect();
    release({ observations: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.port.postMessage.mock.calls.some(([message]) => message.id === "old-read")).toBe(false);
    f.connection.dispose();
  });
});
