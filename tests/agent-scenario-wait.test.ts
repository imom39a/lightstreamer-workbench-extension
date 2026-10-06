import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAgentScenario, type AgentScenarioProgress } from "../src/extension/panel/agent-scenario-wait";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";

afterEach(() => vi.useRealTimers());

function fixture() {
  let current: AgentScenarioProgress = { pageEpoch: "epoch", runId: "run", revision: 0, terminal: false, scenario: { phase: "paused" } };
  const listeners = new Set<() => void>();
  const source = { read: vi.fn(() => current), subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const input = { runId: "run", pageEpoch: "epoch", afterRevision: 0, timeoutMs: 20000 };
  return { source, input, listeners, publish(update: Partial<AgentScenarioProgress>) { current = { ...current, ...update }; for (const listener of [...listeners]) listener(); } };
}

describe("exact Scenario Run progress waits", () => {
  it("subscribes before reading and wakes once on a revision change without polling", async () => {
    const f = fixture();
    const waiting = waitForAgentScenario(f.source, f.input);
    expect(f.listeners.size).toBe(1);
    f.publish({ revision: 1 });
    expect(await waiting).toMatchObject({ status: "CHANGED", runId: "run", pageEpoch: "epoch", revision: 1 });
    expect(f.source.read).toHaveBeenCalledTimes(2);
    expect(f.listeners.size).toBe(0);
  });
  it("returns immediate inspection and terminal snapshots", async () => {
    const f = fixture();
    expect((await waitForAgentScenario(f.source, { ...f.input, afterRevision: undefined })).status).toBe("CHANGED");
    f.publish({ terminal: true });
    expect((await waitForAgentScenario(f.source, f.input)).status).toBe("TERMINAL");
    expect(f.listeners.size).toBe(0);
  });
  it("times out at one current snapshot and detects Run/page changes", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const waiting = waitForAgentScenario(f.source, { ...f.input, timeoutMs: 200 });
    await vi.advanceTimersByTimeAsync(200);
    expect((await waiting).status).toBe("TIMED_OUT");
    const changed = waitForAgentScenario(f.source, f.input);
    f.publish({ runId: "other" });
    expect(await changed).toMatchObject({ status: "UNAVAILABLE", scenario: null, runId: "run" });
    expect(f.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancellation disposes listeners and deadline without dispatch", async () => {
    vi.useFakeTimers();
    const f = fixture(), controller = new AbortController();
    const waiting = waitForAgentScenario(f.source, { ...f.input, signal: controller.signal });
    const rejected = expect(waiting).rejects.toThrow("QUERY_CANCELLED");
    controller.abort(); await rejected;
    expect(f.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it("integrates monotonic progress with trace reads and shared wait capacity", async () => {
    const listeners = new Set<() => void>();
    const state: any = { phase: "review", scenario: { id: "scenario", revision: 1, members: [], steps: [] }, run: { id: "run", status: "paused", nextOrdinal: 1, nextMemberIndex: 0, trace: [], controls: [], drifts: [] }, runner: null };
    const runtime = { status: () => ({ pageEpoch: "epoch", visible: true }), local: () => ({ draft: null }), scenario: () => state,
      subscribeOperations: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } as unknown as AgentRuntime;
    const service = createAgentService(runtime, "panel", () => "read");
    const call = (name: string, args: Record<string, unknown>) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
    expect((await call("get_scenario_trace", {})).progressRevision).toBe(0);
    const pending = call("wait_for_scenario", { runId: "run", pageEpoch: "epoch", afterRevision: 0 });
    state.phase = "complete"; state.run.status = "complete"; state.run.trace.push({ kind: "step", id: "step" });
    for (const listener of [...listeners]) listener();
    expect(await pending).toMatchObject({ status: "TERMINAL", revision: 1, scenario: { phase: "complete" } });
    expect((await call("get_scenario_trace", {})).progressRevision).toBe(1);
    expect(listeners.size).toBe(0);
  });
});
