import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("advertises bounded read-only search tools and rejects ambiguous continuation arguments", () => {
    for (const name of ["search_scope", "search_evidence"]) {
      expect(AGENT_TOOLS.find(tool => tool.name === name)?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(() => validateAgentCall(name, { panelSessionId: "p", text: "needle", limit: 101 })).toThrow("invalid integer");
      expect(() => validateAgentCall(name, { panelSessionId: "p", text: " ", limit: 1 })).toThrow("non-whitespace");
      expect(() => validateAgentCall(name, { panelSessionId: "p", text: "a".repeat(2049) })).toThrow("invalid string");
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c", text: "different" })).toThrow("only panelSessionId and cursor");
      expect(() => validateAgentCall(name, { panelSessionId: "p", cursor: "c" })).not.toThrow();
    }
    expect(() => validateAgentCall("search_evidence", { panelSessionId: "p", text: "needle", within: "current-investigation", scopeId: "x" })).toThrow("already defines Scope");
  });

  it("pages every match beyond 1,000 at one read point while Capture appends", async () => {
    const { history, runtime, call } = await fixture(Array.from({ length: 1002 }, (_, index) => event(index + 1)));
    const before = investigation(runtime);
    const first = await call("search_evidence", { text: "SeArCh-NeEdLe", limit: 100 });
    expect(first).toMatchObject({ total: 1002, search: { within: "page", scope: { kind: "PAGE" }, filter: { text: "" } } });
    expect(first.evidence).toHaveLength(100);
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
    expect((await call("search_evidence", { text: "search-needle" })).total).toBe(1003);
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
    const first = await call("search_evidence", { text: "needle", within: "current-investigation", limit: 1, includePayload: true });
    expect(first.total).toBe(2);
    expect(first.search).toMatchObject({ within: "current-investigation", scope: { kind: "CLIENT", clientId: "client-1" }, filter: { text: "search-needle" } });
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
    expect((await call("search_evidence", { text: "needle", scopeId: clientScope.id })).total).toBe(3);
  });

  it("searches the complete structural Topology and freezes Scope pagination across new objects", async () => {
    const events = Array.from({ length: 130 }, (_, index) => event(index + 1, { subscription: { id: `sub-${index + 1}`, mode: "COMMAND", items: [`instrument-${index + 1}`], fields: ["command", "key", "qty"], active: true, subscribed: true }, item: { name: `instrument-${index + 1}`, position: 1 } }));
    const { runtime, history, call } = await fixture(events);
    const before = investigation(runtime);
    const first = await call("search_scope", { text: "INSTRUMENT-", limit: 100 });
    expect(first.total).toBeGreaterThanOrEqual(130);
    expect(first.scopes).toHaveLength(100);
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

  it("expires both search continuations on retention and Clear", async () => {
    const { history, call } = await fixture(undefined, { maxRetainedCount: 6 });
    const evidence = await call("search_evidence", { text: "needle", limit: 1 });
    const scopes = await call("search_scope", { text: "client-1", limit: 1 });
    expect(scopes.nextCursor).toBeTruthy();
    await offer(history, [event(7)]);
    await expect(call("search_evidence", { cursor: evidence.nextCursor })).rejects.toThrow(/READ_POINT_UNAVAILABLE|retention/i);
    await expect(call("search_scope", { cursor: scopes.nextCursor })).rejects.toThrow("retention");
    const latestEvidence = await call("search_evidence", { text: "needle", limit: 1 });
    const latestScopes = await call("search_scope", { text: "client-1", limit: 1 });
    await history.clear();
    await expect(call("search_evidence", { cursor: latestEvidence.nextCursor })).rejects.toThrow(/HISTORY_INTERVAL_UNAVAILABLE|Clear/i);
    await expect(call("search_scope", { cursor: latestScopes.nextCursor })).rejects.toThrow(/Clear/);
  });

  it("expires cursors on revocation and cannot route them into another Panel Session", async () => {
    const { runtime, service, call, grant } = await fixture();
    const searches = await Promise.all([call("search_evidence", { text: "needle", limit: 1 }), call("search_scope", { text: "client-1", limit: 1 })]);
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
    const evidence = await call("search_evidence", { text: "needle", limit: 1 });
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
    const evidence = await call("search_evidence", { text: "needle", limit: 1 });
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
    const pending = call("search_evidence", { text: "needle" });
    grant("off"); service.revoke(); grant("read"); release();
    await expect(pending).rejects.toThrow("revoked");
  });

  it("keeps Client Message and credential text out of search explanations and payloads", async () => {
    const message = "private-body-marker-must-stay-redacted", response = "private-outcome-marker-must-stay-redacted", credential = "private-credential-marker-must-stay-redacted";
    const { call } = await fixture([
      event(1, { kind: "client-message-processed", direction: "outbound", source: "application", update: undefined, clientMessage: { id: "message-1", pageEpoch: "page-1", message, messageState: "available", sequence: "UNORDERED_MESSAGES", delayTimeout: null, enqueueWhileDisconnected: false, listenerProvided: true, outcome: "processed", outcomeAvailability: "available", response }, raw: { duplicate: message } }),
      event(2, { update: { isSnapshot: false, fields: { qty: JSON.stringify({ description: "allowed-match", password: credential }), token: credential }, changedFields: { token: credential } }, raw: { duplicate: credential } })
    ]);
    for (const text of ["body-marker", "outcome-marker", "credential-marker", "allowed-match"]) {
      const result = await call("search_evidence", { text, includePayload: true });
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
