import { describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import type { AgentCommandStateInput, AgentCommandStateResult } from "../src/extension/panel/agent-command-state";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";

function event(sequence: number, kind: LightstreamerEventEnvelope["kind"], key = " row", synthetic = false): LightstreamerEventEnvelope {
  return {
    id: `event-${sequence}`, timestamp: sequence, direction: "inbound", source: synthetic ? "synthetic" : "server", captureSource: "listener", synthetic, kind,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "subscription", mode: "COMMAND", items: ["orders"], fields: ["command", "key", "value"], active: true, subscribed: true },
    listener: { id: "listener", callbacks: ["onItemUpdate"] }, item: { name: "orders", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "page", captureSequence: sequence, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { command: "ADD", key, isSnapshot: false, fields: { command: "ADD", key, value: `value-${sequence}` }, changedFields: { command: "ADD", key, value: `value-${sequence}` } } } : {})
  };
}

async function fixture(onCommit?: (runtime: WorkbenchRuntime, input: AgentCommandStateInput) => void) {
  const history = createAuthoritativeHistory({ precommitted: [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update")] });
  let input: AgentCommandStateInput | undefined;
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", performanceHooks: { onCommittedEvidenceBoundary: () => { if (input) onCommit?.(runtime, input); } } });
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const scope = runtime.agent!.scopeSearchSnapshot().nodes.find(node => node.kind === "item")!;
  input = { scopeId: scope.id, pageEpoch: "page", projection: "observed-server", item: { name: "orders", position: 1 }, key: " row", fields: ["value"] };
  const service = createAgentService(runtime.agent!, "panel", () => "read");
  return { runtime, history, input, service };
}

describe("COMMAND agent read through Workbench runtime and service", () => {
  it("returns a reusable Evidence read point and exact retained provenance without altering the human view", async () => {
    const { runtime, service, input } = await fixture();
    try {
      const before = runtime.getSnapshot();
      const result = await service.call("query_command_state", { panelSessionId: "panel", ...input }) as Extract<AgentCommandStateResult, { status: "ok" }>;
      expect(result).toMatchObject({ status: "ok", presence: { state: "present", provenance: { evidence: { intervalId: "authoritative-test:interval-1", pageId: "authoritative-test:interval-1", ownerId: "memory-event-history", sequence: 6, eventId: "event-6" }, evidenceRetained: true } }, readPoint: { interval: { ordinal: 1 }, committedEvidenceBoundary: { sequence: 6, ownerId: "memory-event-history" } } });
      const query = await service.call("query_evidence", { panelSessionId: "panel", within: "page", at: result.readPoint }) as { readPoint: unknown };
      expect(query.readPoint).toEqual(result.readPoint);
      const evidence = await service.call("get_evidence", { panelSessionId: "panel", evidence: result.presence.provenance!.evidence, fields: ["value"] });
      expect(JSON.stringify(evidence)).toContain("event-6");
      expect(JSON.stringify(evidence)).toContain("value-6");
      expect(runtime.getSnapshot().scopeId).toBe(before.scopeId);
      expect(runtime.getSnapshot().selectionEventId).toBe(before.selectionEventId);
    } finally { await runtime.disposeAndWait(); }
  });

  it("reads only through the completed projection boundary during a reentrant commit hook", async () => {
    let during: AgentCommandStateResult | undefined;
    const { runtime, history, input } = await fixture((active, target) => { during = active.agent!.commandState!(target); });
    try {
      await history.offer(event(7, "item-update")).settled;
      expect(during).toMatchObject({ readPoint: { committedEvidenceBoundary: { sequence: 6 }, retainedRange: { last: { sequence: 6 } } }, fields: [{ value: "value-6" }] });
      expect(runtime.agent!.commandState!(input)).toMatchObject({ readPoint: { committedEvidenceBoundary: { sequence: 7 } }, fields: [{ value: "value-7" }] });
      await history.offer(event(8, "clear-snapshot")).settled;
      expect(runtime.agent!.commandState!(input)).toMatchObject({ presence: { state: "absent", basis: "clear-snapshot", provenance: { evidence: { sequence: 8 } } } });
    } finally { await runtime.disposeAndWait(); }
  });
});
