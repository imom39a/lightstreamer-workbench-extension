#!/usr/bin/env node

/**
 * Deliberate Event History release gate. This runner is intentionally visible:
 * proof must not silently turn into a headless or synthetic measurement.
 */
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import { build } from "esbuild";
import WebSocket from "ws";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDir, process.env.LSEW_EVENT_HISTORY_PERF_OUTPUT ?? "test-results/event-history-performance.json");
const markdownPath = outputPath.replace(/\.json$/u, ".md");
const referencePath = resolve(rootDir, process.env.LSEW_EVENT_HISTORY_PERF_REFERENCE ?? "docs/reference/event-history-performance-reference.json");
const BROWSER_TIMEOUT_MS = 240_000;

async function main() {
  requireVisibleEnvironment();
  const reference = JSON.parse(await readFile(referencePath, "utf8"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-event-history-performance-"));
  const site = join(temporaryRoot, "site");
  const profile = join(temporaryRoot, "profile");
  const gateModulePath = join(temporaryRoot, "event-history-performance-gate.mjs");
  let server;
  let chrome;
  let cdp;
  let chromeOutput = "";
  try {
    await mkdir(site, { recursive: true });
    await build({ entryPoints: [join(rootDir, "benchmarks/event-history-performance-gate.ts")], outfile: gateModulePath, bundle: true, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
    const { classifyEventHistoryPerformance, validateEventHistoryPerformanceReference } = await import(pathToFileURL(gateModulePath).href);
    if (!validateEventHistoryPerformanceReference(reference)) {
      throw new Error(`Pinned reference preflight failed: ${referencePath}`);
    }
    await build({
      entryPoints: [join(rootDir, "benchmarks/event-history-performance-harness.ts")],
      outfile: join(site, "harness.js"),
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "chrome151",
      loader: { ".css": "css" },
      logLevel: "silent"
    });
    await writeFile(join(site, "index.html"), '<!doctype html><meta charset="utf-8"><title>Event History performance gate</title><link rel="stylesheet" href="/harness.css"><main id="app"></main><script type="module" src="/harness.js"></script>');
    server = await serve(site);
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;
    const executable = await chromeExecutable();
    chrome = spawn(executable, [
      "--no-sandbox",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      url
    ], { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    chrome.stdout.on("data", (chunk) => { chromeOutput += String(chunk); });
    chrome.stderr.on("data", (chunk) => { chromeOutput += String(chunk); });
    const debugPort = await debuggingPort(profile, chrome);
    cdp = await connect(await pageTarget(debugPort, url));
    const environment = await cdp.request("Browser.getVersion");
    const chromeMajor = chromeMajorFromProduct(environment.product);
    if (chromeMajor !== 151) throw new Error(`Expected Chrome for Testing major 151, got ${environment.product}.`);
    await waitForHarness(cdp);

    const result = await evaluate(cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.run()", 3_600_000);
    const heapSamples = [];
    for (const adapter of ["indexeddb", "memory"]) {
      const count = adapter === "indexeddb" ? 10_000 : 5_000;
      for (let sample = 1; sample <= 3; sample += 1) {
        const baseline = await gcHeap(cdp);
        const session = await evaluate(cdp, `window.__LSEW_EVENT_HISTORY_PERFORMANCE__.prepareRetainedHeapSample(${JSON.stringify(adapter)}, ${count})`, 3_600_000);
        const retained = await gcHeap(cdp);
        heapSamples.push({
          adapter,
          sample,
          eventCount: count,
          retained: session.retained,
          baselineUsedSizeBytes: baseline.usedSize,
          retainedUsedSizeBytes: retained.usedSize,
          postGcHeapDeltaBytes: retained.usedSize - baseline.usedSize
        });
        await evaluate(cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.releaseRetainedHeapSample()", BROWSER_TIMEOUT_MS);
      }
    }

    const lifecycleRetainedHeapBytes = [];
    for (let sample = 0; sample < 3; sample += 1) {
      const baseline = await gcHeap(cdp);
      await evaluate(cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.prepareRetainedHeapSample('memory', 100)", BROWSER_TIMEOUT_MS);
      await evaluate(cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.releaseRetainedHeapSample()", BROWSER_TIMEOUT_MS);
      const released = await gcHeap(cdp);
      lifecycleRetainedHeapBytes.push(released.usedSize - baseline.usedSize);
    }

    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      runner: { kind: "real-chrome", headless: false, fakeIndexedDbUsed: false, product: environment.product, userAgent: environment.userAgent, jsVersion: environment.jsVersion },
      source: {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim().length > 0
      },
      environment: {
        chromeMajor,
        platformClass: process.platform === "darwin" ? "darwin" : process.platform,
        architectureClass: process.arch,
        headless: false
      },
      anchors: result.anchors,
      config: result.config,
      shapeFacts: result.shapeFacts,
      cells: result.cells,
      terminalScenarios: result.terminalScenarios,
      checkpointScenarios: result.checkpointScenarios,
      heapSamples,
      lifecycle: {
        retainedHeapBytes: lifecycleRetainedHeapBytes,
        strictMonotonicGrowth: isStrictlyMonotonic(lifecycleRetainedHeapBytes)
      },
      telemetry: { storage: "non-authoritative CDP Storage.getUsageAndQuota omitted from verdict" }
    };
    const decision = classifyEventHistoryPerformance(report, reference);
    const complete = { ...report, decision, reference: { path: referencePath, separatelyPinned: true } };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(complete, null, 2)}\n`);
    await writeFile(markdownPath, markdown(complete));
    process.stdout.write(`${JSON.stringify({ verdict: decision.verdict, failures: decision.failures, reviewReasons: decision.reviewReasons, report: outputPath }, null, 2)}\n`);
    if (decision.verdict === "FAIL") throw new Error(`Event History performance gate failed. See ${outputPath}.`);
  } catch (error) {
    if (chromeOutput) process.stderr.write(`\nChrome output:\n${chromeOutput.slice(-8_000)}\n`);
    throw error;
  } finally {
    cdp?.close();
    if (chrome) await terminateChild(chrome);
    if (server) await new Promise((done) => server.close(done));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function requireVisibleEnvironment() {
  if (process.env.LSEW_BROWSER_HEADLESS !== "false") {
    throw new Error("Event History proof requires LSEW_BROWSER_HEADLESS=false; refusing to switch to headless Chrome.");
  }
  if (process.env.LSEW_UI_HEADLESS !== "false") {
    throw new Error("Event History proof requires LSEW_UI_HEADLESS=false; refusing to switch to headless Chrome.");
  }
}

async function chromeExecutable() {
  const cacheDir = process.env.LSEW_BROWSER_CACHE_DIR ?? join(rootDir, ".cache/lsew-browsers");
  const installed = new Cache(cacheDir).getInstalledBrowsers().filter((entry) => entry.browser === Browser.CHROME && String(entry.buildId).startsWith("151."));
  if (installed.length === 0) throw new Error(`Chrome for Testing 151 is not cached at ${cacheDir}; refusing a system-Chrome fallback.`);
  const executable = installed[0].executablePath;
  await access(executable);
  return executable;
}

function chromeMajorFromProduct(product) {
  const match = String(product).match(/\/(\d+)/u);
  if (!match) throw new Error(`Could not determine Chrome major from ${product}.`);
  return Number(match[1]);
}

function isStrictlyMonotonic(values) {
  return values.length > 1 && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function markdown(report) {
  const rows = report.cells.map((cell) => `| ${cell.adapter} | ${cell.workload} | ${cell.shape} | ${cell.sample} | ${cell.latency.offerToVisibleFrameP95Ms.toFixed(2)} | ${cell.latency.committedBoundaryToVisibleFrameP95Ms.toFixed(2)} | ${cell.latency.finalBoundaryVisibleMs === null ? "—" : cell.latency.finalBoundaryVisibleMs.toFixed(2)} | ${cell.latency.recentPageP95Ms.toFixed(2)} | ${cell.latency.structuredIndexedP95Ms.toFixed(2)} | ${cell.latency.findFullP95Ms.toFixed(2)} |`).join("\n");
  const evidenceRows = report.cells.map((cell) => {
    const key = `${cell.adapter}/${cell.workload}/${cell.shape}/sample-${cell.sample}`;
    const correctness = Object.entries(cell.correctness).every(([, value]) => value) ? "PASS" : "FAIL";
    const workload = `${cell.workloadFacts.expectedCount} events; ${cell.workloadFacts.shapeBytes} shape bytes; ${cell.workloadFacts.persistedJsonBytes} persisted JSON bytes; ${cell.workloadFacts.offeredEventsPerSecond.toFixed(2)} events/sec`;
    const storage = `${cell.storage.transactionCount} tx (${cell.storage.readwriteTransactionCount} rw/${cell.storage.readonlyTransactionCount} ro); ${cell.storage.evidenceWriteCount} evidence writes; ${cell.storage.controlWriteCount} control writes; ${cell.storage.facetEntryCount} facet entries; ${cell.storage.indexEntryCount} index entries`;
    const pressure = `${cell.pressure.maxPendingBytes} pending bytes; ${cell.pressure.maxOldestPendingAgeMs.toFixed(2)} ms oldest; states=${cell.pressure.transitions.join(",") || "none"}`;
    const terminal = `${cell.terminal.phase}; reason=${cell.terminal.reason ?? "none"}; boundary=${cell.terminal.committedEvidenceBoundary?.sequence ?? "none"}; missing=${cell.terminal.firstMissingEventId ?? "none"}; refused=${cell.terminal.refusedCount}; discarded=${cell.terminal.discardedCount}`;
    return `| ${key} | ${correctness} (${cell.accepted}/${cell.published}/${cell.retained}) | ${workload} | ${storage} | ${pressure} | ${terminal} |`;
  }).join("\n");
  const terminalRows = report.terminalScenarios.map((scenario) => `| ${scenario.adapter} | ${scenario.trigger} | ${scenario.terminalReason} | ${scenario.acceptedCount} | ${scenario.refusedCount} | ${scenario.firstMissingEventId ?? "none"} | ${scenario.committedBoundary?.sequence ?? "none"} | ${scenario.terminalPublicationCount} | ${scenario.pressureTransitions.join(",") || "none"} |`).join("\n");
  const checkpointRows = report.checkpointScenarios.map((scenario) => `| ${scenario.adapter} | ${scenario.name} | ${scenario.accepted ? "PASS" : "FAIL"} | ${scenario.retained} | ${scenario.canonicalBytes} | ${scenario.batchAcceptedAsOneOversizedUnit ? "one batch" : "not one batch"} |`).join("\n");
  return `# Event History performance gate\n\nVerdict: **${report.decision.verdict}**\n\nVisible Chrome: ${report.runner.product}; user agent: ${report.runner.userAgent}; JS: ${report.runner.jsVersion}; matrix samples: ${report.cells.length}; reference: ${report.reference.path}.\n\nSource revision: ${report.source.revision}; dirty at run: ${report.source.dirty}; config: ${JSON.stringify(report.config)}; environment: ${JSON.stringify(report.environment)}.\n\nAbsolute gates are fail-closed and are evaluated per independent sample. No failure is averaged away.\n\n## Matrix\n\n| Adapter | Workload | Shape | Sample | Offer→visible p95 (ms) | Boundary→visible p95 (ms) | Burst final boundary (ms) | Recent p95 (ms) | Structured/indexed p95 (ms) | Find/full p95 (ms) |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## Correctness, workload, storage, pressure, and terminal evidence\n\n| Cell | Counts and correctness | Workload | Transaction/facet/index amplification | Pressure | Terminal |\n| --- | --- | --- | --- | --- | --- |\n${evidenceRows}\n\n## Decision\n\nFailures:\n${report.decision.failures.length ? report.decision.failures.map((failure) => `- ${failure}`).join("\n") : "- None"}\n\nReview reasons:\n${report.decision.reviewReasons.length ? report.decision.reviewReasons.map((reason) => `- ${reason}`).join("\n") : "- None"}\n\nHeap samples: ${JSON.stringify(report.heapSamples)}\n\nLifecycle retained heap deltas: ${JSON.stringify(report.lifecycle.retainedHeapBytes)}; strict monotonic growth: ${report.lifecycle.strictMonotonicGrowth}.\n\nStorage telemetry outside the authoritative verdict: ${JSON.stringify(report.telemetry)}\n`;
}

async function serve(directory) {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      const name = path === "/" ? "index.html" : path.slice(1);
      const content = await readFile(join(directory, name));
      response.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html", "cache-control": "no-store" });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePromise); });
  return server;
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  request(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolvePromise, reject) => { socket.addEventListener("open", resolvePromise, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  return new Cdp(socket);
}

async function debuggingPort(profile, child) {
  const deadline = Date.now() + BROWSER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Visible Chrome exited before CDP was ready.");
    try { const [port] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/u); return Number(port); } catch { await delay(100); }
  }
  throw new Error("Timed out waiting for visible Chrome CDP.");
}

async function pageTarget(port, expected) {
  const deadline = Date.now() + BROWSER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(expected));
    if (target) return target.webSocketDebuggerUrl;
    await delay(100);
  }
  throw new Error("Timed out waiting for visible performance page.");
}

async function waitForHarness(cdp) {
  const deadline = Date.now() + BROWSER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, "Boolean(window.__LSEW_EVENT_HISTORY_PERFORMANCE__)", BROWSER_TIMEOUT_MS)) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for the visible Event History harness.");
}

async function evaluate(cdp, expression, timeoutMs = 30_000) {
  let timer;
  try {
    const response = await Promise.race([
      cdp.request("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CDP evaluation timed out.")), timeoutMs); })
    ]);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result.value;
  } finally { clearTimeout(timer); }
}

async function gcHeap(cdp) {
  await cdp.request("HeapProfiler.enable");
  await cdp.request("HeapProfiler.collectGarbage");
  return cdp.request("Runtime.getHeapUsage");
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolvePromise) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolvePromise();
    };
    child.once("close", settle);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      setTimeout(settle, 1_000);
    }, 1_000);
  });
}

await main();
