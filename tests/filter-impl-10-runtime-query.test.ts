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
import { createFilter, createTypedFilterValue } from "../src/core/filter-algebra";
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
  signal?: AbortSignal;
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

async function waitForReady(
  runtime: ReturnType<typeof createWorkbenchRuntime>,
  predicate: (investigation: InvestigationProjection) => boolean = () => true
): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const investigation = projection(runtime);
    if (investigation.queryState === "ready" && !runtime.getPerformanceDiagnostics?.().evidenceQueryPending && predicate(investigation)) return;
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
      filter: createFilter(),
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

  it("does not resurrect the prior interval or selection when Clear is followed by query failure", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-clear-query-failure" });
    const query = queryFor(ready(snapshot(1, "before-clear")), failure("new interval unavailable"));
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);
    await flush();
    runtime.dispatch({ type: "select-evidence", eventId: "before-clear" });
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStorage();

    expect(projection(runtime)).toMatchObject({ queryState: "error", page: { evidence: [] }, counts: { shown: 0, matching: 0, inScope: 0 }, readPoint: null });
    expect(runtime.getSnapshot().selectionEventId).toBeNull();
    expect(runtime.getSnapshot().selectedEvidence).toBeNull();
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

  it("aborts superseded Filter work while retaining generation-safe publication", async () => {
    const history = createInMemoryEventHistory({ panelSessionId: "runtime-query-cancel" });
    const pending: Array<{ request: InvestigationRequest; resolve: (result: InvestigationResult) => void }> = [];
    const query: InvestigationQuery = {
      query: vi.fn((request) => new Promise<InvestigationResult>((resolve) => pending.push({ request, resolve })))
    };
    const runtime = createWorkbenchRuntime({ history, evidenceQuery: query } as never);
    await flush();
    runtime.dispatch({ type: "refresh-evidence" });
    await flush();

    expect(pending).toHaveLength(2);
    expect(pending[0]?.request.signal?.aborted).toBe(true);
    pending[1]?.resolve(ready(snapshot(2, "newest-event")));
    await flush();
    expect(projection(runtime).page.evidence[0]?.identity.eventId).toBe("newest-event");
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
    await Promise.all([
      waitForReady(memoryRuntime, ({ find }) => find?.current !== null && find?.current !== undefined),
      waitForReady(durableRuntime, ({ find }) => find?.current !== null && find?.current !== undefined)
    ]);
    expect(projection(memoryRuntime).find?.current).toMatchObject({ eventId: "alpha-1" });
    expect(projection(durableRuntime).find?.current).toMatchObject({ eventId: "alpha-1" });
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));
    expect(projection(durableRuntime).find?.total).toBe(2);

    const itemValue = createTypedFilterValue("item", "structural-item", JSON.stringify(["orders", null]), "orders");
    memoryRuntime.dispatch({ type: "apply-filter-mutations", expectedRevision: Number(projection(memoryRuntime).filter.revision), operations: [{ type: "add-criterion", facet: "item", value: itemValue }] });
    durableRuntime.dispatch({ type: "apply-filter-mutations", expectedRevision: Number(projection(durableRuntime).filter.revision), operations: [{ type: "add-criterion", facet: "item", value: itemValue }] });
    await flushStorage();
    await Promise.all([waitForReady(memoryRuntime), waitForReady(durableRuntime)]);
    expect(runtimeFacts(durableRuntime)).toEqual(runtimeFacts(memoryRuntime));

    memoryRuntime.dispose();
    durableRuntime.dispose();
    await Promise.all([memory.close(), durable.close()]);
  });

  it("reuses one IndexedDB cursor page size across multi-page Frozen navigation", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const panelSessionId = `runtime-cursor-size-${Date.now()}`;
    const memory = createInMemoryEventHistory({ panelSessionId: `${panelSessionId}-memory` });
    const durable = await createIndexedDbEventHistory({ panelSessionId: `${panelSessionId}-durable` });
    for (let index = 1; index <= 125; index += 1) {
      const candidate = event(`cursor-${index}`);
      await memory.offer(candidate).settled;
      await durable.offer(candidate).settled;
    }
    const runtime = createWorkbenchRuntime({ history: durable, windowSize: 60 });
    await flushStorage();
    await waitForReady(runtime);
    runtime.dispatch({ type: "show-older-evidence" });
    await flushStorage();
    await waitForReady(runtime);
    expect(projection(runtime)).toMatchObject({ queryState: "ready", counts: { matching: 125, inScope: 125 } });
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `cursor-${index + 6}`)
    );
    runtime.dispose();
    await Promise.all([memory.close(), durable.close()]);
  });

  it("copies the complete persisted payload through the canonical query", async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const history = await createIndexedDbEventHistory({ panelSessionId: `runtime-copy-payload-${Date.now()}` });
    await history.offer(event("copy-payload")).settled;
    const runtime = createWorkbenchRuntime({ history });
    await flushStorage();
    await waitForReady(runtime);
    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    for (let attempt = 0; attempt < 1_000 && runtime.getSnapshot().evidenceCopy.state !== "ready"; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("ready");
    const copy = JSON.parse(runtime.getSnapshot().evidenceCopy.text ?? "null") as { events: Array<{ update?: unknown }> };
    expect(copy.events[0]?.update).toEqual({ fields: { value: "copy-payload" } });
    runtime.dispose();
    await history.close();
  });

  it("publishes LIMITED investigation coverage after a terminal history boundary", async () => {
    const history = createInMemoryEventHistory({
      panelSessionId: `runtime-terminal-coverage-${Date.now()}`,
      capacity: { maxRetainedCount: 1 }
    });
    await history.offer(event("terminal-first")).settled;
    const runtime = createWorkbenchRuntime({ history });
    await flushStorage();
    await waitForReady(runtime);
    await history.offer(event("terminal-rejected")).settled;
    await flushStorage();
    await waitForReady(runtime);
    expect(runtime.getSnapshot().capture).toMatchObject({ operation: "STOPPED", coverage: "LIMITED" });
    expect(projection(runtime)).toMatchObject({ queryState: "ready" });
    expect((runtime.getSnapshot().evidence.investigation as { coverage: string }).coverage).toBe("LIMITED");
    runtime.dispose();
    await history.close();
  });
});
