import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { agentToolResultBytes } from "../src/agent/tool-result";
import { AGENT_RESPONSE_CONTRACT } from "../src/agent/protocol";
import { appendInspectedPageStatus } from "../src/extension/panel/agent-connection";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

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

async function fixture() {
  const history = createAuthoritativeHistory({ precommitted: [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update")] });
  const execute = vi.fn();
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, "candidate-budget", () => "local");
  const call = (name: string, args: Record<string, unknown>) => service.call(name, { panelSessionId: "candidate-budget", ...args }) as Promise<any>;
  const status = await call("get_status", {});
  const scopes = await call("list_scope", {});
  const scopeId = scopes.nodes.find((node: { kind: string }) => node.kind === "item")?.id as string;
  expect(scopeId).toBeTruthy();
  const document = JSON.stringify({ command: "UPDATE", key: "row-1", isSnapshot: false, fields: { command: "UPDATE", key: "row-1", qty: 2 } });
  return { runtime, execute, call, pageEpoch: status.pageEpoch as string, scopeId, document };
}

describe("agent candidate response budget", () => {
  it("validates the entire ordered plan and summarizes oversized valid and invalid results without publishing", async () => {
    const { runtime, execute, call, pageEpoch, scopeId, document } = await fixture();
    const steps = Array.from({ length: 35 }, (_, index) => ({ kind: "step", id: `step-${index + 1}`, scopeId, document }));
    const valid = await call("validate_agent_candidate", { pageEpoch, members: steps });
    expect(agentToolResultBytes(valid)).toBeLessThanOrEqual(AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
    expect(valid).toMatchObject({ valid: true, memberCount: 35, stepCount: 35, checkpointCount: 0, invalidStepCount: 0, invalidCheckpointCount: 0 });
    expect(valid.detailsOmitted).toBeTruthy();
    expect(valid.members).toBeUndefined();

    const invalid = await call("validate_agent_candidate", { pageEpoch, members: [...steps, {
      kind: "checkpoint", id: "invalid-checkpoint", name: "Impossible reference",
      assertions: [{ id: "missing", kind: "correlated-local-evidence-exists", stepId: "missing-step" }]
    }] });
    expect(agentToolResultBytes(invalid)).toBeLessThanOrEqual(AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
    expect(invalid).toMatchObject({ valid: false, memberCount: 36, stepCount: 35, checkpointCount: 1, invalidCheckpointCount: 1 });
    expect(invalid.reason).toBeTruthy();
    expect(runtime.agent!.local().draft).toBeNull();
    expect(runtime.agent!.scenario()).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  }, 20_000);

  it("returns full validation details when a larger explicit MCP budget fits", async () => {
    const { call, pageEpoch, scopeId, document } = await fixture();
    const members = Array.from({ length: 10 }, (_, index) => ({ kind: "step", id: `step-${index + 1}`, scopeId, document }));
    const compact = await call("validate_agent_candidate", { pageEpoch, members });
    expect(compact.detailsOmitted).toBeTruthy();
    const full = await call("validate_agent_candidate", { pageEpoch, members, maxBytes: 65_536 });
    expect(agentToolResultBytes(full)).toBeLessThanOrEqual(65_536);
    expect(full.valid).toBe(compact.valid);
    expect(full.members).toHaveLength(10);
    expect(full.steps).toHaveLength(10);
    expect(full.detailsOmitted).toBeUndefined();
  });

  it("rejects oversized essential validation reasons without inventing a verdict", async () => {
    const runtime = { status: () => ({ visible: true }), validateCandidate: async () => ({
      valid: false, reason: "essential-reason".repeat(1_000), pageEpoch: "page-1", target: null,
      members: [], steps: [], checkpoints: [], limitations: []
    }) } as unknown as AgentRuntime;
    const service = createAgentService(runtime, "candidate-budget", () => "read");
    await expect(service.call("validate_agent_candidate", { panelSessionId: "candidate-budget", pageEpoch: "page-1", draft: { scopeId: "item" } }))
      .rejects.toThrow("Whole-plan validation reason");
  });

  it("keeps status addressable by tab when an exact inspected path exceeds the budget", () => {
    const status = { pageEpoch: "page-1", history: { phase: "RUNNING" } };
    const url = `https://fixture.test/${"deep-path".repeat(1200)}`;
    const result = appendInspectedPageStatus(status, { chromeTabId: 7, urlWithoutQuery: url });
    expect(agentToolResultBytes(result)).toBeLessThanOrEqual(AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
    expect(result.inspectedPage).toMatchObject({ chromeTabId: 7, origin: "https://fixture.test", urlWithoutQuery: null, urlOmitted: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("deep-path");
    const short = appendInspectedPageStatus(status, { chromeTabId: 7, urlWithoutQuery: "https://fixture.test/app" });
    expect(short.inspectedPage).toEqual({ chromeTabId: 7, urlWithoutQuery: "https://fixture.test/app" });
    expect(() => appendInspectedPageStatus({ essential: "x".repeat(10_000) }, { chromeTabId: 7, urlWithoutQuery: url }))
      .toThrow("RESULT_BUDGET_EXCEEDED");
  });
});
