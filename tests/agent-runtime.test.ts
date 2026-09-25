import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { AgentPermission } from "../src/agent/protocol";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
const document = (command = "UPDATE", qty = 2) => JSON.stringify({ command, key: "row-1", isSnapshot: false, fields: { command, key: "row-1", qty } });
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
  const execute = vi.fn(async () => ({ requestId: "delivery-1", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  let permission: AgentPermission = "local";
  const service = createAgentService(runtime.agent!, "panel-1", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel-1", ...args }) as Promise<any>;
  const query = await call("query_evidence", { includePayload: true });
  const evidence = query.evidence.find((row: any) => row.identity.eventId === "event-6").identity;
  const pageEpoch = (await call("get_status")).pageEpoch;
  return { history, runtime, execute, call, evidence, pageEpoch, service, grant(value: AgentPermission) { permission = value; } };
}
describe("Workbench agent domain API", () => {
  it("queries the retained history without moving the user's investigation and preserves a stable cursor", async () => {
    const { runtime, call } = await fixture();
    const before = runtime.getSnapshot();
    const first = await call("query_evidence", { limit: 2 });
    expect(first.evidence).toHaveLength(2);
    const second = await call("query_evidence", { cursor: first.nextCursor });
    expect(second.readPoint).toEqual(first.readPoint);
    expect(second.evidence[0].identity.sequence).toBeGreaterThan(first.evidence[1].identity.sequence);
    expect(runtime.getSnapshot().scopeId).toBe(before.scopeId);
    expect(runtime.getSnapshot().selectionEventId).toBe(before.selectionEventId);
  });
  it("prepares, corrects, executes once and commits Local Evidence through the shared coordinator", async () => {
    const { call, execute, evidence, pageEpoch, runtime } = await fixture();
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch, document: "{" });
    expect(prepared.local.draft.ready).toBe(false);
    const corrected = await call("update_agent_document", { token: prepared.token, document: document() });
    expect(corrected.local.draft.ready).toBe(true);
    const request = { token: corrected.token, requestId: "experiment-1" };
    await call("execute_local_injection", request);
    await call("execute_local_injection", request);
    await vi.waitFor(async () => expect((await call("get_operation", { requestId: "experiment-1" })).state).toBe("complete"));
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await call("get_operation", { requestId: "experiment-1" })).outcome.disposition).toBe("delivered");
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.events.some(row => row.source === "LOCAL")).toBe(true));
    await call("finish_agent_document", { token: corrected.token });
    expect(runtime.agent!.local().draft).toBeNull();
  });
  it("rejects wrong sessions, read-only mutations, stale epochs and edits from the human", async () => {
    const { call, service, grant, execute, runtime, evidence, pageEpoch } = await fixture();
    await expect(service.call("get_status", { panelSessionId: "other" })).rejects.toThrow("not granted");
    grant("read");
    await expect(call("prepare_local_injection", { evidence, pageEpoch })).rejects.toThrow("inspection only");
    grant("local");
    await expect(call("prepare_local_injection", { evidence, pageEpoch: "old" })).rejects.toThrow("Page changed");
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch, document: document() });
    runtime.dispatch({ type: "set-local-injection-json", text: document("UPDATE", 55) });
    await expect(call("execute_local_injection", { token: prepared.token, requestId: "human-conflict" })).rejects.toThrow("changed");
    expect(execute).not.toHaveBeenCalled();
  });
  it("runs an ordered Scenario one Step at a time and deduplicates control requests", async () => {
    const { call, evidence, pageEpoch, execute } = await fixture();
    const prepared = await call("prepare_scenario", { pageEpoch, steps: [{ evidence, document: document("UPDATE", 2) }, { evidence, document: document("DELETE", 0) }] });
    expect(prepared.scenario.phase, prepared.scenario.membershipError).toBe("review");
    const runId = prepared.scenario.run.id;
    const first = { runId, action: "step", requestId: "step-1" };
    await call("control_scenario", first);
    await call("control_scenario", first);
    await vi.waitFor(async () => expect((await call("get_scenario_trace")).phase).toBe("paused"));
    expect(execute).toHaveBeenCalledTimes(1);
    await call("control_scenario", { runId, action: "step", requestId: "step-2" });
    await vi.waitFor(async () => expect((await call("get_scenario_trace")).phase).toBe("complete"));
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("stops on unknown delivery and rejects attempts to consume the prepared Draft twice", async () => {
    const { call, evidence, pageEpoch, execute } = await fixture();
    execute.mockRejectedValueOnce(new Error("lost reply"));
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch, document: document() });
    await call("execute_local_injection", { token: prepared.token, requestId: "uncertain" });
    await vi.waitFor(async () => expect((await call("get_operation", { requestId: "uncertain" })).outcome.disposition).toBe("acknowledgement-unknown"));
    await expect(call("execute_local_injection", { token: prepared.token, requestId: "new-id" })).rejects.toThrow("consumed");
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("does not publish a document after access is revoked during a retained read", async () => {
    const { runtime, call, service, evidence, pageEpoch, grant } = await fixture();
    const query = runtime.agent!.query;
    let release!: () => void;
    vi.spyOn(runtime.agent!, "query").mockImplementationOnce(async input => {
      await new Promise<void>(resolve => { release = resolve; }); return query(input);
    });
    const pending = call("prepare_local_injection", { evidence, pageEpoch });
    grant("off"); service.revoke(); release();
    await expect(pending).rejects.toThrow("revoked");
    expect(runtime.agent!.local().draft).toBeNull();
  });
  it("keeps credentials out of reviewed Scenario JSON and supports source-free ordered ADD then UPDATE", async () => {
    const { runtime, call, pageEpoch, execute } = await fixture();
    const scopes = await call("list_scope");
    const scopeId = scopes.nodes.find((node: any) => node.kind === "item").id;
    const target = await call("get_scope", { scopeId });
    expect(target.localInjection.document).toBeTruthy();
    const update = (command: string, qty: number) => JSON.stringify({ command, key: "new-row", isSnapshot: false, fields: { command, key: "new-row", qty: JSON.stringify({ value: qty, password: "never-share-this" }) } });
    const prepared = await call("prepare_scenario", { pageEpoch, steps: [{ scopeId, document: update("ADD", 1) }, { scopeId, document: update("UPDATE", 2) }] });
    expect(prepared.scenario.phase, JSON.stringify(prepared)).toBe("review");
    expect(JSON.stringify(prepared)).not.toContain("never-share-this");
    expect(JSON.stringify(prepared.scenario.run)).not.toContain("rawText");
    runtime.dispatch({ type: "set-visible", visible: false });
    await expect(call("control_scenario", { runId: prepared.scenario.run.id, action: "play", requestId: "hidden" })).rejects.toThrow("visible");
    expect(execute).not.toHaveBeenCalled();
  });
  it("pages Scenario previews without exposing raw text or losing the preparation token", async () => {
    const { call, evidence, pageEpoch } = await fixture();
    const prepared = await call("prepare_scenario", { pageEpoch, steps: Array.from({ length: 30 }, (_, i) => ({ evidence, document: document("UPDATE", i) })) });
    expect(prepared.token).toBeTruthy();
    expect(prepared.scenario.steps).toHaveLength(25);
    expect(prepared.scenario.nextOffset).toBe(25);
    const last = await call("get_scenario_trace", { offset: 25 });
    expect(last.steps).toHaveLength(5); expect(last.nextOffset).toBeNull();
  });
  it("redacts Client Message bodies and removes duplicate raw payload text", async () => {
    const { call, history } = await fixture();
    await history.offer({ ...event(7, "client-message-processed"), direction: "outbound", source: "application", clientMessage: { id: "message-1", pageEpoch: "page-1", message: "private-body", messageState: "available", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available", response: "private-response" }, raw: { duplicate: "private-body" } }).settled;
    const result = await call("query_evidence", { includePayload: true });
    expect(JSON.stringify(result)).not.toContain("private-body");
    expect(JSON.stringify(result)).not.toContain("private-response");
    expect(JSON.stringify(result)).toContain("[REDACTED:client-message-body]");
  });
});
