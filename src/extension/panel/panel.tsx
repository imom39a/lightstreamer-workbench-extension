import { createRoot } from "react-dom/client";

import {
  createPanelSessionId,
  isPanelVisibilityMessage,
  type PanelSessionId
} from "../../bridge/messages";
import {
  createInMemoryEventHistory,
  openEventHistory,
  type EventHistoryStorage,
  type EventHistory
} from "../../core/event-history-authoritative";
import { connectPanelBridge, type PanelBridgeConnection } from "./bridge-client";
import { clearLegacyPanelStorage } from "./legacy-storage";
import { WorkbenchPanel } from "./react/workbench-panel";
import { createThemeManager, type ThemeManager } from "./theme";
import {
  createWorkbenchRuntime,
  type LocalInjectionExecutor,
  type WorkbenchRuntime
} from "./workbench-runtime";
import {
  createStorageHeadroomSampler,
  sampleStorageEstimate
} from "./storage-headroom";

export type WorkbenchPanelMountOptions = {
  createPanelSessionId?: () => PanelSessionId;
  openHistory?: typeof openEventHistory;
  createInMemoryHistory?: typeof createInMemoryEventHistory;
  createRuntime?: typeof createWorkbenchRuntime;
  connectBridge?: typeof connectPanelBridge;
};

export type DisposeWorkbenchPanel = () => Promise<void>;

export function mountWorkbenchPanel(
  root: HTMLElement,
  options: WorkbenchPanelMountOptions = {}
): DisposeWorkbenchPanel {
  const openHistory = options.openHistory ?? openEventHistory;
  const createMemoryHistory = options.createInMemoryHistory ?? createInMemoryEventHistory;
  const createRuntime = options.createRuntime ?? createWorkbenchRuntime;
  const connectBridgeClient = options.connectBridge ?? connectPanelBridge;
  // Allocate this before any asynchronous storage or bridge initialization.
  // It survives reconnects and page epochs for this mount, while a remount
  // necessarily creates a fresh owner identity.
  const panelSessionId = (options.createPanelSessionId ?? createPanelSessionId)();
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

  clearLegacyPanelStorage(window.localStorage);

  root.textContent = "Initializing event storage...";
  window.addEventListener("message", onVisibilityMessage);
  void initialize();

  return async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    window.removeEventListener("message", onVisibilityMessage);
    bridge?.disconnect();
    reactRoot?.unmount();
    if (runtime) {
      await runtime.disposeAndWait();
    }
    themeManager.dispose();
    if (!runtime) closeHistory();
    if (!reactRoot) {
      root.textContent = "";
    }
  };

  async function initialize(): Promise<void> {
    let storage: EventHistoryStorage;
    try {
      history = await openHistory({ panelSessionId });
      storage = history.storage;
    } catch (error) {
      console.error("Falling back to in-memory event storage.", error);
      history = createMemoryHistory({ panelSessionId, fallback: "PRIMARY_JOURNAL_UNAVAILABLE" });
      storage = { mode: "memory", reason: "IndexedDB is unavailable" };
    }

    if (disposed) {
      closeHistory();
      return;
    }

    // Complete the one pre-Capture estimate before connecting the inspected
    // page bridge. The sampler remains session-local and only permits the two
    // coarse pressure-threshold samples documented by storage-headroom.ts.
    const storageHeadroomSampler = createStorageHeadroomSampler(
      async () => sampleStorageEstimate()
    );
    const storageEstimate = await storageHeadroomSampler.sample("BEFORE_CAPTURE");
    if (disposed) {
      closeHistory();
      return;
    }

    const localInjectionExecutor: LocalInjectionExecutor = {
      execute(request) {
        if (!bridge) {
          return Promise.resolve({
            requestId: request.executionId,
            panelSessionId,
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
      localInjectionExecutor,
      storage,
      storageEstimate,
      storageHeadroomSampler
    });
    const presentationRuntime = bindRuntime(runtime, themeManager);
    reactRoot = createRoot(root);
    reactRoot.render(<WorkbenchPanel runtime={presentationRuntime} />);
    bridge = connectBridgeClient({
      onStatusChange(status) {
        document.documentElement.dataset.lsewPanelBridgeStatus = status;
        runtime?.dispatch({ type: "set-capture-status", status });
      },
      onCaptureMessage(message) {
        runtime?.dispatch({ type: "ingest-capture-message", message });
      },
      onTopologySyncFrame(frame) {
        runtime?.dispatch({ type: "apply-topology-sync-frame", frame });
      }
    }, panelSessionId);
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
    void history.close().then(
      (result) => {
        if (!result.ok) console.error("Failed to close panel event history.", result.problem.message);
      },
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
    dispose: runtime.dispose.bind(runtime),
    disposeAndWait: runtime.disposeAndWait.bind(runtime),
    ...(runtime.reportVisibleFrame
      ? { reportVisibleFrame: runtime.reportVisibleFrame.bind(runtime) }
      : {}),
    ...(runtime.reportPanelPerformanceEvent
      ? { reportPanelPerformanceEvent: runtime.reportPanelPerformanceEvent.bind(runtime) }
      : {})
  };
}
