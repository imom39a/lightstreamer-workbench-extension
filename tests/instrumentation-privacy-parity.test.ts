import { describe, expect, it, vi } from "vitest";

import type { CaptureMessage } from "../src/bridge/messages";
import type { LightstreamerHost } from "../src/core/lightstreamer-types";
import { installLightstreamerInstrumentation } from "../src/injected/lightstreamer-instrumentation";

describe("instrumentation privacy and behavior parity", () => {
  it("sanitizes client addresses before a capture message crosses the page boundary", () => {
    class PrivacyClient {
      readonly connectionDetails = {
        getServerAddress: () =>
          "https://user:password-canary@example.test:443/a/../stream?authorization=bearer-canary&token=token-canary#cookie-canary",
        getServerInstanceAddress: () =>
          "https://node-secret@example.test/lightstreamer?session=secret#fragment",
        getClientIp: () => "198.51.100.77"
      };

      getStatus() {
        return "CONNECTED:WS-STREAMING";
      }
    }
    const messages: CaptureMessage[] = [];
    const host = { LightstreamerClient: PrivacyClient };

    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );
    new host.LightstreamerClient();

    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload.client).toMatchObject({
      serverAddress: "https://example.test/stream",
      serverInstanceAddress: "https://example.test/lightstreamer",
      clientIp: "198.51.100.0/24"
    });
    expect(JSON.stringify(messages)).not.toMatch(
      /password-canary|bearer-canary|token-canary|cookie-canary|node-secret|198\.51\.100\.77/
    );
  });

  it.each([
    ["2001:0db8:abcd:1234:5678:90ab:cdef:1234", "2001:db8:abcd:0:0:0:0:0/48"],
    ["::ffff:203.0.113.99", "203.0.113.0/24"],
    ["999.203.0.113", "[redacted]"]
  ])("masks %s without retaining a raw fallback", (clientIp, expected) => {
    class AddressClient {
      readonly connectionDetails = { getClientIp: () => clientIp };
    }
    const messages: CaptureMessage[] = [];
    const host = { LightstreamerClient: AddressClient };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );

    new host.LightstreamerClient();

    expect(messages[0]?.payload.client).toMatchObject({ clientIp: expected });
    expect(JSON.stringify(messages)).not.toContain(clientIp);
  });

  it("preserves plain and constructed client invocation semantics", () => {
    type DualModeClientConstructor = {
      (this: Record<string, unknown>, ...args: unknown[]): unknown;
      new (...args: unknown[]): Record<string, unknown>;
    };
    const trace: Array<{
      receiver: unknown;
      args: unknown[];
      newTarget: Function | undefined;
    }> = [];
    const plainResult = { source: "plain" };
    function DualModeClient(this: Record<string, unknown>, ...args: unknown[]) {
      trace.push({ receiver: this, args, newTarget: new.target });
      if (!new.target) {
        return plainResult;
      }
      this.args = args;
    }
    const OriginalClient = DualModeClient as unknown as DualModeClientConstructor;
    const host = { LightstreamerClient: OriginalClient };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      () => undefined
    );
    const InstrumentedClient = host.LightstreamerClient;
    const receiver = { receiver: true };
    const first = { first: true };
    const second = { second: true };

    expect(Reflect.apply(InstrumentedClient, receiver, [first, second])).toBe(
      plainResult
    );
    const instance = Reflect.construct(InstrumentedClient, [first, second]);
    class DerivedClient extends InstrumentedClient {}
    const derived = new DerivedClient(first, second);

    expect(trace).toEqual([
      { receiver, args: [first, second], newTarget: undefined },
      { receiver: instance, args: [first, second], newTarget: OriginalClient },
      { receiver: derived, args: [first, second], newTarget: DerivedClient }
    ]);
    expect(Object.getPrototypeOf(instance)).toBe(OriginalClient.prototype);
    expect(Object.getPrototypeOf(derived)).toBe(DerivedClient.prototype);
  });

  it("leaves page-owned constructor accessors untouched", () => {
    const host: Record<string, unknown> = {};
    let assigned: unknown;
    const getter = vi.fn(() => assigned);
    const setter = vi.fn((value: unknown) => {
      assigned = value;
    });
    Object.defineProperty(host, "LightstreamerClient", {
      configurable: true,
      enumerable: false,
      get: getter,
      set: setter
    });
    const before = Object.getOwnPropertyDescriptor(host, "LightstreamerClient");

    installLightstreamerInstrumentation(host, () => undefined);

    expect(Object.getOwnPropertyDescriptor(host, "LightstreamerClient")).toEqual(before);
    expect(getter).not.toHaveBeenCalled();
    host.LightstreamerClient = function PageClient() {};
    expect(setter).toHaveBeenCalledOnce();
    expect(assigned).toBe(host.LightstreamerClient);
  });

  it("leaves a frozen constructor surface intact without throwing", () => {
    class FrozenClient {}
    const host = Object.freeze({ LightstreamerClient: FrozenClient });
    const before = Object.getOwnPropertyDescriptor(host, "LightstreamerClient");

    expect(() =>
      installLightstreamerInstrumentation(
        host as unknown as LightstreamerHost,
        () => undefined
      )
    ).not.toThrow();
    expect(Object.getOwnPropertyDescriptor(host, "LightstreamerClient")).toEqual(before);
    expect(host.LightstreamerClient).toBe(FrozenClient);
  });

  it("preserves listener identity, callback receiver, returns, and throws when capture fails", () => {
    const callbackReturn = { source: "callback-return" };
    const callbackThrow = { source: "callback-throw" };
    class ListenerSubscription {
      private readonly listeners: Array<Record<string, unknown>> = [];

      addListener(listener: Record<string, unknown>) {
        this.listeners.push(listener);
        return "add-return";
      }

      removeListener(listener: Record<string, unknown>) {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
        return "remove-return";
      }

      getListeners() {
        return [...this.listeners];
      }

      deliver(value: unknown) {
        return (this.listeners[0]?.onItemUpdate as (value: unknown) => unknown)?.(value);
      }
    }
    const host = { Subscription: ListenerSubscription };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      () => {
        throw new Error("capture transport unavailable");
      }
    );
    const subscription = new host.Subscription();
    const callback = vi.fn(function (this: unknown, value: unknown) {
      expect(this).toBe(listener);
      if (value === callbackThrow) {
        throw callbackThrow;
      }
      return callbackReturn;
    });
    const listener = { onItemUpdate: callback };

    expect(subscription.addListener(listener)).toBe("add-return");
    expect(subscription.getListeners()).toEqual([listener]);
    expect(subscription.deliver({ value: 1 })).toBe(callbackReturn);
    expect(() => subscription.deliver(callbackThrow)).toThrow(callbackThrow);
    expect(callback).toHaveBeenCalledTimes(2);
    expect(subscription.removeListener(listener)).toBe("remove-return");
    expect(subscription.getListeners()).toEqual([]);
  });

  it("does not replace a page method return when metadata capture fails", () => {
    const applicationReturn = { source: "application-return" };
    class FragileClient {
      failCapture = false;

      get connectionDetails() {
        if (this.failCapture) {
          throw new Error("metadata-secret-canary");
        }
        return null;
      }

      connect() {
        return applicationReturn;
      }
    }
    const host = { LightstreamerClient: FragileClient };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      () => undefined
    );
    const client = new host.LightstreamerClient();
    client.failCapture = true;

    expect(client.connect()).toBe(applicationReturn);
  });

  it("does not suppress a listener callback when update extraction fails", () => {
    class UpdateSubscription {
      private listener: { onItemUpdate?(update: unknown): unknown } | null = null;

      addListener(listener: { onItemUpdate?(update: unknown): unknown }) {
        this.listener = listener;
      }

      deliver(update: unknown) {
        return this.listener?.onItemUpdate?.(update);
      }
    }
    const callbackReturn = { source: "application-callback" };
    const callback = vi.fn(() => callbackReturn);
    const host = { Subscription: UpdateSubscription };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      () => undefined
    );
    const subscription = new host.Subscription();
    subscription.addListener({ onItemUpdate: callback });
    const hostileUpdate = Object.defineProperty({}, "forEachField", {
      get() {
        throw new Error("hostile-update-secret");
      }
    });

    expect(subscription.deliver(hostileUpdate)).toBe(callbackReturn);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("never sends raw capture error text or sensitive fields across the page boundary", () => {
    class ErrorSubscription {
      private listener: { onItemUpdate?(update: unknown): unknown } | null = null;

      addListener(listener: { onItemUpdate?(update: unknown): unknown }) {
        this.listener = listener;
      }

      deliver(update: unknown) {
        this.listener?.onItemUpdate?.(update);
      }
    }
    const messages: CaptureMessage[] = [];
    const host = { Subscription: ErrorSubscription };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );
    const subscription = new host.Subscription();
    subscription.addListener({ onItemUpdate: () => undefined });
    subscription.deliver({
      forEachField() {
        throw new Error("hostile-error-secret");
      },
      forEachChangedField(iterator: (name: string, position: number, value: string) => void) {
        iterator("authorization", 1, "bearer-field-secret");
      }
    });

    const update = messages.find((message) => message.kind === "item-update");
    expect(update?.payload.raw).toMatchObject({
      extractionErrors: ["forEachField:capture-failed"]
    });
    expect(update?.payload.update).toMatchObject({
      changedFields: { authorization: "[redacted]" }
    });
    expect(JSON.stringify(messages)).not.toMatch(
      /hostile-error-secret|bearer-field-secret/
    );
  });

  it("redacts forbidden credentials recursively inside nested arrays", () => {
    class NestedCredentialClient {
      readonly connectionDetails;

      constructor(_serverAddress: string, adapterSet: unknown) {
        this.connectionDetails = { getAdapterSet: () => adapterSet };
      }
    }
    const canaries = {
      proxy_authorization: "proxy-secret",
      "set-cookie": "cookie-secret",
      httpExtraHeaders: "header-secret"
    };
    const messages: CaptureMessage[] = [];
    const host = { LightstreamerClient: NestedCredentialClient };
    installLightstreamerInstrumentation(
      host as unknown as LightstreamerHost,
      (message) => messages.push(message as CaptureMessage)
    );

    new host.LightstreamerClient("https://example.test/lightstreamer", [[[canaries]]]);

    expect(JSON.stringify(messages)).not.toMatch(
      /proxy-secret|cookie-secret|header-secret/
    );
    expect(JSON.stringify(messages)).toContain("[redacted]");
  });
});
