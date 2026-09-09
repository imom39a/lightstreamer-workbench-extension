import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntime, type WorkbenchSnapshot } from "../src/extension/panel/workbench-runtime";
import { observeWorkbenchAnalytics } from "../src/extension/analytics/observer";
import type { AnalyticsClient, AnalyticsPreference } from "../src/extension/analytics/client";
import type { AnalyticsEvent } from "../src/extension/analytics/events";

function fixture() {
  const runtime = createWorkbenchRuntime();
  let snapshot = runtime.getSnapshot();
  runtime.dispose();
  const listeners = new Set<() => void>();
  const preferences = new Set<() => void>();
  let preference: AnalyticsPreference = { enabled: true, configured: true, ready: true, saving: false, error: false };
  const events: AnalyticsEvent[] = [];
  const client: AnalyticsClient = {
    getSnapshot: () => preference,
    subscribe(listener) { preferences.add(listener); return () => preferences.delete(listener); },
    async setEnabled(enabled) { preference = { ...preference, enabled }; preferences.forEach(listener => listener()); },
    track: event => events.push(event),
    dispose() {}
  };
  const observedRuntime: WorkbenchRuntime = { ...runtime, getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, dispatch() {}, dispose() {}, disposeAndWait: async () => {} };
  const observer = observeWorkbenchAnalytics(observedRuntime, client, window);
  const publish = (change: Partial<WorkbenchSnapshot>) => { snapshot = { ...snapshot, ...change }; listeners.forEach(listener => listener()); };
  return { observer, events, client, publish, snapshot: () => snapshot, listeners };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Workbench journey observation", () => {
  it("reports panel/screens and first Capture once without counting a passive feed as interaction", () => {
    const f = fixture();
    f.publish({ retention: { ...f.snapshot().retention, historyStatus: { ...f.snapshot().retention.historyStatus, captured: 1 } } });
    f.publish({ contextId: "raw:private-event-123" });
    const count = f.events.length;
    for (let i = 0; i < 1000; i++) f.publish({ version: i });
    expect(f.events).toHaveLength(count);
    expect(f.events.filter(event => event.name === "capture_ready")).toHaveLength(1);
    expect(f.events).toContainEqual(expect.objectContaining({ name: "page_view", params: { screen: "raw_evidence" } }));
    expect(JSON.stringify(f.events)).not.toContain("private-event");
    f.observer.dispose();
    f.observer.dispose();
    expect(f.events.filter(event => event.name === "panel_closed")).toHaveLength(1);
    expect(f.listeners.size).toBe(0);
  });

  it("debounces Find and excludes query text and private command values", async () => {
    vi.useFakeTimers();
    const f = fixture();
    for (const value of ["p", "private account", "token=secret"]) f.observer.command({ type: "set-find", value });
    f.observer.command({ type: "select-evidence", eventId: "private-evidence" });
    f.observer.command({ type: "select-evidence", eventId: "another-private-evidence" });
    f.observer.command({ type: "set-server-injection-message", message: "confidential message" });
    f.publish({ evidence: { ...f.snapshot().evidence, investigation: { ...f.snapshot().evidence.investigation, queryState: "ready" } } });
    await vi.advanceTimersByTimeAsync(800);
    expect(f.events.filter(event => event.name === "find_result")).toHaveLength(1);
    expect(f.events.filter(event => event.name === "feature_used" && event.params.feature === "evidence")).toHaveLength(1);
    expect(JSON.stringify(f.events)).not.toMatch(/private|secret|confidential/);
    f.observer.dispose();
  });

  it("waits for completed Find results and drops a query that is cleared while loading", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.observer.command({ type: "set-find", value: "private slow query" });
    f.publish({ evidence: { ...f.snapshot().evidence, investigation: { ...f.snapshot().evidence.investigation, queryState: "loading" } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.events.filter(event => event.name === "find_result")).toHaveLength(0);
    f.publish({ evidence: { ...f.snapshot().evidence, findState: { ...f.snapshot().evidence.findState, matchCount: 3 }, investigation: { ...f.snapshot().evidence.investigation, queryState: "ready" } } });
    expect(f.events.filter(event => event.name === "find_result")).toEqual([expect.objectContaining({ params: { result: "many" } })]);
    f.observer.command({ type: "set-find", value: "another private query" });
    f.publish({ evidence: { ...f.snapshot().evidence, investigation: { ...f.snapshot().evidence.investigation, queryState: "loading" } } });
    await vi.advanceTimersByTimeAsync(800);
    f.observer.command({ type: "clear-find" });
    f.publish({ evidence: { ...f.snapshot().evidence, investigation: { ...f.snapshot().evidence.investigation, queryState: "ready" } } });
    expect(f.events.filter(event => event.name === "find_result")).toHaveLength(1);
    f.observer.dispose();
  });

  it("does not report a failed Filter query as applied or empty", () => {
    const f = fixture();
    f.observer.command({ type: "apply-filter-builder", expectedRevision: 0, operations: [] });
    f.publish({ evidence: { ...f.snapshot().evidence, investigation: { ...f.snapshot().evidence.investigation, queryState: "error" } } });
    expect(f.events.filter(event => event.name === "filter_result")).toEqual([expect.objectContaining({ params: { outcome: "failed" } })]);
    f.observer.dispose();
  });

  it("records injection outcomes once even when immutable snapshots reconstruct the same outcome", () => {
    const f = fixture();
    const outcome = { requestId: "private-request", ok: false, status: "denied" as const, timestamp: 1, error: "private server details" };
    const serverInjection = { ...f.snapshot().serverInjection!, state: "active" as const, draft: { id: "private-draft", phase: "outcome" as const, source: { kind: "authored" as const, eventId: null }, outcome } } as NonNullable<WorkbenchSnapshot["serverInjection"]>;
    f.publish({ serverInjection });
    f.publish({ serverInjection: { ...serverInjection, draft: { ...serverInjection.draft!, outcome: { ...outcome } } } });
    expect(f.events.filter(event => event.name === "injection_started")).toHaveLength(1);
    expect(f.events.filter(event => event.name === "injection_result")).toHaveLength(1);
    expect(f.events).toContainEqual(expect.objectContaining({ name: "injection_result", params: { injection_type: "server", outcome: "denied" } }));
    expect(JSON.stringify(f.events)).not.toContain("private");
    f.observer.dispose();
  });

  it("does not accrue engagement while DevTools hides the panel without publishing a runtime snapshot", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const f = fixture();
    await vi.advanceTimersByTimeAsync(5000);
    f.observer.setVisible(false);
    const count = f.events.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.events).toHaveLength(count);
    f.observer.setVisible(true);
    f.observer.command({ type: "open-context" });
    expect(f.events.at(-1)?.engagement_time_msec).toBe(0);
    f.observer.dispose();
  });

  it("drops pending Find on opt-out and does not replay a completed injection on opt-in", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.observer.command({ type: "set-find", value: "private query" });
    await f.client.setEnabled(false);
    const count = f.events.length;
    await vi.advanceTimersByTimeAsync(31_000);
    f.publish({ contextId: "context:actions" });
    expect(f.events).toHaveLength(count);
    await f.client.setEnabled(true);
    expect(f.events.filter(event => event.name === "find_result")).toHaveLength(0);
    expect(f.events.at(-1)).toMatchObject({ name: "page_view", params: { screen: "session_operations" } });
    f.observer.dispose();
  });
});
