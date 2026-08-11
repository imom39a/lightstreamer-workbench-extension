import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcess } from "node:child_process";

import {
  CdpClient,
  connectToTarget,
  evaluateByValue,
  listBrowserTargets,
  launchExtensionBrowserProof,
  resolveChromeExecutable,
  terminateChild,
  waitForCondition,
  waitForWorkbenchServiceWorkerTarget
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

async function runExtensionPanelSmoke(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-extension-panel-smoke-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  let latestTargets: BrowserTarget[] = [];
  let chrome: ChildProcess | null = null;
  let inspectedPage: { server: Server; url: string } | null = null;
  let devtoolsFrontendCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;
  let pageCdp: CdpClient | null = null;

  try {
    await access(extensionDir, constants.R_OK);
    inspectedPage = await startInspectedPage();
    const fixtureUrl = inspectedPage.url;
    const launchResult = await launchExtensionBrowserProof({
      rootDir,
      chromeExecutable,
      profileDir,
      extensionDir,
      targetUrl: fixtureUrl,
      windowSize: "1200,900",
      env: process.env
    });
    chrome = launchResult.chrome;
    chromeLogs.push(...launchResult.chromeLogs);
    const debugging = launchResult.debugging;
    await waitForWorkbenchServiceWorkerTarget(debugging.port);

    latestTargets = await listBrowserTargets(debugging.port);
    const inspectedTarget = latestTargets.find(
      (target) => target.type === "page" && !target.url?.startsWith("devtools://")
    );
    assert.ok(inspectedTarget, "Chrome should expose the inspected page target.");

    pageCdp = await connectToTarget(inspectedTarget, debugging.browserWebSocketUrl);
    await pageCdp.request("Runtime.enable");
    await pageCdp.request("Page.bringToFront");

    const panelSelection = await waitForWorkbenchPanel({
      listTargets: () => listBrowserTargets(debugging.port),
      connect: (target) => connectToTarget(target, debugging.browserWebSocketUrl),
      evaluateByValue
    });
    latestTargets = panelSelection.targets;
    devtoolsFrontendCdp = panelSelection.cdp;
    const selection = panelSelection.selection;
    assert.ok(
      selection.panelId,
      `DevTools should register the Workbench panel. Available tabs: ${selection.availableTabIds.join(", ")}`
    );
    assert.equal(selection.selectedTabId, selection.panelId);

    const panelTarget = await waitForExtensionPanelTarget(debugging.port);
    panelCdp = await connectToTarget(panelTarget, debugging.browserWebSocketUrl);
    await panelCdp.request("Runtime.enable");

    const attachmentTabId = await evaluateByValue<number | null>(
      panelCdp,
      `chrome.devtools?.inspectedWindow?.tabId ?? null`
    );
    assert.equal(typeof attachmentTabId, "number");

    await waitForCondition(
      panelCdp,
      `
document.querySelector('[aria-label="Structural runtime scope"]') &&
          document.querySelector('[aria-label="Ordered Evidence"]') &&
          document.querySelector('[aria-label="Context"]')
        `,
      "the React Scoped Evidence Workspace to become usable"
    );

    const pageTarget = latestTargets.find(
      (target) =>
        target.type === "page" &&
        target.id === inspectedTarget.id &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome should expose the inspected page CDP target.");
    pageCdp = await connectToTarget(pageTarget, debugging.browserWebSocketUrl);
    await pageCdp.request("Runtime.enable");

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

    await waitForCondition(
      panelCdp,
      `document.querySelectorAll('[data-evidence-id]').length >= 3 &&
          document.body.innerText.includes('cdp-same-tab-three')`,
      "Workbench panel to receive the live Capture"
    );

    const proof = await evaluateByValue<{
      scope: string;
      rows: string[];
      databases: Array<{ name?: string; version?: number }>;
    }>(
      panelCdp,
      `(async () => ({
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        rows: Array.from(document.querySelectorAll('[data-evidence-id]')).map((row) => row.textContent ?? ""),
        databases: typeof indexedDB.databases === "function" ? await indexedDB.databases() : []
      }))()`
    );
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
      "Workbench panel should retain every live Capture row."
    );
    assert.ok(
      orderedRows[0] < orderedRows[1] && orderedRows[1] < orderedRows[2],
      "Workbench panel should retain Capture order."
    );
    assert.match(proof.scope, /Inspected page/);
    assert.ok(
      proof.databases.some((database) => database.name?.includes("lsew-events-panel-")),
      "Workbench panel should expose a temporary Panel Session journal."
    );

    const panelDatabaseNames = new Set(
      proof.databases
        .map((database) => database.name)
        .filter((name): name is string => name?.startsWith("lsew-events-panel-") ?? false)
    );
    assert.equal(
      panelDatabaseNames.size,
      1,
      "The extension origin should expose one distinct Panel Session journal."
    );
    console.log(
      "Same-tab panel proof passed: retained ordered live Capture and exposed one distinct Panel Session journal."
    );

    const fullProof = await evaluateByValue<{
      scope: string;
      evidence: string;
      context: string;
      hasLegacyViews: boolean;
      panel: { width: number; height: number; viewportWidth: number; viewportHeight: number };
    }>(panelCdp, `({
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
    assert.match(fullProof.scope, /Inspected page/);
    assert.match(fullProof.evidence, /Ordered Evidence/);
    assert.match(fullProof.context, /Observed Server COMMAND State/);
    assert.equal(fullProof.hasLegacyViews, false);
    assert.equal(fullProof.panel.width, fullProof.panel.viewportWidth);
    assert.equal(fullProof.panel.height, fullProof.panel.viewportHeight);
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
    panelCdp?.close();
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

async function waitForExtensionPanelTarget(
  port: number,
  timeoutMs = 10_000
): Promise<BrowserTarget> {
  const deadline = Date.now() + timeoutMs;
  let targets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    targets = await listBrowserTargets(port);
    const panel = targets.find(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/extension/panel/index.html")
    );
    if (panel) return panel;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(
    `Timed out waiting for the Workbench panel target. Observed: ${formatTargets(targets)}`
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

await runExtensionPanelSmoke();
