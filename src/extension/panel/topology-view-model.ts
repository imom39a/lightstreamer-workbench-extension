import {
  type TopologyClient,
  type TopologyCommandGeneration,
  type TopologyInferredChild,
  type TopologyItem,
  type TopologyListener,
  type TopologySession,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";

export type TopologySelection = {
  key: string;
  kind:
    | "page"
    | "client"
    | "session"
    | "subscription"
    | "generation"
    | "inferred-child"
    | "item"
    | "listener";
  ownerKey?: string;
  itemKey?: string;
};

export type TopologySelectionTarget =
  | { kind: "page"; state: TopologyState }
  | { kind: "client"; client: TopologyClient }
  | { kind: "session"; client: TopologyClient; session: TopologySession }
  | {
      kind: "subscription";
      client: TopologyClient | null;
      session: TopologySession | null;
      subscription: TopologySubscription;
    }
  | {
      kind: "item";
      client: TopologyClient | null;
      session: TopologySession | null;
      subscription: TopologySubscription;
      item: TopologyItem;
    }
  | {
      kind: "generation";
      client: TopologyClient | null;
      session: TopologySession | null;
      subscription: TopologySubscription;
      generation: TopologyCommandGeneration;
    }
  | {
      kind: "inferred-child";
      client: TopologyClient | null;
      session: TopologySession | null;
      subscription: TopologySubscription;
      generation: TopologyCommandGeneration;
      child: TopologyInferredChild;
    }
  | {
      kind: "listener";
      client: TopologyClient | null;
      session: TopologySession | null;
      subscription: TopologySubscription;
      item: TopologyItem | null;
      listener: TopologyListener;
    };

export type TopologyNodePresentation = {
  selection: TopologySelection;
  kind: string;
  label: string;
  meta: string;
  tone: string;
};

export type TopologyTreeViewModel = {
  structureKey: string;
  presentations: TopologyNodePresentation[];
};

export type TopologyTreeViewModelOptions = {
  selection: TopologySelection;
  expandAllItems: boolean;
  inlineItemLimit: number;
  selectedItemLimit: number;
  fullItemLimit: number;
};

export function createTopologyTreeViewModel(
  state: TopologyState,
  options: TopologyTreeViewModelOptions
): TopologyTreeViewModel {
  const presentations: TopologyNodePresentation[] = [];
  const structureTokens: string[] = [];
  let remainingItemBudget = options.expandAllItems ? options.fullItemLimit : 0;

  const visitSubscription = (
    client: TopologyClient | null,
    session: TopologySession | null,
    subscription: TopologySubscription
  ) => {
    const presentation = topologySubscriptionNodePresentation(
      client,
      session,
      subscription
    );
    presentations.push(presentation);
    const selectedBranch =
      options.selection.ownerKey === presentation.selection.key;
    const itemLimit = options.expandAllItems
      ? Math.min(subscription.items.length, remainingItemBudget)
      : subscription.items.length <= options.inlineItemLimit
        ? subscription.items.length
        : selectedBranch
          ? Math.min(subscription.items.length, options.selectedItemLimit)
          : 0;
    if (options.expandAllItems) {
      remainingItemBudget -= itemLimit;
    }
    structureTokens.push(
      [
        presentation.selection.key,
        subscription.itemGroup ?? "",
        subscription.items.length,
        itemLimit,
        subscription.commandGenerations
          .map(
            (generation) =>
              `${generation.id}[${generation.inferredChildren.map(({ id }) => id).join(",")}]`
          )
          .join(";")
      ].join(":")
    );

    for (const generation of subscription.commandGenerations) {
      presentations.push(
        topologyCommandGenerationNodePresentation(
          client,
          session,
          subscription,
          generation
        )
      );
      for (const child of generation.inferredChildren) {
        presentations.push(
          topologyInferredChildNodePresentation(
            client,
            session,
            subscription,
            generation,
            child
          )
        );
      }
    }

    for (const item of subscription.items.slice(0, itemLimit)) {
      const itemPresentation = topologyItemNodePresentation(
        client,
        session,
        subscription,
        item
      );
      presentations.push(itemPresentation);
      if (
        shouldRenderTopologyItemListeners(
          subscription,
          options
        )
      ) {
        for (const listenerId of item.listenerIds) {
          presentations.push(
            topologyListenerNodePresentation(
              client,
              session,
              subscription,
              item,
              listenerId
            )
          );
        }
      }
    }

    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        presentations.push(
          topologyListenerNodePresentation(
            client,
            session,
            subscription,
            null,
            listenerId
          )
        );
      }
    }
  };

  presentations.push(topologyPageNodePresentation(state));
  for (const client of state.clients) {
    presentations.push(topologyClientNodePresentation(client));
    for (const subscription of client.waitingSubscriptions) {
      visitSubscription(client, null, subscription);
    }
    for (const session of client.sessions) {
      presentations.push(topologySessionNodePresentation(client, session));
      for (const subscription of session.subscriptions) {
        visitSubscription(client, session, subscription);
      }
    }
  }
  for (const subscription of state.unassignedSubscriptions) {
    visitSubscription(null, null, subscription);
  }

  return {
    structureKey: JSON.stringify([
      options.expandAllItems,
      presentations.map(({ selection }) => selection.key),
      structureTokens
    ]),
    presentations
  };
}

export function topologyPageNodePresentation(
  state: TopologyState
): TopologyNodePresentation {
  return {
    selection: { key: "page", kind: "page" },
    kind: "PAGE",
    label: "Inspected page",
    meta: `${state.clientCount} clients · ${state.subscriptionCount} subscriptions`,
    tone: state.clientCount > 0 ? "active" : "idle"
  };
}

export function topologyClientNodePresentation(
  client: TopologyClient
): TopologyNodePresentation {
  const activeSession = client.sessions.find((session) => session.active);
  return {
    selection: { key: topologyClientKey(client), kind: "client" },
    kind: "CLIENT",
    label: client.id,
    meta:
      [
        client.libraryVersion ? `Web Client ${client.libraryVersion}` : null,
        client.instrumentationSource ?? null
      ]
        .filter(Boolean)
        .join(" · ") || "Version unavailable",
    tone: activeSession
      ? "active"
      : client.status?.startsWith("DISCONNECTED")
        ? "inactive"
        : "idle"
  };
}

export function topologySessionNodePresentation(
  client: TopologyClient,
  session: TopologySession
): TopologyNodePresentation {
  return {
    selection: { key: topologySessionKey(client, session), kind: "session" },
    kind: "SESSION",
    label: session.id
      ? `${session.historical ? "Historical session" : "Session"} ${shortTopologyId(session.id)}`
      : "No established session",
    meta: [
      session.transport
        ? session.historical
          ? `last transport: ${session.transport}`
          : session.transport
        : null,
      `${session.subscriptions.length} subscriptions`
    ]
      .filter(Boolean)
      .join(" · "),
    tone: topologySessionTone(session)
  };
}

export function topologySubscriptionNodePresentation(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription
): TopologyNodePresentation {
  const key = topologySubscriptionKey(client, session, subscription);
  return {
    selection: { key, kind: "subscription", ownerKey: key },
    kind: "SUB",
    label: subscription.id,
    meta: [
      subscription.mode,
      subscription.duplicateKind === "exact"
        ? `exact duplicate ×${subscription.exactDuplicateCount}`
        : subscription.duplicateKind === "overlap"
          ? `overlap ×${subscription.overlapCount}`
          : null,
      `${subscription.updateCount} real · ${subscription.deliveryCount} deliveries`
    ]
      .filter(Boolean)
      .join(" · "),
    tone: topologySubscriptionTone(subscription)
  };
}

export function topologyItemNodePresentation(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  item: TopologyItem
): TopologyNodePresentation {
  const ownerKey = topologySubscriptionKey(client, session, subscription);
  return {
    selection: {
      key: topologyItemKey(client, session, subscription, item),
      kind: "item",
      ownerKey
    },
    kind: "ITEM",
    label: topologyItemLabel(item),
    meta: `${item.snapshotPhase}${subscription.historical ? " when frozen" : ""} · ${item.updateCount} updates`,
    tone: topologyItemTone(subscription, item)
  };
}

export function topologyCommandGenerationNodePresentation(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  generation: TopologyCommandGeneration
): TopologyNodePresentation {
  const ownerKey = topologySubscriptionKey(client, session, subscription);
  return {
    selection: {
      key: topologyCommandGenerationKey(
        client,
        session,
        subscription,
        generation
      ),
      kind: "generation",
      ownerKey
    },
    kind: "COMMAND KEY",
    label: generation.key
      ? `Generation ${generation.key}`
      : `Generation ${shortTopologyId(generation.id)}`,
    meta: [generation.command, generation.itemId].filter(Boolean).join(" · "),
    tone: "active"
  };
}

export function topologyInferredChildNodePresentation(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  generation: TopologyCommandGeneration,
  child: TopologyInferredChild
): TopologyNodePresentation {
  return {
    selection: {
      key: topologyInferredChildKey(
        client,
        session,
        subscription,
        generation,
        child
      ),
      kind: "inferred-child",
      ownerKey: topologyCommandGenerationKey(
        client,
        session,
        subscription,
        generation
      )
    },
    kind: "SECOND LEVEL",
    label: child.label,
    meta: [child.callback, child.provenance].filter(Boolean).join(" · "),
    tone: "warning"
  };
}

export function topologyListenerNodePresentation(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  item: TopologyItem | null,
  listenerId: string
): TopologyNodePresentation {
  const ownerKey = topologySubscriptionKey(client, session, subscription);
  const listener = subscription.listeners.find(({ id }) => id === listenerId);
  const itemKey = item
    ? topologyItemKey(client, session, subscription, item)
    : undefined;
  return {
    selection: {
      key: topologyListenerKey(client, session, subscription, item, listenerId),
      kind: "listener",
      ownerKey,
      ...(itemKey ? { itemKey } : {})
    },
    kind: "LISTENER",
    label: listenerId,
    meta: listener
      ? `${listener.callbacks.length} callbacks · ${listener.deliveryCount} deliveries`
      : "Subscription listener",
    tone: "neutral"
  };
}

export function findTopologySelection(
  state: TopologyState,
  key: string
): TopologySelectionTarget | null {
  if (key === "page") {
    return { kind: "page", state };
  }
  for (const client of state.clients) {
    if (key === topologyClientKey(client)) {
      return { kind: "client", client };
    }
    for (const session of client.sessions) {
      if (key === topologySessionKey(client, session)) {
        return { kind: "session", client, session };
      }
      const target = findSubscriptionSelection(
        key,
        client,
        session,
        session.subscriptions
      );
      if (target) {
        return target;
      }
    }
    const waitingTarget = findSubscriptionSelection(
      key,
      client,
      null,
      client.waitingSubscriptions
    );
    if (waitingTarget) {
      return waitingTarget;
    }
  }
  return findSubscriptionSelection(
    key,
    null,
    null,
    state.unassignedSubscriptions
  );
}

export function topologyClientKey(client: TopologyClient): string {
  return topologySelectionKey("client", client.id);
}

export function topologySessionKey(
  client: TopologyClient,
  session: TopologySession
): string {
  return topologySelectionKey("session", client.id, session.key);
}

export function topologySubscriptionKey(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription
): string {
  return topologySelectionKey(
    "subscription",
    client?.id ?? null,
    session?.key ?? null,
    subscription.id
  );
}

export function topologyItemKey(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  item: TopologyItem
): string {
  return topologySelectionKey(
    "item",
    client?.id ?? null,
    session?.key ?? null,
    subscription.id,
    item.id
  );
}

export function topologyListenerKey(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  item: TopologyItem | null,
  listenerId: string
): string {
  return topologySelectionKey(
    "listener",
    client?.id ?? null,
    session?.key ?? null,
    subscription.id,
    item?.id ?? null,
    listenerId
  );
}

export function topologyItemLabel(item: TopologyItem): string {
  if (item.name) {
    return item.position === null ? item.name : `${item.name} · #${item.position}`;
  }
  return item.position === null ? "Unknown item" : `Item #${item.position}`;
}

export function topologySessionTone(session: TopologySession): string {
  if (session.historical) return "historical";
  if (session.active) return "active";
  return session.id ? "inactive" : "idle";
}

export function topologySubscriptionTone(
  subscription: TopologySubscription
): string {
  if (subscription.historical) return "historical";
  if (subscription.errorCount > 0 || subscription.lostUpdateCount > 0) {
    return "warning";
  }
  if (subscription.serverEstablished) return "active";
  return subscription.active ? "pending" : "inactive";
}

export function topologyItemTone(
  subscription: TopologySubscription,
  item: TopologyItem
): string {
  return subscription.historical
    ? "historical"
    : topologySnapshotTone(item.snapshotPhase);
}

export function topologySnapshotTone(snapshot: string): string {
  if (snapshot === "live" || snapshot === "snapshot-complete") return "active";
  if (snapshot === "snapshot") return "snapshot";
  if (snapshot === "waiting") return "waiting";
  return "neutral";
}

export function topologyToneLabel(tone: string): string {
  switch (tone) {
    case "active":
    case "pending":
    case "snapshot":
    case "waiting":
    case "inactive":
    case "idle":
      return tone;
    case "historical":
      return "frozen";
    case "warning":
      return "attention";
    default:
      return "";
  }
}

function findSubscriptionSelection(
  key: string,
  client: TopologyClient | null,
  session: TopologySession | null,
  subscriptions: readonly TopologySubscription[]
): TopologySelectionTarget | null {
  for (const subscription of subscriptions) {
    if (key === topologySubscriptionKey(client, session, subscription)) {
      return { kind: "subscription", client, session, subscription };
    }
    for (const generation of subscription.commandGenerations) {
      if (
        key ===
        topologyCommandGenerationKey(
          client,
          session,
          subscription,
          generation
        )
      ) {
        return {
          kind: "generation",
          client,
          session,
          subscription,
          generation
        };
      }
      for (const child of generation.inferredChildren) {
        if (
          key ===
          topologyInferredChildKey(
            client,
            session,
            subscription,
            generation,
            child
          )
        ) {
          return {
            kind: "inferred-child",
            client,
            session,
            subscription,
            generation,
            child
          };
        }
      }
    }
    for (const item of subscription.items) {
      if (key === topologyItemKey(client, session, subscription, item)) {
        return { kind: "item", client, session, subscription, item };
      }
      for (const listenerId of item.listenerIds) {
        if (
          key ===
          topologyListenerKey(client, session, subscription, item, listenerId)
        ) {
          const listener = subscription.listeners.find(({ id }) => id === listenerId);
          if (listener) {
            return {
              kind: "listener",
              client,
              session,
              subscription,
              item,
              listener
            };
          }
        }
      }
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        if (
          key ===
          topologyListenerKey(client, session, subscription, null, listenerId)
        ) {
          const listener = subscription.listeners.find(({ id }) => id === listenerId);
          if (listener) {
            return {
              kind: "listener",
              client,
              session,
              subscription,
              item: null,
              listener
            };
          }
        }
      }
    }
  }
  return null;
}

export function topologyCommandGenerationKey(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  generation: TopologyCommandGeneration
): string {
  return topologySelectionKey(
    "generation",
    client?.id ?? null,
    session?.key ?? null,
    subscription.id,
    generation.id
  );
}

export function topologyInferredChildKey(
  client: TopologyClient | null,
  session: TopologySession | null,
  subscription: TopologySubscription,
  generation: TopologyCommandGeneration,
  child: TopologyInferredChild
): string {
  return topologySelectionKey(
    "inferred-child",
    client?.id ?? null,
    session?.key ?? null,
    subscription.id,
    generation.id,
    child.id
  );
}

function shouldRenderTopologyItemListeners(
  subscription: TopologySubscription,
  options: TopologyTreeViewModelOptions
): boolean {
  return (
    !options.expandAllItems ||
    subscription.items.length <= options.inlineItemLimit
  );
}

function topologySelectionKey(
  kind: string,
  ...parts: Array<string | null>
): string {
  return `${kind}:${JSON.stringify(parts)}`;
}

function shortTopologyId(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 21)}…`;
}
