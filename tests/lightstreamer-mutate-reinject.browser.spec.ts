import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import WebSocket from "ws";

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

type CaptureMessage = {
  kind?: string;
  payload?: {
    subscription?: { id?: string; fields?: string[] };
    listener?: { id?: string } | null;
    item?: { name?: string; position?: number };
    update?: { command?: string; key?: string; isSnapshot?: boolean };
    fields?: Record<string, string | number | boolean | null>;
    raw?: { captureSource?: string; frameTag?: string };
  };
};

type PreparedBrowserProof = {
  bridgeVersion: number;
  sourceCapture: CaptureMessage;
  initialMessage: string;
  initialUpdateCount: number;
  draft: Record<string, unknown>;
};

type DevtoolsEvaluationProof = {
  result: {
    requestId: string;
    ok: boolean;
    status: string;
    timestamp: number;
    error?: string;
  };
  exceptionInfo: {
    isError?: boolean;
    isException?: boolean;
    description?: string;
    value?: string;
  } | null;
};

type BrowserTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const extensionDir = join(rootDir, "dist");
const fixtureUrl = new URL(
  "/mutate-reinject.html",
  process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/"
).href;
const expectedInitialMessage = "Attention - real Lightstreamer client.";
const mutatedMessage = "Mutated and reinjected through the captured Lightstreamer WebSocket.";
async function runBrowserProof(): Promise<void> {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-mutate-reinject-"));
  const chromeExecutable = await resolveChromeExecutable();
  const chromeLogs: string[] = [];
  const chromeArguments = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
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
  const chrome = spawn(chromeExecutable, chromeArguments, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  chrome.stdout?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));
  chrome.stderr?.on("data", (chunk: Buffer) => chromeLogs.push(String(chunk)));

  let cdp: CdpClient | null = null;
  let devtoolsCdp: CdpClient | null = null;
  try {
    const debuggingPort = await waitForDebuggingPort(profileDir, chrome);
    const targets = await waitForBrowserTargets(debuggingPort);
    const pageTarget = targets.find(
      (target) =>
        target.type === "page" &&
        !target.url?.startsWith("devtools://") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    const extensionDevtoolsTarget = targets.find(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/devtools.html") &&
        typeof target.webSocketDebuggerUrl === "string"
    );
    assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome should expose an inspectable page target");
    assert.ok(
      extensionDevtoolsTarget?.webSocketDebuggerUrl,
      "Chrome should load the extension DevTools page for the inspected fixture"
    );

    cdp = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    devtoolsCdp = await CdpClient.connect(extensionDevtoolsTarget.webSocketDebuggerUrl);
    await cdp.request("Page.enable");
    await cdp.request("Runtime.enable");
    await cdp.request("Page.addScriptToEvaluateOnNewDocument", {
      source: `
      globalThis.__LSEW_E2E_CAPTURES__ = [];
      addEventListener("message", (event) => {
        if (
          event.source === globalThis &&
          event.data?.namespace === "__LSEW_CAPTURE__" &&
          event.data?.version === 1
        ) {
          globalThis.__LSEW_E2E_CAPTURES__.push(event.data);
        }
      });
    `
    });
    await cdp.request("Page.navigate", { url: fixtureUrl });

    await waitForCondition(
      cdp,
      `
      globalThis.__LSEW_REINJECTION_BRIDGE__?.version === 1 &&
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(expectedInitialMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) >= 1
    `,
      "official Lightstreamer client snapshot and extension bridge"
    );

    const proof = await evaluateByValue<PreparedBrowserProof>(
      cdp,
      `(() => {
      const sourceCapture = globalThis.__LSEW_E2E_CAPTURES__.findLast((capture) =>
        capture.kind === "item-update" &&
        capture.payload?.item?.name === "scenario.mutate-reinject" &&
        capture.payload?.raw?.captureSource === "websocket-tlcp"
      );
      if (!sourceCapture) {
        throw new Error("No listenerless websocket-tlcp item update was captured.");
      }
      const payload = sourceCapture.payload;
      const initialMessage = document.querySelector("#message-text")?.textContent ?? "";
      const initialUpdateCount = Number(document.querySelector("#update-count")?.textContent);
      const mutatedModel = JSON.stringify({
        messageId: "fixture-1",
        messageText: ${JSON.stringify(mutatedMessage)},
        messageType: "TICKER"
      });
      const draft = {
        sourceEventId: "browser-e2e-source",
        executionTarget: "captured-wire",
        target: {
          subscriptionId: payload.subscription.id,
          listenerId: null
        },
        item: {
          name: payload.item.name,
          position: payload.item.position
        },
        command: payload.update.command,
        key: payload.update.key,
        fields: {
          ...payload.fields,
          command: payload.update.command,
          key: payload.update.key,
          modelValues: mutatedModel
        },
        changedFields: { modelValues: mutatedModel },
        isSnapshot: payload.update.isSnapshot,
        provenance: { source: "browser-e2e" }
      };
      return {
        bridgeVersion: globalThis.__LSEW_REINJECTION_BRIDGE__.version,
        sourceCapture,
        initialMessage,
        initialUpdateCount,
        draft
      };
    })()`
    );

    assert.equal(proof.bridgeVersion, 1);
    assert.equal(proof.sourceCapture.payload?.raw?.captureSource, "websocket-tlcp");
    assert.equal(proof.sourceCapture.payload?.raw?.frameTag, "U");
    assert.equal(proof.sourceCapture.payload?.listener ?? null, null);
    assert.deepEqual(proof.sourceCapture.payload?.subscription?.fields, [
      "key",
      "command",
      "modelId",
      "modelValues"
    ]);
    assert.equal(proof.sourceCapture.payload?.update?.isSnapshot, true);
    assert.equal(proof.initialMessage, expectedInitialMessage);
    assert.equal(proof.initialUpdateCount, 1);
    const inspectedPageExpression = `(() => {
    const bridge = globalThis.__LSEW_REINJECTION_BRIDGE__;
    if (!bridge || bridge.version !== 1 || typeof bridge.reinject !== "function") return null;
    return bridge.reinject("browser-e2e-reinject", ${JSON.stringify(proof.draft)});
  })()`;
    const devtoolsProof = await evaluateByValue<DevtoolsEvaluationProof>(
      devtoolsCdp,
      `new Promise((resolve) => {
      chrome.devtools.inspectedWindow.eval(
        ${JSON.stringify(inspectedPageExpression)},
        (result, exceptionInfo) => resolve({
          result,
          exceptionInfo: exceptionInfo ? {
            isError: exceptionInfo.isError,
            isException: exceptionInfo.isException,
            description: exceptionInfo.description,
            value: exceptionInfo.value
          } : null
        })
      );
    })`
    );
    assert.equal(devtoolsProof.exceptionInfo?.isError ?? false, false);
    assert.equal(devtoolsProof.exceptionInfo?.isException ?? false, false);
    assert.deepEqual(devtoolsProof.result, {
      requestId: "browser-e2e-reinject",
      ok: true,
      status: "success",
      timestamp: devtoolsProof.result.timestamp
    });

    await waitForCondition(
      cdp,
      `
      document.querySelector("#message-text")?.textContent === ${JSON.stringify(mutatedMessage)} &&
      Number(document.querySelector("#update-count")?.textContent) === 2
    `,
      "mutated Lightstreamer update to reach the application listener and rendered UI"
    );

    const finalUi = await evaluateByValue<{
      message: string;
      model: string;
      updateCount: number;
    }>(
      cdp,
      `({
      message: document.querySelector("#message-text")?.textContent ?? "",
      model: document.querySelector("#rendered-model")?.textContent ?? "",
      updateCount: Number(document.querySelector("#update-count")?.textContent)
    })`
    );
    assert.equal(finalUi.message, mutatedMessage);
    assert.match(
      finalUi.model,
      /Mutated and reinjected through the captured Lightstreamer WebSocket\./
    );
    assert.equal(finalUi.updateCount, 2);

    console.log(
      "Mutate & Inject browser proof passed: panel DevTools eval + listenerless TLCP capture + official client UI"
    );
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    let pageState = "unavailable";
    if (cdp) {
      try {
        pageState = JSON.stringify(
          await evaluateByValue(
            cdp,
            `({
            href: location.href,
            title: document.title,
            readyState: document.readyState,
            bridgeVersion: globalThis.__LSEW_REINJECTION_BRIDGE__?.version ?? null,
            instrumented: globalThis.__LSEW_INSTRUMENTED__ ?? null,
            connection: document.querySelector("#connection-state")?.textContent ?? null,
            message: document.querySelector("#message-text")?.textContent ?? null,
            updateCount: document.querySelector("#update-count")?.textContent ?? null,
            captures: globalThis.__LSEW_E2E_CAPTURES__?.map((capture) => ({
              kind: capture.kind,
              item: capture.payload?.item?.name,
              source: capture.payload?.raw?.captureSource
            })) ?? []
          })`
          )
        );
      } catch (diagnosticError) {
        pageState = `diagnostic failed: ${String(diagnosticError)}`;
      }
    }
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nPage state: ${pageState}${
        logTail ? `\nChrome output:\n${logTail}` : ""
      }`
    );
  } finally {
    cdp?.close();
    devtoolsCdp?.close();
    await terminateChild(chrome);
    await rm(profileDir, { recursive: true, force: true });
  }
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
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (typeof response.id !== "number") {
        return;
      }
      const request = this.pending.get(response.id);
      if (!request) {
        return;
      }
      clearTimeout(request.timeout);
      this.pending.delete(response.id);
      if (response.error) {
        request.reject(new Error(response.error.message ?? "Chrome DevTools Protocol error"));
      } else {
        request.resolve(response.result);
      }
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", () => resolvePromise(), { once: true });
      socket.addEventListener(
        "error",
        () => rejectPromise(new Error("Unable to connect to Chrome DevTools Protocol")),
        { once: true }
      );
    });
    return new CdpClient(socket);
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Timed out waiting for Chrome DevTools Protocol method ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
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
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Browser evaluation failed"
    );
  }
  return evaluation.result?.value as T;
}

async function waitForCondition(
  cdp: CdpClient,
  condition: string,
  description: string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateByValue<boolean>(cdp, `Boolean(${condition})`)) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function resolveChromeExecutable(): Promise<string> {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() || join(rootDir, ".cache", "lsew-browsers");
  const installedTestingBrowsers = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((installed) => installed.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((installed) => installed.executablePath);
  const candidates = [
    configured,
    ...installedTestingBrowsers,
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...commandCandidatesFromPath()
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next platform-specific Chrome location.
    }
  }
  throw new Error(
    "Chrome for Testing or Chromium was not found. Run npm run fixture:browser:install, or set CHROME_PATH, to run the real Mutate & Inject browser proof."
  );
}

function commandCandidatesFromPath(): string[] {
  const executableNames =
    process.platform === "win32" ? ["chromium.exe"] : ["chromium", "chromium-browser"];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => executableNames.map((name) => join(directory, name)));
}

async function waitForDebuggingPort(
  profile: string,
  child: ChildProcess,
  timeoutMs = 15_000
): Promise<number> {
  const activePortFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before its debugging port opened (${child.exitCode ?? child.signalCode}).`
      );
    }
    try {
      const [rawPort] = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      const port = Number(rawPort);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Chrome creates DevToolsActivePort after the profile has initialized.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's remote debugging port.");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert.equal(response.ok, true, `${url} should respond successfully`);
  return response.json();
}

async function waitForBrowserTargets(port: number, timeoutMs = 10_000): Promise<BrowserTarget[]> {
  const url = `http://127.0.0.1:${port}/json/list`;
  const deadline = Date.now() + timeoutMs;
  let latestTargets: BrowserTarget[] = [];
  while (Date.now() < deadline) {
    latestTargets = (await fetchJson(url)) as BrowserTarget[];
    const hasPage = latestTargets.some(
      (target) => target.type === "page" && !target.url?.startsWith("devtools://")
    );
    const hasExtensionDevtools = latestTargets.some(
      (target) =>
        target.type === "iframe" &&
        target.url?.startsWith("chrome-extension://") &&
        target.url.endsWith("/devtools.html")
    );
    if (hasPage && hasExtensionDevtools) {
      return latestTargets;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for inspected-page and extension DevTools targets. Observed: ${JSON.stringify(
      latestTargets.map(({ type, url }) => ({ type, url }))
    )}`
  );
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

await runBrowserProof();
