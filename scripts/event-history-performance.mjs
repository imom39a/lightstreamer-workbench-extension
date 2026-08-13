#!/usr/bin/env node

/**
 * Deliberate Event History release gate. This runner is intentionally visible:
 * proof must not silently turn into a headless or synthetic measurement.
 */
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { execFile, execFileSync, spawn } from "node:child_process";
import { Browser, Cache } from "@puppeteer/browsers";
import { build } from "esbuild";
import WebSocket from "ws";
import {
  collectHeapAfterRepeatedGc,
  createTimeoutDiagnostic,
  createPerformanceShardPlan,
  aggregatePerformanceShardResults,
  PerformanceOperationTimeout,
  createSharedDeadlineTimeout,
  releaseHeapSessionWithCleanup,
  runHeapMeasurementPlan,
  runPageOperation,
  requestControlCdpWithDeadline
} from "./event-history-performance-runner-operations.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(rootDir, process.env.LSEW_EVENT_HISTORY_PERF_OUTPUT ?? "test-results/event-history-performance.json");
const markdownPath = outputPath.replace(/\.json$/u, ".md");
const referencePath = resolve(rootDir, process.env.LSEW_EVENT_HISTORY_PERF_REFERENCE ?? "docs/reference/event-history-performance-reference.json");
const BROWSER_TIMEOUT_MS = 240_000;
const STARTUP_REQUEST_TIMEOUT_MS = 5_000;
// terminateChild has a documented 1,000 ms SIGTERM grace period followed by a
// 1,000 ms SIGKILL/close period. The outer bound must contain both phases.
const OUTER_FINALIZATION_TIMEOUT_MS = 3_000;
const EVENT_HISTORY_PERFORMANCE_RUN_DEADLINE_MS = positiveFiniteEnvironment(
  "LSEW_EVENT_HISTORY_PERF_DEADLINE_MS",
  3_600_000
);

async function main() {
  requireVisibleEnvironment();
  const captureMode = process.env.LSEW_EVENT_HISTORY_PERF_CAPTURE === "true";
  const reference = captureMode ? undefined : JSON.parse(await readFile(referencePath, "utf8"));
  const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-event-history-performance-"));
  const site = join(temporaryRoot, "site");
  const profile = join(temporaryRoot, "profile");
  const gateModulePath = join(temporaryRoot, "event-history-performance-gate.mjs");
  let chrome;
  let cdp;
  let browserCdp;
  let initialTarget;
  let chromeOutput = "";
  let chromeMetadata = null;
  let environmentMetadata = null;
  let primaryError = null;
  try {
    await mkdir(site, { recursive: true });
    await build({ entryPoints: [join(rootDir, "benchmarks/event-history-performance-gate.ts")], outfile: gateModulePath, bundle: true, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
    const { classifyEventHistoryPerformance, validateEventHistoryPerformanceReference } = await import(pathToFileURL(gateModulePath).href);
    if (!captureMode && !validateEventHistoryPerformanceReference(reference)) {
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
    const indexPath = join(site, "index.html");
    await writeFile(indexPath, createHarnessDocument());
    const url = pathToFileURL(indexPath).href;
    const executable = await chromeExecutable();
    chrome = spawn(executable, chromeLaunchArguments(profile), { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] });
    chrome.stdout.on("data", (chunk) => { chromeOutput += String(chunk); });
    chrome.stderr.on("data", (chunk) => { chromeOutput += String(chunk); });
    const debugPort = await debuggingPort(profile, chrome);
    const activateWindow = () => activateSpawnedChromeWindow(chrome.pid, {
      applicationPath: executable.replace(/\/Contents\/MacOS\/[^/]+$/u, "")
    });
    await activateWindow();
    const proofDeadlineAt = Date.now() + EVENT_HISTORY_PERFORMANCE_RUN_DEADLINE_MS;
    const browserSocketUrl = await browserTarget(debugPort, { deadlineMs: remainingDeadlineMs(proofDeadlineAt, BROWSER_TIMEOUT_MS, "browser-websocket") });
    browserCdp = await connect(browserSocketUrl, { deadlineMs: remainingDeadlineMs(proofDeadlineAt, BROWSER_TIMEOUT_MS, "browser-connect") });
    const environment = await requestControlCdpWithDeadline(browserCdp, "Browser.getVersion", {}, { deadlineAt: proofDeadlineAt, phase: "Browser.getVersion" });
    initialTarget = await openHarnessTarget(browserCdp, debugPort, url, { deadlineAt: proofDeadlineAt, activateWindow });
    cdp = initialTarget.cdp;
    await prepareInitialPageForAuthoritativeRun(cdp, url, { deadlineAt: proofDeadlineAt });
    const chromeMajor = chromeMajorFromProduct(environment.product);
    if (chromeMajor !== 151) throw new Error(`Expected Chrome for Testing major 151, got ${environment.product}.`);
    chromeMetadata = {
      kind: "real-chrome",
      headless: false,
      fakeIndexedDbUsed: false,
      product: environment.product,
      userAgent: environment.userAgent,
      jsVersion: environment.jsVersion
    };
    environmentMetadata = {
      chromeMajor,
      platformClass: process.platform === "darwin" ? "darwin" : process.platform,
      architectureClass: process.arch,
      headless: false
    };
    const shardResults = [];
    let lastOperationStatus = null;
    for (const [index, plannedShard] of createPerformanceShardPlan().entries()) {
      const selection = { ...plannedShard, pageToken: `${index + 1}-${randomUUID()}` };
      const page = await openFreshHarnessPage(browserCdp, debugPort, url, selection.pageToken, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus, activateWindow });
      let primaryError = null;
      let visibleFrameActivationIssued = false;
      try {
        shardResults.push(await runPageOperation(
          page.cdp,
          `window.__LSEW_EVENT_HISTORY_PERFORMANCE__.run({}, ${JSON.stringify(selection)})`,
          {
            deadlineAt: proofDeadlineAt,
            onHeartbeat(status) {
              if (status.stage !== "visible-frame") {
                visibleFrameActivationIssued = false;
              } else if (!visibleFrameActivationIssued) {
                visibleFrameActivationIssued = true;
                void activateWindow().catch(() => undefined);
                void page.cdp.request("Page.bringToFront", {}).catch(() => undefined);
              }
              lastOperationStatus = status;
              process.stderr.write(
                `[event-history-performance:${selection.id}] state=${status.state} elapsedMs=${status.elapsedMs.toFixed(0)} heartbeat=${status.heartbeat}\n`
              );
            }
          }
        ));
      } catch (error) {
        primaryError = error;
        throw error;
      } finally {
        await closeFreshHarnessPageWithErrorPreservation(browserCdp, page, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus }, primaryError);
      }
    }
    const result = aggregatePerformanceShardResults(shardResults);

    const heapPage = await openFreshHarnessPage(browserCdp, debugPort, url, `heap-${randomUUID()}`, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus, activateWindow });
    let heapPlan;
    let primaryHeapError = null;
    try {
      heapPlan = await runHeapMeasurementPlan({
      eventCounts: { indexeddb: 10_000, memory: 5_000 },
      deadlineAt: proofDeadlineAt,
      prepare: ({ adapter, eventCount, phase, sample }) => runPageOperation(
        heapPage.cdp,
        `window.__LSEW_EVENT_HISTORY_PERFORMANCE__.prepareRetainedHeapSample(${JSON.stringify(adapter)}, ${eventCount}, ${JSON.stringify(phase)}, ${sample === null ? "null" : sample})`,
        { deadlineAt: proofDeadlineAt }
      ),
      forceGc: ({ deadlineAt = proofDeadlineAt } = {}) => collectHeapAfterRepeatedGc(heapPage.cdp, 3, { deadlineAt }),
      record: ({ adapter, eventCount, sample, session, baseline, retained }) => ({
        adapter,
        sample,
        eventCount,
        sessionId: session.sessionId,
        databaseName: session.databaseName,
        retained: session.retained,
        baselineUsedSizeBytes: baseline.usedSize,
        retainedUsedSizeBytes: retained.usedSize,
        postGcHeapDeltaBytes: retained.usedSize - baseline.usedSize
      }),
      close: () => runPageOperation(heapPage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.releaseRetainedHeapSample()", { deadlineAt: proofDeadlineAt }),
      removeRoot: () => runPageOperation(heapPage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.removeRetainedHeapRoot()", { deadlineAt: proofDeadlineAt }),
      yieldFrame: () => runPageOperation(heapPage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.yieldRetainedHeapFrame()", { deadlineAt: proofDeadlineAt })
      });
    } catch (error) {
      primaryHeapError = error;
      throw error;
    } finally {
      await closeFreshHarnessPageWithErrorPreservation(browserCdp, heapPage, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus }, primaryHeapError);
    }
    const heapSamples = heapPlan.heapSamples;

    const lifecyclePage = await openFreshHarnessPage(browserCdp, debugPort, url, `lifecycle-${randomUUID()}`, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus, activateWindow });
    const lifecycleRetainedHeapBytes = [];
    let primaryLifecycleError = null;
    try {
      for (let sample = 0; sample < 3; sample += 1) {
        const baseline = await collectHeapAfterRepeatedGc(lifecyclePage.cdp, 3, { deadlineAt: proofDeadlineAt });
        await runPageOperation(lifecyclePage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.prepareRetainedHeapSample('memory', 100, 'sample', 1)", { deadlineAt: proofDeadlineAt });
        const released = await releaseHeapSessionWithCleanup({
          release: () => runPageOperation(lifecyclePage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.releaseRetainedHeapSample()", { deadlineAt: proofDeadlineAt }),
          removeRoot: () => runPageOperation(lifecyclePage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.removeRetainedHeapRoot()", { deadlineAt: proofDeadlineAt }),
          yieldFrame: () => runPageOperation(lifecyclePage.cdp, "window.__LSEW_EVENT_HISTORY_PERFORMANCE__.yieldRetainedHeapFrame()", { deadlineAt: proofDeadlineAt }),
          forceGc: () => collectHeapAfterRepeatedGc(lifecyclePage.cdp, 3, { deadlineAt: proofDeadlineAt }),
          deadlineAt: proofDeadlineAt
        });
        lifecycleRetainedHeapBytes.push(released.usedSize - baseline.usedSize);
      }
    } catch (error) {
      primaryLifecycleError = error;
      throw error;
    } finally {
      await closeFreshHarnessPageWithErrorPreservation(browserCdp, lifecyclePage, { deadlineAt: proofDeadlineAt, operation: lastOperationStatus }, primaryLifecycleError);
    }

    const report = {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      runner: chromeMetadata,
      source: {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim(),
        dirty: execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim().length > 0
      },
      environment: {
        ...environmentMetadata
      },
      anchors: result.anchors,
      capabilities: {
        interCellGc: "EXPOSED_THREE_PASS_V1",
        interQuerySampleGc: "EXPOSED_THREE_PASS_V1",
        interQueryGcLongTasks: "EXPLICIT_HYGIENE_PHASE_V1"
      },
      config: result.config,
      shapeFacts: result.shapeFacts,
      shards: result.shards,
      cells: result.cells,
      queryCells: result.queryCells,
      cellCleanupGc: result.cellCleanupGc,
      terminalScenarios: result.terminalScenarios,
      checkpointScenarios: result.checkpointScenarios,
      heapSamples,
      heapRuns: heapPlan.heapRuns,
      lifecycle: {
        retainedHeapBytes: lifecycleRetainedHeapBytes,
        strictMonotonicGrowth: isStrictlyMonotonic(lifecycleRetainedHeapBytes)
      },
      telemetry: { storageEstimate: "Per-cell navigator.storage.estimate() telemetry is non-authoritative; unavailable/error states are retained and excluded from verdict gates." }
    };
    const decision = captureMode
      ? classifyEventHistoryPerformance(report, undefined, "capture-only")
      : classifyEventHistoryPerformance(report, reference);
    const complete = { ...report, decision, reference: { path: referencePath, separatelyPinned: !captureMode, adopted: false } };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(complete, null, 2)}\n`);
    await writeFile(markdownPath, markdown(complete));
    process.stdout.write(`${JSON.stringify({ verdict: decision.verdict, failures: decision.failures, reviewReasons: decision.reviewReasons, report: outputPath }, null, 2)}\n`);
    if (decision.verdict === "FAIL") throw new Error(`Event History performance gate failed. See ${outputPath}.`);
  } catch (error) {
    primaryError = normalizePerformanceTimeout(error) ?? error;
    if (chromeOutput) process.stderr.write(`\nChrome output:\n${chromeOutput.slice(-8_000)}\n`);
  } finally {
    const finalizedError = await finalizePerformanceRun({
      primaryError,
      timeout: primaryError instanceof PerformanceOperationTimeout ? primaryError : null,
      writeEvidence: primaryError instanceof PerformanceOperationTimeout
        ? () => writeTimeoutEvidenceForTimeout({
          outputPath,
          markdownPath,
          timeout: primaryError,
          source: safeSourceState(),
          runner: chromeMetadata,
          environment: environmentMetadata,
          referencePath,
          deadlineMs: EVENT_HISTORY_PERFORMANCE_RUN_DEADLINE_MS
        })
        : null,
      closeCdp: cdp ? () => cdp.close() : null,
      closeInitialTarget: initialTarget ? ({ deadlineAt }) => closeFreshHarnessPage(browserCdp, initialTarget, { deadlineAt }) : null,
      closeBrowserCdp: browserCdp ? () => browserCdp.close() : null,
      terminateChrome: chrome ? ({ deadlineAt }) => terminateChild(chrome, deadlineAt) : null,
      removeTemporaryRoot: () => rm(temporaryRoot, { recursive: true, force: true }),
      timeoutMs: OUTER_FINALIZATION_TIMEOUT_MS
    });
    if (finalizedError) throw finalizedError;
  }
}

export async function prepareInitialPageForAuthoritativeRun(cdp, expectedUrl, timeoutOrOptions = 30_000) {
  const options = startupDeadlineOptions(timeoutOrOptions);
  await ensureFreshHarnessDocument(cdp, expectedUrl, Math.min(15_000, remainingDeadlineMs(options.deadlineAt, 15_000, "initial-document")), options);
  await waitForHarness(cdp, options);
  await preparePageForAuthoritativeRun(cdp, options);
}

export function createHarnessDocument() {
  return '<!doctype html><meta charset="utf-8"><title>Event History performance gate</title><link rel="stylesheet" href="./harness.css"><main id="app"></main><script type="module" src="./harness.js"></script>';
}

export async function preparePageForAuthoritativeRun(cdp, timeoutMs = 30_000) {
  const options = startupDeadlineOptions(timeoutMs);
  const deadlineAt = options.deadlineAt;
  await requestSetupCdp(cdp, "Page.bringToFront", {}, deadlineAt, "page-bring-to-front", options);
  const probeTimeoutMs = Math.max(1, Math.min(1_000, remainingDeadlineMs(deadlineAt, 1_000, "page-visibility") - 1));
  const visible = await evaluateWithDeadline(cdp, `new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => finish(false), ${probeTimeoutMs});
    if (document.visibilityState !== "visible") {
      finish(false);
      return;
    }
    requestAnimationFrame(() => {
      if (document.visibilityState !== "visible") {
        finish(false);
        return;
      }
      requestAnimationFrame(() => finish(document.visibilityState === "visible"));
    });
  })`, deadlineAt, "page-visibility", options);
  if (visible !== true) {
    throw new Error("Event History performance run requires a visible foreground page.");
  }
}

export async function openHarnessTarget(controlCdp, debugPort, pageUrl, options = {}) {
  const created = await requestControlCdpWithDeadline(controlCdp, "Target.createTarget", { url: pageUrl }, { ...options, phase: "Target.createTarget" });
  if (typeof created?.targetId !== "string" || created.targetId.length === 0) throw new Error("Chrome did not return a target id for the initial harness page.");
  await options.activateWindow?.();
  let pageCdp;
  try {
    pageCdp = await connect(await pageTarget(debugPort, pageUrl, { ...options, targetId: created.targetId, deadlineMs: remainingDeadlineMs(options.deadlineAt, BROWSER_TIMEOUT_MS, "page-target") }), { deadlineMs: remainingDeadlineMs(options.deadlineAt, BROWSER_TIMEOUT_MS, "page-connect"), createSocket: options.createSocket });
    await ensureFreshHarnessDocument(pageCdp, pageUrl, 15_000, options);
    return { cdp: pageCdp, targetId: created.targetId, pageToken: "initial", url: pageUrl };
  } catch (error) {
    try {
      await closeFreshHarnessPageWithErrorPreservation(controlCdp, { cdp: pageCdp ?? { close() {} }, targetId: created.targetId, pageToken: "initial" }, options, error);
    } catch (cleanupError) {
      attachCleanupEvidence(error, cleanupError);
    }
    throw error;
  }
}

export async function openFreshHarnessPage(controlCdp, debugPort, baseUrl, pageToken, options = {}) {
  if (typeof pageToken !== "string" || pageToken.length === 0) throw new Error("Fresh harness page requires a non-empty page token.");
  const pageUrl = new URL(harnessPageUrl(baseUrl, pageToken));
  const created = await requestControlCdpWithDeadline(controlCdp, "Target.createTarget", { url: pageUrl.href }, { ...options, phase: "Target.createTarget" });
  if (typeof created?.targetId !== "string" || created.targetId.length === 0) throw new Error("Chrome did not return a target id for the fresh harness page.");
  await options.activateWindow?.();
  let pageCdp;
  try {
    pageCdp = await connect(await pageTarget(debugPort, pageUrl.href, { ...options, targetId: created.targetId, deadlineMs: remainingDeadlineMs(options.deadlineAt, BROWSER_TIMEOUT_MS, "page-target") }), { deadlineMs: remainingDeadlineMs(options.deadlineAt, BROWSER_TIMEOUT_MS, "page-connect"), createSocket: options.createSocket });
    await ensureFreshHarnessDocument(pageCdp, pageUrl.href, 15_000, options);
    await waitForHarness(pageCdp, options);
    await preparePageForAuthoritativeRun(pageCdp, options);
    const observedToken = options.deadlineAt !== undefined
      ? await evaluateWithDeadline(pageCdp, "new URL(location.href).searchParams.get('pageToken')", options.deadlineAt, "page-token")
      : await evaluate(pageCdp, "new URL(location.href).searchParams.get('pageToken')", BROWSER_TIMEOUT_MS);
    if (observedToken !== pageToken) throw new Error("Fresh harness page token mismatch.");
    return { cdp: pageCdp, targetId: created.targetId, pageToken, url: pageUrl.href };
  } catch (error) {

    try {
      await closeFreshHarnessPageWithErrorPreservation(controlCdp, { cdp: pageCdp ?? { close() {} }, targetId: created.targetId, pageToken }, { ...options, phase: "Target.closeTarget" }, error);
    } catch (cleanupError) {
      attachCleanupEvidence(error, cleanupError);
    }
    throw error;
  }
}

export function harnessPageUrl(baseUrl, pageToken) {
  if (typeof pageToken !== "string" || pageToken.length === 0) throw new Error("Fresh harness page requires a non-empty page token.");
  const pageUrl = new URL(baseUrl);
  pageUrl.searchParams.set("pageToken", pageToken);
  return pageUrl.href;
}

export async function ensureFreshHarnessDocument(cdp, expectedUrl, timeoutMs = 15_000, options = {}) {
  const effectiveOptions = Number.isFinite(options.deadlineAt)
    ? options
    : { ...options, deadlineAt: Date.now() + positiveFiniteStartupOption(timeoutMs, "timeoutMs") };
  await requestSetupCdp(cdp, "Page.enable", {}, effectiveOptions.deadlineAt, "page-enable", effectiveOptions);
  await requestSetupCdp(cdp, "Runtime.enable", {}, effectiveOptions.deadlineAt, "runtime-enable", effectiveOptions);
  const deadline = Math.min(Date.now() + positiveFiniteStartupOption(timeoutMs, "timeoutMs"), effectiveOptions.deadlineAt);
  const initialResponse = await evaluateResponseWithDeadline(cdp, {
    expression: "location.href",
    awaitPromise: true,
    returnByValue: true
  }, effectiveOptions.deadlineAt, "page-document-evaluate", effectiveOptions);
  if (initialResponse?.result?.value === expectedUrl) return;
  while (Date.now() < deadline) {
    const response = await evaluateResponseWithDeadline(cdp, {
      expression: "location.href",
      awaitPromise: true,
      returnByValue: true
    }, effectiveOptions.deadlineAt, "page-document-evaluate", effectiveOptions);
    if (response?.result?.value === expectedUrl) return;
    await delay(Math.min(100, Math.max(1, deadline - Date.now())));
  }
  throw createSharedDeadlineTimeout("page-document-polling", deadline, Date.now, effectiveOptions.operation ?? null);
}

export async function closeFreshHarnessPage(controlCdp, page, options = {}) {
  page.cdp.close();
  const closed = await requestControlCdpWithDeadline(controlCdp, "Target.closeTarget", { targetId: page.targetId }, { ...options, phase: "Target.closeTarget", allowAfterDeadline: true });
  if (closed?.success !== true) throw new Error(`Fresh harness page ${page.pageToken} did not close cleanly.`);
  return { pageToken: page.pageToken, targetId: page.targetId, closed: true };
}

export async function closeFreshHarnessPageWithErrorPreservation(controlCdp, page, options = {}, primaryError = null) {
  try {
    return await closeFreshHarnessPage(controlCdp, page, options);
  } catch (cleanupError) {
    if (primaryError) {
      attachCleanupEvidence(primaryError, cleanupError);
      return null;
    }
    throw cleanupError;
  }
}

function attachCleanupEvidence(primaryError, cleanupError) {
  if (primaryError && (typeof primaryError === "object" || typeof primaryError === "function")) {
    primaryError.cleanupEvidence = {
      code: cleanupError?.status?.error?.code ?? cleanupError?.code ?? cleanupError?.name ?? "CLEANUP_FAILED",
      message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      status: cleanupError?.status ?? null
    };
  }
}

export function chromeLaunchArguments(profile, platform = process.platform) {
  const args = [
    "--no-sandbox",
    "--no-proxy-server",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    "--allow-file-access-from-files",
    "--js-flags=--expose-gc",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
  ];
  if (platform === "darwin") args.push("--activate-on-launch");
  args.push("about:blank");
  return args;
}

/**
 * Bring only the CfT application bundle owned by this run to the macOS
 * foreground. Launch Services avoids Apple Events/Accessibility prompts.
 * `document.visibilityState` is not sufficient evidence that a headed
 * renderer is receiving compositor frames when the runner starts behind a
 * terminal or another app. This control action never substitutes for the
 * page's rAF-based visible-frame proof.
 */
export function activateSpawnedChromeWindow(pid, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return Promise.resolve({ attempted: false });
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Promise.reject(new Error("Cannot activate Chrome without its spawned process id."));
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 2_000;
  if (typeof options.applicationPath !== "string" || options.applicationPath.length === 0) {
    return Promise.reject(new Error("Cannot activate Chrome without its application bundle path."));
  }
  const execute = options.execute ?? ((file, args, callback) => execFile(file, args, { stdio: ["ignore", "ignore", "pipe"] }, callback));
  return new Promise((resolve, reject) => {
    let settled = false;
    let childProcess;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(new Error(`Could not activate spawned Chrome window: ${error.message ?? String(error)}`));
      else resolve({ attempted: true, pid, applicationPath: options.applicationPath });
    };
    const timer = setTimeout(() => {
      try { childProcess?.kill("SIGKILL"); } catch { /* preserve the activation timeout */ }
      finish(new Error(`open timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    try {
      childProcess = execute("/usr/bin/open", ["-a", options.applicationPath], (error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
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

function positiveFiniteEnvironment(name, fallback) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  return value;
}

function sourceState() {
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim(),
    dirty: execFileSync("git", ["status", "--porcelain"], { cwd: rootDir, encoding: "utf8" }).trim().length > 0
  };
}

function safeSourceState() {
  try { return sourceState(); } catch { return { revision: "unknown", dirty: "unknown" }; }
}

export function normalizePerformanceTimeout(error) {
  if (error instanceof PerformanceOperationTimeout) return error;
  if (!error || typeof error !== "object" || error.name !== "HarnessStageTimeout") return null;
  const progress = error.progress && typeof error.progress === "object" ? error.progress : null;
  const stage = typeof error.stage === "string" ? error.stage : (typeof progress?.stage === "string" ? progress.stage : null);
  const status = {
    operationId: typeof progress?.operationId === "string" ? progress.operationId : null,
    state: "rejected",
    elapsedMs: Number.isFinite(progress?.pageElapsedMs) ? progress.pageElapsedMs : 0,
    heartbeat: null,
    progress,
    error: {
      name: error.name,
      message: typeof error.message === "string" ? error.message : String(error),
      stack: typeof error.stack === "string" ? error.stack : null,
      ...(typeof error.code === "string" ? { code: error.code } : {}),
      ...(stage !== null ? { stage } : {})
    }
  };
  return new PerformanceOperationTimeout("Event History performance harness stage timed out.", status);
}

export async function finalizePerformanceRun({
  primaryError = null,
  timeout = null,
  writeEvidence = null,
  closeCdp = null,
  closeInitialTarget = null,
  closeBrowserCdp = null,
  terminateChrome = null,
  removeTemporaryRoot = null,
  timeoutMs = OUTER_FINALIZATION_TIMEOUT_MS
}) {
  const diagnostics = [];
  if (timeout && writeEvidence) {
    diagnostics.push(await runBoundedOuterOperation("timeout-evidence", writeEvidence, timeoutMs));
  }
  for (const [phase, operation] of [
    ["cdp-close", closeCdp],
    ["initial-target-close", closeInitialTarget],
    ["browser-cdp-close", closeBrowserCdp],
    ["chrome-termination", terminateChrome],
    ["temporary-root-removal", removeTemporaryRoot]
  ]) {
    if (operation) diagnostics.push(await runBoundedOuterOperation(phase, operation, timeoutMs));
  }
  const failures = diagnostics.filter((diagnostic) => diagnostic.outcome !== "completed");
  if (primaryError) {
    if (failures.length && (typeof primaryError === "object" || typeof primaryError === "function")) {
      try { primaryError.outerDiagnostics = failures; } catch { /* Preserve the primary even when it is non-extensible. */ }
    }
    return primaryError;
  }
  if (failures.length) {
    const error = new Error("Event History performance outer cleanup failed.");
    error.name = "PerformanceOuterCleanupError";
    error.diagnostics = failures;
    throw error;
  }
  return null;
}

async function runBoundedOuterOperation(phase, operation, timeoutMs) {
  const bound = positiveFiniteStartupOption(timeoutMs, "outer finalization timeoutMs");
  const deadlineAt = Date.now() + bound;
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => operation({ deadlineAt })),
      new Promise((resolvePromise) => {
        timer = setTimeout(() => resolvePromise({ outcome: "timed-out", phase, code: "OUTER_FINALIZATION_TIMEOUT", message: `Outer ${phase} did not settle within ${bound} ms.` }), bound);
      })
    ]);
    return result?.outcome ? result : { outcome: "completed", phase };
  } catch (error) {
    return {
      outcome: "failed",
      phase,
      code: error?.code ?? error?.name ?? "OUTER_FINALIZATION_FAILED",
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function writeTimeoutEvidence({ outputPath: targetOutputPath, markdownPath: targetMarkdownPath, diagnostic }) {
  await mkdir(dirname(targetOutputPath), { recursive: true });
  await writeFile(targetOutputPath, `${JSON.stringify(diagnostic, null, 2)}\n`);
  await writeFile(targetMarkdownPath, timeoutMarkdown(diagnostic));
}

export async function writeTimeoutEvidenceForTimeout({
  outputPath: targetOutputPath,
  markdownPath: targetMarkdownPath,
  timeout,
  source = safeSourceState(),
  runner = null,
  environment = null,
  referencePath,
  deadlineMs
}) {
  const diagnostic = createTimeoutDiagnostic({
    generatedAt: new Date().toISOString(),
    source,
    runner: runner ?? { kind: "unknown", headless: null, fakeIndexedDbUsed: null, product: null, userAgent: null, jsVersion: null },
    environment: environment ?? { chromeMajor: null, platformClass: null, architectureClass: null, headless: null },
    referencePath,
    deadlineMs,
    operation: { ...timeout.status, phase: timeoutPhase(timeout) }
  });
  await writeTimeoutEvidence({ outputPath: targetOutputPath, markdownPath: targetMarkdownPath, diagnostic });
}

function timeoutPhase(timeout) {
  return timeout?.status?.phase
    ?? timeout?.status?.lastRequestTimeout?.phase
    ?? timeout?.status?.error?.phase
    ?? null;
}

function isStrictlyMonotonic(values) {
  return values.length > 1 && values.every((value, index) => index === 0 || value > values[index - 1]);
}

function markdown(report) {
  const queryRows = (report.queryCells ?? []).map((cell) => `| ${cell.adapter} | ${cell.sample} | ${cell.fixture.eventCount} | ${cell.fixture.distinctCommandKeyCount} | ${cell.latency.recentSimplePage50P95Ms.toFixed(2)} | ${cell.latency.recentSimplePage100P95Ms.toFixed(2)} | ${cell.latency.structuredPage50P95Ms.toFixed(2)} | ${cell.latency.structuredPage100P95Ms.toFixed(2)} | ${cell.latency.findP95Ms.toFixed(2)} | ${cell.latency.lookupP95Ms.toFixed(2)} | ${cell.latency.aroundP95Ms.toFixed(2)} |`).join("\n");
  const querySection = `## Public EventHistory.query() family\n\n| Adapter | Sample | Events | Distinct COMMAND keys | Recent 50 | Recent 100 | Structured 50 | Structured 100 | Find | Lookup | Around |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${queryRows}\n\n`;
  const rows = querySection + report.cells.map((cell) => `| ${cell.adapter} | ${cell.workload} | ${cell.shape} | ${cell.sample} | ${cell.latency.offerToPublicationP95Ms.toFixed(2)} | ${cell.latency.offerToVisibleFrameP95Ms.toFixed(2)} | ${cell.latency.committedBoundaryToVisibleFrameP95Ms.toFixed(2)} | ${cell.latency.behindBacklogMs.toFixed(2)} | ${cell.latency.finalBoundaryVisibleMs === null ? "—" : cell.latency.finalBoundaryVisibleMs.toFixed(2)} | ${cell.latency.recentPageP95Ms.toFixed(2)} | ${cell.latency.structuredIndexedP95Ms.toFixed(2)} | ${cell.latency.findFullP95Ms.toFixed(2)} |`).join("\n");
  const evidenceRows = report.cells.map((cell) => {
    const key = `${cell.adapter}/${cell.workload}/${cell.shape}/sample-${cell.sample}`;
    const correctness = Object.entries(cell.correctness).every(([, value]) => value) ? "PASS" : "FAIL";
    const workload = `${cell.workloadFacts.expectedCount} events; ${cell.workloadFacts.shapeBytes} shape bytes; ${cell.workloadFacts.persistedJsonBytes} persisted JSON bytes; ${cell.workloadFacts.offeredEventsPerSecond.toFixed(2)} events/sec`;
    const storage = `${cell.storage.transactionCount} tx (${cell.storage.readwriteTransactionCount} rw/${cell.storage.readonlyTransactionCount} ro); ${cell.storage.evidenceWriteCount} evidence writes; ${cell.storage.controlWriteCount} control writes; ${cell.storage.facetEntryCount} facet entries; ${cell.storage.indexEntryCount} index entries`;
    const pressure = `${cell.pressure.maxPendingBytes} pending bytes; ${cell.pressure.maxOldestPendingAgeMs.toFixed(2)} ms oldest; states=${cell.pressure.transitions.join(",") || "none"}`;
    const terminal = `${cell.terminal.phase}; reason=${cell.terminal.reason ?? "none"}; boundary=${cell.terminal.committedEvidenceBoundary?.sequence ?? "none"}; missing=${cell.terminal.firstMissingEventId ?? "none"}; refused=${cell.terminal.refusedCount}; discarded=${cell.terminal.discardedCount}`;
    return `| ${key} | ${correctness} (${cell.accepted}/${cell.published}/${cell.retained}) | ${workload} | ${storage} | ${pressure} | ${terminal} | ${JSON.stringify(cell.identityEvidence)} |`;
  }).join("\n");
  const storageEstimateRows = report.cells.map((cell) => {
    const estimate = cell.storageEstimate.status === "AVAILABLE"
      ? `usage=${cell.storageEstimate.usageBytes}; quota=${cell.storageEstimate.quotaBytes}`
      : `unavailable=${cell.storageEstimate.failure?.code ?? "unknown"}: ${cell.storageEstimate.failure?.message ?? "missing diagnostic"}`;
    return `| ${cell.adapter}/${cell.workload}/${cell.shape}/sample-${cell.sample} | ${estimate} |`;
  }).join("\n");
  const longTaskRows = report.cells.map((cell) => `| ${cell.adapter}/${cell.workload}/${cell.shape}/sample-${cell.sample} | capture=${JSON.stringify(cell.longTasks.capture)}; commit=${JSON.stringify(cell.longTasks.commit)}; paint=${JSON.stringify(cell.longTasks.paint)}; query=${JSON.stringify(cell.longTasks.query)}; unattributed=${cell.longTasks.unattributed}; reasons=${JSON.stringify(cell.longTasks.unattributedReasons ?? [])} |`).join("\n");
  const terminalRows = report.terminalScenarios.map((scenario) => `| ${scenario.adapter} | ${scenario.trigger} | ${scenario.terminalReason} | ${scenario.acceptedCount} | ${scenario.refusedCount} | ${JSON.stringify(scenario.offeredEventIds)} | ${JSON.stringify(scenario.acceptedEventIds)} | ${JSON.stringify(scenario.retainedEventIds)} | ${JSON.stringify(scenario.publishedEventIds)} | ${JSON.stringify(scenario.refusedEventIds)} | ${scenario.firstMissingEventId} | ${scenario.committedBoundary.sequence}/${scenario.committedBoundary.eventId} | ${scenario.terminalPublicationCount} | ${scenario.pressureTransitions.join(",") || "none"} |`).join("\n");
  const heapRunRows = report.heapRuns.map((run) => `| ${run.adapter} | ${run.phase} | ${run.sample ?? "warmup"} | ${JSON.stringify(run)} |`).join("\n");
  const checkpointRows = report.checkpointScenarios.map((scenario) => `| ${scenario.adapter} | ${scenario.name} | ${scenario.accepted ? "PASS" : "FAIL"} | ${scenario.retained} | ${scenario.canonicalBytes} | ${scenario.interleavedWhileStaging} | ${scenario.committedBoundaryCorrect} | ${scenario.batchAcceptedAsOneOversizedUnit} | ${JSON.stringify(scenario)} |`).join("\n");
  return `# Event History performance gate\n\nVerdict: **${report.decision.verdict}**\n\nVisible Chrome: ${report.runner.product}; user agent: ${report.runner.userAgent}; JS: ${report.runner.jsVersion}; matrix samples: ${report.cells.length}; reference: ${report.reference.path}.\n\nSource revision: ${report.source.revision}; dirty at run: ${report.source.dirty}; config: ${JSON.stringify(report.config)}; environment: ${JSON.stringify(report.environment)}.\n\nAbsolute gates are fail-closed and are evaluated per independent sample. No failure is averaged away.\n\n## Matrix\n\n| Adapter | Workload | Shape | Sample | Offer→publication p95 (ms) | Offer→visible p95 (ms) | Boundary→visible p95 (ms) | Behind-backlog (ms) | Burst final boundary (ms) | Recent p95 (ms) | Structured/indexed p95 (ms) | Find/full p95 (ms) |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## Correctness, workload, storage, pressure, and exact cell identity evidence\n\n| Cell | Counts and correctness | Workload | Transaction/facet/index amplification | Pressure | Terminal | Exact identity arrays |\n| --- | --- | --- | --- | --- | --- | --- |\n${evidenceRows}\n\n## Long Task phase attribution\n\n| Cell | Exact phase durations, unattributed count, and reasons |\n| --- | --- |\n${longTaskRows}\n\n## Terminal partial-acceptance evidence\n\n| Adapter | Trigger | Reason | Accepted | Refused | Offered IDs | Accepted IDs | Retained IDs | Published IDs | Refused IDs | First missing | Boundary | Terminal publications | Pressure transitions |\n| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | ---: | --- |\n${terminalRows}\n\n## Checkpoint evidence\n\n| Adapter | Name | Accepted | Retained | canonicalBytes | interleavedWhileStaging | committedBoundaryCorrect | batchAcceptedAsOneOversizedUnit | Full scenario evidence |\n| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |\n${checkpointRows}\n\n## Heap cleanup-run evidence\n\n| Adapter | Phase | Sample | Full cleanup evidence |\n| --- | --- | --- | --- |\n${heapRunRows}\n\n## Non-authoritative page storage estimates\n\n| Cell | navigator.storage.estimate() |\n| --- | --- |\n${storageEstimateRows}\n\n## Decision\n\nFailures:\n${report.decision.failures.length ? report.decision.failures.map((failure) => `- ${failure}`).join("\n") : "- None"}\n\nReview reasons:\n${report.decision.reviewReasons.length ? report.decision.reviewReasons.map((reason) => `- ${reason}`).join("\n") : "- None"}\n\nHeap samples: ${JSON.stringify(report.heapSamples)}\n\nLifecycle retained heap deltas: ${JSON.stringify(report.lifecycle.retainedHeapBytes)}; strict monotonic growth: ${report.lifecycle.strictMonotonicGrowth}.\n\nStorage telemetry outside the authoritative verdict: ${JSON.stringify(report.telemetry)}\n`;
}

function timeoutMarkdown(diagnostic) {
  const operation = diagnostic.operation?.lastStatus ?? {};
  const progress = diagnostic.operation?.progress ?? operation.progress ?? null;
  return `# Event History performance gate\n\nVerdict: **FAIL**\n\nStatus: **TIMED_OUT**\n\nSource revision: ${diagnostic.source?.revision ?? "unknown"}; dirty at run: ${diagnostic.source?.dirty ?? "unknown"}.\n\nEnvironment: ${JSON.stringify(diagnostic.environment)}.\n\nGlobal deadline: ${diagnostic.operation?.deadlineMs ?? "unknown"} ms.\n\nOperation phase: **${diagnostic.operation?.phase ?? "unknown"}**\n\nLast operation status: ${JSON.stringify(operation)}\n\n## Latest harness progress\n\n${progress ? `\`${JSON.stringify(progress)}\`` : "No structured harness progress was observed."}\n\nThe timeout is fail-closed and was not classified as a performance PASS or REVIEW.\n`;
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
    const request = new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
    request.cancel = () => {
      this.pending.delete(id);
    };
    return request;
  }
  close() { this.socket.close(); }
}

export async function connect(url, options = {}) {
  const deadlineMs = positiveFiniteStartupOption(options.deadlineMs ?? BROWSER_TIMEOUT_MS, "connect deadlineMs");
  const requestTimeoutMs = positiveFiniteStartupOption(options.requestTimeoutMs ?? Math.min(STARTUP_REQUEST_TIMEOUT_MS, deadlineMs), "connect requestTimeoutMs");
  const createSocket = options.createSocket ?? ((target) => new WebSocket(target));
  const socket = createSocket(url);
  let onOpen;
  let onError;
  try {
    await withStartupTimeout(new Promise((resolvePromise, reject) => {
      onOpen = () => resolvePromise();
      onError = (error) => reject(error);
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    }), Math.min(deadlineMs, requestTimeoutMs), () => socket.close(), "Timed out waiting for CDP WebSocket open.");
    return new Cdp(socket);
  } catch (error) {
    socket.close();
    throw error;
  } finally {
    if (onOpen) socket.removeEventListener?.("open", onOpen);
    if (onError) socket.removeEventListener?.("error", onError);
  }
}

export async function debuggingPort(profile, child, options = {}) {
  const deadlineMs = positiveFiniteStartupOption(options.deadlineMs ?? BROWSER_TIMEOUT_MS, "debuggingPort deadlineMs");
  const requestTimeoutMs = positiveFiniteStartupOption(options.requestTimeoutMs ?? Math.min(STARTUP_REQUEST_TIMEOUT_MS, deadlineMs), "debuggingPort requestTimeoutMs");
  const readProfileFile = options.readProfileFile ?? readFile;
  const sleep = options.sleep ?? delay;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Visible Chrome exited before CDP was ready.");
    try {
      const remaining = deadline - Date.now();
      const contents = await readFileWithStartupTimeout(
        join(profile, "DevToolsActivePort"),
        Math.min(requestTimeoutMs, remaining),
        readProfileFile
      );
      const [port] = contents.trim().split(/\r?\n/u);
      return Number(port);
    } catch {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(100, remaining));
    }
  }
  throw new StartupTimeout("Timed out waiting for visible Chrome CDP.");
}

export async function pageTarget(port, expected, options = {}) {
  const deadlineMs = positiveFiniteStartupOption(options.deadlineMs ?? BROWSER_TIMEOUT_MS, "pageTarget deadlineMs");
  const requestTimeoutMs = positiveFiniteStartupOption(options.requestTimeoutMs ?? Math.min(STARTUP_REQUEST_TIMEOUT_MS, deadlineMs), "pageTarget requestTimeoutMs");
  const fetchJson = options.fetchJson ?? ((target, timeoutMs) => fetchJsonWithStartupTimeout(target, timeoutMs, options.fetchImplementation ?? fetch));
  const sleep = options.sleep ?? delay;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`, Math.min(requestTimeoutMs, deadline - Date.now()));
      const target = targets.find((entry) => entry.type === "page"
        && (options.targetId === undefined || entry.id === options.targetId)
        && typeof entry.webSocketDebuggerUrl === "string");
      if (target) return target.webSocketDebuggerUrl;
    } catch {
      // Retry until the bounded startup deadline; a hung fetch/body is not allowed to escape it.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(100, remaining));
  }
  throw new StartupTimeout("Timed out waiting for visible performance page.");
}

export async function browserTarget(port, options = {}) {
  const deadlineMs = positiveFiniteStartupOption(options.deadlineMs ?? BROWSER_TIMEOUT_MS, "browserTarget deadlineMs");
  const requestTimeoutMs = positiveFiniteStartupOption(options.requestTimeoutMs ?? Math.min(STARTUP_REQUEST_TIMEOUT_MS, deadlineMs), "browserTarget requestTimeoutMs");
  const fetchJson = options.fetchJson ?? ((target, timeoutMs) => fetchJsonWithStartupTimeout(target, timeoutMs, options.fetchImplementation ?? fetch));
  const sleep = options.sleep ?? delay;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, Math.min(requestTimeoutMs, deadline - Date.now()));
      if (typeof version?.webSocketDebuggerUrl === "string" && version.webSocketDebuggerUrl.length > 0) return version.webSocketDebuggerUrl;
    } catch {
      // Retry until the bounded startup deadline; a hung fetch/body is not allowed to escape it.
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(100, remaining));
  }
  throw new StartupTimeout("Timed out waiting for the browser CDP WebSocket.");
}

class StartupTimeout extends Error {
  constructor(message) {
    super(message);
    this.name = "StartupTimeout";
  }
}

function positiveFiniteStartupOption(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  return value;
}

function withStartupTimeout(promise, timeoutMs, onTimeout, message) {
  if (timeoutMs <= 0) return Promise.reject(new StartupTimeout(message));
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout(); } catch { /* Preserve the startup timeout if cleanup itself fails. */ }
        reject(new StartupTimeout(message));
      }, timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function readFileWithStartupTimeout(filePath, timeoutMs, readProfileFile) {
  const controller = new AbortController();
  try {
    return await withStartupTimeout(
      readProfileFile(filePath, { encoding: "utf8", signal: controller.signal }),
      timeoutMs,
      () => controller.abort(),
      `Timed out reading ${filePath}.`
    );
  } finally {
    controller.abort();
  }
}

async function fetchJsonWithStartupTimeout(url, timeoutMs, fetchImplementation) {
  const controller = new AbortController();
  try {
    const response = await withStartupTimeout(
      fetchImplementation(url, { signal: controller.signal }),
      timeoutMs,
      () => controller.abort(),
      `Timed out fetching ${url}.`
    );
    return await withStartupTimeout(
      response.json(),
      timeoutMs,
      () => controller.abort(),
      `Timed out reading ${url} response.`
    );
  } finally {
    controller.abort();
  }
}

async function waitForHarness(cdp, options = {}) {
  const effectiveOptions = Number.isFinite(options.deadlineAt)
    ? options
    : { ...options, deadlineAt: Date.now() + BROWSER_TIMEOUT_MS };
  const deadline = effectiveOptions.deadlineAt;
  while (Date.now() < deadline) {
    if (await evaluateWithDeadline(cdp, "Boolean(window.__LSEW_EVENT_HISTORY_PERFORMANCE__)", deadline, "harness-readiness")) return;
    await delay(100);
  }
  throw createSharedDeadlineTimeout("harness-readiness", deadline, Date.now, effectiveOptions.operation ?? null);
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

async function evaluateResponseWithDeadline(cdp, params, deadlineAt, phase, options = {}) {
  return requestSetupCdp(cdp, "Runtime.evaluate", params, deadlineAt, phase, options);
}

async function evaluateWithDeadline(cdp, expression, deadlineAt, phase, options = {}) {
  const response = await evaluateResponseWithDeadline(cdp, { expression, awaitPromise: true, returnByValue: true }, deadlineAt, phase, options);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
  return response.result.value;
}

function delay(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

async function requestSetupCdp(cdp, method, params, deadlineAt, phase, options = {}) {
  if (!Number.isFinite(deadlineAt)) throw new Error(`${phase} requires a finite deadlineAt.`);
  return requestControlCdpWithDeadline(cdp, method, params, {
    deadlineAt,
    requestCeilingMs: options.requestCeilingMs ?? STARTUP_REQUEST_TIMEOUT_MS,
    phase
  });
}

function startupDeadlineOptions(timeoutOrOptions) {
  if (timeoutOrOptions !== null && typeof timeoutOrOptions === "object") {
    if (!Number.isFinite(timeoutOrOptions.deadlineAt)) throw new Error("Initial performance setup requires a finite deadlineAt.");
    return timeoutOrOptions;
  }
  const timeoutMs = Number.isFinite(timeoutOrOptions) && timeoutOrOptions > 0 ? timeoutOrOptions : 30_000;
  return { deadlineAt: Date.now() + timeoutMs };
}

function remainingDeadlineMs(deadlineAt, fallbackMs, phase) {
  if (deadlineAt === undefined) return fallbackMs;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new PerformanceOperationTimeout(`Event History performance proof deadline expired during ${phase}.`, {
    operationId: null,
    state: "rejected",
    elapsedMs: Math.max(0, -remaining),
    heartbeat: 0,
    progress: null,
    error: { name: "CdpRequestTimeout", code: "SHARED_DEADLINE_EXCEEDED", message: `Event History performance proof deadline expired during ${phase}.`, stack: null }
  });
  return remaining;
}

async function terminateChild(child, deadlineAt = Date.now() + 2_000) {
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
    const remaining = () => Math.max(0, deadlineAt - Date.now());
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      setTimeout(settle, remaining());
    }, Math.min(1_000, remaining()));
    setTimeout(settle, remaining());
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
