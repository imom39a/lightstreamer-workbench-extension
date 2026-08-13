import { describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  type DeterministicEvidenceRecord,
  type EvidenceFilterReadProblem,
  type EvidenceIdentity,
  type EvidenceSnapshot,
  type FacetDiscoveryResult
} from "../src/core/evidence-filter-contract";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { canonicalFilterFromLegacyScalars } from "../src/core/filter-algebra";
import { toEvidenceQueryRequest } from "../src/extension/panel/evidence-investigation-query";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

type InvestigationRequest = Readonly<{
  at: "LATEST_COMMITTED" | unknown;
  scope: Readonly<Record<string, unknown>>;
  filter: Readonly<Record<string, unknown>>;
  page: Readonly<{ order: "NEWEST_FIRST" | "OLDEST_FIRST"; size: number; cursor?: string }>;
  discover: readonly Readonly<Record<string, unknown>>[];
  lookup?: EvidenceIdentity;
  find?: Readonly<{ text: string; current?: EvidenceIdentity; scopeToFilter?: boolean }>;
}>;

type InvestigationResult =
  | Readonly<{ ok: true; value: EvidenceSnapshot }>
  | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>;

type InvestigationQuery = {
  query: ReturnType<typeof vi.fn<(request: InvestigationRequest) => Promise<InvestigationResult>>>;
};

type InvestigationProjection = Readonly<{
  scope: Readonly<Record<string, unknown>>;
  filter: Readonly<Record<string, unknown>>;
  readPoint: EvidenceSnapshot["readPoint"];
  page: EvidenceSnapshot["page"];
  counts: Readonly<{ shown: number; matching: number; inScope: number }>;
  discoveries: ReadonlyMap<string, FacetDiscoveryResult>;
  lookup: EvidenceSnapshot["lookup"];
  find: EvidenceSnapshot["find"];
  queryState: "ready" | "loading" | "error";
}>;

function event(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_780_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: "orders", position: 1 },
    update: { fields: { value: id } }
  };
}

function identity(sequence: number, eventId: string, intervalId = "runtime:interval-1"): EvidenceIdentity {
  return Object.freeze({
    intervalId,
    pageId: intervalId,
    ownerId: "memory-event-history",
    sequence,
    eventId
  });
}

function record(sequence: number, eventId: string, intervalId = "runtime:interval-1"): DeterministicEvidenceRecord {
  const evidence = event(eventId);
  const evidenceIdentity = identity(sequence, eventId, intervalId);
  return Object.freeze({
    identity: evidenceIdentity,
    timestamp: evidence.timestamp,
    summary: evidence.kind,
    searchText: `${eventId} item update orders`.toLowerCase(),
    facets: Object.freeze({}),
    payload: evidence
  });
}

function snapshot(
  sequence: number,
  eventId: string,
  options: Readonly<{
    discovery?: FacetDiscoveryResult;
    find?: EvidenceSnapshot["find"];
  }> = {}
): EvidenceSnapshot {
  const current = record(sequence, eventId);
  const readPoint = Object.freeze({
    interval: Object.freeze({ id: current.identity.intervalId, ordinal: 1 }),
    committedEvidenceBoundary: current.identity,
    retainedRange: Object.freeze({ first: current.identity, last: current.identity })
  });
  return Object.freeze({
    readPoint,
    page: Object.freeze({ evidence: Object.freeze([current]), nextCursor: null }),
    totals: Object.freeze({ matching: 1, inScope: 1 }),
    discoveries: new Map(options.discovery ? [[options.discovery.facet, options.discovery]] : []),
    lookup: null,
    find: options.find ?? null,
    evaluation: "COMPLETE",
    coverage: "COMPLETE",
    storage: "MEMORY_FALLBACK"
  });
}

function ready(value: EvidenceSnapshot): InvestigationResult {
  return { ok: true, value };
}

function failure(message: string): InvestigationResult {
  return {
    ok: false,
    problem: { code: "QUERY_FAILED", message }
  };
}

function projection(runtime: ReturnType<typeof createWorkbenchRuntime>): InvestigationProjection {
  return (runtime.getSnapshot().evidence as unknown as { investigation: InvestigationProjection }).investigation;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushStorage(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitForReady(runtime: ReturnType<typeof createWorkbenchRuntime>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (projection(runtime).queryState === "ready" && !runtime.getPerformanceDiagnostics?.().evidenceQueryPending) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("WorkbenchRuntime did not publish a ready investigation snapshot.");
}

function queryFor(...results: InvestigationResult[]): InvestigationQuery {
  let index = 0;
  return {
    query: vi.fn(async () => results[Math.min(index++, results.length - 1)] ?? failure("No test result configured."))
  };
}

function runtimeFacts(runtime: ReturnType<typeof createWorkbenchRuntime>): unknown {
  const investigation = projection(runtime);
  return {
    scope: investigation.scope,
    filter: investigation.filter,
    readPoint: investigation.readPoint,
    page: investigation.page.evidence.map((record) => record.identity),
    counts: investigation.counts,
    lookup: investigation.lookup?.state ?? null,
    find: investigation.find
      ? {
          text: investigation.find.text,
          total: investigation.find.total,
          current: investigation.find.current,
          previous: investigation.find.previous,
          next: investigation.find.next,
          first: investigation.find.first,
          matches: investigation.find.matches,
          window: investigation.find.window?.map((record) => record.identity),
          nextWindow: investigation.find.nextWindow?.map((record) => record.identity)
        }
      : null,
    queryState: investigation.queryState
  };
}

describe("filter-impl-10 WorkbenchRuntime investigation query", () => {
  it("keeps structural Item Scope position when the canonical Filter names the same item", () => {
    const request = toEvidenceQueryRequest({
      at: "LATEST_COMMITTED",
      scope: {
        kind: "ITEM",
        clientId: "client-1",
        sessionId: "session-1",
        subscriptionId: "subscription-1",
        item: "orders",
        itemPosition: 2
      },
      filter: canonicalFilterFromLegacyScalars({ item: "orders" }),
      page: { order: "NEWEST_FIRST", size: 60 },
      discover: []
    });
    const item = request.filter.criteria.item?.include[0];
    expect(item).toMatchObject({ facet: "item", type: "structural-item", label: "orders" });
    expect(JSON.parse(item?.value ?? "null")).toEqual(["orders", 2]);
  });

  it("publishes one bounded canonical request and one coherent read point", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-query-contract" });
    const query = queryFor(ready(snapshot(1, "query-event-1")));
    const read = vi.spyOn(history, "read");
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);

    await flush();

    expect(query.query).toHaveBeenCalledTimes(1);
    expect(query.query).toHaveBeenCalledWith(expect.objectContaining({
      at: "LATEST_COMMITTED",
      scope: expect.objectContaining({ kind: "PAGE" }),
      filter: expect.objectContaining({ version: 1, revision: 1 }),
      page: { order: "NEWEST_FIRST", size: 60 },
      discover: []
    }));
    expect(read).not.toHaveBeenCalled();
    expect(projection(runtime)).toMatchObject({
      counts: { shown: 1, matching: 1, inScope: 1 },
      readPoint: { committedEvidenceBoundary: { eventId: "query-event-1" } },
      page: { evidence: [{ identity: { eventId: "query-event-1" } }] },
      queryState: "ready"
    });
    runtime.dispose();
  });

  it("retains the last coherent page and boundary when the next base query fails", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-query-failure" });
    const query = queryFor(
      ready(snapshot(1, "coherent-event")),
      failure("base query unavailable")
    );
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);
    await flush();
    const before = projection(runtime);

    runtime.dispatch({ type: "refresh-evidence" });
    await flush();

    expect(projection(runtime)).toMatchObject({
      page: before.page,
      counts: before.counts,
      readPoint: before.readPoint,
      queryState: "error"
    });
    expect(runtime.getSnapshot().evidence.events).not.toEqual([]);
    expect(runtime.getSnapshot().evidence.total).toBe(1);
    runtime.dispose();
  });

  it("keeps usable Evidence when optional discovery is unavailable", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-discovery-isolation" });
    const discovery: FacetDiscoveryResult = {
      state: "UNAVAILABLE",
      facet: "key",
      reason: "DISCOVERY_FAILED",
      values: [],
      distinctTotal: null,
      nextCursor: null,
      baseEvidenceCount: null
    };
    const query = queryFor(ready(snapshot(1, "discovery-event", { discovery })));
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);
    await flush();

    expect(projection(runtime)).toMatchObject({
      page: { evidence: [{ identity: { eventId: "discovery-event" } }] },
      counts: { matching: 1, inScope: 1 },
      queryState: "ready"
    });
    expect(projection(runtime).discoveries.get("key")).toMatchObject({
      state: "UNAVAILABLE",
      reason: "DISCOVERY_FAILED"
    });
    runtime.dispose();
  });

  it("rejects an older generation without producing a hybrid snapshot", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-query-generations" });
    const pending: Array<(result: InvestigationResult) => void> = [];
    const query: InvestigationQuery = {
      query: vi.fn(() => new Promise<InvestigationResult>((resolve) => pending.push(resolve)))
    };
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);
    runtime.dispatch({ type: "refresh-evidence" });
    await flush();
    expect(pending).toHaveLength(2);

    pending[1]?.(ready(snapshot(2, "newer-event")));
    await flush();
    pending[0]?.(ready(snapshot(1, "older-event")));
    await flush();

    expect(projection(runtime)).toMatchObject({
      page: { evidence: [{ identity: { eventId: "newer-event" } }] },
      readPoint: { committedEvidenceBoundary: { eventId: "newer-event" } },
      counts: { shown: 1, matching: 1, inScope: 1 }
    });
    runtime.dispose();
  });

  it("keeps the runtime investigation facts equivalent across memory and IndexedDB", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const panelSessionId = `runtime-storage-parity-${Date.now()}`;
    const memory = createInMemoryEventHistory({ panelSessionId });
    const durable = await createIndexedDbEventHistory({ panelSessionId });
    for (const [index, eventId] of ["alpha-1", "beta-2", "alpha-3", "gamma-4"].entries()) {
      const candidate = event(eventId);
      const withValue = Object.freeze({
        ...candidate,
        timestamp: 1_780_000_000_000 + index,
        update: { fields: { value: eventId } }
      });
      await memory.offer(withValue).settled;
      await durable.offer(withValue).settled;
    }
    const memoryRuntime = createWorkbenchRuntime({ history: memory, windowSize: 2 });
    const durableRuntime = createWorkbenchRuntime({ history: durable, windowSize: 2 });
    await flushStorage();
    await Promise.all([waitForReady(memoryRuntime), waitForReady(durableRuntime)]);
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));

    memoryRuntime.dispatch({ type: "select-evidence", eventId: "alpha-3" });
    durableRuntime.dispatch({ type: "select-evidence", eventId: "alpha-3" });
    await flushStorage();
    await Promise.all([waitForReady(memoryRuntime), waitForReady(durableRuntime)]);
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));

    memoryRuntime.dispatch({ type: "set-find", value: "alpha" });
    durableRuntime.dispatch({ type: "set-find", value: "alpha" });
    await flushStorage();
    await Promise.all([waitForReady(memoryRuntime), waitForReady(durableRuntime)]);
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));
    expect(projection(durableRuntime).find?.total).toBe(2);

    memoryRuntime.dispatch({ type: "set-filters", filters: { item: "orders" } });
    durableRuntime.dispatch({ type: "set-filters", filters: { item: "orders" } });
    await flushStorage();
    await Promise.all([waitForReady(memoryRuntime), waitForReady(durableRuntime)]);
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));

    memoryRuntime.dispose();
    durableRuntime.dispose();
    await Promise.all([memory.close(), durable.close()]);
  });
});
