import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { agentToolResultBytes } from "../src/agent/tool-result";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

function item(id: number, key: string): LightstreamerEventEnvelope {
  return { id: `item-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "sub-1", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener-1" }, item: { name: "rows", position: 1 },
    update: { command: "ADD", key, isSnapshot: false, fields: { command: "ADD", key, qty: id, password: "secret", details: '{"password":"nested-secret","note":"safe"}' }, fieldValueStates: { password: "redacted" } } };
}
async function fixture(events: LightstreamerEventEnvelope[]) {
  const history = createInMemoryEventHistory({ panelSessionId: `compact-query-${crypto.randomUUID()}` });
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
  runtimes.push(runtime);
  const outcomes = await Promise.all(events.map(event => history.offer(event).settled));
  expect(outcomes.every(outcome => outcome.outcome === "BECAME_EVIDENCE")).toBe(true);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  return createAgentService(runtime.agent!, "panel", () => "read");
}

describe("compact public agent reads", () => {
  it("filters retained Evidence by simple facets and projects requested safe fields", async () => {
    const service = await fixture([item(1, "row-a"), item(2, "row-b")]);
    const result = await service.call("query_evidence", { panelSessionId: "panel", within: "page", where: { kind: ["item-update"], key: ["row-a"] }, fields: ["qty", "password", "details"] }) as any;
    expect(result.totals.matching).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].key).toBe("row-a");
    expect(result.evidence[0].fields.qty).toEqual({ state: "concrete", value: 1 });
    expect(result.evidence[0].fields.password).toEqual({ state: "redacted" });
    expect(JSON.stringify(result)).not.toContain("nested-secret");
    expect(result.evidence[0].payload).toBeUndefined();
    expect(result.evidence[0].facets).toBeUndefined();
  });
  it("pages every matching record within the whole MCP result budget and counts distinct keys", async () => {
    const service = await fixture(Array.from({ length: 40 }, (_, index) => item(index + 1, `row-${index % 3}`)));
    const call = (name: string, args: Record<string, unknown>) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
    const keys: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await call("query_evidence", cursor ? { cursor } : { within: "page", limit: 40, maxBytes: 4096 });
      expect(agentToolResultBytes(page)).toBeLessThanOrEqual(4096);
      keys.push(...page.evidence.map((entry: any) => entry.identity.eventId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(keys).toEqual(Array.from({ length: 40 }, (_, index) => `item-${index + 1}`));
    const summary = await call("summarize_evidence", { within: "page", facet: "key" });
    expect(summary.totals.matching).toBe(40);
    expect(summary.distinctTotal).toBe(3);
    expect(summary.values.map((entry: any) => entry.count).sort()).toEqual([13, 13, 14]);
    const narrowed = await call("summarize_evidence", { within: "page", where: { key: ["row-1"] }, facet: "key" });
    expect(narrowed.totals.matching).toBe(13);
    expect(narrowed.distinctTotal).toBe(1);
    expect(narrowed.values).toMatchObject([{ value: { value: "row-1" }, count: 13 }]);
  });
  it("shrinks a later page without losing its cursor anchor or any Evidence", async () => {
    const service = await fixture(Array.from({ length: 24 }, (_, index) => item(index + 1, index < 8 ? `k${index}` : `long-${index}-${"x".repeat(1000)}`)));
    const seen: string[] = [];
    const pageSizes: number[] = [];
    const hadMore: boolean[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.call("query_evidence", { panelSessionId: "panel", ...(cursor ? { cursor } : { within: "page", limit: 24, maxBytes: 8192 }) }) as any;
      expect(agentToolResultBytes(page)).toBeLessThanOrEqual(8192);
      seen.push(...page.evidence.map((entry: any) => entry.identity.eventId));
      pageSizes.push(page.evidence.length);
      hadMore.push(Boolean(page.nextCursor));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 24 }, (_, index) => `item-${index + 1}`));
    expect(pageSizes.some((size, index) => index > 0 && hadMore[index] && size < pageSizes[0]!)).toBe(true);
  });
  it("freezes the human Filter for current-investigation reads and rejects overrides", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: `compact-current-${crypto.randomUUID()}` });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    runtimes.push(runtime);
    await Promise.all([item(1, "row-a"), item(2, "row-b")].map(event => history.offer(event).settled));
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "row-a" }] });
    const service = createAgentService(runtime.agent!, "panel", () => "read");
    const call = (name: string, args: Record<string, unknown>) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
    const before = runtime.getSnapshot().evidence.investigation.filter;
    const result = await call("query_evidence", { within: "current-investigation" });
    expect(result.totals.matching).toBe(1);
    expect(result.evidence[0].key).toBe("row-a");
    const searched = await call("search_evidence", { within: "current-investigation", text: "row" });
    expect(searched.total).toBe(1);
    await expect(call("query_evidence", { within: "current-investigation", where: { key: ["row-b"] } })).rejects.toThrow("human Filter");
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before);
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: before.revision, operations: [{ type: "add-unsupported", criterion: { id: "unknown-field", reason: "UNSUPPORTED_FACET" } }] });
    await expect(call("query_evidence", { within: "current-investigation" })).rejects.toThrow("UNSUPPORTED_FILTER");
    await expect(call("summarize_evidence", { within: "current-investigation", facet: "key" })).rejects.toThrow("UNSUPPORTED_FILTER");
  });
});
