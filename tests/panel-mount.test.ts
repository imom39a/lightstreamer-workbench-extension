import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PANEL_CAPTURE_MESSAGE,
  PANEL_REGISTER_MESSAGE,
  PANEL_STATUS_MESSAGE,
  PANEL_TOPOLOGY_SYNC_FRAME,
  PANEL_VISIBILITY_MESSAGE,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_VERSION,
  createCaptureMessage
} from "../src/bridge/messages";
import {
  createInMemoryEventHistory,
  type EventHistory
} from "../src/core/event-history-authoritative";
import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";
import {
  THEME_STORAGE_KEY,
  type DevToolsThemeName
} from "../src/extension/panel/theme";
import {
  createWorkbenchRuntime,
  type LocalInjectionExecutionRequest,
  type WorkbenchRuntimeOptions
} from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000011";

type FakePort = {
  postedMessages: unknown[];
  messageListeners: Array<(message: unknown) => void>;
  disconnectListeners: Array<() => void>;
  disconnect: ReturnType<typeof vi.fn>;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
  postMessage(message: unknown): void;
};

function createLocalInjectionExecutionRequest(): LocalInjectionExecutionRequest {
  const draft = {
    sourceEventId: "event-mount-1",
    captureSource: "listener" as const,
    source: {
      clientId: "client-mount",
      sessionId: "session-mount",
      subscriptionId: "subscription-mount"
    },
    target: {
      subscriptionId: "subscription-mount",
      listenerId: "listener-mount"
    },
    item: { name: "scenario.mount", position: 1 },
    command: "UPDATE",
    key: "mount-key",
    sourceCommand: "UPDATE",
    sourceKey: "mount-key",
    fields: { command: "UPDATE", key: "mount-key", value: 2 },
    sourceFields: { command: "UPDATE", key: "mount-key", value: 1 },
    changedFields: { value: 2 },
    originalChangedFields: { value: 1 },
    isSnapshot: false,
    sourceIsSnapshot: false,
    provenance: {
      source: "clone" as const,
      sourceEventKind: "item-update" as const,
      sourceSynthetic: false
    },
    manualChangedFieldsOverride: false
  };
  return {
    executionId: "local-injection-execution-mount-1",
    preflightFingerprint: "fingerprint-mount-1",
    executionTarget: "captured-listener",
    document: {
      command: "UPDATE",
      key: "mount-key",
      isSnapshot: false,
      fields: { command: "UPDATE", key: "mount-key", value: 2 }
    },
    draft
  };
}
describe("production panel mount wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    document.documentElement.removeAttribute("data-theme");
    const themeValues = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() { return themeValues.size; },
      key: vi.fn((index: number) => Array.from(themeValues.keys())[index] ?? null),
      getItem: vi.fn((key: string) => themeValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => themeValues.set(key, value)),
      removeItem: vi.fn((key: string) => themeValues.delete(key))
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("delegates immutable Local Injection execution to the connected bridge and fails safely before connection", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const request = createLocalInjectionExecutionRequest();
    const bridgeResult = {
      requestId: "bridge-request-1",
      panelSessionId: "panel-00000000-0000-4000-8000-000000000011",
      ok: true,
      status: "success" as const,
      timestamp: 123,
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0
    };
    const reinjectDraft = vi.fn(async () => bridgeResult);
    const bridge = { reinjectDraft, disconnect: vi.fn() };
    let earlyResult: Promise<unknown> | null = null;
    const createRuntime = vi.fn((options: WorkbenchRuntimeOptions = {}) => {
      earlyResult = options.localInjectionExecutor?.execute(request) ?? null;
      return createWorkbenchRuntime(options);
    });
    const connectBridge = vi.fn(() => bridge);
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: { tabId: 88 },
        panels: { themeName: "default", setThemeChangeHandler: vi.fn() }
      }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory,
      createRuntime: (options = {}) => createRuntime(options),
      connectBridge
    });
    await flushPanel();

    await expect(earlyResult).resolves.toMatchObject({
      requestId: request.executionId,
      ok: false,
      status: "bridge-error",
      error: expect.stringContaining("not connected")
    });
    const executor = createRuntime.mock.calls[0]?.[0]?.localInjectionExecutor;
    await expect(executor?.execute(request)).resolves.toEqual(bridgeResult);
    expect(reinjectDraft).toHaveBeenCalledWith(request.draft, "captured-listener");

    await disposePanel(dispose);
  });

  it("keeps the visible-frame reporter when production mount binds the runtime", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory({ panelSessionId: PANEL_SESSION_ID });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    const reportVisibleFrame = vi.spyOn(runtime, "reportVisibleFrame");
    const bridge = { reinjectDraft: vi.fn(), disconnect: vi.fn() };
    const createRuntime = vi.fn(() => runtime);

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createRuntime,
      connectBridge: () => bridge
    });
    await flushPanel();
    await act(async () => {
      await history.offer(createEventHistoryWorkloadEvent("ordinary-item-update", 1, "mount-boundary")).settled;
      await Promise.resolve();
    });

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(reportVisibleFrame).toHaveBeenCalled();
    await disposePanel(dispose);
  });

  it("reports mounted React scheduling state through the performance diagnostic seam", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory({ panelSessionId: PANEL_SESSION_ID });
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createRuntime: () => runtime,
      connectBridge: () => ({ reinjectDraft: vi.fn(), disconnect: vi.fn() })
    });
    await flushPanel();

    expect(runtime.getPerformanceDiagnostics?.().panel).toMatchObject({
      rootMounted: true,
      subscriptionActive: true,
      lastLayoutEffectSnapshotVersion: expect.any(Number),
      lastLayoutEffectBoundary: null,
      animationFramePending: true,
      animationFrameRequestCount: 1,
      lastAnimationFrameRequestedAtMs: expect.any(Number),
      animationFrameCallbackCount: 0,
      lastAnimationFrameCallbackAtMs: null,
      animationFrameCancelCount: 0
    });

    await act(async () => animationFrames.shift()?.(performance.now()));
    expect(runtime.getPerformanceDiagnostics?.().panel).toMatchObject({
      animationFramePending: false,
      animationFrameRequestCount: 1,
      animationFrameCallbackCount: 1,
      lastAnimationFrameCallbackAtMs: expect.any(Number)
    });

    await disposePanel(dispose);
    expect(runtime.getPerformanceDiagnostics?.().panel).toMatchObject({
      rootMounted: false,
      subscriptionActive: false,
      animationFramePending: false,
      animationFrameCancelCount: 0
    });
  });

  it("mounts one DOM Workbench root over authoritative seed and live committed Evidence", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory({ panelSessionId: PANEL_SESSION_ID });
    const seed = createEventHistoryWorkloadEvent("small-lifecycle", 1, "authoritative-seed");
    const live = createEventHistoryWorkloadEvent("ordinary-item-update", 2, "authoritative-live");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const createRuntime = vi.fn((options: WorkbenchRuntimeOptions = {}) => createWorkbenchRuntime(options));

    await expect(history.offer(seed).settled).resolves.toMatchObject({
      outcome: "BECAME_EVIDENCE",
      evidence: { eventId: seed.id }
    });
    const seeded = await history.read({ order: "asc" });
    expect(seeded).toMatchObject({
      ok: true,
      value: { total: 1, committedEvidenceBoundary: { eventId: seed.id } }
    });

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createRuntime,
      connectBridge: (handlers) => {
        handlers.onStatusChange("capturing");
        return { reinjectDraft: vi.fn(), disconnect: vi.fn() };
      }
    });
    await flushPanel();

    expect(root.querySelectorAll('[aria-label="Lightstreamer Workbench"]')).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: PANEL_VISIBILITY_MESSAGE, visible: false },
        origin: window.location.origin
      }));
    });
    await flushPanel();
    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { type: PANEL_VISIBILITY_MESSAGE, visible: true },
        origin: window.location.origin
      }));
    });
    await flushPanel();
    await act(async () => {
      await expect(history.offer(live).settled).resolves.toMatchObject({
        outcome: "BECAME_EVIDENCE",
        evidence: { eventId: live.id }
      });
    });
    await flushPanel();
    const committed = await history.read({ order: "asc" });
    expect(committed).toMatchObject({
      ok: true,
      value: { total: 2, committedEvidenceBoundary: { eventId: live.id } }
    });
    const mountedRuntime = createRuntime.mock.results[0]?.value as ReturnType<typeof createWorkbenchRuntime> | undefined;
    expect(mountedRuntime?.getSnapshot().evidence.events.map((event) => event.id)).toContain(live.id);
    expect(root.querySelector(`[data-evidence-id="${live.id}"]`)).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();

    await disposePanel(dispose);
  });

  it("starts from the developer's persisted theme preference", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: { tabId: 40 },
        panels: { themeName: "default", setThemeChangeHandler: vi.fn() }
      }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    await disposePanel(dispose);
  });

  it("persists a developer's theme change and applies it immediately", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: { tabId: 41 },
        panels: { themeName: "default", setThemeChangeHandler: vi.fn() }
      }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("auto");
    expect(root.dataset.theme).toBe("light");

    await selectTheme(root, "dark");

    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await disposePanel(dispose);
  });

  it("follows the live DevTools theme in Auto and disposes the theme listener", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const themeHandler: { current: ((theme: DevToolsThemeName) => void) | null } = {
      current: null
    };
    const setThemeChangeHandler = vi.fn(
      (handler?: ((theme: DevToolsThemeName) => void) | null) => {
        themeHandler.current = handler ?? null;
      }
    );
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: {
        inspectedWindow: { tabId: 43 },
        panels: { themeName: "default", setThemeChangeHandler }
      }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("auto");
    expect(root.dataset.theme).toBe("light");
    const installedHandler = themeHandler.current;
    if (!installedHandler) {
      throw new Error("DevTools theme handler was not installed");
    }

    installedHandler?.("dark");

    expect(root.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("auto");

    await disposePanel(dispose);
    await disposePanel(dispose);
    installedHandler?.("default");

    expect(root.dataset.theme).toBe("dark");
    expect(setThemeChangeHandler).toHaveBeenCalledTimes(2);
    expect(setThemeChangeHandler).toHaveBeenLastCalledWith(null);
  });

  it("opens session history and routes bridge, topology, and visibility input into one panel", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const closeHistory = vi.spyOn(history, "close");
    const openHistory = vi.fn(async () => history);
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: { connect: vi.fn(() => port as unknown as chrome.runtime.Port) }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory,
      createInMemoryHistory: createInMemoryEventHistory,
      createPanelSessionId: () => PANEL_SESSION_ID
    });
    await flushPanel();

    expect(openHistory).toHaveBeenCalledWith({ panelSessionId: PANEL_SESSION_ID });
    expect(port.postedMessages).toContainEqual({
      type: PANEL_REGISTER_MESSAGE,
      tabId: 42,
      panelSessionId: PANEL_SESSION_ID
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: PANEL_VISIBILITY_MESSAGE, visible: false },
        origin: window.location.origin
      })
    );
    port.messageListeners[0]?.({
      type: PANEL_STATUS_MESSAGE,
      panelSessionId: PANEL_SESSION_ID,
      status: "capturing"
    });
    port.messageListeners[0]?.({
      type: PANEL_CAPTURE_MESSAGE,
      panelSessionId: PANEL_SESSION_ID,
      message: createCaptureMessage("item-update", {
        client: { id: "client-mount" },
        subscription: { id: "subscription-mount", mode: "MERGE" },
        item: { name: "mount-item", position: 1 },
        update: { fields: { value: 7 }, changedFields: { value: 7 } }
      })
    });
    port.messageListeners[0]?.({
      type: PANEL_TOPOLOGY_SYNC_FRAME,
      frame: {
        type: TOPOLOGY_SYNC_BEGIN,
        version: TOPOLOGY_SYNC_VERSION,
        syncId: "mount-sync",
        pageEpoch: "mount-page",
        cutoffCaptureSequence: 0,
        chunkCount: 0,
        recordCount: 0,
        coverage: { status: "partial", getters: {}, reason: "late-attachment" },
        panelSessionId: PANEL_SESSION_ID
      },
      panelSessionId: PANEL_SESSION_ID
    });
    await flushPanel();

    expect(root.textContent).not.toContain("mount-item");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: PANEL_VISIBILITY_MESSAGE, visible: true },
        origin: window.location.origin
      })
    );
    await flushPanel();

    expect(root.textContent).toContain("mount-item");
    expect(root.textContent).toContain("Coverage LIMITED");

    await disposePanel(dispose);
    await disposePanel(dispose);
    await flushPanel();

    expect(root.textContent).toBe("");
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(closeHistory).toHaveBeenCalledTimes(1);
  });

  it("forwards explicit opened-history storage metadata before the first Capture offer", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const openHistory = vi.fn(async () => history);
    const createRuntime = vi.fn((options: WorkbenchRuntimeOptions = {}) => createWorkbenchRuntime(options));
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 44 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory,
      createRuntime
    });
    await flushPanel();

    expect(openHistory).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        history,
        storage: { mode: "memory" }
      })
    );
    expect(root.textContent).toContain("Coverage USEFUL");
    expect(root.textContent).not.toContain("Coverage LIMITED");

    await disposePanel(dispose);
  });

  it("reports internal startup fallback without changing Capture coverage", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const createRuntime = vi.fn((options: WorkbenchRuntimeOptions = {}) => createWorkbenchRuntime(options));
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 45 } },
      runtime: { connect: vi.fn(() => port as unknown as chrome.runtime.Port) }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => createInMemoryEventHistory({
        panelSessionId: "panel-internal-fallback",
        fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
      }),
      createRuntime
    });
    await flushPanel();

    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        storage: { mode: "memory", reason: "IndexedDB is unavailable" }
      })
    );
    expect(root.textContent).toContain("Coverage USEFUL");
    expect(root.textContent).not.toContain("Coverage LIMITED");
    expect(root.textContent).not.toContain("Capture STOPPED");
    expect(root.textContent).toContain("Warning · Lower History Capacity");
    expect(root.textContent).toContain("Observation Coverage is unchanged");

    await disposePanel(dispose);
  });

  it("removes legacy telemetry state while keeping first-party resources available", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    localStorage.setItem("lsew.analytics.consent.v1", "granted");
    localStorage.setItem("lsew.analytics.client-id.v1", "legacy-client");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 61 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(localStorage.getItem("lsew.analytics.consent.v1")).toBeNull();
    expect(localStorage.getItem("lsew.analytics.client-id.v1")).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await clickButton(root, "More actions");
    expect(root.textContent).toContain("Help & resources");
    expect(root.querySelector<HTMLAnchorElement>('.workbench-react__resource-link[href="https://imom39a.github.io/lightstreamer-workbench-extension/docs/"]')).not.toBeNull();
    expect(root.textContent).not.toContain("Usage analytics");

    await disposePanel(dispose);
  });

  it("keeps the panel usable when legacy storage cleanup is unavailable", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    vi.stubGlobal("localStorage", {
      get length() { throw new Error("storage unavailable"); },
      key: vi.fn(() => null),
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    });
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 62 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(root.textContent).toContain("Ordered Evidence");
    await clickButton(root, "More actions");
    expect(root.textContent).toContain("Help & resources");

    await disposePanel(dispose);
  });

  it("states the storage limitation when IndexedDB falls back to session memory", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory({
      panelSessionId: "panel-fallback-error",
      capacityTier: "LOWER",
      fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
    });
    const closeHistory = vi.spyOn(history, "close");
    const storageError = new Error("IndexedDB denied");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 73 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: vi.fn(async () => Promise.reject(storageError)),
      createInMemoryHistory: () => history
    });
    await flushPanel();

    const footerDiagnostics = root.querySelector<HTMLElement>("[aria-label='Workbench diagnostics']");
    const storageDetail = "PRIMARY_JOURNAL_UNAVAILABLE · the primary session journal is unavailable. Memory is limited to 5,000 Evidence records or 32 MiB.";

    expect(root.textContent).toContain("Coverage USEFUL");
    expect(root.textContent).not.toContain("Coverage LIMITED");
    expect(footerDiagnostics?.textContent).toContain("Warning · Lower History Capacity");
    expect(footerDiagnostics?.textContent).toContain("Affected: Current Panel Session");
    expect(footerDiagnostics?.textContent).toContain(storageDetail);
    expect(footerDiagnostics?.textContent).toContain("Recovery: Restore primary session storage");
    expect(root.textContent?.split(storageDetail)).toHaveLength(2);
    await clickButton(root, "More actions");
    expect(root.textContent).toContain(
      "current Panel Session owns one temporary Event History using in-memory fallback"
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Falling back to in-memory event storage.",
      storageError
    );

    await disposePanel(dispose);
    await flushPanel();
    expect(closeHistory).toHaveBeenCalledTimes(1);
  });

  it("closes late history without creating panel resources after early disposal", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const closeHistory = vi.spyOn(history, "close");
    const pendingHistory = deferred<EventHistory>();
    const connect = vi.fn();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 99 } },
      runtime: { connect }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      openHistory: () => pendingHistory.promise,
      createInMemoryHistory: createInMemoryEventHistory
    });

    await disposePanel(dispose);
    await disposePanel(dispose);
    pendingHistory.resolve(history);
    await flushPanel();

    expect(root.textContent).toBe("");
    expect(connect).not.toHaveBeenCalled();
    expect(closeHistory).toHaveBeenCalledTimes(1);
  });
});

function createFakePort(): FakePort {
  const port = {
    postedMessages: [] as unknown[],
    messageListeners: [] as Array<(message: unknown) => void>,
    disconnectListeners: [] as Array<() => void>,
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        port.messageListeners.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener: () => void) {
        port.disconnectListeners.push(listener);
      }
    },
    postMessage(message: unknown) {
      port.postedMessages.push(message);
    },
    disconnect: vi.fn(() => {
      port.disconnectListeners.forEach((listener) => listener());
    })
  };
  return port;
}

async function flushPanel(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function disposePanel(dispose: () => void): Promise<void> {
  await act(async () => {
    dispose();
    await Promise.resolve();
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  return button;
}

async function clickButton(root: HTMLElement, label: string): Promise<void> {
  await act(async () => {
    findButton(root, label).click();
    await Promise.resolve();
  });
  await flushPanel();
}

async function selectTheme(root: HTMLElement, theme: "auto" | "dark" | "light"): Promise<void> {
  const select = root.querySelector<HTMLSelectElement>("#workbench-theme");
  if (!select) {
    throw new Error("Missing Theme select");
  }
  await act(async () => {
    select.value = theme;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
  await flushPanel();
}
