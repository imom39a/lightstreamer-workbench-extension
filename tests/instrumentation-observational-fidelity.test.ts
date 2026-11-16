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
