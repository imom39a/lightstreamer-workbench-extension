import type { WorkbenchCommand, WorkbenchRuntime, WorkbenchSnapshot } from "../panel/workbench-runtime";
import type { AnalyticsClient } from "./client";
import { createEngagementClock } from "./engagement";
import type { AnalyticsEvent, AnalyticsScreen } from "./events";

type Feature = Extract<AnalyticsEvent, { name: "feature_used" }>["params"];
const features: Partial<Record<WorkbenchCommand["type"], Feature>> = {
  "set-scope": { feature: "scope", action: "select" },
  "select-evidence": { feature: "evidence", action: "select" },
  "focus-evidence": { feature: "evidence", action: "select" },
  "select-activity-evidence": { feature: "activity", action: "select" },
  "apply-filter-mutations": { feature: "filter", action: "apply" },
  "mutate-filter": { feature: "filter", action: "apply" },
  "apply-filter-builder": { feature: "filter", action: "apply" },
  "apply-filter-action": { feature: "filter", action: "apply" },
  "apply-contextual-filter-action": { feature: "filter", action: "apply" },
  "reset-filter": { feature: "filter", action: "reset" },
  "find-next": { feature: "find", action: "next" },
  "find-previous": { feature: "find", action: "previous" },
  "show-older-evidence": { feature: "evidence", action: "older" },
  "show-newer-evidence": { feature: "evidence", action: "newer" },
  "show-oldest-evidence": { feature: "evidence", action: "oldest" },
  "show-newest-evidence": { feature: "evidence", action: "newest" },
  "freeze-evidence": { feature: "evidence", action: "freeze" },
  "follow-live": { feature: "evidence", action: "follow" },
  "back-investigation": { feature: "evidence", action: "back" },
  "forward-investigation": { feature: "evidence", action: "forward" },
  "open-context": { feature: "context", action: "open" },
  "open-raw-evidence": { feature: "raw_evidence", action: "open" },
  "export-scope": { feature: "export", action: "prepare" },
  "prepare-scoped-evidence-copy": { feature: "clipboard", action: "prepare" },
  "cancel-evidence-operation": { feature: "export", action: "cancel" },
  "confirm-clear-history": { feature: "history", action: "clear" },
  "set-local-injection-compare": { feature: "local_injection", action: "compare" },
  "park-local-injection": { feature: "local_injection", action: "park" },
  "resume-local-injection": { feature: "local_injection", action: "resume" },
  "confirm-discard-local-injection": { feature: "local_injection", action: "discard" },
  "confirm-discard-server-injection": { feature: "server_injection", action: "discard" },
  "prepare-server-injection-repeat": { feature: "server_injection", action: "repeat" },
  "apply-server-injection-recipe": { feature: "server_injection", action: "recipe" },
  "open-notifications": { feature: "notifications", action: "open" },
  "inspect-diagnostic-evidence": { feature: "notifications", action: "inspect" },
  "inspect-diagnostic-affected": { feature: "notifications", action: "inspect" },
  "dismiss-diagnostic": { feature: "notifications", action: "dismiss" },
  "select-activity": { feature: "activity", action: "select" },
  "apply-activity-ranking-filter": { feature: "activity", action: "apply" }
};
const scenarioActions: Partial<Record<WorkbenchCommand["type"], Extract<AnalyticsEvent, { name: "scenario_action" }>["params"]["action"]>> = {
  "convert-local-injection-to-scenario": "create", "review-scenario": "review", "re-review-scenario": "review",
  "play-scenario": "play", "pause-scenario": "pause", "stop-scenario": "stop", "step-next-scenario": "step",
  "run-scenario-again": "run_again", "add-selected-evidence-to-scenario": "add_step", "add-authored-scenario-step": "add_step", "add-scenario-checkpoint": "checkpoint"
};

/** Observe semantic command boundaries and published outcomes; never scan captured records. */
export function observeWorkbenchAnalytics(runtime: WorkbenchRuntime, client: AnalyticsClient, window: Window) {
  const clock = createEngagementClock();
  const throttled = new Map<string, number>();
  const reportedProblems = new Set<string>();
  let previous = runtime.getSnapshot();
  let enabled = false;
  let opened = false;
  let captured = false;
  let screen: AnalyticsScreen | null = null;
  let filterPending = false;
  let findPending = false;
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  let noActivityTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let panelVisible = previous.visible;
  clock.setVisible(panelVisible);
  clock.setFocused(window.document.hasFocus());

  function emit(event: AnalyticsEvent) {
    if (!enabled || disposed) return;
    client.track({ ...event, engagement_time_msec: clock.take() });
  }
  function problem(value: Extract<AnalyticsEvent, { name: "extension_problem" }>["params"]["problem"]) {
    if (reportedProblems.has(value)) return;
    reportedProblems.add(value);
    emit({ name: "extension_problem", params: { problem: value } });
  }
  function updatePreference() {
    const state = client.getSnapshot();
    const nextEnabled = state.enabled && state.configured && state.ready && !state.saving && !state.error;
    if (enabled === nextEnabled) return;
    enabled = nextEnabled;
    clock.reset();
    previous = runtime.getSnapshot();
    clock.setVisible(panelVisible);
    clock.setFocused(window.document.hasFocus());
    if (!enabled) {
      clearTimeout(findTimer);
      clearTimeout(noActivityTimer);
      filterPending = false;
      findPending = false;
      screen = null;
      return;
    }
    reportedProblems.clear();
    if (!opened) { opened = true; emit({ name: "panel_opened", params: {} }); }
    update();
    noActivityTimer = setTimeout(() => {
      if (!captured && panelVisible) problem("no_activity");
    }, 30_000);
  }

  function update() {
    if (!enabled || disposed) return;
    const next = runtime.getSnapshot();
    setVisible(next.visible);
    const nextScreen = screenFor(next);
    if (next.visible && screen !== nextScreen) {
      screen = nextScreen;
      emit({ name: "page_view", params: { screen: nextScreen } });
    }
    if (!captured && next.retention.historyStatus.captured > 0) {
      captured = true;
      clearTimeout(noActivityTimer);
      emit({ name: "capture_ready", params: { coverage: next.capture.coverage, storage_mode: next.storage.mode } });
    }
    if (next.captureStatus === "bridge disconnected") problem("bridge_disconnected");
    if (next.capture.coverage === "LIMITED") problem("coverage_limited");
    if (next.capture.coverage === "UNAVAILABLE") problem("coverage_unavailable");
    if (next.storage.mode === "memory") problem("storage_fallback");
    if (next.evidence.investigation.queryState === "error") problem("query_failed");
    if (next.retention.clearState === "error") problem("history_failed");
    for (const [format, state, oldState] of [
      ["clipboard", next.evidenceCopy.state, previous.evidenceCopy.state],
      ["scope", next.export.operation?.state, previous.export.operation?.state]
    ] as const) {
      if (state !== oldState && (state === "error" || state === "cancelled" || state === "refused")) {
        emit({ name: "export_result", params: { format, outcome: state === "error" ? "failed" : state } });
      }
    }

    const local = next.localInjection.draft;
    const oldLocal = previous.localInjection.draft;
    if (local && local.id !== oldLocal?.id) emit({ name: "injection_started", params: { injection_type: "local", source_kind: local.source.kind === "authored" ? "authored" : "captured" } });
    if (local?.outcome && (local.outcome.executionId !== oldLocal?.outcome?.executionId || local.outcome.disposition !== oldLocal?.outcome?.disposition)) emit({ name: "injection_result", params: { injection_type: "local", outcome: local.outcome.disposition } });
    const server = next.serverInjection?.draft;
    const oldServer = previous.serverInjection?.draft;
    if (server && server.id !== oldServer?.id) emit({ name: "injection_started", params: { injection_type: "server", source_kind: server.source.kind === "authored" ? "authored" : "captured" } });
    if (server?.outcome && (server.outcome.requestId !== oldServer?.outcome?.requestId || server.outcome.status !== oldServer?.outcome?.status)) emit({ name: "injection_result", params: { injection_type: "server", outcome: server.outcome.status } });
    const scenario = next.scenario;
    if (scenario?.run && (scenario.phase === "complete" || scenario.phase === "stopped") && (scenario.phase !== previous.scenario?.phase || scenario.run.id !== previous.scenario?.run?.id)) {
      emit({ name: "scenario_result", params: { outcome: scenario.phase } });
    }
    if (filterPending && next.evidence.investigation.queryState !== "loading") {
      filterPending = false;
      const mutation = next.evidence.filterMutation.state;
      const outcome = mutation === "invalid" || mutation === "stale" ? mutation : next.evidence.investigation.queryState === "error" ? "failed" : next.evidence.investigation.counts.matching === 0 ? "empty" : "applied";
      emit({ name: "filter_result", params: { outcome } });
    }
    reportFindResult(next);
    previous = next;
  }

  function reportFindResult(snapshot: WorkbenchSnapshot) {
    if (!findPending) return;
    const state = snapshot.evidence.investigation.queryState;
    if (state !== "ready" && state !== "error") return;
    findPending = false;
    if (state === "error") return; // The query_failed problem owns this outcome.
    const matches = snapshot.evidence.findState.matchCount;
    emit({ name: "find_result", params: { result: matches === 0 ? "none" : matches === 1 ? "one" : "many" } });
  }

  function command(command: WorkbenchCommand) {
    if (!enabled) return;
    const feature = features[command.type];
    if (feature) {
      const key = `${feature.feature}:${feature.action}`;
      const time = Date.now();
      if (time - (throttled.get(key) ?? -Infinity) >= 1000) {
        throttled.set(key, time);
        emit({ name: "feature_used", params: feature });
      }
      if (feature.feature === "filter" && feature.action === "apply") filterPending = true;
    }
    const scenarioAction = scenarioActions[command.type];
    if (scenarioAction) emit({ name: "scenario_action", params: { action: scenarioAction } });
    if (command.type === "execute-local-injection" || command.type === "execute-server-injection") emit({ name: "injection_attempted", params: { injection_type: command.type === "execute-local-injection" ? "local" : "server" } });
    if (command.type === "set-theme") emit({ name: "feature_used", params: { feature: "theme", action: command.theme } });
    if (command.type === "set-find" || command.type === "clear-find") {
      clearTimeout(findTimer);
      findPending = false;
      if (command.type === "set-find" && command.value.trim()) findTimer = setTimeout(() => {
        emit({ name: "feature_used", params: { feature: "find", action: "apply" } });
        findPending = true;
        reportFindResult(runtime.getSnapshot());
      }, 800);
    }
  }

  const interact = () => clock.interact();
  const focus = () => clock.setFocused(true);
  const blur = () => { emit({ name: "panel_engagement", params: {} }); clock.setFocused(false); };
  const error = () => problem("panel_error");
  const rejection = () => problem("unhandled_rejection");
  window.addEventListener("pointerdown", interact, { passive: true });
  window.addEventListener("keydown", interact, { passive: true });
  window.addEventListener("wheel", interact, { passive: true });
  window.addEventListener("focus", focus);
  window.addEventListener("blur", blur);
  window.addEventListener("error", error);
  window.addEventListener("unhandledrejection", rejection);
  const unsubscribeRuntime = runtime.subscribe(update);
  const unsubscribePreference = client.subscribe(updatePreference);
  const heartbeat = setInterval(() => {
    if (!enabled || !panelVisible) return;
    const time = clock.take();
    if (time > 0) client.track({ name: "panel_engagement", params: {}, engagement_time_msec: time });
  }, 30_000);
  updatePreference();
  function setVisible(visible: boolean) {
    if (panelVisible === visible) return;
    if (!visible) emit({ name: "panel_engagement", params: {} });
    panelVisible = visible;
    clock.setVisible(visible);
  }
  return {
    command,
    setVisible,
    dispose() {
      if (disposed) return;
      emit({ name: "panel_closed", params: {} });
      disposed = true;
      unsubscribeRuntime();
      unsubscribePreference();
      clearInterval(heartbeat);
      clearTimeout(findTimer);
      clearTimeout(noActivityTimer);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
      window.removeEventListener("wheel", interact);
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    }
  };
}

function screenFor(snapshot: WorkbenchSnapshot): AnalyticsScreen {
  if (snapshot.scenario) return "scenario";
  if (snapshot.localInjection.draft?.open && !snapshot.localInjection.draft.parked && !snapshot.localInjection.draft.minimized) return "local_injection";
  if (snapshot.serverInjection?.state === "active") return "server_injection";
  if (snapshot.contextId === "notifications") return "notifications";
  if (snapshot.contextId === "context:actions") return "session_operations";
  if (snapshot.contextId === "context:export") return "export";
  if (snapshot.contextId?.startsWith("raw:")) return "raw_evidence";
  return "evidence";
}
