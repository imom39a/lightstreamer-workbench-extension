import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { ScenarioClock } from "../src/core/local-injection-scenario-runner";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });

class TestClock implements ScenarioClock {
  private current = 0;
  private sequence = 0;
  private timers = new Map<number, { due: number; callback: () => void }>();
  now(): number { return this.current; }
  setTimer(callback: () => void, delayMs: number): number {
    const id = ++this.sequence;
    this.timers.set(id, { due: this.current + delayMs, callback });
    return id;
  }
  clearTimer(handle: unknown): void { this.timers.delete(Number(handle)); }
  advance(ms: number): void {
    this.current += ms;
    for (const [id, timer] of [...this.timers].filter(([, value]) => value.due <= this.current).sort((a, b) => a[1].due - b[1].due)) {
      if (this.timers.delete(id)) timer.callback();
    }
  }
}

function event(id: number, kind: LightstreamerEventEnvelope["kind"], update?: LightstreamerEventEnvelope["update"]): LightstreamerEventEnvelope {
  return {
    id: `absence-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING" },
    ...(kind === "client-created" || kind === "client-status" ? {} : { subscription: { id: "sub", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true } }),
    ...(kind === "listener-added" || kind === "item-update" ? { listener: { id: "listener", callbacks: ["onItemUpdate"] } } : {}),
    ...(kind === "item-update" ? { item: { name: "rows", position: 1 }, update } : {}),
    topology: { version: 1, kind: "item-observed", pageEpoch: "epoch", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } }
  };
}

async function fixture(coverage: "USEFUL" | "LIMITED", includeServerUpdate: boolean) {
  const history = createInMemoryEventHistory({ panelSessionId: crypto.randomUUID() });
  const clock = new TestClock();
  const executor = vi.fn(async () => ({ requestId: "local-delivery", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", capture: { operation: "RUNNING", coverage, firstMissingEventId: null, committedEvidenceBoundary: null }, scenarioClock: clock, localInjectionExecutor: { execute: executor } });
  runtimes.push(runtime);
  const seed = [
    event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"),
    event(4, "subscription-started"), event(5, "listener-added"),
    event(6, "item-update", { isSnapshot: false, command: "ADD", key: "row", fields: { command: "ADD", key: "row", qty: 1 }, changedFields: { command: "ADD", key: "row", qty: 1 } })
  ];
  for (const record of seed) await history.offer(record).settled;
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  const service = createAgentService(runtime.agent!, "panel", () => "local");
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
  const status = await call("get_status");
  const found = await call("query_evidence", { within: "page", includePayload: true, maxBytes: 65536 });
  const source = found.evidence.find((record: any) => record.identity.eventId === "absence-6").identity;
  const prepared = await call("prepare_scenario", { pageEpoch: status.pageEpoch, members: [
    { kind: "step", id: "local-update", evidence: source, document: { command: "UPDATE", key: "row", isSnapshot: false, fields: { command: "UPDATE", key: "row", qty: 2 } } },
    { kind: "checkpoint", id: "absence-check", name: "Observe bounded absence", assertions: [
      { id: "absence", kind: "server-item-update-absent", item: { name: "rows", position: 1 }, duringActiveMs: 20 }
    ] }
  ] });
  const runId = prepared.scenario.run.id;
  await call("control_scenario", { runId, requestId: "step-local", action: "step" });
  await vi.waitFor(() => expect(runtime.getSnapshot().scenario?.run?.trace.some(entry => entry.kind === "attempted")).toBe(true));
  await call("control_scenario", { runId, requestId: "play-checkpoint", action: "play" });
  clock.advance(0);
  if (coverage === "LIMITED") {
    await vi.waitFor(() => expect(runtime.getSnapshot().scenario?.phase).toBe("stopped"));
  } else {
    await vi.waitFor(() => expect(runtime.getSnapshot().scenario?.runner?.activeCheckpoint?.status).toBe("waiting"));
    if (includeServerUpdate) {
      await history.offer(event(7, "item-update", { isSnapshot: false, command: "UPDATE", key: "row", fields: { command: "UPDATE", key: "row", qty: 9 }, changedFields: { qty: 9 } })).settled;
    }
    clock.advance(20);
    await vi.waitFor(() => expect(["complete", "stopped"]).toContain(runtime.getSnapshot().scenario?.phase));
  }
  const checkpoint = runtime.getSnapshot().scenario!.run!.trace.find(entry => entry.kind === "checkpoint");
  return { checkpoint, runtime, executor };
}

describe("bounded Server Item Update absence through the Workbench runtime", () => {
  it("passes a healthy complete absence window", async () => {
    const { checkpoint } = await fixture("USEFUL", false);
    expect(checkpoint).toMatchObject({ kind: "checkpoint", status: "pass", assertions: [{ status: "pass", observed: { state: "absent-over-observed-window" } }] });
  });

  it("fails when a matching Server Item Update is committed in the exact target window", async () => {
    const { checkpoint } = await fixture("USEFUL", true);
    expect(checkpoint).toMatchObject({ kind: "checkpoint", status: "fail", assertions: [{ status: "fail", observed: { state: "fail" } }] });
  });

  it("is inconclusive when Observation Coverage is limited", async () => {
    const { checkpoint } = await fixture("LIMITED", false);
    expect(checkpoint).toMatchObject({ kind: "checkpoint", status: "inconclusive", assertions: [{ status: "inconclusive", observed: { state: "inconclusive" } }] });
  });
});
