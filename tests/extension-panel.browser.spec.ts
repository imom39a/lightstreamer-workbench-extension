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
  resolveChromeExecutable,
  terminateChild,
  waitForBrowserTargets,
  waitForCondition,
  waitForDebuggingPort,
  waitForExtensionPanelTarget
} from "./support/chrome-extension-cdp";
import { formatTargets, type BrowserTarget, waitForWorkbenchPanel } from "./support/devtools-panel";
import { getExtensionPanelSmokeScenario } from "./support/panel-scenarios";

const rootDir = process.env.LSEW_PROJECT_ROOT
  ? resolve(process.env.LSEW_PROJECT_ROOT)
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedRenderer = process.env.LSEW_EXPECTED_RENDERER === "react" ? "react" : "legacy";
const extensionDir = resolve(rootDir, process.env.LSEW_EXTENSION_DIR ?? "dist");
const scenario = getExtensionPanelSmokeScenario();

async function runExtensionPanelSmoke(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-extension-panel-smoke-"));
  const chromeExecutable = await resolveChromeExecutable(rootDir);
  const chromeLogs: string[] = [];
  let latestTargets: BrowserTarget[] = [];
  let chrome: ChildProcess | null = null;
  let inspectedPage: { server: Server; url: string } | null = null;
  let browserCdp: CdpClient | null = null;
  let devtoolsFrontendCdp: CdpClient | null = null;
  let panelCdp: CdpClient | null = null;

  try {
    await access(extensionDir, constants.R_OK);
    inspectedPage = await startInspectedPage();
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
      "about:blank"
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
    browserCdp = await CdpClient.connect(debugging.browserWebSocketUrl);
    await waitForBrowserTargets(debugging.port);
    await browserCdp.request("Target.createTarget", { url: inspectedPage.url });
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

    const panelTarget = await waitForExtensionPanelTarget(debugging.port);
    latestTargets = await listBrowserTargets(debugging.port);
    assert.ok(
      panelTarget.webSocketDebuggerUrl,
      "Chrome should expose the selected Workbench panel target."
    );
    panelCdp = await CdpClient.connect(panelTarget.webSocketDebuggerUrl);
    await panelCdp.request("Runtime.enable");

    if (expectedRenderer === "react") {
      await waitForCondition(
        panelCdp,
        `
          document.querySelector("#app")?.dataset.panelRenderer === "react" &&
          document.querySelector('[aria-label="Structural runtime scope"]') &&
          document.querySelector('[aria-label="Ordered Evidence"]') &&
          document.querySelector('[aria-label="Context"]')
        `,
        "the React Scoped Evidence Workspace to become usable"
      );
      const proof = await evaluateByValue<{
        renderer: string;
        scope: string;
        evidence: string;
        context: string;
        hasLegacyViews: boolean;
      }>(panelCdp, `({
        renderer: document.querySelector("#app")?.dataset.panelRenderer ?? "",
        scope: document.querySelector('[aria-label="Structural runtime scope"]')?.textContent ?? "",
        evidence: document.querySelector('[aria-label="Ordered Evidence"]')?.textContent ?? "",
        context: document.querySelector('[aria-label="Context"]')?.textContent ?? "",
        hasLegacyViews: Boolean(document.querySelector(".view-selector"))
      })`);
      assert.equal(proof.renderer, "react");
      assert.match(proof.scope, /Inspected page/);
      assert.match(proof.evidence, /Ordered Evidence/);
      assert.match(proof.context, /Observed Server COMMAND State/);
      assert.equal(proof.hasLegacyViews, false);
      console.log(
        "React-only extension panel smoke passed: DevTools selected the semantic Scope, Evidence, and Context workspace."
      );
      return;
    }

    const initialView = await selectPanelView(panelCdp, scenario.initialView);
    assert.deepEqual(initialView, {
      label: scenario.initialView,
      active: true,
      visible: true
    });

    const topologyView = await selectPanelView(panelCdp, "Topology");
    assert.deepEqual(topologyView, {
      label: "Topology",
      active: true,
      visible: true
    });

    console.log(
      "Shipped extension panel smoke passed: DevTools selected Lightstreamer Workbench and switched Timeline to Topology."
    );
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nAvailable DevTools targets: ${formatTargets(
        latestTargets
      )}${logTail ? `\nChrome log tail:\n${logTail}` : ""}`
    );
  } finally {
    panelCdp?.close();
    devtoolsFrontendCdp?.close();
    browserCdp?.close();
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

async function selectPanelView(
  cdp: CdpClient,
  label: "Timeline" | "Topology" | "COMMAND State"
): Promise<{ label: string; active: boolean; visible: boolean }> {
  return evaluateByValue(cdp, `(() => {
    const button = [...document.querySelectorAll(".view-selector button")].find(
      (candidate) => candidate.textContent === ${JSON.stringify(label)}
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(${JSON.stringify(`The shipped panel is missing its ${label} view control.`)});
    }
    button.click();
    const active = button.dataset.active === "true";
    const visible = ${
      label === "Timeline"
        ? '!document.querySelector(".workspace")?.hasAttribute("hidden")'
        : label === "Topology"
          ? '!document.querySelector(".topology-workspace")?.hasAttribute("hidden")'
          : '!document.querySelector(".command-workspace")?.hasAttribute("hidden")'
    };
    return { label: button.textContent ?? "", active, visible };
  })()`);
}


await runExtensionPanelSmoke();
