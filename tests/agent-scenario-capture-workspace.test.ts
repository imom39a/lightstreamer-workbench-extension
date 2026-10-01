import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createAuthoritativeHistory } from "./support/authoritative-history";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
function event(id: string, kind: LightstreamerEventEnvelope["kind"] = "item-update"): LightstreamerEventEnvelope {
  return { id, timestamp: 1, direction: "inbound", source: "server", synthetic: false, captureSource: "listener", kind,
    client: { id: "c", sessionId: "s", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub", mode: "COMMAND", items: ["items"], fields: ["command", "key", "value"], active: true, subscribed: true },
    listener: { id: "l", callbacks: ["onItemUpdate"] }, item: { name: "items", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page", captureSequence: 1, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { isSnapshot: false, command: "ADD", key: id, fields: { command: "ADD", key: id, value: id }, changedFields: { command: "ADD", key: id, value: id } } } : {}) };
}
const document = (key: string, value: string) => JSON.stringify({ command: "UPDATE", key, isSnapshot: false, fields: {command: "UPDATE", key, value} });
async function fixture(human = true) {
  const history = createAuthoritativeHistory({ precommitted: [event("client", "client-created"), event("status", "client-status"), event("subscription", "subscription-created"), event("started", "subscription-started"), event("listener", "listener-added"), ...Array.from({length: 1200}, (_, i) => event(`capture-${i}`))] });
  const execute = vi.fn(async () => ({ requestId: "delivery", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  runtime.dispatch({type: "select-evidence", eventId: "capture-1199"});
  await vi.waitFor(() => expect(runtime.getSnapshot().selectedEvidence?.id).toBe("capture-1199"));
  const service = createAgentService(runtime.agent!, "panel", () => "local");
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
  const source = (await call("search_evidence", {within: "page", text: "capture-0", includePayload: true})).evidence[0].identity;
  const pageEpoch = (await call("get_status")).pageEpoch;
  if (human) {
    runtime.dispatch({type: "begin-local-injection-from-selection"});
    await vi.waitFor(() => expect(runtime.getSnapshot().localInjection.state).toBe("active"));
    runtime.dispatch({type: "convert-local-injection-to-scenario"});
    await ready(runtime);
  }
  return {runtime, history, call, execute, source, pageEpoch};
}
async function ready(runtime: WorkbenchRuntime) { await vi.waitFor(() => expect(runtime.getSnapshot().scenario?.captureWorkspace.queryState).toBe("ready")); }
function workspace(runtime: WorkbenchRuntime) {
  const snapshot = runtime.getSnapshot();
  return { scopeId: snapshot.scopeId, selectionEventId: snapshot.selectionEventId, filter: snapshot.evidence.investigation.filter, find: snapshot.evidence.find, scenario: snapshot.scenario };
}

describe("Agent reads and the human Scenario capture workspace", () => {
  it("preserves capture search, page, selection, focus and Draft across compact, search and payload continuations", async () => {
    const {runtime, call, execute} = await fixture();
    runtime.dispatch({type: "set-scenario-capture-search", text: "capture-1"});
    await ready(runtime);
    runtime.dispatch({type: "show-older-scenario-captures"});
    await ready(runtime);
    const row = runtime.getSnapshot().scenario!.captureWorkspace.rows.find(row => row.available)!;
    runtime.dispatch({type: "toggle-scenario-capture", identity: row.identity});
    runtime.dispatch({type: "set-scenario-capture-scroll", scrollTop: 217});
    const stepId = runtime.getSnapshot().scenario!.focusedStepId;
    runtime.dispatch({type: "set-scenario-step-json", stepId, text: document("capture-1199", "human Draft")});
    runtime.dispatch({type: "apply-filter-mutations", expectedRevision: runtime.getSnapshot().evidence.investigation.filter.revision, operations: [{type: "set-text", text: "capture-1199"}]});
    runtime.dispatch({type: "set-find", value: "capture-1199"});
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.loading).toBe(false));
    const before = workspace(runtime);
    expect(before.scenario!.captureWorkspace.pageOffset).toBe(40);
    for (const request of [{name: "query_evidence", args: {within: "page", limit: 100}}, {name: "search_evidence", args: {within: "page", text: "capture-", limit: 100}}, {name: "query_evidence", args: {within: "page", includePayload: true, maxBytes: 8192, limit: 100}}]) {
      const page = await call(request.name, request.args);
      expect(page.evidence.length).toBeGreaterThan(0);
      expect(page.nextCursor).toBeTruthy();
      const continuation = await call(request.name, {cursor: page.nextCursor});
      expect(continuation.readPoint).toEqual(page.readPoint);
      expect(continuation.evidence[0].identity.sequence).toBeGreaterThan(page.evidence.at(-1).identity.sequence);
      expect(workspace(runtime)).toEqual(before);
    }
    expect(execute).not.toHaveBeenCalled();
  });
  it("reads human batched captures, freezes Review and refuses agent replacement or execution of the human Run", async () => {
    const {runtime, call, execute, source, pageEpoch} = await fixture();
    const selected = runtime.getSnapshot().scenario!.captureWorkspace.rows.filter(row => row.available).slice(0, 2);
    selected.forEach(row => runtime.dispatch({type: "toggle-scenario-capture", identity: row.identity}));
    runtime.dispatch({type: "add-scenario-captures"});
    await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(3));
    const before = workspace(runtime);
    const trace = await call("get_scenario_trace");
    expect(trace.totalSteps).toBe(3);
    for (const name of ["prepare_scenario", "prepare_local_injection"]) {
      const args = name === "prepare_scenario" ? {pageEpoch, steps: [{evidence: source}]} : {pageEpoch, evidence: source};
      await expect(call(name, args)).rejects.toThrow("protected");
      expect(workspace(runtime)).toEqual(before);
    }
    runtime.dispatch({type: "review-scenario"});
    await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.phase).toBe("review"));
    const run = runtime.getSnapshot().scenario!.run!;
    expect(Object.isFrozen(run)).toBe(true);
    await expect(call("control_scenario", {runId: run.id, action: "step", requestId: "human-run"})).rejects.toThrow("agent Scenario");
    expect(execute).not.toHaveBeenCalled();
  });
  it("projects agent Source and Draft separately and invalidates agent control after human editing and Review", async () => {
    const {runtime, call, execute, source, pageEpoch} = await fixture(false);
    const prepared = await call("prepare_scenario", {pageEpoch, members: [{kind: "step", id: "agent-step", evidence: source, document: document("capture-0", "agent Draft")}]});
    expect(prepared.scenario.phase).toBe("review");
    const step = runtime.getSnapshot().scenario!.scenario.steps[0]!;
    expect(step.draft.sourceEventId).toBe("capture-0");
    expect(step.draft.rawText).toContain("agent Draft");
    expect(step.draft.sourceRawText).toContain("capture-0");
    expect(step.draft.sourceRawText).not.toContain("agent Draft");
    expect(Object.isFrozen(step.draft)).toBe(true);
    runtime.dispatch({type: "edit-scenario"});
    runtime.dispatch({type: "set-scenario-step-json", stepId: step.id, text: document("capture-0", "human revised")});
    runtime.dispatch({type: "review-scenario"});
    await expect(call("control_scenario", {runId: prepared.scenario.run.id, action: "step", requestId: "edited-agent-run"})).rejects.toThrow("edited");
    expect(execute).not.toHaveBeenCalled();
  });
});
