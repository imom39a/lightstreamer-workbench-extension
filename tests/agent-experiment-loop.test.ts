import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { AgentPermission } from "../src/agent/protocol";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

function serverEvent(sequence: number, kind: LightstreamerEventEnvelope["kind"]): LightstreamerEventEnvelope {
  return {
    id: `loop-event-${sequence}`, timestamp: sequence, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client-1", sessionId: "session-1", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub-1", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener-1", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page-1", captureSequence: sequence, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { isSnapshot: false, command: "ADD", key: "row-1", fields: { command: "ADD", key: "row-1", qty: 1 }, changedFields: { command: "ADD", key: "row-1", qty: 1 } } } : {})
  };
}

async function fixture(executor = vi.fn(async () => ({ requestId: "loop-delivery", ok: true, status: "success" as const, timestamp: 20, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }))) {
  const history = createAuthoritativeHistory({ precommitted: [1, 2, 3, 4, 5, 6].map(sequence => serverEvent(sequence, (["client-created", "client-status", "subscription-created", "subscription-started", "listener-added", "item-update"] as const)[sequence - 1]!)) });
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute: executor } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  let permission: AgentPermission = "local";
  const service = createAgentService(runtime.agent!, "panel-loop", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel-loop", ...args }) as Promise<any>;
  return { runtime, history, executor, service, call, grant(value: AgentPermission) { permission = value; } };
}

async function discoverSource(call: (name: string, args?: Record<string, unknown>) => Promise<any>) {
  const topology = await call("list_scope");
  const item = topology.nodes.find((node: any) => node.kind === "item");
  expect(item).toBeDefined();
  const scope = await call("get_scope", { scopeId: item.id });
  expect(scope.localInjection.document).toBeTruthy();
  const page = await call("query_evidence", { includePayload: true, limit: 100 });
  const example = page.evidence.find((entry: any) => entry.payload?.kind === "item-update" && entry.payload?.update?.key);
  expect(example).toBeDefined();
  const exact = await call("get_evidence", { evidence: example.identity });
  expect(exact.lookup.state).toBe("RETAINED");
  return { item, scope, page, example: { ...example, payload: exact.lookup.evidence.payload } };
}

function candidateDocument(source: any): { document: string; key: string } {
  const update = source.payload.update;
  const key = update.key ?? update.fields?.key;
  const fields = { ...update.fields, command: "UPDATE", key };
  for (const [name, value] of Object.entries(fields)) {
    if (name !== "command" && name !== "key" && typeof value === "number") fields[name] = value + 1;
  }
  return { key, document: JSON.stringify({ command: "UPDATE", key, isSnapshot: false, fields }) };
}

describe("end-to-end agent experiment loop", () => {
  it("discovers retained Evidence, validates a source candidate, injects once, waits for committed Evidence and evaluates a checkpoint", async () => {
    const { call, executor } = await fixture();
    const status = await call("get_status");
    const { example } = await discoverSource(call);
    const { document, key } = candidateDocument(example);
    const members = [
      { kind: "step", id: "update-discovered-row", evidence: example.identity, document },
      { kind: "checkpoint", id: "local-evidence-checkpoint", name: "Local update committed", assertions: [
        { id: "delivery-succeeded", kind: "prior-injection-outcome", stepId: "update-discovered-row", expectedDisposition: "delivered" },
        { id: "evidence-committed", kind: "correlated-local-evidence-exists", stepId: "update-discovered-row" }
      ] }
    ];
    const validation = await call("validate_agent_candidate", { pageEpoch: status.pageEpoch, members });
    expect(validation.valid, JSON.stringify(validation)).toBe(true);
    expect(validation.members.map((member: any) => member.id)).toEqual(["update-discovered-row", "local-evidence-checkpoint"]);
    const prepared = await call("prepare_scenario", { pageEpoch: status.pageEpoch, members });
    expect(prepared.scenario.phase).toBe("review");
    expect(prepared.scenario.members).toMatchObject([{ kind: "step", id: "update-discovered-row" }, { kind: "checkpoint", id: "local-evidence-checkpoint" }]);

    const before = await call("query_evidence", { limit: 1 });
    const observation = call("wait_for_evidence", { pageEpoch: status.pageEpoch, after: before.readPoint, timeoutMs: 2000, filter: { criteria: [
      { facet: "provenance", polarity: "include", type: "enum", value: "LOCAL" },
      { facet: "key", polarity: "include", type: example.facets.key.type, value: key }
    ] } });
    const command = { runId: prepared.scenario.run.id, requestId: "loop-step-1", action: "step" };
    const firstReceipt = await call("control_scenario", command);
    expect(await call("control_scenario", command)).toEqual(firstReceipt);
    const matched = await observation;
    expect(matched.status).toBe("MATCHED");
    expect(matched.evidence.some((entry: any) => entry.facets.provenance.value === "LOCAL" && entry.facets.key.value === key)).toBe(true);
    const committed = await call("query_evidence", { at: matched.readPoint, filter: { criteria: [{ facet: "key", polarity: "include", type: example.facets.key.type, value: key }] }, includePayload: true });
    const localEvidence = committed.evidence.find((entry: any) => entry.payload?.synthetic === true && entry.payload?.update?.key === key);
    expect(localEvidence).toBeDefined();
    expect((await call("get_operation", { requestId: command.requestId })).accepted).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);

    await call("control_scenario", { runId: prepared.scenario.run.id, requestId: "loop-checkpoint", action: "step" });
    await vi.waitFor(async () => expect((await call("get_scenario_trace")).phase).toBe("complete"));
    const trace = await call("get_scenario_trace");
    const checkpoint = trace.run.trace.find((entry: any) => entry.kind === "checkpoint" && entry.checkpointId === "local-evidence-checkpoint");
    expect(checkpoint.assertions.map((assertion: any) => assertion.status)).toEqual(["pass", "pass"]);
  });

  it("keeps unknown delivery, stale page and human document conflicts from becoming a repeat injection", async () => {
    const executor = vi.fn(async () => { throw new Error("connection lost after dispatch"); });
    const { call } = await fixture(executor);
    const status = await call("get_status");
    const { example } = await discoverSource(call);
    const { document } = candidateDocument(example);
    await expect(call("validate_agent_candidate", { pageEpoch: "stale-page", draft: { evidence: example.identity, document } })).rejects.toThrow("Page changed");
    const prepared = await call("prepare_local_injection", { evidence: example.identity, pageEpoch: status.pageEpoch, document });
    const original = { token: prepared.token, requestId: "unknown-once" };
    await call("execute_local_injection", original);
    await vi.waitFor(async () => expect((await call("get_operation", { requestId: original.requestId })).outcome.disposition).toBe("acknowledgement-unknown"));
    await call("execute_local_injection", original);
    expect(executor).toHaveBeenCalledTimes(1);
    await expect(call("execute_local_injection", { token: prepared.token, requestId: "do-not-retry" })).rejects.toThrow("consumed");
  });

  it("invalidates an agent execution token after a human edits the visible Draft", async () => {
    const { call, runtime, executor } = await fixture();
    const status = await call("get_status");
    const { example } = await discoverSource(call);
    const { document } = candidateDocument(example);
    const prepared = await call("prepare_local_injection", { evidence: example.identity, pageEpoch: status.pageEpoch, document });
    runtime.dispatch({ type: "set-local-injection-json", text: JSON.stringify({ command: "UPDATE", key: "human-edited", isSnapshot: false, fields: { command: "UPDATE", key: "human-edited" } }) });
    await expect(call("execute_local_injection", { token: prepared.token, requestId: "after-human-edit" })).rejects.toThrow("changed");
    expect(executor).not.toHaveBeenCalled();
  });
});
