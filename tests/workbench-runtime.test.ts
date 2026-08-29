import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory, type EventHistory, type HistoryPublication } from "../src/core/event-history-authoritative";
import { createTypedFilterValue } from "../src/core/filter-algebra";
import { createActivityProjection } from "../src/core/activity-projection";
import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";
import { diagnosticCodeFacetValue, diagnosticSeverityFacetValue } from "../src/core/diagnostic-observation-index";
import { createCaptureMessage } from "../src/bridge/messages";
import { createWorkbenchRuntime, type WorkbenchRuntime, type WorkbenchRuntimeScheduler, type WorkbenchSnapshot } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { getPanelScenario } from "./support/panel-scenarios";
import { getWorkbenchScenario } from "./support/workbench-scenarios";

type ScheduledCallback = () => void;

function createScheduler(): WorkbenchRuntimeScheduler & {
  flushFrame(): void;
  flushFallback(): void;
  frameCount(): number;
  fallbackCount(): number;
} {
  let nextId = 0;
  const frames = new Map<number, ScheduledCallback>();
  const fallbacks = new Map<number, ScheduledCallback>();
  return {
    requestFrame(callback) {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id as number);
    },
    setTimeout(callback) {
      const id = ++nextId;
      fallbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      fallbacks.delete(id as number);
    },
    flushFrame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    flushFallback() {
      const callbacks = [...fallbacks.values()];
      fallbacks.clear();
      callbacks.forEach((callback) => callback());
    },
    frameCount() {
      return frames.size;
    },
    fallbackCount() {
      return fallbacks.size;
    }
  };
}

function event(id: string, item = id): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: item, position: 1 },
    update: { fields: { value: id } }
  };
}

function applyItemFilter(runtime: WorkbenchRuntime, item: string): void {
  const filter = runtime.getSnapshot().evidence.investigation.filter;
  runtime.dispatch({
    type: "apply-filter-mutations",
    expectedRevision: filter.revision,
    operations: [{ type: "add-criterion", facet: "item", value: createTypedFilterValue("item", "structural-item", JSON.stringify([item, null]), item) }]
  });
}

function applyTextFilter(runtime: WorkbenchRuntime, text: string): void {
  const filter = runtime.getSnapshot().evidence.investigation.filter;
  runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: filter.revision, operations: [{ type: "set-text", text }] });
}

let evidenceOperationModuleSettled = false;

async function flushStoreNotifications(): Promise<void> {
  // Complete History operations cross the panel's dynamically loaded,
  // bounded operation boundary before publishing their artifact.
  if (!evidenceOperationModuleSettled) {
    await import("../src/extension/panel/evidence-history-operation");
    evidenceOperationModuleSettled = true;
  }
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

function topologyEvent(
  id: string,
  kind: LightstreamerEventEnvelope["kind"],
  overrides: Partial<LightstreamerEventEnvelope> = {}
): LightstreamerEventEnvelope {
  return {
    ...event(id, "orders"),
    kind,
    client: {
      id: "client-main",
      status: "CONNECTED:WS-STREAMING",
      sessionId: "S-1",
      transport: "WS-STREAMING"
    },
    subscription: {
      id: "orders-subscription",
      mode: "COMMAND",
      items: ["orders"],
      active: true,
      subscribed: true
    },
    listener: { id: "orders-listener", callbacks: ["onItemUpdate"] },
    ...overrides
  };
}

function appendTopologyJourney(
  history: EventHistory,
  identity: {
    clientId: string;
    sessionId: string;
    subscriptionId: string;
    itemName: string;
    listenerId: string;
  },
  startAt: number
): void {
  const base = (offset: number, kind: LightstreamerEventEnvelope["kind"]): LightstreamerEventEnvelope => {
    const structural = kind !== "client-created" && kind !== "client-status";
    const itemEvidence = kind === "item-update";
    return {
      id: `${identity.clientId}-${startAt + offset}`,
      timestamp: startAt + offset,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind,
      client: {
        id: identity.clientId,
        status: "CONNECTED:WS-STREAMING",
        sessionId: identity.sessionId,
        transport: "WS-STREAMING"
      },
      ...(structural
        ? {
            subscription: {
              id: identity.subscriptionId,
              mode: "MERGE",
              items: [identity.itemName],
              active: true,
              subscribed: true
            }
          }
        : {}),
      ...(kind === "listener-added" || itemEvidence
        ? { listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] } }
        : {}),
      ...(itemEvidence ? { item: { name: identity.itemName, position: 1 } } : {})
    };
  };
  history.offer(base(0, "client-created"));
  history.offer(base(1, "client-status"));
  history.offer(base(2, "subscription-created"));
  history.offer(base(3, "subscription-started"));
  history.offer(base(4, "listener-added"));
  history.offer({
    ...base(5, "item-update"),
    update: {
      isSnapshot: false,
      fields: { value: identity.itemName },
      changedFields: { value: identity.itemName }
    }
  });
}

function commandUpdate(
  id: string,
  identity: {
    clientId: string;
    sessionId: string;
    subscriptionId: string;
    itemName: string;
    itemPosition: number;
    listenerId: string;
    key: string;
    qty: number;
  },
  options: { synthetic?: boolean; command?: "ADD" | "UPDATE" } = {}
): LightstreamerEventEnvelope {
  const synthetic = options.synthetic ?? false;
  const command = options.command ?? "ADD";
  return {
    id,
    timestamp: Number(id.replace(/\D/g, "")) || 1,
    direction: "inbound",
    source: synthetic ? "synthetic" : "server",
    synthetic,
    kind: "item-update",
    client: {
      id: identity.clientId,
      status: "CONNECTED:WS-STREAMING",
      sessionId: identity.sessionId,
      transport: "WS-STREAMING"
    },
    subscription: {
      id: identity.subscriptionId,
      mode: "COMMAND",
      items: [identity.itemName],
      fields: ["command", "key", "qty"],
      active: true,
      subscribed: true
    },
    listener: { id: identity.listenerId, callbacks: ["onItemUpdate"] },
    item: { name: identity.itemName, position: identity.itemPosition },
    update: {
      isSnapshot: false,
      command,
      key: identity.key,
      fields: { command, key: identity.key, qty: identity.qty },
      changedFields: { qty: identity.qty }
    }
  };
}

function contextFields(runtime: ReturnType<typeof createWorkbenchRuntime>): Record<string, string> {
  return Object.fromEntries(runtime.getSnapshot().context.fields);
}

describe("WorkbenchRuntime", () => {
  it("migrates committed and runtime findings through the normalized Diagnostic Observation journal without changing the footer", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "runtime-diagnostics" });
    const baseHistory = createAuthoritativeHistory({
      precommitted: [
        topologyEvent("server-error-0", "server-error", {
          subscription: undefined,
          item: undefined,
          update: undefined,
          topology: { version: 1, kind: "server-error", pageEpoch: "page-1", captureSequence: 1, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
          serverError: { code: -7, message: "Application denied the operation", messageState: "safe" }
        }),
        topologyEvent("server-keepalive-0", "server-keepalive", {
          subscription: undefined,
          item: undefined,
          update: undefined,
          topology: { version: 1, kind: "server-keepalive", pageEpoch: "page-1", captureSequence: 2, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
          keepalive: { count: 4, windowId: "S-1:1", firstObservedAt: 1, lastObservedAt: 4, aggregate: true }
        }),
        {
        ...event("subscription-error-1", "orders"),
        kind: "subscription-error",
        update: undefined,
        raw: { args: [41, "private source text remains outside normalization"] }
        },
        {
          ...event("lost-updates-2", "orders"),
          kind: "lost-updates",
          update: { lostUpdates: 2 }
        },
        topologyEvent("command-3", "item-update", {
          topology: {
            version: 1,
            kind: "item-update",
            pageEpoch: "page-1",
            captureSequence: 3,
            provenance: { instrumentationSource: "official-public-api" },
            coverage: { status: "complete", getters: {} }
          },
          item: { name: "orders", position: 1 },
          update: {
            isSnapshot: false,
            command: "UPDATE",
            key: "missing-key",
            fields: { command: "UPDATE", key: "missing-key", qty: 2 },
            changedFields: { qty: 2 }
          }
        }),
        topologyEvent("command-4", "item-update", {
          topology: {
            version: 1,
            kind: "item-update",
            pageEpoch: "page-1",
            captureSequence: 4,
            provenance: { instrumentationSource: "official-public-api" },
            coverage: { status: "complete", getters: {} }
          },
          item: { name: "orders", position: 1 },
          update: {
            isSnapshot: false,
            command: "PRIVATE-COMMAND-VALUE",
            key: "secret-key",
            fields: { command: "PRIVATE-COMMAND-VALUE", key: "secret-key" },
            changedFields: { command: "PRIVATE-COMMAND-VALUE" }
          }
        }),
        topologyEvent("recovering-5", "client-status", {
          client: { id: "client-main", status: "DISCONNECTED:TRYING-RECOVERY", sessionId: "S-1" }
        })
      ]
    });
    const history: EventHistory = {
      ...baseHistory,
      status: () => ({
        ...baseHistory.status(),
        capacity: { tier: "LOWER", state: "AVAILABLE" },
        fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
      }),
      follow: (options, observer) => baseHistory.follow(options, (publication) => {
        observer(publication.type === "status"
          ? {
              ...publication,
              status: {
                ...publication.status,
                capacity: { tier: "LOWER", state: "AVAILABLE" },
                fallback: "PRIMARY_JOURNAL_UNAVAILABLE"
              }
            }
          : publication);
      })
    };
    const runtime = createWorkbenchRuntime({
      history,
      diagnosticObservations,
      captureStatus: "bridge disconnected",
      storageEstimate: {
        source: "navigator.storage.estimate",
        status: "AVAILABLE",
        usageBytes: 1,
        quotaBytes: 2,
        headroomBytes: 1,
        failure: null
      }
    });
    await flushStoreNotifications();
    const snapshot = runtime.getSnapshot();
    await runtime.settleDiagnosticObservations?.();
    const observations = (await diagnosticObservations.query()).observations;

    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ title: "Capture disconnected" }));
    for (const code of [
      "workbench.history.lower-capacity-fallback",
      "workbench.storage.headroom-limited",
      "workbench.capture.disconnected",
      "ls.session.recovering"
    ]) {
      expect(snapshot.notifications.entries, code).toContainEqual(expect.objectContaining({
        code,
        dismissalId: expect.any(String)
      }));
    }
    expect(snapshot.notifications.entries).toContainEqual(expect.objectContaining({
      code: "ls.client.server-error",
      title: "Server error -7",
      affected: "Session S-1",
      route: {
        kind: "inspect-evidence",
        evidence: { intervalId: "authoritative-test:interval-1", sequence: 1, eventId: "server-error-0" },
        label: "Inspect supporting Evidence"
      }
    }));
    expect(snapshot.notifications.entries).toContainEqual(expect.objectContaining({
      code: "ls.client.server-keepalive",
      severity: "Information",
      consequence: expect.stringContaining("does not prove")
    }));
    expect(observations.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ls.subscription.error",
      "ls.subscription.lost-updates",
      "ls.client.server-error",
      "ls.client.server-keepalive",
      "ls.command.unknown-key-update",
      "ls.command.unsupported-command",
      "workbench.history.lower-capacity-fallback",
      "workbench.storage.headroom-limited",
      "workbench.capture.disconnected",
      "ls.session.recovering"
    ]));
    for (const code of [
      "ls.subscription.error",
      "ls.subscription.lost-updates",
      "ls.command.unknown-key-update",
      "ls.command.unsupported-command"
    ]) {
      expect(observations.filter((observation) => observation.code === code), code).toHaveLength(1);
    }
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.command.unknown-key-update", affected: expect.objectContaining({ kind: "evidence", eventId: "command-3" }) }),
      expect.objectContaining({ code: "ls.session.recovering", affected: expect.objectContaining({ kind: "session", sessionId: "S-1" }) }),
      expect.objectContaining({ code: "ls.subscription.error", affected: expect.objectContaining({ kind: "evidence", eventId: "subscription-error-1" }) })
      ,expect.objectContaining({
        code: "ls.client.server-error",
        severity: "warning",
        originalCode: -7,
        safeMessage: "Application denied the operation",
        affected: { kind: "session", pageId: "page-1", clientId: "client-main", sessionId: "S-1" }
      }),
      expect.objectContaining({
        code: "ls.client.server-keepalive",
        severity: "information",
        observed: expect.stringContaining("4 keepalive callbacks"),
        consequence: expect.stringContaining("not prove")
      })
    ]));
    expect(JSON.stringify(observations)).not.toContain("private source text");
    expect(JSON.stringify(observations)).not.toContain("PRIVATE-COMMAND-VALUE");
    expect(observations.find(({ code }) => code === "ls.subscription.error")?.originalCode).toBe(41);
    runtime.dispose();
  });

  it("keeps Notifications across Evidence Scopes with exact affected runtime identities", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [
        topologyEvent("client-one", "client-created", {
          client: { id: "client-1", status: "CONNECTED:WS-STREAMING", sessionId: "S-1" },
          subscription: undefined,
          item: undefined,
          listener: undefined,
          update: undefined
        }),
        topologyEvent("client-one-error", "server-error", {
          client: { id: "client-1", status: "CONNECTED:WS-STREAMING", sessionId: "S-1" },
          subscription: undefined,
          item: undefined,
          listener: undefined,
          update: undefined,
          topology: { version: 1, kind: "server-error", pageEpoch: "page-exact", captureSequence: 2, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
          serverError: { code: 7, messageState: "unavailable" }
        }),
        topologyEvent("client-ten", "client-created", {
          client: { id: "client-10", status: "CONNECTED:WS-STREAMING", sessionId: "S-10" },
          subscription: undefined,
          item: undefined,
          listener: undefined,
          update: undefined
        })
      ]
    });
    const runtime = createWorkbenchRuntime({ history, capture: { coverage: "USEFUL" } });
    await flushStoreNotifications();
    const clientTen = runtime.getSnapshot().scope.nodes.find((node) =>
      node.kind === "client" && node.label.includes("client-10")
    );
    expect(clientTen).toBeDefined();

    runtime.dispatch({ type: "set-scope", scopeId: clientTen!.id });

    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "ls.client.server-error", affected: "Session S-1" })
    );
    expect(runtime.getSnapshot().notifications.entries).toContainEqual(
      expect.objectContaining({ code: "ls.client.server-error", affected: "Session S-1" })
    );
    const sessionOne = runtime.getSnapshot().scope.nodes.find((node) =>
      node.kind === "session" && node.label.includes("S-1") && !node.label.includes("S-10")
    );
    expect(sessionOne).toBeDefined();
    runtime.dispatch({ type: "open-notifications" });
    runtime.dispatch({ type: "inspect-diagnostic-affected", affected: { kind: "session", pageId: "page-exact", clientId: "client-1", sessionId: "S-1" } });
    await flushStoreNotifications();
    expect(runtime.getSnapshot()).toMatchObject({ scopeId: sessionOne!.id, contextId: "context:scope-dossier" });
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).not.toContain("client-ten");
    expect(runtime.getSnapshot().notifications.entries).toContainEqual(
      expect.objectContaining({ code: "ls.client.server-error", affected: "Session S-1" })
    );
    runtime.dispose();
  });

  it("bounds recent Notifications and preserves the investigation across filters and return", async () => {
    const scenario = getWorkbenchScenario("notifications-volume");
    const history = createInMemoryEventHistory({ panelSessionId: "notifications-restoration" });
    await Promise.all(scenario.initialEvents.map((event) => history.offer(event).settled));
    const runtime = createWorkbenchRuntime({ history, capture: { coverage: "USEFUL" } });
    await flushStoreNotifications();
    const notifications = runtime.getSnapshot().notifications;
    expect(notifications.total).toBe(100);
    expect(notifications.entries).toHaveLength(100);
    expect(notifications.entries[0]?.route).toMatchObject({ kind: "inspect-evidence", evidence: { eventId: "notification-snapshot-51" } });
    expect(runtime.getSnapshot().diagnostics.some(({ title }) => title === "Snapshot completed")).toBe(false);
    runtime.dispatch({ type: "select-evidence", eventId: "notification-snapshot-100" });
    runtime.dispatch({ type: "open-context" });
    applyTextFilter(runtime, "notification-snapshot-100");
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-find", value: "snapshot" });
    runtime.dispatch({ type: "freeze-evidence" });
    runtime.dispatch({ type: "set-evidence-scroll", scrollTop: 90 });
    const before = runtime.getSnapshot();

    runtime.dispatch({ type: "open-notifications" });
    runtime.dispatch({ type: "open-notifications" });
    runtime.dispatch({ type: "apply-diagnostic-filter", facet: "diagnosticSeverity", value: diagnosticSeverityFacetValue("information"), polarity: "exclude" });
    expect(runtime.getSnapshot().notifications.entries).toEqual([]);
    expect(runtime.getSnapshot().notifications.total).toBe(100);
    expect(runtime.getSnapshot().evidence).toEqual(before.evidence);
    runtime.dispatch({ type: "close-notifications" });
    expect(runtime.getSnapshot()).toMatchObject({ contextId: before.contextId, scopeId: before.scopeId, selectionEventId: before.selectionEventId });
    expect(runtime.getSnapshot().evidence).toEqual(before.evidence);

    runtime.dispatch({ type: "open-notifications" });
    runtime.dispatch({ type: "reset-diagnostic-filter" });
    await Promise.all(scenario.deferredEvents!.map((event) => history.offer(event).settled));
    await flushStoreNotifications();
    const route = notifications.entries[0]!.route!;
    if (route.kind !== "inspect-evidence") throw new Error("Snapshot completion requires supporting Evidence.");
    runtime.dispatch({ type: "inspect-diagnostic-evidence", evidence: route.evidence });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().selectionEventId).toBe("notification-snapshot-51");
    expect(runtime.getSnapshot().evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    // Reopening from the inspected record must not replace an older page's return target.
    runtime.dispatch({ type: "open-notifications" });
    runtime.dispatch({ type: "back-investigation" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot()).toMatchObject({ contextId: "notifications", selectionEventId: before.selectionEventId });
    runtime.dispatch({ type: "close-notifications" });
    expect(runtime.getSnapshot().contextId).toBe(before.contextId);
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().notifications).toMatchObject({ entries: [], total: 0 });
    runtime.dispose();
  });

  it("retains one active condition when more than 100 occurrence notices arrive", async () => {
    const scenario = getWorkbenchScenario("notifications-volume");
    const history = createInMemoryEventHistory({ panelSessionId: "notifications-active-condition-cap" });
    await Promise.all(scenario.initialEvents.map((candidate) => history.offer(candidate).settled));
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "notifications-active-condition-cap" });
    const runtime = createWorkbenchRuntime({
      history,
      diagnosticObservations,
      captureStatus: "bridge disconnected",
      capture: { coverage: "USEFUL" }
    });
    await flushStoreNotifications();

    const disconnected = runtime.getSnapshot().diagnostics.find(({ title }) => title === "Capture disconnected");
    expect(disconnected?.dismissalId).toBe("capture:bridge-disconnected:error");
    runtime.dispatch({ type: "dismiss-diagnostic", dismissalId: disconnected!.dismissalId! });
    await Promise.all((scenario.deferredEvents ?? []).map((candidate) => history.offer(candidate).settled));
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    expect(runtime.getSnapshot().notifications).toMatchObject({ total: 100, limit: 100 });
    expect(runtime.getSnapshot().notifications.entries.filter(({ code }) => code === "workbench.capture.disconnected"))
      .toEqual([expect.objectContaining({ dismissalId: "capture:bridge-disconnected:error" })]);
    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(expect.objectContaining({ code: "workbench.capture.disconnected" }));
    const disconnectedObservations = (await diagnosticObservations.query({ codes: ["workbench.capture.disconnected"] })).observations;
    expect(disconnectedObservations).toHaveLength(3);
    expect(disconnectedObservations.filter(({ affected, lifecycle }) =>
      affected.kind === "page" && lifecycle.kind === "condition" && lifecycle.state === "active"
    )).toHaveLength(1);
    runtime.dispose();
  });

  it("routes supporting Evidence authoritatively after more than 256 later events", async () => {
    const deepError = topologyEvent("deep-server-error", "server-error", {
      subscription: undefined,
      item: undefined,
      update: undefined,
      topology: { version: 1, kind: "server-error", pageEpoch: "page-deep", captureSequence: 1, provenance: { instrumentationSource: "official-public-api" }, coverage: { status: "complete", getters: {} } },
      serverError: { code: 41, messageState: "redacted" }
    });
    const later = Array.from({ length: 300 }, (_, index) => ({
      ...event(`later-${index + 1}`, `item-${index + 1}`),
      timestamp: 2_000 + index
    }));
    const runtime = createWorkbenchRuntime({
      history: createAuthoritativeHistory({ precommitted: [deepError, ...later] }),
      capture: { coverage: "USEFUL" }
    });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();
    const diagnostic = runtime.getSnapshot().notifications.entries.find(({ code }) => code === "ls.client.server-error");
    expect(diagnostic?.route).toMatchObject({
      kind: "inspect-evidence",
      evidence: expect.objectContaining({ eventId: "deep-server-error", sequence: 1 })
    });

    runtime.dispatch({ type: "inspect-diagnostic-evidence", evidence: diagnostic?.route?.kind === "inspect-evidence" ? diagnostic.route.evidence : undefined } as never);
    await flushStoreNotifications();

    expect(runtime.getSnapshot()).toMatchObject({
      scopeId: "page",
      selectionEventId: "deep-server-error",
      contextId: "context:deep-server-error",
      selectedEvidence: { id: "deep-server-error" }
    });
    runtime.dispose();
  });

  it("records and resolves source conditions while hidden", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "hidden-diagnostics" });
    const runtime = createWorkbenchRuntime({
      visible: false,
      capture: { coverage: "USEFUL" },
      diagnosticObservations
    });
    runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" });
    runtime.dispatch({ type: "set-capture-status", status: "bridge connected" });
    await runtime.settleDiagnosticObservations?.();

    expect((await diagnosticObservations.query({ codes: ["workbench.capture.disconnected"] })).observations)
      .toEqual([
        expect.objectContaining({ affected: { kind: "unavailable", reason: "page-identity-unavailable" }, lifecycle: expect.objectContaining({ state: "active" }) }),
        expect.objectContaining({ affected: { kind: "unavailable", reason: "page-identity-unavailable" }, lifecycle: expect.objectContaining({ state: "resolved" }) })
      ]);
    runtime.dispose();
  });

  it("keeps a footer dismissal while the same active condition gains an exact page identity", async () => {
    const history = createAuthoritativeHistory();
    const runtime = createWorkbenchRuntime({
      history,
      capture: {
        coverage: "LIMITED",
        detail: "Capture attached after the Subscription began."
      }
    });
    await flushStoreNotifications();

    const coverage = runtime.getSnapshot().diagnostics.find(({ title }) => title === "Coverage LIMITED");
    expect(coverage?.dismissalId).toBe("capture:coverage:limited");
    runtime.dispatch({ type: "dismiss-diagnostic", dismissalId: coverage!.dismissalId! });
    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(expect.objectContaining({ title: "Coverage LIMITED" }));

    const identityFrame = getPanelScenario("topology-large").topologySyncFrames?.[0];
    if (!identityFrame) throw new Error("Topology identity-refinement frame is unavailable.");
    runtime.dispatch({ type: "apply-topology-sync-frame", frame: identityFrame });
    await runtime.settleDiagnosticObservations?.();

    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(expect.objectContaining({ title: "Coverage LIMITED" }));
    expect(runtime.getSnapshot().notifications.entries.filter(({ code }) => code === "workbench.capture.coverage-limited"))
      .toEqual([expect.objectContaining({ affectedIdentity: { kind: "page", pageId: identityFrame.pageEpoch } })]);
    runtime.dispose();
  });

  it("journals each committed Session transition even when presentation is coalesced while hidden", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "hidden-session-diagnostics" });
    const history = createAuthoritativeHistory();
    const runtime = createWorkbenchRuntime({
      history,
      visible: false,
      capture: { coverage: "USEFUL" },
      diagnosticObservations
    });
    await flushStoreNotifications();
    await history.offer(topologyEvent("recovery-start-1", "client-status", {
      client: { id: "client-main", status: "DISCONNECTED:TRYING-RECOVERY", sessionId: "S-1" },
      subscription: undefined,
      item: undefined,
      listener: undefined,
      update: undefined
    })).settled;
    await history.offer(topologyEvent("recovery-complete-2", "client-status", {
      client: { id: "client-main", status: "DISCONNECTED" },
      subscription: undefined,
      item: undefined,
      listener: undefined,
      update: undefined
    })).settled;
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    expect((await diagnosticObservations.query({ codes: ["ls.session.recovering"] })).observations)
      .toEqual([
        expect.objectContaining({ lifecycle: expect.objectContaining({ state: "active" }) }),
        expect.objectContaining({ lifecycle: expect.objectContaining({ state: "resolved" }) })
      ]);
    runtime.dispose();
  });

  it("does not advance the diagnostic boundary for replayed conditions or transient Activity availability", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "replayed-session-diagnostics" });
    const baseHistory = createAuthoritativeHistory();
    const committed: Extract<HistoryPublication, { type: "committed-evidence" }>[] = [];
    let follower: ((publication: HistoryPublication) => void) | null = null;
    const history: EventHistory = {
      ...baseHistory,
      follow: (options, observer) => {
        follower = observer;
        return baseHistory.follow(options, (publication) => {
          if (publication.type === "committed-evidence") committed.push(publication);
          observer(publication);
        });
      }
    };
    const runtime = createWorkbenchRuntime({
      history,
      capture: { coverage: "USEFUL" },
      diagnosticObservations,
      activityProjectionFactory: (input) => {
        if (input.coherent) throw new Error("aggregation unavailable");
        return createActivityProjection(input);
      }
    });
    await flushStoreNotifications();
    await history.offer(topologyEvent("replay-recovery-1", "client-status", {
      client: { id: "client-main", status: "DISCONNECTED:TRYING-RECOVERY", sessionId: "S-1" },
      subscription: undefined,
      item: undefined,
      listener: undefined,
      update: undefined
    })).settled;
    await history.offer(topologyEvent("replay-complete-2", "client-status", {
      client: { id: "client-main", status: "DISCONNECTED" },
      subscription: undefined,
      item: undefined,
      listener: undefined,
      update: undefined
    })).settled;
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();
    const beforeReplay = diagnosticObservations.currentBoundary();
    const status = history.status();
    const publishReplay = (publication: HistoryPublication): void => {
      if (!follower) throw new Error("History follower is unavailable.");
      follower(publication);
    };

    publishReplay({ type: "replay-started", interval: status.interval, after: null, retainedRange: status.retainedRange });
    publishReplay(committed[0]!);
    runtime.dispatch({ type: "set-theme", theme: "dark" });
    publishReplay(committed[1]!);
    publishReplay({ type: "replay-complete", interval: status.interval, committedEvidenceBoundary: status.committedEvidenceBoundary });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    expect(diagnosticObservations.currentBoundary()).toEqual(beforeReplay);
    runtime.dispose();
  });

  it("atomically adopts the replay diagnostic producer before later snapshot Evidence", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "replayed-subscription-diagnostics" });
    const history = createAuthoritativeHistory({
      precommitted: [
        {
          kind: "topology-checkpoint",
          id: "checkpoint-before-snapshot",
          checkpoint: {
            pageEpoch: "page-replay",
            coverage: { status: "complete", getters: {} },
            records: [{
              kind: "subscription",
              id: "subscription-1",
              clientId: "client-1",
              pageEpoch: "page-replay",
              captureSequence: 1
            }]
          }
        },
        {
          ...event("snapshot-1", "prices"),
          update: { isSnapshot: true, fields: { value: "one" } }
        },
        {
          ...event("live-before-end-2", "prices"),
          update: { isSnapshot: false, fields: { value: "two" } }
        }
      ]
    });
    const runtime = createWorkbenchRuntime({ history, capture: { coverage: "USEFUL" }, diagnosticObservations });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    await history.offer({
      ...event("end-after-replay-3", "prices"),
      kind: "end-of-snapshot",
      update: undefined
    }).settled;
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    const phase = (await diagnosticObservations.query({ codes: ["ls.subscription.snapshot.phase-incomplete"] })).observations;
    expect(phase).toEqual([
      expect.objectContaining({
        lifecycle: expect.objectContaining({ state: "active" }),
        affected: { kind: "item", pageId: "page-replay", clientId: "client-1", subscriptionId: "subscription-1", item: "prices" }
      }),
      expect.objectContaining({ lifecycle: expect.objectContaining({ state: "resolved" }), evidenceBoundary: expect.objectContaining({ eventId: "end-after-replay-3" }) })
    ]);
    expect((await diagnosticObservations.query({ codes: ["ls.subscription.snapshot.completed"] })).observations).toHaveLength(1);
    runtime.dispose();
  });

  it("reconciles configuration and topology Notifications from committed immutable latches", async () => {
    const diagnosticObservations = createMemoryDiagnosticObservationJournal({ panelSessionId: "topology-latch-diagnostics" });
    const client = { id: "lint-client", status: "CONNECTED:WS-STREAMING", sessionId: "lint-session", adapterSet: "LINT_ADAPTERS" };
    const topology = (kind: LightstreamerEventEnvelope["kind"], captureSequence: number) => ({
      version: 1 as const,
      kind,
      pageEpoch: "lint-page",
      captureSequence,
      provenance: { instrumentationSource: "official-public-api" as const },
      coverage: { status: "complete" as const, getters: {} }
    });
    const configured = (id: string, mode: "MERGE" | "RAW", captureSequence: number): LightstreamerEventEnvelope => ({
      id,
      timestamp: 1_000 + captureSequence,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "subscription-started",
      client,
      subscription: {
        id,
        mode,
        items: ["prices"],
        fields: ["price"],
        dataAdapter: "QUOTE_ADAPTER",
        selector: null,
        requestedSnapshot: "yes",
        requestedBufferSize: null,
        requestedMaxFrequency: null,
        commandSecondLevelFields: undefined,
        commandSecondLevelFieldSchema: null,
        commandSecondLevelDataAdapter: null,
        active: true,
        subscribed: true
      },
      topology: topology("subscription-started", captureSequence),
      raw: { callback: "onSubscription" }
    });
    const history = createAuthoritativeHistory({ precommitted: [
      {
        id: "lint-client-status",
        timestamp: 1_000,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "client-status",
        client,
        topology: topology("client-status", 1)
      },
      configured("duplicate-a", "MERGE", 2),
      configured("duplicate-b", "MERGE", 3),
      configured("raw-subscription", "RAW", 4),
      {
        id: "duplicate-b-ended",
        timestamp: 1_005,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "subscription-ended",
        client,
        subscription: { id: "duplicate-b" },
        topology: topology("subscription-ended", 5)
      },
      {
        id: "post-duplicate-boundary",
        timestamp: 1_006,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "client-status",
        client,
        topology: topology("client-status", 6)
      }
    ] });
    const runtime = createWorkbenchRuntime({ history, capture: { coverage: "USEFUL" }, diagnosticObservations });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();
    const observations = (await diagnosticObservations.query()).observations;
    expect(observations.filter(({ code, lifecycle }) => code === "ls.subscription.exact-duplicate" && lifecycle.kind === "condition" && lifecycle.state === "active")).toHaveLength(1);
    expect(observations.filter(({ code, lifecycle }) => code === "ls.subscription.exact-duplicate" && lifecycle.kind === "condition" && lifecycle.state === "resolved")).toHaveLength(1);
    expect(observations.filter(({ code, lifecycle }) => code === "ls.subscription.exact-duplicate" && lifecycle.kind === "occurrence")).toHaveLength(1);
    expect(observations).toContainEqual(expect.objectContaining({
      code: "ls.sub.raw-snapshot-unavailable",
      affected: expect.objectContaining({ kind: "subscription", subscriptionId: "raw-subscription" })
    }));
    expect(runtime.getSnapshot().diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.subscription.exact-duplicate" })
    ]));
    const initialDiagnosticFilter: WorkbenchSnapshot["notifications"]["filter"] = runtime.getSnapshot().notifications.filter;
    const initialSeverityOptionIds = initialDiagnosticFilter.options.diagnosticSeverity.map(({ value }) => value.identity);
    const initialAffectedOptionIds = initialDiagnosticFilter.options.diagnosticAffected.map(({ value }) => value.identity);
    expect(initialDiagnosticFilter.options.diagnosticCode.map(({ value }) => value.label)).toEqual(expect.arrayContaining([
      "ls.subscription.exact-duplicate",
      "ls.sub.raw-snapshot-unavailable"
    ]));
    runtime.dispatch({
      type: "apply-diagnostic-filter",
      facet: "diagnosticCode",
      value: diagnosticCodeFacetValue("ls.subscription.exact-duplicate"),
      polarity: "include"
    } as never);
    expect(runtime.getSnapshot().notifications.filter.options.diagnosticCode.map(({ value }) => value.label))
      .toEqual(expect.arrayContaining(["ls.subscription.exact-duplicate", "ls.sub.raw-snapshot-unavailable"]));
    expect(runtime.getSnapshot().notifications.filter.options.diagnosticSeverity.map(({ value }) => value.identity))
      .toEqual(initialSeverityOptionIds);
    expect(runtime.getSnapshot().notifications.filter.options.diagnosticAffected.map(({ value }) => value.identity))
      .toEqual(initialAffectedOptionIds);
    runtime.dispatch({
      type: "apply-diagnostic-filter",
      facet: "diagnosticCode",
      value: diagnosticCodeFacetValue("ls.sub.raw-snapshot-unavailable"),
      polarity: "include"
    } as never);
    expect(runtime.getSnapshot().notifications.entries.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ls.subscription.exact-duplicate",
      "ls.sub.raw-snapshot-unavailable"
    ]));
    runtime.dispatch({
      type: "apply-diagnostic-filter",
      facet: "diagnosticSeverity",
      value: diagnosticSeverityFacetValue("error"),
      polarity: "include"
    } as never);
    expect(runtime.getSnapshot().notifications.entries).toEqual([]);
    runtime.dispatch({
      type: "remove-diagnostic-filter",
      facet: "diagnosticSeverity",
      value: diagnosticSeverityFacetValue("error"),
      polarity: "include"
    } as never);
    expect(runtime.getSnapshot().notifications.entries.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ls.subscription.exact-duplicate",
      "ls.sub.raw-snapshot-unavailable"
    ]));
    runtime.dispatch({
      type: "remove-diagnostic-filter",
      facet: "diagnosticCode",
      value: diagnosticCodeFacetValue("ls.subscription.exact-duplicate"),
      polarity: "include"
    } as never);
    expect(runtime.getSnapshot().notifications.entries.map(({ code }) => code)).not.toContain("ls.subscription.exact-duplicate");
    runtime.dispatch({ type: "reset-diagnostic-filter" } as never);
    const rawScope = runtime.getSnapshot().scope.nodes.find(({ kind, label }) => kind === "subscription" && label.includes("raw-subscription"));
    expect(rawScope).toBeDefined();
    runtime.dispatch({ type: "set-scope", scopeId: rawScope?.id ?? null });
    expect(runtime.getSnapshot().diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.sub.raw-snapshot-unavailable" })
    ]));
    expect(runtime.getSnapshot().notifications.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.sub.raw-snapshot-unavailable" })
    ]));
    runtime.dispatch({
      type: "apply-diagnostic-filter",
      facet: "diagnosticCode",
      value: diagnosticCodeFacetValue("ls.sub.raw-snapshot-unavailable"),
      polarity: "exclude"
    } as never);
    expect(runtime.getSnapshot().notifications.entries).not.toContainEqual(expect.objectContaining({ code: "ls.sub.raw-snapshot-unavailable" }));
    runtime.dispatch({ type: "reset-diagnostic-filter" } as never);
    expect(runtime.getSnapshot().notifications.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.sub.raw-snapshot-unavailable" })
    ]));

    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();
    expect((await diagnosticObservations.query()).observations).toEqual([]);
    expect(runtime.getSnapshot().diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ls.subscription.exact-duplicate" }),
      expect.objectContaining({ code: "ls.sub.raw-snapshot-unavailable" })
    ]));
    expect(runtime.getSnapshot().notifications.entries).toEqual([]);
    runtime.dispose();
  });

  it("fails closed and exposes settlement failure when a normalized mutation cannot commit", async () => {
    const memory = createMemoryDiagnosticObservationJournal({ panelSessionId: "failed-diagnostics" });
    const failure = new Error("diagnostic persistence unavailable");
    const diagnosticObservations = {
      ...memory,
      observe: async () => { throw failure; }
    };
    const runtime = createWorkbenchRuntime({
      capture: { coverage: "USEFUL" },
      diagnosticObservations
    });
    runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" });

    await expect(runtime.settleDiagnosticObservations?.()).rejects.toThrow(failure.message);
    expect(await memory.query()).toMatchObject({ status: "closed", coverage: "unavailable" });
    runtime.dispose();
  });

  it("advances the diagnostic journal exactly once for one authoritative History Clear", async () => {
    const memory = createMemoryDiagnosticObservationJournal({ panelSessionId: "single-diagnostic-clear" });
    const clear = vi.fn(memory.clear);
    const diagnosticObservations = { ...memory, clear };
    const publications: Array<{ type: string; status?: string }> = [];
    const unsubscribe = memory.subscribe(memory.currentBoundary(), (publication) => publications.push(publication));
    const runtime = createWorkbenchRuntime({
      history: createAuthoritativeHistory({ precommitted: [event("before-single-clear")] }),
      capture: { coverage: "USEFUL" },
      diagnosticObservations
    });
    await flushStoreNotifications();

    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();
    await runtime.settleDiagnosticObservations?.();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(publications.filter(({ type, status }) => type === "status" && status === "cleared")).toHaveLength(1);
    expect(memory.currentBoundary()).toMatchObject({ sequence: 0 });
    unsubscribe();
    runtime.dispose();
  });

  it("fails closed instead of continuing the prior diagnostic interval when Clear cannot commit", async () => {
    const memory = createMemoryDiagnosticObservationJournal({ panelSessionId: "failed-diagnostic-clear" });
    const failure = new Error("diagnostic clear unavailable");
    const diagnosticObservations = {
      ...memory,
      clear: async () => { throw failure; }
    };
    const runtime = createWorkbenchRuntime({
      history: createAuthoritativeHistory({ precommitted: [event("before-clear")] }),
      capture: { coverage: "USEFUL" },
      diagnosticObservations
    });
    await flushStoreNotifications();
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();

    await expect(runtime.settleDiagnosticObservations?.()).rejects.toThrow(failure.message);
    expect(await memory.query()).toMatchObject({ status: "closed", coverage: "unavailable" });
    runtime.dispose();
  });

  it("exposes authoritative history capacity status instead of a generic warning threshold", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().retention.historyStatus).toMatchObject({
      captured: 0,
      accepted: 0,
      notAccepted: 0,
      retained: 0,
      capacity: { tier: "NORMAL", state: "AVAILABLE" }
    });
    expect(runtime.getSnapshot().retention).not.toHaveProperty("warningThreshold");

    history.offer(event("authoritative-status-1"));
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().retention.historyStatus).toMatchObject({
      captured: 1,
      accepted: 1,
      retained: 1,
      capacity: { state: "AVAILABLE" }
    });
    runtime.dispose();
  });

  it("keeps getSnapshot and subscribe callback-safe for useSyncExternalStore", async () => {
    const runtime = createWorkbenchRuntime();
    await flushStoreNotifications();
    const getSnapshot = runtime.getSnapshot;
    const subscribe = runtime.subscribe;
    let notifications = 0;
    const unsubscribe = subscribe(() => {
      notifications += 1;
    });

    expect(getSnapshot()).toBe(runtime.getSnapshot());
    runtime.dispatch({ type: "set-theme", theme: "dark" });
    expect(notifications).toBe(1);

    unsubscribe();
    runtime.dispose();
  });

  it("exposes one cached immutable bounded Evidence snapshot and publishes developer commands synchronously", async () => {
    const history = createAuthoritativeHistory();
    for (let index = 1; index <= 62; index += 1) {
      history.offer(event(`event-${index}`));
    }

    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const initial = runtime.getSnapshot();
    const notifications: number[] = [];
    runtime.subscribe(() => notifications.push(runtime.getSnapshot().version));

    expect(runtime.getSnapshot()).toBe(initial);
    expect(initial.evidence.total).toBe(62);
    expect(initial.evidence.events).toHaveLength(60);
    expect(initial.evidence.events[0]?.id).toBe("event-3");
    expect(initial.evidence.events.at(-1)?.id).toBe("event-62");
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.evidence.events)).toBe(true);

    const clientScope = initial.scope.nodes.find(
      ({ kind, label }) => kind === "client" && label === "client-1"
    );
    runtime.dispatch({ type: "set-scope", scopeId: clientScope?.id ?? null });
    runtime.dispatch({ type: "select-evidence", eventId: "event-17" });
    runtime.dispatch({ type: "set-context", contextId: "context:event-17" });
    runtime.dispatch({ type: "set-find", value: "event-17" });
    await flushStoreNotifications();

    const selected = runtime.getSnapshot();
    expect(notifications).toHaveLength(5);
    expect(selected).not.toBe(initial);
    expect(selected.scopeId).toBe(clientScope?.id);
    expect(selected.selectionEventId).toBe("event-17");
    expect(selected.contextId).toBe("context:event-17");
    expect(selected.evidence.find).toBe("event-17");

    runtime.dispose();
  });

  it("publishes async Scope, Filter, Freeze, and Follow intent synchronously and rejects stale query results", async () => {
    let deferBounded = false;
    const pending: Array<{ resolve(): void }> = [];
    const history = createAuthoritativeHistory({
      readControl(query, release) {
        if (!deferBounded || query.limit === undefined) release();
        else pending.push({ resolve: release });
      }
    });
    appendTopologyJourney(
      history,
      {
        clientId: "async-client",
        sessionId: "async-session",
        subscriptionId: "async-sub",
        itemName: "async-item",
        listenerId: "async-listener"
      },
      50
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "subscription");
    const versions: number[] = [];
    runtime.subscribe(() => versions.push(runtime.getSnapshot().version));
    deferBounded = true;

    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });
    expect(runtime.getSnapshot().scopeId).toBe(scope?.id);
    applyItemFilter(runtime, "async-item");
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria.item?.include[0]?.value).toEqual(JSON.stringify(["async-item", null]));
    runtime.dispatch({ type: "freeze-evidence" });
    expect(runtime.getSnapshot().evidence.mode).toBe("frozen");
    runtime.dispatch({ type: "follow-live" });
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(versions).toHaveLength(4);
    expect(pending).toHaveLength(4);

    pending[2]?.resolve();
    pending[0]?.resolve();
    pending[1]?.resolve();
    await flushStoreNotifications();
    expect(versions).toHaveLength(4);
    expect(runtime.getSnapshot().evidence.mode).toBe("live");

    pending[3]?.resolve();
    await flushStoreNotifications();
    expect(versions).toHaveLength(5);
    expect(runtime.getSnapshot().scopeId).toBe(scope?.id);
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria.item?.include[0]?.value).toEqual(JSON.stringify(["async-item", null]));
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "async-client-55"
    ]);
    runtime.dispose();
  });

  it("publishes no stale Evidence beneath a new Scope or Filter while delayed queries settle", async () => {
    let deferBounded = false;
    const pending: Array<{ resolve(): void }> = [];
    const history = createAuthoritativeHistory({
      readControl(query, release) {
        if (!deferBounded || query.limit === undefined) release();
        else pending.push({ resolve: release });
      }
    });
    appendTopologyJourney(
      history,
      {
        clientId: "delayed-client-a",
        sessionId: "delayed-session-a",
        subscriptionId: "delayed-sub-a",
        itemName: "alpha-item",
        listenerId: "delayed-listener-a"
      },
      100
    );
    appendTopologyJourney(
      history,
      {
        clientId: "delayed-client-b",
        sessionId: "delayed-session-b",
        subscriptionId: "delayed-sub-b",
        itemName: "beta-item",
        listenerId: "delayed-listener-b"
      },
      200
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const clientB = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "client" && label === "delayed-client-b");
    runtime.dispatch({ type: "select-evidence", eventId: "delayed-client-b-205" });
    runtime.dispatch({ type: "open-context" });
    deferBounded = true;

    runtime.dispatch({ type: "set-scope", scopeId: clientB?.id ?? null });
    expect(runtime.getSnapshot().scope.label).toBe("Inspected page › delayed-client-b");
    expect(runtime.getSnapshot().evidence).toMatchObject({
      loading: true,
      events: [],
      total: 0,
      visibleStart: 0,
      visibleEnd: 0
    });
    expect(runtime.getSnapshot()).toMatchObject({
      selectionEventId: "delayed-client-b-205",
      selectedEvidence: { id: "delayed-client-b-205" },
      context: { kind: "evidence", title: "delayed-client-b-205 · Item Update" }
    });
    pending.shift()?.resolve();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.loading).toBe(false);
    expect(runtime.getSnapshot().evidence.events).not.toHaveLength(0);
    expect(
      runtime.getSnapshot().evidence.events.every(({ raw }) => raw.client?.id === "delayed-client-b")
    ).toBe(true);

    applyItemFilter(runtime, "beta-item");
    expect(runtime.getSnapshot().evidence).toMatchObject({
      loading: true,
      events: [],
      total: 0,
    });
    pending.shift()?.resolve();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.loading).toBe(false);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "delayed-client-b-205"
    ]);
    runtime.dispose();
  });

  it("coalesces live Capture behind an in-flight identity query without leaving Evidence loading", async () => {
    let deferBounded = false;
    const pending: Array<{ resolve(): void }> = [];
    const history = createAuthoritativeHistory({
      readControl(query, release) {
        if (!deferBounded || query.limit === undefined) release();
        else pending.push({ resolve: release });
      }
    });
    appendTopologyJourney(
      history,
      {
        clientId: "streaming-client",
        sessionId: "streaming-session",
        subscriptionId: "streaming-subscription",
        itemName: "streaming-item",
        listenerId: "streaming-listener"
      },
      100
    );
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const client = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "client" && label === "streaming-client");
    deferBounded = true;
    runtime.dispatch({ type: "set-scope", scopeId: client?.id ?? null });
    expect(runtime.getSnapshot().evidence.loading).toBe(true);

    history.offer({
      ...event("streaming-client-106", "streaming-item"),
      client: {
        id: "streaming-client",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "streaming-session"
      },
      subscription: {
        id: "streaming-subscription",
        mode: "MERGE",
        items: ["streaming-item"],
        active: true,
        subscribed: true
      },
      listener: { id: "streaming-listener", callbacks: ["onItemUpdate"] }
    });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();
    expect(pending).toHaveLength(1);
    pending.shift()?.resolve();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.loading).toBe(false);
    const resolvedEventIds = runtime.getSnapshot().evidence.events.map(({ id }) => id);
    expect(resolvedEventIds).not.toHaveLength(0);
    scheduler.flushFrame();
    await flushStoreNotifications();
    expect(pending).toHaveLength(1);
    runtime.dispatch({ type: "set-theme", theme: "dark" });
    expect(runtime.getSnapshot().evidence.loading).toBe(false);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(resolvedEventIds);
    pending.shift()?.resolve();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toContain("streaming-client-106");
    runtime.dispose();
  });

  it("batches passive Capture publications into one frame while retaining the newest matching window", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const initial = runtime.getSnapshot();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    history.offer(event("event-1"));
    history.offer(event("event-2"));
    await flushStoreNotifications();

    expect(runtime.getSnapshot()).toBe(initial);
    expect(scheduler.frameCount()).toBe(1);
    expect(scheduler.fallbackCount()).toBe(1);

    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(notifications).toBe(1);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "event-1",
      "event-2"
    ]);
    expect(runtime.getSnapshot().evidence.total).toBe(2);
    expect(scheduler.fallbackCount()).toBe(0);

    runtime.dispose();
  });

  it("preserves presentation identity for unchanged retained Evidence rows", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    history.offer(event("event-1"));
    history.offer(event("event-2"));
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const firstPresentation = runtime.getSnapshot().evidence.events[0];

    history.offer(event("event-3"));
    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.events[0]).toBe(firstPresentation);
    runtime.dispose();
  });

  it("coalesces direct Capture notifications to render cadence without losing deliveries", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    for (let delivery = 1; delivery <= 3; delivery += 1) {
      runtime.dispatch({
        type: "ingest-capture-message",
        message: createCaptureMessage("item-update", {
          logicalEventId: "logical-1",
          client: { id: "client-capture" },
          subscription: { id: "capture-subscription", mode: "MERGE" },
          listener: { id: `listener-${delivery}`, metricOwner: delivery === 1 },
          item: { name: "captured-item", position: 1 },
          update: { fields: { value: 7 }, changedFields: { value: 7 } }
        })
      });
    }
    await flushStoreNotifications();

    const retained = await history.read({});
    expect(retained).toMatchObject({ ok: true, value: { total: 3 } });
    expect(notifications).toBe(0);
    expect(scheduler.frameCount()).toBe(1);

    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(notifications).toBe(1);
    expect(runtime.getSnapshot().evidence.total).toBe(3);
    if (!retained.ok) return;
    expect(
      retained.value.evidence.map(({ candidate }) =>
        candidate.kind === "topology-checkpoint" ? null : candidate.listener?.id
      )
    ).toEqual(["listener-1", "listener-2", "listener-3"]);
    runtime.dispose();
  });

  it("reuses unchanged structural Scope nodes while refreshing volatile counter presentations", async () => {
    const history = createAuthoritativeHistory();
    history.offer(topologyEvent("client-1", "client-created"));
    history.offer(topologyEvent("session-1", "client-status"));
    history.offer(topologyEvent("subscription-1", "subscription-started"));
    history.offer(topologyEvent("listener-1", "listener-added"));
    history.offer(topologyEvent("update-1", "item-update"));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
    await flushStoreNotifications();
    const initialScope = runtime.getSnapshot().scope;
    const structuralNodes = initialScope.structure;
    const initialFacts = initialScope.nodes;

    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage("item-update", {
        client: { id: "client-main", status: "CONNECTED:WS-STREAMING", sessionId: "S-1" },
        subscription: { id: "orders-subscription", mode: "COMMAND", items: ["orders"], active: true, subscribed: true },
        listener: { id: "orders-listener", callbacks: ["onItemUpdate"] },
        item: { name: "orders", position: 1 },
        update: { isSnapshot: false, fields: { value: 2 }, changedFields: { value: 2 } }
      })
    });
    scheduler.flushFrame();
    await flushStoreNotifications();

    const refreshedScope = runtime.getSnapshot().scope;
    const refreshedNodes = refreshedScope.nodes;
    expect(refreshedScope.structure).toBe(structuralNodes);
    expect(refreshedScope.structureRevision).toBe(initialScope.structureRevision);
    expect(refreshedNodes).not.toBe(initialFacts);
    expect(refreshedNodes.map(({ id }) => id)).toEqual(initialFacts.map(({ id }) => id));
    expect(refreshedNodes.find(({ kind }) => kind === "subscription")?.detail).toContain("2 real");
    expect(refreshedNodes.find(({ kind }) => kind === "item")?.detail).toContain("2 updates");
    expect(initialFacts.find(({ kind }) => kind === "subscription")?.detail).toContain("1 real");
    expect(initialFacts.find(({ kind }) => kind === "item")?.detail).toContain("1 updates");
    runtime.dispose();
  });

  it("rebuilds ordered Scope locators when an established inactive Subscription becomes active", async () => {
    const history = createAuthoritativeHistory();
    const subscription = (
      id: string,
      active: boolean,
      timestamp: number
    ): LightstreamerEventEnvelope => ({
      ...topologyEvent(`${id}-started`, "subscription-started"),
      timestamp,
      subscription: {
        id,
        mode: "MERGE",
        items: [`item-${id}`],
        active,
        subscribed: true
      },
      item: { name: `item-${id}`, position: 1 }
    });
    history.offer(subscription("A", false, 1));
    history.offer(subscription("B", true, 2));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
    await flushStoreNotifications();
    const initialScope = runtime.getSnapshot().scope;
    expect(
      initialScope.structure
        .filter(({ kind }) => kind === "subscription")
        .map(({ label }) => label)
    ).toEqual(["B", "A"]);

    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage("item-update", {
        client: {
          id: "client-main",
          status: "CONNECTED:WS-STREAMING",
          sessionId: "S-1"
        },
        subscription: { id: "A", mode: "MERGE" },
        item: { name: "item-A", position: 1 },
        update: {
          isSnapshot: false,
          fields: { value: 1 },
          changedFields: { value: 1 }
        }
      })
    });
    scheduler.flushFrame();
    await flushStoreNotifications();

    const refreshedScope = runtime.getSnapshot().scope;
    const subscriptions = refreshedScope.structure.filter(
      ({ kind }) => kind === "subscription"
    );
    expect(refreshedScope.structureRevision).toBeGreaterThan(
      initialScope.structureRevision
    );
    expect(subscriptions.map(({ label }) => label)).toEqual(["A", "B"]);
    expect(
      subscriptions.map(({ id }) => {
        const resolved = refreshedScope.resolveNode(id);
        return [resolved?.label, resolved?.detail];
      })
    ).toEqual([
      ["A", expect.stringContaining("1 real")],
      ["B", expect.stringContaining("0 real")]
    ]);
    runtime.dispose();
  });

  it("refreshes sensitive export counts when facts-only updates add and remove connection facts", async () => {
    const history = createAuthoritativeHistory();
    history.offer(topologyEvent("sensitive-subscription", "subscription-started"));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().export.sensitiveCounts).toMatchObject({
      "server-addresses": 0,
      "client-ips": 0
    });

    const dispatchFacts = async (
      id: string,
      values: {
        serverAddress: string | null;
        serverInstanceAddress: string | null;
        clientIp: string | null;
      }
    ): Promise<void> => {
      runtime.dispatch({
        type: "ingest-capture-message",
        message: createCaptureMessage("item-update", {
          id,
          client: {
            id: "client-main",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "S-1",
            ...values
          },
          subscription: { id: "orders-subscription", mode: "COMMAND" },
          item: { name: "orders", position: 1 },
          update: {
            isSnapshot: false,
            fields: { value: id },
            changedFields: { value: id }
          }
        })
      });
      scheduler.flushFrame();
      await flushStoreNotifications();
    };

    await dispatchFacts("sensitive-add", {
      serverAddress: "https://example.test/lightstreamer",
      serverInstanceAddress: "instance.example.test",
      clientIp: "192.0.2.10"
    });
    expect(runtime.getSnapshot().export.sensitiveCounts).toMatchObject({
      "server-addresses": 2,
      "client-ips": 1
    });

    await dispatchFacts("sensitive-remove", {
      serverAddress: null,
      serverInstanceAddress: null,
      clientIp: null
    });
    expect(runtime.getSnapshot().export.sensitiveCounts).toMatchObject({
      "server-addresses": 0,
      "client-ips": 0
    });
    runtime.dispose();
  });

  it("preserves a Frozen Evidence window, selection, and filtered newer count until Follow Live", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    history.offer(event("alpha-1", "alpha"));
    history.offer(event("alpha-2", "alpha"));
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();

    applyTextFilter(runtime, "alpha");
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "alpha-1" });
    runtime.dispatch({ type: "freeze-evidence" });
    const frozen = runtime.getSnapshot();

    history.offer(event("beta-1", "beta"));
    history.offer(event("alpha-3", "alpha"));
    await flushStoreNotifications();
    scheduler.flushFallback();
    await flushStoreNotifications();

    const afterCapture = runtime.getSnapshot();
    expect(afterCapture.evidence.mode).toBe("frozen");
    expect(afterCapture.evidence.events.map(({ id }) => id)).toEqual(
      frozen.evidence.events.map(({ id }) => id)
    );
    expect(afterCapture.evidence.newerCount).toBe(1);
    expect(afterCapture.selectionEventId).toBe("alpha-1");

    runtime.dispatch({ type: "follow-live" });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().evidence.newerCount).toBe(0);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "alpha-1",
      "alpha-2",
      "alpha-3"
    ]);

    runtime.dispose();
  });

  it("consolidates hidden-panel Capture and releases every scheduled resource exactly once", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    runtime.dispatch({ type: "set-visible", visible: false });
    const hidden = runtime.getSnapshot();
    history.offer(event("event-1"));
    await flushStoreNotifications();

    expect(scheduler.frameCount()).toBe(0);
    expect(runtime.getSnapshot()).toBe(hidden);

    runtime.dispatch({ type: "set-visible", visible: true });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(["event-1"]);
    expect(notifications).toBe(2);

    history.offer(event("event-2"));
    await flushStoreNotifications();
    expect(scheduler.frameCount()).toBe(1);
    runtime.dispose();
    runtime.dispose();
    scheduler.flushFrame();
    await flushStoreNotifications();
    scheduler.flushFallback();

    expect(notifications).toBe(2);
  });

  it("defers hidden theme, Capture status, history, and multi-frame topology publication until one restore", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const snapshots: Array<ReturnType<typeof runtime.getSnapshot>> = [];
    runtime.subscribe(() => snapshots.push(runtime.getSnapshot()));

    runtime.dispatch({ type: "set-visible", visible: false });
    const hiddenSnapshot = runtime.getSnapshot();
    snapshots.length = 0;
    runtime.dispatch({ type: "set-theme", theme: "dark" });
    runtime.dispatch({ type: "set-capture-status", status: "capturing" });
    for (const frame of getPanelScenario("topology-large").topologySyncFrames ?? []) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }
    history.offer(event("hidden-history-1"));
    await flushStoreNotifications();

    expect(snapshots).toEqual([]);
    expect(runtime.getSnapshot()).toBe(hiddenSnapshot);
    expect(scheduler.frameCount()).toBe(0);
    await expect(history.read({})).resolves.toMatchObject({ ok: true, value: { total: 2 } });

    runtime.dispatch({ type: "set-visible", visible: true });
    await flushStoreNotifications();

    expect(snapshots).toHaveLength(1);
    expect(runtime.getSnapshot()).toMatchObject({
      visible: true,
      theme: "dark",
      captureStatus: "capturing"
    });
    expect(runtime.getSnapshot().scope.nodes).toHaveLength(6);
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "hidden-history-1"
    ]);
    runtime.dispose();
  });

  it("preserves a Frozen historical window across hidden visibility while Live reveal follows newest", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    for (let index = 1; index <= 125; index += 1) {
      history.offer({ ...event(`visibility-${index}`), timestamp: index });
    }
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "freeze-evidence" });
    runtime.dispatch({ type: "show-oldest-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("visibility-1");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("visibility-60");

    runtime.dispatch({ type: "set-visible", visible: false });
    history.offer({ ...event("visibility-126"), timestamp: 126 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-visible", visible: true });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      visibleStart: 1,
      visibleEnd: 60,
      newerCount: 66
    });
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("visibility-1");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("visibility-60");

    runtime.dispatch({ type: "follow-live" });
    runtime.dispatch({ type: "set-visible", visible: false });
    history.offer({ ...event("visibility-127"), timestamp: 127 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-visible", visible: true });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("visibility-68");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("visibility-127");
    runtime.dispose();
  });

  it("owns presentation-ready evidence, Scope, Context, and Capture coverage", async () => {
    const history = createAuthoritativeHistory();
    history.offer({
      ...event("command-1", "orders"),
      subscription: { id: "orders-subscription", mode: "COMMAND" },
      update: {
        isSnapshot: true,
        command: "ADD",
        key: "order-17",
        fields: { command: "ADD", key: "order-17", qty: 3 },
        changedFields: { qty: 3 }
      }
    });
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "capturing",
      theme: "dark",
      capture: {
        coverage: "LIMITED",
        detail: "Earlier Snapshot evidence may be incomplete.",
        recovery: "Reload the inspected page with DevTools open"
      }
    });
    await flushStoreNotifications();

    runtime.dispatch({ type: "focus-evidence", eventId: "command-1" });
    runtime.dispatch({ type: "open-context" });
    const snapshot = runtime.getSnapshot();

    expect(snapshot.capture).toMatchObject({ operation: "RUNNING", coverage: "LIMITED" });
    expect(snapshot.theme).toBe("dark");
    expect(snapshot.scope.nodes).toContainEqual(
      expect.objectContaining({ kind: "client", label: "client-1" })
    );
    expect(snapshot.evidence.events[0]).toMatchObject({
      id: "command-1",
      source: "SERVER",
      phase: "SNAPSHOT",
      command: "ADD",
      commandKey: "order-17",
      object: "orders"
    });
    expect(snapshot.context).toMatchObject({ kind: "evidence", title: "command-1 · Item Update" });
    expect(snapshot.diagnostics[0]).toMatchObject({ title: "Coverage LIMITED" });

    runtime.dispose();
  });

  it("normalizes typed Capture messages into history through its four-method interface", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();

    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage("item-update", {
        client: { id: "client-capture" },
        subscription: { id: "capture-subscription", mode: "MERGE" },
        item: { name: "captured-item", position: 1 },
        update: { fields: { value: 7 }, changedFields: { value: 7 } }
      })
    });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().capture.operation).toBe("RUNNING");
    expect(runtime.getSnapshot().evidence.events).toEqual([
      expect.objectContaining({ source: "SERVER", object: "captured-item", commandKey: null, summary: "value" })
    ]);
    runtime.dispose();
  });

  it("derives complete typed structural Scope and retains a retired selection identity", async () => {
    const history = createAuthoritativeHistory();
    history.offer(topologyEvent("client-1", "client-created"));
    history.offer(topologyEvent("session-1", "client-status"));
    history.offer(topologyEvent("subscription-1", "subscription-created"));
    history.offer(topologyEvent("subscription-2", "subscription-started"));
    history.offer(topologyEvent("listener-1", "listener-added"));
    history.offer(topologyEvent("update-1", "item-update"));
    history.offer(
      topologyEvent("session-2", "client-status", {
        client: {
          id: "client-main",
          status: "CONNECTED:WS-STREAMING",
          sessionId: "S-2",
          transport: "WS-STREAMING"
        }
      })
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const nodes = runtime.getSnapshot().scope.nodes;

    expect(new Set(nodes.map(({ kind }) => kind))).toEqual(
      new Set(["page", "client", "session", "subscription", "item", "listener"])
    );
    expect(nodes.find(({ kind }) => kind === "listener")).toMatchObject({
      depth: 5,
      parentId: expect.any(String)
    });
    const retiredSession = nodes.find(({ kind, retired }) => kind === "session" && retired);
    expect(retiredSession).toBeDefined();
    expect(retiredSession?.lifecycle).toBe("retired");

    runtime.dispatch({ type: "set-scope", scopeId: retiredSession?.id ?? null });
    runtime.dispatch({ type: "set-scope-focus", scopeId: retiredSession?.id ?? null });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().scope.selection).toMatchObject({
      id: retiredSession?.id,
      kind: "session",
      retired: true
    });
    expect(runtime.getSnapshot().scope.focusedNodeId).toBe(retiredSession?.id);
    expect(runtime.getSnapshot().scope.label).toBe(
      "Inspected page › client-main › Historical session S-1"
    );
    expect(runtime.getSnapshot().evidence.total).toBeGreaterThan(0);
    expect(
      runtime.getSnapshot().evidence.events.every(({ raw }) => raw.client?.sessionId === "S-1")
    ).toBe(true);
    expect(runtime.getSnapshot().diagnostics).toContainEqual(
      expect.objectContaining({ severity: "Information", title: "Retired Scope" })
    );
    runtime.dispose();
  });

  it("exposes canonical structural Scope lifecycle without presentation inference", async () => {
    const activeHistory = createAuthoritativeHistory();
    appendTopologyJourney(
      activeHistory,
      {
        clientId: "lifecycle-client",
        sessionId: "lifecycle-session",
        subscriptionId: "lifecycle-sub",
        itemName: "lifecycle-item",
        listenerId: "lifecycle-listener"
      },
      700
    );
    const activeRuntime = createWorkbenchRuntime({
      history: activeHistory,
      captureStatus: "capturing"
    });
    await flushStoreNotifications();
    expect(
      activeRuntime.getSnapshot().scope.nodes.map(({ kind, lifecycle }) => [kind, lifecycle])
    ).toEqual([
      ["page", "active"],
      ["client", "active"],
      ["session", "active"],
      ["subscription", "active"],
      ["item", "active"],
      ["listener", "active"]
    ]);
    activeRuntime.dispose();

    const recoveringHistory = createAuthoritativeHistory();
    recoveringHistory.offer(
      topologyEvent("lifecycle-recovering", "client-status", {
        client: {
          id: "recovering-client",
          status: "DISCONNECTED:TRYING-RECOVERY",
          sessionId: "recovering-session"
        },
        subscription: undefined,
        item: undefined,
        listener: undefined,
        update: undefined
      })
    );
    const recoveringRuntime = createWorkbenchRuntime({ history: recoveringHistory });
    await flushStoreNotifications();
    expect(
      recoveringRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["recovering", "recovering", "recovering"]);
    recoveringRuntime.dispose();

    const disconnectedHistory = createAuthoritativeHistory();
    disconnectedHistory.offer(
      topologyEvent("lifecycle-disconnected", "client-status", {
        client: {
          id: "disconnected-client",
          status: "DISCONNECTED",
          sessionId: "disconnected-session"
        },
        subscription: undefined,
        item: undefined,
        listener: undefined,
        update: undefined
      })
    );
    const disconnectedRuntime = createWorkbenchRuntime({
      history: disconnectedHistory,
      captureStatus: "bridge disconnected"
    });
    await flushStoreNotifications();
    expect(
      disconnectedRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["disconnected", "disconnected", "disconnected"]);
    disconnectedRuntime.dispose();

    const stalledHistory = createAuthoritativeHistory();
    stalledHistory.offer(
      topologyEvent("lifecycle-stalled", "client-status", {
        client: {
          id: "stalled-client",
          status: "STALLED",
          sessionId: "stalled-session"
        },
        subscription: undefined,
        item: undefined,
        listener: undefined,
        update: undefined
      })
    );
    const stalledRuntime = createWorkbenchRuntime({ history: stalledHistory });
    await flushStoreNotifications();
    expect(
      stalledRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["stalled", "stalled", "stalled"]);
    stalledRuntime.dispose();

    const inactiveHistory = createAuthoritativeHistory();
    inactiveHistory.offer(
      topologyEvent("lifecycle-inactive", "subscription-ended", {
        subscription: {
          id: "inactive-sub",
          mode: "MERGE",
          active: false,
          subscribed: false
        },
        item: undefined,
        listener: undefined,
        update: undefined
      })
    );
    const inactiveRuntime = createWorkbenchRuntime({ history: inactiveHistory });
    await flushStoreNotifications();
    expect(
      inactiveRuntime.getSnapshot().scope.nodes.find(({ kind }) => kind === "subscription")
    ).toMatchObject({ lifecycle: "inactive", retired: false });
    inactiveRuntime.dispose();

    const unknownRuntime = createWorkbenchRuntime();
    await flushStoreNotifications();
    expect(unknownRuntime.getSnapshot().scope.nodes).toEqual([
      expect.objectContaining({ kind: "page", lifecycle: "unknown" })
    ]);
    unknownRuntime.dispose();
  });

  it("keeps structural Scope bounded when a checkpoint contains one thousand COMMAND generations", async () => {
    const history = createAuthoritativeHistory();
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const scenario = getPanelScenario("topology-large");
    for (const frame of scenario.topologySyncFrames ?? []) {
      runtime.dispatch({ type: "apply-topology-sync-frame", frame });
    }

    const nodes = runtime.getSnapshot().scope.nodes;
    expect(new Set(nodes.map(({ kind }) => kind))).toEqual(
      new Set(["page", "client", "session", "subscription", "item", "listener"])
    );
    expect(nodes).toHaveLength(6);

    runtime.dispatch({ type: "set-export-complete-evidence", complete: true });
    runtime.dispatch({ type: "export-scope" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().export.json).toContain("large-1000");
    runtime.dispose();
  });

  it("assembles a truthful runtime-object dossier for every structural Scope", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "dossier-client",
        sessionId: "dossier-session",
        subscriptionId: "dossier-subscription",
        itemName: "dossier-item",
        listenerId: "dossier-listener"
      },
      800
    );
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    await flushStoreNotifications();

    expect(contextFields(runtime)).toMatchObject({
      "Scope type": "Page",
      Clients: "1",
      Subscriptions: "1",
      Items: "1",
      Listeners: "1",
      "Capture coverage": "USEFUL"
    });

    const selectScope = (kind: "client" | "session" | "subscription" | "item" | "listener") => {
      const node = runtime.getSnapshot().scope.nodes.find((candidate) => candidate.kind === kind);
      expect(node).toBeDefined();
      runtime.dispatch({ type: "set-scope", scopeId: node?.id ?? null });
      expect(runtime.getSnapshot().context.kind).toBe("runtime");
      expect(runtime.getSnapshot().context.title).toBe(runtime.getSnapshot().scope.label);
      expect(runtime.getSnapshot().scope.label).toContain(`Inspected page › dossier-client`);
      expect(runtime.getSnapshot().scope.label).toContain(node?.label ?? "missing-node");
      return contextFields(runtime);
    };

    expect(selectScope("client")).toMatchObject({
      "Scope type": "Client",
      "Client ID": "dossier-client",
      Status: "CONNECTED:WS-STREAMING",
      "Library version": "Unknown",
      "Capture coverage": "USEFUL"
    });
    expect(selectScope("session")).toMatchObject({
      "Scope type": "Session",
      "Session ID": "dossier-session",
      Status: "connected",
      Historical: "No",
      Transport: "WS-STREAMING"
    });
    expect(selectScope("subscription")).toMatchObject({
      "Scope type": "Subscription",
      "Subscription ID": "dossier-subscription",
      Mode: "MERGE",
      Status: "Subscribed",
      Historical: "No",
      "Snapshot phase": "live",
      Listeners: "1",
      Updates: "1"
    });
    const itemDossier = selectScope("item");
    expect(runtime.getSnapshot().scope.label).toBe(
      "Inspected page › dossier-client › Session dossier-session › dossier-subscription › dossier-item · #1"
    );
    expect(itemDossier).toMatchObject({
      "Scope type": "Item",
      "Item name": "dossier-item",
      Position: "1",
      "Snapshot phase": "live",
      Updates: "1",
      Listeners: "1"
    });
    const listenerDossier = selectScope("listener");
    expect(runtime.getSnapshot().scope.label).toBe(
      "Inspected page › dossier-client › Session dossier-session › dossier-subscription › dossier-item · #1 › dossier-listener"
    );
    expect(listenerDossier).toMatchObject({
      "Scope type": "Listener",
      "Listener ID": "dossier-listener",
      Callbacks: "onItemUpdate",
      Active: "Yes",
      Deliveries: "0"
    });
    runtime.dispose();
  });

  it("returns Session operations to the prior Context without changing investigation state", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("actions-origin", "orders"));
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "actions-origin" });
    runtime.dispatch({ type: "open-context" });
    applyItemFilter(runtime, "orders");
    runtime.dispatch({ type: "freeze-evidence" });
    const origin = runtime.getSnapshot();

    runtime.dispatch({ type: "open-actions" });
    expect(runtime.getSnapshot().contextId).toBe("context:actions");
    runtime.dispatch({ type: "close-actions" });
    expect(runtime.getSnapshot()).toMatchObject({
      scopeId: origin.scopeId,
      selectionEventId: origin.selectionEventId,
      contextId: origin.contextId,
      evidence: {
        mode: origin.evidence.mode,
      }
    });
    runtime.dispose();
  });

  it("keeps disconnected Capture, independent limited Coverage, recovery, and storage boundaries", async () => {
    const history = createAuthoritativeHistory();
    history.offer(
      topologyEvent("recovering-1", "client-status", {
        client: {
          id: "client-main",
          status: "DISCONNECTED:TRYING-RECOVERY",
          sessionId: "S-1"
        }
      })
    );
    const runtime = createWorkbenchRuntime({
      history,
      captureStatus: "bridge disconnected",
      capture: {
        coverage: "LIMITED",
        detail: "Capture attached after the Subscription began."
      },
      storage: { mode: "memory", reason: "IndexedDB unavailable" }
    });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-capture-status", status: "bridge disconnected" });

    expect(runtime.getSnapshot().storage).toEqual({
      mode: "memory",
      reason: "IndexedDB unavailable"
    });
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).toEqual(
      expect.arrayContaining([
        "Capture disconnected",
        "Session recovering",
        "Coverage LIMITED"
      ])
    );
    expect(runtime.getSnapshot().capture.coverage).toBe("LIMITED");
    expect(runtime.getSnapshot().notifications.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "workbench.capture.disconnected" }),
      expect.objectContaining({ code: "workbench.capture.coverage-limited" })
    ]));
    expect(runtime.getSnapshot().diagnostics.find(({ title }) => title === "Session recovering"))
      .toMatchObject({ affected: "Session S-1" });

    runtime.dispatch({ type: "set-storage-state", storage: { mode: "indexeddb" } });
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).not.toContain(
      "Lower History Capacity"
    );
    runtime.dispose();
  });

  it("does not revive a finalized recovering Session as a footer-only condition", async () => {
    const history = createAuthoritativeHistory();
    history.offer(topologyEvent("recovering-old", "client-status", {
      client: {
        id: "client-main",
        status: "DISCONNECTED:TRYING-RECOVERY",
        sessionId: "S-old"
      }
    }));
    history.offer(topologyEvent("connected-replacement", "client-status", {
      client: {
        id: "client-main",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "S-new",
        transport: "WS-STREAMING"
      }
    }));
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().scope.nodes).toContainEqual(expect.objectContaining({
      kind: "session",
      retired: true,
      label: "Historical session S-old"
    }));
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).not.toContain("Session recovering");
    expect(runtime.getSnapshot().notifications.entries.map(({ code }) => code)).not.toContain("ls.session.recovering");
    runtime.dispose();
  });

  it("requires explicit retention confirmation and clears coherent Evidence and selection", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("selected-before-clear"));
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "selected-before-clear" });

    runtime.dispatch({ type: "request-clear-history" });
    expect(runtime.getSnapshot().retention.clearState).toBe("confirming");
    await expect(history.read({})).resolves.toMatchObject({ ok: true, value: { total: 1 } });

    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();

    await expect(history.read({})).resolves.toMatchObject({ ok: true, value: { total: 0 } });
    expect(runtime.getSnapshot().selectionEventId).toBeNull();
    expect(runtime.getSnapshot().selectedEvidence).toBeNull();
    expect(runtime.getSnapshot().evidence.investigation.readPoint).toMatchObject({
      interval: { ordinal: 2 },
      committedEvidenceBoundary: null,
      retainedRange: null
    });
    expect(runtime.getSnapshot().retention.clearState).toBe("idle");
    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(
      expect.objectContaining({ title: "Selected Evidence cleared" })
    );
    runtime.dispose();
  });

  it("prepares a versioned credential-safe topology export from runtime-owned choices", async () => {
    const history = createAuthoritativeHistory();
    history.offer(topologyEvent("export-1", "client-status"));
    history.offer(topologyEvent("export-2", "item-update"));
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();

    runtime.dispatch({
      type: "set-export-redactions",
      redactions: ["identifiers", "item-names"]
    });
    runtime.dispatch({ type: "set-export-complete-evidence", complete: true });
    runtime.dispatch({ type: "export-scope" });
    await flushStoreNotifications();

    const exportState = runtime.getSnapshot().export;
    expect(exportState.activeScopeId).toBe("page");
    expect(exportState.redactions).toEqual(["item-names", "identifiers"]);
    expect(exportState.document).toMatchObject({
      schema: { version: 1 },
      privacy: {
        redactedCategories: ["item-names", "identifiers"],
        completeEvidenceIncluded: true,
        credentialsExcluded: true
      }
    });
    expect(exportState.filename).toMatch(/^lightstreamer-topology-.*\.json$/);
    expect(exportState.json).toContain("topology-snapshot/v1");
    runtime.dispose();
  });

  it("constrains Evidence to structural Scope while preserving Live/Frozen and retired history", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "client-a",
        sessionId: "session-a",
        subscriptionId: "orders-a",
        itemName: "orders-item-a",
        listenerId: "listener-a"
      },
      100
    );
    appendTopologyJourney(
      history,
      {
        clientId: "client-b",
        sessionId: "session-b",
        subscriptionId: "orders-b",
        itemName: "orders-item-b",
        listenerId: "listener-b"
      },
      200
    );
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const subscriptionScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "subscription" && label === "orders-a");
    expect(subscriptionScope).toBeDefined();

    runtime.dispatch({ type: "set-scope", scopeId: subscriptionScope?.id ?? null });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.total).toBe(4);
    expect(
      runtime.getSnapshot().evidence.events.every(({ raw }) => raw.subscription?.id === "orders-a")
    ).toBe(true);

    runtime.dispatch({ type: "freeze-evidence" });
    history.offer({
      ...event("scoped-new", "orders-item-a"),
      client: { id: "client-a", sessionId: "session-a" },
      subscription: { id: "orders-a", mode: "MERGE" }
    });
    history.offer({
      ...event("other-new", "orders-item-b"),
      client: { id: "client-b", sessionId: "session-b" },
      subscription: { id: "orders-b", mode: "MERGE" }
    });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.mode).toBe("frozen");
    expect(runtime.getSnapshot().evidence.newerCount).toBe(1);
    runtime.dispatch({ type: "follow-live" });
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("scoped-new");
    runtime.dispose();
  });

  it("queries narrow structural Scope through bounded storage filters without listing full envelopes", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "bounded-client",
        sessionId: "bounded-session",
        subscriptionId: "bounded-subscription",
        itemName: "bounded-item",
        listenerId: "bounded-listener"
      },
      1_000
    );
    const runtime = createWorkbenchRuntime({ history, windowSize: 3 });
    await flushStoreNotifications();
    const listenerScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "listener");

    runtime.dispatch({ type: "set-scope", scopeId: listenerScope?.id ?? null });

    expect(runtime.getSnapshot().evidence.investigation.scope.kind).toBe("LISTENER");
    runtime.dispose();
  });

  it("keeps paging, Find, selection, frozen windows, and Evidence copy on Lightstreamer reads", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [
        {
          kind: "topology-checkpoint",
          id: "checkpoint-before-first",
          checkpoint: { pageEpoch: "epoch-paging-runtime" }
        },
        event("first-runtime-event", "runtime-item"),
        {
          kind: "topology-checkpoint",
          id: "checkpoint-before-last",
          checkpoint: { pageEpoch: "epoch-paging-runtime-2" }
        },
        event("last-runtime-event", "runtime-item")
      ]
    });
    const runtime = createWorkbenchRuntime({ history, windowSize: 1 });
    const read = vi.spyOn(history, "read");
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence).toMatchObject({
      total: 2,
      events: [{ id: "last-runtime-event" }]
    });

    runtime.dispatch({ type: "show-older-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      total: 2,
      events: [{ id: "first-runtime-event" }]
    });

    runtime.dispatch({ type: "select-evidence", eventId: "last-runtime-event" });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-find", value: "first-runtime-event" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({
      matchCount: 1,
      currentEventId: "first-runtime-event"
    });

    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidenceCopy.eventCount).toBe(2);
    expect(runtime.getSnapshot().evidenceCopy.text).not.toContain("checkpoint-");
    expect(read.mock.calls.every(([query]) => query.candidateKind === "lightstreamer")).toBe(true);
    runtime.dispose();
  });

  it("navigates stable bounded retained windows and leaves Frozen focus untouched by passive Capture", async () => {
    const history = createAuthoritativeHistory();
    for (let index = 1; index <= 125; index += 1) {
      history.offer({ ...event(`event-${index}`, "orders"), timestamp: index });
    }
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "event-100" });
    runtime.dispatch({ type: "freeze-evidence" });

    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      total: 125,
      offset: 0,
      visibleStart: 66,
      visibleEnd: 125,
      hasOlder: true,
      hasNewer: false
    });

    runtime.dispatch({ type: "show-older-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `event-${index + 6}`)
    );
    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      offset: 60,
      visibleStart: 6,
      visibleEnd: 65,
      hasOlder: true,
      hasNewer: true
    });

    runtime.dispatch({ type: "show-oldest-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence).toMatchObject({
      offset: 65,
      visibleStart: 1,
      visibleEnd: 60,
      hasOlder: false,
      hasNewer: true
    });
    runtime.dispatch({ type: "show-newer-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence).toMatchObject({
      offset: 5,
      visibleStart: 61,
      visibleEnd: 120
    });
    runtime.dispatch({ type: "show-newest-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      offset: 0,
      visibleStart: 66,
      visibleEnd: 125,
      hasNewer: false
    });

    history.offer({ ...event("event-126", "orders"), timestamp: 126 });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("event-125");
    expect(runtime.getSnapshot().evidence).toMatchObject({
      total: 125,
      offset: 0,
      newerCount: 1,
      visibleStart: 66,
      visibleEnd: 125,
      hasNewer: true,
      focusedEventId: "event-100",
      selectedEventId: "event-100"
    });

    runtime.dispatch({ type: "follow-live" });
    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "live",
      offset: 0,
      visibleStart: 67,
      visibleEnd: 126,
      hasNewer: false
    });
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("event-126");
    runtime.dispose();
  });

  it("keeps selected Evidence, Context limitations, and raw document stable outside the visible window", async () => {
    const history = createAuthoritativeHistory();
    for (let index = 1; index <= 125; index += 1) {
      history.offer({
        ...event(`selected-${index}`, "orders"),
        timestamp: index,
        captureSource: "listener",
        ...(index === 100 ? {
          update: {
            fields: { payload: '{"flight":{"number":"DL42"}}', malformed: "{nope" },
            changedFields: { payload: '{"flight":{"number":"DL42"}}' },
            jsonPatches: { payload: { op: "replace", path: "/flight/number", value: "DL43" } }
          }
        } : {})
      });
    }
    const runtime = createWorkbenchRuntime({ history, windowSize: 60 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "selected-100" });
    runtime.dispatch({ type: "open-context" });
    runtime.dispatch({ type: "show-oldest-evidence" });

    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "selected-100")).toBe(false);
    expect(runtime.getSnapshot().selectionEventId).toBe("selected-100");
    expect(runtime.getSnapshot().selectedEvidence).toMatchObject({
      id: "selected-100",
      kind: "Item Update",
      raw: { id: "selected-100" }
    });
    expect(runtime.getSnapshot().context).toMatchObject({
      kind: "evidence",
      title: "selected-100 · Item Update"
    });
    expect(Object.fromEntries(runtime.getSnapshot().context.fields)).toMatchObject({
      "Observation path": "Server › listener Capture",
      "Evidence limitations": "Captured observation; unavailable properties remain Unknown and this is not Authoritative COMMAND State."
    });
    expect(runtime.getSnapshot().context.selectedUpdate).toMatchObject({
      fields: [
        {
          name: "payload",
          jsonString: true,
          display: '{\n  "flight": {\n    "number": "DL42"\n  }\n}'
        },
        { name: "malformed", jsonString: false, display: "{nope" }
      ],
      changedFields: [{ name: "payload", jsonString: true }],
      jsonPatches: [{ name: "payload" }]
    });

    runtime.dispatch({ type: "open-raw-evidence", eventId: "selected-100" });
    expect(runtime.getSnapshot().contextId).toBe("raw:selected-100");
    expect(runtime.getSnapshot().selectedEvidence?.raw.id).toBe("selected-100");
    runtime.dispose();
  });

  it("recovers an active structural Scope identity and focus to Page when its object disappears", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "vanishing-client",
        sessionId: "vanishing-session",
        subscriptionId: "vanishing-sub",
        itemName: "vanishing-item",
        listenerId: "vanishing-listener"
      },
      1_100
    );
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "subscription");
    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });
    expect(runtime.getSnapshot().scopeId).toBe(scope?.id);

    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().scopeId).toBe("page");
    expect(runtime.getSnapshot().scope.focusedNodeId).toBe("page");
    expect(runtime.getSnapshot().scope.selection).toMatchObject({
      id: "page",
      kind: "page",
      retired: false
    });
    expect(runtime.getSnapshot().scope.label).toBe("Inspected page");
    runtime.dispose();
  });

  it("prepares canonical complete scoped Evidence copy and invalidates stale async results", async () => {
    let deferCompleteCopy = false;
    let resolveDeferred: () => void = () => {
      throw new Error("Complete Evidence copy was not deferred.");
    };
    const history = createAuthoritativeHistory({
      readControl(query, release) {
        if (!deferCompleteCopy || query.limit !== undefined) release();
        else resolveDeferred = release;
      }
    });
    appendTopologyJourney(
      history,
      {
        clientId: "copy-client-a",
        sessionId: "copy-session-a",
        subscriptionId: "copy-sub-a",
        itemName: "copy-item-a",
        listenerId: "copy-listener-a"
      },
      1_200
    );
    appendTopologyJourney(
      history,
      {
        clientId: "copy-client-b",
        sessionId: "copy-session-b",
        subscriptionId: "copy-sub-b",
        itemName: "copy-item-b",
        listenerId: "copy-listener-b"
      },
      1_300
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "subscription" && label === "copy-sub-a");
    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });

    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("ready");
    const copy = JSON.parse(runtime.getSnapshot().evidenceCopy.text ?? "null") as {
      format: string;
      count: number;
      events: Array<{ id: string; topology?: unknown }>;
    };
    expect(copy.format).toBe("lightstreamer-workbench/scoped-evidence-copy/v1");
    expect(copy.count).toBe(4);
    expect(copy.events.map(({ id }) => id)).toEqual([
      "copy-client-a-1202",
      "copy-client-a-1203",
      "copy-client-a-1204",
      "copy-client-a-1205"
    ]);
    expect(copy.events.every((event) => !("topology" in event))).toBe(true);
    runtime.dispatch({ type: "clear-scoped-evidence-copy" });
    expect(runtime.getSnapshot().evidenceCopy).toEqual({
      state: "idle",
      eventCount: 0,
      text: null
    });

    deferCompleteCopy = true;
    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("preparing");
    // The bounded operation is loaded at the existing copy decision boundary;
    // let its first page request reach the controllable history read.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    applyItemFilter(runtime, "copy-item-a");
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("idle");
    resolveDeferred();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("idle");
    expect(runtime.getSnapshot().evidenceCopy.text).toBeNull();
    runtime.dispose();
  });

  it("keeps Filter membership independent while preserving a hidden selection and Context", async () => {
    const history = createAuthoritativeHistory();
    const scheduler = createScheduler();
    history.offer({ ...event("alpha-1", "alpha"), timestamp: 1 });
    history.offer({ ...event("beta-1", "beta"), timestamp: 2 });
    history.offer({ ...event("alpha-2", "alpha"), timestamp: 3 });
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "beta-1" });
    runtime.dispatch({ type: "open-context" });
    applyItemFilter(runtime, "alpha");
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "alpha-1",
      "alpha-2"
    ]);
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("alpha-2");
    expect(runtime.getSnapshot().evidence.hiddenSelection).toEqual({
      eventId: "beta-1",
      message: "Selected event outside current results",
      canReveal: true,
      canClear: true
    });
    expect(runtime.getSnapshot().context).toMatchObject({
      kind: "evidence",
      title: "beta-1 · Item Update"
    });

    history.offer({ ...event("alpha-3", "alpha"), timestamp: 4 });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("alpha-2");

    runtime.dispatch({ type: "set-find", value: "alpha" });
    await flushStoreNotifications();
    const membership = runtime.getSnapshot().evidence.events.map(({ id }) => id);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({
      query: "alpha",
      matchCount: 3,
      currentIndex: 0,
      currentEventId: "alpha-1"
    });
    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({
      currentIndex: 1,
      currentEventId: "alpha-2"
    });
    runtime.dispatch({ type: "find-previous" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("alpha-1");
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(membership);
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");

    runtime.dispatch({ type: "clear-find" });
    expect(runtime.getSnapshot().evidence.findState).toEqual({
      query: "",
      matchCount: 0,
      currentIndex: -1,
      currentEventId: null
    });
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(membership);

    runtime.dispatch({ type: "reveal-selected-evidence" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.investigation.filter.criteria).toEqual({});
    expect(runtime.getSnapshot().evidence.hiddenSelection).toBeNull();
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("beta-1");

    applyItemFilter(runtime, "alpha");
    await flushStoreNotifications();
    runtime.dispatch({ type: "clear-evidence-selection" });
    expect(runtime.getSnapshot().selectionEventId).toBeNull();
    expect(runtime.getSnapshot().evidence.hiddenSelection).toBeNull();
    expect(runtime.getSnapshot().evidence.focusedEventId).toBeNull();
    expect(runtime.getSnapshot().context.kind).toBe("runtime");
    runtime.dispose();
  });

  it("preserves a Filter-hidden selection while opening raw Evidence and returning", async () => {
    const history = createAuthoritativeHistory();
    history.offer({ ...event("alpha-raw-1", "alpha"), timestamp: 1 });
    history.offer({ ...event("beta-raw-1", "beta"), timestamp: 2 });
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();

    runtime.dispatch({ type: "select-evidence", eventId: "beta-raw-1" });
    runtime.dispatch({ type: "open-context" });
    applyItemFilter(runtime, "alpha");
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.hiddenSelection?.eventId).toBe("beta-raw-1");

    runtime.dispatch({ type: "open-raw-evidence", eventId: "beta-raw-1" });
    expect(runtime.getSnapshot()).toMatchObject({
      contextId: "raw:beta-raw-1",
      selectionEventId: "beta-raw-1",
      selectedEvidence: { id: "beta-raw-1" },
      evidence: {
        focusedEventId: "beta-raw-1",
        hiddenSelection: { eventId: "beta-raw-1" }
      }
    });

    runtime.dispatch({ type: "set-context", contextId: null });
    expect(runtime.getSnapshot().evidence.hiddenSelection).toEqual({
      eventId: "beta-raw-1",
      message: "Selected event outside current results",
      canReveal: true,
      canClear: true
    });
    runtime.dispose();
  });

  it("finds the human-readable Evidence kind without changing Filter membership", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("update-1", "alpha"));
    history.offer({
      ...event("status-1", "status"),
      kind: "client-status",
      item: undefined,
      update: undefined
    });
    history.offer(event("update-2", "beta"));
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const unfilteredIds = runtime.getSnapshot().evidence.events.map(({ id }) => id);

    runtime.dispatch({ type: "set-find", value: "ITEM UPDATE" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.findState).toEqual({
      query: "ITEM UPDATE",
      matchCount: 2,
      currentIndex: 0,
      currentEventId: "update-1"
    });
    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("update-2");
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(unfilteredIds);

    applyItemFilter(runtime, "alpha");
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(["update-1"]);
    runtime.dispatch({ type: "set-find", value: "ITEM UPDATE" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({
      matchCount: 1,
      currentIndex: 0,
      currentEventId: "update-1"
    });
    runtime.dispose();
  });

  it("finds and reveals matches across all 4,000 retained events without changing the investigation", async () => {
    const scheduler = createScheduler();
    const matchNumbers = new Set([5, 2_050, 3_995]);
    const retainedEvidence = Array.from({ length: 4_000 }, (_, index) => {
      const number = index + 1;
      return {
        id: `retained-${number}`,
        timestamp: number,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        item: { name: matchNumbers.has(number) ? `needle-${number}` : `orders-${number}`, position: 1 },
        subscription: { id: "retained-subscription", mode: "MERGE" }
      } satisfies LightstreamerEventEnvelope;
    });
    const history = createAuthoritativeHistory({ precommitted: retainedEvidence });
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "select-evidence", eventId: "retained-4000" });
    runtime.dispatch({ type: "open-context" });
    const modeFilter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: modeFilter.revision, operations: [{ type: "add-criterion", facet: "mode", value: createTypedFilterValue("mode", "enum", "MERGE") }] });
    await flushStoreNotifications();
    const origin = runtime.getSnapshot();

    runtime.dispatch({ type: "set-find", value: "needle" });
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.findState).toEqual({
      query: "needle",
      matchCount: 3,
      currentIndex: 0,
      currentEventId: "retained-5"
    });
    expect(runtime.getSnapshot().evidence.events).toHaveLength(60);
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-5")).toBe(true);

    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("retained-2050");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-2050")).toBe(true);
    expect(runtime.getSnapshot()).toMatchObject({
      scopeId: origin.scopeId,
      selectionEventId: origin.selectionEventId,
      contextId: origin.contextId,
      evidence: {
        mode: origin.evidence.mode,
      }
    });

    history.offer({
      ...event("retained-4001", "orders-4001"),
      subscription: { id: "retained-subscription", mode: "MERGE" }
    });
    await flushStoreNotifications();
    scheduler.flushFrame();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("retained-2050");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-2050")).toBe(true);

    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("retained-3995");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-3995")).toBe(true);
    runtime.dispatch({ type: "clear-find" });
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-4001")).toBe(true);
    runtime.dispose();
  });

  it("uses the same complete retained Find contract with authoritative history", async () => {
    const history = createAuthoritativeHistory();
    for (let index = 1; index <= 180; index += 1) {
      history.offer({
        ...event(
          `indexed-retained-${index}`,
          [2, 91, 179].includes(index) ? `indexed-needle-${index}` : `indexed-orders-${index}`
        ),
        subscription: { id: "indexed-retained-subscription", mode: "MERGE" }
      });
    }
    const runtime = createWorkbenchRuntime({ history, windowSize: 60 });
    await flushStoreNotifications();
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.total).toBe(180));
    runtime.dispatch({ type: "set-find", value: "indexed-needle" });
    await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.matchCount).toBe(3));
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("indexed-retained-2");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "indexed-retained-2")).toBe(true);
    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("indexed-retained-91");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "indexed-retained-91")).toBe(true);
    runtime.dispose();
    await history.close();
  });

  it("keeps an active Scope explicit when its independent Filter produces empty Evidence", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "client-empty",
        sessionId: "session-empty",
        subscriptionId: "subscription-empty",
        itemName: "scope-item",
        listenerId: "listener-empty"
      },
      300
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const itemScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "item" && label.includes("scope-item"));
    runtime.dispatch({ type: "set-scope", scopeId: itemScope?.id ?? null });
    applyItemFilter(runtime, "no-such-item");

    expect(runtime.getSnapshot().scope.selection?.id).toBe(itemScope?.id);
    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().evidence.events).toEqual([]);
    runtime.dispose();
  });

  it("prunes versioned export documents at client, subscription, and item Scope", async () => {
    const history = createAuthoritativeHistory();
    appendTopologyJourney(
      history,
      {
        clientId: "client-export-a",
        sessionId: "session-export-a",
        subscriptionId: "subscription-export-a",
        itemName: "item-export-a",
        listenerId: "listener-export-a"
      },
      400
    );
    appendTopologyJourney(
      history,
      {
        clientId: "client-export-b",
        sessionId: "session-export-b",
        subscriptionId: "subscription-export-b",
        itemName: "item-export-b",
        listenerId: "listener-export-b"
      },
      500
    );
    const runtime = createWorkbenchRuntime({ history });
    await flushStoreNotifications();
    const scopeNodes = runtime.getSnapshot().scope.nodes;

    const assertExport = async (scopeId: string) => {
      runtime.dispatch({ type: "set-scope", scopeId });
      runtime.dispatch({ type: "export-scope" });
      await flushStoreNotifications();
      return runtime.getSnapshot().export.document;
    };
    const clientScope = scopeNodes.find(
      ({ kind, label }) => kind === "client" && label === "client-export-a"
    );
    const clientDocument = await assertExport(clientScope?.id ?? "page");
    expect(clientDocument?.clients.map(({ id }) => id)).toEqual(["client-export-a"]);

    const subscriptionScope = scopeNodes.find(
      ({ kind, label }) => kind === "subscription" && label === "subscription-export-a"
    );
    const subscriptionDocument = await assertExport(subscriptionScope?.id ?? "page");
    expect(subscriptionDocument?.overview.subscriptionCount).toBe(1);
    expect(subscriptionDocument?.clients[0]?.sessions[0]?.subscriptions).toHaveLength(1);

    const itemScope = scopeNodes.find(
      ({ kind, label }) => kind === "item" && label.includes("item-export-a")
    );
    const itemDocument = await assertExport(itemScope?.id ?? "page");
    expect(itemDocument?.overview.itemCount).toBe(1);
    expect(itemDocument?.clients[0]?.sessions[0]?.subscriptions[0]?.items).toHaveLength(1);
    expect(itemDocument?.privacy.credentialsExcluded).toBe(true);
    runtime.dispose();
  });
});
