import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createFilter } from "../src/core/filter-algebra";
import type { WorkbenchRuntime, WorkbenchSnapshot } from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Count renders of leaves that only the memoized Context pane and footer
// render. A leaf re-renders exactly when its (non-memoized) parent does.
const renders = vi.hoisted(() => ({ context: 0, footer: 0 }));

vi.mock("../src/extension/panel/react/filter-workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/extension/panel/react/filter-workflow")>();
  const { createElement: create } = await import("react");
  return {
    ...actual,
    SelectedFilterActions(props: Parameters<typeof actual.SelectedFilterActions>[0]) {
      renders.context += 1;
      return create(actual.SelectedFilterActions, props);
    }
  };
});

vi.mock("../src/extension/panel/react/diagnostic-details", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/extension/panel/react/diagnostic-details")>();
  const { createElement: create } = await import("react");
  return {
    ...actual,
    DiagnosticDetails(props: Parameters<typeof actual.DiagnosticDetails>[0]) {
      renders.footer += 1;
      return create(actual.DiagnosticDetails, props);
    }
  };
});

const { WorkbenchPanel } = await import("../src/extension/panel/react/workbench-panel");

type Evidence = WorkbenchSnapshot["evidence"]["events"][number];

function evidenceEvent(index: number): Evidence {
  return {
    id: `evt-${index}`,
    sequence: 14_000 + index,
    time: `14:08:${String(index).padStart(2, "0")}.000`,
    source: "SERVER",
    phase: "LIVE",
    command: "UPDATE",
    commandKey: "order-1042",
    kind: "Item Update",
    object: "order-1042",
    summary: "qty",
    raw: { id: `raw-evt-${index}`, timestamp: index, direction: "inbound", source: "server", synthetic: false, kind: "item-update", item: { name: "order-1042" }, update: { key: "order-1042", fields: { qty: index } } }
  } as Evidence;
}

function baseSnapshot(): WorkbenchSnapshot {
  const events = [evidenceEvent(1), evidenceEvent(2)];
  return {
    version: 1,
    renderedEvidenceBoundary: null,
    visible: true,
    captureStatus: "capturing",
    capture: { operation: "RUNNING", coverage: "USEFUL", firstMissingEventId: null, committedEvidenceBoundary: null },
    theme: "dark",
    evidence: {
      loading: false,
      total: events.length,
      windowSize: 60,
      mode: "live",
      newerCount: 0,
      offset: 0,
      visibleStart: 1,
      visibleEnd: events.length,
      hasOlder: false,
      hasNewer: false,
      find: "",
      findState: { query: "", matchCount: 0, currentIndex: -1, currentEventId: null, loading: false, revealRevision: 0, newerCount: 0, expired: false, wrapped: null, snippet: null },
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
        counts: { shown: events.length, matching: events.length, inScope: events.length },
        discoveries: new Map(),
        lookup: null,
        find: null,
        evaluation: null,
        coverage: null,
        storage: null,
        queryState: "ready",
        problem: null
      },
      events
    },
    scope: {
      label: "Page",
      status: "Subscribed",
      structureRevision: 0,
      structure: [],
      resolveNode: () => null,
      nodes: [],
      focusedNodeId: "page",
      selection: { id: "page", kind: "page", retired: false },
      coverage: { semantic: true, status: "USEFUL", detail: "Structural Scope is based on current captured topology." }
    },
    scopeId: "page",
    selectionEventId: "evt-2",
    selectedEvidence: events[1],
    contextId: null,
    context: {
      kind: "evidence",
      title: "evt-2 · Item Update",
      fields: [["Source", "SERVER"], ["Phase", "LIVE"], ["COMMAND operation", "UPDATE"]],
      selectedUpdate: { fields: [], changedFields: [], jsonPatches: [] }
    },
    notifications: { entries: [], total: 0, limit: 100, filter: { criteria: {}, active: false, options: { diagnosticCode: [], diagnosticSeverity: [], diagnosticAffected: [] } } },
    diagnostics: [{
      dismissalId: "storage:headroom:warning",
      category: "storage",
      severity: "Warning",
      title: "Storage headroom low",
      affected: "Event History",
      detail: "Browser storage headroom is low."
    }],
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
      sensitiveCounts: { "server-addresses": 0, "client-ips": 0, "item-names": 0, "command-keys": 0, "field-names": 0, identifiers: 0 },
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
    }
  } as unknown as WorkbenchSnapshot;
}

/**
 * Mirrors `WorkbenchRuntime.createSnapshot()`: every publication rebuilds
 * Context, diagnostics, Notifications, export, and Injection availability as
 * fresh but structurally equal objects. Only the Evidence window changes.
 */
function evidenceOnlyPublication(previous: WorkbenchSnapshot, nextEvent: Evidence): WorkbenchSnapshot {
  const events = [...previous.evidence.events, nextEvent];
  return {
    ...previous,
    version: previous.version + 1,
    context: structuredClone(previous.context),
    diagnostics: structuredClone(previous.diagnostics),
    notifications: structuredClone(previous.notifications),
    export: structuredClone(previous.export),
    localInjection: structuredClone(previous.localInjection),
    evidence: {
      ...previous.evidence,
      events,
      total: events.length,
      visibleEnd: events.length,
      investigation: {
        ...previous.evidence.investigation,
        counts: { shown: events.length, matching: events.length, inScope: events.length }
      }
    }
  };
}

function createTestRuntime(initial: WorkbenchSnapshot): WorkbenchRuntime & { publish(next: WorkbenchSnapshot): void } {
  const listeners = new Set<() => void>();
  let current = initial;
  return {
    getSnapshot: () => current,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: vi.fn(),
    dispose: vi.fn(),
    disposeAndWait: vi.fn(),
    publish(next: WorkbenchSnapshot) {
      current = next;
      listeners.forEach((listener) => listener());
    }
  } as unknown as WorkbenchRuntime & { publish(next: WorkbenchSnapshot): void };
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("WorkbenchPanel render isolation", () => {
  it("does not re-render the memoized Context pane or footer for an Evidence-only publication", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const initial = baseSnapshot();
    const runtime = createTestRuntime(initial);
    root = createRoot(document.querySelector("#app")!);
    act(() => root!.render(createElement(WorkbenchPanel, { runtime })));

    expect(renders.context).toBeGreaterThan(0);
    expect(renders.footer).toBeGreaterThan(0);
    renders.context = 0;
    renders.footer = 0;

    let latest = initial;
    for (let index = 3; index <= 5; index += 1) {
      latest = evidenceOnlyPublication(latest, evidenceEvent(index));
      act(() => runtime.publish(latest));
    }

    // The Evidence surface did re-render with the new rows...
    expect(document.querySelector('[data-evidence-id="evt-5"]')).not.toBeNull();
    expect(document.querySelector(".workbench-react")?.getAttribute("data-snapshot-version")).toBe(String(latest.version));
    // ...while Context and the footer were skipped.
    expect(renders.context).toBe(0);
    expect(renders.footer).toBe(0);
    expect(document.querySelector('[aria-label="Context"] [role="heading"]')?.textContent).toBe("evt-2 · Item Update");
    expect(document.querySelector('[aria-label="Dismiss Storage headroom low"]')).not.toBeNull();
  });

  it("still re-renders Context and the footer when their content changes", () => {
    document.body.innerHTML = '<main id="app"></main>';
    const initial = baseSnapshot();
    const runtime = createTestRuntime(initial);
    root = createRoot(document.querySelector("#app")!);
    act(() => root!.render(createElement(WorkbenchPanel, { runtime })));
    renders.context = 0;
    renders.footer = 0;

    const contextChanged = { ...initial, version: 2, context: { ...initial.context, title: "evt-2 · Item Update (revised)" } };
    act(() => runtime.publish(contextChanged));
    expect(renders.context).toBeGreaterThan(0);
    expect(renders.footer).toBe(0);
    expect(document.querySelector('[aria-label="Context"] [role="heading"]')?.textContent).toBe("evt-2 · Item Update (revised)");

    renders.context = 0;
    const diagnosticChanged = {
      ...contextChanged,
      version: 3,
      diagnostics: [{ ...contextChanged.diagnostics[0]!, detail: "Browser storage headroom is critically low." }]
    };
    act(() => runtime.publish(diagnosticChanged));
    expect(renders.footer).toBeGreaterThan(0);
    expect(renders.context).toBe(0);
  });
});
