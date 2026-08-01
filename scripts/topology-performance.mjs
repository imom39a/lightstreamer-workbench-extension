#!/usr/bin/env node

import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import { build } from "esbuild";
import WebSocket from "ws";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const durationMs = positiveNumber(
  process.env.LSEW_TOPOLOGY_PERF_DURATION_MS,
  60_000
);
const outputPath = process.env.LSEW_TOPOLOGY_PERF_OUTPUT?.trim();

async function runTopologyPerformanceGate() {
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "lsew-topology-performance-")
  );
  const bundleDir = join(temporaryRoot, "site");
  const profileDir = join(temporaryRoot, "chrome-profile");
  await mkdir(bundleDir, { recursive: true });

  let chrome = null;
  let cdp = null;
  let server = null;
  const chromeLogs = [];

  try {
    await buildHarness(bundleDir);
    server = await startHarnessServer(bundleDir);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve the topology harness HTTP port.");
    }
    const harnessUrl = `http://127.0.0.1:${address.port}/`;
    const chromeExecutable = await resolveChromeExecutable();
    chrome = spawn(
      chromeExecutable,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=CalculateNativeWinOcclusion",
        "--no-first-run",
        "--no-default-browser-check",
        "--remote-debugging-port=0",
        `--user-data-dir=${profileDir}`,
        "--window-size=1440,1000",
        harnessUrl
      ],
      {
        cwd: rootDir,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    chrome.stdout?.on("data", (chunk) => chromeLogs.push(String(chunk)));
    chrome.stderr?.on("data", (chunk) => chromeLogs.push(String(chunk)));

    const debuggingPort = await waitForDebuggingPort(profileDir, chrome);
    const target = await waitForPageTarget(debuggingPort, harnessUrl);
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.request("Runtime.enable");
    await waitForHarness(cdp);

    const result = await evaluateByValue(
      cdp,
      `window.__LSEW_TOPOLOGY_PERFORMANCE__.run(${JSON.stringify({
        durationMs
      })})`,
      durationMs + 30_000
    );
    const report = {
      generatedAt: new Date().toISOString(),
      chromeExecutable,
      result,
      thresholds: {
        backlogMs: 500,
        maxUiLagMs: 500,
        p95RenderMs: 16,
        maxInteractionMs: 100,
        longTasksOver50Ms: 0
      }
    };
    const formatted = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(formatted);
    if (outputPath) {
      const resolvedOutput = resolve(rootDir, outputPath);
      await mkdir(dirname(resolvedOutput), { recursive: true });
      await writeFile(resolvedOutput, formatted, "utf8");
    }
    enforceThresholds(result);
  } catch (error) {
    const logTail = chromeLogs.join("").slice(-4_000);
    if (logTail) {
      process.stderr.write(`\nChrome log tail:\n${logTail}\n`);
    }
    throw error;
  } finally {
    cdp?.close();
    if (chrome) {
      await terminateChild(chrome);
    }
    if (server) {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function buildHarness(outputDirectory) {
  await build({
    entryPoints: [
      join(rootDir, "benchmarks", "topology-performance-harness.ts")
    ],
    outfile: join(outputDirectory, "harness.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    logLevel: "silent"
  });
  const cssSource = join(outputDirectory, "harness.css");
  let cssLink = "";
  try {
    await access(cssSource, constants.R_OK);
    cssLink = '<link rel="stylesheet" href="/harness.css">';
  } catch {
    // esbuild omits the CSS file only when the harness imports no styles.
  }
  await writeFile(
    join(outputDirectory, "index.html"),
    `<!doctype html>
<html lang="en" data-store-listing-harness="true">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Topology performance harness</title>
    ${cssLink}
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/harness.js"></script>
  </body>
</html>
`,
    "utf8"
  );
}

async function startHarnessServer(directory) {
  const mimeTypes = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"]
  ]);
  const httpServer = createServer(async (request, response) => {
    const requestPath = new URL(
      request.url ?? "/",
      "http://127.0.0.1"
    ).pathname;
    const fileName =
      requestPath === "/"
        ? "index.html"
        : requestPath.replace(/^\/+/u, "");
    const resolvedFile = resolve(directory, fileName);
    if (
      resolvedFile !== resolve(directory, "index.html") &&
      resolvedFile !== resolve(directory, "harness.js") &&
      resolvedFile !== resolve(directory, "harness.css")
    ) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(resolvedFile);
      const extension = fileName.slice(fileName.lastIndexOf("."));
      response.writeHead(200, {
        "content-type":
          mimeTypes.get(extension) ?? "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise, rejectPromise) => {
    httpServer.once("error", rejectPromise);
    httpServer.listen(0, "127.0.0.1", resolvePromise);
  });
  return httpServer;
}

function enforceThresholds(result) {
  const failures = [];
  if (result.actual.logicalUpdates !== result.expected.logicalUpdates) {
    failures.push(
      `logical count ${result.actual.logicalUpdates} != ${result.expected.logicalUpdates}`
    );
  }
  if (
    result.actual.callbackDeliveries !==
    result.expected.callbackDeliveries
  ) {
    failures.push(
      `delivery count ${result.actual.callbackDeliveries} != ${result.expected.callbackDeliveries}`
    );
  }
  if (result.backlogMs > 500) {
    failures.push(`backlog ${result.backlogMs.toFixed(2)} ms > 500 ms`);
  }
  if (result.maxUiLagMs > 500) {
    failures.push(`UI lag ${result.maxUiLagMs.toFixed(2)} ms > 500 ms`);
  }
  if (result.p95RenderMs.collapsed > 16) {
    failures.push(
      `collapsed p95 render ${result.p95RenderMs.collapsed.toFixed(2)} ms > 16 ms`
    );
  }
  if (result.p95RenderMs.expanded > 16) {
    failures.push(
      `expanded p95 render ${result.p95RenderMs.expanded.toFixed(2)} ms > 16 ms`
    );
  }
  if (result.longTasksOver50Ms > 0) {
    failures.push(
      `${result.longTasksOver50Ms} long task(s) exceeded 50 ms`
    );
  }
  if (result.maxInteractionMs > 100) {
    failures.push(
      `interaction ${result.maxInteractionMs.toFixed(2)} ms > 100 ms`
    );
  }
  if (result.visibleNodes.expanded <= result.visibleNodes.collapsed) {
    failures.push(
      `expanded tree did not add nodes (${result.visibleNodes.collapsed} -> ${result.visibleNodes.expanded})`
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Topology performance gate failed:\n- ${failures.join("\n- ")}`
    );
  }
}

async function resolveChromeExecutable() {
  const configured = process.env.CHROME_PATH?.trim();
  const cacheDir =
    process.env.LSEW_BROWSER_CACHE_DIR?.trim() ||
    join(rootDir, ".cache", "lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) =>
      right.buildId.localeCompare(left.buildId, undefined, {
        numeric: true
      })
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
  ].filter(Boolean);

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

function commandCandidatesFromPath() {
  const names =
    process.platform === "win32"
      ? ["chrome.exe", "chromium.exe"]
      : ["google-chrome", "chromium", "chromium-browser"];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .flatMap((directory) => names.map((name) => join(directory, name)));
}

async function waitForDebuggingPort(profile, child, timeoutMs = 15_000) {
  const activePortFile = join(profile, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Chrome exited before opening CDP (${child.exitCode ?? child.signalCode}).`
      );
    }
    try {
      const [rawPort] = (await readFile(activePortFile, "utf8"))
        .trim()
        .split(/\r?\n/u);
      const port = Number(rawPort);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Chrome creates this file after startup.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for Chrome's debugging port.");
}

async function waitForPageTarget(port, expectedUrl, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let latestTargets = [];
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    latestTargets = await response.json();
    const target = latestTargets.find(
      (entry) =>
        entry.type === "page" &&
        entry.url?.startsWith(expectedUrl) &&
        typeof entry.webSocketDebuggerUrl === "string"
    );
    if (target) {
      return target;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for the performance page: ${JSON.stringify(latestTargets)}`
  );
}

async function waitForHarness(cdpClient, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evaluateByValue(
      cdpClient,
      "Boolean(window.__LSEW_TOPOLOGY_PERFORMANCE__)"
    );
    if (ready) {
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the topology performance harness.");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data));
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
        request.reject(
          new Error(
            response.error.message ?? "Chrome DevTools Protocol error"
          )
        );
      } else {
        request.resolve(response.result);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      socket.addEventListener("open", resolvePromise, { once: true });
      socket.addEventListener(
        "error",
        () =>
          rejectPromise(
            new Error("Unable to connect to Chrome DevTools Protocol.")
          ),
        { once: true }
      );
    });
    return new CdpClient(socket);
  }

  request(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(
          new Error(`Timed out waiting for CDP method ${method}.`)
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluateByValue(
  cdpClient,
  expression,
  timeoutMs = 10_000
) {
  const evaluation = await cdpClient.request(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true
    },
    timeoutMs
  );
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        "Browser evaluation failed."
    );
  }
  return evaluation.result?.value;
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolvePromise();
    }, 5_000);
    child.once("close", () => {
      clearTimeout(forceKillTimer);
      resolvePromise();
    });
  });
}

function positiveNumber(rawValue, fallback) {
  if (!rawValue?.trim()) {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive number, received ${rawValue}.`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds)
  );
}

await runTopologyPerformanceGate();
