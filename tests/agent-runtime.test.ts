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
async function fixture(capturedUpdate = event(6, "item-update")) {
  const startup = [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added")];
  for (const candidate of startup) if (candidate.subscription && capturedUpdate.subscription) candidate.subscription = { ...candidate.subscription, ...capturedUpdate.subscription };
  const history = createAuthoritativeHistory({ precommitted: [...startup, capturedUpdate] });
  const execute = vi.fn(async () => ({ requestId: "delivery-1", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  let permission: AgentPermission = "local";
  const service = createAgentService(runtime.agent!, "panel-1", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel-1", ...args }) as Promise<any>;
  const query = await call("query_evidence", { within: "page", includePayload: true, maxBytes: 65536 });
  const evidence = query.evidence.find((row: any) => row.identity.eventId === "event-6").identity;
  const pageEpoch = (await call("get_status")).pageEpoch;
  return { history, runtime, execute, call, evidence, pageEpoch, service, grant(value: AgentPermission) { permission = value; } };
}
describe("Workbench agent domain API", () => {
  it("returns an executable Evidence discovery route for a scope that cannot author directly", async () => {
    const { call } = await fixture();
    const scope = await call("get_scope", { scopeId: "page" });
    expect(scope.localInjection.recovery.evidence.tool).toBe("query_evidence");
    const found = await call(scope.localInjection.recovery.evidence.tool, scope.localInjection.recovery.evidence.arguments);
    expect(found.evidence[0].identity.eventId).toBe("event-6");
  });

  it("recovers an ambiguous Subscription through its actual item search and retained update", async () => {
    const captured = event(6, "item-update");
    captured.subscription!.items = ["rows", "other-rows"];
    const { history, call, pageEpoch } = await fixture(captured);
    const other = event(7, "item-update");
    other.subscription!.items = ["rows", "other-rows"];
    other.item = { name: "other-rows", position: 2 };
    await history.offer(other).settled;
    const subscriptions = await call("search_scope", { kind: "subscription", text: "sub-1" });
    const scope = await call("get_scope", { scopeId: subscriptions.scopes[0].scopeId });
    expect(scope.localInjection.unavailable).toEqual(expect.any(String));
    const recovery = scope.localInjection.recovery;
    const items = await call(recovery.target.tool, recovery.target.arguments);
    expect(items.scopes.map((item: any) => item.kind)).toEqual(["item", "item"]);
    const examples = await call(recovery.evidence.tool, recovery.evidence.arguments);
    const prepared = await call("prepare_local_injection", { evidence: examples.evidence[0].identity, pageEpoch });
    expect(prepared.local.draft.ready).toBe(true);
  });

  it("provides a complete editable JSON template and preserves unrelated fields during a seat change", async () => {
    const captured = event(6, "item-update");
    captured.subscription!.fields = ["command", "key", "modelId", "modelValues"];
    captured.update!.fields = { command: "ADD", key: "row-1", modelId: "seat", modelValues: JSON.stringify({ seat: "14C", status: "confirmed" }) };
    const { call, evidence, pageEpoch, execute } = await fixture(captured);
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch });
    expect(prepared.local.draft.documentContract).toMatchObject({ format: "expanded-json", requiredFields: ["command", "key", "modelId", "modelValues"], jsonStringFields: ["modelValues"] });
    const edited = structuredClone(prepared.local.draft.document);
    expect(edited.fields.modelValues).toEqual({ seat: "14C", status: "confirmed" });
    edited.command = edited.fields.command = "UPDATE";
    edited.fields.modelValues.seat = null;
    const changed = await call("update_agent_document", { token: prepared.token, document: edited });
    expect(changed.local.draft.ready).toBe(true);
    const request = { token: changed.token, requestId: "clear-seat" };
    await call("execute_local_injection", request);
    await call("wait_for_operation", { requestId: request.requestId, timeoutMs: 2000 });
    await call("execute_local_injection", request);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(changed.local.draft.document.fields).toMatchObject({ key: "row-1", modelId: "seat", modelValues: { seat: null, status: "confirmed" } });
  });

  it("preserves ordinary command/key field values in a non-COMMAND editing template", async () => {
    const captured = event(6, "item-update");
    captured.subscription!.mode = "MERGE";
    captured.update = { isSnapshot: false, fields: { command: "application-action", key: "application-id", qty: "1" }, changedFields: { command: "application-action", key: "application-id", qty: "1" } };
    const { call, evidence, pageEpoch } = await fixture(captured);
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch });
    expect(prepared.local.draft.ready, JSON.stringify(prepared.local.draft.diagnostics)).toBe(true);
    expect(prepared.local.draft.documentContract.mirroredFields).toEqual([]);
    expect(prepared.local.draft.document).toMatchObject({ command: null, key: null, fields: { command: "application-action", key: "application-id" } });
  });

  it("queries the retained history without moving the user's investigation and preserves a stable cursor", async () => {
    const { runtime, call } = await fixture();
    const before = runtime.getSnapshot();
    const first = await call("query_evidence", { within: "page", limit: 2 });
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
  it("keeps validation and prepared native-change previews identical, including unavailable facts", async () => {
    const { call, evidence, pageEpoch } = await fixture();
    const invalid = await call("validate_agent_candidate", { pageEpoch, draft: { evidence, document: "{" } });
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch, document: "{" });
    expect(invalid.candidates[0].nativeChanges).toBeNull();
    expect(prepared.local.draft.nativeChanges).toBeNull();

    const corrected = await call("update_agent_document", { token: prepared.token, document: document("UPDATE", 2) });
    const validated = await call("validate_agent_candidate", { pageEpoch, draft: { evidence, document: document("UPDATE", 2) } });
    expect(validated.candidates[0].nativeChanges).toEqual(corrected.local.draft.nativeChanges);
    expect(corrected.local.draft.nativeChanges).toMatchObject({ changedFields: ["command", "qty"], policy: "native-mode", baseline: expect.any(String) });
    expect(JSON.stringify(corrected.local.draft.nativeChanges)).not.toContain('"fields"');
    expect(JSON.stringify(corrected.local.draft.nativeChanges)).not.toContain('"qty":1');
  });
  it("observes asynchronous delivery completion through a bounded receipt wait", async () => {
    const { call, execute, evidence, pageEpoch } = await fixture();
    let release!: (value: any) => void;
    execute.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const prepared = await call("prepare_local_injection", { evidence, pageEpoch, document: document() });
    const started = await call("execute_local_injection", { token: prepared.token, requestId: "wait-for-delivery" });
    expect(started.state).toBe("pending");
    const waiting = call("wait_for_operation", { requestId: "wait-for-delivery", timeoutMs: 2000 });
    release({ requestId: "delivery-1", ok: true, status: "success", timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 });
    expect(await waiting).toMatchObject({ status: "COMPLETE", completionBoundary: "LOCAL_INJECTION_RECEIPT", operation: { state: "complete", outcome: { disposition: "delivered" } } });
    expect(execute).toHaveBeenCalledTimes(1);
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
    expect(prepared.scenario.steps.length).toBeGreaterThan(0);
    let count = prepared.scenario.steps.length;
    let offset = prepared.scenario.nextOffset;
    while (offset !== null) {
      const page = await call("get_scenario_trace", { offset });
      count += page.steps.length;
      offset = page.nextOffset;
    }
    expect(count).toBe(30);
  });
  it("redacts Client Message bodies and removes duplicate raw payload text", async () => {
    const { call, history } = await fixture();
    await history.offer({ ...event(7, "client-message-processed"), direction: "outbound", source: "application", clientMessage: { id: "message-1", pageEpoch: "page-1", message: "private-body", messageState: "available", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available", response: "private-response" }, raw: { duplicate: "private-body" } }).settled;
    const result = await call("query_evidence", { within: "page", includePayload: true, maxBytes: 65536 });
    expect(JSON.stringify(result)).not.toContain("private-body");
    expect(JSON.stringify(result)).not.toContain("private-response");
    expect(JSON.stringify(result)).toContain("[REDACTED:client-message-body]");
  });
});
