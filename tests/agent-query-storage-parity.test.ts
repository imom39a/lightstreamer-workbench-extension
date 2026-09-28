import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryEventHistoryForTests, type EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createFilter } from "../src/core/filter-algebra";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createEvidenceInvestigationQuery } from "../src/extension/panel/evidence-investigation-query";
import type { AgentQueryInput, AgentRuntime } from "../src/extension/panel/agent-runtime";

const histories: EventHistory[] = [];
function itemUpdate(id: string, timestamp: number, key: string): LightstreamerEventEnvelope {
  return {
    id, timestamp, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client-parity", sessionId: "session-parity" }, subscription: { id: "sub-parity", mode: "MERGE", items: ["rows"], fields: ["key", "value"] },
    item: { name: "rows", position: 1 }, update: { isSnapshot: false, fields: { key, value: timestamp } }
  };
}
afterEach(async () => {
  await Promise.all(histories.splice(0).map(async history => { await history.close(); }));
});

async function createService(history: EventHistory) {
  const investigation = createEvidenceInvestigationQuery({ query: request => history.query!(request) });
  const runtime = {
    status: () => ({}),
    query: async (input: AgentQueryInput) => {
      const result = await investigation.query({
        at: input.at, scope: { kind: "PAGE" }, filter: input.filter ?? createFilter(),
        page: { order: input.order ?? "OLDEST_FIRST", size: input.size, ...(input.cursor ? { cursor: input.cursor } : {}) },
        discover: input.discover ?? [], includePayload: input.includePayload, signal: input.signal
      });
      if (!result.ok) throw new Error(result.problem.message);
      return result.value;
    }
  } as unknown as AgentRuntime;
  const service = createAgentService(runtime, "parity-panel", () => "read");
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "parity-panel", ...args }) as Promise<any>;
  return call;
}

describe("MCP Evidence query storage parity", () => {
  it("returns matching discovery, typed filtered pages and stable cursor continuation from memory and IndexedDB", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const panelSessionId = `agent-query-parity-${Date.now()}`;
    const memory = await createMemoryEventHistoryForTests({ panelSessionId });
    const indexedDb = await createIndexedDbEventHistory({ panelSessionId });
    histories.push(memory, indexedDb);
    const events = [itemUpdate("event-a", 100, "row-a"), itemUpdate("event-b", 200, "row-b"), itemUpdate("event-c", 300, "row-c"), itemUpdate("event-d", 400, "row-d"), itemUpdate("event-e", 500, "row-e")];
    for (const event of events) {
      await memory.offer(event).settled;
      await indexedDb.offer(event).settled;
    }
    const memoryCall = await createService(memory);
    const indexedDbCall = await createService(indexedDb);

    const memoryDiscovery = await memoryCall("query_evidence", { limit: 1, discover: [{ facet: "kind", limit: 10 }] });
    const indexedDbDiscovery = await indexedDbCall("query_evidence", { limit: 1, discover: [{ facet: "kind", limit: 10 }] });
    expect(indexedDbDiscovery.readPoint).toEqual(memoryDiscovery.readPoint);
    expect(indexedDbDiscovery.discoveries.kind).toEqual(memoryDiscovery.discoveries.kind);
    const itemKind = memoryDiscovery.discoveries.kind.values.find((entry: any) => entry.value.facet === "kind" && entry.value.type === "enum");
    expect(itemKind).toBeDefined();

    const request = { at: memoryDiscovery.readPoint, filter: { criteria: [{ facet: "kind", polarity: "include", type: itemKind.value.type, value: itemKind.value.value, label: itemKind.value.label }] }, order: "OLDEST_FIRST", limit: 2 };
    const memoryFirst = await memoryCall("query_evidence", request);
    const indexedDbFirst = await indexedDbCall("query_evidence", { ...request, at: indexedDbDiscovery.readPoint });
    expect(indexedDbFirst.readPoint).toEqual(memoryFirst.readPoint);
    expect(indexedDbFirst.totals).toEqual(memoryFirst.totals);
    expect(indexedDbFirst.evidence.map((record: any) => record.identity)).toEqual(memoryFirst.evidence.map((record: any) => record.identity));
    expect(memoryFirst.nextCursor).toBeTruthy();

    const [memorySecond, indexedDbSecond] = await Promise.all([
      memoryCall("query_evidence", { cursor: memoryFirst.nextCursor }),
      indexedDbCall("query_evidence", { cursor: indexedDbFirst.nextCursor })
    ]);
    expect(indexedDbSecond.readPoint).toEqual(memorySecond.readPoint);
    expect(indexedDbSecond.evidence.map((record: any) => record.identity)).toEqual(memorySecond.evidence.map((record: any) => record.identity));
    const [memoryThird, indexedDbThird] = await Promise.all([
      memoryCall("query_evidence", { cursor: memorySecond.nextCursor }),
      indexedDbCall("query_evidence", { cursor: indexedDbSecond.nextCursor })
    ]);
    expect(indexedDbThird.readPoint).toEqual(memoryThird.readPoint);
    expect(indexedDbThird.evidence.map((record: any) => record.identity)).toEqual(memoryThird.evidence.map((record: any) => record.identity));
    expect([...memoryFirst.evidence, ...memorySecond.evidence, ...memoryThird.evidence].map((record: any) => record.identity.eventId)).toEqual(events.map(event => event.id));
    expect([...indexedDbFirst.evidence, ...indexedDbSecond.evidence, ...indexedDbThird.evidence].map((record: any) => record.identity.eventId)).toEqual(events.map(event => event.id));
  });
});
