import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { agentToolResultBytes } from "../src/agent/tool-result";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createEvidenceInvestigationQuery } from "../src/extension/panel/evidence-investigation-query";
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
const proof = process.env.LSEW_AGENT_HISTORY_PROOF === "1" ? describe : describe.skip;
const event = (index: number): LightstreamerEventEnvelope => ({ id: `maximum-${index}`, timestamp: index, direction: "inbound", source: "server", synthetic: false, kind: "item-update", client: { id: "client", sessionId: `session-${index % 10}` }, subscription: { id: index % 2 ? "other" : "target", mode: "COMMAND", fields: ["key", "command", "quantity"] }, item: { name: "rows", position: 1 }, update: { isSnapshot: false, key: index % 1000 === 0 ? "RARE" : "common", command: "ADD", fields: { key: index % 1000 === 0 ? "RARE" : "common", command: "ADD", quantity: String(index) } } });
proof.each(["memory", "indexeddb", "volatile"] as const)("maximum retained-history work (%s)", tier => {
  it("measures actual Scope adapter selective/continued/suffix work and explicit aggregate/cancellation limits", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
    const count = tier === "volatile" ? 25000 : 100000;
    const options = { panelSessionId: `maximum-agent-${tier}`, capacityTier: tier === "volatile" ? "LOWER" as const : "NORMAL" as const,
      ...(tier === "volatile" ? { commitBatch: async () => { throw new Error("unavailable journal"); } } : {}) };
    const history = tier === "memory" ? await createMemoryEventHistoryForTests(options) : await createIndexedDbEventHistory(options);
    const started = Date.now();
    try {
      for (let start = 0; start < count; start += 256) await Promise.all(Array.from({ length: Math.min(256, count - start) }, (_, offset) => history.offer(event(start + offset)).settled));
      expect(history.status().retained).toBe(count);
      const adapter = createEvidenceInvestigationQuery({ query: request => history.query!(request) });
      const filter = { ...createFilter(), criteria: { key: { include: [createTypedFilterValue("key", "string", "RARE")], exclude: [] } } };
      const request = { at: "LATEST_COMMITTED" as const, scope: { kind: "ITEM" as const, clientId: "client", sessionId: "session-0", subscriptionId: "target", item: "rows", itemPosition: 1 }, filter, page: { order: "OLDEST_FIRST" as const, size: 2 }, discover: [] };
      const readStarted = Date.now();
      const first = await adapter.query(request); if (!first.ok) throw new Error(first.problem.message);
      const next = await adapter.query({ ...request, at: first.value.readPoint, page: { ...request.page, cursor: first.value.page.nextCursor! } }); if (!next.ok) throw new Error(next.problem.message);
      expect(first.value.totals.matching).toBe(count / 1000);
      expect(first.value.telemetry?.projectionReads).toBeLessThanOrEqual(count / 1000 + 1);
      expect(next.value.telemetry?.projectionReads).toBeLessThanOrEqual(count / 1000 + 1);
      expect(first.value.telemetry?.payloadHydrations).toBe(0);
      const suffix = await adapter.query({ ...request, scope: { kind: "PAGE" }, filter: createFilter(), sequenceWindow: { after: count - 10, through: count }, page: { order: "OLDEST_FIRST", size: 10 } }); if (!suffix.ok) throw new Error(suffix.problem.message);
      expect(suffix.value.totals.matching).toBe(10);
      expect(suffix.value.telemetry?.projectionReads).toBeLessThanOrEqual(10);
      expect(await adapter.query({ ...request, aggregate: { unit: "evidence-records", groupBy: ["quantity"], maxGroups: 5 }, workBudget: { maxPayloadHydrations: 5 } })).toMatchObject({ ok: false, problem: { code: "QUERY_WORK_BUDGET_EXCEEDED" } });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 0);
      expect(await adapter.query({ ...request, scope: { kind: "PAGE" }, filter: { ...createFilter(), text: "xx" }, signal: controller.signal })).toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
      let serviceStorageCalls = 0;
      const runtime = {
        status: () => ({ pageEpoch: "epoch" }),
        queryBoundary: () => ({ scope: request.scope, filter }),
        query: async (input: Parameters<AgentRuntime["query"]>[0]) => {
          serviceStorageCalls++;
          const result = await adapter.query({ at: input.at, scope: input.scope ?? request.scope, filter: input.filter ?? filter,
            page: { order: input.order ?? "NEWEST_FIRST", size: input.size, adaptiveSize: input.adaptivePage, cursor: input.cursor },
            discover: input.discover ?? [], includePayload: input.includePayload, signal: input.signal, workBudget: input.workBudget, sequenceWindow: input.sequenceWindow });
          if (!result.ok) throw new Error(`${result.problem.code}: ${result.problem.message}`);
          return result.value;
        }
      } as unknown as AgentRuntime;
      const service = createAgentService(runtime, "maximum-panel", () => "read");
      const publicPage = await service.call("query_evidence", { panelSessionId: "maximum-panel", scopeId: "target", where: { key: ["RARE"] }, limit: 100, fields: ["quantity"], maxBytes: 8192 }) as { nextCursor: string | null; evidence: unknown[]; totals: { matching: number } };
      expect(serviceStorageCalls).toBe(1);
      expect(publicPage.totals.matching).toBe(count / 1000);
      expect(publicPage.evidence.length).toBeGreaterThan(0);
      expect(agentToolResultBytes(publicPage)).toBeLessThanOrEqual(8192);
      const publicNext = await service.call("query_evidence", { panelSessionId: "maximum-panel", cursor: publicPage.nextCursor }) as { evidence: unknown[] };
      expect(serviceStorageCalls).toBe(2);
      expect(agentToolResultBytes(publicNext)).toBeLessThanOrEqual(8192);
      const measurements = { environment: "Node/fake-indexeddb, not loaded Chrome latency", tier, retained: count, populateMs: readStarted - started,
        queryChecksMs: Date.now() - readStarted, firstProjectionReads: first.value.telemetry?.projectionReads, continuedProjectionReads: next.value.telemetry?.projectionReads,
        suffixProjectionReads: suffix.value.telemetry?.projectionReads, payloadHydrations: first.value.telemetry?.payloadHydrations,
        canonicalSnapshotBytes: new TextEncoder().encode(JSON.stringify(first.value)).byteLength,
        serializedMcpResultBytes: agentToolResultBytes(publicPage), publicReturned: publicPage.evidence.length,
        publicContinuationReturned: publicNext.evidence.length, serviceStorageCalls };
      const output = resolve(process.cwd(), ".scratch/mcp-agent-audit/evidence");
      await mkdir(output, { recursive: true });
      await writeFile(resolve(output, `maximum-history-${tier}.json`), JSON.stringify(measurements, null, 2));
      console.info(JSON.stringify(measurements));
    } finally { await history.close(); vi.unstubAllGlobals(); }
  }, 300000);
});
