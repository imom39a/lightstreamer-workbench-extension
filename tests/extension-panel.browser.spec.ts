import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import WebSocket from "ws";

import { formatTargets, type BrowserTarget, waitForWorkbenchPanel } from "./support/devtools-panel";
import { getExtensionPanelSmokeScenario } from "./support/panel-scenarios";

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { message?: string };
};

type RuntimeEvaluation = {
  result?: {
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
};

type DebuggingEndpoint = {
  port: number;
  browserWebSocketUrl: string;
};

const rootDir = process.env.LSEW_PROJECT_ROOT
  ? resolve(process.env.LSEW_PROJECT_ROOT)
  : resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = join(rootDir, "dist");
const scenario = getExtensionPanelSmokeScenario();

async function runExtensionPanelSmoke(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-extension-panel-smoke-"));
  const chromeExecutable = await resolveChromeExecutable();
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

class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (rawMessage) => {
      const message = JSON.parse(String(rawMessage)) as CdpResponse;
      if (typeof message.id !== "number") {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "Chrome DevTools Protocol error"));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      socket.once("open", () => resolvePromise());
      socket.once("error", () =>
        rejectPromise(new Error("Unable to connect to Chrome DevTools Protocol."))
      );
    });
    return new CdpClient(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timed out waiting for Chrome DevTools Protocol method ${method}.`));
      }, 15_000);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Chrome DevTools Protocol connection closed."));
    }
    this.pending.clear();
    this.socket.close();
  }
}

async function evaluateByValue<T>(cdp: CdpClient, expression: string): Promise<T> {
  const evaluation = (await cdp.request("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })) as RuntimeEvaluation;
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text
    );
  }
  return evaluation.result?.value as T;
}

async function resolveChromeExecutable(): Promise<string> {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() || join(rootDir, ".cache", "lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [
    configured,
    ...installed,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...commandCandidatesFromPath()
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("Chrome was not found. Run npm run fixture:browser:install or set CHROME_PATH.");
}

function commandCandidatesFromPath(): string[] {
  const names = process.platform === "win32" ? ["chrome.exe", "chromium.exe"] : ["google-chrome", "chromium", "chromium-browser"];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

async function waitForDebuggingPort(
  profile: string,
  child: ChildProcess,
  timeoutMs = 15_000
): Promise<DebuggingEndpoint> {
  const activePortFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before its debugging port opened (${child.exitCode ?? child.signalCode}).`
      );
    }
    try {
      const [rawPort, browserPath] = (await readFile(activePortFile, "utf8"))
        .trim()
        .split(/\r?\n/);
      const port = Number(rawPort);
      if (Number.isInteger(port) && port > 0 && browserPath) {
        return {
          port,
          browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`
        };
      }
    } catch {
      // Chrome creates DevToolsActivePort after the profile has initialized.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's remote debugging port.");
}

async function listBrowserTargets(port: number): Promise<BrowserTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  assert.equal(response.ok, true, "Chrome target discovery should respond successfully.");
  return (await response.json()) as BrowserTarget[];
}

async function waitForBrowserTargets(port: number, timeoutMs = 10_000): Promise<BrowserTarget[]> {
  const deadline = Date.now() + timeoutMs;
  let targets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    targets = await listBrowserTargets(port);
    const hasPage = targets.some(
      (target) => target.type === "page" && !target.url?.startsWith("devtools://")
    );
    const hasDevtoolsFrontend = targets.some(
      (target) => target.type === "page" && target.url?.startsWith("devtools://")
    );
    const hasWorkbenchBackground = targets.some(
      (target) =>
        target.type === "service_worker" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/extension/background.js")
    );
    if (hasPage && hasDevtoolsFrontend && hasWorkbenchBackground) {
      return targets;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for DevTools targets. Observed: ${formatTargets(targets)}`);
}

async function waitForExtensionPanelTarget(
  port: number,
  timeoutMs = 10_000
): Promise<BrowserTarget> {
  const deadline = Date.now() + timeoutMs;
  let targets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    targets = await listBrowserTargets(port);
    const panelTarget = targets.find(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/extension/panel/index.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    if (panelTarget) {
      return panelTarget;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for the selected Workbench panel target. Observed: ${formatTargets(targets)}`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  if (await waitForExit(child, 2_000)) {
    return;
  }
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return new Promise((resolvePromise) => {
    const onExit = () => {
      clearTimeout(timeout);
      resolvePromise(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolvePromise(false);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

await runExtensionPanelSmoke();
