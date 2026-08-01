import { describe, expect, it, vi } from "vitest";

import {
  PAGE_CAPTURE_SYNC_REQUEST,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  isTopologySyncFrame,
  isTopologyObservationForCapture,
  type CaptureMessage,
  type TopologySyncChunkFrame,
  type TopologySyncFrame
} from "../src/bridge/messages";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

class SemanticClient {
  status = "CONNECTED:WS-STREAMING";
  sessionId: string | null = "session-a";
  listeners: Array<{
    onStatusChange?(status: string): void;
    onPropertyChange?(property: string): void;
  }> = [];
  readonly connectionDetails = {
    getServerAddress: () => "https://user:secret@example.test/lightstreamer?token=secret",
    getAdapterSet: () => "DEMO",
    getSessionId: () => this.sessionId,
    getClientIp: () => "198.51.100.77"
  };
  readonly connectionOptions = {
    getReverseHeartbeatInterval: () => 1_000,
    getPollingInterval: () => 2_000,
    getIdleTimeout: () => 3_000,
    getRealMaxBandwidth: () => null,
    getForcedTransport: () => null
  };

  subscribe(subscription: unknown) {
    if (subscription instanceof SemanticSubscription) subscription.active = true;
  }
  addListener(listener: {
    onStatusChange?(status: string): void;
    onPropertyChange?(property: string): void;
  }) {
    this.listeners.push(listener);
  }
  getStatus() {
    return this.status;
  }
}

class SemanticSubscription {
  listeners: Array<{
    onItemUpdate?(update: unknown): void;
    onSubscription?(): void;
    onEndOfSnapshot?(itemName: string, itemPos: number): void;
    onItemLostUpdates?(itemName: string, itemPos: number, lostUpdates: number): void;
    onClearSnapshot?(itemName: string, itemPos: number): void;
    onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
    onCommandSecondLevelSubscriptionError?(code: number, message: string, key: string): void;
    onListenStart?(owner: SemanticSubscription): void;
    onListenEnd?(owner: SemanticSubscription): void;
  }> = [];
  active = false;
  subscribed = false;

  constructor(
    readonly mode: string,
    readonly items: string[],
    readonly fields: string[]
  ) {}

  addListener(listener: {
    onItemUpdate?(update: unknown): void;
    onSubscription?(): void;
    onEndOfSnapshot?(itemName: string, itemPos: number): void;
    onItemLostUpdates?(itemName: string, itemPos: number, lostUpdates: number): void;
    onClearSnapshot?(itemName: string, itemPos: number): void;
    onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
    onCommandSecondLevelSubscriptionError?(code: number, message: string, key: string): void;
    onListenStart?(owner: SemanticSubscription): void;
    onListenEnd?(owner: SemanticSubscription): void;
  }) {
    if (this.listeners.includes(listener)) return;
    this.listeners.push(listener);
    listener.onListenStart?.(this);
  }
  removeListener(listener: {
    onItemUpdate?(update: unknown): void;
    onSubscription?(): void;
    onEndOfSnapshot?(itemName: string, itemPos: number): void;
    onItemLostUpdates?(itemName: string, itemPos: number, lostUpdates: number): void;
    onClearSnapshot?(itemName: string, itemPos: number): void;
    onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
    onCommandSecondLevelSubscriptionError?(code: number, message: string, key: string): void;
    onListenStart?(owner: SemanticSubscription): void;
    onListenEnd?(owner: SemanticSubscription): void;
  }) {
    const index = this.listeners.indexOf(listener);
    if (index >= 0) {
      this.listeners.splice(index, 1);
      listener.onListenEnd?.(this);
    }
  }
  getListeners() {
    return [...this.listeners];
  }
  getMode() {
    return this.mode;
  }
  getItems() {
    return this.items;
  }
  getFields() {
    return this.fields;
  }
  isActive() {
    return this.active;
  }
  isSubscribed() {
    return this.subscribed;
  }
}

function createSemanticHarness() {
  const messages: CaptureMessage[] = [];
  const listeners: Array<(event: MessageEvent) => void> = [];
  const frames: unknown[] = [];
  const host = {
    LightstreamerClient: SemanticClient,
    Subscription: SemanticSubscription,
    addEventListener(type: "message", listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.push(listener);
    },
    postMessage(message: unknown) {
      frames.push(message);
    }
  };
  installLightstreamerInstrumentation(
    host as unknown as LightstreamerHost,
    (message) => messages.push(message as CaptureMessage)
  );
  return { host, messages, listeners, frames };
}

function syncRecords(
  host: object,
  listeners: Array<(event: MessageEvent) => void>,
  frames: unknown[]
) {
  frames.length = 0;
  for (const listener of listeners) {
    listener({
      source: host,
      data: { type: PAGE_CAPTURE_SYNC_REQUEST }
    } as unknown as MessageEvent);
  }
  return (frames.find(
    (frame) => (frame as TopologySyncFrame).type === TOPOLOGY_SYNC_CHUNK
  ) as TopologySyncChunkFrame | undefined)?.records ?? [];
}

describe("semantic topology instrumentation", () => {
  it("uses cutoff zero for an empty late-open checkpoint without suppressing sequence one", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    const request = {
      source: host,
      data: { type: PAGE_CAPTURE_SYNC_REQUEST }
    } as unknown as MessageEvent;

    for (const listener of listeners) listener(request);
    expect((frames as TopologySyncFrame[]).map((frame) => frame.type)).toEqual([
      TOPOLOGY_SYNC_BEGIN,
      TOPOLOGY_SYNC_COMPLETE
    ]);
    expect(frames[0]).toMatchObject({ cutoffCaptureSequence: 0, recordCount: 0 });

    new host.LightstreamerClient();
    expect(messages.at(-1)?.topology?.captureSequence).toBe(1);

    frames.length = 0;
    for (const listener of listeners) listener(request);
    expect(frames[0]).toMatchObject({ cutoffCaptureSequence: 1 });
    const records = (frames.find(
      (frame) => (frame as TopologySyncFrame).type === TOPOLOGY_SYNC_CHUNK
    ) as TopologySyncChunkFrame).records;
    expect(records.filter((record) => record.captureSequence === 1).map((record) => record.kind)).toEqual([
      "page",
      "client",
      "session"
    ]);
  });

  it("attaches valid same-page monotonic topology observations to official captures", () => {
    const { host, messages } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "qty"]
    );
    client.subscribe(subscription);
    const listener = { onItemUpdate: vi.fn() };
    subscription.addListener(listener);

    expect(messages.length).toBeGreaterThan(3);
    expect(
      messages.every(
        (message) =>
          message.topology !== undefined &&
          isTopologyObservationForCapture(message.kind, message.topology)
      )
    ).toBe(true);
    expect(new Set(messages.map((message) => message.topology?.pageEpoch)).size).toBe(1);
    expect(messages.map((message) => message.topology?.captureSequence)).toEqual(
      messages.map((_message, index) => index + 1)
    );
  });

  it("captures complete client options as facts and marks unavailable getters without inventing values", () => {
    const { host, messages } = createSemanticHarness();
    new host.LightstreamerClient();

    const created = messages.find((message) => message.kind === "client-created");
    expect(created?.payload.client).toMatchObject({
      reverseHeartbeatInterval: 1_000,
      pollingInterval: 2_000,
      idleTimeout: 3_000
    });
    expect(created?.topology?.client).toMatchObject({
      reverseHeartbeatInterval: { state: "requested", value: 1_000 },
      pollingInterval: { state: "requested", value: 2_000 },
      idleTimeout: { state: "requested", value: 3_000 },
      retryDelay: { state: "unknown", reason: "getter-missing" },
      clientIp: { state: "redacted", context: "masked-client-ip" },
      clientIpMasked: "198.51.100.0/24"
    });
    expect(created?.topology?.coverage).toMatchObject({
      status: "partial",
      reason: "getter-missing",
      getters: {
        "ConnectionOptions.getReverseHeartbeatInterval": "available",
        "ConnectionOptions.getRetryDelay": "missing"
      }
    });
    expect(JSON.stringify(created)).not.toMatch(/user:secret|\?token=secret|198\.51\.100\.77/);
  });

  it("distinguishes throwing client getters from missing getters without leaking errors", () => {
    class ThrowingClient {
      readonly connectionOptions = {
        getRetryDelay() {
          throw new Error("getter-hostile-secret");
        }
      };
    }
    const messages: CaptureMessage[] = [];
    const host = { LightstreamerClient: ThrowingClient };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );
    new host.LightstreamerClient();

    expect(messages[0]?.topology?.client).toMatchObject({
      retryDelay: { state: "unknown", reason: "getter-threw" },
      pollingInterval: { state: "unknown", reason: "getter-missing" }
    });
    expect(messages[0]?.topology?.coverage).toMatchObject({
      status: "partial",
      reason: "getter-threw",
      getters: {
        "ConnectionOptions.getRetryDelay": "threw",
        "ConnectionOptions.getPollingInterval": "missing"
      }
    });
    expect(JSON.stringify(messages)).not.toContain("getter-hostile-secret");
  });

  it("keeps aggregate page coverage partial across client-less observations and checkpoints", () => {
    class PartialClient {
      readonly connectionOptions = {
        getRetryDelay() {
          throw new Error("aggregate-coverage-secret");
        }
      };
    }
    const messages: CaptureMessage[] = [];
    const messageListeners: Array<(event: MessageEvent) => void> = [];
    const frames: TopologySyncFrame[] = [];
    const host = {
      LightstreamerClient: PartialClient,
      Subscription: SemanticSubscription,
      addEventListener(type: "message", listener: (event: MessageEvent) => void) {
        if (type === "message") messageListeners.push(listener);
      },
      postMessage(message: unknown) {
        frames.push(message as TopologySyncFrame);
      }
    };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );

    new host.LightstreamerClient();
    new host.Subscription("MERGE", ["prices"], ["last"]);
    const clientless = messages.find((message) => message.kind === "subscription-created");
    expect(clientless?.payload.client).toBeUndefined();
    expect(clientless?.topology?.coverage).toMatchObject({
      status: "partial",
      reason: "getter-threw",
      getters: {
        "ConnectionOptions.getRetryDelay": "threw",
        "ConnectionOptions.getPollingInterval": "missing"
      }
    });

    for (const listener of messageListeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(isTopologySyncFrame)).toBe(true);
    expect(frames.every((frame) =>
      frame.coverage.status === "partial" &&
      frame.coverage.reason === "getter-threw" &&
      frame.coverage.getters["ConnectionOptions.getRetryDelay"] === "threw" &&
      frame.coverage.getters["ConnectionOptions.getPollingInterval"] === "missing"
    )).toBe(true);
    expect(JSON.stringify([...messages, ...frames])).not.toContain("aggregate-coverage-secret");
  });

  it("emits a valid absolute checkpoint sufficient to hydrate current topology", () => {
    const { host, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "qty"]
    );
    client.subscribe(subscription);
    subscription.addListener({ onSubscription: () => undefined });
    subscription.subscribed = true;
    subscription.listeners[0]?.onSubscription?.();

    for (const listener of listeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }

    expect(frames.every(isTopologySyncFrame)).toBe(true);
    expect((frames as TopologySyncFrame[]).map((frame) => frame.type)).toEqual([
      TOPOLOGY_SYNC_BEGIN,
      TOPOLOGY_SYNC_CHUNK,
      TOPOLOGY_SYNC_COMPLETE
    ]);
    const records = (frames[1] as TopologySyncChunkFrame).records;
    const page = records.find((record) => record.kind === "page");
    const clientRecord = records.find((record) => record.kind === "client");
    const subscriptionRecord = records.find((record) => record.kind === "subscription");
    const attachment = records.find((record) => record.kind === "listener-attachment");
    expect(page).toBeDefined();
    expect(clientRecord).toMatchObject({ parentId: page?.id });
    expect(subscriptionRecord).toMatchObject({
      parentId: clientRecord?.id,
      clientId: clientRecord?.id,
      clientActive: true,
      serverEstablished: true
    });
    expect(attachment).toMatchObject({
      parentId: subscriptionRecord?.id,
      subscriptionId: subscriptionRecord?.id,
      values: { listenerCount: 1, active: true }
    });
    expect(JSON.stringify(frames)).not.toMatch(/user:secret|\?token=secret|198\.51\.100\.77/);
  });

  it("retains seven-state semantic evidence in late-open client, session, and subscription records", () => {
    const { host, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("MERGE", ["prices"], ["last"]);
    client.subscribe(subscription);
    subscription.addListener({ onSubscription: () => undefined });
    subscription.listeners[0]?.onSubscription?.();

    const records = syncRecords(host, listeners, frames);
    const clientRecord = records.find((record) => record.kind === "client");
    const sessionRecord = records.find((record) => record.kind === "session");
    const subscriptionRecord = records.find((record) => record.kind === "subscription");
    const expectedClientEvidence = {
      status: { state: "real", value: "CONNECTED:WS-STREAMING" },
      sessionId: { state: "real", value: "session-a" },
      reverseHeartbeatInterval: { state: "requested", value: 1_000 },
      retryDelay: { state: "unknown", reason: "getter-missing" },
      realMaxBandwidth: { state: "unavailable" },
      forcedTransport: { state: "not-applicable" },
      clientIp: { state: "redacted", context: "masked-client-ip" }
    };

    expect(clientRecord?.values?.client).toMatchObject(expectedClientEvidence);
    expect(sessionRecord?.values).toMatchObject({
      client: expectedClientEvidence,
      sessionId: { state: "real", value: "session-a" }
    });
    expect(subscriptionRecord?.values).toMatchObject({
      client: expectedClientEvidence,
      subscription: {
        mode: { state: "requested", value: "MERGE" },
        active: { state: "real", value: true },
        subscribed: { state: "real", value: false }
      },
      facts: {
        clientActive: { state: "real", value: true },
        serverEstablished: { state: "inferred", value: true }
      }
    });
    expect(JSON.stringify(records)).not.toMatch(/user:secret|\?token=secret|198\.51\.100\.77/);
  });

  it("specializes only proven subscription establishment observations", () => {
    const { host, messages } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("MERGE", ["prices"], ["last"]);

    client.subscribe(subscription);
    const subscribeCall = messages.filter((message) => message.kind === "subscription-started").at(-1);
    expect(subscribeCall?.topology).toMatchObject({
      kind: "subscription-started",
      values: { serverEstablished: { state: "unknown" } }
    });

    subscription.addListener({ onSubscription: () => undefined });
    subscription.listeners[0]?.onSubscription?.();
    const callback = messages.filter((message) => message.kind === "subscription-started").at(-1);
    expect(callback?.topology).toMatchObject({
      kind: "subscription-established",
      values: { serverEstablished: { state: "inferred", value: true } }
    });
    expect(isTopologyObservationForCapture(callback!.kind, callback?.topology)).toBe(true);
  });

  it("emits command generation observations for valid COMMAND ADD, UPDATE, and DELETE updates", () => {
    const { host, messages } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("COMMAND", ["orders"], ["command", "key"]);
    client.subscribe(subscription);
    subscription.addListener({ onItemUpdate: () => undefined });
    const update = (command: string, key: string | null) => ({
      forEachField(iterator: (name: string, position: number, value: string) => void) {
        iterator("command", 1, command);
        if (key) iterator("key", 2, key);
      },
      forEachChangedField(iterator: (name: string, position: number, value: string) => void) {
        this.forEachField(iterator);
      },
      getItemName: () => "orders",
      getItemPos: () => 1,
      isSnapshot: () => false
    });

    subscription.listeners[0]?.onItemUpdate?.(update("ADD", "order-1"));
    subscription.listeners[0]?.onItemUpdate?.(update("UPDATE", "order-1"));
    subscription.listeners[0]?.onItemUpdate?.(update("DELETE", "order-1"));
    subscription.listeners[0]?.onItemUpdate?.(update("UPSERT", "order-1"));
    const captures = messages.filter((message) => message.kind === "item-update").slice(-4);
    expect(captures.slice(0, 3).map((message) => message.topology?.kind)).toEqual([
      "command-key-generation",
      "command-key-generation",
      "command-key-generation"
    ]);
    expect(captures.slice(0, 3).map((message) => message.topology?.values)).toEqual([
      expect.objectContaining({
        command: { state: "real", value: "ADD" },
        commandKey: { state: "real", value: "order-1" }
      }),
      expect.objectContaining({
        command: { state: "real", value: "UPDATE" },
        commandKey: { state: "real", value: "order-1" }
      }),
      expect.objectContaining({
        command: { state: "real", value: "DELETE" },
        commandKey: { state: "real", value: "order-1" }
      })
    ]);
    expect(captures[3]?.topology?.kind).toBe("item-update");
    expect(captures.every((message) => isTopologyObservationForCapture(message.kind, message.topology))).toBe(true);
  });

  it("emits compatible second-level observations for both second-level callbacks", () => {
    const { host, messages } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("COMMAND", ["orders"], ["command", "key"]);
    client.subscribe(subscription);
    subscription.addListener({
      onCommandSecondLevelItemLostUpdates: () => undefined,
      onCommandSecondLevelSubscriptionError: () => undefined
    });
    const installed = subscription.listeners[0] as {
      onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
      onCommandSecondLevelSubscriptionError?(code: number, message: string, key: string): void;
    };

    installed.onCommandSecondLevelItemLostUpdates?.(3, "order-1");
    installed.onCommandSecondLevelSubscriptionError?.(17, "server-secret", "order-1");
    const captures = messages.filter((message) =>
      (message.payload.raw as { callback?: string } | undefined)?.callback?.startsWith(
        "onCommandSecondLevel"
      )
    );
    expect(captures.map((message) => message.kind)).toEqual(["item-update", "item-update"]);
    expect(captures.map((message) => message.topology?.kind)).toEqual([
      "second-level-observed",
      "second-level-observed"
    ]);
    expect(captures.map((message) => message.topology?.values)).toEqual([
      expect.objectContaining({
        secondLevelKey: { state: "inferred", value: "order-1" },
        secondLevelProvenance: { state: "inferred", value: "inferred-second-level" }
      }),
      expect.objectContaining({
        secondLevelKey: { state: "inferred", value: "order-1" },
        secondLevelProvenance: { state: "inferred", value: "inferred-second-level" }
      })
    ]);
    expect(captures.every((message) => isTopologyObservationForCapture(message.kind, message.topology))).toBe(true);
    expect(JSON.stringify(captures)).not.toContain("server-secret");
  });

  it("emits byte-identical idempotent checkpoints when current topology has not changed", () => {
    const { host, listeners, frames } = createSemanticHarness();
    new host.LightstreamerClient();
    const request = {
      source: host,
      data: { type: PAGE_CAPTURE_SYNC_REQUEST }
    } as unknown as MessageEvent;

    for (const listener of listeners) listener(request);
    const first = JSON.stringify(frames);
    frames.length = 0;
    for (const listener of listeners) listener(request);

    expect(JSON.stringify(frames)).toBe(first);
  });

  it("keeps listener attachment counts and callback delivery identities consistent", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "qty"]
    );
    client.subscribe(subscription);
    const first = { onItemUpdate: vi.fn() };
    const second = { onItemUpdate: vi.fn() };
    subscription.addListener(first);
    subscription.addListener(second);

    const update = {
      forEachField(iterator: (name: string, position: number, value: string) => void) {
        iterator("command", 1, "ADD");
        iterator("key", 2, "order-1");
        iterator("qty", 3, "10");
      },
      forEachChangedField(iterator: (name: string, position: number, value: string) => void) {
        this.forEachField(iterator);
      },
      getItemName: () => "orders",
      getItemPos: () => 1,
      isSnapshot: () => false
    };
    subscription.listeners[0]?.onItemUpdate?.(update);
    subscription.listeners[1]?.onItemUpdate?.(update);
    subscription.removeListener(first);

    const deliveries = messages.filter((message) => message.kind === "item-update");
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((message) => message.topology?.dispatch?.id)).toEqual([
      "dispatch:update-1",
      "dispatch:update-1"
    ]);
    expect(deliveries.map((message) => message.topology?.delivery?.id)).toEqual([
      "dispatch:update-1:listener-1",
      "dispatch:update-1:listener-2"
    ]);
    expect(deliveries.map((message) => message.topology?.values)).toEqual([
      expect.objectContaining({
        generationEpoch: { state: "real", value: 1 },
        generationId: {
          state: "real",
          value: "command-generation:subscription-1:item:subscription-1:1:order-1:1"
        }
      }),
      expect.objectContaining({
        generationEpoch: { state: "real", value: 1 },
        generationId: {
          state: "real",
          value: "command-generation:subscription-1:item:subscription-1:1:order-1:1"
        }
      })
    ]);

    const request = {
      source: host,
      data: { type: PAGE_CAPTURE_SYNC_REQUEST }
    } as unknown as MessageEvent;
    for (const listener of listeners) listener(request);
    const records = (frames.find(
      (frame) => (frame as TopologySyncFrame).type === TOPOLOGY_SYNC_CHUNK
    ) as TopologySyncChunkFrame).records;
    const attachments = records.filter((record) => record.kind === "listener-attachment");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.values).toMatchObject({
      listenerId: "listener-2",
      listenerCount: 1,
      active: true
    });
    expect(records.find((record) => record.kind === "aggregate")?.values).toMatchObject({
      listenerCount: 1,
      updateCount: 1
    });
  });

  it("models duplicate listener adds as one effective attachment and reattachment as a new epoch", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("COMMAND", ["orders"], ["command", "key"]);
    client.subscribe(subscription);
    const listener = { onItemUpdate: vi.fn() };

    subscription.addListener(listener);
    subscription.addListener(listener);
    let attachments = syncRecords(host, listeners, frames).filter(
      (record) => record.kind === "listener-attachment"
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id: "listener-attachment:subscription-1:listener-1:1",
      values: { listenerCount: 1, registrationCount: 1, active: true }
    });
    expect(messages.filter((message) => message.kind === "listener-added")).toHaveLength(1);

    subscription.removeListener(listener);
    expect(
      syncRecords(host, listeners, frames).filter(
        (record) => record.kind === "listener-attachment"
      )
    ).toHaveLength(0);
    expect(subscription.getListeners()).toEqual([]);

    subscription.addListener(listener);
    attachments = syncRecords(host, listeners, frames).filter(
      (record) => record.kind === "listener-attachment"
    );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({
      id: "listener-attachment:subscription-1:listener-1:2",
      values: { listenerCount: 1, registrationCount: 2, active: true }
    });
    expect(messages.filter((message) => message.kind === "listener-added")).toHaveLength(2);
  });

  it("completes a bounded partial checkpoint when semantic evidence exceeds limits", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    new host.Subscription("MERGE", ["x".repeat(5_000)], ["price"]);

    expect(
      messages.every(
        (message) =>
          message.topology !== undefined &&
          isTopologyObservationForCapture(message.kind, message.topology)
      )
    ).toBe(true);
    for (const listener of listeners) {
      listener({
        source: host,
        data: { type: PAGE_CAPTURE_SYNC_REQUEST }
      } as unknown as MessageEvent);
    }

    expect((frames as TopologySyncFrame[]).map((frame) => frame.type)).toEqual([
      TOPOLOGY_SYNC_BEGIN,
      TOPOLOGY_SYNC_COMPLETE
    ]);
    expect(frames.every(isTopologySyncFrame)).toBe(true);
    expect(frames[0]).toMatchObject({
      recordCount: 0,
      chunkCount: 0,
      coverage: { status: "partial", reason: "limit-exceeded" }
    });
    expect(frames[1]).toMatchObject({ reason: "limit-exceeded" });
  });

  it("retires session evidence, honors subscribed false, and advances establishment epochs on recovery", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const clientListener = {
      onStatusChange: () => undefined,
      onPropertyChange: () => undefined
    };
    client.addListener(clientListener);
    const subscription = new host.Subscription("COMMAND", ["orders"], ["command", "key"]);
    client.subscribe(subscription);
    subscription.addListener({ onSubscription: () => undefined });
    subscription.subscribed = true;
    subscription.listeners[0]?.onSubscription?.();

    let records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "establishment")?.id).toMatch(/:1$/);
    expect(
      messages.filter((message) => message.topology?.kind === "subscription-established").at(-1)
        ?.topology?.values
    ).toMatchObject({
      establishmentEpoch: { state: "real", value: 1 },
      establishmentId: { state: "real", value: "establishment:subscription-1:1" }
    });

    subscription.subscribed = false;
    client.subscribe(subscription);
    records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "subscription")).toMatchObject({
      clientActive: true,
      serverEstablished: false
    });
    expect(records.some((record) => record.kind === "establishment")).toBe(false);

    subscription.subscribed = true;
    subscription.listeners[0]?.onSubscription?.();
    records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "establishment")?.id).toMatch(/:2$/);
    expect(
      messages.filter((message) => message.topology?.kind === "subscription-established").at(-1)
        ?.topology?.values
    ).toMatchObject({
      establishmentEpoch: { state: "real", value: 2 },
      establishmentId: { state: "real", value: "establishment:subscription-1:2" }
    });

    client.status = "DISCONNECTED";
    client.sessionId = null;
    client.listeners[0]?.onStatusChange?.("DISCONNECTED");
    records = syncRecords(host, listeners, frames);
    expect(records.some((record) => record.kind === "session")).toBe(false);
    expect(records.some((record) => record.kind === "establishment")).toBe(false);
    expect(records.find((record) => record.kind === "subscription")?.serverEstablished).toBe(false);

    client.status = "CONNECTED:WS-STREAMING";
    client.sessionId = "session-b";
    client.listeners[0]?.onPropertyChange?.("sessionId");
    records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "session")?.values).toMatchObject({
      sessionId: { state: "real", value: "session-b" }
    });
    expect(records.some((record) => record.kind === "establishment")).toBe(false);

    subscription.listeners[0]?.onSubscription?.();
    records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "establishment")?.id).toMatch(/:3$/);
  });

  it("creates distinct COMMAND generations and inferred second-level children", () => {
    const { host, messages, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(
      "COMMAND",
      ["orders"],
      ["command", "key", "qty"]
    );
    client.subscribe(subscription);
    subscription.addListener({
      onItemUpdate: () => undefined,
      onCommandSecondLevelItemLostUpdates: () => undefined
    });
    const update = (command: string) => ({
      forEachField(iterator: (name: string, position: number, value: string) => void) {
        iterator("command", 1, command);
        iterator("key", 2, "order-1");
        iterator("qty", 3, "10");
      },
      forEachChangedField(iterator: (name: string, position: number, value: string) => void) {
        this.forEachField(iterator);
      },
      getItemName: () => "orders",
      getItemPos: () => 1,
      isSnapshot: () => false
    });

    subscription.listeners[0]?.onItemUpdate?.(update("ADD"));
    let records = syncRecords(host, listeners, frames);
    const firstGeneration = records.find((record) => record.kind === "command-generation")?.id;
    expect(firstGeneration).toMatch(/:1$/);
    expect(
      messages.filter((message) => message.topology?.kind === "command-key-generation").at(-1)
        ?.topology?.values
    ).toMatchObject({
      generationEpoch: { state: "real", value: 1 },
      generationId: {
        state: "real",
        value: "command-generation:subscription-1:item:subscription-1:1:order-1:1"
      }
    });

    subscription.listeners[0]?.onItemUpdate?.(update("DELETE"));
    records = syncRecords(host, listeners, frames);
    expect(records.some((record) => record.kind === "command-generation")).toBe(false);
    expect(records.some((record) => record.kind === "inferred-child")).toBe(false);
    expect(
      messages.filter((message) => message.topology?.kind === "command-key-generation").at(-1)
        ?.topology?.values
    ).toMatchObject({
      command: { state: "real", value: "DELETE" },
      generationEpoch: { state: "real", value: 1 },
      generationId: {
        state: "real",
        value: "command-generation:subscription-1:item:subscription-1:1:order-1:1"
      }
    });

    subscription.listeners[0]?.onItemUpdate?.(update("ADD"));
    (
      subscription.listeners[0] as {
        onCommandSecondLevelItemLostUpdates?(lostUpdates: number, key: string): void;
      }
    )?.onCommandSecondLevelItemLostUpdates?.(3, "order-1");
    records = syncRecords(host, listeners, frames);
    const secondGeneration = records.find((record) => record.kind === "command-generation");
    expect(secondGeneration?.id).toMatch(/:2$/);
    expect(secondGeneration?.id).not.toBe(firstGeneration);
    expect(
      messages.filter((message) => message.topology?.kind === "command-key-generation").at(-1)
        ?.topology?.values
    ).toMatchObject({
      generationEpoch: { state: "real", value: 2 },
      generationId: {
        state: "real",
        value: "command-generation:subscription-1:item:subscription-1:1:order-1:2"
      }
    });
    expect(records.find((record) => record.kind === "inferred-child")).toMatchObject({
      parentId: secondGeneration?.id,
      subscriptionId: "subscription-1",
      values: {
        generationId: secondGeneration?.id,
        provenance: "inferred-second-level"
      }
    });
  });

  it.each([
    ["onEndOfSnapshot", "end-of-snapshot", ["orders", 1]],
    ["onItemLostUpdates", "lost-updates", ["orders", 1, 4]],
    ["onClearSnapshot", "clear-snapshot", ["orders", 1]]
  ] as const)("retains %s as the item checkpoint capture kind", (callback, captureKind, args) => {
    const { host, listeners, frames } = createSemanticHarness();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription("COMMAND", ["orders"], ["command", "key"]);
    client.subscribe(subscription);
    const listener = {
      onEndOfSnapshot: () => undefined,
      onItemLostUpdates: () => undefined,
      onClearSnapshot: () => undefined
    };
    subscription.addListener(listener);
    const installed = subscription.listeners[0] as Record<string, (...values: unknown[]) => void>;
    installed[callback]?.(...args);

    const records = syncRecords(host, listeners, frames);
    expect(records.find((record) => record.kind === "item")?.values).toMatchObject({
      captureKind,
      item: { name: "orders", position: 1 },
      ...(captureKind === "lost-updates" ? { update: { lostUpdates: 4 } } : {})
    });
  });
});
