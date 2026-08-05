import { Browser, Cache } from "@puppeteer/browsers";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { type ChildProcess } from "node:child_process";
import { delimiter, join } from "node:path";
import WebSocket from "ws";

import { formatTargets, type BrowserTarget } from "./devtools-panel";

type CdpResponse = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type RuntimeEvaluation = {
  result?: { value?: unknown };
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string };
  };
};

export type DebuggingEndpoint = {
  port: number;
  browserWebSocketUrl: string;
};

export class CdpClient {
  private nextId = 1;
  private readonly eventListeners = new Map<string, Set<(params: unknown) => void>>();
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
        if (message.method) {
          for (const listener of this.eventListeners.get(message.method) ?? []) {
            listener(message.params);
          }
        }
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
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
      socket.once("open", resolvePromise);
      socket.once("error", () =>
        rejectPromise(new Error("Unable to connect to Chrome DevTools Protocol."))
      );
    });
    return new CdpClient(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Error(`Timed out waiting for Chrome DevTools Protocol method ${method}.`)
        );
      }, 15_000);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: (params: unknown) => void): () => void {
    const listeners = this.eventListeners.get(method) ?? new Set<(params: unknown) => void>();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.eventListeners.delete(method);
    };
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Chrome DevTools Protocol connection closed."));
    }
    this.pending.clear();
    this.eventListeners.clear();
    this.socket.close();
  }
}

export async function evaluateByValue<T>(
  cdp: CdpClient,
  expression: string
): Promise<T> {
  const evaluation = (await cdp.request("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  })) as RuntimeEvaluation;
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Browser evaluation failed"
    );
  }
  return evaluation.result?.value as T;
}

export async function waitForCondition(
  cdp: CdpClient,
  expression: string,
  description: string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateByValue<boolean>(cdp, `Boolean(${expression})`)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

export async function resolveChromeExecutable(rootDir: string): Promise<string> {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() || join(rootDir, ".cache", "lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) =>
      right.buildId.localeCompare(left.buildId, undefined, { numeric: true })
    )
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
  throw new Error(
    "Chrome was not found. Run npm run fixture:browser:install or set CHROME_PATH."
  );
}

export async function waitForDebuggingPort(
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
        return { port, browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}` };
      }
    } catch {
      // Chrome creates DevToolsActivePort after the profile has initialized.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's remote debugging port.");
}

export async function listBrowserTargets(port: number): Promise<BrowserTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) {
    throw new Error("Chrome target discovery did not respond successfully.");
  }
  return (await response.json()) as BrowserTarget[];
}

export async function waitForBrowserTargets(
  port: number,
  options: { requireExtensionDevtools?: boolean; timeoutMs?: number } = {}
): Promise<BrowserTarget[]> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  let targets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    targets = await listBrowserTargets(port);
    const hasPage = targets.some(
      (target) => target.type === "page" && !target.url?.startsWith("devtools://")
    );
    const hasDevtools = targets.some(
      (target) => target.type === "page" && target.url?.startsWith("devtools://")
    );
    const hasWorkbench = options.requireExtensionDevtools
      ? targets.some(
          (target) =>
            target.type === "iframe" &&
            target.url?.startsWith("chrome-extension://") &&
            target.url.endsWith("/devtools.html")
        )
      : targets.some(
          (target) =>
            target.type === "service_worker" &&
            target.url?.startsWith("chrome-extension://") &&
            target.url.endsWith("/extension/background.js")
        );
    if (hasPage && hasDevtools && hasWorkbench) return targets;
    await delay(100);
  }
  throw new Error(`Timed out waiting for DevTools targets. Observed: ${formatTargets(targets)}`);
}

export async function waitForExtensionPanelTarget(
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
        target.url.endsWith("/extension/panel/index.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    if (panel) return panel;
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for the Workbench panel target. Observed: ${formatTargets(targets)}`
  );
}

export async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  if (await waitForExit(child, 2_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function commandCandidatesFromPath(): string[] {
  const names =
    process.platform === "win32"
      ? ["chrome.exe", "chromium.exe"]
      : ["google-chrome", "chromium", "chromium-browser"];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
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
