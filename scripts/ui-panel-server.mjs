#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-panel-ui-"));
const server = createServer(createStaticHandler(temporaryRoot));
let shuttingDown = false;

try {
  await buildScenarioBundle(temporaryRoot);
  await mkdir(join(temporaryRoot, "icons"), { recursive: true });
  await copyFile(resolve(projectRoot, "public/icons/title-icon.svg"), join(temporaryRoot, "icons/title-icon.svg"));
  await writeFile(join(temporaryRoot, "index.html"), await productionPanelHtml());

  const port = Number(process.env.LSEW_UI_PORT ?? 4173);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  console.log(`Workbench panel scenario server listening on http://127.0.0.1:${port}`);
  await new Promise(() => {});
} finally {
  await shutdown();
}

async function buildScenarioBundle(outputDir) {
  const entryPath = join(outputDir, "entry.tsx");
  await writeFile(entryPath, scenarioHarnessSource());
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    loader: { ".css": "css" },
    outdir: outputDir,
    platform: "browser",
    nodePaths: [resolve(projectRoot, "node_modules")],
    sourcemap: false,
    target: "chrome120"
  });
}

function scenarioHarnessSource() {
  const source = (path) => JSON.stringify(resolve(projectRoot, path));
  return `
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { createInMemoryEventHistory } from ${source("src/core/event-history-authoritative.ts")};
import { createMemoryDiagnosticObservationJournal, createUnavailableDiagnosticObservationJournal } from ${source("src/core/diagnostic-observation.ts")};
import { WorkbenchPanel } from ${source("src/extension/panel/react/workbench-panel.tsx")};
import { createWorkbenchRuntime } from ${source("src/extension/panel/workbench-runtime.ts")};
import { getWorkbenchScenario, isWorkbenchScenarioId } from ${source("tests/support/workbench-scenarios.ts")};

const params = new URLSearchParams(window.location.search);
const scenarioId = params.get("scenario") ?? "live-selected";
if (!isWorkbenchScenarioId(scenarioId)) throw new Error("Unknown Workbench scenario: " + scenarioId);
const theme = params.get("theme") === "auto" ? "auto" : params.get("theme") === "light" ? "light" : "dark";
// Visual evidence may render the same deterministic scenario with the
// advisory estimate omitted as a clean base. This is a test-harness override,
// not a production storage mode.
const storageMode = params.get("storage") ?? "scenario";
const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("Workbench scenario requires #app.");

const scenario = getWorkbenchScenario(scenarioId);
const diagnosticObservations = scenario.diagnosticJournal === "unsupported"
  ? createUnavailableDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostics-" + scenario.id, status: "unsupported" })
  : createMemoryDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostics-" + scenario.id });
let failSyntheticEvidenceRetention = false;
let configuredHistoryCommitFailures = 0;
const history = createInMemoryEventHistory({
  panelSessionId: "scenario-" + scenario.id,
  ...(scenario.historyCapacity ? { capacity: scenario.historyCapacity } : {}),
  ...(scenario.historyOversizedEventId || scenario.failLocalEvidenceRetention
    ? {
        byteEstimator: (event) => {
          if (event.id === scenario.historyOversizedEventId) return 101;
          if (scenario.failLocalEvidenceRetention && failSyntheticEvidenceRetention && event.synthetic) {
            return 257 * 1024 * 1024;
          }
          return 10;
        }
      }
    : {}),
  ...(scenario.historyCommitFailure
    ? {
        commitBatch(batch) {
          if (
            batch.some((event) => event.id === scenario.historyCommitFailure.eventId) &&
            configuredHistoryCommitFailures < scenario.historyCommitFailure.failures
          ) {
            configuredHistoryCommitFailures += 1;
            throw new Error("Deterministic browser journal failure " + configuredHistoryCommitFailures + ".");
          }
        }
      }
    : {}),
  ...(scenario.storage?.mode === "memory"
    ? {
        capacityTier: "LOWER",
        fallback: scenario.storage.reason.includes("newer")
          ? "UNKNOWN_NEWER_SCHEMA"
          : "PRIMARY_JOURNAL_UNAVAILABLE"
      }
    : {}),
});
await Promise.all(scenario.initialEvents.map((event) => history.offer(event).settled));
let localInjectionExecutionCount = 0;
let serverInjectionExecutionCount = 0;
let scenarioClockNow = 0;
const scenarioClock = {
  now: () => scenarioClockNow,
  setTimer(callback, delayMs) {
    return setTimeout(() => {
      scenarioClockNow += Math.max(0, delayMs);
      callback();
    }, Math.max(0, delayMs));
  },
  clearTimer(handle) { clearTimeout(handle); }
};
const localInjectionExecutor = scenario.localInjection?.executorOutcome ? {
  execute(request) {
    localInjectionExecutionCount += 1;
    const outcome = scenario.localInjection.executorOutcome;
    if (outcome === "pending") return new Promise(() => undefined);
    if (outcome === "delayed") return new Promise((resolve) => setTimeout(() => resolve({ requestId: request.executionId, ok: true, status: "success", timestamp: 1_780_872_100_001, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }), 1_200));
    if (outcome === "delivered") return Promise.resolve({ requestId: request.executionId, ok: true, status: "success", timestamp: 1_780_872_100_001, attemptedCount: 1, deliveredCount: 1, failedCount: 0 });
    if (outcome === "partial") return Promise.resolve({ requestId: params.get("terminalLimit") === "1" || scenario.localInjection.terminalLimit ? "r".repeat(20_000) : request.executionId, ok: false, status: "listener-error", timestamp: 1_780_872_100_002, error: "One current listener rejected the local delivery.", attemptedCount: 2, deliveredCount: 1, failedCount: 1 });
    if (outcome === "unknown") return Promise.resolve({ requestId: request.executionId, ok: false, status: "acknowledgement-unknown", timestamp: 1_780_872_100_003, error: "The page acknowledgement channel closed before Workbench could prove delivery." });
    return Promise.resolve({ requestId: request.executionId, ok: false, status: "listener-error", timestamp: 1_780_872_100_004, error: "The protected local listener rejected the update.", attemptedCount: 1, deliveredCount: 0, failedCount: 1 });
  }
} : undefined;
const serverInjectionExecutor = scenario.serverInjection?.executorOutcome ? {
  execute() {
    serverInjectionExecutionCount += 1;
    const requestId = "server-injection-browser-" + serverInjectionExecutionCount;
    const outcome = scenario.serverInjection.executorOutcome;
    if (outcome === "pending") return new Promise(() => undefined);
    if (outcome === "processed") return Promise.resolve({ requestId, ok: true, status: "processed", timestamp: 1_780_872_100_101, response: "fixture accepted" });
    if (outcome === "denied") return Promise.resolve({ requestId, ok: false, status: "denied", timestamp: 1_780_872_100_102, code: 41, error: "The deterministic Metadata Adapter denied the message." });
    if (outcome === "discarded") return Promise.resolve({ requestId, ok: false, status: "discarded", timestamp: 1_780_872_100_103, error: "The message did not reach the Metadata Adapter." });
    if (outcome === "aborted") return Promise.resolve({ requestId, ok: false, status: "aborted", timestamp: 1_780_872_100_104, sentOnNetwork: false, error: "The message was aborted before network transmission." });
    return Promise.resolve({ requestId, ok: false, status: "unknown", timestamp: 1_780_872_100_105, error: "The outcome channel closed after submission. Do not repeat automatically." });
  }
} : undefined;
const runtime = createWorkbenchRuntime({
  history,
  scenarioClock,
  storage: history.storage,
  ...(scenario.storageEstimate && storageMode !== "clean" ? {
    storageEstimate: {
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: scenario.storageEstimate.usageBytes,
      quotaBytes: scenario.storageEstimate.quotaBytes,
      headroomBytes: scenario.storageEstimate.quotaBytes - scenario.storageEstimate.usageBytes,
      failure: null
    }
  } : {}),
  captureStatus: scenario.captureStatus,
  diagnosticObservations,
  capture: scenario.capture,
  ...(scenario.activityProjectionFailure ? {
    activityProjectionFactory: () => { throw new Error(scenario.activityProjectionFailure); }
  } : {}),
  theme,
  ...(localInjectionExecutor ? { localInjectionExecutor } : {}),
  ...(serverInjectionExecutor ? { serverInjectionExecutor } : {})
});
for (const frame of scenario.topologySyncFrames ?? []) {
  runtime.dispatch({ type: "apply-topology-sync-frame", frame });
}
for (const message of scenario.captureMessages ?? []) {
  runtime.dispatch({ type: "ingest-capture-message", message });
}
const reactRoot = createRoot(root);
reactRoot.render(createElement(WorkbenchPanel, { runtime }));

await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (scenario.selectedScope) {
  const scope = runtime.getSnapshot().scope.nodes.find((node) =>
    node.kind === scenario.selectedScope.kind &&
    node.retired === scenario.selectedScope.retired &&
    node.label === scenario.selectedScope.label
  );
  if (!scope) throw new Error("Workbench scenario Scope was not projected: " + scenario.selectedScope.label);
  runtime.dispatch({ type: "set-scope", scopeId: scope.id });
  runtime.dispatch({ type: "set-scope-focus", scopeId: scope.id });
}
if (scenario.selectedEventId) runtime.dispatch({ type: "select-evidence", eventId: scenario.selectedEventId });
if (scenario.filterQuery) {
  const filter = runtime.getSnapshot().evidence.investigation.filter;
  runtime.dispatch({
    type: "apply-filter-mutations",
    expectedRevision: filter.revision,
    operations: [{ type: "set-text", text: scenario.filterQuery }]
  });
}
if (scenario.findQuery) runtime.dispatch({ type: "set-find", value: scenario.findQuery });
if (scenario.freezeBeforeLaterEvents) runtime.dispatch({ type: "freeze-evidence" });
await Promise.all((scenario.laterEvents ?? []).map((event) => history.offer(event).settled));
if (scenario.openRawEvidence && scenario.selectedEventId) runtime.dispatch({ type: "open-raw-evidence", eventId: scenario.selectedEventId });
await new Promise((resolve) => setTimeout(resolve, 48));
failSyntheticEvidenceRetention = Boolean(scenario.failLocalEvidenceRetention);
if (scenario.localInjection) {
  runtime.dispatch({ type: scenario.localInjection.entry === "selection" ? "begin-local-injection-from-selection" : "begin-local-injection-from-scope" });
  if (scenario.localInjection.rawText !== undefined) runtime.dispatch({ type: "set-local-injection-json", text: scenario.localInjection.rawText });
  if (scenario.localInjection.compareOpen) runtime.dispatch({ type: "set-local-injection-compare", open: true });
  if (scenario.localInjection.minimized) runtime.dispatch({ type: "set-local-injection-minimized", minimized: true });
  if (scenario.localInjection.parked) runtime.dispatch({ type: "park-local-injection" });
  if (scenario.localInjection.staleBeforeReview) runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" });
  if (scenario.localInjection.staleAfterReview) runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" });
  if (scenario.localInjection.execute) runtime.dispatch({ type: "execute-local-injection" });
  if (scenario.localInjection.secondEntry) runtime.dispatch({ type: scenario.localInjection.secondEntry === "selection" ? "begin-local-injection-from-selection" : "begin-local-injection-from-scope" });
  if (scenario.localInjection.scenario) {
    runtime.dispatch({ type: "convert-local-injection-to-scenario" });
    if (scenario.localInjection.scenario.addEventId) {
      runtime.dispatch({ type: "open-scenario-evidence-picker" });
      runtime.dispatch({ type: "select-evidence", eventId: scenario.localInjection.scenario.addEventId });
      await new Promise((resolve) => setTimeout(resolve, 48));
      runtime.dispatch({ type: "add-selected-evidence-to-scenario" });
    }
    for (let index = 0; index < (scenario.localInjection.scenario.authoredSteps ?? 0); index += 1) {
      runtime.dispatch({ type: "add-authored-scenario-step" });
    }
    for (const configuredCheckpoint of scenario.localInjection.scenario.checkpoints ?? []) {
      runtime.dispatch({ type: "add-scenario-checkpoint" });
      const checkpoint = runtime.getSnapshot().scenario?.scenario.members.findLast((member) => member.kind === "checkpoint");
      if (!checkpoint) throw new Error("Scenario fixture could not add its configured Checkpoint.");
      runtime.dispatch({ type: "update-scenario-checkpoint", checkpoint: {
        ...checkpoint,
        name: configuredCheckpoint.name,
        assertions: configuredCheckpoint.assertions
      } });
      if (configuredCheckpoint.beforeSteps) {
        const stepCount = runtime.getSnapshot().scenario?.scenario.steps.length ?? 0;
        for (let index = 0; index < stepCount; index += 1) {
          runtime.dispatch({ type: "move-scenario-member", memberId: checkpoint.id, direction: "earlier" });
        }
      }
    }
    if (scenario.localInjection.scenario.delayMs !== undefined) {
      const stepId = runtime.getSnapshot().scenario?.scenario.steps[0]?.id;
      if (stepId) runtime.dispatch({ type: "set-scenario-step-delay", stepId, delayMs: scenario.localInjection.scenario.delayMs });
    }
    if (scenario.localInjection.scenario.speed !== undefined) runtime.dispatch({ type: "set-scenario-speed", speed: scenario.localInjection.scenario.speed });
    if (scenario.localInjection.scenario.review) runtime.dispatch({ type: "review-scenario" });
    for (const observation of scenario.diagnosticObservationsAfterReview ?? []) await diagnosticObservations.observe(observation);
    for (const frame of scenario.localInjection.scenario.driftFrames ?? []) runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    if (scenario.localInjection.scenario.driftFrames) {
      await new Promise((resolve) => setTimeout(resolve, 48));
      runtime.dispatch({ type: "step-next-scenario" });
      await new Promise((resolve) => setTimeout(resolve, 48));
    }
    if (scenario.localInjection.scenario.driftEvent) {
      await history.offer(scenario.localInjection.scenario.driftEvent).settled;
      runtime.dispatch({ type: "step-next-scenario" });
      await new Promise((resolve) => setTimeout(resolve, 48));
    }
    if (scenario.localInjection.scenario.play) runtime.dispatch({ type: "play-scenario" });
    for (let index = 0; index < (scenario.localInjection.scenario.steps ?? 0); index += 1) {
      runtime.dispatch({ type: "step-next-scenario" });
      await new Promise((resolve) => setTimeout(resolve, 48));
    }
    if (scenario.localInjection.scenario.clearAfterRun) {
      runtime.dispatch({ type: "request-clear-history" });
      runtime.dispatch({ type: "confirm-clear-history" });
      await new Promise((resolve) => setTimeout(resolve, 48));
    }
  }
}
if (scenario.serverInjection) {
  runtime.dispatch({ type: "begin-server-injection-from-selection" });
  if (scenario.serverInjection.message !== undefined) {
    runtime.dispatch({ type: "set-server-injection-message", message: scenario.serverInjection.message });
  }
  if (scenario.serverInjection.review) runtime.dispatch({ type: "review-server-injection" });
  if (scenario.serverInjection.execute) runtime.dispatch({ type: "execute-server-injection" });
}
await new Promise((resolve) => setTimeout(resolve, 48));
document.documentElement.dataset.reactScenario = scenarioId;
document.documentElement.dataset.reactSceneReady = "true";
window.__localInjectionExecutionCount = () => localInjectionExecutionCount;
window.__serverInjectionExecutionCount = () => serverInjectionExecutionCount;
window.__setWorkbenchVisible = (visible) => runtime.dispatch({ type: "set-visible", visible });
window.__setWorkbenchCaptureStatus = (status) => runtime.dispatch({ type: "set-capture-status", status });
window.__setWorkbenchStorageMode = (mode) => runtime.dispatch({
  type: "set-storage-state",
  storage: mode === "memory"
    ? { mode: "memory", reason: "IndexedDB is unavailable" }
    : { mode: "indexeddb" }
});
window.__makeWorkbenchFilterStale = () => {
  const revision = runtime.getSnapshot().evidence.investigation.filter.revision;
  runtime.dispatch({
    type: "apply-filter-mutations",
    expectedRevision: revision,
    operations: [{ type: "set-text", text: "external-change" }]
  });
};
window.__getWorkbenchFilterDiscoveryCount = () => runtime.getSnapshot().evidence.investigation.discoveries.size;
let deferredEventsReleased = false;
window.__appendDeferredWorkbenchEvents = () => {
  if (deferredEventsReleased) return 0;
  deferredEventsReleased = true;
  for (const event of scenario.deferredEvents ?? []) history.offer(event);
  return scenario.deferredEvents?.length ?? 0;
};
window.addEventListener("pagehide", () => { reactRoot.unmount(); runtime.dispose(); }, { once: true });
`;
}

async function productionPanelHtml() {
  const shippedHtml = await readFile(resolve(projectRoot, "src/extension/panel/index.html"), "utf8");
  const bootstrap = '<script type="module" src="./bootstrap.ts"></script>';
  if (!shippedHtml.includes(bootstrap)) {
    throw new Error("The shipped panel HTML no longer contains the expected bootstrap module.");
  }
  return shippedHtml
    .replace("</head>", '    <link rel="stylesheet" href="./entry.css">\n  </head>')
    .replace(bootstrap, '<script type="module" src="./entry.js"></script>');
}

function createStaticHandler(root) {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const requested = resolve(root, `.${decodeURIComponent(pathname)}`);
    if ((requested !== root && !requested.startsWith(`${root}/`)) || !existsSync(requested)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(requested) });
    createReadStream(requested).pipe(response);
  };
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

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
