import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer } from "../src/agent/companion/mcp";
import type { CompanionChannel } from "../src/agent/portable-channel";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function fixture(mode: string, options: { fieldSchema?: string; fields?: string[]; secondLevelFields?: string[]; items?: string[]; noUpdates?: boolean; retired?: boolean } = {}) {
  const metricNames: Record<string, string> = { COMMAND: "quantity", MERGE: "temperature", DISTINCT: "reading", RAW: "price" };
  const metric = metricNames[mode] ?? "1";
  const fields = options.fieldSchema ? undefined : options.fields ?? [...(mode === "COMMAND" ? ["command", "key"] : []), metric, "state", "document"];
  const history = createInMemoryEventHistory({ panelSessionId: crypto.randomUUID() });
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
  cleanup.push(() => runtime.disposeAndWait());
  const makeEvent = (id: number, kind: LightstreamerEventEnvelope["kind"], value?: string): LightstreamerEventEnvelope => ({
    id: `discovery-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client", sessionId: "session", adapterSet: "fixture-adapters", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub", mode, items: options.items ?? ["measurements-a", "measurements-b"], fields, fieldSchema: options.fieldSchema, dataAdapter: "fixture-data", commandSecondLevelFields: options.secondLevelFields, active: kind !== "subscription-ended", subscribed: kind !== "subscription-ended" },
    listener: { id: id === 8 ? "second-listener" : "listener", callbacks: ["onItemUpdate"] },
    item: { name: "measurements-a", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "epoch", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(value === undefined ? {} : { logicalEventId: id === 8 ? "logical-7" : `logical-${id}`, update: {
      isSnapshot: false, ...(mode === "COMMAND" ? { command: "ADD", key: `row-${id === 8 ? 7 : id}` } : {}),
      fields: { ...(mode === "COMMAND" ? { command: "ADD", key: `row-${id === 8 ? 7 : id}` } : {}), [metric]: value, state: "ready", document: '{"entity":{"code":"example"}}', ...Object.fromEntries((options.secondLevelFields ?? []).map(name => [name, value])) },
      changedFields: { [metric]: value }
    } })
  });
  for (const [index, kind] of (["client-created", "client-status", "subscription-created", "subscription-started", "listener-added"] as const).entries()) await history.offer(makeEvent(index + 1, kind)).settled;
  if (!options.noUpdates) for (const [index, value] of ["8", "12", "12", "17"].entries()) await history.offer(makeEvent(index + 6, "item-update", value)).settled;
  if (options.retired) await history.offer(makeEvent(10, "subscription-ended")).settled;
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, "panel", () => "read");
  let receive: (message: Record<string, unknown>) => void = () => {};
  const channel: CompanionChannel = {
    send(message) { if (message.id && typeof message.name === "string") void service.call(message.name, message.args).then(result => receive({ id: message.id, result }), error => receive({ id: message.id, error: error instanceof Error ? error.message : String(error) })); },
    onMessage(callback) { receive = callback; }, onClose() {}, close() {}
  };
  const server = createMcpServer(channel), client = new Client({ name: "unfamiliar-source-discovery", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanup.push(async () => { await client.close(); await server.close(); });
  await client.listTools();
  const envelope = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: { panelSessionId: "panel", ...args } });
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = await envelope(name, args);
    expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength, name).toBeLessThanOrEqual(Number(args.maxBytes ?? 8192));
    return result.structuredContent;
  };
  const profileSource = async (args: Record<string, unknown>): Promise<any> => {
    const first = await envelope("describe_stream", args);
    if (!first.isError) return first.structuredContent;
    const failure = first.structuredContent as { error: { code: string; message: string } };
    expect(failure.error.code).toBe("RESULT_BUDGET_EXCEEDED");
    const suggested = /Retry describe_stream with maxBytes:(\d+)/.exec(failure.error.message);
    expect(suggested, failure.error.message).not.toBeNull();
    const maxBytes = Number(suggested![1]);
    expect(maxBytes).toBeGreaterThan(8192); expect(maxBytes).toBeLessThanOrEqual(65536);
    return call("describe_stream", { ...args, maxBytes });
  };
  return { runtime, history, call, envelope, profileSource, metric, fields };
}

describe("unfamiliar Lightstreamer source discovery through MCP", () => {
  it.each(["COMMAND", "MERGE", "DISTINCT", "RAW"])("learns %s schema independently of injection and answers a typed field question", async mode => {
    const { runtime, call, profileSource, metric, fields } = await fixture(mode);
    const originalScope = runtime.getSnapshot().scopeId;
    const status = await call("get_status");
    expect(status.capabilities).toContain("aggregate_evidence");
    expect(status.capabilities).not.toContain("prepare_local_injection");
    const scopes = await call("list_scope");
    const scopeId = scopes.nodes.find((node: any) => node.kind === "subscription").id;
    const scope = await call("get_scope", { scopeId });
    expect(scope).toEqual(runtime.agent!.scope(scopeId));
    expect(await call("get_scope", { scopeId, maxBytes: 65536 })).toEqual(scope);
    expect(scope.localInjection.unavailable).toBeTruthy(); // Multiple items cannot author one exact target.
    expect(scope.readContext).toMatchObject({ version: 1, scopeId,
      source: { clientId: "client", sessionId: "session", subscriptionId: "sub", mode, adapterSet: "fixture-adapters", dataAdapter: "fixture-data" },
      item: null, schema: { basis: "declared-field-list", fields, totalFields: fields!.length, nextOffset: null } });
    const item = (await call("search_scope", { kind: "item", parentScopeId: scopeId, text: "measurements-a" })).scopes[0];
    expect((await call("get_scope", { scopeId: item.scopeId })).readContext.item).toEqual({ name: "measurements-a", position: 1 });
    const profile = await profileSource({ scopeId: item.scopeId, filter: { criteria: [{ facet: "kind", polarity: "include", type: "enum", value: "ITEM-UPDATE" }] }, limit: 4 });
    const metricName = scope.readContext.schema.fields.find((name: string) => name === metric);
    expect(profile.streams[0].observedFields.find((field: any) => field.name === metricName).types).toEqual(["string"]);
    expect(profile.streams[0].observedFields.find((field: any) => field.name === "document").jsonShapes).toContain("json-object {entity:{code:string}}");
    const example = await call("get_evidence", { evidence: profile.streams[0].examples[0].identity, fields: [metricName] });
    expect(example.lookup.state).toBe("RETAINED");
    const query = { scopeId: item.scopeId, at: profile.readPoint, where: { kind: ["ITEM-UPDATE"] }, fieldPredicates: [{ field: metricName, op: "range", type: "number", convert: "number-string", min: 10 }] };
    const matching = await call("query_evidence", { ...query, fields: [metricName], limit: 3 });
    expect(matching.totals.matching).toBe(3);
    const counted = await call("aggregate_evidence", { ...query, aggregate: { unit: "distinct-logical-updates" } });
    expect(counted.aggregate).toMatchObject({ count: 2, matchingEvidenceRecords: 3, missingLogicalIds: 0 });
    expect(counted.readPoint).toEqual(profile.readPoint);
    expect(runtime.getSnapshot().scopeId).toBe(originalScope);
    expect(runtime.agent!.local().draft).toBeNull();
  });

  it("distinguishes a named server schema from resolved field names instead of guessing them", async () => {
    const { call, profileSource } = await fixture("MERGE", { fieldSchema: "quote-schema-v3" });
    const scopeId = (await call("list_scope")).nodes.find((node: any) => node.kind === "subscription").id;
    const scope = await call("get_scope", { scopeId });
    expect(scope.readContext.schema).toMatchObject({ basis: "named-field-schema", name: "quote-schema-v3", fields: [], totalFields: null, nextOffset: null });
    expect(scope.readContext.limitations.join(" ")).toMatch(/resolved field names/i);
    const profile = await profileSource({ scopeId, limit: 1 });
    expect(profile.streams[0].declaredFields).toEqual([]);
    expect(profile.streams[0].observedFields.map((field: any) => field.name)).toContain("temperature");
  });

  it("exposes configured fields before any Item Update has been retained", async () => {
    const { call } = await fixture("RAW", { noUpdates: true });
    const scopeId = (await call("list_scope")).nodes.find((node: any) => node.kind === "subscription").id;
    expect((await call("get_scope", { scopeId })).readContext.schema.fields).toEqual(["price", "state", "document"]);
    expect((await call("summarize_evidence", { scopeId, where: { kind: ["ITEM-UPDATE"] } })).totals.matching).toBe(0);
  });

  it("pages a wide declaration while preserving read context when injection details cannot fit", async () => {
    const fields = Array.from({ length: 65 }, (_, index) => `field-${index}-${"x".repeat(160)}`);
    const { call, envelope, runtime } = await fixture("MERGE", { fields, items: ["measurements-a"] });
    const scopeId = (await call("list_scope")).nodes.find((node: any) => node.kind === "item").id;
    expect(await envelope("get_scope", { scopeId })).toMatchObject({ isError: true, structuredContent: { error: { code: "RESULT_BUDGET_EXCEEDED", message: expect.stringContaining("fieldLimit:1") } } });
    expect((await call("get_scope", { scopeId, fieldLimit: 1 })).readContext.schema.fields).toEqual(fields.slice(0, 1));
    const names: string[] = [];
    let fieldOffset: number | null = 0;
    while (fieldOffset !== null) {
      const scope = await call("get_scope", { scopeId, fieldOffset, fieldLimit: 8 });
      expect(scope.readContext.schema.offset).toBe(fieldOffset);
      expect(scope.readContext.schema.totalFields).toBe(65);
      expect(scope.readContext.schema.fields.length).toBeLessThanOrEqual(8);
      expect(scope.localInjection.capabilities).toBeUndefined();
      expect(scope.localInjection.capabilitiesOmitted).toBeTruthy();
      names.push(...scope.readContext.schema.fields);
      const next = scope.readContext.schema.nextOffset;
      if (next !== null) expect(next).toBeGreaterThan(fieldOffset);
      fieldOffset = next;
    }
    expect(names).toEqual(fields);
    expect(runtime.agent!.local().draft).toBeNull();
    expect((await call("get_scope", { scopeId: "page" })).readContext).toBeNull();
  });

  it("keeps a retired Subscription's schema available for retained Evidence queries", async () => {
    const { call, metric } = await fixture("DISTINCT", { retired: true });
    const scopeId = (await call("list_scope")).nodes.find((node: any) => node.kind === "subscription").id;
    const scope = await call("get_scope", { scopeId });
    expect(scope.localInjection.unavailable).toBeTruthy();
    expect(scope.readContext.schema.fields).toContain(metric);
    const evidence = await call("query_evidence", { scopeId, where: { kind: ["ITEM-UPDATE"] }, fieldPredicates: [{ field: metric, op: "eq", value: "12" }], fields: [metric] });
    expect(evidence.totals.matching).toBe(2);
  });

  it("discovers and queries declared second-level COMMAND fields without guessing nested paths", async () => {
    const { call, profileSource } = await fixture("COMMAND", { secondLevelFields: ["bid", "ask"] });
    const scopeId = (await call("list_scope")).nodes.find((node: any) => node.kind === "subscription").id;
    const scope = await call("get_scope", { scopeId });
    expect(scope.readContext.schema.fields).not.toContain("bid");
    expect(scope.readContext.secondLevelSchema).toMatchObject({ basis: "declared-field-list", fields: ["bid", "ask"], totalFields: 2 });
    const field = scope.readContext.secondLevelSchema.fields[0];
    const profile = await profileSource({ scopeId, limit: 1 });
    expect(profile.streams[0].declaredFields).toContain(field);
    const evidence = await call("query_evidence", { scopeId, fieldPredicates: [{ field, op: "eq", value: "12" }], fields: [field] });
    expect(evidence.totals.matching).toBe(2);
  });
});
