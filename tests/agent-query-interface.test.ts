import Ajv from "ajv";
import { describe, expect, it, vi } from "vitest";
import { AGENT_TOOLS, agentTimeoutCode, isReservedAgentCall, validateAgentCall } from "../src/agent/protocol";
import { createFilter } from "../src/core/filter-algebra";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentQueryInput, AgentRuntime } from "../src/extension/panel/agent-runtime";
import type { EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot } from "../src/core/evidence-filter-contract";

const identity = (sequence: number): EvidenceIdentity => ({ intervalId: "interval-1", pageId: "page-1", ownerId: "owner-1", sequence, eventId: `event-${sequence}` });
const point: EvidenceReadPoint = {
  interval: { id: "interval-1", ordinal: 1 },
  committedEvidenceBoundary: identity(2),
  retainedRange: { first: identity(1), last: identity(2) }
};
function snapshot(nextCursor: string | null = null): EvidenceSnapshot {
  return {
    readPoint: point, page: { evidence: [], nextCursor }, totals: { matching: 3, inScope: 3 }, discoveries: new Map(),
    lookup: null, find: null, evaluation: "COMPLETE", coverage: "COMPLETE", storage: "MEMORY_FALLBACK"
  };
}
type QueryMock = ReturnType<typeof vi.fn<(input: AgentQueryInput) => Promise<EvidenceSnapshot>>>;
function service(query: QueryMock = vi.fn<(input: AgentQueryInput) => Promise<EvidenceSnapshot>>(async () => snapshot("storage-cursor"))) {
  const runtime = {
    query, queryBoundary: () => ({ scope: { kind: "PAGE" as const }, filter: createFilter() }),
    status: () => ({ visible: true }), scopes: () => ({}), scope: () => ({}), diagnostics: vi.fn(),
    prepare: vi.fn(), validateCandidate: vi.fn(async () => ({ valid: true })), prepareScenarioPlan: vi.fn(), edit: vi.fn(),
    local: () => ({ draft: null }), scenario: () => null, execute: vi.fn(), control: vi.fn(), finish: vi.fn()
  } as unknown as AgentRuntime;
  const agent = createAgentService(runtime, "panel-1", () => "local");
  return { agent, query };
}
const call = (agent: ReturnType<typeof createAgentService>, name: string, args: Record<string, unknown> = {}) => agent.call(name, { panelSessionId: "panel-1", ...args }) as Promise<any>;

describe("agent query and discovery interface", () => {
  it("publishes standard bounded schemas and exposes query and stream output shapes", () => {
    const query = AGENT_TOOLS.find(tool => tool.name === "query_evidence")!;
    const stream = AGENT_TOOLS.find(tool => tool.name === "describe_stream")!;
    const ajv = new Ajv({ strict: false });
    const validatesQuery = ajv.compile(query.outputSchema);
    const queryResult = { readPoint: point, totals: { matching: 0, inScope: 0 }, coverage: "COMPLETE", evaluation: "COMPLETE", storage: "MEMORY_FALLBACK", discoveries: {}, nextCursor: null, evidence: [], omissions: [] };
    expect(validatesQuery(queryResult)).toBe(true);
    const { readPoint: _point, ...withoutPoint } = queryResult;
    expect(validatesQuery(withoutPoint)).toBe(false);
    expect(validatesQuery({ ...queryResult, readPoint: {} })).toBe(false);
    const validatesStream = ajv.compile(stream.outputSchema);
    const streamResult = { readPoint: point, matchingTotal: 0, sampled: 0, completeness: "COMPLETE", nextCursor: null, omissions: [] };
    expect(validatesStream(streamResult)).toBe(true);
    const { matchingTotal: _total, ...withoutTotal } = streamResult;
    expect(validatesStream(withoutTotal)).toBe(false);
    expect(validatesStream({ ...streamResult, matchingTotal: -1 })).toBe(false);
    expect(validatesQuery({ error: { code: "QUERY_FAILED", message: "failure", automaticRetry: false } })).toBe(true);
    expect(validatesQuery({ error: {} })).toBe(false);
    const schemas = JSON.stringify([query.inputSchema, stream.inputSchema]);
    expect(schemas).not.toContain('"scalar"');
    expect(schemas).not.toContain('"nullable-object"');
  });

  it("advertises canonical authoring limits and accepts typed or legacy document input", () => {
    const document = { command: "ADD", key: "k", isSnapshot: false, fields: { price: 1, metadata: { source: ["fixture", null] } } };
    expect(() => validateAgentCall("prepare_local_injection", { panelSessionId: "p", pageEpoch: "e", document })).not.toThrow();
    expect(() => validateAgentCall("prepare_local_injection", { panelSessionId: "p", pageEpoch: "e", document: JSON.stringify(document) })).not.toThrow();
    expect(() => validateAgentCall("prepare_local_injection", { panelSessionId: "p", pageEpoch: "e", document: { ...document, fields: { price: "x".repeat(65 * 1024) } } })).toThrow("DOCUMENT_BUDGET_EXCEEDED");
    const step = { kind: "step", id: "m".repeat(256), scopeId: "scope" };
    const checkpoint = { kind: "checkpoint", id: "checkpoint", name: "check", assertions: [{ id: "assertion", kind: "correlated-local-evidence-exists", stepId: "step", withinActiveMs: 300_000 }] };
    expect(() => validateAgentCall("prepare_scenario", { panelSessionId: "p", pageEpoch: "e", members: [step, checkpoint] })).not.toThrow();
    expect(() => validateAgentCall("prepare_scenario", { panelSessionId: "p", pageEpoch: "e", members: [{ ...step, id: "m".repeat(257) }] })).toThrow("exactly one supported shape");
    expect(() => validateAgentCall("prepare_scenario", { panelSessionId: "p", pageEpoch: "e", members: [{ ...checkpoint, assertions: [{ ...checkpoint.assertions[0], withinActiveMs: 300_001 }] }] })).toThrow("exactly one supported shape");
    expect(isReservedAgentCall("get_status", {})).toBe(true);
    expect(isReservedAgentCall("control_scenario", { action: "pause" })).toBe(true);
    expect(isReservedAgentCall("control_scenario", { action: "play" })).toBe(false);
    expect(isReservedAgentCall("wait_for_operation", {})).toBe(false);
    expect(agentTimeoutCode("search_scope", {})).toBe("QUERY_FAILED");
    expect(agentTimeoutCode("prepare_local_injection", {})).toBe("DOCUMENT_PUBLICATION_UNKNOWN");
    expect(agentTimeoutCode("control_scenario", { action: "play" })).toBe("DELIVERY_UNKNOWN");
    expect(agentTimeoutCode("control_scenario", { action: "pause" })).toBe("CONTROL_OUTCOME_UNKNOWN");
    expect(AGENT_TOOLS.find(tool => tool.name === "recover_agent_document")!.inputSchema).toMatchObject({ properties: { requestId: expect.any(Object), maxBytes: expect.any(Object) } });
  });

  it("advertises bounded projection budgets and the exact-run wait contract", () => {
    const budget = { maxProjectionReads: 1_000_000, maxPayloadHydrations: 1_000_000, deadlineMs: 30_000 };
    for (const name of ["query_evidence", "search_evidence", "summarize_evidence", "describe_stream"]) {
      const base = name === "describe_stream" ? { limit: 1 } : { within: "page", ...(name === "search_evidence" ? { text: "needle" } : {}) };
      expect(() => validateAgentCall(name, { panelSessionId: "p", ...base, workBudget: budget })).not.toThrow();
      expect(() => validateAgentCall(name, { panelSessionId: "p", ...base, workBudget: { ...budget, deadlineMs: 30_001 } })).toThrow("invalid integer");
    }
    expect(() => validateAgentCall("wait_for_evidence", { panelSessionId: "p", after: point, pageEpoch: "e", timeoutMs: 20_000, workBudget: budget })).not.toThrow();
    expect(() => validateAgentCall("wait_for_scenario", { panelSessionId: "p", runId: "run", pageEpoch: "e", afterRevision: 0, timeoutMs: 0, maxBytes: 65536 })).not.toThrow();
    expect(() => validateAgentCall("wait_for_scenario", { panelSessionId: "p", runId: "run" })).toThrow("required");
  });

  it("normalizes legacy text and typed facet criteria into the canonical query", async () => {
    const { agent, query } = service();
    await call(agent, "query_evidence", {
      scopeId: "subscription-1", text: "ADD", limit: 10, order: "NEWEST_FIRST",
      filter: { criteria: [{ facet: "kind", polarity: "include", type: "enum", value: "item-update" }] }
    });
    const input = query.mock.calls[0]![0];
    expect(input.scopeId).toBe("subscription-1");
    expect(input.filter?.text).toBe("add");
    expect(input.filter?.criteria.kind?.include[0]).toMatchObject({ facet: "kind", type: "enum", value: "ITEM-UPDATE" });
    expect(input.order).toBe("NEWEST_FIRST");
  });

  it("pins explicit read points, filters and order to opaque continuation cursors", async () => {
    const { agent, query } = service();
    const first = await call(agent, "query_evidence", {
      within: "page", at: point, order: "OLDEST_FIRST", filter: { criteria: [{ facet: "mode", polarity: "exclude", type: "enum", value: "MERGE" }] }, limit: 2
    });
    const second = await call(agent, "query_evidence", { cursor: first.nextCursor });
    expect(second.readPoint).toEqual(first.readPoint);
    expect(query).toHaveBeenNthCalledWith(2, expect.objectContaining({
      at: point, order: "OLDEST_FIRST", cursor: "storage-cursor", size: 2,
      filter: expect.objectContaining({ criteria: expect.objectContaining({ mode: expect.objectContaining({ exclude: [expect.objectContaining({ value: "MERGE" })] }) }) })
    }));
  });

  it("discovers bounded facets and keeps describe_stream continuation payload-redacted", async () => {
    const { agent, query } = service();
    const described = await call(agent, "describe_stream", { limit: 5, order: "NEWEST_FIRST" });
    expect(described.completeness).toBe("LIMITED");
    expect(described.matchingTotal).toBe(3);
    expect(described.nextCursor).toBeTruthy();
    expect(described.profileOmissions).toMatchObject({ fields: 0, identities: 0, countsMayBeLowerBounds: true });
    await call(agent, "query_evidence", { cursor: described.nextCursor });
    expect(query.mock.calls[0]![0].includePayload).toBe(true); // Internal safe profiler input.
    expect(query.mock.calls[1]![0].includePayload).toBe(false); // Public continuation preserves opt-in.
    const discoveryQuery = vi.fn<(input: AgentQueryInput) => Promise<EvidenceSnapshot>>(async () => ({ ...snapshot(null), discoveries: new Map([["kind", { state: "AVAILABLE", facet: "kind", values: [], distinctTotal: 0, nextCursor: null, baseEvidenceCount: 0 } as any]]) }));
    const { agent: discoveryAgent } = service(discoveryQuery);
    const result = await call(discoveryAgent, "query_evidence", { within: "page", discover: [{ facet: "kind", limit: 10 }] });
    expect(result.discoveries.kind.state).toBe("AVAILABLE");
    expect(discoveryQuery).toHaveBeenCalledWith(expect.objectContaining({ discover: [{ facet: "kind", size: 10 }] }));
  });

  it("rejects malformed nested values, inconsistent read points and conflicting legacy text", async () => {
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", filter: { criteria: [{ facet: "kind", polarity: "include", type: "enum", value: "x", identity: "forged" }] } })).toThrow("unknown property");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", at: { ...point, committedEvidenceBoundary: identity(1) } })).toThrow("precedes");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", at: { ...point, retainedRange: { first: { ...identity(1), intervalId: "other" }, last: identity(2) } } })).toThrow("inconsistent");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", text: "one", filter: { text: "two" } })).toThrow("must match");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", filter: { around: { intervalId: "interval-1", start: 10, end: 2 } } })).toThrow("half-open timestamp range");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", filter: { around: { intervalId: "interval-1", start: 10, end: 10 } } })).toThrow("half-open timestamp range");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", filter: { criteria: [{ facet: "kind", polarity: "include", type: "number", value: 1 }] } })).toThrow("unsupported facet or value type");
    expect(() => validateAgentCall("query_evidence", { panelSessionId: "panel-1", within: "page", at: { interval: point.interval } })).toThrow("expected exactly one supported shape");
  });

  it("requires explicit, uniquely identified candidate Scenario members and typed assertions", async () => {
    const { agent } = service();
    const valid = { pageEpoch: "epoch-1", members: [
      { kind: "step", id: "join", scopeId: "scope-1" },
      { kind: "checkpoint", id: "joined", name: "joined", assertions: [{ id: "exists", kind: "command-key-exists", item: { name: null, position: 1 }, key: "row-1", expected: "present" }] }
    ] };
    await expect(call(agent, "validate_agent_candidate", valid)).resolves.toBeDefined();
    await expect(call(agent, "validate_agent_candidate", { pageEpoch: "epoch-1", members: [{ ...valid.members[0], unexpected: true }] })).rejects.toThrow("exactly one supported shape");
    await expect(call(agent, "prepare_scenario", { pageEpoch: "epoch-1", members: [valid.members[0], valid.members[0]] })).rejects.toThrow("unique");
  });
});
