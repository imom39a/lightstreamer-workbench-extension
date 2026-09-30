import { describe, expect, it, vi } from "vitest";
import { agentToolFailure, agentToolResultBytes } from "../src/agent/tool-result";
import { createCommandStateProjections } from "../src/core/command-state";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { readAgentCommandState, type AgentCommandStateContext, type AgentCommandStateResult } from "../src/extension/panel/agent-command-state";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { TopologySelectionTarget } from "../src/extension/panel/topology-view-model";

const args = { panelSessionId: "panel", scopeId: "scope", pageEpoch: "page", projection: "observed-server", item: { name: "item", position: 1 }, key: " key " };
const provenance = { source: "server", eventId: "event", timestamp: 1, evidence: { intervalId: "history", sequence: 1, eventId: "event" }, evidenceRetained: true };
function result(fields: unknown[] = []): any {
  return { status: "ok", projection: "observed-server", target: { ...args, subscriptionId: "sub" },
    readPoint: { intervalId: "history", committedEvidenceBoundary: provenance.evidence, retainedRange: null },
    presence: { state: "present", basis: "row", provenance }, fields,
    fieldsTotal: fields.length, fieldsRequested: fields.length, fieldsReturned: fields.length, truncated: false,
    history: { deletedKeysHasOlder: false, lifecycleHasOlder: false, diagnosticsHasOlder: false }, limitations: ["Derived from accepted Evidence; not authoritative state."] };
}
function fixture(value: AgentCommandStateResult) {
  const read = vi.fn(() => value);
  const runtime = { status: () => ({}), local: () => ({ draft: null }), commandState: read } as unknown as AgentRuntime;
  return { read, runtime, service: createAgentService(runtime, "panel", () => "read") };
}

describe("credential-safe COMMAND state service reads", () => {
  it.each([
    ' {"password":"private-key-part","id":9007199254740993} ',
    '{"nested":"{\\"token\\":\\"private-key-part\\"}"}'
  ])("refuses a credential-bearing exact identity without exposing or replacing it (%#)", async key => {
    const projections = createCommandStateProjections();
    const evidence = { intervalId: "history", sequence: 1, eventId: "event" };
    projections.apply({ id: "event", kind: "item-update", timestamp: 1, direction: "inbound", source: "server", synthetic: false,
      subscription: { id: "sub", mode: "COMMAND", items: ["item"] }, item: { name: "item", position: 1 },
      update: { command: "ADD", key, fields: { command: "ADD", key, value: "exact" } }
    }, evidence);
    const context: AgentCommandStateContext = {
      pageEpoch: "page", disposed: false, projectionReady: true, projectionBoundary: evidence,
      history: { ...createInMemoryEventHistory().status(), interval: { id: "history", ordinal: 1 }, committedEvidenceBoundary: evidence, retainedRange: { first: evidence, last: evidence } },
      scope: { kind: "item", subscription: { id: "sub", mode: "COMMAND", active: true, historical: false, serverEstablished: true }, item: args.item } as unknown as TopologySelectionTarget,
      readKey: (projection, target) => projections.readKey(projection, target)
    };
    const exactArgs = { ...args, projection: "observed-server" as const, key };
    const original = readAgentCommandState(exactArgs, context);
    expect(original).toMatchObject({ status: "ok", target: { key }, presence: { state: "present" } });
    const runtime = { status: () => ({}), local: () => ({ draft: null }), commandState: input => readAgentCommandState(input, context) } as AgentRuntime;
    const service = createAgentService(runtime, "panel", () => "read");
    let failure: unknown;
    try { await service.call("query_command_state", exactArgs); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const response = agentToolFailure(failure);
    expect(response.structuredContent.error).toMatchObject({ code: "CREDENTIAL_IDENTITY_UNAVAILABLE", automaticRetry: false, message: expect.stringContaining("Inspect the target in Workbench") });
    expect(JSON.stringify(response)).not.toContain("private-key-part");
    expect(JSON.stringify(response)).not.toContain(key);
    expect(projections.readKey("observed-server", { subscriptionId: "sub", item: args.item, key }).row?.key).toBe(key);
  });

  it("preserves a safe JSON-shaped opaque key exactly, including numeric text and whitespace", async () => {
    const key = ' { "id":9007199254740993, "precise":1.2300 } ';
    const source = result(); source.target.key = key;
    const { service } = fixture(source);
    const response = await service.call("query_command_state", { ...args, key }) as any;
    expect(response.target.key).toBe(key);
    expect(response.presence).toEqual(source.presence);
  });

  it("preserves safe application strings while redacting named credentials and embedded JSON", async () => {
    const plain = ' { "large":9007199254740993, "precise":1.2300 } ';
    const privateJson = ' { "large":9007199254740993, "password":"hidden" } ';
    const source = result([
      { name: "plain", state: "concrete", value: plain, certainty: "projected", provenance },
      { name: "password", state: "concrete", value: "hidden", certainty: "projected", provenance },
      { name: "details", state: "concrete", value: privateJson, certainty: "projected", provenance },
      { name: "ambiguous", state: "ambiguous-null", certainty: "projected", provenance }
    ]);
    const before = JSON.stringify(source);
    const { service, read } = fixture(source);
    const response = await service.call("query_command_state", args) as any;
    expect(response.target.key).toBe(" key ");
    expect(response.presence).toEqual(source.presence);
    expect(response.fields[0]).toMatchObject({ state: "concrete", value: plain, certainty: "projected" });
    expect(response.fields[1]).toMatchObject({ state: "redacted", certainty: "unavailable" });
    expect(response.fields[1].value).toBeUndefined();
    expect(response.fields[2]).toMatchObject({ state: "redacted", certainty: "unavailable", redactedValue: expect.stringContaining("9007199254740993") });
    expect(response.fields[2].value).toBeUndefined();
    expect(response.fields[3]).toMatchObject({ state: "ambiguous-null" });
    expect(JSON.stringify(response)).not.toContain("hidden");
    expect(JSON.stringify(source)).toBe(before);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("fits the whole MCP budget with explicit field omissions and stable field counts", async () => {
    const fields = Array.from({ length: 16 }, (_, index) => ({ name: `field-${index}`, state: "concrete", value: "x".repeat(800), certainty: "projected", provenance }));
    const { service } = fixture(result(fields));
    const response = await service.call("query_command_state", { ...args, maxBytes: 8192 }) as any;
    expect(agentToolResultBytes(response)).toBeLessThanOrEqual(8192);
    expect(response).toMatchObject({ fieldsTotal: 16, fieldsRequested: 16, truncated: true });
    expect(response.fieldsReturned).toBe(response.fields.length);
    expect(response.fieldsReturned).toBeGreaterThan(0);
    expect(response.fields.some((field: any) => field.state === "output-budget" && field.value === undefined && field.certainty === "unavailable")).toBe(true);
  });

  it("rejects unsupported targets and capabilities with stable codes", async () => {
    const { service, runtime } = fixture({ status: "error", problem: { code: "INVALID_TARGET", message: "Select a live COMMAND item." } });
    try { await service.call("query_command_state", args); throw new Error("Expected failure"); }
    catch (error) { expect(agentToolFailure(error).structuredContent.error).toMatchObject({ code: "INVALID_TARGET", automaticRetry: false }); }
    delete runtime.commandState;
    await expect(service.call("query_command_state", args)).rejects.toThrow("UNSUPPORTED_CAPABILITY");
    const status = await service.call("get_status", { panelSessionId: "panel" }) as any;
    expect(status.capabilities).not.toContain("query_command_state");
  });

  it("rejects an already-aborted read before touching the projection", async () => {
    const { service, read } = fixture(result());
    const controller = new AbortController(); controller.abort();
    await expect(service.call("query_command_state", args, { signal: controller.signal })).rejects.toThrow("QUERY_CANCELLED");
    expect(read).not.toHaveBeenCalled();
  });
});
