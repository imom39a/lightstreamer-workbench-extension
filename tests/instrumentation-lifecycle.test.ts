import { describe, expect, it, vi } from "vitest";

import {
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PAGE_REINJECT_REQUEST,
  RUNTIME_REINJECT_RESULT,
  type CaptureMessage,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  isRuntimeReinjectResultMessage
} from "../src/bridge/messages";
import { reduceCommandState } from "../src/core/command-state";
import { createEventNormalizer } from "../src/core/event-normalizer";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

class FakeLightstreamerClient {
  connectCalls = 0;
  disconnectCalls = 0;
  subscribeCalls = 0;
  unsubscribeCalls = 0;
  listeners: unknown[] = [];

  constructor(
    readonly serverAddress: string,
    readonly adapterSet: string
  ) {}

  connect() {
    this.connectCalls += 1;
    return "connect-result";
  }

  disconnect() {
    this.disconnectCalls += 1;
    return "disconnect-result";
  }

  subscribe(subscription: unknown) {
    this.subscribeCalls += 1;
    return subscription;
  }

  unsubscribe(subscription: unknown) {
    this.unsubscribeCalls += 1;
    return subscription;
  }

  addListener(listener: unknown) {
    this.listeners.push(listener);
    return "client-listener-added";
  }

  getStatus() {
    return "CONNECTED:WS-STREAMING";
  }
}

class FakeSubscription {
  addListenerCalls = 0;
  removeListenerCalls = 0;
  listeners: unknown[] = [];

  constructor(
    readonly mode: string,
    readonly items: string[],
    readonly fields: string[]
  ) {}

  addListener(listener: unknown) {
    this.addListenerCalls += 1;
    this.listeners.push(listener);
    return "subscription-listener-added";
  }

  removeListener(listener: unknown) {
    this.removeListenerCalls += 1;
    return listener;
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

  getRequestedSnapshot() {
    return "yes";
  }
}

class FakeSubscriptionWithPendingCommandPositions extends FakeSubscription {
  getKeyPosition(): number {
    throw new Error("The position of the key field is currently unknown");
  }

  getCommandPosition(): number {
    throw new Error("The position of the command field is currently unknown");
  }
}

class TopologyFakeLightstreamerClient extends FakeLightstreamerClient {
  static readonly LIB_VERSION = "9.2.3";

  status = "DISCONNECTED";
  sessionId: string | null = null;
  clientIp: string | null = null;
  readonly connectionDetails = {
    getServerAddress: () => this.serverAddress,
    getAdapterSet: () => this.adapterSet,
    getSessionId: () => this.sessionId,
    getServerInstanceAddress: () =>
      this.sessionId ? "https://node-a.example.test/lightstreamer" : null,
    getServerSocketName: () => (this.sessionId ? "node-a" : null),
    getClientIp: () => this.clientIp
  };
  readonly connectionOptions = {
    getRequestedMaxBandwidth: () => "unlimited",
    getRealMaxBandwidth: () => (this.sessionId ? 25 : null),
    getKeepaliveInterval: () => 5_000,
    getRetryDelay: () => 4_000,
    getFirstRetryMaxDelay: () => 100,
    getStalledTimeout: () => 2_000,
    getReconnectTimeout: () => 3_000,
    getSessionRecoveryTimeout: () => 15_000,
    getForcedTransport: () => null
  };

  override getStatus() {
    return this.status;
  }

  override subscribe(subscription: unknown) {
    if (subscription instanceof TopologyFakeSubscription) {
      subscription.active = true;
    }
    return super.subscribe(subscription);
  }
}

class TopologyFakeSubscription extends FakeSubscription {
  active = false;
  subscribed = false;

  getDataAdapter() {
    return "QUOTE";
  }

  getSelector() {
    return "desk-a";
  }

  getRequestedBufferSize() {
    return "10";
  }

  getRequestedMaxFrequency() {
    return "2";
  }

  getListeners() {
    return this.listeners;
  }

  isActive() {
    return this.active;
  }

  isSubscribed() {
    return this.subscribed;
  }
}

class FakeItemGroupSubscription {
  listeners: unknown[] = [];

  constructor(
    readonly mode: string,
    readonly itemGroup: string,
    readonly fieldSchema: string
  ) {}

  addListener(listener: unknown) {
    this.listeners.push(listener);
    return "subscription-listener-added";
  }

  getMode() {
    return this.mode;
  }

  getItems(): never {
    throw new Error("This Subscription was initiated using an item group");
  }

  getItemGroup() {
    return this.itemGroup;
  }

  getFields(): never {
    throw new Error("This Subscription was initiated using a field schema");
  }

  getFieldSchema() {
    return this.fieldSchema;
  }

  getRequestedSnapshot() {
    return "yes";
  }
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  sent: unknown[] = [];
  readyState = FakeWebSocket.OPEN;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private messageListeners: Array<(event: MessageEvent) => void> = [];
  private closeListeners: Array<(event: CloseEvent) => void> = [];

  constructor(readonly url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(data);
  }

  addEventListener(
    type: string,
    listener: ((event: MessageEvent) => void) | ((event: CloseEvent) => void)
  ) {
    if (type === "message") {
      this.messageListeners.push(listener as (event: MessageEvent) => void);
    } else if (type === "close") {
      this.closeListeners.push(listener as (event: CloseEvent) => void);
    }
  }

  emitMessage(data: string) {
    this.dispatchEvent({ type: "message", data } as unknown as MessageEvent);
  }

  dispatchEvent(event: Event) {
    if (event.type !== "message") {
      return true;
    }
    const messageEvent = event as MessageEvent;
    for (const listener of this.messageListeners) {
      listener(messageEvent);
    }
    this.onmessage?.(messageEvent);
    return !messageEvent.defaultPrevented;
  }

  emitClose(code = 1006, reason = "connection lost", wasClean = false) {
    for (const listener of this.closeListeners) {
      listener({ code, reason, wasClean } as CloseEvent);
    }
  }
}

function createInstrumentedTarget() {
  const messages: CaptureMessage[] = [];
  const target = {
    LightstreamerClient: FakeLightstreamerClient,
    Subscription: FakeSubscription
  };

  installLightstreamerInstrumentation(target, (message) => {
    messages.push(message as CaptureMessage);
  });

  return { target, messages };
}

function createInstrumentedTargetWithPageMessages() {
  const messages: unknown[] = [];
  const messageListeners: Array<(event: MessageEvent) => void> = [];
  const target = {
    LightstreamerClient: FakeLightstreamerClient,
    Subscription: FakeSubscription,
    addEventListener(type: "message", listener: (event: MessageEvent) => void) {
      if (type === "message") {
        messageListeners.push(listener);
      }
    }
  };

  installLightstreamerInstrumentation(target, (message) => {
    messages.push(message);
  });

  return { target, messages, messageListeners };
}

describe("Lightstreamer lifecycle instrumentation", () => {
  it("installs passively without creating a client, socket, or connection", () => {
    let clientConstructionCount = 0;
    let socketConstructionCount = 0;
    class PageOwnedClient extends FakeLightstreamerClient {
      constructor(serverAddress: string, adapterSet: string) {
        super(serverAddress, adapterSet);
        clientConstructionCount += 1;
      }
    }
    class PageOwnedWebSocket {
      constructor() {
        socketConstructionCount += 1;
      }
    }
    const messages: CaptureMessage[] = [];
    const target = {
      LightstreamerClient: PageOwnedClient,
      Subscription: FakeSubscription,
      WebSocket: PageOwnedWebSocket as unknown as typeof WebSocket
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    expect(clientConstructionCount).toBe(0);
    expect(socketConstructionCount).toBe(0);
    expect(messages).toEqual([]);

    const client = new target.LightstreamerClient(
      "https://push.example.test/lightstreamer",
      "DEMO"
    );
    expect(clientConstructionCount).toBe(1);
    expect(client.connectCalls).toBe(0);
    expect(messages.map(({ kind }) => kind)).toEqual(["client-created"]);
  });

  it("captures public client, session, option, and subscription topology metadata", () => {
    const messages: CaptureMessage[] = [];
    const target = {
      LightstreamerClient: TopologyFakeLightstreamerClient,
      Subscription: TopologyFakeSubscription
    };
    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const client = new target.LightstreamerClient(
      "https://push.example.test/lightstreamer",
      "DEMO"
    );
    const clientListener = {
      onStatusChange: vi.fn(),
      onPropertyChange: vi.fn()
    };
    client.addListener(clientListener);

    const created = messages.find((message) => message.kind === "client-created");
    expect(created?.payload.client).toMatchObject({
      libraryVersion: "9.2.3",
      instrumentationSource: "public-api",
      coverageStatus: "full",
      requestedMaxBandwidth: "unlimited",
      keepaliveInterval: 5_000,
      retryDelay: 4_000,
      stalledTimeout: 2_000,
      reconnectTimeout: 3_000,
      sessionRecoveryTimeout: 15_000
    });

    client.status = "CONNECTED:WS-STREAMING";
    client.sessionId = "session-A";
    client.clientIp = "203.0.113.42";
    clientListener.onPropertyChange("sessionId");

    const propertyChange = messages.find(
      (message) =>
        message.kind === "client-status" &&
        (message.payload.raw as { callback?: string } | undefined)?.callback ===
          "onPropertyChange"
    );
    expect(propertyChange?.payload.client).toMatchObject({
      status: "CONNECTED:WS-STREAMING",
      sessionId: "session-A",
      transport: "ws-streaming",
      serverSocketName: "node-a",
      clientIp: "203.0.113.0/24",
      realMaxBandwidth: 25
    });

    client.clientIp = "::ffff:203.0.113.42";
    clientListener.onPropertyChange("clientIp");
    const latestPropertyChange = messages
      .filter(
        (message) =>
          message.kind === "client-status" &&
          (message.payload.raw as { callback?: string } | undefined)?.callback ===
            "onPropertyChange"
      )
      .at(-1);
    expect(latestPropertyChange?.payload.client).toMatchObject({
      clientIp: "203.0.113.0/24"
    });

    const subscription = new target.Subscription(
      "COMMAND",
      ["portfolio"],
      ["command", "key", "price"]
    );
    const subscriptionListener = {
      onSubscription: vi.fn(),
      onRealMaxFrequency: vi.fn(),
      onItemLostUpdates: vi.fn()
    };
    subscription.addListener(subscriptionListener);
    client.subscribe(subscription);
    subscription.subscribed = true;
    (
      subscription.listeners[0] as {
        onSubscription(): void;
        onRealMaxFrequency(frequency: string): void;
        onItemLostUpdates(name: string, position: number, lost: number): void;
      }
    ).onSubscription();
    (
      subscription.listeners[0] as {
        onRealMaxFrequency(frequency: string): void;
      }
    ).onRealMaxFrequency("1.5");
    (
      subscription.listeners[0] as {
        onItemLostUpdates(name: string, position: number, lost: number): void;
      }
    ).onItemLostUpdates("portfolio", 1, 3);

    expect(
      messages.find((message) => message.kind === "subscription-frequency")?.payload
        .subscription
    ).toMatchObject({
      selector: "desk-a",
      requestedBufferSize: "10",
      requestedMaxFrequency: "2",
      realMaxFrequency: "1.5",
      active: true,
      subscribed: true,
      listenerCount: 1
    });
    expect(
      messages.find((message) => message.kind === "lost-updates")?.payload
    ).toMatchObject({
      item: { name: "portfolio", position: 1 },
      update: { lostUpdates: 3 }
    });
  });

  it("instruments constructors assigned after document_start installation", () => {
    const messages: CaptureMessage[] = [];
    const target: Record<string, unknown> = {};

    expect(
      installLightstreamerInstrumentation(target, (message) => {
        messages.push(message as CaptureMessage);
      })
    ).toBe(true);

    target.LightstreamerClient = FakeLightstreamerClient;
    target.Subscription = FakeSubscription;

    const Client = target.LightstreamerClient as typeof FakeLightstreamerClient;
    const Subscription = target.Subscription as typeof FakeSubscription;
    const client = new Client("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new Subscription("COMMAND", ["scenario"], ["command", "key"]);

    client.subscribe(subscription);

    expect(messages.map((message) => message.kind)).toContain("client-created");
    expect(messages.map((message) => message.kind)).toContain("subscription-started");
  });

  it("instruments constructors assigned through the Lightstreamer namespace", () => {
    const messages: CaptureMessage[] = [];
    const target: {
      Lightstreamer: {
        LightstreamerClient?: typeof FakeLightstreamerClient;
        Subscription?: typeof FakeSubscription;
      };
    } = { Lightstreamer: {} };

    expect(
      installLightstreamerInstrumentation(target, (message) => {
        messages.push(message as CaptureMessage);
      })
    ).toBe(true);

    target.Lightstreamer.LightstreamerClient = FakeLightstreamerClient;
    target.Lightstreamer.Subscription = FakeSubscription;

    const Client = target.Lightstreamer.LightstreamerClient;
    const Subscription = target.Lightstreamer.Subscription;
    const client = new Client("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new Subscription("COMMAND", ["scenario"], ["command", "key"]);

    client.subscribe(subscription);

    expect(messages.map((message) => message.kind)).toContain("client-created");
    expect(messages.map((message) => message.kind)).toContain("subscription-created");
    expect(messages.map((message) => message.kind)).toContain("subscription-started");
  });

  it("instruments constructors assigned after the Lightstreamer namespace appears late", () => {
    const messages: CaptureMessage[] = [];
    const target: {
      Lightstreamer?: {
        LightstreamerClient?: typeof FakeLightstreamerClient;
        Subscription?: typeof FakeSubscription;
      };
    } = {};

    expect(
      installLightstreamerInstrumentation(target, (message) => {
        messages.push(message as CaptureMessage);
      })
    ).toBe(true);

    target.Lightstreamer = {};
    target.Lightstreamer.LightstreamerClient = FakeLightstreamerClient;
    target.Lightstreamer.Subscription = FakeSubscription;

    const Client = target.Lightstreamer.LightstreamerClient;
    const Subscription = target.Lightstreamer.Subscription;
    const client = new Client("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new Subscription("COMMAND", ["scenario"], ["command", "key"]);

    client.subscribe(subscription);

    expect(messages.map((message) => message.kind)).toContain("client-created");
    expect(messages.map((message) => message.kind)).toContain("subscription-created");
    expect(messages.map((message) => message.kind)).toContain("subscription-started");
  });

  it("wraps lifecycle methods while preserving original call behavior", () => {
    const { target } = createInstrumentedTarget();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key"]);
    const listener = { onEndOfSnapshot: () => "snapshot-result" };

    expect(client.connect()).toBe("connect-result");
    expect(client.disconnect()).toBe("disconnect-result");
    expect(client.subscribe(subscription)).toBe(subscription);
    expect(subscription.addListener(listener)).toBe("subscription-listener-added");
    expect(
      (subscription.listeners[0] as { onEndOfSnapshot(): string }).onEndOfSnapshot()
    ).toBe("snapshot-result");

    expect(client.connectCalls).toBe(1);
    expect(client.disconnectCalls).toBe(1);
    expect(client.subscribeCalls).toBe(1);
    expect(subscription.addListenerCalls).toBe(1);
  });

  it("keeps client, subscription, and listener IDs stable across related events", () => {
    const { target, messages } = createInstrumentedTarget();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key"]);
    const listener = { onEndOfSnapshot: () => undefined };

    client.connect();
    client.subscribe(subscription);
    subscription.addListener(listener);
    (subscription.listeners[0] as { onEndOfSnapshot(): void }).onEndOfSnapshot();

    const clientIds = messages
      .map((message) => message.payload.client)
      .filter(Boolean)
      .map((clientPayload) => (clientPayload as { id: string }).id);
    const subscriptionIds = messages
      .map((message) => message.payload.subscription)
      .filter(Boolean)
      .map((subscriptionPayload) => (subscriptionPayload as { id: string }).id);
    const listenerIds = messages
      .map((message) => message.payload.listener)
      .filter(Boolean)
      .map((listenerPayload) => (listenerPayload as { id: string }).id);

    expect(new Set(clientIds)).toEqual(new Set(["client-1"]));
    expect(new Set(subscriptionIds)).toEqual(new Set(["subscription-1"]));
    expect(new Set(listenerIds)).toEqual(new Set(["listener-1"]));
    expect(messages.map((message) => message.kind)).toContain("end-of-snapshot");
  });

  it("includes subscription metadata on listener-captured item updates", () => {
    const { target, messages } = createInstrumentedTarget();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key", "qty"]);
    const listener = {
      onItemUpdate(_update: unknown) {
        return undefined;
      }
    };

    client.subscribe(subscription);
    subscription.addListener(listener);
    (subscription.listeners[0] as { onItemUpdate(update: unknown): void }).onItemUpdate(
      createFakeItemUpdate("scenario", "alpha", "10")
    );

    const update = messages.find((message) => message.kind === "item-update");
    expect(update?.payload).toMatchObject({
      subscription: {
        id: "subscription-1",
        mode: "COMMAND",
        items: ["scenario"],
        fields: ["command", "key", "qty"],
        requestedSnapshot: "yes"
      },
      update: {
        command: "ADD",
        key: "alpha"
      }
    });
  });

  it("assigns one logical update id across listener deliveries and identifies the metric owner", () => {
    const { target, messages } = createInstrumentedTarget();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription(
      "COMMAND",
      ["scenario"],
      ["command", "key", "qty"]
    );
    const firstListener = { onItemUpdate: vi.fn() };
    const secondListener = { onItemUpdate: vi.fn() };

    client.subscribe(subscription);
    subscription.addListener(firstListener);
    subscription.addListener(secondListener);

    const update = createFakeItemUpdate("scenario", "alpha", "10");
    (
      subscription.listeners[0] as {
        onItemUpdate(itemUpdate: unknown): void;
      }
    ).onItemUpdate(update);
    (
      subscription.listeners[1] as {
        onItemUpdate(itemUpdate: unknown): void;
      }
    ).onItemUpdate(update);

    const deliveries = messages.filter((message) => message.kind === "item-update");
    expect(deliveries).toHaveLength(2);
    expect(
      deliveries.map((message) => ({
        logicalEventId: (message.payload.raw as { logicalEventId?: string }).logicalEventId,
        listener: message.payload.listener
      }))
    ).toEqual([
      {
        logicalEventId: "update-1",
        listener: expect.objectContaining({
          id: "listener-1",
          metricOwner: true,
          callbacks: ["onItemUpdate"]
        })
      },
      {
        logicalEventId: "update-1",
        listener: expect.objectContaining({
          id: "listener-2",
          metricOwner: false,
          callbacks: ["onItemUpdate"]
        })
      }
    ]);
  });

  it("keeps subscription context when the same listener object is reused", () => {
    const { target, messages } = createInstrumentedTarget();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const firstSubscription = new target.Subscription("COMMAND", ["scenario.alpha"], ["command", "key", "qty"]);
    const secondSubscription = new target.Subscription("COMMAND", ["scenario.beta"], ["command", "key", "qty"]);
    const listener = {
      receivedCount: 0,
      onItemUpdate() {
        this.receivedCount += 1;
      }
    };

    client.subscribe(firstSubscription);
    client.subscribe(secondSubscription);
    firstSubscription.addListener(listener);
    secondSubscription.addListener(listener);

    const firstAttachedListener = firstSubscription.listeners[0] as {
      onItemUpdate(update: unknown): void;
    };
    const secondAttachedListener = secondSubscription.listeners[0] as {
      onItemUpdate(update: unknown): void;
    };

    firstAttachedListener.onItemUpdate(createFakeItemUpdate("scenario.alpha", "alpha", "10"));
    secondAttachedListener.onItemUpdate(createFakeItemUpdate("scenario.beta", "beta", "20"));

    const updates = messages.filter((message) => message.kind === "item-update");
    expect(listener.receivedCount).toBe(2);
    expect(
      updates.map((message) => ({
        subscriptionId: (message.payload.subscription as { id: string }).id,
        itemName: (message.payload.item as { name: string }).name,
        key: (message.payload.update as { key: string }).key
      }))
    ).toEqual([
      { subscriptionId: "subscription-1", itemName: "scenario.alpha", key: "alpha" },
      { subscriptionId: "subscription-2", itemName: "scenario.beta", key: "beta" }
    ]);
  });

  it("captures Lightstreamer TLCP traffic through the WebSocket fallback", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: { WebSocket: typeof WebSocket } = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const socket = new target.WebSocket(
      "wss://push.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      [
        "control",
        "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=scenario.alpha+scenario.beta&LS_schema=command+key+qty+status&LS_mode=COMMAND&LS_snapshot=true"
      ].join("\n")
    );
    socket.emitMessage(
      [
        "CONOK,S1,50000,5000,*",
        "SUBCMD,1,2,4,2,1",
        "U,1,1,ADD|alpha|10|open",
        "U,1,1,||11|",
        "EOS,1,1",
        "U,1,1,||12|closed"
      ].join("\n")
    );

    const updates = messages.filter((message) => message.kind === "item-update");

    expect(messages.map((message) => message.kind)).toEqual([
      "client-created",
      "subscription-created",
      "client-status",
      "subscription-started",
      "item-update",
      "item-update",
      "end-of-snapshot",
      "item-update"
    ]);
    expect(messages[0].payload.raw).toMatchObject({ captureSource: "websocket-tlcp" });
    expect(updates[0].payload).toMatchObject({
      subscription: { id: "subscription-1", mode: "COMMAND" },
      item: { name: "scenario.alpha", position: 1 },
      update: {
        isSnapshot: true,
        command: "ADD",
        key: "alpha",
        fields: { command: "ADD", key: "alpha", qty: "10", status: "open" },
        changedFields: { command: "ADD", key: "alpha", qty: "10", status: "open" }
      }
    });
    expect(updates[1].payload).toMatchObject({
      update: {
        isSnapshot: true,
        command: "ADD",
        key: "alpha",
        fields: { command: "ADD", key: "alpha", qty: "11", status: "open" },
        changedFields: { qty: "11" }
      }
    });
    expect(updates[2].payload).toMatchObject({
      update: {
        isSnapshot: false,
        fields: { command: "ADD", key: "alpha", qty: "12", status: "closed" },
        changedFields: { qty: "12", status: "closed" }
      }
    });
  });

  it("locally delivers a mutated wire COMMAND update through the captured WebSocket", () => {
    FakeWebSocket.instances = [];
    const messages: unknown[] = [];
    const pageMessageListeners: Array<(event: MessageEvent) => void> = [];
    const target = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") {
          pageMessageListeners.push(listener);
        }
      }
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message);
    });

    const socket = new target.WebSocket(
      "wss://push.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      "LS_reqId=1&LS_op=add&LS_subId=3&LS_group=snappHome.SNAPP&LS_schema=key+command+modelId+modelValues&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage(
      "SUBCMD,3,1,4,1,2\nU,3,1,MESSENGER_TICKER_6675530.MESSENGER|ADD|MESSENGER|%7B%22messageText%22%3A%22Attention%22%7D"
    );

    const applicationFrames: string[] = [];
    socket.addEventListener("message", (event: MessageEvent) => {
      applicationFrames.push(String(event.data));
    });
    const capturedUpdatesBeforeReplay = messages.filter(
      (message) => (message as CaptureMessage).kind === "item-update"
    ).length;

    const wireDraft = (modelValues: string): ReinjectionDraftPayload => ({
      sourceEventId: "event-17",
      executionTarget: "captured-wire",
      target: {
        subscriptionId: "subscription-1",
        listenerId: null
      },
      item: {
        name: "snappHome.SNAPP",
        position: 1
      },
      command: "ADD",
      key: "MESSENGER_TICKER_6675530.MESSENGER",
      fields: {
        key: "MESSENGER_TICKER_6675530.MESSENGER",
        command: "ADD",
        modelId: "MESSENGER",
        modelValues
      },
      changedFields: { modelValues },
      isSnapshot: true,
      provenance: {
        source: "clone",
        sourceEventKind: "item-update",
        sourceSynthetic: false
      }
    });
    const sendWireReplay = (requestId: string, modelValues: string) => {
      pageMessageListeners[0]?.({
        source: target,
        data: {
          type: PAGE_REINJECT_REQUEST,
          requestId,
          draft: wireDraft(modelValues)
        }
      } as unknown as MessageEvent);
    };

    sendWireReplay("wire-request-1", '{"messageText":"!!!!Attention | # $ %"}');

    expect(applicationFrames).toEqual([
      "U,3,1,MESSENGER_TICKER_6675530.MESSENGER|ADD|MESSENGER|%7B%22messageText%22%3A%22!!!!Attention%20%7C%20%23%20%24%20%25%22%7D\r\n"
    ]);
    expect(
      messages.filter((message) => (message as CaptureMessage).kind === "item-update")
    ).toHaveLength(capturedUpdatesBeforeReplay);
    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "wire-request-1" &&
          message.result.status === "success"
      )
    ).toBe(true);

    applicationFrames.length = 0;
    sendWireReplay("wire-request-invalid-unicode", "\ud800");
    expect(applicationFrames).toEqual([]);
    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "wire-request-invalid-unicode" &&
          message.result.status === "wire-error"
      )
    ).toBe(true);

    applicationFrames.length = 0;
    const directBridge = (target as Record<string, unknown>)[PAGE_REINJECTION_BRIDGE_GLOBAL] as {
      version: number;
      reinject(requestId: string, draft: ReinjectionDraftPayload): ReinjectionResult;
    };
    expect(directBridge.version).toBe(PAGE_REINJECTION_BRIDGE_VERSION);
    const directResult = directBridge.reinject(
      "wire-request-direct",
      wireDraft('{"messageText":"Direct inspected-page delivery"}')
    );
    expect(directResult).toMatchObject({
      requestId: "wire-request-direct",
      ok: true,
      status: "success"
    });
    expect(applicationFrames).toEqual([
      "U,3,1,MESSENGER_TICKER_6675530.MESSENGER|ADD|MESSENGER|%7B%22messageText%22%3A%22Direct%20inspected-page%20delivery%22%7D\r\n"
    ]);
  });

  it.each(["socket close", "subscription delete"])(
    "rejects captured-wire replay after %s without dispatching an application frame",
    (retirement) => {
      FakeWebSocket.instances = [];
      const messages: unknown[] = [];
      const pageMessageListeners: Array<(event: MessageEvent) => void> = [];
      const target = {
        WebSocket: FakeWebSocket as unknown as typeof WebSocket,
        addEventListener(type: string, listener: (event: MessageEvent) => void) {
          if (type === "message") {
            pageMessageListeners.push(listener);
          }
        }
      };

      installLightstreamerInstrumentation(target, (message) => {
        messages.push(message);
      });

      const socket = new target.WebSocket(
        "wss://push.example.test/lightstreamer"
      ) as unknown as FakeWebSocket;
      socket.send(
        "LS_reqId=1&LS_op=add&LS_subId=3&LS_group=snappHome.SNAPP&LS_schema=key+command+modelId+modelValues&LS_mode=COMMAND&LS_snapshot=true"
      );
      socket.emitMessage(
        "SUBCMD,3,1,4,1,2\nU,3,1,MESSENGER_TICKER_6675530.MESSENGER|ADD|MESSENGER|%7B%22messageText%22%3A%22Attention%22%7D"
      );

      const applicationFrames: string[] = [];
      socket.addEventListener("message", (event: MessageEvent) => {
        applicationFrames.push(String(event.data));
      });
      if (retirement === "socket close") {
        socket.emitClose();
      } else {
        socket.send("LS_reqId=2&LS_op=delete&LS_subId=3");
      }

      pageMessageListeners[0]?.({
        source: target,
        data: {
          type: PAGE_REINJECT_REQUEST,
          requestId: `stale-${retirement}`,
          draft: {
            sourceEventId: "event-17",
            executionTarget: "captured-wire",
            target: { subscriptionId: "subscription-1", listenerId: null },
            item: { name: "snappHome.SNAPP", position: 1 },
            command: "ADD",
            key: "MESSENGER_TICKER_6675530.MESSENGER",
            fields: {
              key: "MESSENGER_TICKER_6675530.MESSENGER",
              command: "ADD",
              modelId: "MESSENGER",
              modelValues: '{"messageText":"mutated"}'
            },
            changedFields: { modelValues: '{"messageText":"mutated"}' },
            isSnapshot: true,
            provenance: {
              source: "clone",
              sourceEventKind: "item-update",
              sourceSynthetic: false
            }
          }
        }
      } as unknown as MessageEvent);

      expect(applicationFrames).toEqual([]);
      expect(
        messages.some(
          (message) =>
            isRuntimeReinjectResultMessage(message) &&
            message.result.requestId === `stale-${retirement}` &&
            message.result.status === "stale-target"
        )
      ).toBe(true);
    }
  );

  it("keeps fallback subscription identities unique across Lightstreamer connections", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: { WebSocket: typeof WebSocket } = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const metadataSocket = new target.WebSocket(
      "wss://metadata.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;
    const orderSocket = new target.WebSocket(
      "wss://orders.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;

    metadataSocket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=metadata%3Asession&LS_schema=command+key&LS_mode=COMMAND&LS_snapshot=true"
    );
    orderSocket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=orderDetail.STORE_NYC_20260716&LS_schema=command+key&LS_mode=COMMAND&LS_snapshot=true"
    );
    metadataSocket.emitMessage("SUBCMD,1,1,2,2,1\nU,1,1,ADD|session-key");
    orderSocket.emitMessage("SUBCMD,1,1,2,2,1\nU,1,1,ADD|order-key");

    const normalizer = createEventNormalizer();
    const state = reduceCommandState(messages.map((message) => normalizer.normalize(message)));

    expect(state.subscriptions.map((subscription) => subscription.subscriptionId)).toEqual([
      "subscription-1",
      "subscription-2"
    ]);
    expect(
      state.subscriptions.map((subscription) => ({
        subscriptionId: subscription.subscriptionId,
        itemNames: subscription.items.map((item) => item.itemName),
        keys: subscription.items.flatMap((item) => item.activeRows.map((row) => row.key))
      }))
    ).toEqual([
      {
        subscriptionId: "subscription-1",
        itemNames: ["metadata:session"],
        keys: ["session-key"]
      },
      {
        subscriptionId: "subscription-2",
        itemNames: ["orderDetail.STORE_NYC_20260716"],
        keys: ["order-key"]
      }
    ]);
  });

  it("retires fallback subscriptions on socket close before sync or API handoff", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const messageListeners: Array<(event: MessageEvent) => void> = [];
    const target: {
      LightstreamerClient?: typeof FakeLightstreamerClient;
      Subscription?: typeof FakeSubscription;
      WebSocket: typeof WebSocket;
      addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    } = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      addEventListener(type, listener) {
        if (type === "message") {
          messageListeners.push(listener);
        }
      }
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const staleSocket = new target.WebSocket(
      "ws://localhost:8080/lightstreamer"
    ) as unknown as FakeWebSocket;
    staleSocket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=shared.orders&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
    );
    staleSocket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|stale-key|1");
    staleSocket.emitClose();

    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "subscription-ended",
        payload: expect.objectContaining({
          subscription: expect.objectContaining({ id: "subscription-1" }),
          raw: expect.objectContaining({
            captureSource: "websocket-tlcp",
            frameDirection: "close",
            code: 1006
          })
        })
      })
    );

    messages.length = 0;
    for (const listener of messageListeners) {
      listener({
        source: target,
        data: { type: "lsew:page-capture-sync-request" }
      } as unknown as MessageEvent);
    }
    expect(messages).toEqual([]);

    const currentSocket = new target.WebSocket(
      "ws://localhost:8080/lightstreamer"
    ) as unknown as FakeWebSocket;
    currentSocket.send(
      "LS_reqId=2&LS_op=add&LS_subId=1&LS_group=shared.orders&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
    );
    currentSocket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|current-key|2");

    target.LightstreamerClient = FakeLightstreamerClient;
    target.Subscription = FakeSubscription;
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    client.subscribe(
      new target.Subscription("COMMAND", ["shared.orders"], ["command", "key", "qty"])
    );

    expect(
      messages.filter(
        (message) =>
          message.kind === "subscription-ended" &&
          (message.payload.raw as { captureHandoff?: string } | undefined)?.captureHandoff ===
            "primary-api"
      )
    ).toHaveLength(1);
  });

  it("ignores queued wire frames after delete without allocating a phantom identity", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: { WebSocket: typeof WebSocket } = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const socket = new target.WebSocket(
      "wss://push.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=scenario.alpha&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|alpha|1");
    const originalSubscriptionId = (
      messages.find((message) => message.kind === "subscription-started")?.payload
        .subscription as { id: string }
    ).id;

    socket.send("LS_reqId=2&LS_op=delete&LS_subId=1");
    messages.length = 0;
    socket.emitMessage("U,1,1,||2\nUNSUB,1");

    expect(messages).toEqual([]);

    socket.send(
      "LS_reqId=3&LS_op=add&LS_subId=1&LS_group=scenario.alpha&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|bravo|3");
    const replacementSubscriptionId = (
      messages.find((message) => message.kind === "subscription-started")?.payload
        .subscription as { id: string }
    ).id;

    expect(replacementSubscriptionId).not.toBe(originalSubscriptionId);
    expect(
      messages
        .filter((message) => message.kind === "item-update")
        .map((message) => (message.payload.update as { key: string }).key)
    ).toEqual(["bravo"]);
  });

  it("retires only the matching fallback identity when primary instrumentation takes over", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const messageListeners: Array<(event: MessageEvent) => void> = [];
    const target: {
      LightstreamerClient?: typeof FakeLightstreamerClient;
      Subscription?: typeof FakeSubscription;
      WebSocket: typeof WebSocket;
      addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
    } = {
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      addEventListener(type, listener) {
        if (type === "message") {
          messageListeners.push(listener);
        }
      }
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const socket = new target.WebSocket(
      "ws://localhost:8080/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=customerDetail.DL_173420260716ATL__YYZ__01&LS_schema=command+key+modelId+modelValues&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.send(
      "LS_reqId=2&LS_op=add&LS_subId=2&LS_group=orderDetail.DL_173420260716ATL__YYZ__01&LS_schema=command+key+modelId+modelValues&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage(
      "SUBCMD,1,1,4,2,1\nU,1,1,ADD|customer-1|model-1|active\nSUBCMD,2,1,4,2,1\nU,2,1,ADD|order-1|model-2|active"
    );

    target.LightstreamerClient = FakeLightstreamerClient;
    target.Subscription = FakeSubscription;
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription(
      "COMMAND",
      ["customerDetail.DL_173420260716ATL__YYZ__01"],
      ["command", "key", "modelId", "modelValues"]
    );
    const listener = { onItemUpdate: () => undefined };
    client.subscribe(subscription);
    subscription.addListener(listener);
    (subscription.listeners[0] as { onItemUpdate(update: unknown): void }).onItemUpdate(
      createFakeItemUpdate("customerDetail.DL_173420260716ATL__YYZ__01", "customer-1", "1")
    );
    socket.emitMessage(
      "U,1,1,||model-1|retired-update\nU,2,1,||model-2|current-update"
    );

    expect(
      messages.some(
        (message) =>
          message.kind === "subscription-ended" &&
          (message.payload.raw as { captureHandoff?: string } | undefined)?.captureHandoff ===
            "primary-api"
      )
    ).toBe(true);
    const itemUpdates = messages.filter((message) => message.kind === "item-update");
    expect(
      itemUpdates.map((message) => (message.payload.subscription as { id: string }).id)
    ).toEqual([
      "subscription-1",
      "subscription-2",
      "subscription-3",
      "subscription-3",
      "subscription-2"
    ]);
    expect(itemUpdates[2].payload.raw).toMatchObject({
      captureHandoff: "primary-api",
      commandStateHandoff: true
    });

    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "subscription-ended",
        payload: expect.objectContaining({
          subscription: expect.objectContaining({ id: "subscription-1" }),
          raw: expect.objectContaining({ captureHandoff: "primary-api" })
        })
      })
    );

    const normalizer = createEventNormalizer();
    const commandState = reduceCommandState(
      messages.map((message) => normalizer.normalize(message))
    );
    expect(commandState.subscriptions.map((entry) => entry.subscriptionId)).toEqual([
      "subscription-2",
      "subscription-3"
    ]);

    messages.length = 0;
    for (const pageListener of messageListeners) {
      pageListener({
        source: target,
        data: { type: "lsew:page-capture-sync-request" }
      } as unknown as MessageEvent);
    }
    expect(
      messages
        .filter((message) => message.kind === "subscription-snapshot")
        .map((message) => (message.payload.subscription as { id: string }).id)
    ).toEqual([]);
  });

  it("does not retire an ambiguous fallback identity shared by multiple connections", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: {
      LightstreamerClient?: typeof FakeLightstreamerClient;
      Subscription?: typeof FakeSubscription;
      WebSocket: typeof WebSocket;
    } = { WebSocket: FakeWebSocket as unknown as typeof WebSocket };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    for (const socketUrl of [
      "ws://localhost:8080/lightstreamer",
      "ws://localhost:8080/lightstreamer"
    ]) {
      const socket = new target.WebSocket(socketUrl) as unknown as FakeWebSocket;
      socket.send(
        "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=shared.orders&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
      );
      socket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|shared-key|1");
    }

    target.LightstreamerClient = FakeLightstreamerClient;
    target.Subscription = FakeSubscription;
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    client.subscribe(
      new target.Subscription("COMMAND", ["shared.orders"], ["command", "key", "qty"])
    );

    expect(
      messages.filter(
        (message) =>
          message.kind === "subscription-ended" &&
          (message.payload.raw as { captureHandoff?: string } | undefined)?.captureHandoff ===
            "primary-api"
      )
    ).toEqual([]);
    const normalizer = createEventNormalizer();
    expect(
      reduceCommandState(messages.map((message) => normalizer.normalize(message))).subscriptions
    ).toHaveLength(3);
  });

  it("reconciles wire list metadata with API group and schema metadata", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: {
      LightstreamerClient?: typeof FakeLightstreamerClient;
      Subscription?: typeof FakeItemGroupSubscription;
      WebSocket: typeof WebSocket;
    } = { WebSocket: FakeWebSocket as unknown as typeof WebSocket };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    const socket = new target.WebSocket(
      "ws://localhost:8080/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=group.orders&LS_schema=command+key+qty&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage("SUBCMD,1,1,3,2,1\nU,1,1,ADD|group-key|1");

    target.LightstreamerClient = FakeLightstreamerClient;
    target.Subscription = FakeItemGroupSubscription;
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    client.subscribe(
      new target.Subscription("COMMAND", "group.orders", "command key qty")
    );

    const primaryCreated = messages.find(
      (message) =>
        message.kind === "subscription-created" &&
        (message.payload.subscription as { id?: string } | undefined)?.id === "subscription-2"
    );
    expect(primaryCreated?.payload.subscription).toMatchObject({
      id: "subscription-2",
      mode: "COMMAND",
      itemGroup: "group.orders",
      fieldSchema: "command key qty"
    });
    expect(primaryCreated?.payload.subscription).not.toHaveProperty("items");
    expect(primaryCreated?.payload.subscription).not.toHaveProperty("fields");
    expect(messages).toContainEqual(
      expect.objectContaining({
        kind: "subscription-ended",
        payload: expect.objectContaining({
          subscription: expect.objectContaining({ id: "subscription-1" }),
          raw: expect.objectContaining({ captureHandoff: "primary-api" })
        })
      })
    );
  });

  it("keeps unavailable COMMAND positions out of semantic subscription metadata", () => {
    const messages: CaptureMessage[] = [];
    const target = {
      LightstreamerClient: FakeLightstreamerClient,
      Subscription: FakeSubscriptionWithPendingCommandPositions
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    new target.Subscription(
      "COMMAND",
      ["customerDetail.DL_173420260716ATL__YYZ__01"],
      ["command", "key", "modelId", "modelValues"]
    );

    const created = messages.find((message) => message.kind === "subscription-created");
    expect(created?.payload.subscription).toMatchObject({
      id: "subscription-1",
      mode: "COMMAND",
      items: ["customerDetail.DL_173420260716ATL__YYZ__01"]
    });
    expect(created?.payload.subscription).not.toHaveProperty("keyPosition");
    expect(created?.payload.subscription).not.toHaveProperty("commandPosition");
    expect(created?.payload.raw).toMatchObject({
      subscriptionMetadataErrors: [
        "getKeyPosition:capture-failed",
        "getCommandPosition:capture-failed"
      ]
    });
  });

  it("replays every active subscription when the panel bridge connects late", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const activeSubscription = new target.Subscription(
      "COMMAND",
      ["quiet.orders"],
      ["command", "key"]
    );
    const endedSubscription = new target.Subscription(
      "COMMAND",
      ["ended.orders"],
      ["command", "key"]
    );

    client.subscribe(activeSubscription);
    client.subscribe(endedSubscription);
    client.unsubscribe(endedSubscription);
    messages.length = 0;

    for (const listener of messageListeners) {
      listener({
        source: target,
        data: { type: "lsew:page-capture-sync-request" }
      } as unknown as MessageEvent);
    }

    expect(messages).toEqual([]);
  });

  it("replays current COMMAND rows when the panel bridge connects late", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription(
      "COMMAND",
      ["quiet.orders"],
      ["command", "key", "qty"]
    );
    const listener = { onItemUpdate: () => undefined };

    client.subscribe(subscription);
    subscription.addListener(listener);
    const attachedListener = subscription.listeners[0] as {
      onItemUpdate(update: unknown): void;
    };
    attachedListener.onItemUpdate(createFakeItemUpdate("quiet.orders", "quiet-key", "17"));
    attachedListener.onItemUpdate(
      createFakeCommandItemUpdate("ADD", "quiet.orders", "removed-key", "8", false)
    );
    attachedListener.onItemUpdate(
      createFakeCommandItemUpdate("DELETE", "quiet.orders", "removed-key", "8", false)
    );
    messages.length = 0;

    for (const pageListener of messageListeners) {
      pageListener({
        source: target,
        data: { type: "lsew:page-capture-sync-request" }
      } as unknown as MessageEvent);
    }

    const captureMessages = messages as CaptureMessage[];
    const replays = captureMessages.filter(
      (message) =>
        message.kind === "item-update" &&
        (message.payload.raw as { commandStateSync?: boolean } | undefined)?.commandStateSync
    );
    expect(replays).toHaveLength(1);
    const replay = replays[0];
    expect(replay?.payload).toMatchObject({
      subscription: { id: "subscription-1", mode: "COMMAND" },
      listener: { id: "listener-1" },
      item: { name: "quiet.orders", position: 1 },
      update: {
        command: "ADD",
        key: "quiet-key",
        isSnapshot: true,
        fields: { command: "ADD", key: "quiet-key", qty: "17" }
      },
      raw: { captureSync: true, commandStateSync: true }
    });

    const normalizer = createEventNormalizer();
    const commandState = reduceCommandState(
      captureMessages.map((message) => normalizer.normalize(message))
    );
    expect(commandState.subscriptions[0].items[0].activeRows[0]).toMatchObject({
      key: "quiet-key",
      fields: { command: "ADD", key: "quiet-key", qty: "17" }
    });
  });

  it("does not emit WebSocket fallback rows after primary instrumentation is active", () => {
    FakeWebSocket.instances = [];
    const messages: CaptureMessage[] = [];
    const target: {
      LightstreamerClient: typeof FakeLightstreamerClient;
      Subscription: typeof FakeSubscription;
      WebSocket: typeof WebSocket;
    } = {
      LightstreamerClient: FakeLightstreamerClient,
      Subscription: FakeSubscription,
      WebSocket: FakeWebSocket as unknown as typeof WebSocket
    };

    installLightstreamerInstrumentation(target, (message) => {
      messages.push(message as CaptureMessage);
    });

    new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const socket = new target.WebSocket(
      "wss://push.example.test/lightstreamer"
    ) as unknown as FakeWebSocket;
    socket.send(
      "LS_reqId=1&LS_op=add&LS_subId=1&LS_group=scenario.alpha&LS_schema=command+key&LS_mode=COMMAND&LS_snapshot=true"
    );
    socket.emitMessage("SUBCMD,1,1,2,2,1\nU,1,1,ADD|alpha");

    expect(messages.map((message) => message.kind)).toEqual(["client-created"]);
    expect(
      messages.some((message) => {
        const raw = message.payload.raw;
        return typeof raw === "object" && raw !== null && !Array.isArray(raw) && raw.captureSource === "websocket-tlcp";
      })
    ).toBe(false);
  });

  it("reinjects a synthetic update into the exact captured subscription listener", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key", "price"]);
    const receivedFields: Record<string, unknown> = {};
    const receivedChangedFields: Record<string, unknown> = {};
    const listener = {
      receivedCount: 0,
      receivedItem: null as null | { name: string | null; position: number | null; snapshot: boolean },
      onItemUpdate(update: {
        forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
        forEachChangedField(
          iterator: (fieldName: string, fieldPos: number, value: unknown) => void
        ): void;
        getItemName(): string | null;
        getItemPos(): number | null;
        isSnapshot(): boolean;
        isValueChanged(fieldName: string): boolean;
        getValue(fieldName: string): unknown;
        getValueAsJSONPatchIfAvailable(fieldName: string): unknown;
      }) {
        this.receivedCount += 1;
        update.forEachField((fieldName, _fieldPos, value) => {
          receivedFields[fieldName] = value;
        });
        update.forEachChangedField((fieldName, _fieldPos, value) => {
          receivedChangedFields[fieldName] = value;
        });
        this.receivedItem = {
          name: update.getItemName(),
          position: update.getItemPos(),
          snapshot: update.isSnapshot()
        };
        receivedFields.priceChanged = update.isValueChanged("price");
        receivedFields.missingValue = update.getValue("missing");
        receivedFields.patch = update.getValueAsJSONPatchIfAvailable("price");
      }
    };

    client.subscribe(subscription);
    subscription.addListener(listener);

    const responsePort = {
      postMessage: vi.fn(),
      close: vi.fn()
    } as unknown as MessagePort;
    messageListeners[0]({
      source: target,
      ports: [responsePort],
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "request-1",
        draft: createValidPageDraft()
      }
    } as unknown as MessageEvent);

    expect(listener.receivedCount).toBe(1);
    expect(listener.receivedItem).toEqual({ name: "portfolio", position: 2, snapshot: false });
    expect(receivedFields).toEqual({
      command: "UPDATE",
      key: "item-1",
      price: 101,
      priceChanged: true,
      missingValue: null,
      patch: null
    });
    expect(receivedChangedFields).toEqual({ price: 101 });
    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "request-1" &&
          message.result.status === "success"
      )
    ).toBe(true);
    expect(responsePort.postMessage).toHaveBeenCalledWith({
      type: RUNTIME_REINJECT_RESULT,
      result: expect.objectContaining({
        requestId: "request-1",
        ok: true,
        status: "success"
      })
    });
    expect(responsePort.close).toHaveBeenCalledTimes(1);
  });

  it("preserves subscription field positions for listener-path reinjection", () => {
    const { target, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription(
      "COMMAND",
      ["scenario"],
      ["command", "key", "price"]
    );
    const received: Record<string, unknown> = {};
    const listener = {
      onItemUpdate(update: {
        forEachChangedField(
          iterator: (fieldName: string, fieldPos: number, value: unknown) => void
        ): void;
        getValue(fieldNameOrPos: string | number): unknown;
        isValueChanged(fieldNameOrPos: string | number): boolean;
      }) {
        update.forEachChangedField((fieldName, fieldPos, value) => {
          received.fieldName = fieldName;
          received.fieldPos = fieldPos;
          received.value = value;
          received.valueByPosition = update.getValue(fieldPos);
          received.changedByPosition = update.isValueChanged(fieldPos);
        });
        received.commandByPosition = update.getValue(1);
        received.keyByPosition = update.getValue(2);
      }
    };

    client.subscribe(subscription);
    subscription.addListener(listener);

    messageListeners[0]({
      source: target,
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "request-positional-fields",
        draft: createValidPageDraft()
      }
    } as unknown as MessageEvent);

    expect(received).toEqual({
      fieldName: "price",
      fieldPos: 3,
      value: 101,
      valueByPosition: 101,
      changedByPosition: true,
      commandByPosition: "UPDATE",
      keyByPosition: "item-1"
    });
  });

  it("reinjects non-COMMAND fields without inventing command or key values", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("MERGE", ["portfolio"], ["price", "status"]);
    const receivedFields: Record<string, unknown> = {};
    const receivedChangedFields: Record<string, unknown> = {};
    const listener = {
      onItemUpdate(update: {
        forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
        forEachChangedField(
          iterator: (fieldName: string, fieldPos: number, value: unknown) => void
        ): void;
        getValue(fieldName: string): unknown;
      }) {
        update.forEachField((fieldName, _fieldPos, value) => {
          receivedFields[fieldName] = value;
        });
        update.forEachChangedField((fieldName, _fieldPos, value) => {
          receivedChangedFields[fieldName] = value;
        });
        receivedFields.commandValue = update.getValue("command");
        receivedFields.keyValue = update.getValue("key");
      }
    };

    client.subscribe(subscription);
    subscription.addListener(listener);

    messageListeners[0]({
      source: target,
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "request-merge",
        draft: {
          ...createValidPageDraft(),
          sourceEventId: "event-merge",
          command: null,
          key: null,
          fields: { price: 101, status: "open" },
          changedFields: { price: 101 }
        }
      }
    } as unknown as MessageEvent);

    expect(receivedFields).toEqual({
      price: 101,
      status: "open",
      commandValue: null,
      keyValue: null
    });
    expect(receivedChangedFields).toEqual({ price: 101 });
    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "request-merge" &&
          message.result.status === "success"
      )
    ).toBe(true);
  });

  it("reports stale target when the original subscription listener was removed", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key", "price"]);
    const listener = { onItemUpdate: () => undefined };

    client.subscribe(subscription);
    subscription.addListener(listener);
    subscription.removeListener(listener);

    messageListeners[0]({
      source: target,
      data: {
        type: PAGE_REINJECT_REQUEST,
        requestId: "request-2",
        draft: createValidPageDraft()
      }
    } as unknown as MessageEvent);

    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "request-2" &&
          message.result.status === "stale-target"
      )
    ).toBe(true);
  });

  it("reports listener errors without throwing through the page message handler", () => {
    const { target, messages, messageListeners } = createInstrumentedTargetWithPageMessages();
    const client = new target.LightstreamerClient("http://localhost:8080", "LSEW_FIXTURE");
    const subscription = new target.Subscription("COMMAND", ["scenario"], ["command", "key", "price"]);
    const listener = {
      onItemUpdate() {
        throw new Error("fixture listener failed");
      }
    };

    client.subscribe(subscription);
    subscription.addListener(listener);

    expect(() => {
      messageListeners[0]({
        source: target,
        data: {
          type: PAGE_REINJECT_REQUEST,
          requestId: "request-3",
          draft: createValidPageDraft()
        }
      } as unknown as MessageEvent);
    }).not.toThrow();

    expect(
      messages.some(
        (message) =>
          isRuntimeReinjectResultMessage(message) &&
          message.result.requestId === "request-3" &&
          message.result.status === "listener-error" &&
          message.result.error === "fixture listener failed"
      )
    ).toBe(true);
  });
});

function createValidPageDraft() {
  return {
    sourceEventId: "event-1",
    executionTarget: "captured-listener" as const,
    target: {
      subscriptionId: "subscription-1",
      listenerId: "listener-1"
    },
    item: {
      name: "portfolio",
      position: 2
    },
    command: "UPDATE",
    key: "item-1",
    fields: {
      command: "UPDATE",
      key: "item-1",
      price: 101
    },
    changedFields: {
      price: 101
    },
    isSnapshot: false,
    provenance: {
      source: "clone",
      sourceEventKind: "item-update",
      sourceSynthetic: false
    }
  };
}

function createFakeItemUpdate(itemName: string, key: string, qty: string) {
  return createFakeCommandItemUpdate("ADD", itemName, key, qty, true);
}

function createFakeCommandItemUpdate(
  command: "ADD" | "UPDATE" | "DELETE",
  itemName: string,
  key: string,
  qty: string,
  snapshot: boolean
) {
  return {
    forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void) {
      iterator("command", 1, command);
      iterator("key", 2, key);
      iterator("qty", 3, qty);
    },
    forEachChangedField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void) {
      iterator("command", 1, command);
      iterator("key", 2, key);
      iterator("qty", 3, qty);
    },
    getItemName() {
      return itemName;
    },
    getItemPos() {
      return 1;
    },
    isSnapshot() {
      return snapshot;
    }
  };
}
