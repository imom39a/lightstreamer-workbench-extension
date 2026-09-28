import { test, expect, vi } from "vitest";
import { createInMemoryEventHistory, type HistoryCapacityOverrides } from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";

async function setup(count: number, adapter: string, capacity?: HistoryCapacityOverrides) {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  const history = adapter === "memory"
    ? createInMemoryEventHistory({ panelSessionId: "find-investigation", capacity })
    : await createIndexedDbEventHistory({ panelSessionId: `find-investigation-${adapter}`, capacity });
  const events = Array.from({ length: count }, (_, index): LightstreamerEventEnvelope => ({
    id: `marker-${String(index + 1).padStart(6, "0")}`,
    timestamp: index + 1, direction: "inbound", source: "server", synthetic: false, kind: "item-update",
    client: { id: "client", sessionId: "session" }, subscription: { id: "subscription", mode: "MERGE" },
    item: { name: "orders", position: 1 },
    update: { fields: { value: "all-find-needle", category: index % 2 === 0 ? "keep-category" : "hide-category" } }
  }));
  await Promise.all(events.map(event => history.offer(event).settled));
  const runtime = createWorkbenchRuntime({ history, windowSize: 60 });
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  return { history, runtime, events };
}

test.each(["memory", "indexeddb"])("%s: Next reaches match 1001 when more than 1000 match", async adapter => {
  const { history, runtime } = await setup(1002, adapter);
  try {
    runtime.dispatch({ type: "set-find", value: "marker-001000" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("marker-001000"));
    runtime.dispatch({ type: "set-find", value: "all-find-needle" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.matchCount).toBe(1002));
    runtime.dispatch({ type: "find-next" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ currentEventId: "marker-001001", currentIndex: 1000 });
    runtime.dispatch({ type: "find-next" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ currentEventId: "marker-001002", currentIndex: 1001 });
    runtime.dispatch({ type: "find-next" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ currentEventId: "marker-000001", currentIndex: 0, wrapped: "next" });
    runtime.dispatch({ type: "find-previous" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ currentEventId: "marker-001002", currentIndex: 1001, wrapped: "previous" });
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: An off-page Find window respects the applied text Filter", async adapter => {
  const { history, runtime } = await setup(200, adapter);
  try {
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: filter.revision, operations: [{ type: "set-text", text: "keep-category" }] });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    runtime.dispatch({ type: "set-find", value: "marker-000005" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("marker-000005"));
    const snapshot = runtime.getSnapshot();
    const excluded = snapshot.evidence.events.filter(event => Number(event.id.split("-")[1]) % 2 === 0);
    expect(excluded).toHaveLength(0);
    expect(snapshot.evidence.visibleStart).toBe(1);
    expect(snapshot.evidence.visibleEnd).toBe(60);
    expect(snapshot.evidence.offset).toBe(40);
    expect(snapshot.evidence.total).toBe(100);
    expect(snapshot.evidence.investigation.page.nextCursor).toBeNull();
  } finally { runtime.dispose(); await history.close(); }
});

async function settled(runtime: ReturnType<typeof createWorkbenchRuntime>) {
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.loading).toBe(false));
  expect(runtime.getSnapshot().evidence.investigation.problem).toBeNull();
}

test.each(["memory", "indexeddb"])("%s: Find preserves its read point, selection and original page until explicit refresh/close", async adapter => {
  const { history, runtime, events } = await setup(200, adapter);
  try {
    runtime.dispatch({ type: "select-evidence", eventId: events[199]!.id });
    runtime.dispatch({ type: "open-context" });
    await settled(runtime);
    runtime.dispatch({ type: "set-find", value: "marker-000005" });
    await settled(runtime);
    const origin = runtime.getSnapshot();
    expect(origin.evidence.findState.snippet).toMatchObject({ field: "id", text: "marker-000005" });
    expect(origin.evidence.events).toHaveLength(60);
    expect(origin.evidence.events.find(event => event.id === "marker-000005")?.raw).toMatchObject({ update: { fields: { value: "all-find-needle" } } });
    const point = origin.evidence.investigation.readPoint;
    const ids = origin.evidence.events.map(event => event.id);
    await history.offer({ ...events[0]!, id: "marker-000005-new", timestamp: 201 }).settled;
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.newerCount).toBe(1));
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ matchCount: 1, currentEventId: "marker-000005", revealRevision: origin.evidence.findState.revealRevision });
    expect(runtime.getSnapshot().evidence.investigation.readPoint).toEqual(point);
    expect(runtime.getSnapshot().evidence.events.map(event => event.id)).toEqual(ids);
    expect(runtime.getSnapshot()).toMatchObject({ selectionEventId: events[199]!.id, contextId: `context:${events[199]!.id}` });
    runtime.dispatch({ type: "refresh-find" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ matchCount: 2, newerCount: 0, currentEventId: "marker-000005" });
    runtime.dispatch({ type: "inspect-find-match" });
    await settled(runtime);
    expect(runtime.getSnapshot()).toMatchObject({ selectionEventId: "marker-000005", contextId: "context:marker-000005", selectedEvidence: { raw: { update: { fields: { value: "all-find-needle" } } } } });
    runtime.dispatch({ type: "clear-find" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("marker-000005-new");
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: closing Find restores the original Frozen page and scroll", async adapter => {
  const { history, runtime, events } = await setup(200, adapter);
  try {
    runtime.dispatch({ type: "freeze-evidence" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 123 });
    const origin = runtime.getSnapshot().evidence;
    runtime.dispatch({ type: "set-find", value: events[0]!.id });
    await settled(runtime);
    await history.offer({ ...events[0]!, id: "later-capture", timestamp: 201 }).settled;
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.newerCount).toBe(1));
    runtime.dispatch({ type: "clear-find" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence).toMatchObject({ mode: "frozen", scrollTop: 123 });
    expect(runtime.getSnapshot().evidence.events.map(event => event.id)).toEqual(origin.events.map(event => event.id));
    expect(runtime.getSnapshot().evidence.investigation.readPoint).toEqual(origin.investigation.readPoint);
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: retention expiry is explicit; Refresh finds remaining Evidence and Clear resets search", async adapter => {
  const { history, runtime, events } = await setup(10, adapter, { maxRetainedCount: 10 });
  try {
    runtime.dispatch({ type: "set-find", value: events[0]!.id });
    await settled(runtime);
    await history.offer({ ...events[0]!, id: "newer-event", timestamp: 11 }).settled;
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.expired).toBe(true));
    const revision = runtime.getSnapshot().evidence.findState.revealRevision;
    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.revealRevision).toBe(revision);
    runtime.dispatch({ type: "refresh-find" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ matchCount: 0, expired: false, currentEventId: null });
    expect(runtime.getSnapshot().evidence.events.length).toBeGreaterThan(0);
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.total).toBe(0));
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ query: "marker-000001", expired: false, matchCount: 0 });
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: query-backed Find pages keep Scope, Filter, Around and truthful continuation", async adapter => {
  const { history, runtime } = await setup(240, adapter);
  try {
    const interval = history.status().interval.id;
    const filter = {
      revision: 1, text: "keep-category", criteria: { mode: { include: [{ facet: "mode", type: "enum", value: "MERGE", label: "MERGE", identity: JSON.stringify(["v1", "mode", "enum", "MERGE"]) }], exclude: [] } },
      around: { intervalId: interval, start: 41, end: 161 }, unsupported: []
    };
    const request = { at: "LATEST_COMMITTED" as const, filter, page: { size: 10, order: "NEWEST_FIRST" as const }, find: { text: "marker-000091", scopeToFilter: true } };
    const first = await history.query!(request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.find?.page?.evidence.map(record => record.identity.sequence)).toEqual([101, 99, 97, 95, 93, 91, 89, 87, 85, 83]);
    expect(first.value.find?.page?.offset).toBe(29);
    expect(first.value.totals).toEqual({ matching: 120, inScope: 60 });
    const next = await history.query!({ ...request, at: first.value.readPoint, page: { ...request.page, cursor: first.value.find!.page!.nextCursor! } });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.page.evidence.map(record => record.identity.sequence)).toEqual([81, 79, 77, 75, 73, 71, 69, 67, 65, 63]);
    expect(next.value.totals).toEqual(first.value.totals);
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: Find ordinals and matching-record continuations remain complete at 10,002 events", async adapter => {
  const { history, runtime } = await setup(10_002, adapter);
  try {
    const filter = { revision: 1, text: "", criteria: {}, around: null, unsupported: [] };
    const request = { at: "LATEST_COMMITTED" as const, filter, page: { size: 10, order: "OLDEST_FIRST" as const }, find: { text: "marker-010001", reveal: false } };
    const target = await history.query!(request);
    expect(target.ok).toBe(true);
    if (!target.ok) return;
    const broad = await history.query!({ ...request, at: target.value.readPoint, find: { text: "all-find-needle", scopeToFilter: true, current: target.value.find!.first!, after: target.value.find!.first!, size: 10, reveal: false } });
    expect(broad).toMatchObject({ ok: true, value: { find: { total: 10_002, currentIndex: 10_000, current: { eventId: "marker-010001" }, previous: { eventId: "marker-010000" }, next: { eventId: "marker-010002" }, last: { eventId: "marker-010002" }, results: [{ identity: { eventId: "marker-010002" } }], hasMore: false } } });
  } finally { runtime.dispose(); await history.close(); }
}, 30_000);

test.each(["memory", "indexeddb"])("%s: zero-match Find preserves the paged Frozen investigation and its labels", async adapter => {
  const { history, runtime } = await setup(200, adapter);
  try {
    runtime.dispatch({ type: "show-oldest-evidence" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    const origin = runtime.getSnapshot().evidence;
    expect(origin.events[0]?.id).toBe("marker-000001");
    expect(origin).toMatchObject({ visibleStart: 1, visibleEnd: 60, offset: 140 });
    runtime.dispatch({ type: "set-find", value: "no-such-value" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState.matchCount).toBe(0);
    expect(runtime.getSnapshot().evidence.events.map(event => event.id)).toEqual(origin.events.map(event => event.id));
    expect(runtime.getSnapshot().evidence).toMatchObject({ visibleStart: 1, visibleEnd: 60, offset: 140 });
  } finally { runtime.dispose(); await history.close(); }
});

test("visibility restoration does not supersede a pending Find", async () => {
  const { history, runtime } = await setup(200, "memory");
  const original = history.query!.bind(history);
  let release: (() => void) | null = null;
  vi.spyOn(history, "query").mockImplementation(request => request.find
    ? new Promise(resolve => { release = () => { void original(request).then(resolve); }; })
    : original(request));
  try {
    runtime.dispatch({ type: "set-find", value: "marker-000001" });
    await vi.waitFor(() => expect(release).not.toBeNull());
    runtime.dispatch({ type: "set-visible", visible: false });
    runtime.dispatch({ type: "set-visible", visible: true });
    (release as unknown as () => void)();
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ query: "marker-000001", matchCount: 1, currentEventId: "marker-000001", revealRevision: 1 });
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: paging out of Find uses the displayed read point and contiguous rows", async adapter => {
  const { history, runtime, events } = await setup(200, adapter);
  try {
    runtime.dispatch({ type: "freeze-evidence" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    await Promise.all(Array.from({ length: 10 }, (_, index) => history.offer({ ...events[0]!, id: `later-${index}`, timestamp: 201 + index }).settled));
    runtime.dispatch({ type: "set-find", value: "marker-000120" });
    await settled(runtime);
    const point = runtime.getSnapshot().evidence.investigation.readPoint;
    expect(runtime.getSnapshot().evidence).toMatchObject({ visibleStart: 91, visibleEnd: 150, offset: 60 });
    runtime.dispatch({ type: "show-older-evidence" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    expect(runtime.getSnapshot().evidence.investigation.problem).toBeNull();
    expect(runtime.getSnapshot().evidence.investigation.readPoint).toEqual(point);
    expect(runtime.getSnapshot().evidence).toMatchObject({ visibleStart: 31, visibleEnd: 90, offset: 120 });
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("marker-000031");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("marker-000090");
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: repeated canonical Find reads never leak a previously requested payload", async adapter => {
  const { history, runtime } = await setup(20, adapter);
  try {
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: { revision: 1, text: "keep-category", criteria: {}, around: null, unsupported: [] }, find: { text: "all-find-needle", scopeToFilter: true, reveal: false } };
    const hydrated = await history.query!({ ...request, includePayload: true });
    expect(hydrated.ok && hydrated.value.find?.results?.[0]?.payload).toBeDefined();
    const ordinary = await history.query!(request);
    expect(ordinary.ok).toBe(true);
    if (!ordinary.ok) return;
    expect(ordinary.value.find?.total).toBe(10);
    expect(ordinary.value.page.evidence.every(record => record.payload === undefined)).toBe(true);
    expect(ordinary.value.find?.results?.every(record => record.payload === undefined)).toBe(true);
    const changed = await history.query!({ ...request, find: { ...request.find, text: "marker-000019" } });
    expect(changed).toMatchObject({ ok: true, value: { find: { total: 1, first: { eventId: "marker-000019" } } } });
  } finally { runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: cold and repeated Find preserve canonical metadata and owner-qualified facets", async adapter => {
  const { history, runtime, events } = await setup(2, adapter);
  try {
    const added = { ...events[0]!, id: "metadata-only", client: { ...events[0]!.client!, sessionId: "new-session", serverAddress: "https://canonical-only-needle.example" } };
    await history.offer(added).settled;
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }, find: { text: "canonical-only-needle", scopeToFilter: true, reveal: false } };
    const cold = await history.query!(request);
    expect(cold.ok).toBe(true);
    if (!cold.ok) return;
    const match = cold.value.find?.results?.[0];
    expect(cold.value.find?.total).toBe(1);
    expect(match?.identity.eventId).toBe("metadata-only");
    expect(match?.searchText).toContain("https://canonical-only-needle.example");
    expect(match?.facets.session?.label).toBe("new-session");
    expect(match?.facets.subscription?.value).toContain("new-session");
    const warm = await history.query!({ ...request, at: cold.value.readPoint });
    expect(warm.ok && warm.value.find).toEqual(cold.value.find);
    const oldSession = cold.value.page.evidence[0]!.facets.session!;
    const scoped = await history.query!({ ...request, filter: { ...request.filter, criteria: { session: { include: [oldSession], exclude: [] } } } });
    expect(scoped).toMatchObject({ ok: true, value: { find: { total: 0 } } });
  } finally { runtime.dispose(); await history.close(); }
});

test("IndexedDB reuses a bounded Find sequence index for navigation, filtered context and continuations", async () => {
  const { history, runtime } = await setup(1_202, "indexeddb");
  try {
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "NEWEST_FIRST" as const, size: 10 }, filter: { revision: 1, text: "keep-category", criteria: {}, around: null, unsupported: [] }, find: { text: "all-find-needle", scopeToFilter: true, size: 5 } };
    const first = await history.query!(request);
    if (!first.ok) throw new Error(first.problem.message);
    expect(first.value.find?.total).toBe(601);
    const current = { ...first.value.find!.first!, sequence: 1_001, eventId: "marker-001001" };
    const warm = await history.query!({ ...request, at: first.value.readPoint, find: { ...request.find, current, after: current } });
    if (!warm.ok) throw new Error(warm.problem.message);
    expect(warm.value.find).toMatchObject({ total: 601, currentIndex: 500, current: { sequence: 1_001 }, previous: { sequence: 999 }, next: { sequence: 1_003 }, hasMore: true });
    expect(warm.value.find?.results?.map(record => record.identity.sequence)).toEqual([1_003, 1_005, 1_007, 1_009, 1_011]);
    expect(warm.value.find?.page).toMatchObject({ offset: 95 });
    expect(warm.value.find?.page?.evidence.map(record => record.identity.sequence)).toEqual([1_011, 1_009, 1_007, 1_005, 1_003, 1_001, 999, 997, 995, 993]);
    expect(warm.value.telemetry?.findCursorReads).toBe(0);
    expect(warm.value.telemetry?.projectionReads).toBeLessThan(100);
    const continuationRequest = { ...request, at: first.value.readPoint, find: { ...request.find, current, after: current }, page: { ...request.page, cursor: warm.value.find!.page!.nextCursor! } };
    const continuation = await history.query!(continuationRequest);
    if (!continuation.ok) throw new Error(continuation.problem.message);
    expect(continuation.value.page.evidence.map(record => record.identity.sequence)).toEqual([991, 989, 987, 985, 983, 981, 979, 977, 975, 973]);
    expect(continuation.value.totals).toEqual(first.value.totals);
    expect(continuation.value.telemetry?.findCursorReads).toBe(0);
    const oppositeOrder = await history.query!({ ...request, at: first.value.readPoint, page: { order: "OLDEST_FIRST", size: 10 }, find: { ...request.find, current } });
    expect(oppositeOrder).toMatchObject({ ok: true, value: { find: { page: { offset: 495 } }, telemetry: { findCursorReads: 0 } } });
  } finally { runtime.dispose(); await history.close(); }
});

test("IndexedDB Find cache binds to the read point and complete scope, Filter and Around", async () => {
  const { history, runtime, events } = await setup(20, "indexeddb", { maxRetainedCount: 25 });
  try {
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }, find: { text: "all-find-needle", scopeToFilter: true } };
    const cold = await history.query!(request);
    if (!cold.ok) throw new Error(cold.problem.message);
    await history.offer({ ...events[0]!, id: "new-match", timestamp: 21 }).settled;
    const stable = await history.query!({ ...request, at: cold.value.readPoint });
    expect(stable).toMatchObject({ ok: true, value: { find: { total: 20 }, telemetry: { findCursorReads: 0 } } });
    const fresh = await history.query!(request);
    expect(fresh).toMatchObject({ ok: true, value: { find: { total: 21 } } });
    const filtered = await history.query!({ ...request, filter: { ...request.filter, text: "hide-category" } });
    expect(filtered).toMatchObject({ ok: true, value: { find: { total: 10 } } });
    const around = await history.query!({ ...request, filter: { ...request.filter, around: { intervalId: cold.value.readPoint.interval.id, start: 5, end: 11 } } });
    expect(around).toMatchObject({ ok: true, value: { find: { total: 6 }, totals: { matching: 21, inScope: 6 } } });
    const mode = cold.value.page.evidence[0]!.facets.mode!;
    const scoped = await history.query!({ ...request, filter: { ...request.filter, criteria: { mode: { include: [], exclude: [mode] } } } });
    expect(scoped).toMatchObject({ ok: true, value: { find: { total: 0 } } });
    const unscoped = await history.query!({ ...request, filter: { ...request.filter, text: "hide-category" }, find: { ...request.find, scopeToFilter: false } });
    expect(unscoped).toMatchObject({ ok: true, value: { find: { total: 21 } } });
    for (let index = 22; index <= 30; index++) await history.offer({ ...events[0]!, id: `retained-${index}`, timestamp: index }).settled;
    expect(await history.query!({ ...request, at: cold.value.readPoint })).toMatchObject({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE" } });
    const retained = await history.query!(request);
    expect(retained.ok && retained.value.find?.total).toBe(history.status().retained);
    await history.clear();
    await history.offer({ ...events[0]!, id: "after-clear", timestamp: 31 }).settled;
    const cleared = await history.query!(request);
    expect(cleared).toMatchObject({ ok: true, value: { find: { total: 1, first: { eventId: "after-clear" } } } });
    expect(await history.query!({ ...request, at: cold.value.readPoint })).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
  } finally { runtime.dispose(); await history.close(); }
});


test("cancelled IndexedDB Find cannot publish a partial index or replace the previous query", async () => {
  const { history, runtime } = await setup(600, "indexeddb");
  const { IDBObjectStore: FakeObjectStore } = await import("fake-indexeddb");
  try {
    const request = { at: "LATEST_COMMITTED" as const, page: { order: "OLDEST_FIRST" as const, size: 10 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] }, find: { text: "all-find-needle", scopeToFilter: true, reveal: false } };
    const first = await history.query!(request);
    if (!first.ok) throw new Error(first.problem.message);
    const controller = new AbortController();
    const original = FakeObjectStore.prototype.getAll;
    const spy = vi.spyOn(FakeObjectStore.prototype, "getAll").mockImplementation(function (this: IDBObjectStore, ...args) {
      const pending = original.apply(this, args);
      const range = args[0];
      if (this.name === "searchBlocks" && range instanceof IDBKeyRange && typeof range.upper === "number" && range.upper < 0) {
        pending.addEventListener("success", () => controller.abort(), { once: true });
      }
      return pending;
    });
    const cancelled = await history.query!({ ...request, at: first.value.readPoint, find: { ...request.find, text: "keep-category" }, signal: controller.signal });
    spy.mockRestore();
    expect(cancelled).toMatchObject({ ok: false, problem: { code: "QUERY_CANCELLED" } });
    const previous = await history.query!({ ...request, at: first.value.readPoint });
    expect(previous).toMatchObject({ ok: true, value: { find: { total: 600 }, telemetry: { findCursorReads: 0 } } });
    const retried = await history.query!({ ...request, at: first.value.readPoint, find: { ...request.find, text: "keep-category" } });
    expect(retried).toMatchObject({ ok: true, value: { find: { total: 300 } } });
  } finally { vi.restoreAllMocks(); runtime.dispose(); await history.close(); }
});

test.each(["memory", "indexeddb"])("%s: the first match after an empty Find includes its hidden-field excerpt", async adapter => {
  const { history, runtime, events } = await setup(1, adapter);
  try {
    await history.offer({ ...events[0]!, id: "hidden-field-match", timestamp: 2, client: { ...events[0]!.client!, serverAddress: "https://hidden-needle.example" } }).settled;
    runtime.dispatch({ type: "set-find", value: "no-such-text" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ matchCount: 0, currentEventId: null, snippet: null });
    runtime.dispatch({ type: "set-find", value: "hidden-needle" });
    await settled(runtime);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({ matchCount: 1, currentEventId: "hidden-field-match", snippet: { field: "client.serverAddress", text: "https://hidden-needle.example" } });
    expect(runtime.getSnapshot().evidence.events.find(event => event.id === "hidden-field-match")?.raw).toMatchObject({ client: { serverAddress: "https://hidden-needle.example" } });
  } finally { runtime.dispose(); await history.close(); }
});
