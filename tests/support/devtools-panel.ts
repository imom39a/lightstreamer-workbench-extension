export type BrowserTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

export type PanelSelectionProof = {
  panelId: string | null;
  selectedTabId: string | null;
  availableTabIds: string[];
};

export type DevtoolsCdpClient = {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
};

type BrowserPanelWaitOptions<TCdp extends DevtoolsCdpClient> = {
  listTargets(): Promise<BrowserTarget[]>;
  connect(webSocketUrl: string): Promise<TCdp>;
  evaluateByValue<T>(cdp: TCdp, expression: string): Promise<T>;
  timeoutMs?: number;
};

export async function waitForWorkbenchPanel<TCdp extends DevtoolsCdpClient>(
  options: BrowserPanelWaitOptions<TCdp>
): Promise<{
  cdp: TCdp;
  selection: PanelSelectionProof;
  targets: BrowserTarget[];
}> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let latestSelection: PanelSelectionProof | null = null;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = await options.listTargets();
    const devtoolsTargets = latestTargets.filter(
      (target) =>
        target.type === "page" &&
        target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    for (const target of devtoolsTargets) {
      const cdp = await options.connect(target.webSocketDebuggerUrl ?? "");
      try {
        await cdp.request("Runtime.enable");
        const selection = await selectWorkbenchPanel(cdp, options.evaluateByValue);
        latestSelection = selection;
        if (selection.panelId) {
          return { cdp, selection, targets: latestTargets };
        }
      } catch {
        // A newly opened DevTools frontend may not have initialized extensions yet.
      }
      cdp.close();
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for the Workbench DevTools panel. Last tab list: ${
      latestSelection?.availableTabIds.join(", ") ?? "unavailable"
    }. Observed: ${formatTargets(latestTargets)}`
  );
}

export function formatTargets(targets: readonly BrowserTarget[]): string {
  return JSON.stringify(targets.map(({ type, url }) => ({ type, url })));
}

async function selectWorkbenchPanel<TCdp extends DevtoolsCdpClient>(
  cdp: TCdp,
  evaluateByValue: BrowserPanelWaitOptions<TCdp>["evaluateByValue"]
): Promise<PanelSelectionProof> {
  return evaluateByValue<PanelSelectionProof>(
    cdp,
    `(async () => {
      const UI = await import("devtools://devtools/bundled/ui/legacy/legacy.js");
      const tabbedPane = UI.InspectorView.InspectorView.instance().tabbedPane;
      const availableTabIds = tabbedPane.tabIds();
      const panelId =
        availableTabIds.find((id) => id.includes("LightstreamerWorkbench")) ?? null;
      if (panelId) {
        await tabbedPane.selectTab(panelId, true);
      }
      return {
        panelId,
        selectedTabId: tabbedPane.selectedTabId ?? null,
        availableTabIds
      };
    })()`
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
