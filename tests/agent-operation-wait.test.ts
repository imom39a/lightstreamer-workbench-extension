import { afterEach, describe, expect, it, vi } from "vitest";
import { agentToolFailure, agentToolResultBytes } from "../src/agent/tool-result";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function fixture() {
  const listeners = new Set<() => void>();
  const draft: any = { id: "draft", rawText: "{}", anchor: { pageEpoch: "epoch", fieldSchema: ["command", "key"] },
    document: { command: "ADD", key: "wait-key", isSnapshot: false, fields: { command: "ADD", key: "wait-key" } },
    source: { kind: "authored", rawText: null }, ready: true, phase: "edit", outcome: null };
  let permission: "read" | "local" | "off" = "local";
  const execute = vi.fn(() => { draft.phase = "pending"; });
  const runtime = {
    status: () => ({ pageEpoch: "epoch", visible: true }),
    local: () => ({ draft }), scenario: () => null,
    prepare: async () => {}, execute,
    subscribeOperations: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeEvidence: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }
  } as unknown as AgentRuntime;
  const service = createAgentService(runtime, "panel", () => permission);
  const call = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => service.call(name, { panelSessionId: "panel", ...args }, { signal }) as Promise<any>;
  const prepared = await call("prepare_local_injection", { scopeId: "item", pageEpoch: "epoch" });
  await call("execute_local_injection", { token: prepared.token, requestId: "request" });
  return { service, call, execute, draft, runtime, listeners,
    grant(next: typeof permission) { permission = next; },
    settle(outcome: unknown = { disposition: "delivered", deliveredCount: 1 }) {
      draft.phase = "delivered"; draft.outcome = outcome;
      for (const listener of [...listeners]) listener();
    } };
}

describe("bounded operation receipt waits", () => {
  it("wakes on receipt completion without polling or repeating delivery", async () => {
    const { call, settle, listeners, execute, runtime } = await fixture();
    const local = vi.spyOn(runtime, "local");
    const waiting = call("wait_for_operation", { requestId: "request", timeoutMs: 20000 });
    expect(listeners.size).toBe(1);
    settle();
    const result = await waiting;
    expect(result).toMatchObject({ status: "COMPLETE", requestId: "request", completionBoundary: "LOCAL_INJECTION_RECEIPT", operation: { state: "complete", outcome: { disposition: "delivered" } } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(local.mock.calls.length).toBeLessThan(8);
    expect(listeners.size).toBe(0);
  });

  it("times out with the retained pending receipt, then permits another explicit wait", async () => {
    vi.useFakeTimers();
    const { call, settle, listeners } = await fixture();
    const pending = call("wait_for_operation", { requestId: "request", timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ status: "TIMED_OUT", operation: { state: "pending", requestId: "request" } });
    expect(listeners.size).toBe(0);
    const another = call("wait_for_operation", { requestId: "request", timeoutMs: 20000 });
    settle();
    expect((await another).status).toBe("COMPLETE");
    expect(listeners.size).toBe(0);
  });

  it("supports inspection grants, immediate checks, and an already-complete receipt", async () => {
    const { call, settle, grant, listeners } = await fixture();
    grant("read");
    expect(await call("wait_for_operation", { requestId: "request", timeoutMs: 0 })).toMatchObject({ status: "TIMED_OUT", operation: { state: "pending" } });
    expect(listeners.size).toBe(0);
    settle();
    expect(await call("wait_for_operation", { requestId: "request" })).toMatchObject({ status: "COMPLETE", operation: { state: "complete" } });
    expect(listeners.size).toBe(0);
  });

  it("cancels promptly and revocation cleans all listeners, timers, and wait capacity", async () => {
    vi.useFakeTimers();
    const { call, service, grant, listeners, settle } = await fixture();
    const controller = new AbortController();
    const waiting = call("wait_for_operation", { requestId: "request", timeoutMs: 20000 }, controller.signal);
    const rejected = expect(waiting).rejects.toThrow("QUERY_CANCELLED");
    controller.abort(); await rejected;
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const revoked = call("wait_for_operation", { requestId: "request", timeoutMs: 20000 });
    const accessRejected = expect(revoked).rejects.toThrow("ACCESS_REVOKED");
    grant("off"); service.revoke(); grant("read");
    await accessRejected;
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    settle();
    expect((await call("wait_for_operation", { requestId: "request" })).status).toBe("COMPLETE");
  });

  it("bounds all panel waits and returns an actionable error for an unknown receipt", async () => {
    const { call, listeners } = await fixture();
    try { await call("wait_for_operation", { requestId: "unknown" }); throw new Error("Expected failure"); }
    catch (error) {
      expect(agentToolFailure(error).structuredContent.error).toMatchObject({ code: "OPERATION_UNKNOWN", automaticRetry: false, message: expect.stringContaining("not proof that delivery did not occur") });
    }
    const controller = new AbortController();
    const waits = Array.from({ length: 4 }, () => call("wait_for_operation", { requestId: "request", timeoutMs: 20000 }, controller.signal).catch(error => error));
    expect(listeners.size).toBe(4);
    await expect(call("wait_for_operation", { requestId: "request" })).rejects.toThrow("REQUEST_CAPACITY");
    await expect(call("wait_for_evidence", { after: { interval: { id: "history", ordinal: 1 }, committedEvidenceBoundary: null, retainedRange: null }, pageEpoch: "epoch" })).rejects.toThrow("REQUEST_CAPACITY");
    controller.abort(); await Promise.all(waits);
    expect(listeners.size).toBe(0);
  });

  it("reports only Scenario control receipt completion while the Run remains in review", async () => {
    const scenario: any = { phase: "review", scenario: { id: "scenario", revision: 1, members: [], steps: [] }, run: { id: "run", status: "review", nextOrdinal: 0, trace: [], controls: [], drifts: [] } };
    const control = vi.fn();
    const runtime = { status: () => ({ visible: true }), local: () => ({ draft: null }), scenario: () => scenario,
      prepareScenarioPlan: async () => {}, control } as unknown as AgentRuntime;
    const service = createAgentService(runtime, "panel", () => "local");
    await service.call("prepare_scenario", { panelSessionId: "panel", pageEpoch: "epoch", members: [{ kind: "step", id: "step", scopeId: "item" }] });
    await service.call("control_scenario", { panelSessionId: "panel", runId: "run", action: "step", requestId: "control" });
    expect(await service.call("wait_for_operation", { panelSessionId: "panel", requestId: "control" })).toEqual({ status: "COMPLETE", requestId: "control", completionBoundary: "SCENARIO_CONTROL_RECEIPT", operation: { requestId: "control", accepted: true } });
    expect(scenario.run.status).toBe("review");
    expect(control).toHaveBeenCalledTimes(1);
  });

  it("compacts oversized outcomes within maxBytes while preserving completion identity and disposition", async () => {
    const { call, settle } = await fixture();
    settle({ disposition: "delivered", executionId: "execution", deliveredCount: 1, details: "x".repeat(100000) });
    const result = await call("wait_for_operation", { requestId: "request", maxBytes: 4096 });
    expect(result).toMatchObject({ status: "COMPLETE", requestId: "request", operation: { state: "complete", outcome: { disposition: "delivered", executionId: "execution" } } });
    expect(agentToolResultBytes(result)).toBeLessThanOrEqual(4096);
    expect(result.operation.detailsOmitted).toBeTruthy();
  });
});
