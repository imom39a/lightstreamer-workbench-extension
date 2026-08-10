import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

import { createInMemoryEventHistory } from "../src/core/event-history";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Panel Session mount lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as { chrome?: unknown }).chrome;
    document.body.innerHTML = "";
  });

  it("allocates one identity before history/bridge initialization and replaces it on remount", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    vi.stubGlobal("localStorage", {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn()
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    (globalThis as { chrome: typeof chrome }).chrome = {
      devtools: { inspectedWindow: { tabId: 5 } }
    } as unknown as typeof chrome;

    const identities = [
      "panel-00000000-0000-4000-8000-000000000011",
      "panel-00000000-0000-4000-8000-000000000012"
    ];
    const createIdentity = vi.fn(() => identities.shift()!);
    const history = createInMemoryEventHistory();
    const createHistory = vi.fn(async () => history);
    const connectBridge = vi.fn((_handlers, panelSessionId?: string) => ({
      panelSessionId: panelSessionId ?? "missing",
      reinjectDraft: vi.fn(),
      disconnect: vi.fn()
    }));

    const firstDispose = mountWorkbenchPanel(document.querySelector("#app")!, {
      createPanelSessionId: createIdentity,
      createIndexedDbHistory: createHistory,
      connectBridge
    });
    await act(settle);

    expect(createIdentity).toHaveBeenCalledTimes(1);
    expect(createHistory).toHaveBeenCalledWith({
      sessionId: "panel-00000000-0000-4000-8000-000000000011",
      reset: true,
      clearOnClose: true
    });
    expect(connectBridge.mock.calls[0]?.[1]).toBe(
      "panel-00000000-0000-4000-8000-000000000011"
    );
    firstDispose();

    const secondDispose = mountWorkbenchPanel(document.querySelector("#app")!, {
      createPanelSessionId: createIdentity,
      createIndexedDbHistory: createHistory,
      connectBridge
    });
    await act(settle);

    expect(createIdentity).toHaveBeenCalledTimes(2);
    expect(connectBridge.mock.calls[1]?.[1]).toBe(
      "panel-00000000-0000-4000-8000-000000000012"
    );
    secondDispose();
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
