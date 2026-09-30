import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentConnection } from "../src/extension/panel/agent-connection";
import { createBrokerRouter } from "../src/agent/companion/router";
import { connectPortable } from "../src/agent/portable-channel";
import type { AgentRuntime } from "../src/extension/panel/agent-runtime";
import type { WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";
import { createAuthoritativeHistory } from "./support/authoritative-history";

vi.mock("../src/agent/portable-channel", () => ({ connectPortable: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function connected(runtime: WorkbenchRuntime) {
  let read = (_value: Record<string, unknown>) => {};
  let route: ReturnType<ReturnType<typeof createBrokerRouter>["join"]> | undefined;
  const router = createBrokerRouter();
  const send = vi.fn((value: any) => {
    if (value.type === "hello") route = router.join({ send: value => read(value), close() {} }, value);
    else route?.receive(value);
  });
  const channel = { send, close() { route?.close(); }, onMessage(callback: typeof read) { read = callback; }, onClose() {} };
  vi.mocked(connectPortable).mockResolvedValue(channel);
  vi.stubGlobal("chrome", { runtime: { getURL: () => `chrome-extension://${"a".repeat(32)}/` }, devtools: { inspectedWindow: { tabId: 7, eval: (_expression: string, callback: (value: string) => void) => callback("https://fixture.test/app") } } });
  const connection = createAgentConnection(runtime, "panel");
  await vi.waitFor(() => expect(connection.getSnapshot().status).toBe("connected"));
  function peer() {
    const replies: any[] = [];
    return { replies, route: router.join({ send: value => replies.push(value), close() {} }, { role: "agent" }) };
  }
  return { router, connection, send, peer, read: (value: Record<string, unknown>) => read(value) };
}

describe("bounded cancellation ownership across panel requests", () => {
  it("bounds abandoned providers per agent, frees active routes, and reserves inspection for another agent", async () => {
    const releases: Array<(value: any) => void> = [], signals: AbortSignal[] = [];
    const diagnostics = vi.fn((_after: unknown, signal?: AbortSignal) => { if (signal) signals.push(signal); return new Promise<any>(resolve => releases.push(resolve)); });
    const agent = { status: () => ({ pageEpoch: "page", visible: true }), local: () => ({ draft: null }), diagnostics } as unknown as AgentRuntime;
    const f = await connected({ agent, subscribe: () => () => {} } as unknown as WorkbenchRuntime);
    const first = f.peer(), second = f.peer();
    try {
      for (let index = 0; index < 64; index++) {
        first.route.receive({ id: `first-${index}`, name: "query_diagnostics", args: { panelSessionId: "panel" } });
        first.route.receive({ type: "cancel", id: `first-${index}` });
      }
      await Promise.resolve();
      expect(diagnostics).toHaveBeenCalledTimes(16);
      expect(signals).toHaveLength(16);
      expect(signals.every(signal => signal.aborted)).toBe(true);
      expect(first.replies.some(value => value.error?.startsWith("REQUEST_CAPACITY:"))).toBe(true);
      second.route.receive({ id: "status", name: "get_status", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(second.replies).toContainEqual(expect.objectContaining({ id: "status", result: expect.objectContaining({ pageEpoch: "page" }) })));
      second.route.receive({ id: "diagnostics", name: "query_diagnostics", args: { panelSessionId: "panel" } });
      expect(diagnostics).toHaveBeenCalledTimes(17);
      // Uncooperative provider work remains accounted through a panel reconnect.
      f.connection.disconnect(); f.connection.connect();
      await vi.waitFor(() => expect(f.connection.getSnapshot().status).toBe("connected"));
      first.route.receive({ id: "after-reconnect", name: "query_diagnostics", args: { panelSessionId: "panel" } });
      expect(diagnostics).toHaveBeenCalledTimes(17);
      expect(first.replies.at(-1)).toMatchObject({ id: "after-reconnect", error: expect.stringMatching(/^REQUEST_CAPACITY:/) });
      for (const release of releases) release({ observations: [] });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.send.mock.calls.filter(([value]) => typeof value.id === "string" && (value.result || value.error?.startsWith("QUERY_CANCELLED:")))).toHaveLength(1); // Only the completed status reply.
      first.route.receive({ id: "after-settlement", name: "query_diagnostics", args: { panelSessionId: "panel" } });
      expect(diagnostics).toHaveBeenCalledTimes(18);
      releases.at(-1)!({ observations: [] });
      await vi.waitFor(() => expect(first.replies).toContainEqual(expect.objectContaining({ id: "after-settlement", result: expect.any(Object) })));
    } finally { f.connection.dispose(); f.router.dispose(); for (const release of releases) release({ observations: [] }); }
  });

  it("forwards cancellation into the actual runtime diagnostic journal seam and suppresses late output", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "runtime" });
    const releases: Array<() => void> = [];
    const query = vi.fn(() => new Promise<any>(resolve => releases.push(() => resolve({ observations: [], currentBoundary: null }))));
    const runtime = createWorkbenchRuntime({ history: createAuthoritativeHistory(), diagnosticObservations: { ...journal, query } });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.loading).toBe(false));
    const diagnostics = vi.spyOn(runtime.agent!, "diagnostics");
    const f = await connected(runtime), first = f.peer(), second = f.peer();
    try {
      first.route.receive({ id: "slow", name: "query_diagnostics", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
      first.route.receive({ type: "cancel", id: "slow" });
      expect(diagnostics.mock.calls[0]![1]?.aborted).toBe(true);
      second.route.receive({ id: "status", name: "get_status", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(second.replies.some(value => value.id === "status" && value.result)).toBe(true));
      releases[0]!(); await new Promise(resolve => setTimeout(resolve, 0));
      expect(first.replies.filter(value => value.id === "slow")).toEqual([expect.objectContaining({ error: expect.stringMatching(/^QUERY_CANCELLED:/) })]);
      expect(f.send.mock.calls.filter(([value]) => value.error?.startsWith("QUERY_CANCELLED:"))).toHaveLength(0);
    } finally { f.connection.dispose(); f.router.dispose(); releases.forEach(release => release()); await runtime.disposeAndWait(); }
  });

  it("caps all slow provider work at 48 while retaining reserved status capacity", async () => {
    const releases: Array<(value: any) => void> = [];
    const diagnostics = vi.fn(() => new Promise<any>(resolve => releases.push(resolve)));
    const agent = { status: () => ({ pageEpoch: "page", visible: true }), local: () => ({ draft: null }), diagnostics } as unknown as AgentRuntime;
    const f = await connected({ agent, subscribe: () => () => {} } as unknown as WorkbenchRuntime);
    const owners = Array.from({ length: 4 }, () => f.peer());
    try {
      for (const [owner, peer] of owners.entries()) for (let index = 0; index < 16; index++) {
        const id = `${owner}-${index}`;
        peer.route.receive({ id, name: "query_diagnostics", args: { panelSessionId: "panel" } });
        peer.route.receive({ type: "cancel", id });
      }
      expect(diagnostics).toHaveBeenCalledTimes(48);
      expect(owners[3]!.replies.some(value => value.error?.startsWith("REQUEST_CAPACITY:"))).toBe(true);
      owners[3]!.route.receive({ id: "status", name: "get_status", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(owners[3]!.replies.some(value => value.id === "status" && value.result)).toBe(true));
    } finally { f.connection.dispose(); f.router.dispose(); for (const release of releases) release({ observations: [] }); }
  });

  it("bounds pending status identity lookups and cancels them without late publication", async () => {
    const agent = { status: () => ({ pageEpoch: "page", visible: true }), local: () => ({ draft: null }) } as unknown as AgentRuntime;
    const f = await connected({ agent, subscribe: () => () => {} } as unknown as WorkbenchRuntime);
    const callbacks: Array<(value: string) => void> = [];
    chrome.devtools.inspectedWindow.eval = vi.fn((_expression, callback: any) => callbacks.push(callback));
    const first = f.peer(), second = f.peer();
    try {
      for (let index = 0; index < 16; index++) first.route.receive({ id: `status-${index}`, name: "get_status", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(callbacks).toHaveLength(16));
      second.route.receive({ id: "over-cap", name: "get_status", args: { panelSessionId: "panel" } });
      expect(second.replies.at(-1)).toMatchObject({ id: "over-cap", error: expect.stringMatching(/^REQUEST_CAPACITY:/) });
      for (let index = 0; index < 16; index++) first.route.receive({ type: "cancel", id: `status-${index}` });
      await new Promise(resolve => setTimeout(resolve, 0));
      second.route.receive({ id: "after-cancel", name: "get_status", args: { panelSessionId: "panel" } });
      await vi.waitFor(() => expect(callbacks).toHaveLength(17));
      callbacks.forEach(callback => callback("https://fixture.test/after-cancel"));
      await vi.waitFor(() => expect(second.replies.some(value => value.id === "after-cancel" && value.result)).toBe(true));
      expect(first.replies.filter(value => value.id?.startsWith("status-") && value.result)).toHaveLength(0);
      expect(f.send.mock.calls.filter(([value]) => value.result)).toHaveLength(1);
    } finally { f.connection.dispose(); f.router.dispose(); }
  });
});
