import {
  type EventCaptureSource,
  type EventClient,
  type EventSubscription,
  type LightstreamerEventEnvelope
} from "./event-envelope";

const HISTORICAL_SESSION_LIMIT = 5;
const APPLIED_EVENT_DEDUP_LIMIT = 4_096;
const LOGICAL_UPDATE_DEDUP_LIMIT = 64;

export type TopologySnapshotPhase =
  | "unknown"
  | "not-requested"
  | "waiting"
  | "snapshot"
  | "snapshot-complete"
  | "live"
  | "cleared";

export type TopologyConnectionState =
  | "connected"
  | "recovering"
  | "disconnected"
  | "stalled"
  | "connecting"
  | "unknown";

export type TopologyDuplicateKind = "none" | "exact" | "overlap";

export type TopologyListener = {
  id: string;
  attachmentIds: string[];
  callbacks: string[];
  registrationCount: number;
  active: boolean;
  metricOwner: boolean;
  deliveryCount: number;
  firstDeliveryAt: number | null;
  lastDeliveryAt: number | null;
};

export type TopologyEstablishment = {
  id: string;
  epoch: number | null;
  captureSequence: number;
};

export type TopologyInferredChild = {
  id: string;
  label: string;
  key: string | null;
  captureKind: string | null;
  callback: string | null;
  provenance: string;
  captureSequence: number;
};

export type TopologyCommandGeneration = {
  id: string;
  itemId: string | null;
  key: string | null;
  command: string | null;
  captureSequence: number;
  inferredChildren: TopologyInferredChild[];
};

export type TopologyItem = {
  id: string;
  name: string | null;
  position: number | null;
  resolution: "configured" | "observed" | "position-only";
  updateCount: number;
  syntheticUpdateCount: number;
  deliveryCount: number;
  firstUpdateAt: number | null;
  lastUpdateAt: number | null;
  lastSyntheticUpdateAt: number | null;
  snapshotPhase: TopologySnapshotPhase;
  lostUpdateCount: number;
  activeCommandKeyCount: number;
  deletedCommandKeyCount: number;
  lastCommand: string | null;
  listenerIds: string[];
};

export type TopologySubscription = Omit<EventSubscription, "items"> & {
  configuredItems?: string[];
  clientId: string | null;
  sessionKey: string | null;
  lastSessionId: string | null;
  active: boolean;
  serverEstablished: boolean;
  statusLabel: "Subscribed" | "Waiting for session" | "Pending" | "Failed" | "Inactive";
  pendingSince: number | null;
  waitingForSession: boolean;
  listenerIds: string[];
  listeners: TopologyListener[];
  listenerCount: number;
  updateCount: number;
  syntheticUpdateCount: number;
  deliveryCount: number;
  firstUpdateAt: number | null;
  lastUpdateAt: number | null;
  lastSyntheticUpdateAt: number | null;
  lostUpdateCount: number;
  errorCount: number;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  duplicateKind: TopologyDuplicateKind;
  duplicateCount: number;
  exactDuplicateCount: number;
  overlapCount: number;
  captureSource: EventCaptureSource | null;
  historical: boolean;
  establishments: TopologyEstablishment[];
  commandGenerations: TopologyCommandGeneration[];
  items: TopologyItem[];
};

export type TopologySession = {
  key: string;
  id: string | null;
  active: boolean;
  historical: boolean;
  status: string | null;
  normalizedStatus: TopologyConnectionState;
  transport: string | null;
  serverInstanceAddress: string | null;
  serverSocketName: string | null;
  clientIp: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  endedAt: number | null;
  observingSince: number;
  connectionEpochCount: number;
  recoveryCount: number;
  subscriptions: TopologySubscription[];
};

export type TopologyClient = EventClient & {
  normalizedStatus: TopologyConnectionState;
  firstSeenAt: number;
  lastSeenAt: number;
  clientListenerIds: string[];
  waitingSubscriptions: TopologySubscription[];
  sessions: TopologySession[];
};

export type TopologyState = {
  observingSince: number | null;
  clients: TopologyClient[];
  unassignedSubscriptions: TopologySubscription[];
  clientCount: number;
  activeSessionCount: number;
  historicalSessionCount: number;
  subscriptionCount: number;
  activeSubscriptionCount: number;
  serverEstablishedSubscriptionCount: number;
  itemCount: number;
  listenerCount: number;
};

export type TopologyStateIndex = {
  apply(event: LightstreamerEventEnvelope): TopologyState;
  /**
   * Records an event without materializing a read snapshot. High-volume
   * consumers should ingest events and call snapshot only at render cadence.
   */
  ingest(event: LightstreamerEventEnvelope): void;
  snapshot(): TopologyState;
  clear(): TopologyState;
  resetCurrentObservations(timestamp?: number): TopologyState;
  clearHistory(): TopologyState;
};

type MutableListener = Omit<TopologyListener, "callbacks"> & {
  callbacks: Set<string>;
};

type MutableItem = Omit<
  TopologyItem,
  "listenerIds" | "activeCommandKeyCount" | "deletedCommandKeyCount"
> & {
  logicalUpdateIds: Set<string>;
  activeCommandKeys: Set<string>;
  deletedCommandKeys: Set<string>;
};

type MutableSubscription = {
  metadata: EventSubscription;
  clientId: string | null;
  sessionKey: string | null;
  lastSessionId: string | null;
  active: boolean;
  serverEstablished: boolean;
  pendingSince: number | null;
  waitingForSession: boolean;
  listeners: Map<string, MutableListener>;
  reportedListenerCount: number | null;
  logicalUpdateIds: Set<string>;
  updateCount: number;
  syntheticUpdateCount: number;
  deliveryCount: number;
  firstUpdateAt: number | null;
  lastUpdateAt: number | null;
  lastSyntheticUpdateAt: number | null;
  lostUpdateCount: number;
  errorCount: number;
  lastErrorAt: number | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  captureSource: EventCaptureSource | null;
  archived: boolean;
  items: Map<string, MutableItem>;
};

type MutableSession = Omit<TopologySession, "subscriptions"> & {
  historicalSubscriptions: TopologySubscription[];
};

type MutableClient = {
  metadata: EventClient;
  firstSeenAt: number;
  lastSeenAt: number;
  clientListenerIds: Set<string>;
  sessions: Map<string, MutableSession>;
  currentSessionKey: string;
  sessionLifecycleCount: number;
};

type DuplicateInfo = {
  kind: TopologyDuplicateKind;
  exactCount: number;
  overlapCount: number;
};

export function createTopologyStateIndex(): TopologyStateIndex {
  const clients = new Map<string, MutableClient>();
  const subscriptions = new Map<string, MutableSubscription>();
  const appliedEventIds = new Set<string>();
  let observingSince: number | null = null;

  function ingest(event: LightstreamerEventEnvelope): void {
    if (
      !rememberBoundedIdentity(
        appliedEventIds,
        event.id,
        APPLIED_EVENT_DEDUP_LIMIT
      )
    ) {
      return;
    }
    observingSince ??= event.timestamp;

    if (event.synthetic || event.source === "synthetic") {
      applySyntheticTopologyEvent(event, subscriptions);
      return;
    }

    const client = applyClientEvent(event, clients, subscriptions);
    applySubscriptionEvent(event, client, clients, subscriptions);
  }

  return {
    apply(event) {
      ingest(event);
      return createSnapshot(clients, subscriptions, observingSince);
    },

    ingest,

    snapshot() {
      return createSnapshot(clients, subscriptions, observingSince);
    },

    clear() {
      clients.clear();
      subscriptions.clear();
      appliedEventIds.clear();
      observingSince = null;
      return createSnapshot(clients, subscriptions, observingSince);
    },

    resetCurrentObservations(timestamp = Date.now()) {
      observingSince = timestamp;
      for (const client of clients.values()) {
        for (const session of client.sessions.values()) {
          if (!session.historical) {
            session.observingSince = timestamp;
          }
        }
      }
      for (const subscription of subscriptions.values()) {
        if (!subscription.archived) {
          resetSubscriptionCounters(subscription);
        }
      }
      return createSnapshot(clients, subscriptions, observingSince);
    },

    clearHistory() {
      for (const client of clients.values()) {
        for (const [key, session] of client.sessions) {
          if (session.historical) {
            client.sessions.delete(key);
          }
        }
      }
      for (const [id, subscription] of subscriptions) {
        if (subscription.archived && !subscription.active) {
          subscriptions.delete(id);
        }
      }
      return createSnapshot(clients, subscriptions, observingSince);
    }
  };
}

export function reduceTopologyState(
  events: readonly LightstreamerEventEnvelope[]
): TopologyState {
  const index = createTopologyStateIndex();
  for (const event of events) {
    index.ingest(event);
  }
  return index.snapshot();
}

function applyClientEvent(
  event: LightstreamerEventEnvelope,
  clients: Map<string, MutableClient>,
  subscriptions: Map<string, MutableSubscription>
): MutableClient | null {
  if (!event.client?.id) {
    return null;
  }

  const client = ensureClient(clients, event.client, event.timestamp);
  const previousStatus = client.metadata.status;
  mergeDefined(client.metadata, event.client);
  client.lastSeenAt = Math.max(client.lastSeenAt, event.timestamp);

  const sessionId = nonEmpty(event.client.sessionId);
  const previousSessionKey = client.currentSessionKey;
  let nextSessionKey = previousSessionKey;

  if (sessionId) {
    const currentSession = client.sessions.get(previousSessionKey);
    nextSessionKey =
      currentSession?.id === sessionId && !currentSession.historical
        ? previousSessionKey
        : nextActualSessionKey(client, sessionId);
  } else if (isSessionEndedStatus(event.client.status)) {
    nextSessionKey = pendingSessionKey(event.client.id);
  }

  if (nextSessionKey !== previousSessionKey) {
    const previousSession = client.sessions.get(previousSessionKey);
    if (previousSession?.id && !previousSession.historical) {
      finalizeSession(
        client,
        previousSession,
        subscriptions,
        event.timestamp
      );
    }
    client.currentSessionKey = nextSessionKey;
  }

  const session = ensureSession(
    client,
    nextSessionKey,
    sessionId,
    event.timestamp
  );
  updateSession(
    session,
    client.metadata,
    previousStatus,
    event.timestamp
  );

  if (event.listener?.id && !event.subscription) {
    if (event.kind === "listener-removed") {
      client.clientListenerIds.delete(event.listener.id);
    } else if (event.kind === "listener-added") {
      client.clientListenerIds.add(event.listener.id);
    }
  }

  return client;
}

function applySubscriptionEvent(
  event: LightstreamerEventEnvelope,
  client: MutableClient | null,
  clients: Map<string, MutableClient>,
  subscriptions: Map<string, MutableSubscription>
): void {
  const metadata = event.subscription;
  if (!metadata?.id) {
    return;
  }

  const subscription =
    subscriptions.get(metadata.id) ??
    createMutableSubscription(metadata, event.timestamp);
  subscriptions.set(metadata.id, subscription);
  mergeDefined(subscription.metadata, metadata);
  subscription.captureSource = event.captureSource ?? subscription.captureSource;

  if (client) {
    subscription.clientId = client.metadata.id;
    subscription.archived = false;
  } else if (subscription.clientId) {
    client = clients.get(subscription.clientId) ?? null;
  }

  if (typeof metadata.listenerCount === "number") {
    subscription.reportedListenerCount = metadata.listenerCount;
  }

  applyListenerEvent(subscription, event);
  applySubscriptionLifecycle(subscription, event);
  syncConfiguredItems(subscription);
  promoteNoSnapshotItemsToLive(subscription);
  applyItemEvent(subscription, event);
  reconcileSubscriptionOwnership(subscription, client, event.timestamp);
}

function applySyntheticTopologyEvent(
  event: LightstreamerEventEnvelope,
  subscriptions: Map<string, MutableSubscription>
): void {
  if (event.kind !== "item-update" || !event.subscription?.id) {
    return;
  }
  const subscription = subscriptions.get(event.subscription.id);
  if (!subscription || subscription.archived) {
    return;
  }

  subscription.syntheticUpdateCount += 1;
  subscription.lastSyntheticUpdateAt = event.timestamp;

  const item = findExistingItem(subscription, event);
  if (!item) {
    return;
  }
  item.syntheticUpdateCount += 1;
  item.lastSyntheticUpdateAt = event.timestamp;
}

function findExistingItem(
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): MutableItem | null {
  const name = event.item?.name ?? null;
  const position = event.item?.position ?? null;
  const resolvedName =
    name ??
    (position !== null
      ? subscription.metadata.items?.[position - 1] ?? null
      : null);
  const resolvedPosition =
    position ??
    (resolvedName
      ? (subscription.metadata.items?.indexOf(resolvedName) ?? -1) + 1 || null
      : null);
  return (
    subscription.items.get(itemIdentity(resolvedName, resolvedPosition)) ??
    (resolvedPosition !== null
      ? subscription.items.get(itemIdentity(null, resolvedPosition))
      : undefined) ??
    null
  );
}

function applyListenerEvent(
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): void {
  const listenerMetadata = event.listener;
  if (!listenerMetadata?.id) {
    return;
  }

  const listener =
    subscription.listeners.get(listenerMetadata.id) ??
    createMutableListener(listenerMetadata.id);
  subscription.listeners.set(listenerMetadata.id, listener);
  for (const callback of listenerMetadata.callbacks ?? []) {
    listener.callbacks.add(callback);
  }
  if (typeof listenerMetadata.registrationCount === "number") {
    listener.registrationCount = Math.max(
      listener.registrationCount,
      listenerMetadata.registrationCount
    );
  }
  if (typeof listenerMetadata.metricOwner === "boolean") {
    listener.metricOwner = listenerMetadata.metricOwner;
  }

  if (event.kind === "listener-added") {
    listener.active = true;
  } else if (event.kind === "listener-removed") {
    listener.active = false;
  }

  if (
    !event.synthetic &&
    event.source !== "synthetic" &&
    event.kind !== "listener-added" &&
    event.kind !== "listener-removed" &&
    typeof event.raw?.callback === "string"
  ) {
    listener.deliveryCount += 1;
    listener.firstDeliveryAt ??= event.timestamp;
    listener.lastDeliveryAt = event.timestamp;
    subscription.deliveryCount += 1;
  }
}

function applySubscriptionLifecycle(
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): void {
  const metadata = event.subscription;
  if (typeof metadata?.active === "boolean") {
    subscription.active = metadata.active;
  }
  if (typeof metadata?.subscribed === "boolean") {
    subscription.serverEstablished = metadata.subscribed;
  }

  const countsLogicalMetric = event.listener?.metricOwner !== false;

  switch (event.kind) {
    case "subscription-started":
      subscription.active = metadata?.active ?? true;
      subscription.endedAt = null;
      if (
        metadata?.subscribed === true ||
        event.raw?.callback === "onSubscription" ||
        event.raw?.frameTag === "SUBOK" ||
        event.raw?.frameTag === "SUBCMD"
      ) {
        subscription.serverEstablished = true;
        subscription.startedAt ??= event.timestamp;
        subscription.lastErrorAt = null;
      }
      break;
    case "subscription-snapshot":
      subscription.active = metadata?.active ?? true;
      subscription.serverEstablished = metadata?.subscribed ?? true;
      if (subscription.serverEstablished) {
        subscription.startedAt ??= event.timestamp;
        subscription.lastErrorAt = null;
      }
      subscription.endedAt = null;
      break;
    case "subscription-frequency":
      subscription.active = metadata?.active ?? true;
      subscription.serverEstablished = true;
      subscription.startedAt ??= event.timestamp;
      subscription.lastErrorAt = null;
      break;
    case "subscription-ended":
      subscription.active = metadata?.active ?? false;
      subscription.serverEstablished = false;
      if (!subscription.active) {
        subscription.endedAt = event.timestamp;
      }
      break;
    case "subscription-error":
      if (countsLogicalMetric) {
        subscription.errorCount += 1;
      }
      subscription.serverEstablished = false;
      subscription.lastErrorAt = event.timestamp;
      break;
    case "item-update":
      if (event.synthetic || event.source === "synthetic") {
        subscription.syntheticUpdateCount += 1;
        subscription.lastSyntheticUpdateAt = event.timestamp;
        break;
      }
      subscription.active = true;
      subscription.serverEstablished = true;
      subscription.startedAt ??= event.timestamp;
      subscription.endedAt = null;
      subscription.lastErrorAt = null;
      if (rememberLogicalUpdate(subscription, event)) {
        subscription.updateCount += 1;
        subscription.firstUpdateAt ??= event.timestamp;
        subscription.lastUpdateAt = event.timestamp;
      }
      break;
    case "lost-updates":
      if (countsLogicalMetric) {
        subscription.lostUpdateCount += lostUpdateCount(event);
      }
      break;
  }
}

function reconcileSubscriptionOwnership(
  subscription: MutableSubscription,
  client: MutableClient | null,
  timestamp: number
): void {
  if (!client) {
    return;
  }

  const currentSession = client.sessions.get(client.currentSessionKey);
  if (
    subscription.serverEstablished &&
    currentSession?.id &&
    !currentSession.historical
  ) {
    subscription.sessionKey = currentSession.key;
    subscription.lastSessionId = currentSession.id;
    subscription.pendingSince = null;
    subscription.waitingForSession = false;
    subscription.archived = false;
    return;
  }

  if (subscription.active) {
    const previousSession = subscription.sessionKey
      ? client.sessions.get(subscription.sessionKey)
      : null;
    subscription.lastSessionId =
      previousSession?.id ?? subscription.lastSessionId;
    subscription.sessionKey = null;
    subscription.pendingSince ??= timestamp;
    subscription.waitingForSession = !currentSession?.id;
    subscription.archived = false;
    return;
  }

  subscription.pendingSince = null;
  subscription.waitingForSession = false;
  if (currentSession?.id && !currentSession.historical) {
    subscription.sessionKey = currentSession.key;
    subscription.lastSessionId = currentSession.id;
    subscription.archived = false;
  }
}

function applyItemEvent(
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): void {
  const hasItem =
    event.item?.name !== undefined ||
    event.item?.position !== undefined;
  if (!hasItem) {
    return;
  }

  const item = ensureItem(
    subscription,
    event.item?.name ?? null,
    event.item?.position ?? null,
    "observed"
  );

  if (event.kind === "item-update") {
    if (event.synthetic || event.source === "synthetic") {
      item.syntheticUpdateCount += 1;
      item.lastSyntheticUpdateAt = event.timestamp;
      return;
    }

    if (event.listener && typeof event.raw?.callback === "string") {
      item.deliveryCount += 1;
    }
    if (!rememberLogicalItemUpdate(item, event)) {
      return;
    }

    item.updateCount += 1;
    item.firstUpdateAt ??= event.timestamp;
    item.lastUpdateAt = event.timestamp;
    item.snapshotPhase = event.update?.isSnapshot
      ? subscription.metadata.mode?.toUpperCase() === "MERGE"
        ? "snapshot-complete"
        : "snapshot"
      : "live";
    applyCommandSummary(item, subscription, event);
    return;
  }

  if (
    ["end-of-snapshot", "clear-snapshot", "lost-updates"].includes(event.kind) &&
    event.listener &&
    typeof event.raw?.callback === "string"
  ) {
    item.deliveryCount += 1;
  }

  switch (event.kind) {
    case "end-of-snapshot":
      if (event.listener?.metricOwner !== false) {
        item.snapshotPhase = "snapshot-complete";
      }
      break;
    case "clear-snapshot":
      if (event.listener?.metricOwner !== false) {
        item.snapshotPhase = "cleared";
        item.activeCommandKeys.clear();
      }
      break;
    case "lost-updates":
      if (event.listener?.metricOwner !== false) {
        item.lostUpdateCount += lostUpdateCount(event);
      }
      break;
  }
}

function syncConfiguredItems(subscription: MutableSubscription): void {
  for (const [index, itemName] of (subscription.metadata.items ?? []).entries()) {
    ensureItem(subscription, itemName, index + 1, "configured");
  }
}

function promoteNoSnapshotItemsToLive(
  subscription: MutableSubscription
): void {
  if (
    !subscription.serverEstablished ||
    !snapshotExplicitlyNotRequested(subscription.metadata)
  ) {
    return;
  }
  for (const item of subscription.items.values()) {
    if (
      item.snapshotPhase === "not-requested" ||
      item.snapshotPhase === "waiting"
    ) {
      item.snapshotPhase = "live";
    }
  }
}

function ensureItem(
  subscription: MutableSubscription,
  name: string | null,
  position: number | null,
  resolution: MutableItem["resolution"]
): MutableItem {
  const resolvedName =
    name ??
    (position !== null ? subscription.metadata.items?.[position - 1] ?? null : null);
  const resolvedPosition =
    position ??
    (resolvedName
      ? (subscription.metadata.items?.indexOf(resolvedName) ?? -1) + 1 || null
      : null);
  const id = itemIdentity(resolvedName, resolvedPosition);
  const existing = subscription.items.get(id);
  if (existing) {
    if (!existing.name && resolvedName) {
      existing.name = resolvedName;
    }
    if (existing.position === null && resolvedPosition !== null) {
      existing.position = resolvedPosition;
    }
    if (resolution === "observed") {
      existing.resolution = resolvedName ? "observed" : "position-only";
    }
    return existing;
  }

  const unresolved =
    resolvedPosition !== null
      ? subscription.items.get(itemIdentity(null, resolvedPosition))
      : null;
  if (unresolved && resolvedName) {
    subscription.items.delete(unresolved.id);
    unresolved.id = id;
    unresolved.name = resolvedName;
    unresolved.position = resolvedPosition;
    unresolved.resolution =
      resolution === "configured" ? "configured" : "observed";
    subscription.items.set(id, unresolved);
    return unresolved;
  }

  const item: MutableItem = {
    id,
    name: resolvedName,
    position: resolvedPosition,
    resolution:
      resolution === "observed" && !resolvedName
        ? "position-only"
        : resolution,
    updateCount: 0,
    syntheticUpdateCount: 0,
    deliveryCount: 0,
    firstUpdateAt: null,
    lastUpdateAt: null,
    lastSyntheticUpdateAt: null,
    snapshotPhase: initialSnapshotPhase(
      subscription.metadata,
      subscription.captureSource
    ),
    lostUpdateCount: 0,
    lastCommand: null,
    logicalUpdateIds: new Set(),
    activeCommandKeys: new Set(),
    deletedCommandKeys: new Set()
  };
  subscription.items.set(id, item);
  return item;
}

function applyCommandSummary(
  item: MutableItem,
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): void {
  if (subscription.metadata.mode?.toUpperCase() !== "COMMAND") {
    return;
  }
  const command = event.update?.command ?? null;
  const key = event.update?.key ?? null;
  if (!command) {
    return;
  }
  item.lastCommand = command;
  if (!key) {
    return;
  }
  if (command === "DELETE") {
    item.activeCommandKeys.delete(key);
    item.deletedCommandKeys.add(key);
  } else if (command === "ADD" || command === "UPDATE") {
    item.activeCommandKeys.add(key);
    item.deletedCommandKeys.delete(key);
  }
}

function ensureClient(
  clients: Map<string, MutableClient>,
  metadata: EventClient,
  timestamp: number
): MutableClient {
  const existing = clients.get(metadata.id);
  if (existing) {
    return existing;
  }

  const sessionId = nonEmpty(metadata.sessionId);
  const initialSessionKey = sessionId
    ? actualSessionKey(metadata.id, sessionId, 1)
    : pendingSessionKey(metadata.id);
  const client: MutableClient = {
    metadata: { ...metadata },
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    clientListenerIds: new Set(),
    sessions: new Map(),
    currentSessionKey: initialSessionKey,
    sessionLifecycleCount: sessionId ? 1 : 0
  };
  clients.set(metadata.id, client);
  ensureSession(
    client,
    initialSessionKey,
    nonEmpty(metadata.sessionId),
    timestamp
  );
  return client;
}

function ensureSession(
  client: MutableClient,
  key: string,
  id: string | null,
  timestamp: number
): MutableSession {
  const existing = client.sessions.get(key);
  if (existing) {
    if (id && !existing.id) {
      existing.id = id;
    }
    return existing;
  }

  const normalizedStatus = normalizeConnectionStatus(client.metadata.status);
  const session: MutableSession = {
    key,
    id,
    active: id !== null && isLiveSessionStatus(normalizedStatus),
    historical: false,
    status: client.metadata.status ?? null,
    normalizedStatus,
    transport: client.metadata.transport ?? null,
    serverInstanceAddress: client.metadata.serverInstanceAddress ?? null,
    serverSocketName: client.metadata.serverSocketName ?? null,
    clientIp: client.metadata.clientIp ?? null,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    endedAt: null,
    observingSince: timestamp,
    connectionEpochCount: id ? 1 : 0,
    recoveryCount: 0,
    historicalSubscriptions: []
  };
  client.sessions.set(key, session);
  return session;
}

function updateSession(
  session: MutableSession,
  client: EventClient,
  previousStatus: string | undefined,
  timestamp: number
): void {
  if (session.historical) {
    return;
  }
  const previousTransport = session.transport;
  session.lastSeenAt = Math.max(session.lastSeenAt, timestamp);
  assignIfDefined(session, "status", client.status);
  assignIfDefined(session, "transport", client.transport);
  assignIfDefined(session, "serverInstanceAddress", client.serverInstanceAddress);
  assignIfDefined(session, "serverSocketName", client.serverSocketName);
  assignIfDefined(session, "clientIp", client.clientIp);
  session.normalizedStatus = normalizeConnectionStatus(client.status ?? session.status);
  session.active =
    session.id !== null && isLiveSessionStatus(session.normalizedStatus);

  if (
    (previousTransport &&
      session.transport &&
      previousTransport !== session.transport) ||
    (isRecoveryStatus(client.status) && !isRecoveryStatus(previousStatus))
  ) {
    session.connectionEpochCount += 1;
  }
  if (
    isRecoveryStatus(client.status) &&
    !isRecoveryStatus(previousStatus)
  ) {
    session.recoveryCount += 1;
  }
}

function finalizeSession(
  client: MutableClient,
  session: MutableSession,
  subscriptions: Map<string, MutableSubscription>,
  timestamp: number
): void {
  const attached = Array.from(subscriptions.values()).filter(
    (subscription) =>
      !subscription.archived &&
      subscription.clientId === client.metadata.id &&
      subscription.sessionKey === session.key
  );
  const duplicateInfo = subscriptionDuplicateInfo(subscriptions);
  session.historicalSubscriptions = attached.map((subscription) =>
    historicalSubscription(
      snapshotSubscription(
        subscription,
        duplicateInfo.get(subscription.metadata.id) ?? noDuplicateInfo()
      )
    )
  );
  session.historical = true;
  session.active = false;
  session.endedAt = timestamp;
  session.lastSeenAt = Math.max(session.lastSeenAt, timestamp);

  for (const subscription of attached) {
    subscription.lastSessionId = session.id;
    subscription.serverEstablished = false;
    subscription.metadata.subscribed = false;
    subscription.sessionKey = null;
    if (subscription.active) {
      resetSubscriptionForNewSession(subscription, timestamp);
    } else {
      subscription.archived = true;
    }
  }

  pruneHistoricalSessions(client);
}

function pruneHistoricalSessions(client: MutableClient): void {
  const historical = Array.from(client.sessions.values())
    .filter((session) => session.historical)
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  for (const session of historical.slice(HISTORICAL_SESSION_LIMIT)) {
    client.sessions.delete(session.key);
  }
}

function createMutableSubscription(
  metadata: EventSubscription,
  timestamp: number
): MutableSubscription {
  return {
    metadata: { ...metadata },
    clientId: null,
    sessionKey: null,
    lastSessionId: null,
    active: metadata.active ?? false,
    serverEstablished: metadata.subscribed ?? false,
    pendingSince: null,
    waitingForSession: true,
    listeners: new Map(),
    reportedListenerCount: metadata.listenerCount ?? null,
    logicalUpdateIds: new Set(),
    updateCount: 0,
    syntheticUpdateCount: 0,
    deliveryCount: 0,
    firstUpdateAt: null,
    lastUpdateAt: null,
    lastSyntheticUpdateAt: null,
    lostUpdateCount: 0,
    errorCount: 0,
    lastErrorAt: null,
    createdAt: timestamp,
    startedAt: null,
    endedAt: null,
    captureSource: null,
    archived: false,
    items: new Map()
  };
}

function createMutableListener(id: string): MutableListener {
  return {
    id,
    attachmentIds: [],
    callbacks: new Set(),
    registrationCount: 1,
    active: true,
    metricOwner: false,
    deliveryCount: 0,
    firstDeliveryAt: null,
    lastDeliveryAt: null
  };
}

function createSnapshot(
  clients: Map<string, MutableClient>,
  subscriptions: Map<string, MutableSubscription>,
  observingSince: number | null
): TopologyState {
  const duplicateInfo = subscriptionDuplicateInfo(subscriptions);
  const liveSubscriptionSnapshots = new Map<string, TopologySubscription>();
  for (const [id, subscription] of subscriptions) {
    if (subscription.archived) {
      continue;
    }
    liveSubscriptionSnapshots.set(
      id,
      snapshotSubscription(
        subscription,
        duplicateInfo.get(id) ?? noDuplicateInfo()
      )
    );
  }

  const clientSnapshots = Array.from(clients.values())
    .map((client) => snapshotClient(client, liveSubscriptionSnapshots))
    .sort(
      (left, right) =>
        left.firstSeenAt - right.firstSeenAt || left.id.localeCompare(right.id)
    );
  const unassignedSubscriptions = Array.from(subscriptions.entries())
    .filter(([, subscription]) => !subscription.archived && !subscription.clientId)
    .map(([id]) => liveSubscriptionSnapshots.get(id))
    .filter(
      (subscription): subscription is TopologySubscription =>
        Boolean(subscription)
    )
    .sort(subscriptionSort);
  const allSubscriptions = Array.from(liveSubscriptionSnapshots.values());
  const allItems = allSubscriptions.flatMap((subscription) => subscription.items);
  const listenerIds = new Set<string>();
  for (const client of clientSnapshots) {
    client.clientListenerIds.forEach((id) => listenerIds.add(id));
  }
  for (const subscription of allSubscriptions) {
    subscription.listenerIds.forEach((id) => listenerIds.add(id));
  }

  return {
    observingSince,
    clients: clientSnapshots,
    unassignedSubscriptions,
    clientCount: clientSnapshots.length,
    activeSessionCount: clientSnapshots
      .flatMap((client) => client.sessions)
      .filter((session) => session.active).length,
    historicalSessionCount: clientSnapshots
      .flatMap((client) => client.sessions)
      .filter((session) => session.historical).length,
    subscriptionCount: allSubscriptions.length,
    activeSubscriptionCount: allSubscriptions.filter(
      (subscription) => subscription.active
    ).length,
    serverEstablishedSubscriptionCount: allSubscriptions.filter(
      (subscription) => subscription.serverEstablished
    ).length,
    itemCount: allItems.length,
    listenerCount: listenerIds.size
  };
}

function snapshotClient(
  client: MutableClient,
  subscriptions: Map<string, TopologySubscription>
): TopologyClient {
  const waitingSubscriptions = Array.from(subscriptions.values())
    .filter(
      (subscription) =>
        subscription.clientId === client.metadata.id &&
        subscription.active &&
        !subscription.serverEstablished &&
        subscription.sessionKey === null
    )
    .sort(subscriptionSort);
  const sessions = Array.from(client.sessions.values())
    .map((session): TopologySession => {
      const attached = session.historical
        ? session.historicalSubscriptions
        : Array.from(subscriptions.values())
            .filter(
              (subscription) =>
                subscription.clientId === client.metadata.id &&
                subscription.sessionKey === session.key
            )
            .sort(subscriptionSort);
      return {
        key: session.key,
        id: session.id,
        active: session.active,
        historical: session.historical,
        status: session.status,
        normalizedStatus: session.normalizedStatus,
        transport: session.transport,
        serverInstanceAddress: session.serverInstanceAddress,
        serverSocketName: session.serverSocketName,
        clientIp: session.clientIp,
        firstSeenAt: session.firstSeenAt,
        lastSeenAt: session.lastSeenAt,
        endedAt: session.endedAt,
        observingSince: session.observingSince,
        connectionEpochCount: session.connectionEpochCount,
        recoveryCount: session.recoveryCount,
        subscriptions: attached
      };
    })
    .filter(
      (session) =>
        session.historical ||
        session.id !== null ||
        session.subscriptions.length > 0 ||
        session.key === client.currentSessionKey
    )
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        Number(left.historical) - Number(right.historical) ||
        right.lastSeenAt - left.lastSeenAt
    );

  return {
    ...client.metadata,
    normalizedStatus: normalizeConnectionStatus(client.metadata.status),
    firstSeenAt: client.firstSeenAt,
    lastSeenAt: client.lastSeenAt,
    clientListenerIds: Array.from(client.clientListenerIds).sort(),
    waitingSubscriptions,
    sessions
  };
}

function snapshotSubscription(
  subscription: MutableSubscription,
  duplicateInfo: DuplicateInfo
): TopologySubscription {
  const listeners = Array.from(subscription.listeners.values())
    .map(snapshotListener)
    .sort((left, right) => left.id.localeCompare(right.id));
  const activeListeners = listeners.filter((listener) => listener.active);
  const listenerCount =
    subscription.reportedListenerCount ??
    activeListeners.length;
  const listenerIds = activeListeners.map((listener) => listener.id);

  return {
    ...subscription.metadata,
    configuredItems: subscription.metadata.items,
    clientId: subscription.clientId,
    sessionKey: subscription.sessionKey,
    lastSessionId: subscription.lastSessionId,
    active: subscription.active,
    serverEstablished: subscription.serverEstablished,
    statusLabel: subscriptionStatusLabel(subscription),
    pendingSince: subscription.pendingSince,
    waitingForSession: subscription.waitingForSession,
    listenerIds,
    listeners,
    listenerCount,
    updateCount: subscription.updateCount,
    syntheticUpdateCount: subscription.syntheticUpdateCount,
    deliveryCount: subscription.deliveryCount,
    firstUpdateAt: subscription.firstUpdateAt,
    lastUpdateAt: subscription.lastUpdateAt,
    lastSyntheticUpdateAt: subscription.lastSyntheticUpdateAt,
    lostUpdateCount: subscription.lostUpdateCount,
    errorCount: subscription.errorCount,
    createdAt: subscription.createdAt,
    startedAt: subscription.startedAt,
    endedAt: subscription.endedAt,
    duplicateKind: duplicateInfo.kind,
    duplicateCount: duplicateInfo.exactCount,
    exactDuplicateCount: duplicateInfo.exactCount,
    overlapCount: duplicateInfo.overlapCount,
    captureSource: subscription.captureSource,
    historical: false,
    establishments: [],
    commandGenerations: [],
    items: Array.from(subscription.items.values())
      .map((item) => snapshotItem(item, listenerIds))
      .sort(itemSort)
  };
}

function snapshotListener(listener: MutableListener): TopologyListener {
  return {
    ...listener,
    callbacks: Array.from(listener.callbacks).sort()
  };
}

function snapshotItem(
  item: MutableItem,
  listenerIds: string[]
): TopologyItem {
  return {
    id: item.id,
    name: item.name,
    position: item.position,
    resolution: item.resolution,
    updateCount: item.updateCount,
    syntheticUpdateCount: item.syntheticUpdateCount,
    deliveryCount: item.deliveryCount,
    firstUpdateAt: item.firstUpdateAt,
    lastUpdateAt: item.lastUpdateAt,
    lastSyntheticUpdateAt: item.lastSyntheticUpdateAt,
    snapshotPhase: item.snapshotPhase,
    lostUpdateCount: item.lostUpdateCount,
    activeCommandKeyCount: item.activeCommandKeys.size,
    deletedCommandKeyCount: item.deletedCommandKeys.size,
    lastCommand: item.lastCommand,
    listenerIds: [...listenerIds]
  };
}

function historicalSubscription(
  subscription: TopologySubscription
): TopologySubscription {
  return {
    ...subscription,
    historical: true,
    listenerIds: [],
    listeners: [],
    items: subscription.items.map((item) => ({
      ...item,
      listenerIds: []
    }))
  };
}

function subscriptionDuplicateInfo(
  subscriptions: Map<string, MutableSubscription>
): Map<string, DuplicateInfo> {
  const exactGroups = new Map<string, string[]>();
  const overlapGroups = new Map<string, string[]>();

  for (const [id, subscription] of subscriptions) {
    if (
      subscription.archived ||
      !subscription.active ||
      !subscription.clientId
    ) {
      continue;
    }
    appendGroup(exactGroups, exactSubscriptionSignature(subscription), id);
    appendGroup(overlapGroups, overlapSubscriptionSignature(subscription), id);
  }

  const result = new Map<string, DuplicateInfo>();
  for (const [id, subscription] of subscriptions) {
    if (
      subscription.archived ||
      !subscription.active ||
      !subscription.clientId
    ) {
      result.set(id, noDuplicateInfo());
      continue;
    }
    const exactCount =
      exactGroups.get(exactSubscriptionSignature(subscription))?.length ?? 1;
    const overlapCount =
      overlapGroups.get(overlapSubscriptionSignature(subscription))?.length ?? 1;
    result.set(id, {
      kind:
        exactCount > 1
          ? "exact"
          : overlapCount > 1
            ? "overlap"
            : "none",
      exactCount,
      overlapCount
    });
  }
  return result;
}

function exactSubscriptionSignature(
  subscription: MutableSubscription
): string {
  return JSON.stringify([
    overlapSubscriptionSignature(subscription),
    subscription.metadata.requestedSnapshot ?? null,
    subscription.metadata.requestedBufferSize ?? null,
    subscription.metadata.requestedMaxFrequency ?? null,
    subscription.metadata.commandSecondLevelDataAdapter ?? null,
    subscription.metadata.commandSecondLevelFields ??
      subscription.metadata.commandSecondLevelFieldSchema ??
      null
  ]);
}

function overlapSubscriptionSignature(
  subscription: MutableSubscription
): string {
  return JSON.stringify([
    subscription.clientId,
    subscription.sessionKey ?? "waiting",
    subscription.metadata.mode ?? null,
    subscription.metadata.items ?? subscription.metadata.itemGroup ?? null,
    subscription.metadata.fields ?? subscription.metadata.fieldSchema ?? null,
    subscription.metadata.dataAdapter ?? null,
    subscription.metadata.selector ?? null
  ]);
}

function appendGroup(
  groups: Map<string, string[]>,
  signature: string,
  id: string
): void {
  const ids = groups.get(signature) ?? [];
  ids.push(id);
  groups.set(signature, ids);
}

function noDuplicateInfo(): DuplicateInfo {
  return { kind: "none", exactCount: 1, overlapCount: 1 };
}

function rememberBoundedIdentity(
  identities: Set<string>,
  identity: string,
  limit: number
): boolean {
  if (identities.has(identity)) {
    return false;
  }
  identities.add(identity);
  if (identities.size > limit) {
    const oldest = identities.values().next().value;
    if (oldest !== undefined) {
      identities.delete(oldest);
    }
  }
  return true;
}

function rememberLogicalUpdate(
  subscription: MutableSubscription,
  event: LightstreamerEventEnvelope
): boolean {
  const logicalEventId = event.logicalEventId ?? event.id;
  return rememberBoundedIdentity(
    subscription.logicalUpdateIds,
    logicalEventId,
    LOGICAL_UPDATE_DEDUP_LIMIT
  );
}

function rememberLogicalItemUpdate(
  item: MutableItem,
  event: LightstreamerEventEnvelope
): boolean {
  const logicalEventId = event.logicalEventId ?? event.id;
  return rememberBoundedIdentity(
    item.logicalUpdateIds,
    logicalEventId,
    LOGICAL_UPDATE_DEDUP_LIMIT
  );
}

function resetSubscriptionForNewSession(
  subscription: MutableSubscription,
  timestamp: number
): void {
  resetSubscriptionCounters(subscription);
  subscription.serverEstablished = false;
  subscription.pendingSince = timestamp;
  subscription.waitingForSession = true;
  subscription.startedAt = null;
  subscription.endedAt = null;
  subscription.lastErrorAt = null;
  subscription.archived = false;
  for (const item of subscription.items.values()) {
    item.snapshotPhase = initialSnapshotPhase(
      subscription.metadata,
      subscription.captureSource
    );
    item.activeCommandKeys.clear();
    item.deletedCommandKeys.clear();
    item.lastCommand = null;
  }
}

function resetSubscriptionCounters(
  subscription: MutableSubscription
): void {
  subscription.logicalUpdateIds.clear();
  subscription.updateCount = 0;
  subscription.syntheticUpdateCount = 0;
  subscription.deliveryCount = 0;
  subscription.firstUpdateAt = null;
  subscription.lastUpdateAt = null;
  subscription.lastSyntheticUpdateAt = null;
  subscription.lostUpdateCount = 0;
  subscription.errorCount = 0;
  for (const listener of subscription.listeners.values()) {
    listener.deliveryCount = 0;
    listener.firstDeliveryAt = null;
    listener.lastDeliveryAt = null;
  }
  for (const item of subscription.items.values()) {
    item.logicalUpdateIds.clear();
    item.updateCount = 0;
    item.syntheticUpdateCount = 0;
    item.deliveryCount = 0;
    item.firstUpdateAt = null;
    item.lastUpdateAt = null;
    item.lastSyntheticUpdateAt = null;
    item.lostUpdateCount = 0;
  }
}

function subscriptionStatusLabel(
  subscription: MutableSubscription
): TopologySubscription["statusLabel"] {
  if (subscription.serverEstablished) {
    return "Subscribed";
  }
  if (!subscription.active) {
    return "Inactive";
  }
  if (subscription.lastErrorAt !== null) {
    return "Failed";
  }
  return subscription.waitingForSession ? "Waiting for session" : "Pending";
}

function initialSnapshotPhase(
  metadata: EventSubscription,
  captureSource: EventCaptureSource | null
): TopologySnapshotPhase {
  if (snapshotExplicitlyNotRequested(metadata)) {
    return "not-requested";
  }
  if (metadata.requestedSnapshot === undefined || metadata.requestedSnapshot === null) {
    return captureSource === "wire" ? "unknown" : "waiting";
  }
  return "waiting";
}

function snapshotExplicitlyNotRequested(
  metadata: EventSubscription
): boolean {
  return (
    metadata.mode?.toUpperCase() === "RAW" ||
    metadata.requestedSnapshot === false ||
    ["false", "no"].includes(String(metadata.requestedSnapshot).toLowerCase())
  );
}

function lostUpdateCount(event: LightstreamerEventEnvelope): number {
  const normalized = event.update?.lostUpdates;
  if (typeof normalized === "number" && normalized > 0) {
    return normalized;
  }
  const rawValue = event.raw?.args;
  if (Array.isArray(rawValue)) {
    const candidate = rawValue[2];
    return typeof candidate === "number" && candidate > 0 ? candidate : 0;
  }
  return 0;
}

function itemIdentity(name: string | null, position: number | null): string {
  return JSON.stringify([position, name]);
}

function nextActualSessionKey(client: MutableClient, sessionId: string): string {
  client.sessionLifecycleCount += 1;
  return actualSessionKey(
    client.metadata.id,
    sessionId,
    client.sessionLifecycleCount
  );
}

function actualSessionKey(
  clientId: string,
  sessionId: string,
  lifecycle: number
): string {
  return `session:${clientId}:${sessionId}:${lifecycle}`;
}

function pendingSessionKey(clientId: string): string {
  return `pending:${clientId}`;
}

function isSessionEndedStatus(status: string | undefined): boolean {
  const normalized = status?.toUpperCase();
  return Boolean(
    normalized?.startsWith("DISCONNECTED") &&
      !normalized.includes("TRYING-RECOVERY")
  );
}

function isRecoveryStatus(status: string | undefined): boolean {
  return Boolean(status?.toUpperCase().includes("TRYING-RECOVERY"));
}

function normalizeConnectionStatus(
  status: string | null | undefined
): TopologyConnectionState {
  const normalized = status?.toUpperCase();
  if (!normalized) {
    return "unknown";
  }
  if (normalized.includes("TRYING-RECOVERY")) {
    return "recovering";
  }
  if (normalized.startsWith("CONNECTED")) {
    return "connected";
  }
  if (normalized.startsWith("STALLED")) {
    return "stalled";
  }
  if (normalized.startsWith("DISCONNECTED")) {
    return "disconnected";
  }
  if (normalized.startsWith("CONNECTING")) {
    return "connecting";
  }
  return "unknown";
}

function isLiveSessionStatus(status: TopologyConnectionState): boolean {
  return (
    status === "connected" ||
    status === "recovering" ||
    status === "stalled"
  );
}

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function mergeDefined<T extends object>(target: T, source: Partial<T>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

function assignIfDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function subscriptionSort(
  left: TopologySubscription,
  right: TopologySubscription
): number {
  return (
    Number(right.serverEstablished) - Number(left.serverEstablished) ||
    Number(right.active) - Number(left.active) ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function itemSort(left: TopologyItem, right: TopologyItem): number {
  return (
    (left.position ?? Number.MAX_SAFE_INTEGER) -
      (right.position ?? Number.MAX_SAFE_INTEGER) ||
    (left.name ?? "").localeCompare(right.name ?? "")
  );
}
