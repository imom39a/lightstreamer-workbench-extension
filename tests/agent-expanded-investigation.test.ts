import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { agentToolResultBytes } from "../src/agent/tool-result";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/agent/companion/mcp";
import type { CompanionChannel } from "../src/agent/portable-channel";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
function event(id: number, kind: LightstreamerEventEnvelope["kind"], qty: string | number = 1): LightstreamerEventEnvelope {
  return { id: `expanded-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    ...(kind === "item-update" ? { logicalEventId: id === 8 ? "logical-7" : `logical-${id}` } : {}),
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "epoch", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { command: id === 6 ? "ADD" : "UPDATE", key: "row", isSnapshot: false,
      fields: { command: id === 6 ? "ADD" : "UPDATE", key: "row", qty }, changedFields: { command: id === 6 ? "ADD" : "UPDATE", qty } } } : {}) };
}
async function fixture() {
  const history = createInMemoryEventHistory({ panelSessionId: crypto.randomUUID() });
  const execute = vi.fn(async () => ({ requestId: "effect", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } }); runtimes.push(runtime);
  for (const record of [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update"), event(7, "item-update", "2"), event(8, "item-update", "2"), event(9, "item-update", "bad")]) await history.offer(record).settled;
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, "panel", () => "local");
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
  const evidence = (await call("query_evidence", { within: "page" })).evidence.find((row: any) => row.identity.eventId === "expanded-6").identity;
  return { runtime, history, call, evidence, execute };
}

describe("expanded generic agent investigation", () => {
  it("reads exclusive/inclusive sequence windows and typed numeric-string fields", async () => {
    const { call } = await fixture();
    const result = await call("query_evidence", { within: "page", sequenceWindow: { after: 6, through: 8 }, fieldPredicates: [{ field: "qty", op: "range", type: "number", convert: "number-string", min: 2, max: 3 }], fields: ["qty"] });
    expect(result.evidence.map((record: any) => record.identity.sequence)).toEqual([7, 8]);
    expect(result.sequenceWindow).toEqual({ after: 6, through: 8 });
    expect(result.fieldEvaluation).toEqual({ numericConversionFailures: 0, unavailableFields: 0 });
    expect((await call("query_evidence", { within: "page", fieldPredicates: [{ field: "qty", op: "range", type: "number", convert: "number-string", min: -10, max: -1 }] })).totals.matching).toBe(0);
    await expect(call("query_evidence", { within: "page", fieldPredicates: [{ field: "qty", op: "range", type: "number", min: 3, max: 2 }] })).rejects.toThrow("ordered");
  });
  it("returns exact matching counts with explicit units and conversion failures", async () => {
    const { call } = await fixture();
    const options = { within: "page", where: { kind: ["item-update"] }, fieldPredicates: [{ field: "qty", op: "range", type: "number", convert: "number-string", min: 2 }] };
    const records = await call("aggregate_evidence", { ...options, aggregate: { unit: "evidence-records", groupBy: ["qty"], maxGroups: 1 } });
    const logical = await call("aggregate_evidence", { ...options, aggregate: { unit: "distinct-logical-updates", groupBy: ["qty"] } });
    expect(records.aggregate).toMatchObject({ count: 2, matchingEvidenceRecords: 2 });
    expect(logical.aggregate).toMatchObject({ count: 1, matchingEvidenceRecords: 2, missingLogicalIds: 0 });
    expect(logical.fieldEvaluation.numericConversionFailures).toBe(1);
    expect(agentToolResultBytes(logical)).toBeLessThanOrEqual(8192);
  });
  it("describes exact capabilities without baseline values", async () => {
    const { call } = await fixture();
    const item = (await call("list_scope", { limit: 100, maxBytes: 65536 })).nodes.find((node: any) => node.kind === "item");
    const scope = await call("get_scope", { scopeId: item.id, maxBytes: 65536 });
    expect(scope.localInjection.capabilities).toMatchObject({ version: 1, supportedModes: ["COMMAND"], sourceFree: true,
      schema: { fields: ["command", "key", "qty"] }, limits: { maxScenarioSteps: 100 }, delivery: { contactsServer: false, rawSupported: false } });
    expect(scope.localInjection.capabilities.fields.every((field: any) => !("value" in field))).toBe(true);
  });
  it("protects nested credential strings in public predicate and aggregate results", async () => {
    const { history, call } = await fixture();
    const encoded = JSON.stringify({ nested: JSON.stringify({ token: "public-private-guess" }) });
    await history.offer(event(10, "item-update", encoded)).settled;
    const options = { within: "page", sequenceWindow: { after: 9, through: 10 } };
    const guessed = await call("query_evidence", { ...options, fieldPredicates: [{ field: "qty", op: "eq", value: encoded }], fields: ["qty"] });
    expect(guessed.totals.matching).toBe(0);
    const grouped = await call("aggregate_evidence", { ...options, aggregate: { unit: "evidence-records", groupBy: ["qty"] } });
    expect(grouped.aggregate.groups[0].values).toEqual([{ field: "qty", state: "redacted" }]);
    expect(JSON.stringify(grouped)).not.toContain("public-private-guess");
  });
  it("pages current COMMAND rows and compares exact keys with truthful presence", async () => {
    const { runtime, call } = await fixture();
    const item = (await call("list_scope", { limit: 100, maxBytes: 65536 })).nodes.find((node: any) => node.kind === "item");
    const target = { scopeId: item.id, pageEpoch: "epoch", projection: "observed-server", item: { name: "rows", position: 1 }, fields: ["qty"] };
    const rows = await call("query_command_rows", { ...target, limit: 1 });
    expect(rows.total).toBe(1); expect(rows.rows[0].target.key).toBe("row"); expect(rows.nextCursor).toBeNull();
    const comparison = await call("query_command_keys", { ...target, keys: ["row", "unknown"], maxBytes: 65536 });
    expect(comparison.rows.map((row: any) => row.presence.state)).toEqual(["present", "inconclusive"]);
    expect(comparison.rows.every((row: any) => row.readPoint.committedEvidenceBoundary.sequence === 9)).toBe(true);
    expect(runtime.agent!.local().draft).toBeNull();
  });
  it("bundles successful reads at one frozen boundary and refuses effects", async () => {
    const { call, execute } = await fixture();
    const result = await call("read_bundle", { pageEpoch: "epoch", maxBytes: 65536, operations: [
      { id: "rows", kind: "evidence", args: { within: "page", where: { kind: ["item-update"] }, limit: 2 } },
      { id: "counts", kind: "summary", args: { within: "page" } },
      { id: "logical", kind: "aggregate", args: { within: "page", where: { kind: ["item-update"] }, aggregate: { unit: "distinct-logical-updates" } } }
    ] });
    expect(result.status).toBe("COMPLETE");
    expect(result.results).toHaveLength(3);
    expect(result.results.every((read: any) => read.status === "OK" && read.result.readPoint.committedEvidenceBoundary.eventId === result.readPoint.committedEvidenceBoundary.eventId)).toBe(true);
    expect(agentToolResultBytes(result)).toBeLessThanOrEqual(65536);
    await expect(call("read_bundle", { pageEpoch: "epoch", operations: [{ id: "send", kind: "execute_local_injection", args: { requestId: "effect" } }] })).rejects.toThrow("supported shape");
    expect(execute).not.toHaveBeenCalled();
  });
  it("returns no COMMAND data when its live boundary cannot align with a bundle", async () => {
    const { runtime, call } = await fixture();
    const item = (await call("list_scope", { limit: 100, maxBytes: 65536 })).nodes.find((node: any) => node.kind === "item");
    const original = runtime.agent!.commandState!;
    vi.spyOn(runtime.agent!, "commandState").mockImplementation(input => {
      const read = original(input);
      return read.status === "ok" ? { ...read, readPoint: { ...read.readPoint, committedEvidenceBoundary: { ...read.readPoint.committedEvidenceBoundary!, sequence: 8 } } } : read;
    });
    const result = await call("read_bundle", { pageEpoch: "epoch", operations: [{ id: "state", kind: "command-key", args: { scopeId: item.id, projection: "observed-server", item: { name: "rows", position: 1 }, key: "row", fields: ["qty"] } }] });
    expect(result.status).toBe("LIMITED");
    expect(result.results[0]).toMatchObject({ status: "ALIGNMENT_UNAVAILABLE", error: { code: "READ_BOUNDARY_UNALIGNED" } });
    expect(result.results[0].result).toBeUndefined();
  });
  it("generates a deterministic complete validated plan without publishing or delivering", async () => {
    const { runtime, call, evidence, execute } = await fixture();
    const options = { pageEpoch: "epoch", base: { evidence }, key: "generated", commands: ["ADD", "UPDATE", "DELETE"], assignments: { qty: [3, 4] }, delaysMs: [0], maxBytes: 65536 };
    const first = await call("generate_agent_candidates", options), second = await call("generate_agent_candidates", options);
    expect(first).toEqual(second); expect(first.members).toHaveLength(6); expect(first.validation.valid).toBe(true);
    expect(first.members.every((member: any) => member.evidence.eventId === evidence.eventId)).toBe(true);
    expect(runtime.agent!.local().draft).toBeNull(); expect(runtime.agent!.scenario()).toBeNull(); expect(execute).not.toHaveBeenCalled();
    const prepared = await call("prepare_scenario", { pageEpoch: "epoch", members: first.members, maxBytes: 65536 });
    expect(prepared.scenario.run.id).toBeTruthy(); expect(execute).not.toHaveBeenCalled();
    expect(prepared.scenario.steps[0].nativeChanges).toMatchObject({ policy: "native-mode", changedFields: ["command", "key", "qty"] });
  });
  it("expands explicit key lists through the public candidate tool in stable complete sequences", async () => {
    const { runtime, call, evidence, execute } = await fixture();
    const options = { pageEpoch: "epoch", base: { evidence }, keys: ["first", "second"], commands: ["ADD", "UPDATE", "DELETE"], assignments: { qty: [3, 4] }, delaysMs: [0], maxBytes: 65536 };
    const result = await call("generate_agent_candidates", options);
    expect(result.validation.valid).toBe(true); expect(result.members).toHaveLength(12);
    expect(result.members.map((member: any) => [member.document.key, member.document.command])).toEqual([
      ["first", "ADD"], ["first", "UPDATE"], ["first", "DELETE"], ["first", "ADD"], ["first", "UPDATE"], ["first", "DELETE"],
      ["second", "ADD"], ["second", "UPDATE"], ["second", "DELETE"], ["second", "ADD"], ["second", "UPDATE"], ["second", "DELETE"]
    ]);
    expect(await call("generate_agent_candidates", options)).toEqual(result);
    await expect(call("generate_agent_candidates", { ...options, key: "third" })).rejects.toThrow("key or keys");
    expect(runtime.agent!.local().draft).toBeNull(); expect(runtime.agent!.scenario()).toBeNull(); expect(execute).not.toHaveBeenCalled();
  });
  it("validates actual new-tool results through the MCP SDK output schemas", async () => {
    const { call, evidence } = await fixture();
    const item = (await call("list_scope", { limit: 100, maxBytes: 65536 })).nodes.find((node: any) => node.kind === "item");
    const target = { scopeId: item.id, pageEpoch: "epoch", projection: "observed-server", item: { name: "rows", position: 1 }, fields: ["qty"] };
    let receive: (message: Record<string, unknown>) => void = () => {};
    const channel: CompanionChannel = {
      send(message) {
        if (!message.id || typeof message.name !== "string") return;
        void call(message.name, message.args as Record<string, unknown>).then(result => receive({ id: message.id, result }), error => receive({ id: message.id, error: String(error) }));
      }, onMessage(callback) { receive = callback; }, onClose() {}, close() {}
    };
    const server = createMcpServer(channel), client = new Client({ name: "expanded-real-output-contract", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const inputs: Record<string, Record<string, unknown>> = {
        query_command_state: { ...target, key: "row" }, query_command_rows: { ...target, limit: 1 }, query_command_keys: { ...target, keys: ["row", "unknown"] },
        aggregate_evidence: { within: "page", aggregate: { unit: "evidence-records", groupBy: ["qty"] } },
        read_bundle: { pageEpoch: "epoch", operations: [{ id: "examples", kind: "evidence", args: { within: "page", limit: 1 } }] },
        generate_agent_candidates: { pageEpoch: "epoch", base: { evidence }, keys: ["one", "two"], commands: ["ADD", "UPDATE", "DELETE"], assignments: { qty: [3] } }
      };
      for (const [name, input] of Object.entries(inputs)) {
        const result = await client.callTool({ name, arguments: { ...input, panelSessionId: "panel", maxBytes: 65536 } });
        expect(result.isError, name).not.toBe(true);
        expect(result.structuredContent, name).toBeDefined();
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength, name).toBeLessThanOrEqual(65536);
      }
    } finally { await client.close(); await server.close(); }
  });
});
