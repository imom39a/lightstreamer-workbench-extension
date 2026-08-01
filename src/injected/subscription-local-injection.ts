export type SubscriptionLocalInjectionListener<TUpdate> = {
  listenerId: string;
  fieldNames: readonly string[];
  deliver(update: TUpdate): unknown;
};

export type SubscriptionLocalInjectionResult =
  | {
      ok: true;
      deliveredListenerCount: number;
    }
  | {
      ok: false;
      reason: "stale-target";
      deliveredListenerCount: 0;
    }
  | {
      ok: false;
      reason: "listener-error";
      deliveredListenerCount: number;
      error: string;
    };

export type SubscriptionLocalInjectionRegistry<TUpdate> = {
  register(
    subscriptionId: string,
    listener: SubscriptionLocalInjectionListener<TUpdate>
  ): void;
  unregister(subscriptionId: string, listenerId: string): void;
  hasTarget(subscriptionId: string): boolean;
  deliver(
    subscriptionId: string,
    createUpdate: (fieldNames: readonly string[]) => TUpdate
  ): SubscriptionLocalInjectionResult;
};

/**
 * Owns the Subscription-scoped Local Injection seam. A delivery creates one
 * Logical Update and fans that same object out to every current listener.
 */
export function createSubscriptionLocalInjectionRegistry<TUpdate>(): SubscriptionLocalInjectionRegistry<TUpdate> {
  const listenersBySubscription = new Map<
    string,
    Map<string, SubscriptionLocalInjectionListener<TUpdate>>
  >();

  return {
    register(subscriptionId, listener) {
      const listeners =
        listenersBySubscription.get(subscriptionId) ??
        new Map<string, SubscriptionLocalInjectionListener<TUpdate>>();
      listeners.set(listener.listenerId, listener);
      listenersBySubscription.set(subscriptionId, listeners);
    },

    unregister(subscriptionId, listenerId) {
      const listeners = listenersBySubscription.get(subscriptionId);
      listeners?.delete(listenerId);
      if (listeners?.size === 0) {
        listenersBySubscription.delete(subscriptionId);
      }
    },

    hasTarget(subscriptionId) {
      return Boolean(listenersBySubscription.get(subscriptionId)?.size);
    },

    deliver(subscriptionId, createUpdate) {
      const listeners = [
        ...(listenersBySubscription.get(subscriptionId)?.values() ?? [])
      ];
      if (listeners.length === 0) {
        return {
          ok: false,
          reason: "stale-target",
          deliveredListenerCount: 0
        };
      }

      const update = createUpdate(listeners[0].fieldNames);
      let deliveredListenerCount = 0;
      let firstError: string | null = null;
      for (const listener of listeners) {
        try {
          listener.deliver(update);
          deliveredListenerCount += 1;
        } catch (error) {
          firstError ??= listenerErrorMessage(error);
        }
      }

      return firstError
        ? {
            ok: false,
            reason: "listener-error",
            deliveredListenerCount,
            error: firstError
          }
        : {
            ok: true,
            deliveredListenerCount
          };
    }
  };
}

function listenerErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : "Listener callback failed.";
}
