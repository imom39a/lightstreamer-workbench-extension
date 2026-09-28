import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { addScenarioStep } from "../src/core/local-injection-scenario";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
const doc = (command = "UPDATE", key = "row-1") => JSON.stringify({ command, key, isSnapshot: false, fields: { command, key, qty: 2 } });
function event(id: number, kind: LightstreamerEventEnvelope["kind"]): LightstreamerEventEnvelope {
  return {
    id: `event-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client-1", sessionId: "session-1", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub-1", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener-1", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page-1", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { isSnapshot: false, command: "ADD", key: "row-1", fields: { command: "ADD", key: "row-1", qty: 1 }, changedFields: { command: "ADD", key: "row-1", qty: 1 }, fieldValueStates: { qty: "redacted" } } } : {})
  };
}
async function fixture() {
  const history = createAuthoritativeHistory({ precommitted: [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update")] });
  const execute = vi.fn(async () => ({ requestId: "delivery", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } });
  runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const evidence = (await runtime.agent!.query({ at: "LATEST_COMMITTED", size: 25, includePayload: true })).page.evidence.find(record => record.identity.eventId === "event-6")!.identity;
  const pageEpoch = (runtime.agent!.status() as { pageEpoch: string }).pageEpoch;
  return { runtime, evidence, pageEpoch };
}

describe("source-grounded agent authoring", () => {
  it("validates without changing a human-owned Draft and reports captured replayability", async () => {
    const { runtime, evidence, pageEpoch } = await fixture();
    await runtime.agent!.prepare([{ evidence, document: doc() }], false, pageEpoch, () => true);
    const before = runtime.agent!.local().draft;
    const query = runtime.agent!.query;
    let release!: () => void;
    vi.spyOn(runtime.agent!, "query").mockImplementationOnce(async input => {
      await new Promise<void>(resolve => { release = resolve; });
      return query(input);
    });
    const pending = runtime.agent!.validateCandidate({ kind: "draft", draft: { evidence } }, pageEpoch, () => true);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const humanText = doc("UPDATE", "human-row");
    runtime.dispatch({ type: "set-local-injection-json", text: humanText });
    release();
    const result = await pending as any;
    expect(result.valid).toBe(false); // the captured redacted source field remains unresolved
    expect(result.candidates[0].replayability.fields).toContainEqual(expect.objectContaining({ field: "qty", classification: "replacement-required", reason: "redacted", resolved: false }));
    expect(runtime.agent!.local().draft).toMatchObject({ id: before!.id, rawText: humanText });
  });

  it("validates explicit single-target Step and Checkpoint membership before Scenario publication", async () => {
    const { runtime, evidence, pageEpoch } = await fixture();
    const plan = { members: [
      { kind: "step" as const, id: "create-row", evidence, document: doc("ADD", "row-2") },
      { kind: "checkpoint" as const, id: "after-add", name: "Local update committed", assertions: [{ id: "local-evidence", kind: "correlated-local-evidence-exists" as const, stepId: "create-row" }] }
    ] };
    const validation = await runtime.agent!.validateCandidate({ kind: "scenario", plan }, pageEpoch, () => true) as any;
    expect(validation.valid).toBe(true);
    expect(runtime.agent!.scenario()).toBeNull();
    await runtime.agent!.prepareScenarioPlan(plan, pageEpoch, () => true);
    expect(runtime.agent!.scenario()?.scenario.members.map(({ kind, id }) => [kind, id])).toEqual([["step", "create-row"], ["checkpoint", "after-add"]]);
    runtime.agent!.control("step");
    await vi.waitFor(() => expect(runtime.agent!.scenario()?.run?.trace.some(entry => entry.kind === "attempted" && entry.stepId === "create-row")).toBe(true));
    runtime.agent!.control("step");
    await vi.waitFor(() => expect(runtime.agent!.scenario()?.run?.trace.some(entry => entry.kind === "checkpoint" && entry.checkpointId === "after-add")).toBe(true));
  });

  it("preflights ordered fresh COMMAND ADD, UPDATE, and DELETE Steps as one Run", async () => {
    const { runtime, evidence, pageEpoch } = await fixture();
    const plan = { members: [
      { kind: "step" as const, id: "add-fresh", evidence, document: doc("ADD", "fresh-row") },
      { kind: "step" as const, id: "update-fresh", evidence, document: doc("UPDATE", "fresh-row") },
      { kind: "step" as const, id: "delete-fresh", evidence, document: doc("DELETE", "fresh-row") }
    ] };
    const validation = await runtime.agent!.validateCandidate({ kind: "scenario", plan }, pageEpoch, () => true) as any;
    expect(validation.valid, validation.reason).toBe(true);
    await runtime.agent!.prepareScenarioPlan(plan, pageEpoch, () => true);
    expect(runtime.agent!.scenario()?.run?.steps.map(step => step.id)).toEqual(["add-fresh", "update-fresh", "delete-fresh"]);
  });

  it("rejects invalid checkpoint references and stale page epochs without publishing", async () => {
    const { runtime, evidence, pageEpoch } = await fixture();
    const invalid = { members: [
      { kind: "step" as const, id: "first", evidence, document: doc("ADD", "row-3") },
      { kind: "checkpoint" as const, id: "too-early", name: "Invalid", assertions: [{ id: "future", kind: "correlated-local-evidence-exists" as const, stepId: "missing" }] }
    ] };
    await expect(runtime.agent!.prepareScenarioPlan(invalid, pageEpoch, () => true)).rejects.toThrow(/earlier Scenario Step/u);
    expect(runtime.agent!.scenario()).toBeNull();
    await expect(runtime.agent!.validateCandidate({ kind: "draft", draft: { evidence } }, "old-page", () => true)).rejects.toThrow(/Page changed/u);
    expect(runtime.agent!.scenario()).toBeNull();
  });

  it("keeps an agent Scenario within its exact single Subscription target", async () => {
    const { runtime, evidence, pageEpoch } = await fixture();
    const plan = { members: [{ kind: "step" as const, id: "one-target", evidence, document: doc("ADD", "row-4") }] };
    await runtime.agent!.prepareScenarioPlan(plan, pageEpoch, () => true);
    const scenario = runtime.agent!.scenario()!.scenario;
    const first = scenario.steps[0]!.draft;
    const otherTargetDraft = { ...first, target: { ...first.target, subscriptionId: "other-subscription" } };
    expect(addScenarioStep(scenario, otherTargetDraft, {}, "wrong-target")).toMatchObject({ ok: false, reason: expect.stringContaining("exact Local Injection Target") });
  });

  it("names the source-free capability limitation instead of implying captured truth", async () => {
    const { runtime, pageEpoch } = await fixture();
    const scopes = runtime.agent!.scopes(0, 100) as { nodes: { id: string; kind: string }[] };
    const item = scopes.nodes.find(node => node.kind === "item");
    expect(item).toBeTruthy();
    const result = await runtime.agent!.validateCandidate({ kind: "draft", draft: { scopeId: item!.id } }, pageEpoch, () => true) as any;
    expect(result.candidates[0].replayability).toMatchObject({ source: "source-free", limitation: expect.stringContaining("not evidence of application state") });
  });
});
