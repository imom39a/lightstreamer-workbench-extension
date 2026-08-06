import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory, createIndexedDbEventHistory } from "../src/core/event-history";
import { deleteEventDatabase, eventDatabaseName } from "../src/core/indexeddb/event-db";
import { createCaptureMessage } from "../src/bridge/messages";
import {
  type AnalyticsConsent,
  type WorkbenchAnalytics,
  type WorkbenchAnalyticsEvent
} from "../src/extension/analytics";
import { createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";
import { getPanelScenario } from "./support/panel-scenarios";

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
    client: { id: "client-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: item, position: 1 },
    update: { fields: { value: id } }
  };
}

async function flushStoreNotifications(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

function createAnalytics(initialConsent: AnalyticsConsent): WorkbenchAnalytics & {
  events: WorkbenchAnalyticsEvent[];
} {
  let consent = initialConsent;
  const events: WorkbenchAnalyticsEvent[] = [];
  return {
    available: true,
    events,
    getConsent: () => consent,
    setConsent: vi.fn(async (next) => {
      consent = next;
      return true;
    }),
    track: vi.fn(async (tracked) => {
      events.push(tracked);
    })
  };
}

function appendTopologyJourney(
  history: ReturnType<typeof createInMemoryEventHistory>,
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
  history.append(base(0, "client-created"));
  history.append(base(1, "client-status"));
  history.append(base(2, "subscription-created"));
  history.append(base(3, "subscription-started"));
  history.append(base(4, "listener-added"));
  history.append({
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
  it("keeps getSnapshot and subscribe callback-safe for useSyncExternalStore", () => {
    const runtime = createWorkbenchRuntime();
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

  it("exposes one cached immutable bounded Evidence snapshot and publishes developer commands synchronously", () => {
    const history = createInMemoryEventHistory();
    for (let index = 1; index <= 62; index += 1) {
      history.append(event(`event-${index}`));
    }

    const runtime = createWorkbenchRuntime({ history });
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

    const selected = runtime.getSnapshot();
    expect(notifications).toHaveLength(4);
    expect(selected).not.toBe(initial);
    expect(selected.scopeId).toBe(clientScope?.id);
    expect(selected.selectionEventId).toBe("event-17");
    expect(selected.contextId).toBe("context:event-17");
    expect(selected.evidence.find).toBe("event-17");

    runtime.dispose();
  });

  it("publishes async Scope, Filter, Freeze, and Follow intent synchronously and rejects stale query results", async () => {
    const base = createInMemoryEventHistory();
    appendTopologyJourney(
      base,
      {
        clientId: "async-client",
        sessionId: "async-session",
        subscriptionId: "async-sub",
        itemName: "async-item",
        listenerId: "async-listener"
      },
      50
    );
    let deferBounded = false;
    const pending: Array<{
      resolve(): void;
    }> = [];
    const history = {
      ...base,
      queryEvents(query?: Parameters<typeof base.queryEvents>[0]) {
        if (!deferBounded || query?.limit === undefined) return base.queryEvents(query);
        const promise = new Promise<Awaited<ReturnType<ReturnType<typeof base.queryEvents>["toPromise"]>>>((resolve) => {
          pending.push({ resolve: () => void base.queryEvents(query).toPromise().then(resolve) });
        });
        return {
          receive(onValue: (value: Awaited<typeof promise>) => void, onError: (error: unknown) => void) {
            void promise.then(onValue, onError);
          },
          toPromise() {
            return promise;
          }
        };
      }
    };
    const runtime = createWorkbenchRuntime({ history });
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "subscription");
    const versions: number[] = [];
    runtime.subscribe(() => versions.push(runtime.getSnapshot().version));
    deferBounded = true;

    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });
    expect(runtime.getSnapshot().scopeId).toBe(scope?.id);
    runtime.dispatch({ type: "set-filters", filters: { item: "async-item" } });
    expect(runtime.getSnapshot().evidence.filters).toEqual({ item: "async-item" });
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
    expect(runtime.getSnapshot().evidence.filters).toEqual({ item: "async-item" });
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual([
      "async-client-55"
    ]);
    runtime.dispose();
  });

  it("publishes no stale Evidence beneath a new Scope or Filter while delayed queries settle", async () => {
    const base = createInMemoryEventHistory();
    appendTopologyJourney(
      base,
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
      base,
      {
        clientId: "delayed-client-b",
        sessionId: "delayed-session-b",
        subscriptionId: "delayed-sub-b",
        itemName: "beta-item",
        listenerId: "delayed-listener-b"
      },
      200
    );
    let deferBounded = false;
    const pending: Array<{ resolve(): void }> = [];
    const history = {
      ...base,
      queryEvents(query?: Parameters<typeof base.queryEvents>[0]) {
        if (!deferBounded || query?.limit === undefined) return base.queryEvents(query);
        const promise = new Promise<Awaited<ReturnType<ReturnType<typeof base.queryEvents>["toPromise"]>>>((resolve) => {
          pending.push({ resolve: () => void base.queryEvents(query).toPromise().then(resolve) });
        });
        return {
          receive(onValue: (value: Awaited<typeof promise>) => void, onError: (error: unknown) => void) {
            void promise.then(onValue, onError);
          },
          toPromise() {
            return promise;
          }
        };
      }
    };
    const runtime = createWorkbenchRuntime({ history });
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

    runtime.dispatch({ type: "set-filters", filters: { item: "beta-item" } });
    expect(runtime.getSnapshot().evidence).toMatchObject({
      loading: true,
      events: [],
      total: 0,
      filters: { item: "beta-item" }
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
    const base = createInMemoryEventHistory();
    appendTopologyJourney(
      base,
      {
        clientId: "streaming-client",
        sessionId: "streaming-session",
        subscriptionId: "streaming-subscription",
        itemName: "streaming-item",
        listenerId: "streaming-listener"
      },
      100
    );
    let deferBounded = false;
    const pending: Array<{ resolve(): void }> = [];
    const history = {
      ...base,
      queryEvents(query?: Parameters<typeof base.queryEvents>[0]) {
        if (!deferBounded || query?.limit === undefined) return base.queryEvents(query);
        const promise = new Promise<Awaited<ReturnType<ReturnType<typeof base.queryEvents>["toPromise"]>>>((resolve) => {
          pending.push({ resolve: () => void base.queryEvents(query).toPromise().then(resolve) });
        });
        return {
          receive(onValue: (value: Awaited<typeof promise>) => void, onError: (error: unknown) => void) {
            void promise.then(onValue, onError);
          },
          toPromise() {
            return promise;
          }
        };
      }
    };
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    const client = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "client" && label === "streaming-client");
    deferBounded = true;
    runtime.dispatch({ type: "set-scope", scopeId: client?.id ?? null });
    expect(runtime.getSnapshot().evidence.loading).toBe(true);

    history.append({
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
    expect(pending).toHaveLength(1);
    pending.shift()?.resolve();
    await flushStoreNotifications();

    expect(runtime.getSnapshot().evidence.loading).toBe(false);
    const resolvedEventIds = runtime.getSnapshot().evidence.events.map(({ id }) => id);
    expect(resolvedEventIds).not.toHaveLength(0);
    expect(pending).toHaveLength(1);
    pending.shift()?.resolve();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toContain("streaming-client-106");
    runtime.dispose();
  });

  it("batches passive Capture publications into one frame while retaining the newest matching window", async () => {
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    const initial = runtime.getSnapshot();
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    history.append(event("event-1"));
    history.append(event("event-2"));
    await flushStoreNotifications();

    expect(runtime.getSnapshot()).toBe(initial);
    expect(scheduler.frameCount()).toBe(1);
    expect(scheduler.fallbackCount()).toBe(1);

    scheduler.flushFrame();

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
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    history.append(event("event-1"));
    history.append(event("event-2"));
    const runtime = createWorkbenchRuntime({ history, scheduler });
    const firstPresentation = runtime.getSnapshot().evidence.events[0];

    history.append(event("event-3"));
    scheduler.flushFrame();

    expect(runtime.getSnapshot().evidence.events[0]).toBe(firstPresentation);
    runtime.dispose();
  });

  it("coalesces direct Capture notifications to render cadence without losing deliveries", async () => {
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
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

    expect(await history.count().toPromise()).toBe(3);
    expect(notifications).toBe(0);
    expect(scheduler.frameCount()).toBe(1);

    scheduler.flushFrame();

    expect(notifications).toBe(1);
    expect(runtime.getSnapshot().evidence.total).toBe(3);
    expect((await history.list().toPromise()).map((retained) => retained.listener?.id)).toEqual([
      "listener-1",
      "listener-2",
      "listener-3"
    ]);
    runtime.dispose();
  });

  it("reuses unchanged structural Scope nodes while refreshing volatile counter presentations", async () => {
    const history = createInMemoryEventHistory();
    history.append(topologyEvent("client-1", "client-created"));
    history.append(topologyEvent("session-1", "client-status"));
    history.append(topologyEvent("subscription-1", "subscription-started"));
    history.append(topologyEvent("listener-1", "listener-added"));
    history.append(topologyEvent("update-1", "item-update"));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
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

  it("rebuilds ordered Scope locators when an established inactive Subscription becomes active", () => {
    const history = createInMemoryEventHistory();
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
    history.append(subscription("A", false, 1));
    history.append(subscription("B", true, 2));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
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

  it("refreshes sensitive export counts when facts-only updates add and remove connection facts", () => {
    const history = createInMemoryEventHistory();
    history.append(topologyEvent("sensitive-subscription", "subscription-started"));
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, captureStatus: "capturing" });
    expect(runtime.getSnapshot().export.sensitiveCounts).toMatchObject({
      "server-addresses": 0,
      "client-ips": 0
    });

    const dispatchFacts = (
      id: string,
      values: {
        serverAddress: string | null;
        serverInstanceAddress: string | null;
        clientIp: string | null;
      }
    ): void => {
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
    };

    dispatchFacts("sensitive-add", {
      serverAddress: "https://example.test/lightstreamer",
      serverInstanceAddress: "instance.example.test",
      clientIp: "192.0.2.10"
    });
    expect(runtime.getSnapshot().export.sensitiveCounts).toMatchObject({
      "server-addresses": 2,
      "client-ips": 1
    });

    dispatchFacts("sensitive-remove", {
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
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    history.append(event("alpha-1", "alpha"));
    history.append(event("alpha-2", "alpha"));
    const runtime = createWorkbenchRuntime({ history, scheduler });

    runtime.dispatch({ type: "set-filters", filters: { query: "alpha" } });
    runtime.dispatch({ type: "select-evidence", eventId: "alpha-1" });
    runtime.dispatch({ type: "freeze-evidence" });
    const frozen = runtime.getSnapshot();

    history.append(event("beta-1", "beta"));
    history.append(event("alpha-3", "alpha"));
    await flushStoreNotifications();
    scheduler.flushFallback();

    const afterCapture = runtime.getSnapshot();
    expect(afterCapture.evidence.mode).toBe("frozen");
    expect(afterCapture.evidence.events.map(({ id }) => id)).toEqual(
      frozen.evidence.events.map(({ id }) => id)
    );
    expect(afterCapture.evidence.newerCount).toBe(1);
    expect(afterCapture.selectionEventId).toBe("alpha-1");

    runtime.dispatch({ type: "follow-live" });

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
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    let notifications = 0;
    runtime.subscribe(() => {
      notifications += 1;
    });

    runtime.dispatch({ type: "set-visible", visible: false });
    const hidden = runtime.getSnapshot();
    history.append(event("event-1"));
    await flushStoreNotifications();

    expect(scheduler.frameCount()).toBe(0);
    expect(runtime.getSnapshot()).toBe(hidden);

    runtime.dispatch({ type: "set-visible", visible: true });
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(["event-1"]);
    expect(notifications).toBe(2);

    history.append(event("event-2"));
    await flushStoreNotifications();
    expect(scheduler.frameCount()).toBe(1);
    runtime.dispose();
    runtime.dispose();
    scheduler.flushFrame();
    scheduler.flushFallback();

    expect(notifications).toBe(2);
  });

  it("defers hidden theme, Capture status, history, and multi-frame topology publication until one restore", async () => {
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
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
    history.append(event("hidden-history-1"));
    await flushStoreNotifications();

    expect(snapshots).toEqual([]);
    expect(runtime.getSnapshot()).toBe(hiddenSnapshot);
    expect(scheduler.frameCount()).toBe(0);
    await expect(history.count().toPromise()).resolves.toBe(1);

    runtime.dispatch({ type: "set-visible", visible: true });

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
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    for (let index = 1; index <= 125; index += 1) {
      history.append({ ...event(`visibility-${index}`), timestamp: index });
    }
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
    runtime.dispatch({ type: "freeze-evidence" });
    runtime.dispatch({ type: "show-oldest-evidence" });
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("visibility-1");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("visibility-60");

    runtime.dispatch({ type: "set-visible", visible: false });
    history.append({ ...event("visibility-126"), timestamp: 126 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-visible", visible: true });

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
    history.append({ ...event("visibility-127"), timestamp: 127 });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-visible", visible: true });
    expect(runtime.getSnapshot().evidence.mode).toBe("live");
    expect(runtime.getSnapshot().evidence.events[0]?.id).toBe("visibility-68");
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("visibility-127");
    runtime.dispose();
  });

  it("owns presentation-ready evidence, Scope, Context, Capture coverage, and COMMAND provenance", () => {
    const history = createInMemoryEventHistory();
    history.append({
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
    expect(snapshot.commandProjections.observed.rows).toEqual([
      ["orders-subscription / orders / order-17", "command=ADD, key=order-17, qty=3"]
    ]);
    expect(snapshot.diagnostics[0]).toMatchObject({ title: "Coverage LIMITED" });

    runtime.dispose();
  });

  it("normalizes typed Capture messages into history through its four-method interface", async () => {
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });

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

    expect(runtime.getSnapshot().capture.operation).toBe("RUNNING");
    expect(runtime.getSnapshot().evidence.events).toEqual([
      expect.objectContaining({ source: "SERVER", object: "captured-item", commandKey: null, summary: "value" })
    ]);
    runtime.dispose();
  });

  it("derives complete typed structural Scope and retains a retired selection identity", () => {
    const history = createInMemoryEventHistory();
    history.append(topologyEvent("client-1", "client-created"));
    history.append(topologyEvent("session-1", "client-status"));
    history.append(topologyEvent("subscription-1", "subscription-created"));
    history.append(topologyEvent("subscription-2", "subscription-started"));
    history.append(topologyEvent("listener-1", "listener-added"));
    history.append(topologyEvent("update-1", "item-update"));
    history.append(
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

  it("exposes canonical structural Scope lifecycle without presentation inference", () => {
    const activeHistory = createInMemoryEventHistory();
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

    const recoveringHistory = createInMemoryEventHistory();
    recoveringHistory.append(
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
    expect(
      recoveringRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["recovering", "recovering", "recovering"]);
    recoveringRuntime.dispose();

    const disconnectedHistory = createInMemoryEventHistory();
    disconnectedHistory.append(
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
    expect(
      disconnectedRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["disconnected", "disconnected", "disconnected"]);
    disconnectedRuntime.dispose();

    const stalledHistory = createInMemoryEventHistory();
    stalledHistory.append(
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
    expect(
      stalledRuntime.getSnapshot().scope.nodes
        .filter(({ kind }) => kind === "page" || kind === "client" || kind === "session")
        .map(({ lifecycle }) => lifecycle)
    ).toEqual(["stalled", "stalled", "stalled"]);
    stalledRuntime.dispose();

    const inactiveHistory = createInMemoryEventHistory();
    inactiveHistory.append(
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
    expect(
      inactiveRuntime.getSnapshot().scope.nodes.find(({ kind }) => kind === "subscription")
    ).toMatchObject({ lifecycle: "inactive", retired: false });
    inactiveRuntime.dispose();

    const unknownRuntime = createWorkbenchRuntime();
    expect(unknownRuntime.getSnapshot().scope.nodes).toEqual([
      expect.objectContaining({ kind: "page", lifecycle: "unknown" })
    ]);
    unknownRuntime.dispose();
  });

  it("keeps structural Scope bounded when a checkpoint contains one thousand COMMAND generations", () => {
    const runtime = createWorkbenchRuntime();
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
    expect(runtime.getSnapshot().export.json).toContain("large-1000");
    runtime.dispose();
  });

  it("assembles a truthful runtime-object dossier for every structural Scope", () => {
    const history = createInMemoryEventHistory();
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

  it("scopes both COMMAND projections to structural descendants without merging their semantics", () => {
    const history = createInMemoryEventHistory();
    const subAOrders = {
      clientId: "client-a",
      sessionId: "session-a",
      subscriptionId: "sub-a",
      itemName: "orders",
      itemPosition: 1,
      listenerId: "listener-a",
      key: "shared-key",
      qty: 1
    };
    history.append(commandUpdate("command-1", subAOrders));
    history.append(commandUpdate("command-2", { ...subAOrders, itemName: "trades", itemPosition: 2, key: "trade-key", qty: 2 }));
    history.append(commandUpdate("command-3", {
      ...subAOrders,
      clientId: "client-b",
      sessionId: "session-b",
      subscriptionId: "sub-b",
      listenerId: "listener-b",
      qty: 3
    }));
    history.append(commandUpdate("command-4", { ...subAOrders, qty: 9 }, { synthetic: true, command: "UPDATE" }));
    history.append(commandUpdate("command-5", {
      ...subAOrders,
      itemName: "trades",
      itemPosition: 2,
      key: "trade-key",
      qty: 8
    }, { synthetic: true, command: "UPDATE" }));
    history.append(commandUpdate("command-6", {
      ...subAOrders,
      itemName: "trades",
      itemPosition: 2,
      key: "trade-key",
      qty: 2
    }, { command: "UPDATE" }));
    const runtime = createWorkbenchRuntime({ history });

    expect(runtime.getSnapshot().commandProjections.observed.rows.map(([label]) => label)).toEqual([
      "sub-a / orders / shared-key",
      "sub-a / trades / trade-key",
      "sub-b / orders / shared-key"
    ]);
    expect(runtime.getSnapshot().commandProjections.localEffective.rows[0]?.[1]).toContain("qty=9");
    expect(runtime.getSnapshot().commandProjections.localEffective.supportingLocalEvidenceId).toBe(
      "command-4"
    );
    expect(runtime.getSnapshot().commandProjections.observed.rows[0]?.[1]).toContain("qty=1");

    const select = (kind: "client" | "session" | "subscription" | "item" | "listener", label: string) => {
      const node = runtime
        .getSnapshot()
        .scope.nodes.find((candidate) => candidate.kind === kind && candidate.label.startsWith(label));
      expect(node).toBeDefined();
      runtime.dispatch({ type: "set-scope", scopeId: node?.id ?? null });
      return runtime.getSnapshot().commandProjections;
    };

    expect(select("client", "client-a").observed.rows.map(([label]) => label)).toEqual([
      "sub-a / orders / shared-key",
      "sub-a / trades / trade-key"
    ]);
    expect(select("session", "Session session-a").observed.rows.map(([label]) => label)).toEqual([
      "sub-a / orders / shared-key",
      "sub-a / trades / trade-key"
    ]);
    expect(select("subscription", "sub-a").observed.rows.map(([label]) => label)).toEqual([
      "sub-a / orders / shared-key",
      "sub-a / trades / trade-key"
    ]);
    const itemProjection = select("item", "orders");
    expect(itemProjection.observed.rows).toEqual([
      ["sub-a / orders / shared-key", "command=ADD, key=shared-key, qty=1"]
    ]);
    expect(itemProjection.localEffective.rows).toEqual([
      ["sub-a / orders / shared-key", "command=UPDATE, key=shared-key, qty=9"]
    ]);
    expect(itemProjection.localEffective.supportingLocalEvidenceId).toBe("command-4");
    expect(select("listener", "listener-a").observed.rows.map(([label]) => label)).toEqual([
      "sub-a / orders / shared-key"
    ]);
    runtime.dispose();
  });

  it("opens and closes the promoted COMMAND comparison without changing the investigation state", () => {
    const history = createInMemoryEventHistory();
    history.append(commandUpdate("comparison-command-1", {
      clientId: "comparison-client",
      sessionId: "comparison-session",
      subscriptionId: "comparison-subscription",
      itemName: "orders",
      itemPosition: 1,
      listenerId: "comparison-listener",
      key: "comparison-key",
      qty: 1
    }));
    const runtime = createWorkbenchRuntime({ history });
    runtime.dispatch({ type: "select-evidence", eventId: "comparison-command-1" });
    runtime.dispatch({ type: "open-context" });
    const before = runtime.getSnapshot();

    runtime.dispatch({ type: "open-command-projection-comparison" });
    expect(runtime.getSnapshot().contextId).toBe("command-projections");
    expect(runtime.getSnapshot().scopeId).toBe(before.scopeId);
    expect(runtime.getSnapshot().selectionEventId).toBe(before.selectionEventId);
    expect(runtime.getSnapshot().evidence.filters).toEqual(before.evidence.filters);

    runtime.dispatch({ type: "close-command-projection-comparison" });
    expect(runtime.getSnapshot().contextId).toBe(before.contextId);
    expect(runtime.getSnapshot().scopeId).toBe(before.scopeId);
    expect(runtime.getSnapshot().selectionEventId).toBe(before.selectionEventId);
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe(before.evidence.focusedEventId);
    runtime.dispose();
  });

  it("returns Session operations to the prior Context without changing investigation state", () => {
    const history = createInMemoryEventHistory();
    history.append(event("actions-origin", "orders"));
    const runtime = createWorkbenchRuntime({ history });
    runtime.dispatch({ type: "select-evidence", eventId: "actions-origin" });
    runtime.dispatch({ type: "open-context" });
    runtime.dispatch({ type: "set-filters", filters: { item: "orders" } });
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
        filters: origin.evidence.filters
      }
    });
    runtime.dispose();
  });

  it("keeps a retained COMMAND projection available in retired Session Scope", () => {
    const history = createInMemoryEventHistory();
    const identity = {
      clientId: "retired-client",
      sessionId: "retired-session",
      subscriptionId: "retired-sub",
      itemName: "orders",
      itemPosition: 1,
      listenerId: "retired-listener",
      key: "retired-key",
      qty: 7
    };
    history.append(commandUpdate("retired-command-1", identity));
    history.append({
      ...topologyEvent("retired-session-2", "client-status"),
      client: {
        id: identity.clientId,
        status: "CONNECTED:WS-STREAMING",
        sessionId: "replacement-session",
        transport: "WS-STREAMING"
      },
      subscription: undefined,
      item: undefined,
      listener: undefined,
      update: undefined
    });
    const runtime = createWorkbenchRuntime({ history });
    const retired = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, retired }) => kind === "session" && retired);
    runtime.dispatch({ type: "set-scope", scopeId: retired?.id ?? null });

    expect(runtime.getSnapshot().commandProjections.observed.rows).toEqual([
      ["retired-sub / orders / retired-key", "command=ADD, key=retired-key, qty=7"]
    ]);
    expect(runtime.getSnapshot().commandProjections.localEffective.rows).toEqual(
      runtime.getSnapshot().commandProjections.observed.rows
    );
    runtime.dispose();
  });

  it("keeps disconnected Capture, independent limited Coverage, recovery, and storage boundaries", () => {
    const history = createInMemoryEventHistory();
    history.append(
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

    expect(runtime.getSnapshot().storage).toEqual({
      mode: "memory",
      reason: "IndexedDB unavailable"
    });
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).toEqual(
      expect.arrayContaining([
        "Capture disconnected",
        "Session recovering",
        "Coverage LIMITED",
        "In-memory event history"
      ])
    );
    expect(runtime.getSnapshot().capture.coverage).toBe("LIMITED");
    expect(runtime.getSnapshot().diagnostics.find(({ title }) => title === "Session recovering"))
      .toMatchObject({ affected: "Session S-1" });

    runtime.dispatch({ type: "set-storage-state", storage: { mode: "indexeddb" } });
    expect(runtime.getSnapshot().diagnostics.map(({ title }) => title)).not.toContain(
      "In-memory event history"
    );
    runtime.dispose();
  });

  it("requires explicit retention confirmation and clears history without silently dropping selection", async () => {
    const history = createInMemoryEventHistory();
    history.append(event("selected-before-clear"));
    const runtime = createWorkbenchRuntime({ history });
    runtime.dispatch({ type: "select-evidence", eventId: "selected-before-clear" });

    runtime.dispatch({ type: "request-clear-history" });
    expect(runtime.getSnapshot().retention.clearState).toBe("confirming");
    await expect(history.count().toPromise()).resolves.toBe(1);

    runtime.dispatch({ type: "confirm-clear-history" });
    await flushStoreNotifications();

    await expect(history.count().toPromise()).resolves.toBe(0);
    expect(runtime.getSnapshot().selectionEventId).toBe("selected-before-clear");
    expect(runtime.getSnapshot().retention.clearState).toBe("idle");
    expect(runtime.getSnapshot().diagnostics).toContainEqual(
      expect.objectContaining({ title: "Selected Evidence cleared" })
    );
    runtime.dispose();
  });

  it("owns analytics consent and preserves coarse allowlisted event meanings", async () => {
    const analytics = createAnalytics("unknown");
    const runtime = createWorkbenchRuntime({ analytics });
    expect(runtime.getSnapshot().analytics).toMatchObject({
      available: true,
      consent: "unknown",
      pending: false
    });

    runtime.dispatch({ type: "set-analytics-consent", consent: "granted" });
    await flushStoreNotifications();
    runtime.dispatch({ type: "set-find", value: "customer-secret" });
    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage("item-update", {
        item: { name: "private-item" },
        update: { fields: { private: "secret" } }
      })
    });
    await flushStoreNotifications();
    runtime.dispose();

    expect(analytics.events.map(({ name }) => name)).toEqual([
      "analytics_enabled",
      "panel_view",
      "search_used",
      "lightstreamer_detected",
      "session_summary"
    ]);
    expect(JSON.stringify(analytics.events)).not.toContain("customer-secret");
    expect(JSON.stringify(analytics.events)).not.toContain("private-item");
    expect(JSON.stringify(analytics.events)).not.toMatch(/replay/i);
  });

  it("isolates analytics transport and consent failures from investigation state", async () => {
    const analytics: WorkbenchAnalytics = {
      available: true,
      getConsent: () => "unknown",
      setConsent: vi.fn(async () => {
        throw new Error("preference transport unavailable");
      }),
      track: vi.fn(async () => {
        throw new Error("collection transport unavailable");
      })
    };
    const runtime = createWorkbenchRuntime({ analytics });

    runtime.dispatch({ type: "set-analytics-consent", consent: "granted" });
    await flushStoreNotifications();

    expect(runtime.getSnapshot().analytics).toMatchObject({
      consent: "unknown",
      pending: false,
      error: "Usage analytics could not be updated. Nothing was sent."
    });
    expect(runtime.getSnapshot().evidence.events).toEqual([]);
    runtime.dispose();
  });

  it("prepares a versioned credential-safe topology export from runtime-owned choices", () => {
    const history = createInMemoryEventHistory();
    history.append(topologyEvent("export-1", "client-status"));
    history.append(topologyEvent("export-2", "item-update"));
    const runtime = createWorkbenchRuntime({ history });

    runtime.dispatch({
      type: "set-export-redactions",
      redactions: ["identifiers", "item-names"]
    });
    runtime.dispatch({ type: "set-export-complete-evidence", complete: true });
    runtime.dispatch({ type: "export-scope" });

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
    const history = createInMemoryEventHistory();
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
    const subscriptionScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "subscription" && label === "orders-a");
    expect(subscriptionScope).toBeDefined();

    runtime.dispatch({ type: "set-scope", scopeId: subscriptionScope?.id ?? null });
    expect(runtime.getSnapshot().evidence.total).toBe(4);
    expect(
      runtime.getSnapshot().evidence.events.every(({ raw }) => raw.subscription?.id === "orders-a")
    ).toBe(true);

    runtime.dispatch({ type: "freeze-evidence" });
    history.append({
      ...event("scoped-new", "orders-item-a"),
      client: { id: "client-a", sessionId: "session-a" },
      subscription: { id: "orders-a", mode: "MERGE" }
    });
    history.append({
      ...event("other-new", "orders-item-b"),
      client: { id: "client-b", sessionId: "session-b" },
      subscription: { id: "orders-b", mode: "MERGE" }
    });
    await flushStoreNotifications();
    scheduler.flushFrame();

    expect(runtime.getSnapshot().evidence.mode).toBe("frozen");
    expect(runtime.getSnapshot().evidence.newerCount).toBe(1);
    runtime.dispatch({ type: "follow-live" });
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("scoped-new");
    runtime.dispose();
  });

  it("queries narrow structural Scope through bounded storage filters without listing full envelopes", () => {
    const history = createInMemoryEventHistory();
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
    const queryEvents = vi.spyOn(history, "queryEvents");
    const list = vi.spyOn(history, "list");
    const listenerScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "listener");

    runtime.dispatch({ type: "set-scope", scopeId: listenerScope?.id ?? null });

    expect(queryEvents).toHaveBeenCalledTimes(1);
    expect(queryEvents).toHaveBeenCalledWith({
      filters: {
        clientId: "bounded-client",
        sessionId: "bounded-session",
        subscriptionId: "bounded-subscription",
        item: "bounded-item",
        itemPosition: 1,
        listenerId: "bounded-listener"
      },
      limit: 3,
      offset: 0,
      order: "asc"
    });
    expect(list).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("navigates stable bounded retained windows and leaves Frozen focus untouched by passive Capture", async () => {
    const history = createInMemoryEventHistory();
    for (let index = 1; index <= 125; index += 1) {
      history.append({ ...event(`event-${index}`, "orders"), timestamp: index });
    }
    const scheduler = createScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
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
    expect(runtime.getSnapshot().evidence).toMatchObject({
      offset: 65,
      visibleStart: 1,
      visibleEnd: 60,
      hasOlder: false,
      hasNewer: true
    });
    runtime.dispatch({ type: "show-newer-evidence" });
    expect(runtime.getSnapshot().evidence).toMatchObject({
      offset: 5,
      visibleStart: 61,
      visibleEnd: 120
    });
    runtime.dispatch({ type: "show-newest-evidence" });
    expect(runtime.getSnapshot().evidence).toMatchObject({
      mode: "frozen",
      offset: 0,
      visibleStart: 66,
      visibleEnd: 125,
      hasNewer: false
    });

    history.append({ ...event("event-126", "orders"), timestamp: 126 });
    await flushStoreNotifications();
    scheduler.flushFrame();
    expect(runtime.getSnapshot().evidence.events.at(-1)?.id).toBe("event-125");
    expect(runtime.getSnapshot().evidence).toMatchObject({
      offset: 1,
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

  it("keeps selected Evidence, Context limitations, and raw document stable outside the visible window", () => {
    const history = createInMemoryEventHistory();
    for (let index = 1; index <= 125; index += 1) {
      history.append({
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
    const history = createInMemoryEventHistory();
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
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind }) => kind === "subscription");
    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });
    expect(runtime.getSnapshot().scopeId).toBe(scope?.id);

    await history.clear().toPromise();
    await flushStoreNotifications();
    scheduler.flushFrame();

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
    const base = createInMemoryEventHistory();
    appendTopologyJourney(
      base,
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
      base,
      {
        clientId: "copy-client-b",
        sessionId: "copy-session-b",
        subscriptionId: "copy-sub-b",
        itemName: "copy-item-b",
        listenerId: "copy-listener-b"
      },
      1_300
    );
    let deferCompleteCopy = false;
    let resolveDeferred: () => void = () => {
      throw new Error("Complete Evidence copy was not deferred.");
    };
    const history = {
      ...base,
      queryEvents(query?: Parameters<typeof base.queryEvents>[0]) {
        if (!deferCompleteCopy || query?.limit !== undefined) return base.queryEvents(query);
        const promise = new Promise<Awaited<ReturnType<ReturnType<typeof base.queryEvents>["toPromise"]>>>((resolve) => {
          resolveDeferred = () => void base.queryEvents(query).toPromise().then(resolve);
        });
        return {
          receive(onValue: (value: Awaited<typeof promise>) => void, onError: (error: unknown) => void) {
            void promise.then(onValue, onError);
          },
          toPromise() {
            return promise;
          }
        };
      }
    };
    const runtime = createWorkbenchRuntime({ history });
    const scope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "subscription" && label === "copy-sub-a");
    runtime.dispatch({ type: "set-scope", scopeId: scope?.id ?? null });

    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
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
    runtime.dispatch({ type: "set-filters", filters: { item: "copy-item-a" } });
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("idle");
    resolveDeferred();
    await flushStoreNotifications();
    expect(runtime.getSnapshot().evidenceCopy.state).toBe("idle");
    expect(runtime.getSnapshot().evidenceCopy.text).toBeNull();
    runtime.dispose();
  });

  it("keeps Filter membership independent while preserving a hidden selection and Context", async () => {
    const history = createInMemoryEventHistory();
    const scheduler = createScheduler();
    history.append({ ...event("alpha-1", "alpha"), timestamp: 1 });
    history.append({ ...event("beta-1", "beta"), timestamp: 2 });
    history.append({ ...event("alpha-2", "alpha"), timestamp: 3 });
    const runtime = createWorkbenchRuntime({ history, scheduler });
    runtime.dispatch({ type: "select-evidence", eventId: "beta-1" });
    runtime.dispatch({ type: "open-context" });
    runtime.dispatch({ type: "set-filters", filters: { item: "alpha" } });

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

    history.append({ ...event("alpha-3", "alpha"), timestamp: 4 });
    await flushStoreNotifications();
    scheduler.flushFrame();
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("alpha-2");

    runtime.dispatch({ type: "set-find", value: "alpha" });
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
    expect(runtime.getSnapshot().evidence.filters).toEqual({});
    expect(runtime.getSnapshot().evidence.hiddenSelection).toBeNull();
    expect(runtime.getSnapshot().selectionEventId).toBe("beta-1");
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("beta-1");

    runtime.dispatch({ type: "set-filters", filters: { item: "alpha" } });
    runtime.dispatch({ type: "clear-evidence-selection" });
    expect(runtime.getSnapshot().selectionEventId).toBeNull();
    expect(runtime.getSnapshot().evidence.hiddenSelection).toBeNull();
    expect(runtime.getSnapshot().evidence.focusedEventId).toBe("alpha-2");
    expect(runtime.getSnapshot().context.kind).toBe("runtime");
    runtime.dispose();
  });

  it("preserves a Filter-hidden selection while opening raw Evidence and returning", () => {
    const history = createInMemoryEventHistory();
    history.append({ ...event("alpha-raw-1", "alpha"), timestamp: 1 });
    history.append({ ...event("beta-raw-1", "beta"), timestamp: 2 });
    const runtime = createWorkbenchRuntime({ history });

    runtime.dispatch({ type: "select-evidence", eventId: "beta-raw-1" });
    runtime.dispatch({ type: "open-context" });
    runtime.dispatch({ type: "set-filters", filters: { item: "alpha" } });
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

  it("finds the human-readable Evidence kind without changing Filter membership", () => {
    const history = createInMemoryEventHistory();
    history.append(event("update-1", "alpha"));
    history.append({
      ...event("status-1", "status"),
      kind: "client-status",
      item: undefined,
      update: undefined
    });
    history.append(event("update-2", "beta"));
    const runtime = createWorkbenchRuntime({ history });
    const unfilteredIds = runtime.getSnapshot().evidence.events.map(({ id }) => id);

    runtime.dispatch({ type: "set-find", value: "ITEM UPDATE" });
    expect(runtime.getSnapshot().evidence.findState).toEqual({
      query: "ITEM UPDATE",
      matchCount: 2,
      currentIndex: 0,
      currentEventId: "update-1"
    });
    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("update-2");
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(unfilteredIds);

    runtime.dispatch({ type: "set-filters", filters: { item: "alpha" } });
    expect(runtime.getSnapshot().evidence.events.map(({ id }) => id)).toEqual(["update-1"]);
    expect(runtime.getSnapshot().evidence.findState).toMatchObject({
      matchCount: 1,
      currentIndex: 0,
      currentEventId: "update-1"
    });
    runtime.dispose();
  });

  it("finds and reveals matches across all 4,000 retained events without changing the investigation", async () => {
    const history = createInMemoryEventHistory({ batchSize: 256 });
    const scheduler = createScheduler();
    const matchNumbers = new Set([5, 2_050, 3_995]);
    for (let number = 1; number <= 4_000; number += 1) {
      history.append({
        ...event(`retained-${number}`, matchNumbers.has(number) ? `needle-${number}` : `orders-${number}`),
        subscription: { id: "retained-subscription", mode: "MERGE" }
      });
    }
    const runtime = createWorkbenchRuntime({ history, scheduler, windowSize: 60 });
    runtime.dispatch({ type: "select-evidence", eventId: "retained-4000" });
    runtime.dispatch({ type: "open-context" });
    runtime.dispatch({ type: "set-filters", filters: { mode: "MERGE" } });
    const origin = runtime.getSnapshot();

    runtime.dispatch({ type: "set-find", value: "needle" });
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
        filters: origin.evidence.filters
      }
    });

    history.append({
      ...event("retained-4001", "orders-4001"),
      subscription: { id: "retained-subscription", mode: "MERGE" }
    });
    await flushStoreNotifications();
    scheduler.flushFrame();
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("retained-2050");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-2050")).toBe(true);

    runtime.dispatch({ type: "find-next" });
    expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("retained-3995");
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-3995")).toBe(true);
    runtime.dispatch({ type: "clear-find" });
    expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "retained-4001")).toBe(true);
    runtime.dispose();
  });

  it("uses the same complete retained Find contract with IndexedDB history", async () => {
    const sessionId = "workbench-complete-find";
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    await deleteEventDatabase(eventDatabaseName(sessionId));
    const history = await createIndexedDbEventHistory({ sessionId, reset: true, batchSize: 64 });
    try {
      await Promise.all(Array.from({ length: 180 }, (_, index) => {
        const number = index + 1;
        return history.append({
          ...event(`indexed-retained-${number}`, [2, 91, 179].includes(number) ? `indexed-needle-${number}` : `indexed-orders-${number}`),
          subscription: { id: "indexed-retained-subscription", mode: "MERGE" }
        }).toPromise();
      }));
      const runtime = createWorkbenchRuntime({ history, windowSize: 60 });
      await vi.waitFor(() => expect(runtime.getSnapshot().evidence.total).toBe(180));
      runtime.dispatch({ type: "set-find", value: "indexed-needle" });
      await vi.waitFor(() => expect(runtime.getSnapshot().evidence.findState.matchCount).toBe(3));
      expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("indexed-retained-2");
      expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "indexed-retained-2")).toBe(true);
      runtime.dispatch({ type: "find-next" });
      expect(runtime.getSnapshot().evidence.findState.currentEventId).toBe("indexed-retained-91");
      expect(runtime.getSnapshot().evidence.events.some(({ id }) => id === "indexed-retained-91")).toBe(true);
      runtime.dispose();
    } finally {
      await history.close().toPromise();
      await deleteEventDatabase(eventDatabaseName(sessionId));
    }
  });

  it("keeps an active Scope explicit when its independent Filter produces empty Evidence", () => {
    const history = createInMemoryEventHistory();
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
    const itemScope = runtime
      .getSnapshot()
      .scope.nodes.find(({ kind, label }) => kind === "item" && label.includes("scope-item"));
    runtime.dispatch({ type: "set-scope", scopeId: itemScope?.id ?? null });
    runtime.dispatch({ type: "set-filters", filters: { item: "no-such-item" } });

    expect(runtime.getSnapshot().scope.selection?.id).toBe(itemScope?.id);
    expect(runtime.getSnapshot().evidence.total).toBe(0);
    expect(runtime.getSnapshot().evidence.events).toEqual([]);
    runtime.dispose();
  });

  it("prunes versioned export documents at client, subscription, and item Scope", () => {
    const history = createInMemoryEventHistory();
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
    const scopeNodes = runtime.getSnapshot().scope.nodes;

    const assertExport = (scopeId: string) => {
      runtime.dispatch({ type: "set-scope", scopeId });
      runtime.dispatch({ type: "export-scope" });
      return runtime.getSnapshot().export.document;
    };
    const clientScope = scopeNodes.find(
      ({ kind, label }) => kind === "client" && label === "client-export-a"
    );
    const clientDocument = assertExport(clientScope?.id ?? "page");
    expect(clientDocument?.clients.map(({ id }) => id)).toEqual(["client-export-a"]);

    const subscriptionScope = scopeNodes.find(
      ({ kind, label }) => kind === "subscription" && label === "subscription-export-a"
    );
    const subscriptionDocument = assertExport(subscriptionScope?.id ?? "page");
    expect(subscriptionDocument?.overview.subscriptionCount).toBe(1);
    expect(subscriptionDocument?.clients[0]?.sessions[0]?.subscriptions).toHaveLength(1);

    const itemScope = scopeNodes.find(
      ({ kind, label }) => kind === "item" && label.includes("item-export-a")
    );
    const itemDocument = assertExport(itemScope?.id ?? "page");
    expect(itemDocument?.overview.itemCount).toBe(1);
    expect(itemDocument?.clients[0]?.sessions[0]?.subscriptions[0]?.items).toHaveLength(1);
    expect(itemDocument?.privacy.credentialsExcluded).toBe(true);
    runtime.dispose();
  });
});
