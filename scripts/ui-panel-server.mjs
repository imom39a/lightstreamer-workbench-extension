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
import { createIndexedDbEventHistory } from ${source("src/core/event-history-indexeddb.ts")};
import { createMemoryDiagnosticObservationJournal, createUnavailableDiagnosticObservationJournal } from ${source("src/core/diagnostic-observation.ts")};
import { WorkbenchPanel } from ${source("src/extension/panel/react/workbench-panel.tsx")};
import { createWorkbenchRuntime } from ${source("src/extension/panel/workbench-runtime.ts")};
import { createAgentService } from ${source("src/extension/panel/agent-service.ts")};
import { createAnalyticsClient } from ${source("src/extension/analytics/client.ts")};
import { observeWorkbenchAnalytics } from ${source("src/extension/analytics/observer.ts")};
import { getWorkbenchScenario, isWorkbenchScenarioId, withAgentNativeMode } from ${source("tests/support/workbench-scenarios.ts")};
import { getPanelScenario } from ${source("tests/support/panel-scenarios.ts")};
import { TOPOLOGY_OBSERVATION_VERSION, TOPOLOGY_SYNC_COMPLETE } from ${source("src/bridge/messages.ts")};
import { agentConnectionFixture } from ${source("tests/support/agent-connection-fixture.ts")};

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

const baseScenario = getWorkbenchScenario(scenarioId, { highVolumeFieldCount: params.get("reviewPressure") === "1" ? 200 : 500 });
const scenario = ["MERGE", "DISTINCT"].includes(params.get("nativeMode")) ? withAgentNativeMode(baseScenario, params.get("nativeMode")) : baseScenario;
const diagnosticObservations = scenario.diagnosticJournal === "unsupported"
  ? createUnavailableDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostics-" + scenario.id, status: "unsupported" })
  : createMemoryDiagnosticObservationJournal({ panelSessionId: "scenario-diagnostics-" + scenario.id });
let failSyntheticEvidenceRetention = false;
let configuredHistoryCommitFailures = 0;
const historyOptions = {
  panelSessionId: "scenario-" + scenario.id + (params.get("history") === "indexeddb" ? "-" + crypto.randomUUID() : ""),
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
  ...(scenario.storage?.mode === "memory" || params.get("nativeLimited") === "1"
    ? {
        capacityTier: "LOWER",
        fallback: scenario.storage?.reason.includes("newer")
          ? "UNKNOWN_NEWER_SCHEMA"
          : "PRIMARY_JOURNAL_UNAVAILABLE"
      }
    : {}),
};
// Real durable history is an opt-in browser fixture, independent of the footer
// storage-label override. Default scenes retain their original memory semantics.
const history = params.get("history") === "indexeddb"
  ? await createIndexedDbEventHistory(historyOptions)
  : createInMemoryEventHistory(historyOptions);
await Promise.all(scenario.initialEvents.map((event) => {
  const selectedFidelity = params.get("selected-values") === "fidelity" && event.id === scenario.selectedEventId;
  const candidate = selectedFidelity ? { ...event, logicalEventId: "logical-fidelity-update", listener: { ...event.listener, id: "listener-fidelity" },
    update: { ...event.update, fields: { ...event.update?.fields, exactJson: ' { "identifier":9007199254740993, "amount":1.2300 } ', confirmedNull: null, uncertainNull: null },
      fieldValueStates: { ...event.update?.fieldValueStates, exactJson: "concrete", confirmedNull: "concrete", uncertainNull: "ambiguous-null", missingValue: "unavailable" },
      jsonPatches: { exactJson: { op: "replace", path: "/amount", value: 2 } } } } : event;
  return history.offer(candidate).settled;
}));
let localInjectionExecutionCount = 0;
let serverInjectionExecutionCount = 0;
let scenarioClockNow = 0;
let pendingNativeServerUpdateDelayMs = null;
const offerNativeServerUpdate = async () => {
  const capturedSource = getPanelScenario("topology-small").capturedEvents.find(event => event.kind === "item-update" && !event.synthetic);
  if (!capturedSource) throw new Error("Native absence fixture requires a captured Server Item Update source.");
  const mode = params.get("nativeMode") === "DISTINCT" ? "DISTINCT" : "MERGE";
  const source = withAgentNativeMode({ ...scenario, initialEvents: [capturedSource] }, mode).initialEvents[0];
  if (!source) throw new Error("Native absence fixture could not transform its Server Item Update to the target mode.");
  const completedSync = scenario.topologySyncFrames?.find(frame => frame.type === TOPOLOGY_SYNC_COMPLETE);
  if (!completedSync) throw new Error("Native absence fixture requires a completed target topology sync.");
  const event = { ...source, id: "native-absence-server-update", logicalEventId: "native-absence-server-update",
    timestamp: Date.now(), topology: { version: TOPOLOGY_OBSERVATION_VERSION, kind: "item-update",
      pageEpoch: completedSync.pageEpoch, captureSequence: completedSync.cutoffCaptureSequence + 1,
      provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} },
      client: { id: source.client.id, sessionId: source.client.sessionId },
      subscription: { id: source.subscription.id, mode } } };
  await history.offer(event).settled;
};
const scenarioClock = {
  now: () => scenarioClockNow,
  setTimer(callback, delayMs) {
    if (pendingNativeServerUpdateDelayMs !== null) {
      const updateDelayMs = pendingNativeServerUpdateDelayMs;
      pendingNativeServerUpdateDelayMs = null;
      setTimeout(() => { void offerNativeServerUpdate(); }, updateDelayMs);
    }
    return setTimeout(() => {
      scenarioClockNow += Math.max(0, delayMs);
      callback();
    }, Math.max(0, delayMs));
  },
  clearTimer(handle) { clearTimeout(handle); }
};
const localInjectionExecutor = scenario.localInjection?.executorOutcome || params.has("nativeMode") ? {
  execute(request) {
    localInjectionExecutionCount += 1;
    const outcome = scenario.localInjection?.executorOutcome ?? "delivered";
    if (outcome === "pending") return new Promise(() => undefined);
    if (outcome === "delayed") return new Promise((resolve) => setTimeout(() => resolve({ requestId: request.executionId, ok: true, status: "success", timestamp: 1_780_872_100_001, attemptedCount: 1, deliveredCount: 1, failedCount: 0 }), 1_200));
    if (outcome === "delivered") return Promise.resolve({ requestId: request.executionId, ok: true, status: "success", timestamp: 1_780_872_100_001, attemptedCount: 1, deliveredCount: 1, failedCount: 0 });
    if (outcome === "partial") return Promise.resolve({ requestId: params.get("terminalLimit") === "1" || scenario.localInjection.terminalLimit ? "r".repeat(20_000) : request.executionId, ok: false, status: "listener-error", timestamp: 1_780_872_100_002, error: "One current listener rejected the local delivery.", attemptedCount: 2, deliveredCount: 1, failedCount: 1 });
    if (outcome === "unknown") return Promise.resolve({ requestId: request.executionId, ok: false, status: "acknowledgement-unknown", timestamp: 1_780_872_100_003, error: "The page acknowledgement channel closed before Workbench could prove delivery." });
    return Promise.resolve({ requestId: request.executionId, ok: false, status: "listener-error", timestamp: 1_780_872_100_004, error: "The protected local listener rejected the update.", attemptedCount: 1, deliveredCount: 0, failedCount: 1 });
  }
} : undefined;
const serverInjectionExecutor = scenario.serverInjection?.executorOutcome || params.get("agentServer") === "1" ? {
  execute() {
    serverInjectionExecutionCount += 1;
    const requestId = "server-injection-browser-" + serverInjectionExecutionCount;
    const outcome = scenario.serverInjection?.executorOutcome ?? "processed";
    if (outcome === "pending") return new Promise(() => undefined);
    if (outcome === "processed") return Promise.resolve({ requestId, ok: true, status: "processed", timestamp: 1_780_872_100_101, response: "fixture accepted" });
    if (outcome === "denied") return Promise.resolve({ requestId, ok: false, status: "denied", timestamp: 1_780_872_100_102, code: 41, error: "The deterministic Metadata Adapter denied the message." });
    if (outcome === "discarded") return Promise.resolve({ requestId, ok: false, status: "discarded", timestamp: 1_780_872_100_103, error: "The message did not reach the Metadata Adapter." });
    if (outcome === "aborted") return Promise.resolve({ requestId, ok: false, status: "aborted", timestamp: 1_780_872_100_104, sentOnNetwork: false, error: "The message was aborted before network transmission." });
    return Promise.resolve({ requestId, ok: false, status: "unknown", timestamp: 1_780_872_100_105, error: "The outcome channel closed after submission. Do not repeat automatically." });
  }
} : undefined;
const clientMessageRecipeProvider = scenario.serverInjection?.recipes ? {
  resolve(context) {
    return Promise.resolve({
      status: "available",
      detail: null,
      items: [{
        id: "fixture.update-fields.v1",
        label: "Update fields for beta",
        description: "Starts from the selected COMMAND key and its current version.",
        message: JSON.stringify({
          type: "update-fields",
          item: context.item.name,
          key: context.update?.key,
          expectedVersion: context.update?.fields.version,
          fields: { qty: context.update?.fields.qty }
        }, null, 2),
        sequence: "LSEW_FIXTURE_FIELD_UPDATES",
        delayTimeout: null,
        enqueueWhileDisconnected: false
      }]
    });
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
  capture: params.get("nativeUseful") === "1"
    ? { operation: "RUNNING", coverage: "USEFUL", firstMissingEventId: null, committedEvidenceBoundary: null }
    : scenario.capture,
  ...(scenario.activityProjectionFailure ? {
    activityProjectionFactory: () => { throw new Error(scenario.activityProjectionFailure); }
  } : {}),
  theme,
  ...(localInjectionExecutor ? { localInjectionExecutor } : {}),
  ...(serverInjectionExecutor ? { serverInjectionExecutor } : {}),
  ...(clientMessageRecipeProvider ? { clientMessageRecipeProvider } : {})
});
for (const frame of scenario.topologySyncFrames ?? []) {
  runtime.dispatch({ type: "apply-topology-sync-frame", frame });
}
for (const message of scenario.captureMessages ?? []) {
  runtime.dispatch({ type: "ingest-capture-message", message });
}
const reactRoot = createRoot(root);
const analyticsEvents = [];
const analytics = createAnalyticsClient({
  async send(message) {
    if (message.action === "event") { analyticsEvents.push(message.event); return { ok: true, value: true }; }
    if (params.get("analytics") === "error") return { ok: false };
    if (message.action === "preference") localStorage.setItem("fixture.analytics.enabled", String(message.enabled));
    return { ok: true, value: { enabled: localStorage.getItem("fixture.analytics.enabled") !== "false", configured: params.get("analytics") !== "unconfigured" } };
  },
  onPreferenceChange: () => () => {}
});
const analyticsObserver = observeWorkbenchAnalytics(runtime, analytics, window);
const presentationRuntime = {
  getSnapshot: runtime.getSnapshot.bind(runtime), subscribe: runtime.subscribe.bind(runtime),
  dispatch(command) { analyticsObserver.command(command); runtime.dispatch(command); },
  dispose: runtime.dispose.bind(runtime), disposeAndWait: runtime.disposeAndWait.bind(runtime),
  reportVisibleFrame: runtime.reportVisibleFrame?.bind(runtime),
  reportPanelPerformanceEvent: runtime.reportPanelPerformanceEvent?.bind(runtime)
};
const mismatchDetail = params.get("agent") === "mismatch" ? "Companion extension bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb differs from required aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa. Stop Workbench MCP servers; run setup --extension-id aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa with the matching package. Workbench retries automatically." : undefined;
const agentConnection = agentConnectionFixture(params.get("agent") === "error" || params.get("agent") === "mismatch", mismatchDetail);
reactRoot.render(createElement(WorkbenchPanel, { runtime: presentationRuntime, analytics, agentConnection }));
window.__analyticsEvents = () => analyticsEvents;
window.addEventListener("pagehide", () => { analyticsObserver.dispose(); analytics.dispose(); }, { once: true });

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
async function waitForFixtureSource(eventId) {
  const deadline = performance.now() + 20_000;
  while (runtime.getSnapshot().selectedEvidence?.id !== eventId && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  if (runtime.getSnapshot().selectedEvidence?.id !== eventId) throw new Error("IndexedDB fixture could not resolve its exact retained Source: " + eventId);
}
if (scenario.localInjection) {
  if (params.get("history") === "indexeddb" && scenario.localInjection.entry === "selection" && scenario.selectedEventId) await waitForFixtureSource(scenario.selectedEventId);
  runtime.dispatch({ type: scenario.localInjection.entry === "selection" ? "begin-local-injection-from-selection" : "begin-local-injection-from-scope" });
  if (params.get("history") === "indexeddb") {
    const deadline = performance.now() + 10_000;
    while (runtime.getSnapshot().localInjection.state !== "active" && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    if (runtime.getSnapshot().localInjection.state !== "active") throw new Error("IndexedDB fixture could not load its exact captured Source.");
  }
  if (scenario.localInjection.rawText !== undefined) runtime.dispatch({ type: "set-local-injection-json", text: scenario.localInjection.rawText });
  if (scenario.localInjection.compareOpen) runtime.dispatch({ type: "set-local-injection-compare", open: true });
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
      if (params.get("history") === "indexeddb") await waitForFixtureSource(scenario.localInjection.scenario.addEventId);
      else await new Promise((resolve) => setTimeout(resolve, 48));
      const previousCount = runtime.getSnapshot().scenario?.scenario.steps.length ?? 0;
      runtime.dispatch({ type: "add-selected-evidence-to-scenario" });
      if (params.get("history") === "indexeddb") {
        const deadline = performance.now() + 20_000;
        while ((runtime.getSnapshot().scenario?.scenario.steps.length ?? 0) === previousCount && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        if ((runtime.getSnapshot().scenario?.scenario.steps.length ?? 0) !== previousCount + 1) throw new Error("IndexedDB fixture did not accept its configured captured Scenario member.");
      }
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
let fixtureAgentPermission = "local";
const fixtureAgentService = createAgentService(runtime.agent, "fixture-agent-panel", () => fixtureAgentPermission);
let fixtureAgentServerToken = null;
if (scenario.serverInjection && params.get("agentServer") === "1") {
  const source = [...scenario.initialEvents].reverse().find(event => event.clientMessage?.pageEpoch && event.client?.sessionId);
  if (!source) throw new Error("Agent Server fixture requires an exact Client Message source.");
  const prepared = await fixtureAgentService.call("prepare_server_injection", { panelSessionId: "fixture-agent-panel", requestId: "browser-server-request",
    pageEpoch: source.clientMessage.pageEpoch, clientId: source.client.id, sessionId: source.client.sessionId,
    message: scenario.serverInjection.message, sequence: "orders", delayTimeout: null, enqueueWhileDisconnected: false });
  fixtureAgentServerToken = prepared.token;
  if (scenario.serverInjection.review) runtime.dispatch({ type: "review-server-injection" });
} else if (scenario.serverInjection) {
  runtime.dispatch({
    type: scenario.serverInjection.entry === "author"
      ? "begin-server-injection-from-selected-client"
      : "begin-server-injection-from-selection"
  });
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
window.__agentServerCall = (name, args = {}) => fixtureAgentService.call(name, { panelSessionId: "fixture-agent-panel", requestId: "browser-server-request", ...(name === "execute_server_injection" ? { token: fixtureAgentServerToken } : {}), ...args });
window.__revokeAgentServerFixture = () => { fixtureAgentPermission = "off"; fixtureAgentService.revoke(); };
window.__setWorkbenchVisible = (visible) => { runtime.dispatch({ type: "set-visible", visible }); analyticsObserver.setVisible(visible); };
// Harness-only seam: exercises real native authoring, immutable Review, and
// limited-history inconclusive evaluation without changing production state.
window.__prepareAgentNativeAssertions = async (durationMs = 100) => {
  const scope = runtime.getSnapshot().scope.nodes.find(node => node.kind === "item" && !node.retired);
  if (!scope) throw new Error("Native fixture Item unavailable");
  await runtime.agent.validateCandidate({kind:"draft", draft:{scopeId:scope.id}}, "topology-small-page", () => true);
  runtime.dispatch({type:"set-scope", scopeId:scope.id});
  runtime.dispatch({type:"begin-local-injection-from-scope"});
  const document = runtime.getSnapshot().localInjection.draft.document;
  runtime.agent.abortDocument();
  const originalUuid = crypto.randomUUID;
  crypto.randomUUID = () => "00000000-0000-4000-8000-000000000016";
  try {
  await runtime.agent.prepareScenarioPlan({members:[{kind:"step",id:"native-step",scopeId:scope.id,document:JSON.stringify(document)}, {kind:"checkpoint",id:"native-checkpoint",name:"Exact committed field and observed absence",assertions:[{id:"native-field",kind:"local-evidence-field-equals",stepId:"native-step",field:"value",expected:null},{id:"native-absence",kind:"server-item-update-absent",item:{name:"topology-small-item",position:1},duringActiveMs:durationMs}]}]}, "topology-small-page", () => true);
  } finally { crypto.randomUUID = originalUuid; }
};
window.__scheduleNativeServerItemUpdate = (delayMs = 20) => {
  pendingNativeServerUpdateDelayMs = delayMs;
  return true;
};
window.__stepAgentNativeAssertions = () => runtime.dispatch({type:"step-next-scenario"});
window.__reviewWorkbenchScenario = () => runtime.dispatch({ type: "review-scenario" });
window.__getWorkbenchScenarioSnapshot = () => runtime.getSnapshot().scenario;
window.__clearWorkbenchScenarioHistory = () => history.clear();
window.__closeWorkbenchScenarioHistory = () => history.close();
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
