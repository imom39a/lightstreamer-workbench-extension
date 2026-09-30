import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConnection } from "../src/extension/panel/agent-connection";
import type { WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { connectPortable, type CompanionChannel } from "../src/agent/portable-channel";
import { beginPanelPairing } from "../src/agent/panel-pairing";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AgentAccess, AgentAccessStatus } from "../src/extension/panel/react/agent-access";

vi.mock("../src/agent/panel-pairing", () => ({ beginPanelPairing: vi.fn() }));
vi.mock("../src/agent/portable-channel", () => ({ connectPortable: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });
function fixture(autoChannel?: CompanionChannel) {
  vi.mocked(connectPortable).mockImplementation(() => autoChannel ? Promise.resolve(autoChannel) : new Promise(() => {}));
  const agent = { status: () => ({ pageEpoch: "page-1", visible: true }), local: () => ({ draft: null }), scenario: () => null } as unknown as AgentRuntime;
  const unsubscribe = vi.fn();
  const runtime = { agent, subscribe: () => unsubscribe } as unknown as WorkbenchRuntime;
  const connectNative = vi.fn();
  vi.stubGlobal("chrome", { runtime: { connectNative, getURL: () => `chrome-extension://${"a".repeat(32)}/` }, devtools: { inspectedWindow: { tabId: 7, eval: (_expression: string, callback: (value: string) => void) => callback("https://fixture.test/app") } } });
  const connection = createAgentConnection(runtime, "panel-1");
  return { connection, agent, connectNative, unsubscribe };
}
describe("per-panel agent grants", () => {
  it("preserves actionable compatibility failures in required-auth mode without granting access", async () => {
    const f = fixture();
    vi.mocked(beginPanelPairing).mockReturnValueOnce({ ready: Promise.reject(new Error("COMPANION_INCOMPATIBLE: Stop existing Workbench MCP servers and start the matching companion package.")), approve: vi.fn(), close: vi.fn() });
    try {
      f.connection.connect("read", { auth: "required" });
      await vi.waitFor(() => expect(f.connection.getSnapshot()).toMatchObject({ enabled: false, status: "error", permission: "off", detail: expect.stringContaining("matching companion package") }));
    } finally { f.connection.dispose(); }
  });
  it("explains incompatible companion identity in the existing setup surface without granting access", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const f = fixture();
    const extensionId = "a".repeat(32);
    vi.mocked(connectPortable).mockRejectedValue(new Error(`COMPANION_INCOMPATIBLE: Companion extension ${"b".repeat(32)} differs from required ${extensionId}. Stop Workbench MCP servers; run setup --extension-id ${extensionId} with the matching package.`));
    const mount = document.body.appendChild(document.createElement("div"));
    const root = createRoot(mount);
    try {
      await act(async () => {
        root.render(createElement(AgentAccess, { connection: f.connection }));
        f.connection.connect();
      });
      expect(f.connection.getSnapshot()).toMatchObject({ enabled: true, permission: "off", status: "waiting" });
      expect(mount.querySelector('[role="status"]')?.textContent).toContain(`setup --extension-id ${extensionId}`);
      expect(mount.querySelector("details")!.textContent!.trim().split(/\s+/).length).toBeLessThanOrEqual(70);
    } finally { await act(async () => root.unmount()); mount.remove(); f.connection.dispose(); }
  });

  it("renders Waiting until ready, returns to Waiting on loss, and keeps explicit Off across retries", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const f = fixture();
    const mount = document.body.appendChild(document.createElement("div"));
    const root = createRoot(mount);
    try {
      const onOpen = vi.fn();
      await act(async () => root.render(createElement("div", null,
        createElement(AgentAccessStatus, { connection: f.connection, onOpen }),
        createElement(AgentAccess, { connection: f.connection }))));
      const button = mount.querySelector("button")!;
      const control = mount.querySelector("details button") as HTMLButtonElement;
      expect(button.textContent).toBe("Agent access Waiting");
      expect(button.hasAttribute("aria-pressed")).toBe(false);
      await act(async () => button.click());
      expect(onOpen).toHaveBeenCalledWith(button);
      expect(f.connection.getSnapshot().enabled).toBe(true);
      vi.mocked(connectPortable).mockRejectedValue(new Error("not started"));
      await act(async () => { f.connection.connect(); await vi.advanceTimersByTimeAsync(0); });
      expect(f.connection.getSnapshot().status).toBe("waiting");
      expect(button.textContent).toBe("Agent access Waiting");
      expect(mount.querySelector('[role="status"]')?.textContent).toBe("Waiting for the companion. Workbench retries automatically.");
      expect(mount.querySelector("details ol, details code")).toBeNull();
      expect(mount.querySelector("details a")?.getAttribute("href")).toBe("https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/");
      expect(mount.querySelector("details")!.textContent!.trim().split(/\s+/).length).toBeLessThanOrEqual(70);
      let read!: (message: Record<string, unknown>) => void, closed!: () => void;
      const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: callback => { closed = callback; } };
      vi.mocked(connectPortable).mockResolvedValue(channel);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(button.textContent).toBe("Agent access Waiting"); // Socket alone is not a grant.
      await act(async () => read({ type: "ready" }));
      expect(button.textContent).toBe("Agent access On");
      button.focus();
      await act(async () => closed());
      expect(button.textContent).toBe("Agent access Waiting");
      expect(document.activeElement).toBe(button);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); read({ type: "ready" }); });
      expect(button.textContent).toBe("Agent access On");
      await act(async () => closed());
      await act(async () => control.click());
      expect(button.textContent).toBe("Agent access Off");
      expect(control.textContent).toBe("Turn agent access on");
      const attempts = vi.mocked(connectPortable).mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
      expect(connectPortable).toHaveBeenCalledTimes(attempts);
      expect(button.textContent).toBe("Agent access Off");
      await act(async () => control.click());
      expect(button.textContent).toBe("Agent access Waiting");
      await act(async () => read({ type: "ready" }));
      expect(button.textContent).toBe("Agent access On");
    } finally {
      await act(async () => root.unmount()); mount.remove(); f.connection.dispose();
    }
  });
  it("automatically offers inspection and Local Injection at the default port without a UI action", async () => {
    let read!: (message: Record<string, unknown>) => void;
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: vi.fn() };
    const f = fixture(channel);
    expect(connectPortable).toHaveBeenCalledWith({ auth: "off", port: 24817 }, "panel", { extensionId: "a".repeat(32) });
    expect(f.connection.getSnapshot()).toMatchObject({ enabled: true, permission: "off" });
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ permission: "local", panelSessionId: "panel-1" })));
    read({ type: "ready" });
    expect(f.connection.getSnapshot()).toMatchObject({ enabled: true, permission: "local", status: "connected" });
    f.connection.dispose();
  });
  it("reconnects with bounded backoff but turning off or disposing stops retries", async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(connectPortable).mockRejectedValue(new Error("not started"));
    f.connection.connect("local");
    await vi.advanceTimersByTimeAsync(0);
    expect(f.connection.getSnapshot()).toMatchObject({ enabled: true, status: "waiting", permission: "off" });
    const attempts = vi.mocked(connectPortable).mock.calls.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(connectPortable).toHaveBeenCalledTimes(attempts);
    await vi.advanceTimersByTimeAsync(1);
    expect(connectPortable).toHaveBeenCalledTimes(attempts + 1);
    f.connection.disconnect();
    await vi.advanceTimersByTimeAsync(60000);
    expect(connectPortable).toHaveBeenCalledTimes(attempts + 1);
    expect(f.connection.getSnapshot()).toMatchObject({ enabled: false, status: "off" });
    f.connection.connect(); await vi.advanceTimersByTimeAsync(0);
    f.connection.dispose();
    const finalAttempts = vi.mocked(connectPortable).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(connectPortable).toHaveBeenCalledTimes(finalAttempts);
    f.connection.connect();
    expect(connectPortable).toHaveBeenCalledTimes(finalAttempts);
  });
  it("restores the same session after connection loss without sending old replies on the new channel", async () => {
    vi.useFakeTimers();
    let read!: (message: Record<string, unknown>) => void, closed!: () => void;
    const first: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: callback => { closed = callback; } };
    const f = fixture(first); await vi.advanceTimersByTimeAsync(0); read({ type: "ready" });
    let resolve!: (value: unknown) => void;
    f.agent.diagnostics = () => new Promise(done => { resolve = done as (value: unknown) => void; });
    read({ id: "old", name: "query_diagnostics", args: { panelSessionId: "panel-1" } });
    closed();
    expect(f.connection.getSnapshot()).toMatchObject({ enabled: true, permission: "off", status: "waiting" });
    const second: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: vi.fn() };
    vi.mocked(connectPortable).mockResolvedValue(second);
    await vi.advanceTimersByTimeAsync(1000); read({ type: "ready" });
    expect(f.connection.getSnapshot()).toMatchObject({ permission: "local", status: "connected" });
    resolve({ observations: [] }); await vi.advanceTimersByTimeAsync(0);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ panelSessionId: "panel-1", permission: "local", type: "hello" }));
    f.connection.dispose();
  });
  it("caps retry backoff at fifteen seconds", async () => {
    vi.useFakeTimers();
    const f = fixture(); vi.mocked(connectPortable).mockRejectedValue(new Error("offline"));
    f.connection.connect(); await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
      const attempts = vi.mocked(connectPortable).mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1); expect(connectPortable).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1); expect(connectPortable).toHaveBeenCalledTimes(attempts + 1);
    }
    f.connection.dispose();
  });
  it("defaults to standalone without authentication and keeps access off until the broker is ready", async () => {
    const f = fixture(); let read!: (message: Record<string, unknown>) => void;
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: vi.fn() };
    vi.mocked(connectPortable).mockResolvedValueOnce(channel);
    f.connection.connect("read");
    expect(f.connection.getSnapshot().permission).toBe("off");
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());
    expect(connectPortable).toHaveBeenCalledWith({ auth: "off", port: 24817 }, "panel", { extensionId: "a".repeat(32) });
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
    f.connection.connect("local", { auth: "required" });
    await vi.waitFor(() => expect(f.connection.getSnapshot().status).toBe("pairing"));
    expect(f.connection.getSnapshot().permission).toBe("off");
    f.connection.approvePairing(); expect(approve).toHaveBeenCalledOnce();
    expect(f.connection.getSnapshot()).toMatchObject({ status: "awaiting-agent", permission: "off" });
    complete(channel);
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ role: "panel", permission: "local" })));
    expect(f.connectNative).not.toHaveBeenCalled();
    read({ type: "ready" }); expect(f.connection.getSnapshot()).toMatchObject({ status: "connected", permission: "local" });
    closed(); expect(f.connection.getSnapshot()).toMatchObject({ status: "error", permission: "off" });
    expect(f.connection.getSnapshot().detail).not.toContain("private-test-code");
    f.connection.dispose();
  });
  it.each(["off", "required"] as const)("cannot restore a grant when auth %s connection resolves after the user disconnects", async auth => {
    const f = fixture(); let resolve!: (channel: CompanionChannel) => void;
    const ready = new Promise<CompanionChannel>(done => { resolve = done; });
    if (auth === "required") vi.mocked(beginPanelPairing).mockReturnValueOnce({ ready, approve: vi.fn(), close: vi.fn() });
    else vi.mocked(connectPortable).mockReturnValueOnce(ready);
    f.connection.connect("local", { auth });
    f.connection.disconnect();
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: vi.fn(), onClose: vi.fn() };
    resolve(channel);
    await vi.waitFor(() => expect(channel.close).toHaveBeenCalledOnce());
    expect(channel.send).not.toHaveBeenCalled(); expect(f.connection.getSnapshot().permission).toBe("off");
    f.connection.dispose();
  });
  it("shares exact page identity and drops delayed replies when the loopback connection is revoked", async () => {
    let read!: (message: Record<string, unknown>) => void;
    const channel: CompanionChannel = { send: vi.fn(), close: vi.fn(), onMessage: callback => { read = callback; }, onClose: vi.fn() };
    const f = fixture(channel);
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ panelSessionId: "panel-1", tabId: 7 })));
    read({ type: "ready" });
    read({ id: "status", name: "get_status", args: { panelSessionId: "panel-1" } });
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.objectContaining({ id: "status", result: expect.objectContaining({ inspectedPage: { chromeTabId: 7, urlWithoutQuery: "https://fixture.test/app" } }) })));
    let release!: (value: unknown) => void;
    f.agent.diagnostics = () => new Promise(resolve => { release = resolve as (value: unknown) => void; });
    read({ id: "old-read", name: "query_diagnostics", args: { panelSessionId: "panel-1" } });
    f.connection.disconnect(); release({ observations: [] });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(channel.send).not.toHaveBeenCalledWith(expect.objectContaining({ id: "old-read" }));
    expect(f.connectNative).not.toHaveBeenCalled();
    f.connection.dispose(); expect(f.unsubscribe).toHaveBeenCalledOnce();
  });
});
