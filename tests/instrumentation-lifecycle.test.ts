import { describe, expect, it } from "vitest";

import {
  PAGE_REINJECT_REQUEST,
  type CaptureMessage,
  isRuntimeReinjectResultMessage
} from "../src/bridge/messages";
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

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  sent: unknown[] = [];
  private messageListeners: Array<(event: MessageEvent) => void> = [];

  constructor(readonly url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(data);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") {
      this.messageListeners.push(listener);
    }
  }

  emitMessage(data: string) {
    for (const listener of this.messageListeners) {
      listener({ data } as MessageEvent);
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

    messageListeners[0]({
      source: target,
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
  return {
    forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void) {
      iterator("command", 1, "ADD");
      iterator("key", 2, key);
      iterator("qty", 3, qty);
    },
    forEachChangedField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void) {
      iterator("command", 1, "ADD");
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
      return true;
    }
  };
}
