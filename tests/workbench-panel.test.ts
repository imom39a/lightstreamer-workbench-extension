import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  type WorkbenchCommand,
  type WorkbenchRuntime,
  type WorkbenchSnapshot
} from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRuntime = WorkbenchRuntime & {
  setSnapshot(snapshot: WorkbenchSnapshot): void;
  commands: WorkbenchCommand[];
};

function createTestRuntime(snapshot: WorkbenchSnapshot): TestRuntime {
  const listeners = new Set<() => void>();
  const commands: WorkbenchCommand[] = [];
  let current = snapshot;

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      commands.push(command);
    },
    dispose: vi.fn(),
    setSnapshot(next) {
      current = next;
      listeners.forEach((listener) => listener());
    },
    commands
  };
}

function snapshot(overrides: Record<string, unknown> = {}): WorkbenchSnapshot {
  return {
    version: 0,
    visible: true,
    captureStatus: "capturing",
    capture: { operation: "RUNNING", coverage: "USEFUL" },
    theme: "dark",
    evidence: {
      loading: false,
      total: 2,
      windowSize: 60,
      mode: "live",
      newerCount: 0,
      offset: 0,
      visibleStart: 1,
      visibleEnd: 2,
      hasOlder: false,
      hasNewer: false,
      filters: {},
      find: "",
      findState: { query: "", matchCount: 0, currentIndex: -1, currentEventId: null },
      focusedEventId: "evt-2",
      selectedEventId: "evt-2",
      hiddenSelection: null,
      events: [
        {
          id: "evt-1",
          time: "14:08:39.112",
          source: "SERVER",
          phase: "SNAPSHOT",
          command: "ADD",
          kind: "Item Update",
          object: "order-1042",
          summary: "qty, status",
          raw: {} as LightstreamerEventEnvelope
        },
        {
          id: "evt-2",
          time: "14:08:41.238",
          source: "SERVER",
          phase: "LIVE",
          command: "UPDATE",
          kind: "Item Update",
          object: "order-1042",
          summary: "qty, status",
          raw: {} as LightstreamerEventEnvelope
        }
      ]
    },
    scope: {
      label: "Page / client-main / Session S-9 / orders.command / portfolio",
      status: "Subscribed · Snapshot complete",
      nodes: [],
      focusedNodeId: "page",
      selection: {
        id: "page",
        kind: "page",
        retired: false
      },
      coverage: {
        semantic: true,
        status: "USEFUL",
        detail: "Structural Scope is based on current captured topology."
      }
    },
    scopeId: "page",
    selectionEventId: "evt-2",
    contextId: null,
    context: {
      kind: "evidence",
      title: "evt-2 · Item Update",
      fields: [
        ["Source", "SERVER"],
        ["Phase", "LIVE"],
        ["COMMAND operation", "UPDATE"]
      ]
    },
    commandProjections: {
      observed: { name: "Observed Server COMMAND State", basis: "Captured Server Updates only", rows: [] },
      localEffective: {
        name: "Local Effective COMMAND State",
        basis: "Server Updates plus successfully delivered Local Injected Updates",
        rows: []
      },
      authoritativeLimit: "Neither projection is Authoritative COMMAND State."
    },
    diagnostics: [],
    storage: { mode: "indexeddb" },
    retention: {
      retained: 2,
      totalAppended: 2,
      warningThreshold: 10_000,
      warningActive: false,
      clearState: "idle"
    },
    analytics: { available: false, consent: "unknown", pending: false },
    export: {
      activeScopeId: "page",
      redactions: [],
      sensitiveCounts: {
        "server-addresses": 0,
        "client-ips": 0,
        "item-names": 0,
        "command-keys": 0,
        "field-names": 0,
        identifiers: 0
      },
      completeEvidence: false,
      document: null,
      json: null,
      filename: null
    },
    evidenceCopy: { state: "idle", eventCount: 0, text: null },
    localInjection: {
      state: "idle",
      entryError: null,
      blockedEntry: null,
      discardConfirmation: false,
      availability: {
        selectedUpdate: { available: true, reason: null },
        commandScope: { available: false, reason: "Choose a live COMMAND Item or Listener Scope." }
      },
      draft: null
    },
    ...overrides
  };
}

function activeLocalInjection(
  draftOverrides: Partial<NonNullable<WorkbenchSnapshot["localInjection"]["draft"]>> = {}
): WorkbenchSnapshot["localInjection"] {
  const rawText = JSON.stringify({
    command: "UPDATE",
    key: "order-1042",
    isSnapshot: false,
    fields: { command: "UPDATE", key: "order-1042", qty: 18, status: "open" }
  }, null, 2);
  return {
    state: "active",
    entryError: null,
    blockedEntry: null,
    discardConfirmation: false,
    availability: {
      selectedUpdate: { available: true, reason: null },
      commandScope: { available: false, reason: "A Local Injection Draft already exists." }
    },
    draft: {
      id: "local-injection-draft-1",
      phase: "edit",
      rawText,
      document: {
        command: "UPDATE",
        key: "order-1042",
        isSnapshot: false,
        fields: { command: "UPDATE", key: "order-1042", qty: 18, status: "open" }
      },
      diagnostics: [],
      ready: true,
      anchor: {
        sourceKind: "captured-event",
        sourceEventId: "evt-2",
        pageEpoch: "page-1",
        clientId: "client-main",
        sessionId: "S-9",
        subscriptionId: "sub-7",
        subscriptionMode: "COMMAND",
        itemName: "portfolio",
        itemPosition: 1,
        listenerId: "listener-1",
        captureSource: "listener",
        executionTarget: "captured-listener",
        fieldSchema: ["command", "key", "qty", "status"]
      },
      source: { kind: "captured-event", rawText },
      compareStatus: "unchanged",
      compareOpen: false,
      minimized: false,
      parked: false,
      open: true,
      restorationOrigin: {
        scopeId: "page",
        selectionEventId: "evt-2",
        focusedEventId: "evt-2",
        contextId: null
      },
      executionId: null,
      preflightFingerprint: null,
      outcome: null,
      ...draftOverrides
    }
  };
}

describe("React Workbench Diagnose panel", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("keeps captured Evidence ordered, selected, and distinct from keyboard focus", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);

    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const evidence = Array.from(document.querySelectorAll<HTMLElement>("[data-evidence-id]"));
    expect(evidence.map((row) => row.dataset.evidenceId)).toEqual(["evt-1", "evt-2"]);
    expect(document.querySelector('[data-evidence-id="evt-2"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-evidence-id="evt-2"]')?.getAttribute("tabindex")).toBe("-1");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("tabindex")).toBe("-1");
    expect(rootElement.textContent).toContain("SERVER");
    expect(rootElement.textContent).toContain("View FOLLOW LIVE");
    expect(rootElement.textContent).toContain("Observed Server COMMAND State");
    expect(rootElement.textContent).toContain("Local Effective COMMAND State");

    await act(async () => root.unmount());
  });

  it("moves focus and selection together with Evidence arrow navigation without opening Context", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const selected = document.querySelector<HTMLElement>('[data-evidence-id="evt-2"]');
    selected?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: "evt-1" });
    expect(runtime.commands).not.toContainEqual({ type: "open-context" });
    await act(async () => root.unmount());
  });

  it("restores the exact Evidence row after compact Context closes", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const row = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]');
    const openContext = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Open Context"
    );
    row?.focus();
    openContext?.click();

    await act(async () => runtime.setSnapshot(snapshot({ contextId: "context:evt-2" })));
    const back = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Back to Evidence"
    );
    back?.focus();
    back?.click();
    await act(async () => runtime.setSnapshot(snapshot({ contextId: null })));

    expect(document.activeElement).toBe(row);
    expect(runtime.commands).toContainEqual({ type: "open-context" });
    expect(runtime.commands).toContainEqual({ type: "set-context", contextId: null });
    await act(async () => root.unmount());
  });

  it("makes degraded Capture useful by naming the affected observation and recovery route", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(
      snapshot({
        capture: {
          operation: "RUNNING",
          coverage: "LIMITED",
          detail: "Capture attached after this Subscription began. Earlier Snapshot evidence may be incomplete.",
          recovery: "Open diagnostics"
        }
      })
    );
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Coverage LIMITED");
    expect(rootElement.textContent).toContain("Earlier Snapshot evidence may be incomplete.");
    expect(document.querySelector<HTMLButtonElement>("[data-action='open-diagnostics']")?.textContent).toBe(
      "Open diagnostics"
    );

    await act(async () => root.unmount());
  });

  it("copies immutable raw Evidence and announces the completed copy", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const runtime = createTestRuntime(snapshot({ contextId: "raw:evt-2" }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const copy = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Copy raw Evidence"
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith("{}");
    expect(rootElement.querySelector('[role="status"]')?.textContent).toBe("Copied raw Evidence evt-2.");

    await act(async () => root.unmount());
  });

  it("keeps Find navigation separate from the visible Evidence set", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        find: "order",
        findState: { query: "order", matchCount: 2, currentIndex: 0, currentEventId: "evt-1" }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const openFind = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    await act(async () => openFind?.click());
    const find = document.querySelector<HTMLInputElement>("#workbench-find");
    await act(async () => {
      find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });

    expect(rootElement.textContent).toContain("1 of 2 matches");
    expect(runtime.commands).toContainEqual({ type: "find-next" });
    expect(runtime.commands).toContainEqual({ type: "find-previous" });
    expect(document.querySelectorAll("[data-evidence-id]")).toHaveLength(2);

    await act(async () => root.unmount());
  });

  it("does not steal initial focus and restores the Find trigger only after closing", async () => {
    document.body.innerHTML = '<button id="outside">Outside control</button><main id="app"></main>';
    const outside = document.querySelector<HTMLButtonElement>("#outside");
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!outside || !rootElement) throw new Error("missing test controls");
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    outside.focus();
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.activeElement).toBe(outside);
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    await act(async () => trigger?.click());
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Close Find"
    );
    await act(async () => close?.click());
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));

    const restoredTrigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    expect(document.activeElement).toBe(restoredTrigger);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("opens a temporary Scope picker and restores the Scope trigger when it closes", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const scope = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Scope"
    );
    await act(async () => scope?.click());
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Close Scope"
    );
    expect(close).toBeTruthy();
    await act(async () => close?.click());
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));

    expect(document.activeElement).toBe(scope);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("exposes independently keyboard-adjustable Scope and Context separators", async () => {
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const separators = Array.from(document.querySelectorAll<HTMLDivElement>('[role="separator"]'));
    expect(separators).toHaveLength(2);
    expect(separators[0]?.getAttribute("aria-label")).toBe("Resize Scope");
    expect(separators[1]?.getAttribute("aria-label")).toBe("Resize Context");
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("228");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("252");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("324");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("216");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("420");
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe("284");
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe(separators[1]?.getAttribute("aria-valuemax"));
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe("210");
    expect(document.querySelector('[role="grid"]')?.getAttribute("tabindex")).toBe("0");
    expect(document.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("moves splitter focus to its restore control on collapse and back on restore", async () => {
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const scopeSeparator = document.querySelector<HTMLDivElement>('[role="separator"][aria-label="Resize Scope"]')!;
    scopeSeparator.focus();
    await act(async () => scopeSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const restore = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore Scope")!;
    expect(document.activeElement).toBe(restore);
    await act(async () => restore.click());
    expect(document.activeElement).toBe(scopeSeparator);
    const contextSeparator = document.querySelector<HTMLDivElement>('[role="separator"][aria-label="Resize Context"]')!;
    contextSeparator.focus();
    await act(async () => contextSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    const restoreContext = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore Context")!;
    expect(document.activeElement).toBe(restoreContext);
    await act(async () => restoreContext.click());
    expect(document.activeElement).toBe(contextSeparator);
    await act(async () => root.unmount());
  });

  it("routes retained-window controls and complete scoped Evidence copy through runtime commands", async () => {
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: { ...base.evidence, total: 120, visibleEnd: 60, hasOlder: true, hasNewer: true }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const click = async (name: string) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent === name);
      await act(async () => button?.click());
    };
    await click("Oldest");
    await click("Older");
    await click("Newer");
    await click("Newest");
    await click("Copy complete scoped Evidence");
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "show-oldest-evidence" },
      { type: "show-older-evidence" },
      { type: "show-newer-evidence" },
      { type: "show-newest-evidence" },
      { type: "prepare-scoped-evidence-copy" }
    ]));
    await act(async () => root.unmount());
  });

  it("keeps Home and End local while routing modified bounds keys to retained Evidence", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const row = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]')!;
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    await act(async () => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true })));
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(row);
    grid.focus();
    await act(async () => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true })));
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(row);
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "focus-evidence", eventId: "evt-1" },
      { type: "select-evidence", eventId: "evt-2" }
    ]));
    expect(runtime.commands).not.toContainEqual({ type: "show-newest-evidence" });
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("copies prepared scoped Evidence once and releases the runtime payload", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidenceCopy: { state: "ready", eventCount: 2, text: "complete evidence" }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(runtime.commands).toContainEqual({ type: "clear-scoped-evidence-copy" });
    await act(async () => root.unmount());
  });

  it("surfaces and clears a scoped Evidence copy error so a retry is clean", async () => {
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidenceCopy: { state: "error", eventCount: 0, text: null, error: "Copy preparation failed" }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    expect(document.body.textContent).toContain("Copy preparation failed");
    expect(runtime.commands).toContainEqual({ type: "clear-scoped-evidence-copy" });
    await act(async () => root.unmount());
  });

  it("marks and scrolls the current Find result without changing Evidence selection", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        find: "order",
        findState: { query: "order", matchCount: 2, currentIndex: 0, currentEventId: "evt-1" }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("data-find-current")).toBe("true");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("aria-selected")).toBe("false");
    expect(scrollIntoView).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps applied Filter state, shown counts, and a one-step clear visible", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: { ...base.evidence, total: 20, filters: { query: "orders" } }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Filter: orders");
    expect(rootElement.textContent).toContain("2 shown / 20");
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Clear filters"
    );
    await act(async () => clear?.click());

    expect(runtime.commands).toContainEqual({ type: "clear-filters" });
    await act(async () => root.unmount());
  });

  it("uses complete tree keyboard behavior without committing Scope while scanning", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        nodes: [
          { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
          { id: "client", kind: "client", label: "Client main", parentId: "page", depth: 1, tone: "quiet", lifecycle: "active", retired: false, selected: false }
        ]
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[role="treeitem"][aria-level="1"]');
    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(page?.getAttribute("aria-expanded")).toBe("false");
    expect(rootElement.textContent).not.toContain("Client main");

    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(page?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client" });
    expect(runtime.commands).not.toContainEqual({ type: "set-scope", scopeId: "client" });

    await act(async () => root.unmount());
  });

  it("bounds the mounted Scope tree while keyboard users can reach every logical node", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const logicalNodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      ...Array.from({ length: 220 }, (_, index) => ({
        id: `client-${index + 1}`,
        kind: "client" as const,
        label: `Client ${String(index + 1).padStart(3, "0")}`,
        parentId: "page",
        depth: 1,
        tone: "quiet" as const,
        lifecycle: "active" as const,
        retired: false,
        selected: false
      }))
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "page", nodes: logicalNodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const initiallyMounted = document.querySelectorAll('[role="treeitem"]').length;
    expect(initiallyMounted).toBeGreaterThan(1);
    expect(initiallyMounted).toBeLessThanOrEqual(64);
    const first = document.querySelector<HTMLButtonElement>('[role="treeitem"]');
    await act(async () => first?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client-220" });
    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      scope: { ...runtime.getSnapshot().scope, focusedNodeId: "client-220" }
    }));
    const last = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')).find(
      (node) => node.textContent?.includes("Client 220")
    );
    expect(last).toBe(document.activeElement);

    await act(async () => last?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "page" });
    expect(runtime.commands.some((command) => command.type === "set-scope")).toBe(false);

    await act(async () => root.unmount());
  });

  it("preserves logical Scope focus while passive scrolling changes the mounted window", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `client-${index + 1}`,
        kind: "client" as const,
        label: `Client ${String(index + 1).padStart(3, "0")}`,
        parentId: "page",
        depth: 1,
        tone: "quiet" as const,
        lifecycle: "active" as const,
        retired: false,
        selected: false
      }))
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "page", nodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    const tree = document.querySelector<HTMLDivElement>('[role="tree"]')!;
    page.focus();
    runtime.commands.length = 0;
    tree.scrollTop = 1_800;
    await act(async () => tree.dispatchEvent(new Event("scroll", { bubbles: true })));

    expect(document.activeElement).toBe(page);
    expect(runtime.commands).toEqual([]);
    expect(document.querySelector('[data-scope-id="client-60"]')).not.toBeNull();
    expect(document.querySelector('[data-scope-id="client-1"]')).toBeNull();
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(
      Number(tree.dataset.mountedNodeCount)
    );
    expect(Number(tree.dataset.mountedNodeCount)).toBeLessThanOrEqual(128);

    const visibleClient = document.querySelector<HTMLButtonElement>('[data-scope-id="client-60"]')!;
    await act(async () => visibleClient.click());
    expect(runtime.commands.slice(-2)).toEqual([
      { type: "set-scope-focus", scopeId: "client-60" },
      { type: "set-scope", scopeId: "client-60" }
    ]);

    await act(async () => root.unmount());
  });

  it("keeps Scope focus identity coherent for pointer selection and collapsing a focused branch", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      { id: "client", kind: "client", label: "Client main", parentId: "page", depth: 1, tone: "quiet", lifecycle: "active", retired: false, selected: false },
      { id: "session", kind: "session", label: "Session S-9", parentId: "client", depth: 2, tone: "quiet", lifecycle: "active", retired: false, selected: false }
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "session", nodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const client = document.querySelector<HTMLButtonElement>('[data-scope-id="client"]')!;
    await act(async () => client.click());
    const pointerCommands = runtime.commands.slice(-2);
    expect(pointerCommands).toEqual([
      { type: "set-scope-focus", scopeId: "client" },
      { type: "set-scope", scopeId: "client" }
    ]);

    runtime.commands.length = 0;
    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    await act(async () => page.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "page" });
    expect(document.querySelector('[data-scope-id="session"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("typeahead reaches an off-window Scope node and exposes full sibling semantics", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const clients = Array.from({ length: 100 }, (_, index) => ({
      id: `client-${index + 1}`,
      kind: "client" as const,
      label: index === 99 ? "Zulu target" : `Client ${String(index + 1).padStart(3, "0")}`,
      parentId: "page",
      depth: 1,
      tone: "quiet" as const,
      lifecycle: "active" as const,
      retired: false,
      selected: index === 0
    }));
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: false },
      ...clients
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        focusedNodeId: "page",
        selection: { id: "client-1", kind: "client", retired: false },
        nodes
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    await act(async () => page.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client-100" });
    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      scope: { ...runtime.getSnapshot().scope, focusedNodeId: "client-100" }
    }));
    const target = document.querySelector<HTMLButtonElement>('[data-scope-id="client-100"]')!;
    expect(target).toBe(document.activeElement);
    expect(target.getAttribute("aria-posinset")).toBe("100");
    expect(target.getAttribute("aria-setsize")).toBe("100");
    expect(document.querySelector('[data-scope-id="client-1"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("renders every canonical Scope lifecycle without inventing Current state", async () => {
    const base = snapshot();
    const lifecycles = ["active", "recovering", "disconnected", "retired", "unknown"] as const;
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        focusedNodeId: "active",
        nodes: lifecycles.map((lifecycle) => ({
          id: lifecycle,
          kind: "page" as const,
          label: `${lifecycle} node`,
          detail: lifecycle === "active" ? "Connected" : undefined,
          parentId: null,
          depth: 0,
          tone: "quiet",
          lifecycle,
          retired: lifecycle === "retired",
          selected: lifecycle === "active"
        }))
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const treeText = document.querySelector('[role="tree"]')?.textContent ?? "";
    expect(treeText).toContain("Connected · Active");
    expect(treeText).toContain("Recovering");
    expect(treeText).toContain("Disconnected");
    expect(treeText).toContain("Retired");
    expect(treeText).toContain("Unknown");
    expect(treeText).not.toContain("Current");
    expect(treeText).not.toContain("Historical · read-only");

    await act(async () => root.unmount());
  });

  it("shows pending Evidence truthfully while an async identity query is loading", async () => {
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        loading: true,
        events: [],
        total: 0,
        visibleStart: 0,
        visibleEnd: 0,
        focusedEventId: null,
        selectedEventId: null
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.body.textContent).toContain("Loading Evidence");
    expect(document.body.textContent).not.toContain("No Evidence in the current Scope.");

    await act(async () => root.unmount());
  });

  it("moves Evidence by a viewport with Page Up and Page Down", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const third = { ...base.evidence.events[1], id: "evt-3", time: "14:08:42.238" };
    const runtime = createTestRuntime({
      ...base,
      evidence: { ...base.evidence, total: 3, events: [...base.evidence.events, third] }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const row = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]');
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: "evt-3" });
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: "evt-1" });

    await act(async () => root.unmount());
  });

  it("keeps a Filter-hidden selection explicit while visible Evidence focus stays independent", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      selectionEventId: "hidden-event",
      context: { ...base.context, title: "hidden-event · Item Update" },
      evidence: {
        ...base.evidence,
        selectedEventId: "hidden-event",
        focusedEventId: "evt-1",
        hiddenSelection: {
          eventId: "hidden-event",
          message: "Selected event outside current results",
          canReveal: true,
          canClear: true
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Selected event outside current results");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("tabindex")).toBe("-1");
    const reveal = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Reveal selected Evidence");
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Clear selection");
    await act(async () => {
      reveal?.click();
      clear?.click();
    });

    expect(runtime.commands).toContainEqual({ type: "reveal-selected-evidence" });
    expect(runtime.commands).toContainEqual({ type: "clear-evidence-selection" });
    expect(rootElement.textContent).toContain("hidden-event · Item Update");
    await act(async () => root.unmount());
  });

  it("renders runtime-owned selected Evidence when the selected row is outside the window", async () => {
    const base = snapshot();
    const selectedEvidence = base.evidence.events[1]!;
    const runtime = createTestRuntime({
      ...base,
      selectedEvidence,
      contextId: `raw:${selectedEvidence.id}`,
      evidence: { ...base.evidence, events: [base.evidence.events[0]!] }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    expect(document.body.textContent).toContain(`${selectedEvidence.id} · immutable SERVER Evidence`);
    expect(document.querySelector("pre")?.textContent).toContain(JSON.stringify(selectedEvidence.raw, null, 2));
    await act(async () => root.unmount());
  });

  it("offers exactly one selected-Evidence and applicable COMMAND Scope entry into Local Injection", async () => {
    const base = snapshot();
    const localInjection = activeLocalInjection();
    const runtime = createTestRuntime({
      ...base,
      scopeId: "item",
      scope: {
        ...base.scope,
        selection: { id: "item", kind: "item", retired: false },
        nodes: [
          { id: "subscription", kind: "subscription", label: "orders", detail: "COMMAND · 2 listeners", parentId: null, depth: 0, tone: "active", lifecycle: "active", retired: false, selected: false },
          { id: "item", kind: "item", label: "portfolio", parentId: "subscription", depth: 1, tone: "active", lifecycle: "active", retired: false, selected: true }
        ]
      },
      localInjection: {
        ...localInjection,
        state: "idle",
        availability: {
          selectedUpdate: { available: true, reason: null },
          commandScope: { available: true, reason: null }
        },
        draft: null
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const createDraft = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Create Local Injection Draft"
    );
    const author = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Author COMMAND Item Update"
    );
    expect(createDraft).toBeTruthy();
    expect(author).toBeTruthy();
    await act(async () => createDraft?.click());
    await act(async () => author?.click());
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "begin-local-injection-from-selection" },
      { type: "begin-local-injection-from-scope" }
    ]));
    expect(document.body.textContent).not.toContain("Add event");
    expect(document.body.textContent).not.toContain("Server Injection");
    expect(document.body.textContent).not.toContain("Replay");

    await act(async () => root.unmount());
  });

  it("promotes one protected Local Injection Draft into an accessible document workspace", async () => {
    const runtime = createTestRuntime(snapshot({ localInjection: activeLocalInjection() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Local Injection Draft"]')).toBeTruthy();
    });
    const region = document.querySelector<HTMLElement>('[aria-label="Local Injection Draft"]');
    if (!region) throw new Error("missing Local Injection Draft region");
    expect(region.textContent).toContain("Target");
    expect(region.textContent).toContain("sub-7");
    expect(region.textContent).toContain("Session S-9");
    expect(region.textContent).toContain("Source evt-2 · immutable");
    expect(region.textContent).toContain("LOCAL ONLY");
    expect(region.textContent).toContain("READY");
    expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy();
    const click = async (name: string) => {
      const button = Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === name
      );
      expect(button, name).toBeTruthy();
      await act(async () => button?.click());
    };
    await click("Compare Source");
    await click("Review Local Injection");
    await click("Minimize");
    await click("Park draft");
    await click("Discard draft");
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "set-local-injection-compare", open: true },
      { type: "review-local-injection" },
      { type: "set-local-injection-minimized", minimized: true },
      { type: "park-local-injection" },
      { type: "request-discard-local-injection" }
    ]));
    expect(region.querySelector('[role="tablist"]')).toBeNull();
    expect(region.textContent).not.toContain("Add event");
    expect(region.textContent).not.toContain("Inject all");

    await act(async () => root.unmount());
  });

  it("keeps Cmd/Ctrl+F inside the Local Injection document and respects an already handled shortcut", async () => {
    const runtime = createTestRuntime(snapshot({ localInjection: activeLocalInjection() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy());

    const editor = document.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]');
    await act(async () => editor?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })));
    await vi.waitFor(() => expect(document.querySelector(".cm-search")).toBeTruthy());
    expect(document.querySelector('[aria-label="Find in ordered Evidence"]')).toBeNull();

    const handled = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    handled.preventDefault();
    await act(async () => document.querySelector(".workbench-react")?.dispatchEvent(handled));
    expect(document.querySelector('[aria-label="Find in ordered Evidence"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("returns focus to the current Draft when a blocked replacement is kept", async () => {
    const active = activeLocalInjection();
    const blocked = {
      ...active,
      blockedEntry: { kind: "selected-event" as const, label: "Selected Evidence evt-1" }
    };
    const runtime = createTestRuntime(snapshot({ localInjection: blocked }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy());

    const editor = document.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]')!;
    const keep = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Keep current draft"
    )!;
    editor.focus();
    keep.focus();
    await act(async () => keep.click());
    expect(runtime.commands).toContainEqual({ type: "resume-local-injection" });
    await act(async () => runtime.setSnapshot(snapshot({
      localInjection: { ...active, blockedEntry: null }
    })));
    expect(document.activeElement).toBe(editor);

    await act(async () => root.unmount());
  });

  it("keeps a parked Draft boundary resumable and puts discard confirmation on the visible workspace", async () => {
    const parked = activeLocalInjection({ open: false, parked: true });
    const runtime = createTestRuntime(snapshot({
      localInjection: { ...parked, discardConfirmation: true }
    }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Parked Local Injection Draft"]')).toBeTruthy());

    const parkedRegion = document.querySelector<HTMLElement>('[aria-label="Parked Local Injection Draft"]')!;
    expect(parkedRegion.textContent).toContain("sub-7 · portfolio");
    expect(parkedRegion.textContent).toContain("READY · Session S-9 · Source evt-2");
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Discard Local Injection Draft"]')).toBeTruthy());
    const confirmation = document.querySelector<HTMLElement>('[aria-label="Discard Local Injection Draft"]');
    expect(confirmation).toBeTruthy();
    expect(confirmation?.closest("[hidden]")).toBeNull();
    const resume = Array.from(parkedRegion.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Resume Local Injection Draft"
    );
    await act(async () => resume?.click());
    expect(runtime.commands).toContainEqual({ type: "resume-local-injection" });

    await act(async () => root.unmount());
  });
});
