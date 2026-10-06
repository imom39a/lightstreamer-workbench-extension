import { describe, expect, it, vi } from "vitest";
import { createAgentService } from "../src/extension/panel/agent-service";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import { validateAgentCall } from "../src/agent/protocol";

function fixture() {
  let approved = false;
  let current: any = null;
  const prepareServerInjection = vi.fn((draft: any, requestId: string) => {
    current = { draft: { agentRequestId: requestId, value: { ...draft }, agentApproved: approved, outcome: null } };
  });
  const send = vi.fn(async (requestId: string) => ({ requestId, ok: true, status: "processed", timestamp: 1 }));
  const runtime = {
    status: () => ({}), local: () => ({ draft: null }), scenario: () => null,
    prepareServerInjection,
    serverInjection: () => current,
    executeApprovedServerInjection: async (requestId: string) => {
      if (!approved) throw new Error("HUMAN_APPROVAL_REQUIRED: approve in Workbench");
      return send(requestId);
    },
    abortServerInjection: vi.fn(() => { current = null; }),
    revokeServerInjectionApproval: () => { approved = false; if (current?.draft) current.draft.agentApproved = false; }
  } as unknown as AgentRuntime;
  let permission: "local" | "read" | "off" = "local";
  const service = createAgentService(runtime, "panel", () => permission);
  const call = (name: string, args: Record<string, unknown> = {}) => service.call(name, { panelSessionId: "panel", ...args }) as Promise<any>;
  return { runtime, service, call, prepareServerInjection, send, grant(value: typeof permission) { permission = value; }, approve() { approved = true; if (current?.draft) current.draft.agentApproved = true; } };
}
const draft = { pageEpoch: "epoch", clientId: "client", sessionId: "session", message: "order=17", sequence: "orders", delayTimeout: null, enqueueWhileDisconnected: false };

describe("reviewed agent Server Injection", () => {
  it("prepares visibly but cannot approve, sends once after approval, and recovers its exact receipt", async () => {
    const { call, prepareServerInjection, send, approve } = fixture();
    const args = { ...draft, requestId: "server-1" };
    const prepared = await call("prepare_server_injection", args);
    expect(prepared.approvalRequired).toBe(true);
    expect(prepareServerInjection).toHaveBeenCalledTimes(1);
    expect((await call("prepare_server_injection", args)).token).toBe(prepared.token);
    await expect(call("prepare_server_injection", { ...args, message: "different" })).rejects.toThrow("REQUEST_ID_CONFLICT");
    await expect(call("execute_local_injection", { token: "unrelated", requestId: args.requestId })).rejects.toThrow("REQUEST_ID_CONFLICT");
    await expect(call("execute_server_injection", { token: prepared.token, requestId: args.requestId })).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
    expect(send).not.toHaveBeenCalled();
    approve();
    const result = await call("execute_server_injection", { token: prepared.token, requestId: args.requestId });
    expect(result).toMatchObject({ state: "complete", outcome: { requestId: "server-1" } });
    expect(await call("execute_server_injection", { token: prepared.token, requestId: args.requestId })).toEqual(result);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await call("get_operation", { requestId: args.requestId })).toMatchObject({ requestId: args.requestId, state: "complete", outcome: { requestId: "server-1" } });
    expect(await call("recover_server_injection", { requestId: args.requestId })).toMatchObject({ state: "complete", outcome: { requestId: "server-1" }, approvalRequired: true });
  });

  it("keeps local access separate from approval and revokes the approval latch", async () => {
    const { call, grant, approve, service, send } = fixture();
    grant("read");
    const readStatus = await call("get_status");
    expect(readStatus.capabilities).not.toContain("recover_server_injection");
    await expect(call("prepare_server_injection", { ...draft, requestId: "server-2" })).rejects.toThrow("ACCESS_REVOKED");
    grant("local");
    const localStatus = await call("get_status");
    expect(localStatus.capabilities).toContain("recover_server_injection");
    const prepared = await call("prepare_server_injection", { ...draft, requestId: "server-2" });
    approve();
    service.revoke();
    await expect(call("execute_server_injection", { token: prepared.token, requestId: "server-2" })).rejects.toThrow("HUMAN_APPROVAL_REQUIRED");
    expect(send).not.toHaveBeenCalled();
  });

  it("validates exact bounded message/target arguments and guarded abort", async () => {
    validateAgentCall("prepare_server_injection", { panelSessionId: "panel", ...draft, requestId: "id" });
    expect(() => validateAgentCall("prepare_server_injection", { panelSessionId: "panel", ...draft, message: "😀".repeat(20_000), requestId: "id" })).toThrow("DOCUMENT_BUDGET_EXCEEDED");
    const { call, runtime } = fixture();
    const prepared = await call("prepare_server_injection", { ...draft, requestId: "server-3" });
    expect(await call("abort_server_injection", { token: prepared.token })).toEqual({ aborted: true });
    expect(runtime.abortServerInjection).toHaveBeenCalledWith("server-3");
    await expect(call("execute_server_injection", { token: prepared.token, requestId: "server-3" })).rejects.toThrow("TARGET_CHANGED");
  });

  it("settles a terminal unknown receipt after an executor rejection and never retries", async () => {
    const { call, runtime, approve, send } = fixture();
    const prepared = await call("prepare_server_injection", { ...draft, requestId: "server-rejected" });
    approve();
    (runtime as unknown as { executeApprovedServerInjection: (id: string) => Promise<never> }).executeApprovedServerInjection = async () => {
      throw new Error("bridge lost the outcome after the send started");
    };

    const first = await call("execute_server_injection", { token: prepared.token, requestId: "server-rejected" });
    expect(first).toMatchObject({ state: "complete", outcome: { status: "unknown", requestId: "server-rejected" } });
    expect(first.outcome.error).toContain("Do not repeat automatically");
    expect(await call("execute_server_injection", { token: prepared.token, requestId: "server-rejected" })).toEqual(first);
    expect(await call("get_operation", { requestId: "server-rejected" })).toMatchObject(first);
    expect(await call("recover_server_injection", { requestId: "server-rejected" })).toMatchObject({ outcome: first.outcome });
    expect(send).not.toHaveBeenCalled();
  });

  it("never attaches a newer document outcome to an older request receipt", async () => {
    const { call, runtime } = fixture();
    await call("prepare_server_injection", { ...draft, requestId: "server-old" });
    await call("prepare_server_injection", { ...draft, message: "new message", requestId: "server-new" });
    const current = (runtime as unknown as { serverInjection: () => any }).serverInjection();
    current.draft.outcome = { requestId: "human-current", status: "processed" };

    const recovered = await call("recover_server_injection", { requestId: "server-old" });
    expect(recovered).toMatchObject({ requestId: "server-old", outcome: null, previewOmitted: expect.any(String) });
    expect(recovered.outcome).not.toEqual(current.draft.outcome);
  });
});
