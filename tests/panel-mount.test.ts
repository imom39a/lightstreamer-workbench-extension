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
} from "../src/core/event-history";
import { type WorkbenchAnalytics } from "../src/extension/analytics";
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
      getItem: vi.fn((key: string) => themeValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => themeValues.set(key, value))
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
      createIndexedDbHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory,
      createRuntime,
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

    dispose();
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
      createIndexedDbHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(root.querySelector<HTMLSelectElement>("#workbench-theme")?.value).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");

    dispose();
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
      createIndexedDbHistory: async () => history,
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

    dispose();
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
      createIndexedDbHistory: async () => history,
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

    dispose();
    dispose();
    installedHandler?.("default");

    expect(root.dataset.theme).toBe("dark");
    expect(setThemeChangeHandler).toHaveBeenCalledTimes(2);
    expect(setThemeChangeHandler).toHaveBeenLastCalledWith(null);
  });

  it("opens session history and routes bridge, topology, and visibility input into one panel", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const closeHistory = vi.spyOn(history, "close");
    const createIndexedDbHistory = vi.fn(async () => history);
    const port = createFakePort();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 42 } },
      runtime: { connect: vi.fn(() => port as unknown as chrome.runtime.Port) }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      createIndexedDbHistory,
      createInMemoryHistory: createInMemoryEventHistory
    });
    await flushPanel();

    expect(createIndexedDbHistory).toHaveBeenCalledWith({
      sessionId: 42,
      reset: true,
      clearOnClose: true
    });
    expect(port.postedMessages).toContainEqual({ type: PANEL_REGISTER_MESSAGE, tabId: 42 });

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: PANEL_VISIBILITY_MESSAGE, visible: false },
        origin: window.location.origin
      })
    );
    port.messageListeners[0]?.({ type: PANEL_STATUS_MESSAGE, status: "capturing" });
    port.messageListeners[0]?.({
      type: PANEL_CAPTURE_MESSAGE,
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
        coverage: { status: "partial", getters: {}, reason: "late-attachment" }
      }
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

    dispose();
    dispose();
    await flushPanel();

    expect(root.textContent).toBe("");
    expect(port.disconnect).toHaveBeenCalledTimes(1);
    expect(closeHistory).toHaveBeenCalledTimes(1);
  });

  it("uses the production analytics boundary for consent without affecting investigation", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const analytics: WorkbenchAnalytics = {
      available: true,
      getConsent: vi.fn((): "unknown" => "unknown"),
      setConsent: vi.fn(async () => true),
      track: vi.fn(async () => undefined)
    };
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 61 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      createIndexedDbHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory,
      createAnalytics: () => analytics
    });
    await flushPanel();

    await clickButton(root, "More actions");
    expect(root.textContent).toContain("Usage analytics is off until you choose to enable it.");

    await clickButton(root, "Enable analytics");
    expect(analytics.setConsent).toHaveBeenCalledWith("granted");
    expect(root.textContent).toContain("Anonymous usage analytics is enabled.");

    dispose();
  });

  it("keeps the panel usable when analytics construction fails", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 62 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      createIndexedDbHistory: async () => history,
      createInMemoryHistory: createInMemoryEventHistory,
      createAnalytics() {
        throw new Error("analytics configuration unavailable");
      }
    });
    await flushPanel();

    expect(root.textContent).toContain("Ordered Evidence");
    await clickButton(root, "More actions");
    expect(root.textContent).toContain("Usage analytics is unavailable in this build. Nothing is sent.");

    dispose();
  });

  it("states the storage limitation when IndexedDB falls back to session memory", async () => {
    const root = document.querySelector<HTMLElement>("#app")!;
    const history = createInMemoryEventHistory();
    const closeHistory = vi.spyOn(history, "close");
    const storageError = new Error("IndexedDB denied");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 73 } }
    } as unknown as typeof chrome;

    const dispose = mountWorkbenchPanel(root, {
      createIndexedDbHistory: vi.fn(async () => Promise.reject(storageError)),
      createInMemoryHistory: () => history
    });
    await flushPanel();

    expect(root.textContent).toContain("Coverage LIMITED");
    expect(root.textContent).toContain(
      "IndexedDB is unavailable. Evidence is held in memory for this DevTools session."
    );
    expect(root.textContent).toContain("closing it clears the in-memory history");
    expect(root.textContent).toContain("In-memory event history");
    await clickButton(root, "More actions");
    expect(root.textContent).toContain(
      "current DevTools session history uses in-memory fallback"
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Falling back to in-memory event storage.",
      storageError
    );

    dispose();
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
      createIndexedDbHistory: () => pendingHistory.promise,
      createInMemoryHistory: createInMemoryEventHistory
    });

    dispose();
    dispose();
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
