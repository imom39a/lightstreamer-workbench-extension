import { describe, expect, it } from "vitest";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { ScenarioCheckpoint } from "../src/core/local-injection-scenario";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

async function authoringRuntime() {
  const base: Omit<LightstreamerEventEnvelope, "id" | "kind"> = {
    timestamp: 1, direction: "inbound", source: "server", captureSource: "listener", synthetic: false,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING", transport: "WS-STREAMING" },
    subscription: { id: "subscription", mode: "COMMAND", items: ["orders"], fields: ["command", "key", "qty"], active: true, subscribed: true }
  };
  const events: LightstreamerEventEnvelope[] = ["client-created", "client-status", "subscription-created", "subscription-started", "listener-added", "item-update"].map((kind, index) => ({
    ...base, id: `event-${index}`, kind: kind as LightstreamerEventEnvelope["kind"],
    ...(kind === "listener-added" || kind === "item-update" ? { listener: { id: "listener", callbacks: ["onItemUpdate"] } } : {}),
    ...(kind === "item-update" ? { item: { name: "orders", position: 1 }, update: { command: "ADD", key: "order-1", isSnapshot: false, fields: { command: "ADD", key: "order-1", qty: 1 }, changedFields: { command: "ADD", key: "order-1", qty: 1 } } } : {})
  }));
  const runtime = createWorkbenchRuntime({ history: createAuthoritativeHistory({ precommitted: events }), captureStatus: "capturing" });
  await new Promise(resolve => setTimeout(resolve, 0));
  runtime.dispatch({ type: "select-evidence", eventId: "event-5" });
  runtime.dispatch({ type: "begin-local-injection-from-selection" });
  runtime.dispatch({ type: "convert-local-injection-to-scenario" });
  runtime.dispatch({ type: "add-scenario-checkpoint" });
  const checkpoint = runtime.getSnapshot().scenario!.scenario.members.find((member): member is ScenarioCheckpoint => member.kind === "checkpoint")!;
  const authored: ScenarioCheckpoint = { ...checkpoint, assertions: [{ id: "primitive", kind: "command-field-equals", item: { name: "orders", position: 1 }, key: "order-1", field: "qty", expected: 1.5 }] };
  runtime.dispatch({ type: "update-scenario-checkpoint", checkpoint: authored });
  return { runtime, checkpoint: authored };
}

describe("pending Scenario primitive authoring", () => {
  it("blocks programmatic Review across Park and permits a corrected exact value", async () => {
    const { runtime } = await authoringRuntime();
    runtime.dispatch({ type: "set-scenario-assertion-authoring-validity", assertionId: "primitive", valid: false });
    runtime.dispatch({ type: "park-scenario" });
    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario).toMatchObject({ phase: "edit", run: null, membershipError: expect.stringContaining("Primitive JSON") });
    runtime.dispatch({ type: "resume-scenario" });
    runtime.dispatch({ type: "set-scenario-assertion-authoring-validity", assertionId: "primitive", valid: true });
    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario?.phase).toBe("review");
    const member = runtime.getSnapshot().scenario!.run!.members.find(member => member.kind === "checkpoint");
    expect(member).toMatchObject({ assertions: [{ expected: 1.5 }] });
    runtime.dispose();
  });

  it.each(["remove", "change kind"])("clears stale blocking when an invalid assertion is %s", async (action) => {
    const { runtime, checkpoint } = await authoringRuntime();
    runtime.dispatch({ type: "set-scenario-assertion-authoring-validity", assertionId: "primitive", valid: false });
    if (action === "remove") runtime.dispatch({ type: "remove-scenario-checkpoint", checkpointId: checkpoint.id });
    else runtime.dispatch({ type: "update-scenario-checkpoint", checkpoint: { ...checkpoint, assertions: [{ id: "primitive", kind: "correlated-local-evidence-exists", stepId: runtime.getSnapshot().scenario!.scenario.steps[0]!.id }] } });
    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario?.phase).toBe("review");
    runtime.dispose();
  });

  it("starts a new Scenario without a discarded author's invalid marker", async () => {
    const { runtime } = await authoringRuntime();
    const previousId = runtime.getSnapshot().scenario!.scenario.id;
    runtime.dispatch({ type: "set-scenario-assertion-authoring-validity", assertionId: "primitive", valid: false });
    runtime.dispatch({ type: "request-discard-scenario" });
    runtime.dispatch({ type: "confirm-discard-scenario" });
    runtime.dispatch({ type: "begin-local-injection-from-selection" });
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    expect(runtime.getSnapshot().scenario!.scenario.id).not.toBe(previousId);
    runtime.dispatch({ type: "review-scenario" });
    expect(runtime.getSnapshot().scenario?.phase).toBe("review");
    runtime.dispose();
  });
});
