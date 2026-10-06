import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentService } from "../src/extension/panel/agent-service";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAuthoritativeHistory } from "./support/authoritative-history";

const runtimes: WorkbenchRuntime[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(runtimes.splice(0).map(runtime => runtime.disposeAndWait())); });
function event(id: number, kind: LightstreamerEventEnvelope["kind"]): LightstreamerEventEnvelope {
  return { id: `recovery-${id}`, timestamp: id, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind,
    client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub", mode: "COMMAND", items: ["rows"], fields: ["command", "key", "qty"], active: true, subscribed: true },
    listener: { id: "listener", callbacks: ["onItemUpdate"] }, item: { name: "rows", position: 1 },
    topology: { version: 1, kind: "item-observed", pageEpoch: "epoch", captureSequence: id, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
    ...(kind === "item-update" ? { update: { command: "ADD", key: "row", isSnapshot: false, fields: { command: "ADD", key: "row", qty: 1 }, changedFields: { command: "ADD", key: "row", qty: 1 } } } : {}) };
}
async function fixture() {
  const history = createAuthoritativeHistory({ precommitted: [event(1, "client-created"), event(2, "client-status"), event(3, "subscription-created"), event(4, "subscription-started"), event(5, "listener-added"), event(6, "item-update")] });
  const execute = vi.fn(async () => ({ requestId: "wire", ok: true, status: "success" as const, timestamp: 10, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute } }); runtimes.push(runtime);
  await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
  let permission: "local" | "read" | "off" = "local";
  const service = createAgentService(runtime.agent!, "panel", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => service.call(name, { panelSessionId: "panel", ...args }, { signal }) as Promise<any>;
  const evidence = (await call("query_evidence", { within: "page" })).evidence.find((row: any) => row.identity.eventId === "recovery-6").identity;
  const pageEpoch = (await call("get_status")).pageEpoch;
  return { runtime, service, execute, evidence, pageEpoch, call, grant(value: typeof permission) { permission = value; } };
}
const document = (qty = 1) => ({ command: "ADD", key: "row", isSnapshot: false, fields: { command: "ADD", key: "row", qty } });

describe("recoverable agent document publication", () => {
  it.each(["prepare_local_injection", "prepare_scenario"])("cancels %s before final publication", async name => {
    const { runtime, call, evidence, pageEpoch, execute } = await fixture();
    let release!: () => void;
    const original = runtime.agent!.query;
    vi.spyOn(runtime.agent!, "query").mockImplementationOnce(async input => { await new Promise<void>(resolve => { release = resolve; }); return original(input); });
    const controller = new AbortController();
    const args = name === "prepare_scenario" ? { members: [{ kind: "step", id: "one", evidence }] } : { evidence };
    const pending = call(name, { pageEpoch, requestId: "cancelled", ...args }, controller.signal);
    const rejected = expect(pending).rejects.toThrow("QUERY_CANCELLED");
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); controller.abort(); release(); await rejected;
    expect(runtime.agent!.local().draft).toBeNull(); expect(runtime.agent!.scenario()).toBeNull(); expect(execute).not.toHaveBeenCalled();
    expect((await call(name, { pageEpoch, requestId: "replacement", ...args })).token).toBeTruthy();
  });

  it("recovers and reuses a lost prepare reply without another publication", async () => {
    const { runtime, call, evidence, pageEpoch } = await fixture();
    const prepare = vi.spyOn(runtime.agent!, "prepare");
    const args = { requestId: "prepare", evidence, pageEpoch, document: document() };
    const first = await call("prepare_local_injection", args);
    const recovered = await call("recover_agent_document", { requestId: "prepare" });
    expect(recovered.token).toBe(first.token);
    expect((await call("prepare_local_injection", args)).token).toBe(first.token); expect(prepare).toHaveBeenCalledTimes(1);
    await expect(call("prepare_local_injection", { ...args, document: document(2) })).rejects.toThrow("REQUEST_ID_CONFLICT");
  });

  it("recovers a rotated edit token and rejects a superseded receipt", async () => {
    const { runtime, call, evidence, pageEpoch } = await fixture();
    const prepared = await call("prepare_local_injection", { requestId: "prepare", evidence, pageEpoch });
    const edit = vi.spyOn(runtime.agent!, "edit");
    const args = { requestId: "edit", token: prepared.token, document: document(2) };
    const updated = await call("update_agent_document", args);
    expect(updated.token).not.toBe(prepared.token);
    expect((await call("recover_agent_document", { requestId: "edit" })).token).toBe(updated.token);
    expect((await call("update_agent_document", args)).token).toBe(updated.token); expect(edit).toHaveBeenCalledTimes(1);
    await expect(call("recover_agent_document", { requestId: "prepare" })).rejects.toThrow("TARGET_CHANGED");
    expect((await call("recover_agent_document")).token).toBe(updated.token);
  });

  it("protects human edits and denies token recovery to an inspection-only grant", async () => {
    const { runtime, call, evidence, pageEpoch, grant } = await fixture();
    const prepared = await call("prepare_local_injection", { requestId: "prepare", evidence, pageEpoch });
    grant("read"); await expect(call("recover_agent_document", { requestId: "prepare" })).rejects.toThrow("ACCESS_REVOKED"); grant("local");
    runtime.dispatch({ type: "set-local-injection-json", text: JSON.stringify(document(9)) });
    await expect(call("recover_agent_document", { requestId: "prepare" })).rejects.toThrow("TARGET_CHANGED");
    await expect(call("abort_agent_document", { token: prepared.token })).rejects.toThrow("TARGET_CHANGED");
    expect(runtime.agent!.local().draft?.document?.fields.qty).toBe(9);
  });

  it.each(["prepare_local_injection", "prepare_scenario"])("aborts only an unchanged unexecuted %s", async name => {
    const { runtime, call, evidence, pageEpoch, execute } = await fixture();
    const args = name === "prepare_scenario" ? { members: [{ kind: "step", id: "one", evidence }] } : { evidence };
    const prepared = await call(name, { pageEpoch, requestId: "prepare", ...args });
    expect(await call("abort_agent_document", { token: prepared.token })).toEqual({ aborted: true });
    expect(runtime.agent!.local().draft).toBeNull(); expect(runtime.agent!.scenario()).toBeNull(); expect(execute).not.toHaveBeenCalled();
    expect((await call(name, { pageEpoch, requestId: "next", ...args })).token).toBeTruthy();
  });

  it("keeps execute-once receipts correlated to exact committed Evidence", async () => {
    const { call, evidence, pageEpoch, execute } = await fixture();
    const prepared = await call("prepare_local_injection", { requestId: "prepare", evidence, pageEpoch });
    const args = { token: prepared.token, requestId: "execute" }; await call("execute_local_injection", args);
    await vi.waitFor(async () => expect((await call("get_operation", { requestId: "execute" })).state).toBe("complete"));
    const receipt = await call("get_operation", { requestId: "execute" });
    expect(receipt.evidence.state).toBe("committed");
    expect((await call("get_evidence", { evidence: receipt.evidence.identity })).lookup.evidence.identity).toEqual(receipt.evidence.identity);
    await call("execute_local_injection", args); expect(execute).toHaveBeenCalledTimes(1);
    await expect(call("abort_agent_document", { token: prepared.token })).rejects.toThrow("TARGET_CHANGED");
  });
});
