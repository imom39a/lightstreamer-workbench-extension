// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrokerRouter, type BrokerPeer } from "../src/agent/companion/router";
const peer = () => ({ send: vi.fn(), close: vi.fn() } satisfies BrokerPeer);
afterEach(() => vi.useRealTimers());

describe("agent request cancellation routing", () => {
  it("reserves capacity for other agents when one client fills its fair share", () => {
    const router = createBrokerRouter(), panel = peer(), first = peer(), second = peer();
    const p = router.join(panel, { role: "panel", protocolVersion: 1, panelSessionId: "panel", permission: "local" });
    const a = router.join(first, { role: "agent" }), b = router.join(second, { role: "agent" });
    for (let i = 0; i < 17; i++) a.receive({ id: `first-${i}`, name: "search_scope", agentConnectionId: "caller-forged", args: { panelSessionId: "panel", text: "item" } });
    expect(first.send.mock.calls.at(-1)![0]).toMatchObject({ id: "first-16", error: expect.stringMatching(/^REQUEST_CAPACITY:/) });
    expect(panel.send.mock.calls.filter(([message]) => message.name === "search_scope")).toHaveLength(16);
    const firstTokens = panel.send.mock.calls.filter(([message]) => message.name === "search_scope").map(([message]) => message.agentConnectionId);
    expect(new Set(firstTokens).size).toBe(1);
    expect(firstTokens[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(firstTokens[0]).not.toBe("caller-forged");
    b.receive({ id: "second", name: "search_scope", args: { panelSessionId: "panel", text: "item" } });
    expect(panel.send.mock.calls.at(-1)![0].agentConnectionId).not.toBe(firstTokens[0]);
    const secondRoute = panel.send.mock.calls.at(-1)![0].id;
    p.receive({ id: secondRoute, result: { visible: true } });
    expect(second.send).toHaveBeenLastCalledWith({ id: "second", result: { visible: true } });
    a.receive({ type: "cancel", id: "first-0" });
    a.receive({ id: "first-after-cancel", name: "search_scope", args: { panelSessionId: "panel", text: "item" } });
    expect(panel.send.mock.calls.at(-1)![0]).toMatchObject({ name: "search_scope" });
    router.dispose();
  });

  it("reserves the bounded wait budget for more than one agent", () => {
    const router = createBrokerRouter(), panel = peer(), first = peer(), second = peer();
    router.join(panel, { role: "panel", protocolVersion: 1, panelSessionId: "panel", permission: "local" });
    const a = router.join(first, { role: "agent" }), b = router.join(second, { role: "agent" });
    const point = { interval: { id: "interval", ordinal: 1 }, committedEvidenceBoundary: null, retainedRange: null };
    const waits = [
      ["wait_for_evidence", { after: point, pageEpoch: "epoch", timeoutMs: 20000 }],
      ["wait_for_operation", { requestId: "receipt", timeoutMs: 20000 }],
      ["wait_for_scenario", { runId: "run", pageEpoch: "epoch", timeoutMs: 20000 }]
    ] as const;
    waits.forEach(([name, args], i) => a.receive({ id: `wait-${i}`, name, args: { panelSessionId: "panel", ...args } }));
    expect(first.send.mock.calls.at(-1)![0]).toMatchObject({ id: "wait-2", error: expect.stringMatching(/^REQUEST_CAPACITY:/) });
    b.receive({ id: "other-wait", name: "wait_for_scenario", args: { panelSessionId: "panel", runId: "run", pageEpoch: "epoch" } });
    expect(panel.send.mock.calls.at(-1)![0]).toMatchObject({ name: "wait_for_scenario" });
    router.dispose();
  });

  it("admits status, receipt lookup, recovery and pause in bounded reserved headroom after ordinary saturation", () => {
    const router = createBrokerRouter(), panel = peer(), agents = Array.from({ length: 4 }, () => peer());
    router.join(panel, { role: "panel", protocolVersion: 1, panelSessionId: "panel", permission: "local" });
    const routes = agents.map(agent => router.join(agent, { role: "agent" }));
    for (let owner = 0; owner < agents.length; owner++) {
      for (let i = 0; i < 16; i++) routes[owner]!.receive({ id: `ordinary-${owner}-${i}`, name: "search_scope", args: { panelSessionId: "panel", text: "row" } });
    }
    expect(panel.send.mock.calls.filter(([message]) => message.name === "search_scope")).toHaveLength(64);
    const urgent = [
      ["get_status", {}], ["get_operation", { requestId: "known" }], ["recover_agent_document", {}],
      ["control_scenario", { runId: "run", requestId: "pause", action: "pause" }]
    ] as const;
    urgent.forEach(([name, extra], i) => routes[Math.min(i, 2)]!.receive({ id: `urgent-${i}`, name, args: { panelSessionId: "panel", ...extra } }));
    expect(panel.send.mock.calls.slice(-4).map(([message]) => [message.name, message.admissionClass])).toEqual([
      ["get_status", "reserved"], ["get_operation", "reserved"], ["recover_agent_document", "reserved"], ["control_scenario", "reserved"]
    ]);
    router.dispose();
  });

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
