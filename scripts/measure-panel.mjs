#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { cpus, platform, arch, release } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { chromium } from "@playwright/test";
import { Browser, Cache } from "@puppeteer/browsers";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const defaultJsonPath = resolve(
  projectRoot,
  args.lifecycleOnly
    ? "test-results/panel-lifecycle-performance.json"
    : "test-results/panel-performance.json"
);
const lifecycleConfiguration = resolveLifecycleConfiguration(args);

if (args.help) {
  console.log(`Usage: node scripts/measure-panel.mjs [--json PATH] [--evaluate PATH] [--lifecycle-only]

Creates repeatable Workbench panel performance evidence:
  - five cold semantic-control loads with CDP scripting, V8 parse/compile, and task duration
  - sustained high-volume Capture with long-task and visible Evidence refresh-gap measurements
  - retained heap lifecycle cycles covering open, exercise, hide/show, and dispose
  - production unpacked bytes, stored ZIP bytes, every JavaScript raw/gzip size, and runtime isolation

The default JSON output is test-results/panel-performance.json (or
test-results/panel-lifecycle-performance.json in lifecycle-only mode).
Only a panel task above 50 ms or monotonic retained-heap growth fails the performance gate.

Options:
  --json PATH              Write the machine-readable report to PATH.
  --evaluate PATH          Evaluate only the explicit triggers in an existing report.
  --lifecycle-only         Skip cold-load, Capture, artifact, and isolation evidence.
  --warmup-cycles N        Lifecycle warm-up cycles per independent run (default: 12).
  --recorded-cycles N      Retained-heap samples per independent run (default: 30).
  --lifecycle-runs N       Fresh page/CDP lifecycle runs in lifecycle-only mode (default: 1).
  --lifecycle-scenario ID  mount, runtime, history, capture, visibility, or full-ui (default: full-ui).
  --print-config           Print resolved lifecycle configuration and exit.
  --inspect-harness        Bundle the standalone harness and print its resolved React build.
  --help                   Show this help.`);
  process.exit(0);
}
if (args.printConfig) {
  console.log(JSON.stringify(lifecycleConfiguration));
  process.exit(0);
}

if (args.inspectHarness) {
  const inspectionRoot = await mkdtemp(join(tmpdir(), "lsew-panel-inspect-"));
  let inspectionHarness;
  try {
    inspectionHarness = await createHarness(inspectionRoot);
    console.log(JSON.stringify(inspectionHarness.evidence));
  } finally {
    if (inspectionHarness?.server.listening) {
      await new Promise((resolvePromise) => inspectionHarness.server.close(resolvePromise));
    }
    await rm(inspectionRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

if (args.evaluate) {
  const report = JSON.parse(await readFile(resolve(projectRoot, args.evaluate), "utf8"));
  const gate = evaluateTriggers(report);
  printGate(gate);
  process.exit(gate.passed ? 0 : 1);
}

const jsonPath = resolve(projectRoot, args.json ?? defaultJsonPath);
const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-panel-measure-"));
let server;
let browser;

try {
  if (!args.lifecycleOnly) {
    assertBuildExists("dist");
  }
  const harness = await createHarness(temporaryRoot);
  server = harness.server;
  const chromeExecutable = await resolveChromeExecutable();
  browser = await chromium.launch({
    executablePath: chromeExecutable,
    headless: true,
    args: ["--js-flags=--expose-gc", "--disable-background-timer-throttling"]
  });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: await environmentSnapshot(browser, chromeExecutable),
    harness: harness.evidence,
    configuration: {
      mode: lifecycleConfiguration.mode,
      viewport: { width: 900, height: 700 },
      coldRuns: 5,
      highVolumeCaptureEvents: 180,
      highVolumeIntervalMs: 2,
      recordedLifecycleCycles: lifecycleConfiguration.recordedCycles,
      warmupLifecycleCycles: lifecycleConfiguration.warmupCycles,
      lifecycleRuns: lifecycleConfiguration.lifecycleRuns,
      lifecycleScenario: lifecycleConfiguration.lifecycleScenario
    },
    mode: lifecycleConfiguration.mode
  };

  if (args.lifecycleOnly) {
    const lifecycleRuns = await measureLifecycleRuns(browser, harness.url, lifecycleConfiguration);
    report.lifecycle = lifecycleRuns[0];
    report.lifecycleRuns = lifecycleRuns;
    report.lifecycleAggregate = summarizeLifecycleRuns(lifecycleRuns);
    report.limitations = lifecycleLimitations(lifecycleRuns);
  } else {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    report.coldLoads = await measureColdLoads(context, harness.url);
    report.highVolume = await measureHighVolume(context, harness.url);
    report.lifecycle = await measureLifecycle(context, harness.url, lifecycleConfiguration);
    await context.close();
    report.artifacts = {
      production: await measureArtifact("dist", join(temporaryRoot, "package-production"))
    };
    report.isolation = await measureIsolation();
    report.limitations = [
      "Measurements use a deterministic standalone panel harness, not DevTools frontend docking overhead.",
      "Long Task API attribution is page-wide; the measurement page contains only Workbench and its harness.",
      ...lifecycleLimitations([report.lifecycle]).slice(1)
    ];
  }
  report.gate = evaluateTriggers(report);

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report, jsonPath);
  printGate(report.gate);
  process.exitCode = report.gate.passed ? 0 : 1;
} finally {
  await browser?.close();
  if (server?.listening) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    if (["--help", "-h", "--lifecycle-only", "--print-config", "--inspect-harness"].includes(argument)) {
      parsed[argument === "-h" ? "help" : argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
      continue;
    }
    const [rawKey, inlineValue] = argument.split("=", 2);
    if (![
      "--json",
      "--evaluate",
      "--warmup-cycles",
      "--recorded-cycles",
      "--lifecycle-runs",
      "--lifecycle-scenario"
    ].includes(rawKey)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = inlineValue ?? rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${rawKey} requires a path.`);
    }
    parsed[rawKey.slice(2)] = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function resolveLifecycleConfiguration(parsed) {
  const mode = parsed.lifecycleOnly ? "lifecycle-only" : "full";
  const warmupCycles = positiveIntegerOption(parsed["warmup-cycles"] ?? "12", "--warmup-cycles", 0);
  const recordedCycles = positiveIntegerOption(parsed["recorded-cycles"] ?? "30", "--recorded-cycles", 1);
  const lifecycleRuns = positiveIntegerOption(parsed["lifecycle-runs"] ?? "1", "--lifecycle-runs", 1);
  const lifecycleScenario = parsed["lifecycle-scenario"] ?? "full-ui";
  const scenarios = ["mount", "runtime", "history", "capture", "visibility", "full-ui"];
  if (!scenarios.includes(lifecycleScenario)) {
    throw new Error(`--lifecycle-scenario must be one of: ${scenarios.join(", ")}.`);
  }
  if (mode === "full" && lifecycleRuns !== 1) {
    throw new Error("--lifecycle-runs is available only with --lifecycle-only.");
  }
  if (mode === "full" && lifecycleScenario !== "full-ui") {
    throw new Error("--lifecycle-scenario is available only with --lifecycle-only.");
  }
  return { mode, warmupCycles, recordedCycles, lifecycleRuns, lifecycleScenario };
}

function positiveIntegerOption(value, name, minimum) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} requires an integer.`);
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return numericValue;
}

function evaluateTriggers(report) {
  const failures = [];
  const maxLongTaskMs = Number(report.highVolume?.maxLongTaskMs ?? 0);
  if (maxLongTaskMs > 50) {
    failures.push(`High-volume panel task exceeded 50 ms (${formatMs(maxLongTaskMs)}).`);
  }

  const lifecycleRuns = Array.isArray(report.lifecycleRuns) && report.lifecycleRuns.length > 0
    ? report.lifecycleRuns
    : [report.lifecycle];
  const monotonicLifecycleRuns = [];
  for (let index = 0; index < lifecycleRuns.length; index += 1) {
    const lifecycle = lifecycleRuns[index];
    const result = evaluateLifecycleRun(lifecycle);
    if (!result.monotonicGrowth) continue;
    const runLabel = Array.isArray(report.lifecycleRuns) ? `Run ${lifecycle?.run ?? index + 1}: ` : "";
    failures.push(
      `${runLabel}Repeated lifecycle cycles show monotonic retained-heap growth (${result.heaps.join(" → ")} bytes).`
    );
    monotonicLifecycleRuns.push(lifecycle?.run ?? index + 1);
  }

  return {
    passed: failures.length === 0,
    failures,
    monotonicGrowth: monotonicLifecycleRuns.length > 0,
    monotonicLifecycleRuns
  };
}

function evaluateLifecycleRun(lifecycle) {
  const heaps = Array.isArray(lifecycle?.retainedHeapBytes)
    ? lifecycle.retainedHeapBytes.map(Number).filter(Number.isFinite)
    : [];
  const gcSupported = lifecycle?.gcSupported !== false;
  return {
    heaps,
    monotonicGrowth:
      gcSupported && heaps.length >= 3 && heaps.slice(1).every((value, index) => value > heaps[index])
  };
}

async function createHarness(directory) {
  const entryPath = join(directory, "entry.tsx");
  await writeFile(entryPath, harnessSource());
  const bundle = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    loader: { ".css": "css" },
    outdir: directory,
    platform: "browser",
    nodePaths: [resolve(projectRoot, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    sourcemap: false,
    target: "chrome120",
    logLevel: "silent"
  });
  await copyFile(resolve(projectRoot, "public/icons/title-icon.svg"), join(directory, "icon.svg"));
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/icon.svg"><link rel="stylesheet" href="/entry.css"><style>html,body,#app{height:100%;margin:0}body{overflow:hidden}</style></head><body><main id="app"></main><script type="module" src="/entry.js"></script></body></html>'
  );

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const requested = resolve(directory, `.${decodeURIComponent(pathname)}`);
    if (!requested.startsWith(`${directory}${sep}`) || !existsSync(requested)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": contentType(requested), "cache-control": "no-store" });
    createReadStream(requested).pipe(response);
  });
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to resolve harness port.");
  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
    evidence: reactBuildEvidence(bundle.metafile)
  };
}

function reactBuildEvidence(metafile) {
  const reactModules = Object.keys(metafile.inputs)
    .filter((path) => path.includes("node_modules/react/") || path.includes("node_modules/react-dom/"))
    .sort();
  const developmentModules = reactModules.filter((path) => path.includes(".development."));
  const productionModules = reactModules.filter((path) => path.includes(".production."));
  return {
    nodeEnv: "production",
    reactBuild:
      developmentModules.length > 0 ? "development" : productionModules.length > 0 ? "production" : "unresolved",
    reactModules,
    productionModules,
    developmentModules
  };
}

function harnessSource() {
  const source = (path) => JSON.stringify(resolve(projectRoot, path));
  return `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createCaptureMessage } from ${source("src/bridge/messages.ts")};
import { createInMemoryEventHistory } from ${source("src/core/event-history.ts")};
import { WorkbenchPanel } from ${source("src/extension/panel/react/workbench-panel.tsx")};
import { createWorkbenchRuntime } from ${source("src/extension/panel/workbench-runtime.ts")};

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Performance harness requires #app.");
let session = null;
let longTasks = [];
const longTaskSupported = PerformanceObserver.supportedEntryTypes.includes("longtask");
if (longTaskSupported) {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
  }).observe({ type: "longtask", buffered: true });
}

function envelope(sequence) {
  return {
    id: "perf-initial-" + sequence,
    timestamp: 1780872000000 + sequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "perf-client" },
    subscription: { id: "perf-subscription", mode: "COMMAND" },
    item: { name: "perf-item-" + (sequence % 7), position: 1 },
    update: {
      isSnapshot: sequence <= 12,
      command: sequence === 1 ? "ADD" : "UPDATE",
      key: "perf-key",
      fields: { command: sequence === 1 ? "ADD" : "UPDATE", key: "perf-key", value: sequence },
      changedFields: { value: sequence }
    }
  };
}

function capture(sequence) {
  return createCaptureMessage("item-update", {
    client: { id: "perf-client" },
    subscription: { id: "perf-subscription", mode: "COMMAND" },
    item: { name: "perf-live-" + (sequence % 11), position: 1 },
    update: {
      isSnapshot: false,
      command: "UPDATE",
      key: "perf-key",
      fields: { command: "UPDATE", key: "perf-key", value: sequence },
      changedFields: { value: sequence }
    }
  }, 1780872100000 + sequence);
}

async function frame() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function mount(initialCount = 12) {
  await dispose();
  const { history, runtime } = createRuntimeSession(initialCount);
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(WorkbenchPanel, { runtime }));
  session = { history, runtime, reactRoot };
  await frame();
  return { evidenceRows: root.querySelectorAll("[data-evidence-id]").length };
}

async function ingest({ count = 180, intervalMs = 2 } = {}) {
  if (!session) throw new Error("Performance session is not mounted.");
  longTasks = [];
  const mutationTimes = [];
  let lastEvidenceId = null;
  const observer = new MutationObserver(() => {
    const rows = root.querySelectorAll("[data-evidence-id]");
    const id = rows.item(rows.length - 1)?.getAttribute("data-evidence-id") ?? null;
    if (id && id !== lastEvidenceId) {
      lastEvidenceId = id;
      mutationTimes.push(performance.now());
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  const startedAt = performance.now();
  for (let sequence = 1; sequence <= count; sequence += 1) {
    session.runtime.dispatch({ type: "ingest-capture-message", message: capture(sequence) });
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  observer.disconnect();
  const gaps = mutationTimes.slice(1).map((time, index) => time - mutationTimes[index]);
  return {
    durationMs: performance.now() - startedAt,
    longTaskSupported,
    longTasks: longTasks.filter((task) => task.startMs >= startedAt),
    mutationTimes,
    maxRefreshGapMs: gaps.length ? Math.max(...gaps) : null,
    p95RefreshGapMs: gaps.length ? percentile(gaps, 0.95) : null,
    evidenceRows: root.querySelectorAll("[data-evidence-id]").length
  };
}

function createRuntimeSession(initialCount = 0) {
  const history = createInMemoryEventHistory();
  for (let sequence = 1; sequence <= initialCount; sequence += 1) history.append(envelope(sequence));
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", theme: "dark" });
  return { history, runtime };
}

async function closeRuntimeSession(current) {
  current.runtime.dispose();
  await current.history.close().toPromise();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function cycle({ scenario = "full-ui", captureCount = 60 } = {}) {
  if (scenario === "mount") return cycleMount();
  if (scenario === "runtime") return cycleRuntime();
  if (scenario === "history") return cycleHistory();
  if (scenario === "capture") return cycleCapture(captureCount);
  if (scenario === "visibility") return cycleVisibility(captureCount);
  if (scenario !== "full-ui") throw new Error("Unknown lifecycle scenario: " + scenario);
  await mount(12);
  session.runtime.dispatch({ type: "set-visible", visible: false });
  for (let sequence = 1; sequence <= captureCount; sequence += 1) {
    session.runtime.dispatch({ type: "ingest-capture-message", message: capture(1000 + sequence) });
  }
  session.runtime.dispatch({ type: "set-visible", visible: true });
  await new Promise((resolve) => setTimeout(resolve, 64));
  await dispose();
  return lifecycleProbe("full-ui", {
    panelMounted: true,
    runtimeCreated: true,
    initialHistoryEvents: 12,
    captureCommands: captureCount,
    visibilityTransitions: 2
  });
}

async function cycleMount() {
  await dispose();
  const reactRoot = createRoot(root);
  reactRoot.render(createElement("div", { "data-perf-mount": "true" }, "Mount probe"));
  await frame();
  reactRoot.unmount();
  root.textContent = "";
  await new Promise((resolve) => setTimeout(resolve, 0));
  return lifecycleProbe("mount", { trivialRootMounted: true });
}

async function cycleRuntime() {
  return cycleTrivialRoot({ scenario: "runtime" });
}

async function cycleHistory() {
  return cycleTrivialRoot({ scenario: "history", initialCount: 12 });
}

async function cycleCapture(captureCount) {
  return cycleTrivialRoot({ scenario: "capture", initialCount: 12, captureCount });
}

async function cycleVisibility(captureCount) {
  return cycleTrivialRoot({ scenario: "visibility", initialCount: 12, captureCount, toggleVisibility: true });
}

async function cycleTrivialRoot({ scenario, initialCount = 0, captureCount = 0, toggleVisibility = false } = {}) {
  await dispose();
  const reactRoot = createRoot(root);
  reactRoot.render(createElement("div", { "data-perf-mount": "true" }, "Mount probe"));
  await frame();
  const current = createRuntimeSession(initialCount);
  for (let sequence = 1; sequence <= captureCount; sequence += 1) {
    current.runtime.dispatch({ type: "ingest-capture-message", message: capture(1000 + sequence) });
  }
  if (toggleVisibility) {
    current.runtime.dispatch({ type: "set-visible", visible: false });
    current.runtime.dispatch({ type: "set-visible", visible: true });
    await new Promise((resolve) => setTimeout(resolve, 64));
  }
  await closeRuntimeSession(current);
  reactRoot.unmount();
  root.textContent = "";
  await new Promise((resolve) => setTimeout(resolve, 0));
  return lifecycleProbe(scenario, {
    trivialRootMounted: true,
    runtimeCreated: true,
    initialHistoryEvents: initialCount,
    captureCommands: captureCount,
    visibilityTransitions: toggleVisibility ? 2 : 0
  });
}

function lifecycleProbe(scenario, values = {}) {
  return {
    scenario,
    trivialRootMounted: false,
    panelMounted: false,
    runtimeCreated: false,
    initialHistoryEvents: 0,
    captureCommands: 0,
    visibilityTransitions: 0,
    ...values
  };
}

async function dispose() {
  if (!session) {
    root.textContent = "";
    return;
  }
  const current = session;
  session = null;
  current.reactRoot.unmount();
  await closeRuntimeSession(current);
  root.textContent = "";
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))];
}

globalThis.__LSEW_PANEL_PERF__ = { mount, ingest, cycle, dispose };
if (new URL(globalThis.location.href).searchParams.get("lifecycleOnly") !== "1") await mount(12);
document.documentElement.dataset.panelPerfReady = "true";
`;
}

async function measureColdLoads(context, url) {
  const runs = [];
  for (let run = 1; run <= 5; run += 1) {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Find", exact: true }).waitFor({ state: "visible" });
    const semanticReadyMs = await page.evaluate(() => performance.now());
    const after = await performanceMetrics(cdp);
    runs.push({
      run,
      semanticReadyMs,
      scriptDurationMs: secondsToMs(after.ScriptDuration),
      parseCompileDurationMs: secondsToMs(after.V8CompileDuration),
      taskDurationMs: secondsToMs(after.TaskDuration)
    });
    await page.close();
  }
  return {
    runs,
    semanticReadyMs: summarize(runs.map((run) => run.semanticReadyMs)),
    scriptDurationMs: summarize(runs.map((run) => run.scriptDurationMs)),
    parseCompileDurationMs: summarize(runs.map((run) => run.parseCompileDurationMs)),
    taskDurationMs: summarize(runs.map((run) => run.taskDurationMs))
  };
}

async function measureHighVolume(context, url) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('html[data-panel-perf-ready="true"]').waitFor();
  const before = await performanceMetrics(cdp);
  const result = await page.evaluate(() => globalThis.__LSEW_PANEL_PERF__.ingest({ count: 180, intervalMs: 2 }));
  const after = await performanceMetrics(cdp);
  await page.close();
  const delta = subtractMetrics(after, before);
  const maxLongTaskMs = result.longTasks.reduce((max, task) => Math.max(max, task.durationMs), 0);
  return {
    eventCount: 180,
    intervalMs: 2,
    durationMs: result.durationMs,
    longTaskSupported: result.longTaskSupported,
    longTasks: result.longTasks,
    maxLongTaskMs,
    visibleEvidenceRefreshSamples: result.mutationTimes.length,
    maxRefreshGapMs: result.maxRefreshGapMs,
    p95RefreshGapMs: result.p95RefreshGapMs,
    finalRenderedEvidenceRows: result.evidenceRows,
    scriptDurationMs: secondsToMs(delta.ScriptDuration),
    parseCompileDurationMs: secondsToMs(delta.V8CompileDuration),
    taskDurationMs: secondsToMs(delta.TaskDuration)
  };
}

async function measureLifecycleRuns(browser, url, configuration) {
  const runs = [];
  for (let run = 1; run <= configuration.lifecycleRuns; run += 1) {
    const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
    try {
      runs.push({
        run,
        scenario: configuration.lifecycleScenario,
        ...(await measureLifecycle(context, `${url}?lifecycleOnly=1`, configuration))
      });
    } finally {
      await context.close();
    }
  }
  return runs;
}

async function measureLifecycle(context, url, configuration) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  let gcSupported = true;
  try {
    await cdp.send("HeapProfiler.enable");
  } catch {
    gcSupported = false;
  }
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('html[data-panel-perf-ready="true"]').waitFor();
  const startedAt = performance.now();
  const collectGarbage = async () => {
    if (!gcSupported) return;
    try {
      await cdp.send("HeapProfiler.collectGarbage");
    } catch {
      gcSupported = false;
    }
  };
  for (let cycle = 0; cycle < configuration.warmupCycles; cycle += 1) {
    await page.evaluate((scenario) => globalThis.__LSEW_PANEL_PERF__.cycle({ scenario, captureCount: 60 }), configuration.lifecycleScenario);
    await collectGarbage();
  }

  const retainedHeapBytes = [];
  let probe;
  for (let cycle = 1; cycle <= configuration.recordedCycles; cycle += 1) {
    const currentProbe = await page.evaluate(
      (scenario) => globalThis.__LSEW_PANEL_PERF__.cycle({ scenario, captureCount: 60 }),
      configuration.lifecycleScenario
    );
    if (currentProbe.scenario !== configuration.lifecycleScenario) {
      throw new Error(`Lifecycle probe mismatch: expected ${configuration.lifecycleScenario}, received ${currentProbe.scenario}.`);
    }
    probe ??= currentProbe;
    await collectGarbage();
    const metrics = await performanceMetrics(cdp);
    retainedHeapBytes.push(Math.round(metrics.JSHeapUsedSize ?? 0));
  }
  await page.close();
  const { monotonicGrowth } = evaluateLifecycleRun({ gcSupported, retainedHeapBytes });
  return {
    cycles: configuration.recordedCycles,
    warmupCycles: configuration.warmupCycles,
    gcSupported,
    retainedHeapBytes,
    netHeapGrowthBytes: retainedHeapBytes.at(-1) - retainedHeapBytes[0],
    strictMonotonicGrowth: monotonicGrowth,
    elapsedMs: performance.now() - startedAt,
    probe
  };
}

function summarizeLifecycleRuns(runs) {
  const reproducedRuns = runs.filter((run) => run.strictMonotonicGrowth).map((run) => run.run);
  return {
    runs: runs.length,
    strictMonotonicGrowthRuns: reproducedRuns,
    strictMonotonicGrowthCount: reproducedRuns.length,
    strictMonotonicGrowthRate: runs.length === 0 ? 0 : reproducedRuns.length / runs.length
  };
}

function lifecycleLimitations(runs) {
  const gcSupported = runs.every((run) => run.gcSupported);
  return [
    "Measurements use a deterministic standalone panel harness, not DevTools frontend docking overhead.",
    gcSupported
      ? "Heap values are post-CDP-GC retained JS heap, not a full browser-process memory accounting."
      : "CDP garbage collection was unavailable for at least one run; that run's heap values are observational and do not gate lifecycle leakage."
  ];
}

async function performanceMetrics(cdp) {
  const response = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]));
}

function subtractMetrics(after, before) {
  return Object.fromEntries(
    Object.entries(after).map(([name, value]) => [name, Number(value) - Number(before[name] ?? 0)])
  );
}

async function measureArtifact(directoryName, packageOutput) {
  const directory = resolve(projectRoot, directoryName);
  const files = await listFiles(directory);
  await mkdir(packageOutput, { recursive: true });
  const result = spawnSync(
    process.execPath,
    [
      "scripts/package-extension.mjs",
      "--dist",
      directoryName,
      "--out-dir",
      packageOutput,
      "--skip-typecheck",
      "--skip-tests",
      "--skip-build"
    ],
    { cwd: projectRoot, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`Unable to package ${directoryName}: ${result.stderr || result.stdout}`);
  }
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const zipPath = join(packageOutput, `${packageJson.name}-v${packageJson.version}.zip`);
  const javascript = {};
  for (const file of files.filter((file) => file.relativePath.endsWith(".js"))) {
    const source = await readFile(file.absolutePath);
    javascript[file.relativePath] = {
      rawBytes: source.byteLength,
      gzipBytes: gzipSync(source, { level: 9 }).byteLength
    };
  }
  return {
    unpackedBytes: files.reduce((total, file) => total + file.size, 0),
    storedZipBytes: (await stat(zipPath)).size,
    fileCount: files.length,
    javascript
  };
}

async function measureIsolation() {
  const javascript = await javascriptContents(resolve(projectRoot, "dist"));
  const panelPath = "extension/panel/index.js";
  const lazyEditorPath = "assets/local-injection-document.js";
  const reactSignature = /__REACT|react-dom|useSyncExternalStore/;
  const nonPanelReactFiles = [...javascript.entries()]
    .filter(([path]) => path !== panelPath && path !== lazyEditorPath)
    .filter(([, source]) => reactSignature.test(source.toString("utf8")))
    .map(([path]) => path);
  const panel = javascript.get(panelPath)?.toString("utf8") ?? "";
  return {
    reactConfinedToPanel: nonPanelReactFiles.length === 0,
    nonPanelReactFiles,
    panelUsesReact: reactSignature.test(panel),
    legacyCompatibilityAbsent: !/LSEW_PANEL_RENDERER|renderPanel|PanelController|view-selector/.test(panel),
    lazyEditorSeparated:
      panel.includes("local-injection-document.js") && javascript.has(lazyEditorPath)
  };
}

async function environmentSnapshot(browser, chromeExecutable) {
  const [npmVersion, gitCommit, gitStatus, vitePackage, reactPackage, reactDomPackage] = await Promise.all([
    commandOutput("npm", ["--version"]),
    commandOutput("git", ["rev-parse", "HEAD"]),
    commandOutput("git", ["status", "--porcelain"]),
    readJson("node_modules/vite/package.json"),
    readJson("node_modules/react/package.json"),
    readJson("node_modules/react-dom/package.json")
  ]);
  return {
    platform: platform(),
    architecture: arch(),
    osRelease: release(),
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    v8: process.versions.v8,
    npm: npmVersion,
    chrome: await browser.version(),
    chromeExecutable,
    vite: vitePackage.version,
    react: reactPackage.version,
    reactDom: reactDomPackage.version,
    gitCommit,
    gitDirty: gitStatus.length > 0,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

function printSummary(report, jsonPath) {
  console.log("\nWorkbench panel performance evidence");
  if (report.mode === "lifecycle-only") {
    console.table(
      report.lifecycleRuns.map((run) => ({
        metric: `Lifecycle run ${run.run} (${run.scenario})`,
        value: `${run.retainedHeapBytes.map(formatBytes).join(" → ")} (${run.strictMonotonicGrowth ? "strict growth" : "not strict"}; ${formatMs(run.elapsedMs)})`
      }))
    );
    console.log(
      `Strict-growth reproductions: ${report.lifecycleAggregate.strictMonotonicGrowthCount}/${report.lifecycleAggregate.runs} (${formatPercent(report.lifecycleAggregate.strictMonotonicGrowthRate)}).`
    );
    console.log(`Environment: ${report.environment.chrome}; ${report.environment.platform} ${report.environment.architecture}; Node ${report.environment.node}`);
    console.log(`JSON: ${jsonPath}`);
    return;
  }
  console.table([
    {
      metric: "Cold semantic ready (5-run mean / p95)",
      value: `${formatMs(report.coldLoads.semanticReadyMs.mean)} / ${formatMs(report.coldLoads.semanticReadyMs.p95)}`
    },
    {
      metric: "Cold script / V8 compile / task mean",
      value: `${formatMs(report.coldLoads.scriptDurationMs.mean)} / ${formatMs(report.coldLoads.parseCompileDurationMs.mean)} / ${formatMs(report.coldLoads.taskDurationMs.mean)}`
    },
    { metric: "High-volume max panel task", value: formatMs(report.highVolume.maxLongTaskMs) },
    {
      metric: "Visible Evidence refresh gap max / p95",
      value: `${formatOptionalMs(report.highVolume.maxRefreshGapMs)} / ${formatOptionalMs(report.highVolume.p95RefreshGapMs)}`
    },
    {
      metric: "Retained heap after lifecycle cycles",
      value: report.lifecycle.retainedHeapBytes.map(formatBytes).join(" → ")
    },
    {
      metric: "Production stored ZIP",
      value: formatBytes(report.artifacts.production.storedZipBytes)
    },
    {
      metric: "Initial panel JS raw",
      value: formatBytes(report.artifacts.production.javascript["extension/panel/index.js"].rawBytes)
    }
  ]);
  console.log(`Environment: ${report.environment.chrome}; ${report.environment.platform} ${report.environment.architecture}; Node ${report.environment.node}`);
  console.log(`JSON: ${jsonPath}`);
}

function printGate(gate) {
  if (gate.passed) {
    console.log("Performance gate: PASS (no >50 ms panel task; no monotonic lifecycle leak)." );
    return;
  }
  for (const failure of gate.failures) console.error(`Performance gate: FAIL — ${failure}`);
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1)
  };
}

function percentile(sortedValues, quantile) {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * quantile))];
}

function secondsToMs(value) {
  return Number.isFinite(value) ? Math.max(0, value * 1000) : 0;
}

function formatMs(value) {
  return `${Number(value).toFixed(1)} ms`;
}

function formatOptionalMs(value) {
  return value === null || value === undefined ? "not observed" : formatMs(value);
}

function formatBytes(value) {
  return `${Math.round(value).toLocaleString("en-US")} B`;
}

function formatPercent(value) {
  return `${(Number(value) * 100).toFixed(0)}%`;
}

function contentType(path) {
  switch (extname(path)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

function assertBuildExists(directory) {
  if (!existsSync(resolve(projectRoot, directory, "manifest.json"))) {
    throw new Error(`Missing ${directory}; run the package command so both renderer artifacts are built.`);
  }
}

async function resolveChromeExecutable() {
  const cacheDir = process.env.LSEW_BROWSER_CACHE_DIR?.trim() || resolve(projectRoot, ".cache/lsew-browsers");
  const installed = new Cache(cacheDir)
    .getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [
    process.env.CHROME_PATH?.trim(),
    ...installed,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next locally installed browser.
    }
  }
  throw new Error("Chrome was not found. Run fixture:browser:install or set CHROME_PATH.");
}

async function listFiles(directory) {
  const files = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: relative(directory, absolutePath).split(sep).join("/"),
          size: (await stat(absolutePath)).size
        });
      }
    }
  }
  await visit(directory);
  return files;
}

async function javascriptContents(directory) {
  const result = new Map();
  for (const file of await listFiles(directory)) {
    if (file.relativePath.endsWith(".js")) result.set(file.relativePath, await readFile(file.absolutePath));
  }
  return result;
}

async function commandOutput(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: projectRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unavailable";
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), "utf8"));
}
