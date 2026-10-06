import { afterEach, describe, expect, it, vi } from "vitest";
import * as scopeSearch from "../src/core/scope-search";
import { agentToolFailure, agentToolResultBytes } from "../src/agent/tool-result";
import { AGENT_TOOLS, validateAgentCall, type AgentPermission } from "../src/agent/protocol";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

function event(id: number, overrides: Partial<LightstreamerEventEnvelope> = {}): LightstreamerEventEnvelope {
  return {
    id: `search-event-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "client-1", sessionId: "session-1", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub-1", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener-1", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page-1", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    update: { isSnapshot: false, command: "ADD", key: `row-${id}`, fields: { command: "ADD", key: `row-${id}`, qty: "search-needle" }, changedFields: { qty: "search-needle" } },
    ...overrides
  };
}

async function offer(history: EventHistory, events: LightstreamerEventEnvelope[]) {
  for (let i = 0; i < events.length; i += 100) await Promise.all(events.slice(i, i + 100).map(candidate => history.offer(candidate).settled));
}

async function fixture(events = Array.from({ length: 6 }, (_, index) => event(index + 1)), capacity?: { maxRetainedCount: number }) {
  const history = createInMemoryEventHistory({ panelSessionId: `search-${crypto.randomUUID()}`, capacity });
  await offer(history, events);
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  let permission: AgentPermission = "read";
  const service = createAgentService(runtime.agent!, "panel-1", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel-1", ...args }) as Promise<any>;
  return { history, runtime, service, call, grant(value: AgentPermission) { permission = value; } };
}

function investigation(runtime: WorkbenchRuntime) {
  const snapshot = runtime.getSnapshot();
  return { scope: snapshot.scopeId, filter: snapshot.evidence.investigation.filter, find: snapshot.evidence.find, selection: snapshot.selectionEventId, focused: snapshot.evidence.focusedEventId, context: snapshot.contextId, capture: snapshot.captureStatus };
}

describe("MCP companion search", () => {
  it("explains missing name excerpts without claiming PII redaction", async () => {
    const { call } = await fixture([event(1, { update: { ...event(1).update!, fields: { command: "ADD", key: "row-1", qty: "Clifford" } } })]);
    const compact = await call("search_evidence", { within: "page", text: "Clifford" });
    expect(compact.total).toBe(1);
    expect(compact.evidence[0].match).toMatchObject({ state: "NO_SHAREABLE_EXCERPT", reason: "PAYLOAD_NOT_REQUESTED" });
    expect(compact.matchExplanation).toContain("does not establish redaction");
    const selected = await call("search_evidence", { within: "page", text: "Clifford", fields: ["qty"] });
    expect(selected.evidence[0].match).toMatchObject({ state: "EXPLAINED", fields: [expect.objectContaining({ excerpt: "Clifford" })] });
  });

  it("gives a sufficient bounded budget for an oversized exact read", async () => {
    const { call } = await fixture([event(1, { update: { ...event(1).update!, fields: { command: "ADD", key: "row-1", qty: "wide-value-".repeat(900) } } })]);
    const found = await call("query_evidence", { within: "page", limit: 1 });
    const evidence = found.evidence[0].identity;
    let message = "";
    try { await call("get_evidence", { evidence, includePayload: true }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain("RESULT_BUDGET_EXCEEDED");
    const suggested = /maxBytes:(\d+)/.exec(message);
    expect(suggested).not.toBeNull();
    const maxBytes = Number(suggested![1]);
    expect(maxBytes).toBeGreaterThan(8192);
    expect(maxBytes).toBeLessThanOrEqual(65536);
    const result = await call("get_evidence", { evidence, includePayload: true, maxBytes });
    expect(result.lookup.state).toBe("RETAINED");
    expect(agentToolResultBytes(result)).toBeLessThanOrEqual(maxBytes);
  });

  it("advertises bounded read-only search tools and rejects ambiguous continuation arguments", () => {
    for (const name of ["search_scope", "search_evidence"]) {
      expect(AGENT_TOOLS.find(tool => tool.name === name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      const scope = name === "search_evidence" ? { within: "page" } : {};
      expect(() => validateAgentCall(name, { panelSessionId: "p", ...scope, text: "needle", limit: 101 })).toThrow("invalid integer");
      expect(() => validateAgentCall(name, { panelSessionId: "p", ...scope, text: " ", limit: 1 })).toThrow("non-whitespace");
      expect(() => validateAgentCall(name, { panelSessionId: "p", ...scope, text: "a".repeat(2049) })).toThrow("invalid string");
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c", text: "different" })).toThrow("only panelSessionId and cursor");
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c" })).not.toThrow();
    }
    expect(() => validateAgentCall("search_evidence", { panelSessionId: "p", text: "needle", within: "current-investigation", scopeId: "x" })).toThrow("already defines Scope");
  });

  // This checks pagination semantics over 1,002 records; Windows CI needs more than Vitest's default test budget.
  it("pages every match beyond 1,000 at one read point while Capture appends", async () => {
    const { history, runtime, call } = await fixture(Array.from({ length: 1002 }, (_, index) => event(index + 1)));
    const before = investigation(runtime);
    const first = await call("search_evidence", { within: "page", text: "SeArCh-NeEdLe", limit: 100 });
    expect(first).toMatchObject({ total: 1002, search: { within: "page" } });
    expect(first.evidence.length).toBeGreaterThan(0);
    expect(first.evidence.length).toBeLessThanOrEqual(100);
    expect(first.evidence[0].payload).toBeUndefined();
    await offer(history, [event(1003)]);
    const identities = first.evidence.map((entry: any) => entry.identity.eventId);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await call("search_evidence", { cursor });
      expect(next.readPoint).toEqual(first.readPoint);
      expect(next.total).toBe(1002);
      identities.push(...next.evidence.map((entry: any) => entry.identity.eventId));
      cursor = next.nextCursor;
    }
    expect(identities).toHaveLength(1002);
    expect(new Set(identities).size).toBe(1002);
    expect(identities.at(-1)).toBe("search-event-1002");
    expect(investigation(runtime)).toEqual(before);
    expect((await call("search_evidence", { within: "page", text: "search-needle" })).total).toBe(1003);
  }, 15_000);

  it("fits a search prefix with one storage read per page and preserves every ordered match", async () => {
    const { runtime, call } = await fixture(Array.from({ length: 27 }, (_, index) => event(index + 1, {
      update: { ...event(index + 1).update!, key: `row-${index}-${"x".repeat(index < 12 ? 80 : 650)}` }
    })));
    const query = vi.spyOn(runtime.agent!, "query");
    const identities: string[] = [];
    let cursor: string | null = null;
    let readPoint: unknown;
    let pages = 0;
    do {
      const before = query.mock.calls.length;
      const page = await call("search_evidence", cursor ? { cursor } : { within: "page", text: "needle", limit: 100, maxBytes: 8192 });
      expect(query.mock.calls.length - before).toBe(1);
      expect(agentToolResultBytes(page)).toBeLessThanOrEqual(8192);
      expect(page.total).toBe(27);
      expect(page.totals.matching).toBe(27);
      if (pages === 0) {
        readPoint = page.readPoint;
        expect(page.evidence.length).toBeGreaterThan(0);
        expect(page.evidence.length).toBeLessThan(27);
        expect(page.nextCursor).toBeTruthy(); // Storage returned its entire match set, but the fitted tail remains.
      } else expect(page.readPoint).toEqual(readPoint);
      identities.push(...page.evidence.map((entry: any) => entry.identity.eventId));
      cursor = page.nextCursor; pages++;
    } while (cursor);
    expect(identities).toEqual(Array.from({ length: 27 }, (_, index) => `search-event-${index + 1}`));
    expect(new Set(identities).size).toBe(27);
    expect(query).toHaveBeenCalledTimes(pages);
    expect(query.mock.calls.every(([input]) => input.find?.size === 100)).toBe(true);
  });

  it("freezes the current Scope and Filter independently of Find and preserves the human investigation", async () => {
    const { runtime, call } = await fixture([
      event(1), event(2),
      event(3, { update: { isSnapshot: false, fields: { qty: "excluded-needle" }, changedFields: { qty: "excluded-needle" } } }),
      event(4, { client: { id: "other-client", sessionId: "other-session", status: "CONNECTED:WS-STREAMING" } })
    ]);
    const clientScope = runtime.getSnapshot().scope.nodes.find(node => node.kind === "client" && node.label === "client-1")!;
    runtime.dispatch({ type: "set-scope", scopeId: clientScope.id });
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "search-needle" }] });
    runtime.dispatch({ type: "set-find", value: "row-2" });
    runtime.dispatch({ type: "select-evidence", eventId: "search-event-2" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    const before = investigation(runtime);
    const first = await call("search_evidence", { text: "needle", within: "current-investigation", limit: 1, includePayload: true, maxBytes: 65536 });
    expect(first.total).toBe(2);
    expect(first.search).toEqual({ text: "needle", within: "current-investigation", match: "CASE_INSENSITIVE_SUBSTRING", order: "OLDEST_FIRST" });
    expect(first.evidence[0].match).toMatchObject({ state: "EXPLAINED", fields: expect.arrayContaining([expect.objectContaining({ excerpt: "search-needle" })]) });
    await call("search_scope", { text: "ROWS", limit: 1 });
    expect(investigation(runtime)).toEqual(before);
    runtime.dispatch({ type: "set-scope", scopeId: null });
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "excluded" }] });
    const second = await call("search_evidence", { cursor: first.nextCursor });
    expect(second.search).toEqual(first.search);
    expect(second.total).toBe(2);
    expect(second.evidence[0].identity.eventId).toBe("search-event-2");
    expect(second.nextCursor).toBeNull();
    expect([first.evidence[0].identity.eventId, second.evidence[0].identity.eventId]).toEqual(["search-event-1", "search-event-2"]);
    const scoped = await call("search_evidence", { text: "needle", scopeId: clientScope.id });
    expect(scoped.total).toBe(3);
    expect(scoped.search).toMatchObject({ scopeId: clientScope.id });
    expect(scoped.search).not.toHaveProperty("filter");
  });

  it("searches the complete structural Topology and freezes Scope pagination across new objects", async () => {
    const events = Array.from({ length: 130 }, (_, index) => event(index + 1, { subscription: { id: `sub-${index + 1}`, mode: "COMMAND", items: [`instrument-${index + 1}`], fields: ["command", "key", "qty"], active: true, subscribed: true }, item: { name: `instrument-${index + 1}`, position: 1 } }));
    const { runtime, history, call } = await fixture(events);
    const before = investigation(runtime);
    const first = await call("search_scope", { text: "INSTRUMENT-", limit: 100 });
    expect(first.total).toBeGreaterThanOrEqual(130);
    expect(first.scopes.length).toBeGreaterThan(0);
    expect(first.scopes.length).toBeLessThanOrEqual(100);
    expect(first.scopes.some((entry: any) => entry.kind === "item" && entry.path.includes("client-1"))).toBe(true);
    await offer(history, [event(131, { subscription: { id: "new-subscription", mode: "COMMAND", items: ["instrument-new"], fields: ["command", "key", "qty"], active: true, subscribed: true }, item: { name: "instrument-new", position: 1 } })]);
    const ids = first.scopes.map((entry: any) => entry.scopeId);
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await call("search_scope", { cursor });
      expect(next.snapshot).toEqual(first.snapshot);
      expect(next.total).toBe(first.total);
      ids.push(...next.scopes.map((entry: any) => entry.scopeId));
      cursor = next.nextCursor;
    }
    expect(new Set(ids).size).toBe(first.total);
    expect(investigation(runtime)).toEqual(before);
    expect((await call("search_scope", { text: "instrument-new" })).total).toBeGreaterThan(0);
  });

  it("rejects an unsupported current Filter without returning out-of-Scope matches or changing the investigation", async () => {
    const { runtime, call } = await fixture([
      event(1),
      event(2, { client: { id: "other-client", sessionId: "other-session", status: "CONNECTED:WS-STREAMING" } })
    ]);
    const scope = runtime.getSnapshot().scope.nodes.find(node => node.kind === "client" && node.label === "client-1")!;
    runtime.dispatch({ type: "set-scope", scopeId: scope.id });
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision,
      operations: [{ type: "add-unsupported", criterion: { id: "future-criterion", reason: "Unsupported imported Filter" } }] });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    const before = investigation(runtime);
    await expect(call("search_evidence", { text: "needle", within: "current-investigation", limit: 1 })).rejects.toThrow("UNSUPPORTED_FILTER");
    expect(investigation(runtime)).toEqual(before);
    // The explicitly unfiltered page boundary remains available for recovery.
    expect((await call("search_evidence", { text: "needle", within: "page" })).total).toBe(2);
  });

  it("expires both search continuations on retention and Clear", async () => {
    const { history, call } = await fixture(undefined, { maxRetainedCount: 6 });
    const evidence = await call("search_evidence", { within: "page", text: "needle", limit: 1 });
    const scopes = await call("search_scope", { text: "client-1", limit: 1 });
    expect(scopes.nextCursor).toBeTruthy();
    await offer(history, [event(7)]);
    await expect(call("search_evidence", { cursor: evidence.nextCursor })).rejects.toThrow(/READ_POINT_UNAVAILABLE|retention/i);
    await expect(call("search_scope", { cursor: scopes.nextCursor })).rejects.toThrow("retention");
    const latestEvidence = await call("search_evidence", { within: "page", text: "needle", limit: 1 });
    const latestScopes = await call("search_scope", { text: "client-1", limit: 1 });
    await history.clear();
    await expect(call("search_evidence", { cursor: latestEvidence.nextCursor })).rejects.toThrow(/HISTORY_INTERVAL_UNAVAILABLE|Clear/i);
    await expect(call("search_scope", { cursor: latestScopes.nextCursor })).rejects.toThrow(/Clear/);
  });

  it("expires cursors on revocation and cannot route them into another Panel Session", async () => {
    const { runtime, service, call, grant } = await fixture();
    const searches = await Promise.all([call("search_evidence", { within: "page", text: "needle", limit: 1 }), call("search_scope", { text: "client-1", limit: 1 })]);
    const another = createAgentService(runtime.agent!, "panel-2", () => "read");
    for (const [index, name] of ["search_evidence", "search_scope"].entries()) {
      await expect(service.call(name, { panelSessionId: "panel-2", cursor: searches[index].nextCursor })).rejects.toThrow("not granted");
      await expect(another.call(name, { panelSessionId: "panel-2", cursor: searches[index].nextCursor })).rejects.toThrow("expired");
    }
    grant("off"); service.revoke(); grant("read");
    await expect(call("search_evidence", { cursor: searches[0].nextCursor })).rejects.toThrow("expired");
    await expect(call("search_scope", { cursor: searches[1].nextCursor })).rejects.toThrow("expired");
  });

  it("expires continuations when the inspected page epoch changes", async () => {
    const { history, call } = await fixture();
    const evidence = await call("search_evidence", { within: "page", text: "needle", limit: 1 });
    const scopes = await call("search_scope", { text: "client-1", limit: 1 });
    await offer(history, [event(7, { topology: { ...event(7).topology!, pageEpoch: "next-page" } })]);
    await expect(call("search_evidence", { cursor: evidence.nextCursor })).rejects.toThrow("page change");
    await expect(call("search_scope", { cursor: scopes.nextCursor })).rejects.toThrow("page change");
  });

  it("bounds cursor lifetime and the number of retained Topology snapshots", async () => {
    const { call } = await fixture();
    const first = await call("search_scope", { text: "client-1", limit: 1 });
    for (let i = 0; i < 8; i++) await call("search_scope", { text: "client-1", limit: 1 });
    await expect(call("search_scope", { cursor: first.nextCursor })).rejects.toThrow("expired");
    const evidence = await call("search_evidence", { within: "page", text: "needle", limit: 1 });
    const scopes = await call("search_scope", { text: "client-1", limit: 1 });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60 * 1000 + 1);
    await expect(call("search_evidence", { cursor: evidence.nextCursor })).rejects.toThrow("expired");
    await expect(call("search_scope", { cursor: scopes.nextCursor })).rejects.toThrow("expired");
  });

  it("withholds an in-flight search after revocation even if access is regranted before storage returns", async () => {
    const { runtime, service, call, grant } = await fixture();
    const query = runtime.agent!.query;
    let release!: () => void;
    vi.spyOn(runtime.agent!, "query").mockImplementationOnce(async input => {
      await new Promise<void>(resolve => { release = resolve; });
      return query(input);
    });
    const pending = call("search_evidence", { within: "page", text: "needle" });
    grant("off"); service.revoke(); grant("read"); release();
    await expect(pending).rejects.toThrow("revoked");
  });

  it("rejects already-aborted searches before starting storage work", async () => {
    const { runtime, service } = await fixture();
    const query = vi.spyOn(runtime.agent!, "query");
    const controller = new AbortController(); controller.abort();
    await expect(service.call("search_evidence", { panelSessionId: "panel-1", within: "page", text: "needle" }, { signal: controller.signal })).rejects.toThrow("QUERY_CANCELLED");
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates cancellation and blocks response publication and budget retries", async () => {
    const { runtime, service } = await fixture();
    const controller = new AbortController();
    const original = runtime.agent!.query;
    let received: AbortSignal | undefined;
    const query = vi.spyOn(runtime.agent!, "query").mockImplementationOnce(async input => {
      received = input.signal;
      const result = await original(input);
      controller.abort();
      return result; // Storage may finish in the same turn as cancellation.
    });
    await expect(service.call("search_evidence", { panelSessionId: "panel-1", within: "page", text: "needle", limit: 100, maxBytes: 4096 }, { signal: controller.signal })).rejects.toThrow("QUERY_CANCELLED");
    expect(received?.aborted).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reuses immutable Scope nodes on fresh reads of one structural revision", async () => {
    const { runtime, history, call } = await fixture();
    const first = runtime.agent!.scopeSearchSnapshot();
    const second = runtime.agent!.scopeSearchSnapshot();
    expect(second.nodes).toBe(first.nodes);
    expect(Object.isFrozen(first.nodes)).toBe(true);
    await call("search_scope", { text: "client-1", limit: 1 });
    await call("search_scope", { text: "rows", limit: 1, kind: "item" });
    await offer(history, [event(7, { subscription: { ...event(7).subscription!, id: "different-sub" } })]);
    const changed = runtime.agent!.scopeSearchSnapshot();
    expect(changed.structureRevision).not.toBe(first.structureRevision);
    expect(changed.nodes).not.toBe(first.nodes);
  });

  it("shares a privacy-safe Scope index across fresh searches and invalidates lifecycle changes", async () => {
    const { runtime, history, call } = await fixture();
    const build = vi.spyOn(scopeSearch, "createScopeSearchIndex");
    const first = runtime.agent!.scopeSearchSnapshot();
    for (let index = 0; index < 8; index++) await call("search_scope", { text: index % 2 ? "rows" : "client-1", limit: 1 });
    expect(build).toHaveBeenCalledTimes(1);
    await offer(history, [event(7, { kind: "client-status", topology: undefined, update: undefined,
      client: { id: "client-1", sessionId: "session-1", status: "DISCONNECTED" } })]);
    const latest = runtime.agent!.scopeSearchSnapshot();
    expect(latest.structureRevision).toBe(first.structureRevision);
    expect(latest.nodes).not.toBe(first.nodes);
    await call("search_scope", { text: "disconnected", limit: 1 });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("removes cancellation listeners and reports stable expired-cursor and revoked-grant errors", async () => {
    const { service, grant } = await fixture();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener"), remove = vi.spyOn(controller.signal, "removeEventListener");
    await service.call("search_evidence", { panelSessionId: "panel-1", within: "page", text: "needle" }, { signal: controller.signal });
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0]![1]);
    const failure = async (args: Record<string, unknown>) => {
      try { await service.call("search_evidence", { panelSessionId: "panel-1", ...args }); throw new Error("Expected failure"); }
      catch (error) { return agentToolFailure(error).structuredContent.error; }
    };
    expect(await failure({ cursor: "expired" })).toMatchObject({ code: "CURSOR_EXPIRED", automaticRetry: false });
    grant("off"); service.revoke();
    expect(await failure({ within: "page", text: "needle" })).toMatchObject({ code: "ACCESS_REVOKED", automaticRetry: false });
  });

  it("keeps Client Message and credential text out of search explanations and payloads", async () => {
    const message = "private-body-marker-must-stay-redacted", response = "private-outcome-marker-must-stay-redacted", credential = "private-credential-marker-must-stay-redacted";
    const { call } = await fixture([
      event(1, { kind: "client-message-processed", direction: "outbound", source: "application", update: undefined, clientMessage: { id: "message-1", pageEpoch: "page-1", message, messageState: "available", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available", response }, raw: { duplicate: message } }),
      event(2, { update: { isSnapshot: false, fields: { qty: JSON.stringify({ description: "allowed-match", password: credential }), token: credential }, changedFields: { token: credential } }, raw: { duplicate: credential } })
    ]);
    for (const text of ["body-marker", "outcome-marker", "credential-marker", "allowed-match"]) {
      const result = await call("search_evidence", { within: "page", text, includePayload: true, maxBytes: 65536 });
      expect(JSON.stringify(result)).not.toContain(message);
      expect(JSON.stringify(result)).not.toContain(response);
      expect(JSON.stringify(result)).not.toContain(credential);
      expect(JSON.stringify(result)).not.toContain("searchText");
      expect(JSON.stringify(result)).not.toContain('"raw"');
      if (text === "allowed-match") {
        expect(result.total).toBe(1);
        expect(result.evidence[0].match.state).toBe("EXPLAINED");
      } else if (result.total > 0) {
        expect(result.evidence.every((entry: any) => entry.match.state === "NO_SHAREABLE_EXCERPT")).toBe(true);
      }
    }
  });
});
