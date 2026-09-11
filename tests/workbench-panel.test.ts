import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createFilter } from "../src/core/filter-algebra";
import {
  type WorkbenchCommand,
  type WorkbenchRuntime,
  type WorkbenchSnapshot
} from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRuntime = WorkbenchRuntime & {
  setSnapshot(snapshot: WorkbenchSnapshot): void;
  commands: WorkbenchCommand[];
};

const emptyDiagnosticOptions = () => ({
  diagnosticCode: [],
  diagnosticSeverity: [],
  diagnosticAffected: []
});

function createTestRuntime(snapshot: WorkbenchSnapshot): TestRuntime {
  const listeners = new Set<() => void>();
  const commands: WorkbenchCommand[] = [];
  let current = withScopeContract(snapshot);

  return {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command) {
      commands.push(command);
    },
    dispose: vi.fn(),
    disposeAndWait: vi.fn(),
    setSnapshot(next) {
      current = withScopeContract(next);
      listeners.forEach((listener) => listener());
    },
    commands
  };
}

function withScopeContract(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  const scopeCandidate = snapshot.scope as Partial<WorkbenchSnapshot["scope"]>;
  if (
    scopeCandidate.structure &&
    typeof scopeCandidate.resolveNode === "function" &&
    scopeCandidate.structure.length === snapshot.scope.nodes.length
  ) {
    return snapshot;
  }
  const nodes = snapshot.scope.nodes ?? [];
  return {
    ...snapshot,
    scope: {
      ...snapshot.scope,
      structureRevision: 0,
      structure: nodes.map(({ id, kind, label, parentId, depth }) => ({
        id,
        kind,
        label,
        parentId,
        depth
      })),
      resolveNode: (scopeId) => nodes.find(({ id }) => id === scopeId) ?? null
    }
  };
}

function snapshot(overrides: Record<string, unknown> = {}): WorkbenchSnapshot {
  return {
    version: 0,
    renderedEvidenceBoundary: null,
    visible: true,
    captureStatus: "capturing",
    capture: {
      operation: "RUNNING",
      coverage: "USEFUL",
      firstMissingEventId: null,
      committedEvidenceBoundary: null
    },
    theme: "dark",
    evidence: {
      loading: false,
      total: 2,
      windowSize: 60,
      mode: "live",
      newerCount: 0,
      offset: 0,
      visibleStart: 1,
      visibleEnd: 2,
      hasOlder: false,
      hasNewer: false,
      find: "",
      findState: { query: "", matchCount: 0, currentIndex: -1, currentEventId: null },
      filterMutation: { state: "idle", revision: 1, changed: false, message: null, removedCriteria: 0 },
      restoration: { canBack: false, canForward: false, barrier: 0, current: -1 },
      filterRecoveryFocused: false,
      focusedEventId: "evt-2",
      selectedEventId: "evt-2",
      hiddenSelection: null,
      investigation: {
        scope: { kind: "PAGE" },
        filter: createFilter(1),
        readPoint: null,
        historyInterval: null,
        representedEvidenceBoundary: null,
        retainedRange: null,
        page: { evidence: [], nextCursor: null },
        counts: { shown: 2, matching: 2, inScope: 2 },
        discoveries: new Map(),
        lookup: null,
        find: null,
        evaluation: null,
        coverage: null,
        storage: null,
        queryState: "ready",
        problem: null
      },
      events: [
        {
          id: "evt-1",
          sequence: 14_788,
          time: "14:08:39.112",
          source: "SERVER",
          phase: "SNAPSHOT",
          command: "ADD",
          commandKey: "order-1042",
          kind: "Item Update",
          object: "order-1042",
          summary: "qty, status",
          raw: { id: "raw-evt-1", timestamp: 1, direction: "inbound", source: "server", synthetic: false, kind: "item-update", item: { name: "order-1042" }, update: { key: "order-1042", fields: { qty: 4, status: "GREEN" } } }
        },
        {
          id: "evt-2",
          sequence: 14_789,
          time: "14:08:41.238",
          source: "SERVER",
          phase: "LIVE",
          command: "UPDATE",
          commandKey: "order-1042",
          kind: "Item Update",
          object: "order-1042",
          summary: "qty, status",
          raw: { id: "raw-evt-2", timestamp: 2, direction: "inbound", source: "server", synthetic: false, kind: "item-update", item: { name: "order-1042" }, update: { key: "order-1042", fields: { qty: 5, status: "GREEN" } } }
        }
      ]
    },
    scope: {
      label: "Page / client-main / Session S-9 / orders.command / portfolio",
      status: "Subscribed · Snapshot complete",
      structureRevision: 0,
      structure: [],
      resolveNode: () => null,
      nodes: [],
      focusedNodeId: "page",
      selection: {
        id: "page",
        kind: "page",
        retired: false
      },
      coverage: {
        semantic: true,
        status: "USEFUL",
        detail: "Structural Scope is based on current captured topology."
      }
    },
    scopeId: "page",
    selectionEventId: "evt-2",
    contextId: null,
    context: {
      kind: "evidence",
      title: "evt-2 · Item Update",
      fields: [
        ["Source", "SERVER"],
        ["Phase", "LIVE"],
        ["COMMAND operation", "UPDATE"]
      ],
      selectedUpdate: {
        fields: [],
        changedFields: [],
        jsonPatches: []
      }
    },
    notifications: { entries: [], total: 0, limit: 100, filter: { criteria: {}, active: false, options: emptyDiagnosticOptions() } },
    diagnostics: [],
    historyCondition: null,
    historyAnnouncement: "",
    storage: { mode: "indexeddb" },
    retention: {
      historyStatus: {
        phase: "RUNNING",
        captureOperation: "RUNNING",
        interval: { id: "panel-test:interval-1", ordinal: 1 },
        committedEvidenceBoundary: null,
        retainedRange: null,
        capacity: { tier: "NORMAL", state: "AVAILABLE" },
        fallback: null,
        captured: 2,
        awaitingAcceptance: 0,
        accepted: 2,
        notAccepted: 0,
        retained: 2
      },
      clearState: "idle"
    },
    export: {
      activeScopeId: "page",
      redactions: [],
      sensitiveCounts: {
        "server-addresses": 0,
        "client-ips": 0,
        "item-names": 0,
        "command-keys": 0,
        "field-names": 0,
        identifiers: 0
      },
      completeEvidence: false,
      document: null,
      json: null,
      filename: null
    },
    evidenceCopy: { state: "idle", eventCount: 0, text: null },
    localInjection: {
      state: "idle",
      entryError: null,
      blockedEntry: null,
      discardConfirmation: false,
      availability: {
        selectedUpdate: { available: true, reason: null },
        commandScope: { available: false, reason: "Choose a live COMMAND Item or Listener Scope." }
      },
      draft: null
    },
    ...overrides
  };
}

function activeLocalInjection(
  draftOverrides: Partial<NonNullable<WorkbenchSnapshot["localInjection"]["draft"]>> = {}
): WorkbenchSnapshot["localInjection"] {
  const rawText = JSON.stringify({
    command: "UPDATE",
    key: "order-1042",
    isSnapshot: false,
    fields: { command: "UPDATE", key: "order-1042", qty: 18, status: "open" }
  }, null, 2);
  return {
    state: "active",
    entryError: null,
    blockedEntry: null,
    discardConfirmation: false,
    availability: {
      selectedUpdate: { available: true, reason: null },
      commandScope: { available: false, reason: "A Local Injection Draft already exists." }
    },
    draft: {
      id: "local-injection-draft-1",
      phase: "edit",
      rawText,
      document: {
        command: "UPDATE",
        key: "order-1042",
        isSnapshot: false,
        fields: { command: "UPDATE", key: "order-1042", qty: 18, status: "open" }
      },
      diagnostics: [],
      ready: true,
      anchor: {
        sourceKind: "captured-event",
        sourceEventId: "evt-2",
        pageEpoch: "page-1",
        clientId: "client-main",
        sessionId: "S-9",
        subscriptionId: "sub-7",
        subscriptionMode: "COMMAND",
        itemName: "portfolio",
        itemPosition: 1,
        listenerId: "listener-1",
        captureSource: "listener",
        executionTarget: "captured-listener",
        fieldSchema: ["command", "key", "qty", "status"]
      },
      source: { kind: "captured-event", rawText },
      compareStatus: "unchanged",
      compareOpen: true,
      editorPresentation: { cursor: 0, selectionFrom: 0, selectionTo: 0, scrollTop: 0, scrollLeft: 0, compareOpen: true, serializedState: null },
      minimized: false,
      parked: false,
      open: true,
      restorationOrigin: {
        scopeId: "page",
        selectionEventId: "evt-2",
        focusedEventId: "evt-2",
        contextId: null
      },
      executionId: null,
      preflightFingerprint: null,
      outcome: null,
      ...draftOverrides
    }
  };
}

function reviewedScenario(runnerPhase: "paused" | "waiting" | "in-flight" = "paused"): NonNullable<WorkbenchSnapshot["scenario"]> {
  const local = activeLocalInjection().draft!;
  const target = {
    pageEpoch: local.anchor.pageEpoch,
    clientId: local.anchor.clientId,
    sessionId: local.anchor.sessionId,
    subscriptionId: local.anchor.subscriptionId,
    deliveryPath: "listener" as const,
    listenerId: local.anchor.listenerId,
    mode: local.anchor.subscriptionMode,
    schemaFields: local.anchor.fieldSchema
  };
  const step = {
    kind: "step" as const,
    id: "step-1",
    draft: {
      id: local.id,
      sourceEventId: local.anchor.sourceEventId,
      sourceRawText: local.source.rawText,
      rawText: local.rawText,
      document: local.document,
      ready: local.ready,
      diagnostics: local.diagnostics,
      target,
      item: { name: local.anchor.itemName, position: local.anchor.itemPosition },
      editor: local.editorPresentation,
      restorationOrigin: local.restorationOrigin,
      relativeDelayMs: 100
    }
  };
  const scenario = {
    id: "scenario-1", revision: 2, phase: "edit" as const, target, steps: [step], members: [step], restorationOrigin: local.restorationOrigin,
    nextStepSequence: 2, removedSteps: [], accountedBytes: 2048, speed: 2 as const
  };
  const reviewedStep = { kind: "step" as const, id: "step-1", ordinal: 1, sourceEventId: local.anchor.sourceEventId, rawText: local.rawText, document: local.document!, relativeDelayMs: 100 };
  const run = {
    id: "run-1", scenarioId: scenario.id, scenarioRevision: scenario.revision, target, targetFingerprint: "fp-1", committedEvidenceSeed: null,
    steps: [reviewedStep], members: [reviewedStep], status: "paused" as const, nextOrdinal: 1, nextMemberIndex: 0, trace: [], accountedBytes: 4096, traceReservationBytes: 1024, controlReservationBytes: 1024, speed: 2 as const, controls: [], authorizations: [], drifts: []
  };
  return {
    phase: runnerPhase === "paused" ? "review" : "running",
    scenario,
    run,
    membershipError: null,
    pickerOpen: false,
    membership: [],
    membershipPreview: null,
    focusedMemberId: "step-1",
    focusedStepId: "step-1",
    canUndoRemoval: false,
    priorRuns: [],
    retainedRunBytes: 0,
    runner: {
      phase: runnerPhase,
      run,
      cursor: { members: [reviewedStep], index: 0 },
      nextOrdinal: 1,
      activeOffsetMs: runnerPhase === "paused" ? 0 : 25,
      remainingDelayMs: runnerPhase === "paused" ? 50 : 25,
      pauseReason: runnerPhase === "paused" ? "USER" : null,
      controlCapacityReached: false,
      visible: true,
      activeCheckpoint: null
    }
  };
}

describe("React Workbench Diagnose panel", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("renders independent operating status fields without weakening the History meter", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime(snapshot({
      retention: {
        ...base.retention,
        historyStatus: {
          ...base.retention.historyStatus,
          captured: 10_000,
          accepted: 10_000,
          retained: 10_000
        }
      }
    }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const operating = rootElement.querySelector<HTMLElement>(".workbench-react__operating");
    expect(operating?.querySelector(".workbench-react__operating-capture")?.textContent).toBe("Capture RUNNING");
    expect(operating?.querySelector(".workbench-react__operating-coverage")?.textContent).toBe("Coverage USEFUL");
    const historyStatus = rootElement.querySelector<HTMLElement>("[data-history-status]");
    expect(historyStatus?.textContent).toBe(
      "10,000/10,000 Evidence · IndexedDB"
    );
    expect(historyStatus?.getAttribute("aria-label")).toBe(
      "10,000 retained Evidence of 10,000 accepted"
    );
    expect(operating?.querySelector(".workbench-react__operating-view")?.textContent).toBe("View FOLLOW LIVE");

    await act(async () => root.unmount());
  });

  it("does not offer unrelated Local Evidence from Selected Evidence", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        events: base.evidence.events.map((event, index) =>
          index === 0 ? { ...event, source: "LOCAL" as const } : event
        )
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.querySelector('[aria-label="COMMAND projection summary"]')).toBeNull();
    expect(
      Array.from(rootElement.querySelectorAll("button")).some(
        (button) => button.textContent === "Reveal supporting Evidence"
      )
    ).toBe(false);

    await act(async () => root.unmount());
  });

  it("keeps captured Evidence ordered, selected, and distinct from keyboard focus", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        events: base.evidence.events.map((event) => event.id === "evt-2"
          ? { ...event, raw: { kind: "item-update", item: { name: "order-1042" }, update: { key: "order-1042", fields: { qty: 5, status: "GREEN" } } } as unknown as LightstreamerEventEnvelope }
          : event)
      }
    });
    const root = createRoot(document.querySelector("#app")!);

    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const evidence = Array.from(document.querySelectorAll<HTMLElement>("[data-evidence-id]"));
    expect(evidence.map((row) => row.dataset.evidenceId)).toEqual(["evt-1", "evt-2"]);
    expect(document.querySelector('[data-evidence-id="evt-2"]')?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector('[data-evidence-id="evt-2"]')?.getAttribute("tabindex")).toBe("-1");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("tabindex")).toBe("-1");
    expect(rootElement.textContent).toContain("SERVER");
    expect(rootElement.textContent).toContain("View FOLLOW LIVE");
    expect(rootElement.querySelector('[aria-label="COMMAND projection summary"]')).toBeNull();
    expect(rootElement.textContent).not.toContain("COMMAND projections");

    await act(async () => root.unmount());
  });

  it("moves focus and selection together with Evidence arrow navigation without opening Context", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const selected = document.querySelector<HTMLElement>('[data-evidence-id="evt-2"]');
    selected?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: "evt-1" });
    expect(runtime.commands).not.toContainEqual({ type: "open-context" });
    await act(async () => root.unmount());
  });

  it("restores the exact Evidence row after compact Context closes", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const row = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]');
    const openContext = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Focus selected Context"
    );
    row?.focus();
    openContext?.click();

    await act(async () => runtime.setSnapshot(snapshot({ contextId: "context:evt-2" })));
    const back = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Back to Evidence"
    );
    back?.focus();
    back?.click();
    await act(async () => runtime.setSnapshot(snapshot({ contextId: null })));

    expect(document.activeElement).toBe(row);
    expect(runtime.commands).toContainEqual({ type: "open-context" });
    expect(runtime.commands).toContainEqual({ type: "set-context", contextId: null });
    await act(async () => root.unmount());
  });

  it("renders and dispatches dismissal for a degraded Capture diagnostic in the global footer", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(
      snapshot({
        capture: {
          operation: "RUNNING",
          coverage: "LIMITED",
          detail: "Capture attached after this Subscription began. Earlier Snapshot evidence may be incomplete.",
          recovery: "Reload the inspected page with DevTools open"
        },
        diagnostics: [{
          severity: "Warning",
          title: "Coverage LIMITED",
          affected: "Inspected page",
          detail: "Capture attached after this Subscription began. Earlier Snapshot evidence may be incomplete.",
          recovery: "Reload the inspected page with DevTools open",
          dismissalId: "coverage:LIMITED"
        }]
      })
    );
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const footerDiagnostics = document.querySelector<HTMLElement>("[aria-label='Workbench diagnostics']");
    const diagnosticDetail = "Capture attached after this Subscription began. Earlier Snapshot evidence may be incomplete.";

    expect(rootElement.textContent).toContain("Coverage LIMITED");
    expect(footerDiagnostics?.textContent).toContain("Warning · Coverage LIMITED");
    expect(footerDiagnostics?.textContent).toContain("Affected: Inspected page");
    expect(footerDiagnostics?.textContent).toContain(diagnosticDetail);
    expect(footerDiagnostics?.textContent).toContain("Recovery: Reload the inspected page with DevTools open");
    expect(footerDiagnostics?.tabIndex).toBe(0);
    expect(rootElement.textContent?.split(diagnosticDetail)).toHaveLength(2);
    expect(document.querySelector(".workbench-react__evidence .workbench-react__condition--warning")).toBeNull();
    expect(document.querySelector(".workbench-react__context .workbench-react__diagnostic")).toBeNull();
    const dismiss = Array.from(footerDiagnostics?.querySelectorAll("button") ?? []).find(
      ({ textContent }) => textContent === "Dismiss"
    );
    await act(async () => dismiss?.click());
    expect(runtime.commands).toContainEqual({ type: "dismiss-diagnostic", dismissalId: "coverage:LIMITED" });

    await act(async () => root.unmount());
  });

  it("recovers footer focus when a focused diagnostic resolves without a Dismiss command", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const diagnostics = [
      { severity: "Warning" as const, title: "First condition", affected: "Page", detail: "First detail", dismissalId: "first" },
      { severity: "Error" as const, title: "Second condition", affected: "Page", detail: "Second detail", dismissalId: "second" }
    ];
    const runtime = createTestRuntime(snapshot({ diagnostics }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const first = rootElement.querySelector<HTMLButtonElement>('[aria-label="Dismiss First condition"]');
    first?.focus();
    expect(document.activeElement).toBe(first);
    await act(async () => runtime.setSnapshot({ ...runtime.getSnapshot(), diagnostics: [diagnostics[1]!] }));

    expect(document.activeElement).toBe(rootElement.querySelector('[aria-label="Dismiss Second condition"]'));
    await act(async () => root.unmount());
  });

  it("keeps normalized server notices in Notifications with a supporting Evidence route", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const runtime = createTestRuntime(snapshot({
      notifications: { ...snapshot().notifications, total: 1, entries: [{
        id: "server-error-evt-2",
        code: "ls.client.server-error",
        category: "session",
        severity: "Warning",
        title: "Server error -7",
        affected: "Session S-9",
        detail: "ClientListener reported server error code -7. Message: Application denied the operation",
        limitation: "Non-positive codes can be application-specific.",
        consequence: "The callback does not prove the complete server-side cause.",
        route: { kind: "inspect-evidence", evidence: { intervalId: "interval-1", sequence: 2, eventId: "evt-2" }, label: "Inspect supporting Evidence" }
      }] }
    }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const footer = document.querySelector<HTMLElement>("[aria-label='Workbench diagnostics']");
    expect(footer?.textContent).not.toContain("Server error -7");
    expect(rootElement.textContent).not.toContain("Server error -7");
    const trigger = Array.from(footer?.querySelectorAll("button") ?? []).find(({ textContent }) => textContent === "Notifications (1)");
    trigger?.click();
    expect(runtime.commands).toContainEqual({ type: "open-notifications" });
    await act(async () => runtime.setSnapshot({ ...runtime.getSnapshot(), contextId: "notifications" }));
    const notifications = rootElement.querySelector('[aria-label="Notifications"]');
    expect(notifications?.textContent).toContain("Warning · Server error -7");
    expect(notifications?.textContent).toContain("Affected: Session S-9");
    expect(notifications?.textContent).toContain("Limit: Non-positive codes can be application-specific.");
    expect(notifications?.textContent).toContain("Consequence: The callback does not prove the complete server-side cause.");
    expect(rootElement.textContent?.split("Server error -7")).toHaveLength(2);
    const route = Array.from(notifications?.querySelectorAll("button") ?? []).find(({ textContent }) => textContent === "Inspect supporting Evidence");
    await act(async () => route?.click());
    expect(runtime.commands).toContainEqual({
      type: "inspect-diagnostic-evidence",
      evidence: { intervalId: "interval-1", sequence: 2, eventId: "evt-2" }
    });
    await act(async () => root.unmount());
  });

  it("owns structural notices in Notifications with stable filters and affected-Scope actions", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const codeValue = Object.freeze({
      facet: "diagnosticCode",
      type: "diagnostic-code",
      value: "ls.sub.raw-snapshot-unavailable",
      label: "ls.sub.raw-snapshot-unavailable",
      identity: '["v1","diagnosticCode","diagnostic-code","ls.sub.raw-snapshot-unavailable"]'
    });
    const diagnostic = {
      id: "condition-raw",
      code: "ls.sub.raw-snapshot-unavailable",
      severity: "Warning" as const,
      title: "RAW snapshot unavailable",
      affected: "Subscription sub-1",
      affectedIdentity: { kind: "subscription" as const, pageId: "page-1", clientId: "client-1", subscriptionId: "sub-1" },
      detail: "RAW snapshot state cannot be established.",
      limitation: "The getter was unavailable.",
      consequence: "Snapshot-dependent conclusions remain limited.",
      route: {
        kind: "inspect-affected" as const,
        affected: { kind: "subscription" as const, pageId: "page-1", clientId: "client-1", subscriptionId: "sub-1" },
        label: "Inspect affected Scope"
      },
      filterFacets: {
        diagnosticCode: [codeValue],
        diagnosticSeverity: [],
        diagnosticAffected: []
      }
    };
    const runtime = createTestRuntime({
      ...base,
      diagnostics: [],
      contextId: "notifications",
      notifications: {
        ...base.notifications,
        total: 1,
        entries: [diagnostic],
        filter: {
          criteria: {},
          active: false,
          options: { ...emptyDiagnosticOptions(), diagnosticCode: [{ value: codeValue, count: 1 }] }
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const context = rootElement.querySelector<HTMLElement>('[aria-label="Notifications"]');
    expect(context?.textContent).toContain("RAW snapshot unavailable");
    expect(rootElement.querySelector('[aria-label="Workbench diagnostics"]')?.textContent).not.toContain("RAW snapshot unavailable");
    (Array.from(context?.querySelectorAll<HTMLLabelElement>('fieldset[aria-label^="ls.sub.raw-snapshot-unavailable"] label') ?? []).find(({ textContent }) => textContent?.trim() === "Include"))?.click();
    await act(async () => Array.from(context?.querySelectorAll("button") ?? []).find(({ textContent }) => textContent === "Inspect affected Scope")?.click());
    expect(runtime.commands).toContainEqual({ type: "apply-diagnostic-filter", facet: "diagnosticCode", value: codeValue, polarity: "include" });
    expect(runtime.commands).toContainEqual({ type: "inspect-diagnostic-affected", affected: diagnostic.affectedIdentity });
    // This renderer stub cannot resolve the affected Scope: do not pretend a route succeeded.
    expect(context?.querySelector('[role="status"]')?.textContent).toContain("inspection target is no longer available");

    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      notifications: {
        ...runtime.getSnapshot().notifications,
        filter: {
          ...runtime.getSnapshot().notifications.filter,
          criteria: { diagnosticCode: { include: [codeValue], exclude: [] } },
          active: true
        }
      }
    }));
    Array.from(context?.querySelectorAll("button") ?? []).find(({ textContent }) => textContent === "Remove Include ls.sub.raw-snapshot-unavailable")?.click();
    expect(runtime.commands).toContainEqual({ type: "remove-diagnostic-filter", facet: "diagnosticCode", value: codeValue, polarity: "include" });

    await act(async () => root.unmount());
  });

  it("renders Ordered Evidence as a key-first stream with explicit operation provenance", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        events: base.evidence.events.map((event) => event.id === "evt-2"
          ? { ...event, raw: { kind: "item-update", item: { name: "order-1042" }, update: { key: "order-1042", fields: { qty: 5, status: "GREEN" } } } as unknown as LightstreamerEventEnvelope }
          : { ...event, raw: {} as LightstreamerEventEnvelope })
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const headers = Array.from(document.querySelectorAll('[role="columnheader"]')).map((header) => header.textContent);
    const selectedRow = document.querySelector<HTMLElement>('[data-evidence-id="evt-2"]');
    const cells = selectedRow?.querySelectorAll<HTMLElement>('[role="gridcell"]');

    expect(headers).toEqual(["Op", "Key / item", "Data"]);
    expect(cells).toHaveLength(3);
    expect(selectedRow?.getAttribute("data-evidence-sequence")).toBe("14789");
    expect(selectedRow?.getAttribute("data-evidence-source")).toBe("SERVER");
    expect(cells?.[0]?.textContent).toContain("U");
    expect(document.querySelector('[data-evidence-id="evt-1"] .workbench-react__evidence-op')?.textContent).toContain("?");
    expect(cells?.[1]?.textContent).toBe("order-1042");
    expect(cells?.[1]?.getAttribute("title")).toBe("order-1042");
    expect(cells?.[2]?.textContent).toContain("qty");
    expect(selectedRow?.getAttribute("aria-label")).toContain("SERVER Evidence");
    expect(rootElement.querySelector('[aria-label="Codes"]')).toBeTruthy();
    expect(rootElement.textContent).toContain("Raw fields");

    await act(async () => root.unmount());
  });

  it("collapses selected-Evidence Filter actions until the developer expands them", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime(snapshot({
      context: {
        ...base.context,
        filterActions: [{
          id: "around:evt-2",
          kind: "around",
          label: "Around selected Evidence ±5 seconds",
          around: { intervalId: "panel-test:interval-1", start: 0, end: 10_000 }
        }]
      }
    }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const context = rootElement.querySelector<HTMLElement>('aside[aria-label="Context"]');
    expect(context?.querySelector("header")?.textContent).toContain("Selected Evidence · SERVER");
    const disclosure = rootElement.querySelector<HTMLDetailsElement>('details[aria-label="Filter selected Evidence"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure!.open).toBe(false);
    expect(disclosure!.querySelector("summary")?.textContent).toBe("Filter selected Evidence");
    const metadataDisclosure = rootElement.querySelector<HTMLDetailsElement>('details[aria-label="Evidence metadata"]');
    expect(metadataDisclosure).not.toBeNull();
    expect(metadataDisclosure!.open).toBe(false);
    expect(metadataDisclosure!.querySelector("summary")?.textContent).toBe("Evidence metadata");
    expect(disclosure!.nextElementSibling).toBe(metadataDisclosure);
    expect(metadataDisclosure!.nextElementSibling?.getAttribute("aria-label")).toBe("Selected update");
    await act(async () => disclosure!.querySelector("summary")!.click());
    expect(disclosure!.open).toBe(true);
    expect(disclosure!.querySelector<HTMLButtonElement>('button[aria-label="Around selected Evidence ±5 seconds"]')).not.toBeNull();

    await act(async () => root.unmount());
  });

  it("keeps selected-Evidence Filter disclosure and focus when typed actions become unavailable", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime(snapshot({
      context: {
        ...base.context,
        filterActions: [{
          id: "around:evt-2",
          kind: "around",
          label: "Around selected Evidence ±5 seconds",
          around: { intervalId: "panel-test:interval-1", start: 0, end: 10_000 }
        }]
      }
    }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const disclosure = rootElement.querySelector<HTMLDetailsElement>('details[aria-label="Filter selected Evidence"]')!;
    await act(async () => disclosure.querySelector("summary")!.click());
    const action = disclosure.querySelector<HTMLButtonElement>('button[aria-label="Around selected Evidence ±5 seconds"]')!;
    action.focus();
    expect(document.activeElement).toBe(action);

    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      context: { ...runtime.getSnapshot().context, filterActions: [] }
    }));

    const stableDisclosure = rootElement.querySelector<HTMLDetailsElement>('details[aria-label="Filter selected Evidence"]');
    expect(stableDisclosure).not.toBeNull();
    expect(stableDisclosure!.open).toBe(true);
    expect(stableDisclosure?.textContent).toContain("No Filter values are available for this Evidence.");
    expect(document.activeElement).toBe(stableDisclosure!.querySelector("summary"));

    await act(async () => root.unmount());
  });

  it("keeps retained selected Item Update Context focused on that Evidence", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      context: {
        ...base.context,
        selectedUpdate: {
          fields: [
            { name: "payload", display: '{\n  "flight": "DL42"\n}', jsonString: true },
            { name: "malformed", display: "{nope", jsonString: false }
          ],
          changedFields: [{ name: "payload", display: '{\n  "flight": "DL42"\n}', jsonString: true }],
          jsonPatches: [{ name: "payload", display: '{\n  "op": "replace"\n}', jsonString: false }]
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const selectedUpdate = rootElement.querySelector<HTMLElement>('[aria-label="Selected update"]');
    const contextFields = rootElement.querySelector<HTMLElement>(".workbench-react__context-fields");
    const projection = rootElement.querySelector<HTMLElement>('[aria-label="COMMAND projection summary"]');
    expect(selectedUpdate?.textContent).toContain("Fields");
    expect(selectedUpdate?.querySelector('[aria-label="Changed fields"]')).toBeNull();
    expect(selectedUpdate?.querySelector('[aria-label="JSON patches"]')).toBeNull();
    expect(selectedUpdate?.textContent).toContain("JSON string");
    expect(selectedUpdate?.textContent).toContain('"flight": "DL42"');
    expect(selectedUpdate?.textContent).toContain("{nope");
    expect(projection).toBeNull();
    expect(rootElement.textContent).not.toContain("COMMAND projections");
    expect(contextFields?.compareDocumentPosition(selectedUpdate!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(selectedUpdate?.querySelector("pre")?.parentElement?.className).not.toContain("scroll");

    await act(async () => root.unmount());
  });

  it("keeps runtime-object Context free of COMMAND projection presentation", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      selectionEventId: null,
      evidence: {
        ...base.evidence,
        selectedEventId: null
      },
      context: {
        kind: "runtime",
        title: "Inspected page",
        fields: [["Scope type", "Inspected page"]],
        selectedUpdate: null
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.querySelector('[aria-label="COMMAND projection summary"]')).toBeNull();
    expect(rootElement.querySelector('[aria-label="COMMAND projection comparison"]')).toBeNull();
    expect(rootElement.textContent).not.toContain("Observed Server COMMAND State");
    expect(rootElement.textContent).not.toContain("Local Effective COMMAND State");
    expect(rootElement.textContent).not.toContain("Compare COMMAND projections");

    await act(async () => root.unmount());
  });

  it("does not offer COMMAND projection Context for unrelated selected Evidence", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        events: base.evidence.events.map((event) =>
          event.id === "evt-2"
            ? { ...event, command: null, commandKey: null, kind: "Session lifecycle" }
            : event
        )
      },
      context: {
        kind: "evidence",
        title: "evt-2 · Session lifecycle",
        fields: [["Source", "RUNTIME"]],
        selectedUpdate: null
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.querySelector('[aria-label="COMMAND projection summary"]')).toBeNull();
    expect(rootElement.textContent).not.toContain("COMMAND projections");

    await act(async () => root.unmount());
  });

  it("copies immutable raw Evidence and announces the completed copy", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    const runtime = createTestRuntime(snapshot({ contextId: "raw:evt-2" }));
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const copy = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Copy raw Evidence"
    );
    await act(async () => copy?.click());

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"raw-evt-2\""));
    expect(rootElement.querySelector('[role="status"]')?.textContent).toBe("Copied raw Evidence evt-2.");

    await act(async () => root.unmount());
  });

  it("keeps Find navigation separate from the visible Evidence set", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        find: "order",
        findState: { query: "order", matchCount: 2, currentIndex: 0, currentEventId: "evt-1" }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const openFind = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    await act(async () => openFind?.click());
    const find = document.querySelector<HTMLInputElement>("#workbench-find");
    await act(async () => {
      find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });

    expect(rootElement.textContent).toContain("1 of 2 matches");
    expect(runtime.commands).toContainEqual({ type: "find-next" });
    expect(runtime.commands).toContainEqual({ type: "find-previous" });
    expect(document.querySelectorAll("[data-evidence-id]")).toHaveLength(2);

    await act(async () => root.unmount());
  });

  it("does not steal initial focus and restores the Find trigger only after closing", async () => {
    document.body.innerHTML = '<button id="outside">Outside control</button><main id="app"></main>';
    const outside = document.querySelector<HTMLButtonElement>("#outside");
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!outside || !rootElement) throw new Error("missing test controls");
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    outside.focus();
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.activeElement).toBe(outside);
    const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    await act(async () => trigger?.click());
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Close Find"
    );
    await act(async () => close?.click());
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));

    const restoredTrigger = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Find"
    );
    expect(document.activeElement).toBe(restoredTrigger);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("opens a temporary Scope picker and restores the Scope trigger when it closes", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const scope = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Scope"
    );
    await act(async () => scope?.click());
    const close = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Close Scope"
    );
    expect(close).toBeTruthy();
    await act(async () => close?.click());
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));

    expect(document.activeElement).toBe(scope);
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("exposes independently keyboard-adjustable Scope and Context separators", async () => {
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const separators = Array.from(document.querySelectorAll<HTMLDivElement>('[role="separator"]'));
    expect(separators).toHaveLength(2);
    expect(separators[0]?.getAttribute("aria-label")).toBe("Resize Scope");
    expect(separators[1]?.getAttribute("aria-label")).toBe("Resize Context");
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("228");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("252");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("324");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("216");
    await act(async () => separators[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(separators[0]?.getAttribute("aria-valuenow")).toBe("420");
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe("284");
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe(separators[1]?.getAttribute("aria-valuemax"));
    await act(async () => separators[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(separators[1]?.getAttribute("aria-valuenow")).toBe("210");
    expect(document.querySelector('[role="grid"]')?.getAttribute("tabindex")).toBe("0");
    expect(document.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(0);
    await act(async () => root.unmount());
  });

  it("moves splitter focus to its restore control on collapse and back on restore", async () => {
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const scopeSeparator = document.querySelector<HTMLDivElement>('[role="separator"][aria-label="Resize Scope"]')!;
    scopeSeparator.focus();
    await act(async () => scopeSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    const restore = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore Scope")!;
    expect(document.activeElement).toBe(restore);
    await act(async () => restore.click());
    expect(document.activeElement).toBe(scopeSeparator);
    const contextSeparator = document.querySelector<HTMLDivElement>('[role="separator"][aria-label="Resize Context"]')!;
    contextSeparator.focus();
    await act(async () => contextSeparator.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    const restoreContext = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Restore Context")!;
    expect(document.activeElement).toBe(restoreContext);
    await act(async () => restoreContext.click());
    expect(document.activeElement).toBe(contextSeparator);
    await act(async () => root.unmount());
  });

  it("routes retained-window controls and retained scoped Evidence copy through runtime commands", async () => {
    const base = snapshot();
    const operationsSnapshot = {
      ...base,
      evidence: { ...base.evidence, total: 120, visibleEnd: 60, hasOlder: true, hasNewer: true },
      contextId: "context:actions"
    } satisfies WorkbenchSnapshot;
    const runtime = createTestRuntime({ ...operationsSnapshot, contextId: null });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const click = async (name: string) => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent === name);
      await act(async () => button?.click());
    };
    await click("Oldest");
    await click("Older");
    await click("Newer");
    await click("Newest");
    await click("More actions");
    await act(async () => runtime.setSnapshot(operationsSnapshot));
    expect(document.body.textContent).toContain("Capacity AVAILABLE (NORMAL)");
    const resourceLinks = Object.fromEntries(
      Array.from(document.querySelectorAll<HTMLAnchorElement>(".workbench-react__resource-link"))
        .map((link) => [link.textContent, link.href])
    );
    expect(resourceLinks).toEqual({
      Documentation: "https://imom39a.github.io/lightstreamer-workbench-extension/docs/",
      Privacy: "https://imom39a.github.io/lightstreamer-workbench-extension/privacy/",
      Support: "https://imom39a.github.io/lightstreamer-workbench-extension/support/"
    });
    expect(document.body.textContent).toContain("Usage analytics");
    await click("Copy retained scoped Evidence");
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "show-oldest-evidence" },
      { type: "show-older-evidence" },
      { type: "show-newer-evidence" },
      { type: "show-newest-evidence" },
      { type: "prepare-scoped-evidence-copy" }
    ]));
    await act(async () => root.unmount());
  });

  it("keeps streaming progress, cancellation, and status reachable at the copy/export boundary", async () => {
    const base = snapshot();
    const progress = {
      phase: "READING" as const,
      completed: 1,
      total: 4,
      outputBytes: 128,
      outputByteLimit: 1024,
      interval: { id: "panel-test:interval-1", ordinal: 1 },
      committedEvidenceBoundary: null,
      excludedAfterLatch: 1
    };
    const runtime = createTestRuntime({
      ...base,
      contextId: "context:actions",
      evidenceCopy: { state: "preparing", eventCount: 1, text: null, progress },
      export: {
        ...base.export,
        operation: {
          state: "preparing",
          progress
        }
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.body.textContent).toContain("Reading retained Evidence: 1 of 4 Evidence");
    expect(document.body.textContent).toContain("1 accepted after the latched boundary excluded");
    expect(document.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    const cancelCopy = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Cancel copy");
    await act(async () => cancelCopy?.click());
    expect(runtime.commands).toContainEqual({ type: "cancel-evidence-operation" });

    await act(async () => runtime.setSnapshot({ ...runtime.getSnapshot(), contextId: "context:export" }));
    expect(document.body.textContent).toContain("Preparing retained-Evidence export: 1 of 4 Evidence");
    const cancelExport = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Cancel export");
    await act(async () => cancelExport?.click());
    expect(runtime.commands.filter(({ type }) => type === "cancel-evidence-operation")).toHaveLength(2);
    await act(async () => root.unmount());
  });

  it("keeps Home and End local while routing modified bounds keys to retained Evidence", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    const runtime = createTestRuntime(snapshot());
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    const row = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]')!;
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    grid.focus();
    await act(async () => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true })));
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(row);
    grid.focus();
    await act(async () => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "End", ctrlKey: true, bubbles: true })));
    await act(async () => animationFrames.splice(0).forEach((callback) => callback(0)));
    expect(document.activeElement).toBe(row);
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "focus-evidence", eventId: "evt-1" },
      { type: "select-evidence", eventId: "evt-2" }
    ]));
    expect(runtime.commands).not.toContainEqual({ type: "show-newest-evidence" });
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("copies prepared scoped Evidence once and releases the runtime payload", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidenceCopy: { state: "ready", eventCount: 2, text: "complete evidence" }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await act(async () => Promise.resolve());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(runtime.commands).toContainEqual({ type: "clear-scoped-evidence-copy" });
    await act(async () => root.unmount());
  });

  it("surfaces and clears a scoped Evidence copy error so a retry is clean", async () => {
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidenceCopy: { state: "error", eventCount: 0, text: null, error: "Copy preparation failed" }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    expect(document.body.textContent).toContain("Copy preparation failed");
    expect(runtime.commands).toContainEqual({ type: "clear-scoped-evidence-copy" });
    await act(async () => root.unmount());
  });

  it("marks and scrolls the current Find result without changing Evidence selection", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        find: "order",
        findState: { query: "order", matchCount: 2, currentIndex: 0, currentEventId: "evt-1" }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("data-find-current")).toBe("true");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("aria-selected")).toBe("false");
    expect(scrollIntoView).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("keeps applied Filter state, shown counts, and a one-step clear visible", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        total: 20,
        investigation: {
          ...base.evidence.investigation,
          filter: { ...createFilter(2), text: "orders" },
          counts: { shown: 2, matching: 2, inScope: 20 }
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Filter: orders");
    expect(rootElement.textContent).toContain("Shown 2");
    expect(rootElement.textContent).toContain("Matching 2");
    expect(rootElement.textContent).toContain("In Scope 20");
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Reset Filter"
    );
    await act(async () => clear?.click());

    expect(runtime.commands).toContainEqual({ type: "reset-filter", expectedRevision: 2 });
    await act(async () => root.unmount());
  });

  it("renders the canonical Filter summary and exact count labels with a revisioned Reset", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const appliedFilter = {
      ...createFilter(3),
      text: "orders",
      criteria: {
        provenance: {
          include: [{ facet: "provenance", type: "enum", value: "LOCAL", label: "LOCAL", identity: '["v1","provenance","enum","LOCAL"]' }],
          exclude: []
        }
      }
    } as const;
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        find: "status",
        findState: { query: "status", matchCount: 2, currentIndex: 0, currentEventId: "evt-1" },
        investigation: {
          ...base.evidence.investigation,
          filter: appliedFilter,
          counts: { shown: 1, matching: 4, inScope: 7 }
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Shown 1");
    expect(rootElement.textContent).toContain("Matching 4");
    expect(rootElement.textContent).toContain("In Scope 7");
    expect(rootElement.textContent).toContain("Filter: orders · provenance: LOCAL");
    const reset = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Reset Filter"
    );
    await act(async () => reset?.click());
    expect(runtime.commands).toContainEqual({ type: "reset-filter", expectedRevision: 3 });

    await act(async () => root.unmount());
  });

  it("presents Scope identity, type, lifecycle, and facts as a priority block", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        nodes: [
          {
            id: "page",
            kind: "page",
            label: "Inspected page",
            detail: "1 client · 15 subscriptions",
            parentId: null,
            depth: 0,
            tone: "active",
            lifecycle: "active",
            retired: false,
            selected: true
          }
        ]
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLElement>('[role="treeitem"][data-scope-id="page"]');
    expect(page?.querySelector(".workbench-react__scope-type")?.textContent).toBe("Page");
    expect(page?.querySelector(".workbench-react__scope-identity")?.textContent).toBe("Inspected page");
    expect(page?.querySelector(".workbench-react__scope-identity")?.getAttribute("title")).toBe("Inspected page");
    expect(page?.querySelector(".workbench-react__scope-state")?.textContent).toBe("Active");
    expect(page?.querySelector(".workbench-react__scope-facts")?.textContent).toBe("1 client · 15 subscriptions");
    expect(page?.querySelector(".workbench-react__scope-facts")?.getAttribute("title")).toBe("1 client · 15 subscriptions");

    await act(async () => root.unmount());
  });

  it("uses complete tree keyboard behavior without committing Scope while scanning", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        nodes: [
          { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
          { id: "client", kind: "client", label: "Client main", parentId: "page", depth: 1, tone: "quiet", lifecycle: "active", retired: false, selected: false }
        ]
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[role="treeitem"][aria-level="1"]');
    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(page?.getAttribute("aria-expanded")).toBe("false");
    expect(rootElement.textContent).not.toContain("Client main");

    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(page?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => page?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client" });
    expect(runtime.commands).not.toContainEqual({ type: "set-scope", scopeId: "client" });

    await act(async () => root.unmount());
  });

  it("bounds the mounted Scope tree while keyboard users can reach every logical node", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const logicalNodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      ...Array.from({ length: 220 }, (_, index) => ({
        id: `client-${index + 1}`,
        kind: "client" as const,
        label: `Client ${String(index + 1).padStart(3, "0")}`,
        parentId: "page",
        depth: 1,
        tone: "quiet" as const,
        lifecycle: "active" as const,
        retired: false,
        selected: false
      }))
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "page", nodes: logicalNodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const initiallyMounted = document.querySelectorAll('[role="treeitem"]').length;
    expect(initiallyMounted).toBeGreaterThan(1);
    expect(initiallyMounted).toBeLessThanOrEqual(64);
    const first = document.querySelector<HTMLButtonElement>('[role="treeitem"]');
    await act(async () => first?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client-220" });
    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      scope: { ...runtime.getSnapshot().scope, focusedNodeId: "client-220" }
    }));
    const last = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')).find(
      (node) => node.textContent?.includes("Client 220")
    );
    expect(last).toBe(document.activeElement);

    await act(async () => last?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "page" });
    expect(runtime.commands.some((command) => command.type === "set-scope")).toBe(false);

    await act(async () => root.unmount());
  });

  it("does not leave an off-window Scope selection stranded after live structure growth while Evidence owns focus", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const logicalNodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: false },
      ...Array.from({ length: 220 }, (_, index) => ({
        id: `subscription-${index + 1}`,
        kind: "subscription" as const,
        label: `Subscription ${String(index + 1).padStart(3, "0")}`,
        parentId: "page",
        depth: 1,
        tone: "quiet" as const,
        lifecycle: "active" as const,
        retired: false,
        selected: index === 219
      }))
    ];
    const selectedScopeId = "subscription-220";
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        focusedNodeId: selectedScopeId,
        selection: { id: selectedScopeId, kind: "subscription", retired: false },
        nodes: logicalNodes
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const tree = document.querySelector<HTMLDivElement>('[role="tree"]')!;
    const evidenceRow = document.querySelector<HTMLButtonElement>('[data-evidence-id="evt-2"]')!;
    evidenceRow.focus();

    expect(document.activeElement).toBe(evidenceRow);
    expect(document.querySelector(`[data-scope-id="${selectedScopeId}"]`)).toBeNull();
    expect(Number(tree.dataset.mountedNodeCount)).toBeLessThanOrEqual(127);
    const tabStops = tree.querySelectorAll<HTMLButtonElement>('[role="treeitem"][tabindex="0"]');
    expect(tabStops).toHaveLength(1);
    tabStops[0]?.focus();
    expect(document.activeElement).toBe(tabStops[0]);

    await act(async () => root.unmount());
  });

  it("preserves logical Scope focus while passive scrolling changes the mounted window", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      ...Array.from({ length: 120 }, (_, index) => ({
        id: `client-${index + 1}`,
        kind: "client" as const,
        label: `Client ${String(index + 1).padStart(3, "0")}`,
        parentId: "page",
        depth: 1,
        tone: "quiet" as const,
        lifecycle: "active" as const,
        retired: false,
        selected: false
      }))
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "page", nodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    const tree = document.querySelector<HTMLDivElement>('[role="tree"]')!;
    page.focus();
    runtime.commands.length = 0;
    tree.scrollTop = 3_600;
    await act(async () => tree.dispatchEvent(new Event("scroll", { bubbles: true })));

    expect(document.activeElement).toBe(page);
    expect(runtime.commands).toEqual([]);
    expect(document.querySelector('[data-scope-id="client-60"]')).not.toBeNull();
    expect(document.querySelector('[data-scope-id="client-1"]')).toBeNull();
    expect(document.querySelectorAll('[role="treeitem"]')).toHaveLength(
      Number(tree.dataset.mountedNodeCount)
    );
    expect(Number(tree.dataset.mountedNodeCount)).toBeLessThanOrEqual(128);

    const visibleClient = document.querySelector<HTMLButtonElement>('[data-scope-id="client-60"]')!;
    await act(async () => visibleClient.click());
    expect(runtime.commands.slice(-2)).toEqual([
      { type: "set-scope-focus", scopeId: "client-60" },
      { type: "set-scope", scopeId: "client-60" }
    ]);

    await act(async () => root.unmount());
  });

  it("keeps Scope focus identity coherent for pointer selection and collapsing a focused branch", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: true },
      { id: "client", kind: "client", label: "Client main", parentId: "page", depth: 1, tone: "quiet", lifecycle: "active", retired: false, selected: false },
      { id: "session", kind: "session", label: "Session S-9", parentId: "client", depth: 2, tone: "quiet", lifecycle: "active", retired: false, selected: false }
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: { ...base.scope, focusedNodeId: "session", nodes }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const client = document.querySelector<HTMLButtonElement>('[data-scope-id="client"]')!;
    await act(async () => client.click());
    const pointerCommands = runtime.commands.slice(-2);
    expect(pointerCommands).toEqual([
      { type: "set-scope-focus", scopeId: "client" },
      { type: "set-scope", scopeId: "client" }
    ]);

    runtime.commands.length = 0;
    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    await act(async () => page.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "page" });
    expect(document.querySelector('[data-scope-id="session"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("typeahead reaches an off-window Scope node and exposes full sibling semantics", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const clients = Array.from({ length: 100 }, (_, index) => ({
      id: `client-${index + 1}`,
      kind: "client" as const,
      label: index === 99 ? "Zulu target" : `Client ${String(index + 1).padStart(3, "0")}`,
      parentId: "page",
      depth: 1,
      tone: "quiet" as const,
      lifecycle: "active" as const,
      retired: false,
      selected: index === 0
    }));
    const nodes: WorkbenchSnapshot["scope"]["nodes"] = [
      { id: "page", kind: "page", label: "Inspected page", parentId: null, depth: 0, tone: "quiet", lifecycle: "active", retired: false, selected: false },
      ...clients
    ];
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        focusedNodeId: "page",
        selection: { id: "client-1", kind: "client", retired: false },
        nodes
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const page = document.querySelector<HTMLButtonElement>('[data-scope-id="page"]')!;
    await act(async () => page.dispatchEvent(new KeyboardEvent("keydown", { key: "z", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "set-scope-focus", scopeId: "client-100" });
    await act(async () => runtime.setSnapshot({
      ...runtime.getSnapshot(),
      scope: { ...runtime.getSnapshot().scope, focusedNodeId: "client-100" }
    }));
    const target = document.querySelector<HTMLButtonElement>('[data-scope-id="client-100"]')!;
    expect(target).toBe(document.activeElement);
    expect(target.getAttribute("aria-posinset")).toBe("100");
    expect(target.getAttribute("aria-setsize")).toBe("100");
    expect(document.querySelector('[data-scope-id="client-1"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("renders every canonical Scope lifecycle without inventing Current state", async () => {
    const base = snapshot();
    const lifecycles = ["active", "recovering", "disconnected", "retired", "unknown"] as const;
    const runtime = createTestRuntime({
      ...base,
      scope: {
        ...base.scope,
        focusedNodeId: "active",
        nodes: lifecycles.map((lifecycle) => ({
          id: lifecycle,
          kind: "page" as const,
          label: `${lifecycle} node`,
          detail: lifecycle === "active" ? "Connected" : undefined,
          parentId: null,
          depth: 0,
          tone: "quiet",
          lifecycle,
          retired: lifecycle === "retired",
          selected: lifecycle === "active"
        }))
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const tree = document.querySelector('[role="tree"]');
    const active = tree?.querySelector('[data-scope-id="active"]');
    const treeText = tree?.textContent ?? "";
    expect(active?.querySelector(".workbench-react__scope-facts")?.textContent).toBe("Connected");
    expect(active?.querySelector(".workbench-react__scope-state")?.textContent).toBe("Active");
    expect(treeText).toContain("Recovering");
    expect(treeText).toContain("Disconnected");
    expect(treeText).toContain("Retired");
    expect(treeText).toContain("Unknown");
    expect(treeText).not.toContain("Current");
    expect(treeText).not.toContain("Historical · read-only");

    await act(async () => root.unmount());
  });

  it("shows pending Evidence truthfully while an async identity query is loading", async () => {
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      evidence: {
        ...base.evidence,
        loading: true,
        events: [],
        total: 0,
        visibleStart: 0,
        visibleEnd: 0,
        focusedEventId: null,
        selectedEventId: null
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(document.body.textContent).toContain("Loading Evidence");
    expect(document.body.textContent).not.toContain("No Evidence in the current Scope.");

    await act(async () => root.unmount());
  });

  it("moves Evidence by one 30px-row viewport with Page Up and Page Down without clamping", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const events = Array.from({ length: 30 }, (_, index) => ({
      ...base.evidence.events[1],
      id: `scenario-event-1-passive-${index + 1}`,
      sequence: 20_001 + index,
      time: `14:08:${String(index).padStart(2, "0")}.238`
    }));
    const focusedEventId = events[9]!.id;
    const runtime = createTestRuntime({
      ...base,
      selectionEventId: focusedEventId,
      evidence: {
        ...base.evidence,
        total: events.length,
        events,
        visibleStart: 1,
        visibleEnd: events.length,
        focusedEventId,
        selectedEventId: focusedEventId
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const ledger = document.querySelector<HTMLElement>('[aria-label="Ordered Lightstreamer Evidence"]');
    Object.defineProperty(ledger, "clientHeight", { configurable: true, value: 260 });
    const row = document.querySelector<HTMLButtonElement>(`[data-evidence-id="${focusedEventId}"]`);
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: events[17]!.id });
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true })));
    expect(runtime.commands).toContainEqual({ type: "focus-evidence", eventId: events[1]!.id });

    await act(async () => root.unmount());
  });

  it("keeps a Filter-hidden selection explicit while visible Evidence focus stays independent", async () => {
    const rootElement = document.querySelector<HTMLElement>("#app");
    if (!rootElement) throw new Error("missing app root");
    const base = snapshot();
    const runtime = createTestRuntime({
      ...base,
      selectionEventId: "hidden-event",
      context: { ...base.context, title: "hidden-event · Item Update" },
      evidence: {
        ...base.evidence,
        selectedEventId: "hidden-event",
        focusedEventId: "evt-1",
        hiddenSelection: {
          eventId: "hidden-event",
          message: "Selected event outside current results",
          canReveal: true,
          canClear: true
        }
      }
    });
    const root = createRoot(rootElement);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    expect(rootElement.textContent).toContain("Selected event outside current results");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector('[data-evidence-id="evt-1"]')?.getAttribute("tabindex")).toBe("-1");
    const reveal = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Reveal selected Evidence");
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Clear selection");
    await act(async () => {
      reveal?.click();
      clear?.click();
    });

    expect(runtime.commands).toContainEqual({ type: "reveal-selected-evidence" });
    expect(runtime.commands).toContainEqual({ type: "clear-evidence-selection" });
    expect(rootElement.textContent).toContain("hidden-event · Item Update");
    await act(async () => root.unmount());
  });

  it("renders runtime-owned selected Evidence when the selected row is outside the window", async () => {
    const base = snapshot();
    const selectedEvidence = base.evidence.events[1]!;
    const runtime = createTestRuntime({
      ...base,
      selectedEvidence,
      contextId: `raw:${selectedEvidence.id}`,
      evidence: { ...base.evidence, events: [base.evidence.events[0]!] }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    expect(document.body.textContent).toContain(`${selectedEvidence.id} · immutable SERVER Evidence`);
    expect(document.querySelector("pre")?.textContent).toContain(JSON.stringify(selectedEvidence.raw, null, 2));
    await act(async () => root.unmount());
  });

  it("offers exactly one selected-Evidence and applicable COMMAND Scope entry into Local Injection", async () => {
    const base = snapshot();
    const localInjection = activeLocalInjection();
    const runtime = createTestRuntime({
      ...base,
      scopeId: "item",
      scope: {
        ...base.scope,
        selection: { id: "item", kind: "item", retired: false },
        nodes: [
          { id: "subscription", kind: "subscription", label: "orders", detail: "COMMAND · 2 listeners", parentId: null, depth: 0, tone: "active", lifecycle: "active", retired: false, selected: false },
          { id: "item", kind: "item", label: "portfolio", parentId: "subscription", depth: 1, tone: "active", lifecycle: "active", retired: false, selected: true }
        ]
      },
      localInjection: {
        ...localInjection,
        state: "idle",
        availability: {
          selectedUpdate: { available: true, reason: null },
          commandScope: { available: true, reason: null }
        },
        draft: null
      }
    });
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));

    const createDraft = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Create Local Injection Draft"
    );
    const author = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Author COMMAND Item Update"
    );
    expect(createDraft).toBeTruthy();
    expect(author).toBeTruthy();
    await act(async () => createDraft?.click());
    await act(async () => author?.click());
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "begin-local-injection-from-selection" },
      { type: "begin-local-injection-from-scope" }
    ]));
    expect(document.body.textContent).not.toContain("Add event");
    expect(document.body.textContent).not.toContain("Server Injection");
    expect(document.body.textContent).not.toContain("Replay");

    await act(async () => root.unmount());
  });

  it("promotes one protected Local Injection Draft into an accessible document workspace", async () => {
    const runtime = createTestRuntime(snapshot({ localInjection: activeLocalInjection() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="Local Injection Draft"]')).toBeTruthy();
    });
    const region = document.querySelector<HTMLElement>('[aria-label="Local Injection Draft"]');
    if (!region) throw new Error("missing Local Injection Draft region");
    expect(region.textContent).toContain("Target");
    expect(region.textContent).toContain("sub-7");
    expect(region.textContent).toContain("Session S-9");
    expect(region.querySelector('[data-protected-boundary="source"]')?.textContent).toContain("evt-2 · immutable");
    expect(region.textContent).toContain("LOCAL ONLY");
    expect(region.textContent).toContain("READY");
    expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy();
    expect(region.textContent).toContain("Immutable Source");
    expect(region.textContent).toContain("Injection Draft");
    expect(region.textContent).not.toContain("Review Local Injection");
    const click = async (name: string) => {
      const button = Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find(
        (candidate) => candidate.textContent === name
      );
      expect(button, name).toBeTruthy();
      await act(async () => button?.click());
    };
    await click("Compare Source");
    await click("Inject locally");
    await click("Collapse Draft event");
    await click("Park draft and return to Evidence");
    await click("Discard draft");
    expect(runtime.commands).toEqual(expect.arrayContaining([
      { type: "set-local-injection-compare", open: false },
      { type: "execute-local-injection" },
      { type: "set-local-injection-minimized", minimized: true },
      { type: "park-local-injection" },
      { type: "request-discard-local-injection" }
    ]));
    expect(region.querySelector('[role="tablist"]')).toBeNull();
    expect(region.textContent).not.toContain("Add event");
    expect(region.textContent).not.toContain("Inject all");

    await act(async () => root.unmount());
  });

  it("keeps Cmd/Ctrl+F inside the Local Injection document and respects an already handled shortcut", async () => {
    const runtime = createTestRuntime(snapshot({ localInjection: activeLocalInjection() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy());

    const editor = document.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]');
    await act(async () => editor?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })));
    await vi.waitFor(() => expect(document.querySelector(".cm-search")).toBeTruthy());
    expect(document.querySelector('[aria-label="Find in ordered Evidence"]')).toBeNull();

    const handled = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });
    handled.preventDefault();
    await act(async () => document.querySelector(".workbench-react")?.dispatchEvent(handled));
    expect(document.querySelector('[aria-label="Find in ordered Evidence"]')).toBeNull();

    await act(async () => root.unmount());
  });

  it("returns focus to the current Draft when a blocked replacement is kept", async () => {
    const active = activeLocalInjection();
    const blocked = {
      ...active,
      blockedEntry: { kind: "selected-event" as const, label: "Selected Evidence evt-1" }
    };
    const runtime = createTestRuntime(snapshot({ localInjection: blocked }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => {
      root.render(createElement(WorkbenchPanel, { runtime }));
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection JSON"]')).toBeTruthy());

    const editor = document.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]')!;
    const keep = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Keep current draft"
    )!;
    editor.focus();
    keep.focus();
    await act(async () => keep.click());
    expect(runtime.commands).toContainEqual({ type: "resume-local-injection" });
    await act(async () => runtime.setSnapshot(snapshot({
      localInjection: { ...active, blockedEntry: null }
    })));
    expect(document.activeElement).toBe(editor);

    await act(async () => root.unmount());
  });

  it("keeps a parked Draft boundary resumable and puts discard confirmation on the visible workspace", async () => {
    const parked = activeLocalInjection({ open: false, parked: true });
    const runtime = createTestRuntime(snapshot({
      localInjection: { ...parked, discardConfirmation: true }
    }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Parked Local Injection Draft"]')).toBeTruthy());

    const parkedRegion = document.querySelector<HTMLElement>('[aria-label="Parked Local Injection Draft"]')!;
    expect(parkedRegion.textContent).toContain("sub-7 · portfolio");
    expect(parkedRegion.textContent).toContain("READY · Session S-9 · Source evt-2");
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Discard Local Injection Draft"]')).toBeTruthy());
    const confirmation = document.querySelector<HTMLElement>('[aria-label="Discard Local Injection Draft"]');
    expect(confirmation).toBeTruthy();
    expect(confirmation?.closest("[hidden]")).toBeNull();
    const resume = Array.from(parkedRegion.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Resume Local Injection Draft"
    );
    await act(async () => resume?.click());
    expect(runtime.commands).toContainEqual({ type: "resume-local-injection" });

    await act(async () => root.unmount());
  });

  it("exposes only valid Scenario clock controls and keeps Stop separate from the primary action", async () => {
    const runtime = createTestRuntime(snapshot({ scenario: reviewedScenario() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection Scenario"]')).toBeTruthy());
    const region = document.querySelector<HTMLElement>('[aria-label="Local Injection Scenario"]')!;
    const button = (name: string) => Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find((candidate) => candidate.textContent === name);
    expect(button("Play")).toBeTruthy();
    expect(button("Step next")).toBeTruthy();
    expect(button("Stop")).toBeTruthy();
    expect(button("Pause")).toBeFalsy();
    expect(button("Play")?.classList.contains("workbench-react__primary")).toBe(true);
    expect(button("Stop")?.classList.contains("workbench-react__primary")).toBe(false);
    await act(async () => button("Play")?.click());
    expect(runtime.commands).toContainEqual({ type: "play-scenario" });

    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("in-flight") })));
    expect(button("Pause")).toBeTruthy();
    expect(button("Stop")).toBeTruthy();
    expect(button("Play")).toBeFalsy();
    expect(button("Step next")).toBeFalsy();
    expect(button("Edit Scenario")).toBeFalsy();
    await act(async () => root.unmount());
  });

  it("does not move document focus for passive clock and in-flight phase publication", async () => {
    const runtime = createTestRuntime(snapshot({ scenario: reviewedScenario() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Step 1 reviewed JSON"]')).toBeTruthy());
    const reviewedJson = document.querySelector<HTMLElement>('[aria-label="Step 1 reviewed JSON"]')!;
    reviewedJson.focus();
    expect(document.activeElement).toBe(reviewedJson);
    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("waiting") })));
    expect(document.activeElement).toBe(reviewedJson);
    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("in-flight") })));
    expect(document.activeElement).toBe(reviewedJson);
    expect(Array.from(document.querySelectorAll('[role="status"]')).every((node) => !node.textContent?.includes("WAITING"))).toBe(true);
    await act(async () => root.unmount());
  });

  it("restores the Scenario heading when its picker closes in a terminal phase", async () => {
    const reviewed = reviewedScenario();
    const complete = {
      ...reviewed,
      phase: "complete" as const,
      pickerOpen: true,
      run: { ...reviewed.run!, status: "complete" as const, nextOrdinal: 2 },
      runner: { ...reviewed.runner!, phase: "complete" as const, nextOrdinal: 2, run: { ...reviewed.run!, status: "complete" as const, nextOrdinal: 2 } }
    };
    const runtime = createTestRuntime(snapshot({ scenario: complete }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Scenario Evidence picker"]')).toBeTruthy());

    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...complete, pickerOpen: false } })));
    const heading = document.querySelector<HTMLHeadingElement>('[aria-label="Local Injection Scenario"] h1')!;
    expect(document.activeElement).toBe(heading);
    await act(async () => root.unmount());
  });

  it("restores deliberate Scenario control focus to its semantic successor and closes drift controls", async () => {
    const runtime = createTestRuntime(snapshot({ scenario: reviewedScenario() }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection Scenario"]')).toBeTruthy());
    const find = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Local Injection Scenario"] button')).find((button) => button.textContent === name);
    await act(async () => find("Play")?.click());
    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("waiting") })));
    expect(document.activeElement).toBe(find("Pause"));
    await act(async () => find("Pause")?.click());
    const pausePending = reviewedScenario("in-flight");
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...pausePending, runner: { ...pausePending.runner!, phase: "pause-pending" } } })));
    expect(document.activeElement).toBe(find("Stop"));
    const paused = reviewedScenario();
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...paused, phase: "paused", run: { ...paused.run!, controls: [{ sequence: 1, kind: "PAUSE", activeOffsetMs: 25, reason: "USER", detail: "Paused." }] }, runner: { ...paused.runner!, run: { ...paused.run!, controls: [{ sequence: 1, kind: "PAUSE", activeOffsetMs: 25, reason: "USER", detail: "Paused." }] } } } })));
    expect(document.activeElement).toBe(find("Resume"));
    await act(async () => find("Step next")?.click());
    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("in-flight") })));
    expect(document.activeElement).toBe(find("Stop"));
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...paused, phase: "paused" } })));
    expect(document.activeElement).toBe(find("Resume"));
    await act(async () => runtime.setSnapshot(snapshot({ visible: false, scenario: { ...paused, phase: "paused", runner: { ...paused.runner!, pauseReason: "HIDDEN", visible: false } } })));
    expect(document.querySelector('[aria-label="Local Injection Scenario"]')?.textContent).toContain("PAUSED — PANEL HIDDEN · explicit Resume required");

    const driftRun = { ...paused.run!, authorizations: [
      { id: "auth-1", kind: "INITIAL_REVIEW" as const, targetFingerprint: "fp-1", listenerIds: ["listener-1"], committedEvidenceBoundary: { intervalId: "interval-1", sequence: 6, eventId: "source-6" }, authorizedRemainingFromOrdinal: 1, activeOffsetMs: 0 },
      { id: "auth-2", kind: "DRIFT_REVIEW" as const, targetFingerprint: "fp-2", listenerIds: ["listener-1", "listener-2"], committedEvidenceBoundary: { intervalId: "interval-1", sequence: 7, eventId: "source-7" }, authorizedRemainingFromOrdinal: 1, activeOffsetMs: 25 }
    ], drifts: [{ id: "drift-1", kind: "LISTENER_SET" as const, detectedBeforeOrdinal: 1, activeOffsetMs: 25, addedListenerIds: ["listener-2"], removedListenerIds: [], evidence: null, detail: "Listener set changed." }] };
    const drifted = { ...paused, phase: "paused" as const, run: driftRun, runner: { ...paused.runner!, run: driftRun } };
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...drifted, runner: { ...drifted.runner!, pauseReason: "DRIFT_REVIEW_REQUIRED" } } })));
    expect(find("Re-review immutable plan")?.disabled).toBe(false);
    expect(find("Step next")).toBeUndefined();
    const ledgerText = document.querySelector('[aria-label="Scenario Run ledger"]')?.textContent ?? "";
    expect(ledgerText).toContain("listener-2");
    expect(ledgerText.indexOf("AUTHORIZED")).toBeLessThan(ledgerText.indexOf("DRIFT"));
    expect(ledgerText.indexOf("DRIFT")).toBeLessThan(ledgerText.indexOf("RE-AUTHORIZED"));
    await act(async () => find("Re-review immutable plan")?.click());
    expect(runtime.commands).toContainEqual({ type: "re-review-scenario" });

    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...drifted, runner: { ...drifted.runner!, pauseReason: "USER", controlCapacityReached: true } } })));
    expect(document.querySelector('[aria-label="Local Injection Scenario"]')?.textContent).toContain("CONTROL TRACE CAPACITY REACHED");
    expect(find("Resume")?.disabled).toBe(true);
    expect(find("Step next")?.disabled).toBe(true);
    expect(find("Stop")?.disabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("keeps prior Run correlations inspectable in the Panel Session ledger", async () => {
    const current = reviewedScenario();
    const priorRun = {
      ...current.run!,
      id: "run-prior",
      status: "complete" as const,
      nextOrdinal: 2,
      trace: [{
        stepId: "step-1", ordinal: 1, kind: "attempted" as const, injectionId: "injection-prior",
        outcome: { disposition: "delivered" as const, headline: "DELIVERED LOCALLY" as const, status: "success" as const, executionId: "execution-prior", requestId: "request-prior", timestamp: 42, detail: "settled", attemptedCount: 1, deliveredCount: 1, failedCount: 0 },
        evidence: { intervalId: "interval-1", sequence: 7, eventId: "evidence-prior" },
        retention: "COMMITTED" as const, evidenceAvailability: "RETAINED" as const, assertion: "NOT_EVALUATED" as const
      }]
    };
    const runtime = createTestRuntime(snapshot({ scenario: { ...current, priorRuns: [priorRun] } }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Prior Scenario Run ledgers"]')).toBeTruthy());
    const priorLedger = document.querySelector<HTMLElement>('[aria-label="Prior Scenario Run ledgers"]')!;
    expect(priorLedger.textContent).toContain("run-prior");
    const disclosure = priorLedger.querySelector<HTMLDetailsElement>("details")!;
    disclosure.open = true;
    expect(priorLedger.textContent).toContain("injection-prior");
    expect(priorLedger.textContent).toContain("execution-prior");
    expect(priorLedger.textContent).toContain("request-prior");
    expect(priorLedger.textContent).toContain("assertion NOT_EVALUATED");
    expect(priorLedger.textContent).toContain("evidence-prior");
    await act(async () => root.unmount());
  });

  it("moves focus from a disappearing timed control only when that control still owns focus", async () => {
    const initial = reviewedScenario();
    const runtime = createTestRuntime(snapshot({ scenario: initial }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection Scenario"]')).toBeTruthy());
    const find = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Local Injection Scenario"] button')).find((button) => button.textContent === name);
    await act(async () => find("Play")?.click());
    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("waiting") })));
    expect(document.activeElement).toBe(find("Pause"));
    const completed = reviewedScenario();
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...completed, phase: "complete", run: { ...completed.run!, status: "complete", nextOrdinal: 2 }, runner: { ...completed.runner!, phase: "complete", nextOrdinal: 2, run: { ...completed.run!, status: "complete", nextOrdinal: 2 } } } })));
    expect(document.activeElement).toBe(find("Run again"));

    await act(async () => runtime.setSnapshot(snapshot({ scenario: reviewedScenario("waiting") })));
    const reviewedJson = document.querySelector<HTMLElement>('[aria-label="Step 1 reviewed JSON"]')!;
    reviewedJson.focus();
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...completed, phase: "complete", run: { ...completed.run!, status: "complete", nextOrdinal: 2 }, runner: { ...completed.runner!, phase: "complete", nextOrdinal: 2, run: { ...completed.run!, status: "complete", nextOrdinal: 2 } } } })));
    expect(document.activeElement).toBe(reviewedJson);
    await act(async () => root.unmount());
  });

  it("authors a protected zero-Injection Scenario Checkpoint outside Item Update JSON", async () => {
    const reviewed = reviewedScenario();
    const checkpoint = {
      id: "checkpoint-1",
      kind: "checkpoint" as const,
      name: "Portfolio row is locally settled",
      assertions: [{
        id: "assertion-1",
        kind: "correlated-local-evidence-exists" as const,
        stepId: "step-1",
        withinActiveMs: 2_000
      }]
    };
    const secondStep = {
      ...reviewed.scenario.steps[0],
      id: "step-2",
      draft: { ...reviewed.scenario.steps[0].draft, id: "draft-2" }
    };
    const laterCheckpoint = { ...checkpoint, id: "checkpoint-2", name: "Later boundary", assertions: [{ ...checkpoint.assertions[0], id: "assertion-2", stepId: "step-2" }] };
    const scenario = {
      ...reviewed.scenario,
      phase: "edit" as const,
      steps: [reviewed.scenario.steps[0], secondStep],
      members: [checkpoint, reviewed.scenario.steps[0], secondStep, laterCheckpoint]
    };
    const runtime = createTestRuntime(snapshot({
      scenario: {
        ...reviewed,
        phase: "edit",
        scenario,
        run: null,
        runner: null,
        focusedMemberId: "checkpoint-1",
        focusedStepId: "step-1"
      }
    }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Scenario Checkpoint Portfolio row is locally settled"]')).toBeTruthy());

    const region = document.querySelector<HTMLElement>('[aria-label="Local Injection Scenario"]')!;
    const checkpointRegion = document.querySelector<HTMLElement>('[aria-label="Scenario Checkpoint Portfolio row is locally settled"]')!;
    expect(checkpointRegion.textContent).toContain("CHECKPOINT 1");
    expect(checkpointRegion.textContent).toContain("Zero Injections");
    expect(checkpointRegion.textContent).toContain("Correlated committed Local Evidence exists after Step 1");
    expect(checkpointRegion.textContent).toContain("within 2000 ms active time");
    expect(checkpointRegion.querySelector("textarea, [contenteditable='true'], .cm-editor")).toBeNull();
    const assertionKinds = checkpointRegion.querySelector<HTMLSelectElement>('[aria-label="Assertion assertion-1 kind"]')!;
    expect(Array.from(assertionKinds.options).map(({ value }) => value)).toEqual([
      "prior-injection-outcome",
      "listener-count",
      "correlated-local-evidence-exists",
      "command-key-exists",
      "command-field-equals",
      "diagnostic-observation-exists"
    ]);
    expect(Array.from(assertionKinds.options).some(({ textContent }) => textContent?.includes("Diagnostic Observation"))).toBe(true);
    const firstStepActions = region.querySelector<HTMLElement>('[aria-label="Step 1 actions"]')!;
    expect(Array.from(firstStepActions.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Move earlier")?.disabled).toBe(false);
    const secondStepButton = Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Step 2")!;
    expect(secondStepButton).toBeTruthy();
    const secondStepActions = region.querySelector<HTMLElement>('[aria-label="Step 2 actions"]')!;
    expect(Array.from(secondStepActions.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Move later")?.disabled).toBe(false);
    const name = checkpointRegion.querySelector<HTMLInputElement>('[aria-label="Checkpoint 1 name"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(name, "Local row is stable");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(runtime.commands).toContainEqual({ type: "update-scenario-checkpoint", checkpoint: { ...checkpoint, name: "Local row is stable" } });

    const addAssertion = Array.from(checkpointRegion.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Add assertion")!;
    await act(async () => addAssertion.click());
    const addedAssertionCommand = runtime.commands.at(-1);
    expect(addedAssertionCommand).toMatchObject({
      type: "update-scenario-checkpoint",
      checkpoint: { assertions: [{ id: "assertion-1" }, { id: "checkpoint-1-assertion-2" }] }
    });

    const addCheckpoint = Array.from(region.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Add checkpoint");
    expect(addCheckpoint).toBeTruthy();
    await act(async () => addCheckpoint?.click());
    expect(runtime.commands).toContainEqual({ type: "add-scenario-checkpoint" });
    await act(async () => root.unmount());
  });

  it("authors an exact typed Diagnostic Observation assertion and routes its bounded result reference", async () => {
    const reviewed = reviewedScenario();
    const affected = { kind: "subscription", pageId: "page-1", clientId: "client-1", sessionId: "session-1", subscriptionId: "subscription-1" } as const;
    const assertion = { id: "diagnostic", kind: "diagnostic-observation-exists" as const, contractVersion: 1 as const, ruleCode: "subscription.lost-updates", lifecycle: "occurrence" as const, minimumSeverity: "warning" as const, affected, withinActiveMs: 500 };
    const checkpoint = { id: "checkpoint-diagnostic", kind: "checkpoint" as const, name: "Lost update observed", assertions: [assertion] };
    const scenario = { ...reviewed.scenario, phase: "edit" as const, members: [reviewed.scenario.steps[0], checkpoint] };
    const editRuntime = createTestRuntime(snapshot({ scenario: { ...reviewed, phase: "edit", scenario, run: null, runner: null, focusedMemberId: checkpoint.id } }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime: editRuntime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Scenario Checkpoint Lost update observed"]')).toBeTruthy());
    const region = document.querySelector<HTMLElement>('[aria-label="Scenario Checkpoint Lost update observed"]')!;
    expect(region.textContent).toContain("Diagnostic Observation contract v1");
    expect(region.querySelector<HTMLInputElement>('[aria-label="Diagnostic rule code"]')?.value).toBe("subscription.lost-updates");
    expect(region.querySelector<HTMLSelectElement>('[aria-label="Diagnostic lifecycle"]')?.value).toBe("occurrence");
    expect(region.querySelector<HTMLSelectElement>('[aria-label="Diagnostic minimum severity"]')?.value).toBe("warning");
    expect(region.querySelector<HTMLSelectElement>('[aria-label="Diagnostic affected kind"]')?.value).toBe("subscription");
    expect(region.querySelector<HTMLInputElement>('[aria-label="Affected Subscription identity"]')?.value).toBe("subscription-1");

    const observation = {
      schemaVersion: 1 as const, id: "diag:subscription.lost-updates:lost-7", code: "subscription.lost-updates", ruleVersion: 1, severity: "error" as const,
      lifecycle: { kind: "occurrence" as const, occurrenceId: "lost-7", state: "observed" as const }, affected, observedAt: 10,
      observationBoundary: { intervalId: "diagnostic-interval", sequence: 7 }, route: { kind: "inspect-affected" as const }
    };
    const result = { assertionId: assertion.id, kind: assertion.kind, status: "pass" as const, expected: {}, observed: { state: "observed", value: "error", certainty: "certain" as const, provenance: "diagnostic-observation" as const, evidence: null }, relatedEvidence: [], relatedDiagnostics: [observation] };
    const reviewedCheckpoint = { ...checkpoint, memberOrdinal: 2 };
    const diagnosticCurrentBoundary = { intervalId: "diagnostic-interval", sequence: 9 };
    const trace = { checkpointId: checkpoint.id, checkpointName: checkpoint.name, memberOrdinal: 2, kind: "checkpoint" as const, status: "pass" as const, startedActiveOffsetMs: 0, settledActiveOffsetMs: 0, startedBoundary: null, resultBoundary: null, diagnosticCurrentBoundary, evidenceAvailability: "NOT_APPLICABLE" as const, diagnosticAvailability: "RETAINED" as const, assertions: [result] };
    const diagnosticAuthorization = { intervalId: "diagnostic-review", sequence: 3 };
    const run = {
      ...reviewed.run!,
      members: [reviewed.run!.steps[0], reviewedCheckpoint],
      authorizations: [{
        id: "run-1:authorization:1", kind: "INITIAL_REVIEW" as const, targetFingerprint: "fp-1", listenerIds: ["listener-7"],
        committedEvidenceBoundary: null, diagnosticObservationBoundary: diagnosticAuthorization, authorizedRemainingFromOrdinal: 1, activeOffsetMs: 0
      }],
      trace: [trace]
    };
    await act(async () => editRuntime.setSnapshot(snapshot({ scenario: { ...reviewed, phase: "complete", scenario, run, priorRuns: [run], focusedMemberId: checkpoint.id, runner: { ...reviewed.runner!, run, phase: "complete", activeCheckpoint: null } } })));
    expect(region.textContent).toContain("Diagnostic Observation subscription.lost-updates");
    expect(region.textContent).toContain("observed observed \"error\" · certain · diagnostic-observation");
    expect(document.querySelector('[aria-label="Protected Scenario target and execution boundary"]')?.textContent).not.toContain("Diagnostic authorization seed");
    expect(document.querySelector('[aria-label="Scenario Run ledger"]')?.textContent).toContain("Evidence boundary empty · Diagnostic Observation cursor diagnostic-review · sequence 3");
    expect(region.textContent).toContain("Exact affected identity subscription · page page-1 · client client-1 · session session-1 · subscription subscription-1");
    expect(region.textContent).toContain("Diagnostic Observation boundary diagnostic-interval · sequence 7");
    expect(region.textContent).toContain("Evidence boundary unavailable · Diagnostic Observation current cursor diagnostic-interval · sequence 9");
    expect(document.querySelector('[aria-label="Prior Scenario Run ledgers"]')?.textContent).toContain("Diagnostic Observation current cursor diagnostic-interval · sequence 9");
    expect(region.textContent).toContain("Compact reference only · raw diagnostic messages are not copied into Scenario Trace");
    expect(region.textContent).toContain("Route inspect affected");
    const inspect = Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Inspect Diagnostic Observation subscription.lost-updates");
    expect(inspect).toBeTruthy();
    await act(async () => inspect?.click());
    expect(editRuntime.commands).toContainEqual({ type: "show-scenario-diagnostic-observation", observation });

    const recoveryObservation = { ...observation, id: "diag:capture.disconnected:recover", code: "capture.disconnected", route: { kind: "recover" as const, action: "reload-inspected-page" } };
    const recoveryTrace = { ...trace, assertions: [{ ...result, relatedDiagnostics: [recoveryObservation] }] };
    const recoveryRun = { ...run, trace: [recoveryTrace] };
    await act(async () => editRuntime.setSnapshot(snapshot({ scenario: { ...reviewed, phase: "complete", scenario, run: recoveryRun, membershipError: "Diagnostic Observation affected-object route is unavailable in the current topology.", focusedMemberId: checkpoint.id, runner: { ...reviewed.runner!, run: recoveryRun, phase: "complete", activeCheckpoint: null } } })));
    const unavailableRecovery = region.querySelector<HTMLButtonElement>('[aria-label="Recovery unavailable for Diagnostic Observation capture.disconnected"]');
    expect(unavailableRecovery).toBeTruthy();
    expect(unavailableRecovery?.disabled).toBe(true);
    expect(region.textContent).toContain("Recovery unavailable from Scenario Trace");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("affected-object route is unavailable in the current topology");
    await act(async () => root.unmount());
  });

  it("keeps a high-volume Checkpoint Scenario collapsed with no JSON editor cost", async () => {
    const reviewed = reviewedScenario();
    const checkpoints = Array.from({ length: 99 }, (_, index) => ({
      id: `checkpoint-${index + 1}`,
      kind: "checkpoint" as const,
      name: `Boundary ${index + 1}`,
      assertions: [{ id: `assertion-${index + 1}`, kind: "correlated-local-evidence-exists" as const, stepId: "step-1" }]
    }));
    const scenario = { ...reviewed.scenario, phase: "edit" as const, members: [reviewed.scenario.steps[0], ...checkpoints] };
    const runtime = createTestRuntime(snapshot({ scenario: { ...reviewed, phase: "edit", scenario, run: null, runner: null, focusedMemberId: "checkpoint-1" } }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelectorAll(".workbench-react__scenario-checkpoint")).toHaveLength(99));

    expect(document.querySelectorAll(".workbench-react__scenario-assertions")).toHaveLength(1);
    expect(document.querySelectorAll(".workbench-react__scenario-checkpoint .cm-editor")).toHaveLength(0);
    expect(document.querySelectorAll(".workbench-react__scenario-checkpoint .workbench-react__scenario-collapsed")).toHaveLength(98);
    expect(document.querySelectorAll('[data-step-focused="true"]')).toHaveLength(1);

    await act(async () => root.unmount());
  });

  it("presents persistent Checkpoint outcomes and an exact related Evidence route", async () => {
    const reviewed = reviewedScenario();
    const checkpoint = {
      id: "checkpoint-1",
      kind: "checkpoint" as const,
      name: "Portfolio row is locally settled",
      assertions: [{ id: "assertion-1", kind: "command-field-equals" as const, item: { name: "portfolio", position: 1 }, key: "order-1042", field: "qty", expected: 18 }]
    };
    const reviewedCheckpoint = { ...checkpoint, memberOrdinal: 2 };
    const checkpointTrace = {
      checkpointId: checkpoint.id,
      checkpointName: checkpoint.name,
      memberOrdinal: 2,
      kind: "checkpoint" as const,
      status: "pass" as const,
      startedActiveOffsetMs: 75,
      settledActiveOffsetMs: 80,
      startedBoundary: { intervalId: "interval-1", sequence: 7, eventId: "evidence-7" },
      resultBoundary: { intervalId: "interval-1", sequence: 8, eventId: "evidence-8" },
      assertions: [{
        assertionId: "assertion-1",
        kind: "command-field-equals" as const,
        status: "pass" as const,
        expected: { primitive: 18 },
        observed: { state: "concrete", value: 18, certainty: "certain" as const, provenance: "local-effective" as const, evidence: { intervalId: "interval-1", sequence: 8, eventId: "evidence-8" } },
        relatedEvidence: [{ intervalId: "interval-1", sequence: 8, eventId: "evidence-8" }]
      }]
    };
    const scenario = { ...reviewed.scenario, members: [reviewed.scenario.steps[0], checkpoint] };
    const run = { ...reviewed.run!, members: [reviewed.run!.steps[0], reviewedCheckpoint], trace: [checkpointTrace] };
    const waitingRun = { ...run, trace: [] };
    const waitingAssertion = { ...checkpointTrace.assertions[0], status: "waiting" as const, observed: { ...checkpointTrace.assertions[0].observed, state: "absent", value: undefined } };
    const runtime = createTestRuntime(snapshot({ scenario: { ...reviewed, phase: "running", scenario, run: waitingRun, focusedMemberId: "checkpoint-1", runner: { ...reviewed.runner!, run: waitingRun, phase: "waiting", activeCheckpoint: { checkpointId: "checkpoint-1", checkpointName: checkpoint.name, startedActiveOffsetMs: 75, deadlineActiveOffsetMs: 2_075, boundary: { intervalId: "interval-1", sequence: 7, eventId: "evidence-7" }, status: "waiting", assertions: [waitingAssertion] } } } }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Scenario Checkpoint Portfolio row is locally settled"]')).toBeTruthy());

    const checkpointRegion = document.querySelector<HTMLElement>('[aria-label="Scenario Checkpoint Portfolio row is locally settled"]')!;
    expect(checkpointRegion.dataset.checkpointState).toBe("waiting");
    expect(checkpointRegion.textContent).toContain("WAITING");
    expect(checkpointRegion.textContent).toContain("deadline 2075 ms");
    expect(checkpointRegion.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();

    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...reviewed, phase: "complete", scenario, run, focusedMemberId: "checkpoint-1", runner: { ...reviewed.runner!, run, phase: "complete", activeCheckpoint: null } } })));
    expect(checkpointRegion.dataset.checkpointState).toBe("pass");
    expect(checkpointRegion.textContent).toContain("PASS");
    expect(checkpointRegion.textContent).toContain("Evidence boundary evidence-8 · sequence 8");
    expect(checkpointRegion.textContent).toContain("observed concrete 18 · certain · local-effective");
    const inspectEvidence = Array.from(checkpointRegion.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Inspect Evidence evidence-8");
    expect(inspectEvidence).toBeTruthy();
    await act(async () => inspectEvidence?.click());
    expect(runtime.commands).toContainEqual({ type: "show-scenario-checkpoint-evidence", evidence: { intervalId: "interval-1", sequence: 8, eventId: "evidence-8" } });

    for (const status of ["fail", "expired", "unavailable", "not-evaluable"] as const) {
      const trace = { ...checkpointTrace, status, assertions: [{ ...checkpointTrace.assertions[0], status }] };
      const changedRun = { ...run, trace: [trace] };
      await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...reviewed, phase: "stopped", scenario, run: changedRun, focusedMemberId: "checkpoint-1", runner: { ...reviewed.runner!, run: changedRun, phase: "stopped" } } })));
      expect(checkpointRegion.dataset.checkpointState).toBe(status);
      expect(checkpointRegion.textContent).toContain(status.toUpperCase());
      expect(checkpointRegion.querySelector('[role="alert"]')).toBeTruthy();
    }
    expect(checkpointRegion.textContent?.toLowerCase()).not.toContain("authoritative command state is true");

    const limitedTrace = {
      ...checkpointTrace,
      assertions: [{
        ...checkpointTrace.assertions[0],
        observed: {
          ...checkpointTrace.assertions[0].observed,
          value: "preview",
          valueLimited: { originalBytes: 12_582_912, retainedBytes: 1_024, comparison: "different" as const }
        }
      }]
    };
    const limitedRun = { ...run, trace: [limitedTrace] };
    await act(async () => runtime.setSnapshot(snapshot({ scenario: { ...reviewed, phase: "stopped", scenario, run: limitedRun, focusedMemberId: "checkpoint-1", runner: { ...reviewed.runner!, run: limitedRun, phase: "stopped" } } })));
    expect(checkpointRegion.textContent).toContain("TRACE VALUE LIMITED: observed preview retained 1024 of 12582912 UTF-8 bytes; full value different");

    await act(async () => root.unmount());
  });

  it("presents and protects a paused Checkpoint active assertion window", async () => {
    const reviewed = reviewedScenario();
    const checkpoint = {
      id: "checkpoint-1", kind: "checkpoint" as const, name: "Portfolio row settles",
      assertions: [{ id: "assertion-1", kind: "correlated-local-evidence-exists" as const, stepId: "step-1", withinActiveMs: 100 }]
    };
    const reviewedCheckpoint = { ...checkpoint, memberOrdinal: 2 };
    const scenario = { ...reviewed.scenario, members: [reviewed.scenario.steps[0], checkpoint] };
    const run = { ...reviewed.run!, members: [reviewed.run!.steps[0], reviewedCheckpoint], nextMemberIndex: 1, status: "paused" as const };
    const activeCheckpoint = {
      checkpointId: checkpoint.id, checkpointName: checkpoint.name, startedActiveOffsetMs: 0,
      deadlineActiveOffsetMs: 100, boundary: null, status: "waiting" as const, assertions: []
    };
    const runtime = createTestRuntime(snapshot({ scenario: {
      ...reviewed, phase: "paused", scenario, run, focusedMemberId: checkpoint.id,
      runner: { ...reviewed.runner!, run, cursor: { members: run.members, index: 1 }, phase: "paused", activeOffsetMs: 40, remainingDelayMs: 60, pauseReason: "HIDDEN", visible: true, activeCheckpoint }
    } }));
    const root = createRoot(document.querySelector("#app")!);
    await act(async () => root.render(createElement(WorkbenchPanel, { runtime })));
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Local Injection Scenario"]')).toBeTruthy());
    const region = document.querySelector<HTMLElement>('[aria-label="Local Injection Scenario"]')!;
    expect(region.textContent).toContain("60 ms active assertion window remains for Checkpoint Portfolio row settles · explicit Resume required");
    const stepNext = Array.from(region.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Step next");
    expect(stepNext?.disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
