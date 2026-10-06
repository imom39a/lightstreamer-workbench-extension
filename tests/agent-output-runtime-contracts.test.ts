import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import type { CompanionChannel } from "../src/agent/portable-channel";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); vi.restoreAllMocks(); });
const wide = "wide-observed-value".repeat(300);
function event(id: number, kind: LightstreamerEventEnvelope["kind"], qty: string | number): LightstreamerEventEnvelope {
  return { id: `contract-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING", instrumentationSource: "public-api" },
    subscription: { id: "sub", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "epoch", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { command: "ADD", key: "row", isSnapshot: false, fields: { command: "ADD", key: "row", qty }, changedFields: { command: "ADD", key: "row", qty } } } : {}) };
}
const document = (qty: string | number) => ({ command: "UPDATE", key: "row", isSnapshot: false, fields: { command: "UPDATE", key: "row", qty } });
async function fixture(qty: string | number = 1, held = false, serverStatus?: "processed" | "unknown") {
  const history = createInMemoryEventHistory({ panelSessionId: crypto.randomUUID() });
  let release = () => {};
  const gate = held ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const execute = vi.fn(async () => { await gate; return { requestId: "listener-wire", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }; });
  const serverExecute = vi.fn(async (_draft: unknown, requestId?: string) => {
    await gate;
    if (serverStatus === "unknown") throw new Error("The callback outcome was lost after dispatch.");
    return { requestId: requestId!, ok: true, status: "processed" as const, timestamp: 20, response: "accepted", sentOnNetwork: true };
  });
  const runtime: WorkbenchRuntime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute }, ...(serverStatus ? { serverInjectionExecutor: { execute: serverExecute } } : {}) });
  cleanup.push(() => runtime.disposeAndWait());
  const kinds = ["client-created", "client-status", "subscription-created", "subscription-started", "listener-added", "item-update"] as const;
  for (const [index, kind] of kinds.entries()) await history.offer(event(index + 1, kind, qty)).settled;
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, "panel", () => "local");
  let receive: (message: Record<string, unknown>) => void = () => {};
  const actual = new Map<string, unknown>();
  const channel: CompanionChannel = {
    send(message) { if (message.id && typeof message.name === "string") void service.call(message.name, message.args).then(result => { actual.set(message.name as string, result); receive({ id: message.id, result }); }, error => receive({ id: message.id, error: error instanceof Error ? error.message : String(error) })); },
    onMessage(callback) { receive = callback; }, onClose() {}, close() {}
  };
  const server = createMcpServer(channel), client = new Client({ name: "runtime-output-contracts", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup.push(async () => { release(); await client.close(); await server.close(); });
  await client.listTools(); // SDK caches and enforces the advertised output schemas.
  const envelope = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { panelSessionId: "panel", ...args } });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = await envelope(name, args).catch(error => { throw new Error(`${name}: ${String(error)}; actual=${JSON.stringify(actual.get(name))}`); });
    expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength, name).toBeLessThanOrEqual(Number(args.maxBytes ?? 8192));
    expect(result.structuredContent, name).toBeDefined();
    return result.structuredContent;
  };
  const scopes = await call("list_scope", { maxBytes: 65536 });
  const scopeId = scopes.nodes.find((node: any) => node.kind === "item").id;
  const page = await call("query_evidence", { within: "page", maxBytes: 65536 });
  const evidence = page.evidence.find((row: any) => row.identity.eventId === "contract-6").identity;
  return { runtime, execute, serverExecute, release, call, envelope, scopeId, evidence };
}

describe("actual Workbench runtime outputs through MCP SDK contracts", () => {
  it("preserves pending and execute-once receipts through committed Evidence lookup, recovery and finish", async () => {
    const { call, envelope, evidence, scopeId, execute, release } = await fixture(1, true);
    const scope = await call("get_scope", { scopeId, maxBytes: 65536 });
    expect(scope.localInjection.capabilities).toMatchObject({ sourceFree: true, supportedModes: ["COMMAND"] });
    const retained = await call("get_evidence", { evidence, includePayload: true, maxBytes: 65536 });
    expect(retained.lookup).toMatchObject({ state: "RETAINED", evidence: { identity: evidence, payload: { update: { fields: { qty: 1 } } } } });
    const valid = await call("validate_agent_candidate", { pageEpoch: "epoch", draft: { evidence, document: document(2) }, maxBytes: 65536 });
    expect(valid.valid).toBe(true);
    const prepared = await call("prepare_local_injection", { pageEpoch: "epoch", evidence, requestId: "prepare", document: document(2), maxBytes: 65536 });
    expect((await call("recover_agent_document", { requestId: "prepare", maxBytes: 65536 })).token).toBe(prepared.token);
    const args = { token: prepared.token, requestId: "execute" };
    expect(await call("execute_local_injection", args)).toEqual({ state: "pending", requestId: "execute" });
    expect(await call("execute_local_injection", args)).toEqual({ state: "pending", requestId: "execute" });
    expect(await call("wait_for_operation", { requestId: "execute", timeoutMs: 0 })).toMatchObject({ status: "TIMED_OUT", operation: { state: "pending" } });
    release();
    const waited = await call("wait_for_operation", { requestId: "execute", timeoutMs: 2000, maxBytes: 65536 });
    expect(waited).toMatchObject({ status: "COMPLETE", completionBoundary: "LOCAL_INJECTION_RECEIPT", operation: { state: "complete", evidence: { state: "committed" } } });
    const receipt = await call("get_operation", { requestId: "execute", maxBytes: 65536 });
    expect(receipt.evidence.identity.sequence).toBeGreaterThan(evidence.sequence);
    const injected = await call("get_evidence", { evidence: receipt.evidence.identity, includePayload: true, maxBytes: 65536 });
    expect(injected.lookup.evidence.identity).toEqual(receipt.evidence.identity);
    expect(injected.lookup.evidence.payload).toMatchObject({ synthetic: true, update: { fields: { qty: 2 } } });
    expect(await call("execute_local_injection", args)).toEqual(receipt);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await call("finish_agent_document", { token: prepared.token })).toEqual({ finished: true });
    const next = await call("prepare_local_injection", { pageEpoch: "epoch", evidence, requestId: "abort-next", maxBytes: 65536 });
    expect(await call("abort_agent_document", { token: next.token })).toEqual({ aborted: true });
    const failure = await envelope("get_operation", { requestId: "missing" });
    expect(failure).toMatchObject({ isError: true, structuredContent: { error: { code: "OPERATION_UNKNOWN", automaticRetry: false } } });
    expect(await call("get_scenario_trace")).toEqual({ value: null });
    const invalid = await call("validate_agent_candidate", { pageEpoch: "epoch", draft: { evidence, document: "{" }, maxBytes: 65536 });
    expect(invalid.valid).toBe(false); expect(invalid.candidates[0].diagnostics).toMatchObject([{ severity: "error", code: "invalid-json" }]);
    expect(invalid.reason).toBe(invalid.candidates[0].diagnostics[0].message);
  });

  it("reports real wide-value omissions without losing target, verdict, token or Scenario Run identity", async () => {
    const { call, envelope, scopeId, evidence, execute } = await fixture(wide);
    const fullScope = await call("get_scope", { scopeId, maxBytes: 65536 });
    expect(fullScope.localInjection.document.fields.qty).toBeNull();
    const wideEvidence = await call("get_evidence", { evidence, includePayload: true, maxBytes: 65536 });
    expect(wideEvidence.lookup.evidence.payload.update.fields.qty).toBe(wide);
    expect(await envelope("get_evidence", { evidence, includePayload: true, maxBytes: 4096 })).toMatchObject({ isError: true, structuredContent: { error: { code: "RESULT_BUDGET_EXCEEDED", automaticRetry: false } } });
    expect((await call("get_evidence", { evidence, maxBytes: 4096 })).lookup.evidence.identity).toEqual(evidence);
    const members = [{ kind: "step", id: "wide-step", evidence, document: document(wide) }];
    const full = await call("validate_agent_candidate", { pageEpoch: "epoch", members, maxBytes: 65536 });
    expect(full.valid).toBe(true); expect(full.members).toHaveLength(1);
    const compact = await call("validate_agent_candidate", { pageEpoch: "epoch", members, maxBytes: 4096 });
    expect(compact).toMatchObject({ valid: true, memberCount: 1, stepCount: 1, checkpointCount: 0, invalidStepCount: 0, invalidCheckpointCount: 0, detailsOmitted: expect.any(String) });
    expect(compact.target).toEqual(full.target); expect(compact.members).toBeUndefined();
    const invalidMembers = [...members, { kind: "checkpoint", id: "bad-checkpoint", name: "Invalid reference", assertions: [{ id: "missing", kind: "correlated-local-evidence-exists", stepId: "missing-step" }] }];
    const fullInvalid = await call("validate_agent_candidate", { pageEpoch: "epoch", members: invalidMembers, maxBytes: 65536 });
    const compactInvalid = await call("validate_agent_candidate", { pageEpoch: "epoch", members: invalidMembers, maxBytes: 4096 });
    expect(fullInvalid.valid).toBe(false);
    expect(compactInvalid).toMatchObject({ valid: false, reason: fullInvalid.reason, memberCount: 2, stepCount: 1, checkpointCount: 1, invalidStepCount: 0, invalidCheckpointCount: 1, detailsOmitted: expect.any(String) });
    const local = await call("prepare_local_injection", { pageEpoch: "epoch", evidence, document: document(wide), requestId: "wide-local", maxBytes: 4096 });
    expect(local.token).toEqual(expect.any(String)); expect(local.previewOmitted).toEqual(expect.any(String));
    expect((await call("recover_agent_document", { requestId: "wide-local", maxBytes: 4096 })).token).toBe(local.token);
    expect(await call("abort_agent_document", { token: local.token })).toEqual({ aborted: true });
    const prepared = await call("prepare_scenario", { pageEpoch: "epoch", members, requestId: "wide-scenario", maxBytes: 8192 });
    expect(prepared.token).toEqual(expect.any(String)); expect(prepared.previewOmitted).toEqual(expect.any(String));
    const reviewed = await call("get_scenario_trace", { maxBytes: 65536 });
    expect(reviewed.phase).toBe("review"); expect(reviewed.members[0].document.fields.qty).toBe(wide);
    const trace = await call("get_scenario_trace", { maxBytes: 4096 });
    expect(trace.previewOmitted).toEqual(expect.any(String)); expect(trace.run.id).toBe(reviewed.run.id); expect(trace.members).toMatchObject([{ kind: "step", id: "wide-step", ready: true }]);
    expect(await call("control_scenario", { runId: trace.run.id, requestId: "wide-play", action: "play" })).toMatchObject({ accepted: true });
    await vi.waitFor(async () => expect((await call("get_scenario_trace", { maxBytes: 65536 })).phase).toBe("complete"));
    const completed = await call("get_scenario_trace", { maxBytes: 4096 });
    expect(completed.phase).toBe("complete"); expect(completed.run.id).toBe(reviewed.run.id); expect(completed.run.trace).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await call("finish_agent_document", { token: prepared.token })).toEqual({ finished: true });
  });
  it.each(["processed", "unknown"] as const)("keeps actual reviewed Server %s receipts recoverable and sends once", async status => {
    const { runtime, call, envelope, serverExecute, release } = await fixture(1, true, status);
    const requestId = `server-${status}`;
    const message = { pageEpoch: "epoch", clientId: "client", sessionId: "session", message: wide, sequence: "orders", delayTimeout: null, enqueueWhileDisconnected: false, requestId };
    const prepared = await call("prepare_server_injection", { ...message, maxBytes: 4096 });
    expect(prepared).toMatchObject({ requestId, token: expect.any(String), approvalRequired: true, previewOmitted: expect.any(String) });
    expect((await call("prepare_server_injection", { ...message, maxBytes: 4096 })).token).toBe(prepared.token);
    const args = { token: prepared.token, requestId };
    expect(await envelope("execute_server_injection", args)).toMatchObject({ isError: true, structuredContent: { error: { code: "HUMAN_APPROVAL_REQUIRED", automaticRetry: false } } });
    expect(serverExecute).not.toHaveBeenCalled();
    // These dispatches stand in for the separate human actions in the visible
    // Workbench document; no MCP tool can supply this per-message approval.
    runtime.dispatch({ type: "review-server-injection" });
    const reviewedServer = runtime.agent!.serverInjection!() as any;
    expect(reviewedServer.draft.phase, JSON.stringify(reviewedServer.draft.diagnostics)).toBe("review");
    runtime.dispatch({ type: "approve-server-injection-for-agent" });
    expect(await call("recover_server_injection", { requestId, maxBytes: 4096 })).toMatchObject({ token: prepared.token, state: "approved", approvalRequired: true, outcome: null, previewOmitted: expect.any(String) });
    const fullApproved = await call("recover_server_injection", { maxBytes: 65536 });
    expect(fullApproved).toMatchObject({ token: prepared.token, state: "approved", document: { agentRequestId: requestId, agentApproved: true, value: { target: { pageEpoch: "epoch", clientId: "client", sessionId: "session" }, message: wide } } });
    const pending = call("execute_server_injection", args);
    await vi.waitFor(() => expect(serverExecute).toHaveBeenCalledTimes(1));
    expect(await call("get_operation", { requestId, maxBytes: 4096 })).toMatchObject({ requestId, state: "pending", approvalRequired: true });
    expect(await call("recover_server_injection", { requestId, maxBytes: 4096 })).toMatchObject({ token: prepared.token, state: "pending", outcome: null, previewOmitted: expect.any(String) });
    const duplicate = call("execute_server_injection", args);
    release();
    const receipt = await pending;
    expect(await duplicate).toEqual(receipt);
    expect(receipt).toMatchObject({ requestId, state: "complete", outcome: { requestId, ok: status === "processed", status } });
    if (status === "processed") expect(receipt.outcome).toMatchObject({ sentOnNetwork: true, response: "accepted" });
    else expect(receipt.outcome.error).toContain("Do not repeat automatically");
    expect(await call("execute_server_injection", args)).toEqual(receipt);
    expect(await call("get_operation", { requestId, maxBytes: 4096 })).toMatchObject({ ...receipt, approvalRequired: true });
    expect(await call("recover_server_injection", { requestId, maxBytes: 4096 })).toMatchObject({ token: prepared.token, state: "complete", outcome: receipt.outcome, previewOmitted: expect.any(String) });
    const fullRecovered = await call("recover_server_injection", { requestId, maxBytes: 65536 });
    expect(fullRecovered).toMatchObject({ token: prepared.token, state: "complete", outcome: receipt.outcome, document: { agentRequestId: requestId, phase: "outcome", value: { message: wide }, outcome: receipt.outcome } });
    expect(serverExecute).toHaveBeenCalledTimes(1);
    expect(serverExecute.mock.calls[0]![0]).toMatchObject({ target: { pageEpoch: "epoch", clientId: "client", sessionId: "session" }, message: wide, sequence: "orders", delayTimeout: null, enqueueWhileDisconnected: false });
    runtime.dispatch({ type: "finish-server-injection" });
    const next = await call("prepare_server_injection", { ...message, message: "separate reviewed message", requestId: `${requestId}-abort`, maxBytes: 65536 });
    expect(await call("abort_server_injection", { token: next.token })).toEqual({ aborted: true });
    expect(await call("recover_server_injection", { requestId: `${requestId}-abort`, maxBytes: 4096 })).toMatchObject({ token: next.token, state: "aborted", outcome: null, previewOmitted: expect.any(String) });
    expect(await envelope("execute_server_injection", { requestId: `${requestId}-abort`, token: next.token })).toMatchObject({ isError: true, structuredContent: { error: { code: "TARGET_CHANGED", automaticRetry: false } } });
    expect(serverExecute).toHaveBeenCalledTimes(1);
  });

});
