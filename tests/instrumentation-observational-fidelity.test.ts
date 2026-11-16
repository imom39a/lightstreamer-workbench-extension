import { describe, expect, it, vi } from "vitest";

import {
  PAGE_REINJECT_REQUEST,
  type CaptureMessage,
  isRuntimeReinjectResultMessage
} from "../src/bridge/messages";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000031";

type Listener = Record<string, unknown>;

class OfficialShapedClient {
  connect() { return undefined; }
  disconnect() { return undefined; }
  subscribe(subscription: unknown) { return subscription; }
  unsubscribe(subscription: unknown) { return subscription; }
  addListener(_listener: unknown) { return undefined; }
  getStatus() { return "CONNECTED:WS-STREAMING"; }
}

class DispatchingSubscription {
  readonly listeners: Listener[] = [];
  constructor(readonly mode = "MERGE", readonly items = ["orders"], readonly fields = ["price"]) {}
  getMode() { return this.mode; }
  getItems() { return this.items; }
  getFields() { return this.fields; }
  addListener(listener: Listener) {
    this.listeners.push(listener);
    (listener.onListenStart as (() => void) | undefined)?.();
  }
  getListeners() { return [...this.listeners]; }
  // The official client reads the callback from the registered listener on every dispatch.
  dispatch(update: unknown) {
    for (const listener of this.listeners) {
      (listener.onItemUpdate as ((value: unknown) => unknown) | undefined)?.(update);
    }
  }
}

function itemUpdate(price: string) {
  return {
    forEachField(iterator: (name: string, position: number, value: unknown) => void) { iterator("price", 1, price); },
    forEachChangedField(iterator: (name: string, position: number, value: unknown) => void) { iterator("price", 1, price); },
    getItemName: () => "orders",
    getItemPos: () => 1,
    isSnapshot: () => false
  };
}

function install() {
  const messages: unknown[] = [];
  const pageListeners: Array<(event: MessageEvent) => void> = [];
  const host = {
    LightstreamerClient: OfficialShapedClient,
    Subscription: DispatchingSubscription,
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") pageListeners.push(listener);
    }
  };
  installLightstreamerInstrumentation(host as unknown as LightstreamerHost, (message) => messages.push(message));
  const captures = () => messages.filter((message): message is CaptureMessage =>
    typeof message === "object" && message !== null && "namespace" in message);
  return { host, messages, pageListeners, captures };
}

describe("subscription listener proxy fidelity", () => {
  it("dispatches to a callback the application reassigns after addListener", () => {
    const { host, captures } = install();
    const subscription = new host.Subscription();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const listener: Listener = { onItemUpdate: handlerA };
    subscription.addListener(listener);

    subscription.dispatch(itemUpdate("1"));
    listener.onItemUpdate = handlerB;
    subscription.dispatch(itemUpdate("2"));
    listener.onItemUpdate = handlerA;
    subscription.dispatch(itemUpdate("3"));

    expect(handlerA).toHaveBeenCalledTimes(2);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(handlerA.mock.contexts[0]).toBe(listener);
    expect(handlerB.mock.contexts[0]).toBe(listener);
    expect(captures().filter(({ kind }) => kind === "item-update")).toHaveLength(3);
  });

  it("stops observing a callback the application deletes and keeps wrapper identity stable", () => {
    const { host, captures } = install();
    const subscription = new host.Subscription();
    const handler = vi.fn();
    const listener: Listener = { onItemUpdate: handler };
    subscription.addListener(listener);
    const proxy = subscription.listeners[0]!;

    expect(proxy.onItemUpdate).toBe(proxy.onItemUpdate);
    delete listener.onItemUpdate;
    expect(proxy.onItemUpdate).toBeUndefined();
    subscription.dispatch(itemUpdate("1"));

    expect(handler).not.toHaveBeenCalled();
    expect(captures().filter(({ kind }) => kind === "item-update")).toHaveLength(0);
  });

  it("delivers Local Injection to the listener's current onItemUpdate callback", () => {
    const { host, messages, pageListeners } = install();
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription();
    client.subscribe(subscription);
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    const listener: Listener = { onItemUpdate: handlerA };
    subscription.addListener(listener);
    listener.onItemUpdate = handlerB;

    pageListeners[0]!({
      source: host,
      data: {
        type: PAGE_REINJECT_REQUEST,
        panelSessionId: PANEL_SESSION_ID,
        requestId: "request-current-callback",
        draft: {
          sourceEventId: "event-1",
          executionTarget: "captured-listener",
          target: { subscriptionId: "subscription-1", listenerId: "listener-1" },
          item: { name: "orders", position: 1 },
          command: null,
          key: null,
          fields: { price: "9" },
          changedFields: { price: "9" },
          isSnapshot: false,
          provenance: { source: "clone", sourceEventKind: "item-update", sourceSynthetic: false }
        }
      }
    } as unknown as MessageEvent);

    expect(handlerA).not.toHaveBeenCalled();
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(messages.find(isRuntimeReinjectResultMessage)?.result).toMatchObject({ ok: true, status: "success" });
  });
});

class UnrelatedSubscription {
  // Shaped like a generic reactive Subscription, not the Lightstreamer API.
  add(_teardown: unknown) { return undefined; }
  unsubscribe() { return undefined; }
}

class FallbackWebSocket {
  static instances: FallbackWebSocket[] = [];
  readonly sent: unknown[] = [];
  readonly messageListeners: Array<(event: MessageEvent) => void> = [];
  constructor(readonly url: string) { FallbackWebSocket.instances.push(this); }
  send(data: unknown) { this.sent.push(data); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") this.messageListeners.push(listener);
  }
  emitMessage(data: string) {
    for (const listener of this.messageListeners) listener({ type: "message", data } as MessageEvent);
  }
}

describe("constructor hook shape validation", () => {
  it("leaves an unrelated global Subscription untouched and keeps the WebSocket fallback", () => {
    const messages: CaptureMessage[] = [];
    const host: Record<string, unknown> = {
      Subscription: UnrelatedSubscription,
      WebSocket: FallbackWebSocket
    };
    installLightstreamerInstrumentation(host as unknown as LightstreamerHost, (message) => messages.push(message as CaptureMessage));

    expect(host.Subscription).toBe(UnrelatedSubscription);
    const unrelated = new (host.Subscription as typeof UnrelatedSubscription)();
    expect(Object.getPrototypeOf(unrelated)).toBe(UnrelatedSubscription.prototype);
    expect(messages).toEqual([]);
    expect(host.__LSEW_PRIMARY_ACTIVE__).toBeFalsy();

    new (host.WebSocket as typeof FallbackWebSocket)("wss://push.example.test/lightstreamer");
    expect(messages.map(({ kind }) => kind)).toEqual(["client-created"]);
    expect(messages[0]?.payload.raw).toMatchObject({ captureSource: "websocket-tlcp" });
  });

  it("passes late unrelated assignments through and still wraps a later official constructor", () => {
    const messages: CaptureMessage[] = [];
    const host: Record<string, unknown> = {};
    installLightstreamerInstrumentation(host as unknown as LightstreamerHost, (message) => messages.push(message as CaptureMessage));

    host.Subscription = UnrelatedSubscription;
    expect(host.Subscription).toBe(UnrelatedSubscription);
    new (host.Subscription as typeof UnrelatedSubscription)();
    expect(messages).toEqual([]);
    expect(host.__LSEW_PRIMARY_ACTIVE__).toBeFalsy();

    host.Subscription = DispatchingSubscription;
    expect(host.Subscription).not.toBe(DispatchingSubscription);
    new (host.Subscription as typeof DispatchingSubscription)();
    expect(messages.map(({ kind }) => kind)).toEqual(["subscription-created"]);
    expect(host.__LSEW_PRIMARY_ACTIVE__).toBe(true);
  });

  it("leaves unrelated constructors inside a late Lightstreamer namespace untouched", () => {
    const messages: CaptureMessage[] = [];
    const host: Record<string, unknown> = {};
    installLightstreamerInstrumentation(host as unknown as LightstreamerHost, (message) => messages.push(message as CaptureMessage));
    const namespace = { Subscription: UnrelatedSubscription, LightstreamerClient: class Unrelated {} };

    host.Lightstreamer = namespace;
    expect(namespace.Subscription).toBe(UnrelatedSubscription);
    new namespace.Subscription();
    new namespace.LightstreamerClient();
    expect(messages).toEqual([]);
    expect(host.__LSEW_PRIMARY_ACTIVE__).toBeFalsy();
  });
});

class CountingSubscription extends DispatchingSubscription {
  readonly calls: Record<string, number> = {};
  maxFrequency = "unlimited";
  constructor(mode = "MERGE", items = ["orders"], fields = ["price"]) { super(mode, items, fields); }
  private count(name: string) { this.calls[name] = (this.calls[name] ?? 0) + 1; }
  override getMode() { this.count("getMode"); return super.getMode(); }
  override getItems() { this.count("getItems"); return super.getItems(); }
  override getFields() { this.count("getFields"); return super.getFields(); }
  getRequestedMaxFrequency() { this.count("getRequestedMaxFrequency"); return this.maxFrequency; }
  setRequestedMaxFrequency(value: string) { this.maxFrequency = value; }
  isActive() { this.count("isActive"); return true; }
  isSubscribed() { this.count("isSubscribed"); return true; }
  getKeyPosition() {
    this.count("getKeyPosition");
    if (this.mode !== "COMMAND") throw new Error("IllegalStateException: not a COMMAND Subscription");
    return 2;
  }
  getCommandPosition() {
    this.count("getCommandPosition");
    if (this.mode !== "COMMAND") throw new Error("IllegalStateException: not a COMMAND Subscription");
    return 1;
  }
}

describe("per-update subscription metadata", () => {
  function setup(mode: string) {
    const messages: CaptureMessage[] = [];
    const host = { LightstreamerClient: OfficialShapedClient, Subscription: CountingSubscription };
    installLightstreamerInstrumentation(host as unknown as LightstreamerHost, (message) => messages.push(message as CaptureMessage));
    const client = new host.LightstreamerClient();
    const subscription = new host.Subscription(mode);
    client.subscribe(subscription);
    subscription.addListener({ onItemUpdate: () => undefined });
    const updates = () => messages.filter(({ kind }) => kind === "item-update");
    return { subscription, updates };
  }

  it("reuses configuration across updates and never calls throwing COMMAND getters outside COMMAND mode", () => {
    const { subscription, updates } = setup("MERGE");
    const before = { ...subscription.calls };
    for (let index = 0; index < 50; index++) subscription.dispatch(itemUpdate(String(index)));

    expect(updates()).toHaveLength(50);
    expect(subscription.calls.getKeyPosition ?? 0).toBe(0);
    expect(subscription.calls.getCommandPosition ?? 0).toBe(0);
    expect((subscription.calls.getMode ?? 0) - (before.getMode ?? 0)).toBeLessThanOrEqual(1);
    expect((subscription.calls.getItems ?? 0) - (before.getItems ?? 0)).toBeLessThanOrEqual(1);
    // Activity state stays live on every delivery.
    expect((subscription.calls.isActive ?? 0) - (before.isActive ?? 0)).toBe(50);
    expect(updates()[49]?.payload.subscription).toMatchObject({
      id: "subscription-1",
      mode: "MERGE",
      items: ["orders"],
      fields: ["price"],
      active: true,
      subscribed: true,
      listenerCount: 1
    });
    expect(updates()[49]?.payload.subscription).not.toHaveProperty("keyPosition");
    expect(updates()[49]?.payload.raw).not.toHaveProperty("subscriptionMetadataErrors");
  });

  it("reports cached COMMAND positions and refreshes configuration after a public setter", () => {
    const { subscription, updates } = setup("COMMAND");
    subscription.dispatch(itemUpdate("1"));
    subscription.dispatch(itemUpdate("2"));
    subscription.setRequestedMaxFrequency("5");
    subscription.dispatch(itemUpdate("3"));

    expect(updates().map(({ payload }) => (payload.subscription as Record<string, unknown>).requestedMaxFrequency))
      .toEqual(["unlimited", "unlimited", "5"]);
    expect(updates()[0]?.payload.subscription).toMatchObject({ keyPosition: 2, commandPosition: 1 });
    expect(updates()[2]?.payload.subscription).toMatchObject({ keyPosition: 2, commandPosition: 1 });
  });
});
