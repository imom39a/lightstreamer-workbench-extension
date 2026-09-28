// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrokerRouter, type BrokerPeer } from "../src/agent/companion/router";
const peer = () => ({ send: vi.fn(), close: vi.fn() } satisfies BrokerPeer);
afterEach(() => vi.useRealTimers());

describe("agent request cancellation routing", () => {
  it("only cancels the originating client's request and leaves other requests available", () => {
    const router = createBrokerRouter(), panel = peer(), first = peer(), second = peer();
    const p = router.join(panel, { role: "panel", protocolVersion: 1, panelSessionId: "panel", permission: "local" });
    const a = router.join(first, { role: "agent" }), b = router.join(second, { role: "agent" });
    a.receive({ id: "shared-id", name: "get_status", args: { panelSessionId: "panel" } });
    const route = panel.send.mock.calls.at(-1)![0].id;
    b.receive({ type: "cancel", id: "shared-id" });
    expect(panel.send.mock.calls.at(-1)![0]).not.toHaveProperty("type", "cancel");
    a.receive({ type: "cancel", id: "shared-id" });
    expect(panel.send).toHaveBeenLastCalledWith({ type: "cancel", id: route });
    expect(first.send.mock.calls.at(-1)![0].error).toMatch("QUERY_CANCELLED");
    b.receive({ id: "read", name: "get_status", args: { panelSessionId: "panel" } });
    const next = panel.send.mock.calls.at(-1)![0].id;
    p.receive({ id: next, result: { visible: true } });
    expect(second.send).toHaveBeenLastCalledWith({ id: "read", result: { visible: true } });
    router.dispose();
  });
  it("releases panel observation on agent disconnect and broker timeout", () => {
    vi.useFakeTimers(); const router = createBrokerRouter(), panel = peer(), agent = peer();
    router.join(panel, { role: "panel", protocolVersion: 1, panelSessionId: "panel", permission: "local" });
    const a = router.join(agent, { role: "agent" });
    a.receive({ id: "timeout", name: "get_status", args: { panelSessionId: "panel" } });
    const timeoutRoute = panel.send.mock.calls.at(-1)![0].id;
    vi.advanceTimersByTime(30000);
    expect(panel.send).toHaveBeenLastCalledWith({ type: "cancel", id: timeoutRoute });
    expect(agent.send.mock.calls.at(-1)![0].error).toMatch("timed out");
    a.receive({ id: "disconnect", name: "get_status", args: { panelSessionId: "panel" } });
    const disconnectRoute = panel.send.mock.calls.at(-1)![0].id;
    a.close(); expect(panel.send).toHaveBeenLastCalledWith({ type: "cancel", id: disconnectRoute });
    router.dispose();
  });
});
