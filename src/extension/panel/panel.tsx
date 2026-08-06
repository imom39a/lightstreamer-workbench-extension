import { createRoot } from "react-dom/client";

import { isPanelVisibilityMessage } from "../../bridge/messages";
import {
  createInMemoryEventHistory,
  createIndexedDbEventHistory,
  type EventHistory
} from "../../core/event-history";
import { createDisabledAnalytics, type WorkbenchAnalytics } from "../analytics";
import { connectPanelBridge, type PanelBridgeConnection } from "./bridge-client";
import { createBrowserPanelAnalytics } from "./panel-analytics";
import { WorkbenchPanel } from "./react/workbench-panel";
import { createThemeManager, type ThemeManager } from "./theme";
import {
  createWorkbenchRuntime,
  type LocalInjectionExecutor,
  type WorkbenchRuntime
} from "./workbench-runtime";

export type WorkbenchPanelMountOptions = {
  createIndexedDbHistory?: typeof createIndexedDbEventHistory;
  createInMemoryHistory?: typeof createInMemoryEventHistory;
  createAnalytics?: () => WorkbenchAnalytics;
  createRuntime?: typeof createWorkbenchRuntime;
  connectBridge?: typeof connectPanelBridge;
};

export type DisposeWorkbenchPanel = () => void;

export function mountWorkbenchPanel(
  root: HTMLElement,
  options: WorkbenchPanelMountOptions = {}
): DisposeWorkbenchPanel {
  const createIndexedHistory = options.createIndexedDbHistory ?? createIndexedDbEventHistory;
  const createMemoryHistory = options.createInMemoryHistory ?? createInMemoryEventHistory;
  const createAnalytics = options.createAnalytics ?? createBrowserPanelAnalytics;
  const createRuntime = options.createRuntime ?? createWorkbenchRuntime;
  const connectBridgeClient = options.connectBridge ?? connectPanelBridge;
  let visible = true;
  let disposed = false;
  let historyClosed = false;
  let history: EventHistory | null = null;
  let runtime: WorkbenchRuntime | null = null;
  let bridge: PanelBridgeConnection | null = null;
  let reactRoot: ReturnType<typeof createRoot> | null = null;
  const themeManager = createThemeManager({
    target: root,
    documentElement: document.documentElement
  });

  root.textContent = "Initializing event storage...";
  window.addEventListener("message", onVisibilityMessage);
  void initialize();

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    window.removeEventListener("message", onVisibilityMessage);
    bridge?.disconnect();
    reactRoot?.unmount();
    runtime?.dispose();
    themeManager.dispose();
    closeHistory();
    if (!reactRoot) {
      root.textContent = "";
    }
  };

  async function initialize(): Promise<void> {
    let storageLimited = false;
    try {
      history = await createIndexedHistory({
        sessionId: chrome.devtools?.inspectedWindow?.tabId ?? Date.now(),
        reset: true,
        clearOnClose: true
      });
    } catch (error) {
      console.error("Falling back to in-memory event storage.", error);
      history = createMemoryHistory();
      storageLimited = true;
    }

    if (disposed) {
      closeHistory();
      return;
    }

    const localInjectionExecutor: LocalInjectionExecutor = {
      execute(request) {
        if (!bridge) {
          return Promise.resolve({
            requestId: request.executionId,
            ok: false,
            status: "bridge-error",
            timestamp: Date.now(),
            error: "The Local Injection bridge is not connected."
          });
        }
        return bridge.reinjectDraft(request.draft, request.executionTarget);
      }
    };
    runtime = createRuntime({
      history,
      visible,
      theme: themeManager.preference,
      analytics: safelyCreateAnalytics(createAnalytics),
      localInjectionExecutor,
      storage: storageLimited
        ? { mode: "memory", reason: "IndexedDB is unavailable" }
        : { mode: "indexeddb" }
    });
    const presentationRuntime = bindRuntime(runtime, themeManager);
    reactRoot = createRoot(root);
    reactRoot.render(<WorkbenchPanel runtime={presentationRuntime} />);
    bridge = connectBridgeClient({
      onStatusChange(status) {
        runtime?.dispatch({ type: "set-capture-status", status });
      },
      onCaptureMessage(message) {
        runtime?.dispatch({ type: "ingest-capture-message", message });
      },
      onTopologySyncFrame(frame) {
        runtime?.dispatch({ type: "apply-topology-sync-frame", frame });
      }
    });
  }

  function onVisibilityMessage(event: MessageEvent): void {
    if (event.origin !== window.location.origin || !isPanelVisibilityMessage(event.data)) {
      return;
    }
    visible = event.data.visible;
    runtime?.dispatch({ type: "set-visible", visible });
  }

  function closeHistory(): void {
    if (!history || historyClosed) {
      return;
    }
    historyClosed = true;
    history.close().receive(
      () => undefined,
      (error) => console.error("Failed to close panel event history.", error)
    );
  }
}

function bindRuntime(runtime: WorkbenchRuntime, themeManager: ThemeManager): WorkbenchRuntime {
  return {
    getSnapshot: runtime.getSnapshot.bind(runtime),
    subscribe: runtime.subscribe.bind(runtime),
    dispatch(command) {
      if (command.type === "set-theme") {
        themeManager.setPreference(command.theme);
      }
      runtime.dispatch(command);
    },
    dispose: runtime.dispose.bind(runtime)
  };
}

function safelyCreateAnalytics(createAnalytics: () => WorkbenchAnalytics): WorkbenchAnalytics {
  try {
    return createAnalytics();
  } catch {
    return createDisabledAnalytics();
  }
}
