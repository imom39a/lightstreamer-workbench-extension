import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

import {
  CdpClient,
  evaluateByValue,
  listBrowserTargets,
  readExtensionManifest,
  resolveChromeExecutable,
  terminateChild,
  waitForBrowserTargets,
  waitForCondition,
  waitForDebuggingPort
} from "./support/chrome-extension-cdp";
import {
  formatTargets,
  type BrowserTarget,
  waitForWorkbenchPanel
} from "./support/devtools-panel";

const rootDir = process.env.LSEW_PROJECT_ROOT
  ? resolve(process.env.LSEW_PROJECT_ROOT)
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = resolve(rootDir, process.env.LSEW_EXTENSION_DIR ?? "dist");
const SMOKE_TIMEOUT_MS = readTimeout(process.env.LSEW_SMOKE_TIMEOUT_MS ?? "300000");

async function runExtensionPanelSmoke(): Promise<void> {
  assert.equal(process.env.LSEW_BROWSER_HEADLESS, "false", "The unpacked DevTools smoke requires visible Chrome.");
  assert.equal(process.env.LSEW_UI_HEADLESS, "false", "The unpacked DevTools smoke requires a visible UI.");
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-extension-panel-smoke-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  let latestTargets: BrowserTarget[] = [];
  let chrome: ChildProcess | null = null;
  let inspectedPage: { server: Server; url: string } | null = null;
  let devtoolsFrontendCdp: CdpClient | null = null;
  let extensionDevtoolsCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;
  let pageCdp: CdpClient | null = null;
  const panelCdps: CdpClient[] = [];

  try {
    await access(extensionDir, constants.R_OK);
    const extensionManifest = await readExtensionManifest(extensionDir);
    inspectedPage = await startInspectedPage();
    const fixtureUrl = inspectedPage.url;
    const chromeArguments = [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--use-mock-keychain",
      "--auto-open-devtools-for-tabs",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--window-size=1200,900",
      fixtureUrl
    ];
    if (process.env.LSEW_BROWSER_HEADLESS !== "false") {
      chromeArguments.unshift("--headless=new");
    }
    chrome = spawn(chromeExecutable, chromeArguments, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
    chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

    const debugging = await waitForDebuggingPort(profileDir, chrome);
    await waitForBrowserTargets(debugging.port, { workbenchManifest: extensionManifest });
    const panelSelection = await waitForWorkbenchPanel({
      listTargets: () => listBrowserTargets(debugging.port),
      connect: CdpClient.connect,
      evaluateByValue
    });
    latestTargets = panelSelection.targets;
    devtoolsFrontendCdp = panelSelection.cdp;
    const selection = panelSelection.selection;
    assert.ok(
      selection.panelId,
      `DevTools should register the Workbench panel. Available tabs: ${selection.availableTabIds.join(
        ", "
      )}`
    );
    assert.equal(selection.selectedTabId, selection.panelId);

    const inspectedTarget = latestTargets.find(
      (target) => target.type === "page" && target.url === fixtureUrl
    );
    assert.ok(inspectedTarget?.id, "Chrome should expose the inspected page target id.");

    extensionDevtoolsCdp = await waitForInspectedExtensionDevtools(debugging.port, fixtureUrl);
    const originalPanelIds = selection.availableTabIds;
    const panelCreated = await evaluateByValue<boolean>(
      extensionDevtoolsCdp,
      `(new Promise((resolve) => {
        chrome.devtools.panels.create(
          "Lightstreamer Workbench Secondary",
          "",
          "extension/panel/index.html",
          () => resolve(true)
        );
      }))`
    );
    assert.equal(
      panelCreated,
      true,
      "The loaded extension should create a second Workbench panel."
    );
    const secondPanelId = await waitForAdditionalWorkbenchPanel(
      devtoolsFrontendCdp,
      originalPanelIds
    );
    await selectWorkbenchTab(devtoolsFrontendCdp, selection.panelId);
    await selectWorkbenchTab(devtoolsFrontendCdp, secondPanelId);
    latestTargets = await listBrowserTargets(debugging.port);
    panelCdps.push(
      ...(await waitForInspectedPanelTargets(debugging.port, fixtureUrl, 2))
    );
    panelCdp = panelCdps[0] ?? null;
    assert.equal(
      panelCdps.length,
      2,
      "The same inspected tab should have two panel instances."
    );

    const attachmentProofs = await Promise.all(
      panelCdps.map((connectedPanel) =>
        evaluateByValue<{
          tabId?: unknown;
          inspectedUrl?: unknown;
          exceptionInfo?: unknown;
        }>(
          connectedPanel,
          `(new Promise((resolve) => {
            const inspectedWindow = chrome.devtools?.inspectedWindow;
            if (!inspectedWindow) {
              resolve({});
              return;
            }
            inspectedWindow.eval("location.href", (inspectedUrl, exceptionInfo) =>
              resolve({ tabId: inspectedWindow.tabId, inspectedUrl, exceptionInfo })
            );
          }))`
        )
      )
    );
    assert.equal(attachmentProofs.length, 2);
    for (const attachmentProof of attachmentProofs) {
      assert.equal(attachmentProof.inspectedUrl, fixtureUrl);
      assert.equal(typeof attachmentProof.tabId, "number");
      assert.ok(attachmentProof.exceptionInfo === undefined);
    }
    assert.equal(
      new Set(attachmentProofs.map((attachmentProof) => attachmentProof.tabId)).size,
      1,
      "Both panel instances should inspect the same Chrome tab."
    );

    for (const connectedPanel of panelCdps) {
      await waitForCondition(
        connectedPanel,
        `
document.querySelector('[aria-label="Structural runtime scope"]') &&
          document.querySelector('[aria-label="Ordered Evidence"]') &&
          document.querySelector('[aria-label="Context"]') &&
          document.documentElement.dataset.lsewPanelBridgeStatus === "bridge connected"
        `,
        "the React workspace and content bridge registration to become ready",
        SMOKE_TIMEOUT_MS
      );
    }

    const pageTarget = (await listBrowserTargets(debugging.port)).find(
      (target) => target.id === inspectedTarget.id && typeof target.webSocketDebuggerUrl === "string"
    );
    assert.ok(
      pageTarget?.webSocketDebuggerUrl,
      "Chrome should expose the inspected page CDP target."
    );
    pageCdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await pageCdp.request("Runtime.enable");
    await waitForCondition(
      pageCdp,
      `document.documentElement.dataset.lsewContentBridgeReady === "true"`,
      "the inspected-page content bridge to become ready",
      SMOKE_TIMEOUT_MS
    );

    const liveCaptures = ["one", "two", "three"].map((suffix, index) => ({
      namespace: "__LSEW_CAPTURE__",
      version: 1,
      kind: "item-update",
      timestamp: 10_000 + index,
      payload: {
        client: { id: "cdp-same-tab-client" },
        subscription: { id: "cdp-same-tab-subscription", mode: "MERGE" },
        item: { name: `cdp-same-tab-${suffix}`, position: 1 },
        update: {
          fields: { value: `cdp-live-${suffix}` },
          changedFields: { value: `cdp-live-${suffix}` }
        }
      }
    }));
    for (const capture of liveCaptures) {
      await evaluateByValue(pageCdp, `window.postMessage(${JSON.stringify(capture)}, "*")`);
    }
    // Chrome can suspend the inactive DevTools panel's event loop. The page
    // broadcast remains single-shot; selecting each already-registered panel
    // only gives its production bridge/runtime a chance to drain the queued
    // message before asserting both independent journals.
    await selectWorkbenchTab(devtoolsFrontendCdp, selection.panelId);
    await waitForCondition(
      panelCdps[0]!,
      `document.querySelectorAll('[data-evidence-id]').length >= 3 &&
        document.body.innerText.includes('cdp-same-tab-three')`,
      "the first same-tab panel instance to receive the broadcast Capture",
      SMOKE_TIMEOUT_MS
    );
    await selectWorkbenchTab(devtoolsFrontendCdp, secondPanelId);
    await waitForCondition(
      panelCdps[1]!,
      `document.querySelectorAll('[data-evidence-id]').length >= 3 &&
        document.body.innerText.includes('cdp-same-tab-three')`,
      "the second same-tab panel instance to receive the broadcast Capture",
      SMOKE_TIMEOUT_MS
    );

    const proofs = await Promise.all(
      panelCdps.map((connectedPanel) =>
        evaluateByValue<{
          scope: string;
          rows: string[];
          databases: Array<{ name?: string; version?: number }>;
        }>(
          connectedPanel,
          `(async () => ({
            scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
            rows: Array.from(document.querySelectorAll('[data-evidence-id]')).map((row) => row.textContent ?? ""),
            databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : []
          }))()`
        )
      )
    );
    for (const proof of proofs) {
      const orderedRows = liveCaptures.map((capture) => {
        const marker = capture.payload.item.name;
        return proof.rows.findIndex((row) => row.includes(String(marker)));
      });
      for (const capture of liveCaptures) {
        const marker = capture.payload.item.name;
        assert.equal(
          proof.rows.filter((row) => row.includes(String(marker))).length,
          1,
          `Each panel should retain exactly one row for ${marker}.`
        );
      }
      assert.ok(
        orderedRows.every((index) => index >= 0),
        "Each panel should retain every live Capture row."
      );
      assert.ok(
        orderedRows[0] < orderedRows[1] && orderedRows[1] < orderedRows[2],
        "Each panel should retain Capture order."
      );
      assert.match(proof.scope, /Inspected page/);
      assert.ok(
        proof.databases.some((database) => database.name?.includes("lsew-events-panel-")),
        "Each panel should own a temporary Panel Session journal."
      );
    }
    const panelDatabaseNames = [
      ...new Set(
        proofs
          .flatMap((proof) => proof.databases.map((database) => database.name))
          .filter(
            (name): name is string =>
              name?.startsWith("lsew-events-panel-") ?? false
          )
      )
    ];
    assert.equal(
      panelDatabaseNames.length,
      2,
      "The extension origin should expose two distinct Panel Session journals."
    );
    console.log(
      "Same-tab two-DevTools-panel proof passed: each selected panel retained ordered unique live Capture, shared the inspected-page scope, and exposed two distinct Panel Session journals."
    );

    const proof = await evaluateByValue<{
      scope: string;
      evidence: string;
      context: string;
      hasLegacyViews: boolean;
      panel: { width: number; height: number; viewportWidth: number; viewportHeight: number };
      }>(panelCdps[1]!, `({
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        evidence: document.querySelector('[aria-label="Ordered Evidence"]')?.textContent ?? "",
        context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
        hasLegacyViews: Boolean(document.querySelector(".view-selector")),
        panel: (() => {
          const panel = document.querySelector(".workbench-react")?.getBoundingClientRect();
          return {
            width: panel?.width ?? 0,
            height: panel?.height ?? 0,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
          };
        })()
      })`);
      assert.match(proof.scope, /Inspected page/);
      assert.match(proof.evidence, /Ordered Evidence/);
      assert.match(proof.context, /Observed Server COMMAND State/);
      assert.equal(proof.hasLegacyViews, false);
      assert.equal(proof.panel.width, proof.panel.viewportWidth);
      assert.equal(proof.panel.height, proof.panel.viewportHeight);
      console.log(
        "Production extension panel smoke passed: DevTools selected the semantic Scope, Evidence, and Context workspace."
      );
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nAvailable DevTools targets: ${formatTargets(
        latestTargets
      )}${logTail ? `\nChrome log tail:\n${logTail}` : ""}`
    );
  } finally {
    pageCdp?.close();
    for (const connectedPanel of panelCdps) connectedPanel.close();
    extensionDevtoolsCdp?.close();
    devtoolsFrontendCdp?.close();
    if (chrome) {
      await terminateChild(chrome);
    }
    if (inspectedPage) {
      const server = inspectedPage.server;
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
    await rm(profileDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
}

async function waitForAdditionalWorkbenchPanel(
  frontendCdp: CdpClient,
  originalPanelIds: readonly string[]
): Promise<string> {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const panelIds = await evaluateByValue<string[]>(
      frontendCdp,
      `(async () => {
        const UI = await import("devtools://devtools/bundled/ui/legacy/legacy.js");
        return UI.InspectorView.InspectorView.instance().tabbedPane.tabIds();
      })()`
    );
    const added = panelIds.find(
      (panelId) =>
        !originalPanelIds.includes(panelId) && panelId.includes("LightstreamerWorkbench")
    );
    if (added) return added;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the second loaded Workbench panel.");
}

async function waitForInspectedExtensionDevtools(
  port: number,
  inspectedUrl: string
): Promise<CdpClient> {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = await listBrowserTargets(port);
    const candidates = latestTargets.filter(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/devtools.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    for (const candidate of candidates) {
      const cdp = await CdpClient.connect(candidate.webSocketDebuggerUrl!);
      try {
        await cdp.request("Runtime.enable");
        const tabId = await evaluateByValue<number | null>(
          cdp,
          `chrome.devtools?.inspectedWindow?.tabId ?? null`
        );
        const result = await evaluateByValue<{ inspectedUrl?: unknown }>(
          cdp,
          `(new Promise((resolve) => {
            const inspectedWindow = chrome.devtools?.inspectedWindow;
            if (!inspectedWindow) {
              resolve({});
              return;
            }
            inspectedWindow.eval("location.href", (inspectedUrl) => resolve({ inspectedUrl }));
          }))`
        );
        if (typeof tabId === "number" && result.inspectedUrl === inspectedUrl) {
          return cdp;
        }
      } catch {
        // A stale DevTools page may still be discoverable while its host is gone.
      }
      cdp.close();
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(
    `Timed out waiting for an extension DevTools page inspecting ${inspectedUrl}. Observed: ${formatTargets(latestTargets)}`
  );
}

async function selectWorkbenchTab(frontendCdp: CdpClient, panelId: string | null): Promise<void> {
  assert.ok(panelId, "Workbench panel selection should have a tab id.");
  await evaluateByValue(
    frontendCdp,
    `(async () => {
      const UI = await import("devtools://devtools/bundled/ui/legacy/legacy.js");
      await UI.InspectorView.InspectorView.instance().tabbedPane.selectTab(${JSON.stringify(panelId)}, true);
      return true;
    })()`
  );
}

async function waitForInspectedPanelTargets(
  port: number,
  inspectedUrl: string,
  count: number
): Promise<CdpClient[]> {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = await listBrowserTargets(port);
    const panels = latestTargets.filter(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/extension/panel/index.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    const matching: CdpClient[] = [];
    for (const panel of panels) {
      const cdp = await CdpClient.connect(panel.webSocketDebuggerUrl!);
      try {
        await cdp.request("Runtime.enable");
        const inspectedTabId = await evaluateByValue<number | null>(
          cdp,
          `chrome.devtools?.inspectedWindow?.tabId ?? null`
        );
        const inspection = await evaluateByValue<{
          result?: unknown;
          exceptionInfo?: unknown;
        }>(
          cdp,
          `(new Promise((resolve) => {
            const inspectedWindow = chrome.devtools?.inspectedWindow;
            if (!inspectedWindow) {
              resolve({});
              return;
            }
            inspectedWindow.eval("location.href", (result, exceptionInfo) =>
              resolve({ tabId: inspectedWindow.tabId, result, exceptionInfo })
            );
          }))`
        );
        if (typeof inspectedTabId === "number" && inspection.result === inspectedUrl) {
          matching.push(cdp);
          if (matching.length === count) return matching;
          continue;
        }
      } catch {
        // A stale or still-initializing panel is not attached to the fixture.
      }
      cdp.close();
    }
    for (const cdp of matching) cdp.close();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(
    `Timed out waiting for ${count} Workbench panels inspecting ${inspectedUrl}. Observed: ${formatTargets(latestTargets)}`
  );
}

async function startInspectedPage(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Lightstreamer Workbench extension smoke</title>`);
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to resolve the extension-smoke HTTP port.");
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function readTimeout(value: string): number {
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 300_000) {
    throw new Error("LSEW_SMOKE_TIMEOUT_MS must be an integer timeout of at least 300000 ms.");
  }
  return timeout;
}

await runExtensionPanelSmoke();
