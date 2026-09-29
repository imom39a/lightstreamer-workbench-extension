import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_RESPONSE_CONTRACT } from "../src/agent/protocol";
import { agentToolResultBytes } from "../src/agent/tool-result";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const panelSessionId = "response-pagination-panel";
const budget = AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

function mockService(overrides: Partial<AgentRuntime>) {
  const runtime = {
    status: () => ({ visible: true }), scopes: () => ({ total: 0, offset: 0, nodes: [] }),
    scope: () => ({}), diagnostics: async () => ({ observations: [] }),
    local: () => ({ draft: null }), scenario: () => null,
    ...overrides
  } as unknown as AgentRuntime;
  return createAgentService(runtime, panelSessionId, () => "local");
}

const call = (service: ReturnType<typeof createAgentService>, name: string, args: Record<string, unknown> = {}) =>
  service.call(name, { panelSessionId, ...args }) as Promise<any>;

function event(id: number, kind: LightstreamerEventEnvelope["kind"]): LightstreamerEventEnvelope {
  return {
    id: `event-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client-1", sessionId: "session-1", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub-1", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener-1", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page-1", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { isSnapshot: false, command: "ADD", key: "row-1", fields: { command: "ADD", key: "row-1", qty: 1 }, changedFields: { command: "ADD", key: "row-1", qty: 1 } } } : {})
  };
}

async function realService() {
  const history = createAuthoritativeHistory({ precommitted: [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update")] });
  const execute = vi.fn(async () => ({ requestId: "delivery-1", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, panelSessionId, () => "local");
  const status = await call(service, "get_status");
  const scopes = await call(service, "list_scope");
  const itemScopeId = scopes.nodes.find((node: { kind: string }) => node.kind === "item")?.id as string;
  expect(itemScopeId).toBeTruthy();
  return { service, runtime, execute, pageEpoch: status.pageEpoch as string, itemScopeId };
}

const document = (qty = 2) => JSON.stringify({ command: "UPDATE", key: "row-1", isSnapshot: false, fields: { command: "UPDATE", key: "row-1", qty } });

describe("agent response pagination and receipt recovery", () => {
  it("pages a large Scope list within the MCP budget without skipping nodes", async () => {
    const nodes = Array.from({ length: 80 }, (_, id) => ({ id: `scope-${id}`, kind: "item", label: `Item ${id} ${"x".repeat(120)}`, parentId: "page", detail: "active" }));
    const service = mockService({ scopes: (offset, limit) => ({ total: nodes.length, offset, nodes: nodes.slice(offset, offset + limit) }) });
    const seen: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const page = await call(service, "list_scope", { offset, limit: 80 });
      expect(agentToolResultBytes(page)).toBeLessThanOrEqual(budget);
      expect(page.total).toBe(nodes.length);
      expect(page.offset).toBe(offset);
      expect(page.nodes.length).toBeGreaterThan(0);
      seen.push(...page.nodes.map((node: { id: string }) => node.id));
      expect(page.nextOffset).toBe(seen.length < nodes.length ? seen.length : null);
      offset = page.nextOffset;
      expect(++pages).toBeLessThan(81);
    }
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(nodes.map(node => node.id));
  });

  it("reduces an oversized Diagnostic page and resumes after the last returned observation", async () => {
    const intervalId = "diagnostic-interval";
    const observations = Array.from({ length: 24 }, (_, index) => ({
      observationBoundary: { intervalId, sequence: index + 1 }, id: `observation-${index + 1}`,
      code: "test-condition", observedFact: `observation ${index + 1} ${"x".repeat(450)}`
    }));
    const through = observations.at(-1)!.observationBoundary;
    const service = mockService({ diagnostics: async after => ({
      status: "complete", coverage: "complete", retention: "complete", through,
      observations: observations.filter(observation => observation.observationBoundary.sequence > (after?.sequence ?? 0))
    }) as any });
    const seen: number[] = [];
    let after: { intervalId: string; sequence: number } | undefined;
    let pages = 0;
    for (;;) {
      const page = await call(service, "query_diagnostics", { ...(after ? { after } : {}), limit: 100 });
      expect(agentToolResultBytes(page)).toBeLessThanOrEqual(budget);
      expect(page.through).toEqual(through);
      expect(page.observations.length).toBeGreaterThan(0);
      seen.push(...page.observations.map((observation: { observationBoundary: { sequence: number } }) => observation.observationBoundary.sequence));
      expect(page.truncated).toBe(seen.length < observations.length);
      expect(page.nextAfter).toEqual(page.truncated ? page.observations.at(-1)!.observationBoundary : null);
      if (!page.truncated) break;
      after = page.nextAfter;
      expect(++pages).toBeLessThan(25);
    }
    expect(pages).toBeGreaterThan(0);
    expect(seen).toEqual(observations.map(observation => observation.observationBoundary.sequence));
  });

  it("omits a large implicit Scope document while retaining the target anchor", async () => {
    const anchor = { pageEpoch: "epoch-1", subscriptionId: "subscription-1", itemName: "rows", itemPosition: 1 };
    const service = mockService({ scope: id => ({
      node: { id, kind: "item", label: "rows" }, pageEpoch: "epoch-1",
      localInjection: { anchor, document: { command: "UPDATE", fields: { largeValue: "private-value".repeat(3000) } }, diagnostics: [] }
    }) });
    const scope = await call(service, "get_scope", { scopeId: "item-1" });
    expect(agentToolResultBytes(scope)).toBeLessThanOrEqual(budget);
    expect(scope.node).toMatchObject({ id: "item-1", kind: "item" });
    expect(scope.localInjection.anchor).toEqual(anchor);
    expect(scope.localInjection.documentOmitted).toBeTruthy();
    expect(JSON.stringify(scope)).not.toContain("private-value");
  });

  it("preserves a Scenario token and paged trace for a large reviewed plan", async () => {
    const { service, pageEpoch, itemScopeId } = await realService();
    const members = Array.from({ length: 30 }, (_, index) => ({ kind: "step", id: `step-${index + 1}`, scopeId: itemScopeId, document: document(index + 1) }));
    const prepared = await call(service, "prepare_scenario", { pageEpoch, members });
    expect(agentToolResultBytes(prepared)).toBeLessThanOrEqual(budget);
    expect(prepared.token).toBeTruthy();
    const ids: string[] = [];
    let offset: number | null = 0;
    let pages = 0;
    while (offset !== null) {
      const trace = await call(service, "get_scenario_trace", { offset, limit: 100 });
      expect(agentToolResultBytes(trace)).toBeLessThanOrEqual(budget);
      expect(trace.totalMembers).toBe(members.length);
      expect(trace.run?.id).toBeTruthy();
      ids.push(...trace.members.map((member: { id: string }) => member.id));
      offset = trace.nextOffset;
      expect(++pages).toBeLessThan(31);
    }
    expect(pages).toBeGreaterThan(1);
    expect(ids).toEqual(members.map(member => member.id));
  });

  it("keeps a single large Scenario Step addressable when its preview cannot fit", async () => {
    const { service, pageEpoch, itemScopeId } = await realService();
    const largeDocument = JSON.stringify({ command: "UPDATE", key: "row-1", isSnapshot: false,
      fields: { command: "UPDATE", key: "row-1", qty: "x".repeat(4_500) } });
    const prepared = await call(service, "prepare_scenario", { pageEpoch,
      members: [{ kind: "step", id: "large-step", scopeId: itemScopeId, document: largeDocument }] });
    expect(agentToolResultBytes(prepared)).toBeLessThanOrEqual(budget);
    expect(prepared.token).toBeTruthy();
    const trace = await call(service, "get_scenario_trace", { offset: 0, limit: 1 });
    expect(agentToolResultBytes(trace)).toBeLessThanOrEqual(budget);
    expect(trace.run?.id).toBeTruthy();
    expect(trace.members.map((member: { id: string }) => member.id)).toEqual(["large-step"]);
    expect(trace.nextOffset).toBeNull();
    expect(JSON.stringify(trace)).not.toContain("x".repeat(4_500));
    const expanded = await call(service, "get_scenario_trace", { offset: 0, limit: 1, maxBytes: 32_768 });
    expect(agentToolResultBytes(expanded)).toBeLessThanOrEqual(32_768);
    expect(expanded.members[0].document.fields.qty).toBe("x".repeat(4_500));
  });

  it("keeps rotated Draft tokens and operation receipts recoverable after a large preview", async () => {
    const { service, pageEpoch, itemScopeId, execute } = await realService();
    const largeInvalidDocument = JSON.stringify({ command: "UPDATE", key: "row-1", isSnapshot: false, fields: { command: "UPDATE", key: "row-1", qty: 2, extra: "x".repeat(12_000) } });
    const prepared = await call(service, "prepare_local_injection", { pageEpoch, scopeId: itemScopeId, document: largeInvalidDocument });
    expect(agentToolResultBytes(prepared)).toBeLessThanOrEqual(budget);
    expect(prepared.token).toBeTruthy();
    const corrected = await call(service, "update_agent_document", { token: prepared.token, document: document() });
    expect(agentToolResultBytes(corrected)).toBeLessThanOrEqual(budget);
    expect(corrected.token).toBeTruthy();
    expect(corrected.token).not.toBe(prepared.token);
    const request = { token: corrected.token, requestId: "large-preview-delivery" };
    await call(service, "execute_local_injection", request);
    await vi.waitFor(async () => expect((await call(service, "get_operation", { requestId: request.requestId })).state).toBe("complete"));
    const receipt = await call(service, "get_operation", { requestId: request.requestId });
    expect(agentToolResultBytes(receipt)).toBeLessThanOrEqual(budget);
    expect(receipt.outcome.disposition).toBe("delivered");
    await call(service, "execute_local_injection", request);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not forget an executed Scenario requestId when the receipt ledger fills", async () => {
    const control = vi.fn();
    const state = { phase: "review", scenario: { id: "scenario-1", revision: 1, members: [], steps: [] },
      run: { id: "run-1", target: {}, committedEvidenceSeed: null, status: "review", nextOrdinal: 0, trace: [], controls: [], drifts: [] },
      runner: null, membershipError: null };
    const service = mockService({
      status: () => ({ visible: true }), scenario: () => state as any,
      prepareScenarioPlan: async () => {}, control
    });
    await call(service, "prepare_scenario", { pageEpoch: "epoch-1", members: [{ kind: "step", id: "step-1", scopeId: "item-1" }] });
    for (let index = 0; index < 256; index++) {
      await call(service, "control_scenario", { runId: "run-1", action: "step", requestId: `step-request-${index}` });
    }
    const callsAtOrdinaryCapacity = control.mock.calls.length;
    await expect(call(service, "control_scenario", { runId: "run-1", action: "step", requestId: "extra-step" })).rejects.toThrow(/limit|capacity/i);
    expect(control).toHaveBeenCalledTimes(callsAtOrdinaryCapacity);
    await call(service, "control_scenario", { runId: "run-1", action: "pause", requestId: "emergency-pause" });
    const callsAfterPause = control.mock.calls.length;
    await expect(call(service, "control_scenario", { runId: "run-1", action: "pause", requestId: "second-pause" })).rejects.toThrow(/limit|capacity/i);
    expect(control).toHaveBeenCalledTimes(callsAfterPause);
    await call(service, "control_scenario", { runId: "run-1", action: "stop", requestId: "emergency-stop" });
    const callsBeforeDuplicate = control.mock.calls.length;
    await call(service, "control_scenario", { runId: "run-1", action: "step", requestId: "step-request-0" });
    expect(control).toHaveBeenCalledTimes(callsBeforeDuplicate);
    await expect(call(service, "control_scenario", { runId: "run-1", action: "play", requestId: "step-request-0" })).rejects.toThrow(/different operation/i);
    expect(control).toHaveBeenCalledTimes(callsBeforeDuplicate);
  });
});
