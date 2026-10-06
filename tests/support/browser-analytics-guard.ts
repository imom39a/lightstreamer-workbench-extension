import assert from "node:assert/strict";
import { ANALYTICS_MESSAGE, ANALYTICS_PREFERENCE_KEY } from "../../src/extension/analytics/events";
import {
  CdpClient, evaluateRequestByValue, findWorkbenchServiceWorkerTarget,
  listBrowserTargets, type CdpRequestClient, type ExtensionManifest
} from "./chrome-extension-cdp";

// This launch-time boundary is active before the extension worker starts.
// The worker CDP boundary below also protects cached addresses and requests.
export const CHROME_ANALYTICS_TEST_ARGUMENTS = Object.freeze([
  "--no-proxy-server",
  "--host-resolver-rules=MAP *.google-analytics.com ~NOTFOUND, MAP google-analytics.com ~NOTFOUND, MAP *.analytics.google.com ~NOTFOUND, MAP analytics.google.com ~NOTFOUND"
]);

type AnalyticsCdp = CdpRequestClient & {
  on(method: string, listener: (params: unknown) => void): () => void;
};

/** Install on the actual extension worker before any panel is selected. */
export async function installChromeAnalyticsGuard(cdp: AnalyticsCdp) {
  let requests = 0;
  const removeListener = cdp.on("Network.requestWillBeSent", (params) => {
    const url = (params as { request?: { url?: unknown } } | undefined)?.request?.url;
    if (typeof url !== "string") return;
    try {
      if (/(^|\.)(google-analytics\.com|analytics\.google\.com)$/.test(new URL(url).hostname)) requests++;
    } catch { /* Unrelated malformed request metadata is not analytics. */ }
  });
  try {
    await cdp.request("Network.enable");
    await cdp.request("Network.setBlockedURLs", { urls: [
      "*://*.google-analytics.com/*", "*://google-analytics.com/*",
      "*://*.analytics.google.com/*", "*://analytics.google.com/*"
    ] });
    await cdp.request("Runtime.enable");
    const enabled = await evaluateRequestByValue(cdp, `(async () => {
      await chrome.storage.local.set({ ${JSON.stringify(ANALYTICS_PREFERENCE_KEY)}: false });
      return (await chrome.storage.local.get(${JSON.stringify(ANALYTICS_PREFERENCE_KEY)}))[${JSON.stringify(ANALYTICS_PREFERENCE_KEY)}];
    })()`);
    assert.equal(enabled, false, "Browser verification must save the extension's analytics Off preference before opening a panel.");
  } catch (error) {
    removeListener();
    throw error;
  }
  return {
    assertQuiet() { assert.equal(requests, 0, "Browser verification attempted an analytics request while analytics was Off."); },
    dispose: removeListener
  };
}

export async function protectWorkbenchAnalytics({ port, manifest }: { port: number; manifest: ExtensionManifest }) {
  const target = await findWorkbenchServiceWorkerTarget(await listBrowserTargets(port), manifest, {
    connect: (url) => CdpClient.connect(url), evaluateByValue: evaluateRequestByValue
  });
  assert.ok(target?.webSocketDebuggerUrl, "Browser verification must locate the exact Workbench worker to disable analytics.");
  const worker = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    const guard = await installChromeAnalyticsGuard(worker);
    return { assertQuiet: guard.assertQuiet, dispose() { guard.dispose(); worker.close(); } };
  } catch (error) { worker.close(); throw error; }
}

export async function assertPanelAnalyticsOff(cdp: CdpRequestClient, configured: boolean) {
  const state = await evaluateRequestByValue<{ ok?: boolean; value?: { configured?: boolean; enabled?: boolean } }>(cdp,
    `chrome.runtime.sendMessage({ type: ${JSON.stringify(ANALYTICS_MESSAGE)}, action: "state" })`);
  assert.equal(state.ok, true, "The loaded panel must read the real background analytics state.");
  assert.equal(state.value?.enabled, false, "The loaded panel must keep analytics Off throughout browser verification.");
  assert.equal(state.value?.configured, configured, "Verification must preserve the frozen package's analytics configuration.");
}
