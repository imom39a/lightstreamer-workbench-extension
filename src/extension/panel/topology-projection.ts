import {
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  type TopologyCoverage,
  type TopologyObservation,
  type TopologySyncFrame
} from "../../bridge/messages";
import { type LightstreamerEventEnvelope } from "../../core/event-envelope";
import {
  createTopologyStateIndex,
  type TopologyClient,
  type TopologyState,
  type TopologyStateIndex
} from "../../core/topology-state";
import {
  createTopologySyncCoordinator,
  type TopologySyncStatus
} from "../../core/topology-sync";
import {
  createPanelTopologySyncAdapter,
  resetPanelTopologyObservations,
  snapshotPanelTopologyState
} from "./topology-sync-adapter";
import {
  topologyClientKey,
  topologyCommandGenerationKey,
  topologyInferredChildKey,
  topologyItemKey,
  topologyListenerKey,
  topologySessionKey,
  topologySubscriptionKey
} from "./topology-view-model";

export type TopologyProjectionStatus = {
  semanticActive: boolean;
  syncState: TopologySyncStatus["state"] | "legacy";
  coverage: TopologyCoverage | null;
};

export type TopologyProjectionResult = {
  accepted: boolean;
  resetConsumerState: boolean;
};

export type TopologyProjection = {
  ingestCapture(event: LightstreamerEventEnvelope): TopologyProjectionResult;
  ingestHistory(event: LightstreamerEventEnvelope): boolean;
  replaceHistory(events: readonly LightstreamerEventEnvelope[]): void;
  applySyncFrame(frame: TopologySyncFrame): TopologyProjectionResult;
  snapshot(): TopologyState;
  scopeStructureRevision(): number;
  sensitiveStructureRevision(): number;
  status(): TopologyProjectionStatus;
  resetCurrentObservations(): void;
  clearHistory(): void;
  clear(): void;
};

const MAX_RETAINED_SEMANTIC_EVENTS = 4_096;
const MAX_RETIRED_PAGE_EPOCHS = 16;

/** Owns legacy reconstruction, semantic live projection, checkpoint sync, and history merging. */
export function createTopologyProjection(): TopologyProjection {
  const legacyIndex = createTopologyStateIndex();
  const legacyLiveFallbackIndex = createTopologyStateIndex();
  const semanticEvents = new Map<string, LightstreamerEventEnvelope>();
  const syncAdapter = createPanelTopologySyncAdapter((observation) => {
    const key = semanticEventKey(observation);
    const event = semanticEvents.get(key);
    semanticEvents.delete(key);
    return event;
  });
  let generation = 0;
  let syncCoordinator = createTopologySyncCoordinator("panel:legacy", syncAdapter);
  let semanticActive = false;
  let coverage: TopologyCoverage | null = null;
  const retiredPageEpochs = new Set<string>();
  const preservedHistory = new Map<string, TopologyClient>();
  const staleSemanticEventIds = new Set<string>();
  const retainedSemanticEventIds = new Set<string>();
  let materializedStateDirty = true;
  let materializedScopeStructureDirty = true;
  let materializedState: TopologyState | null = null;
  let materializedScopeStructureKeys: readonly string[] = [];
  let scopeStructureRevision = 0;
  let sensitiveStructureRevision = 0;
  let usingLegacyLiveFallback = false;

  function invalidateMaterializedState(scopeStructureMayHaveChanged = true): void {
    materializedStateDirty = true;
    materializedScopeStructureDirty ||= scopeStructureMayHaveChanged;
  }

  function activatePage(pageEpoch: string): TopologyProjectionResult {
    if (retiredPageEpochs.has(pageEpoch)) {
      return { accepted: false, resetConsumerState: false };
    }
    const resetConsumerState =
      !semanticActive || syncCoordinator.pageEpoch() !== pageEpoch;
    if (resetConsumerState) {
      if (semanticActive) {
        rememberHistory(snapshotPanelTopologyState(syncCoordinator.snapshot()));
        retiredPageEpochs.add(syncCoordinator.pageEpoch());
        trimSet(retiredPageEpochs, MAX_RETIRED_PAGE_EPOCHS);
        legacyLiveFallbackIndex.clear();
      }
      syncCoordinator.retirePageEpoch(pageEpoch);
      semanticEvents.clear();
      retainedSemanticEventIds.clear();
    }
    semanticActive = true;
    return { accepted: true, resetConsumerState };
  }

  function ingestCapture(event: LightstreamerEventEnvelope): TopologyProjectionResult {
    const scopeStructureMayHaveChanged = eventMayChangeScopeStructure(
      event,
      materializedState
    );
    if (eventMayChangeSensitiveStructure(event, scopeStructureMayHaveChanged)) {
      sensitiveStructureRevision += 1;
    }
    const observation = event.topology;
    if (!observation) {
      legacyLiveFallbackIndex.ingest(event);
      invalidateMaterializedState(scopeStructureMayHaveChanged);
      return { accepted: true, resetConsumerState: false };
    }
    const activation = activatePage(observation.pageEpoch);
    if (!activation.accepted) {
      staleSemanticEventIds.add(event.id);
      trimSet(staleSemanticEventIds, MAX_RETAINED_SEMANTIC_EVENTS);
      return activation;
    }
    coverage = observation.coverage;
    retainedSemanticEventIds.add(event.id);
    trimSet(retainedSemanticEventIds, MAX_RETAINED_SEMANTIC_EVENTS);
    semanticEvents.set(semanticEventKey(observation), event);
    trimMap(semanticEvents, MAX_RETAINED_SEMANTIC_EVENTS);
    syncCoordinator.applyLive(observation);
    invalidateMaterializedState(scopeStructureMayHaveChanged);
    return activation;
  }

  function ingestHistory(event: LightstreamerEventEnvelope): boolean {
    const scopeStructureMayHaveChanged = eventMayChangeScopeStructure(
      event,
      materializedState
    );
    if (eventMayChangeSensitiveStructure(event, scopeStructureMayHaveChanged)) {
      sensitiveStructureRevision += 1;
    }
    const belongsToCurrentPage = !staleSemanticEventIds.delete(event.id);
    const wasSemanticCapture = retainedSemanticEventIds.delete(event.id);
    legacyIndex.ingest(event);
    if (belongsToCurrentPage && !wasSemanticCapture) {
      legacyLiveFallbackIndex.ingest(event);
    }
    invalidateMaterializedState(scopeStructureMayHaveChanged);
    return belongsToCurrentPage;
  }

  function replaceHistory(events: readonly LightstreamerEventEnvelope[]): void {
    sensitiveStructureRevision += 1;
    legacyIndex.clear();
    if (!semanticActive) {
      legacyLiveFallbackIndex.clear();
    }
    for (const event of events) {
      legacyIndex.ingest(event);
      if (!semanticActive) {
        legacyLiveFallbackIndex.ingest(event);
      }
    }
    invalidateMaterializedState();
  }

  function applySyncFrame(frame: TopologySyncFrame): TopologyProjectionResult {
    sensitiveStructureRevision += 1;
    const activation = activatePage(frame.pageEpoch);
    if (!activation.accepted) {
      return activation;
    }
    coverage = frame.coverage;
    if (frame.type === TOPOLOGY_SYNC_BEGIN) {
      rememberHistory(snapshotPanelTopologyState(syncCoordinator.snapshot()));
      syncCoordinator.begin(frame);
    } else if (frame.type === TOPOLOGY_SYNC_CHUNK) {
      syncCoordinator.acceptChunk(frame);
    } else {
      syncCoordinator.complete(frame);
      if (syncCoordinator.status().state !== "partial") {
        for (const [key, event] of semanticEvents) {
          if (
            event.topology?.pageEpoch === frame.pageEpoch &&
            event.topology.captureSequence <= frame.cutoffCaptureSequence
          ) {
            semanticEvents.delete(key);
          }
        }
      }
    }
    if (syncCoordinator.status().state === "partial") {
      replayRetainedEvents(frame.pageEpoch);
    }
    invalidateMaterializedState();
    return activation;
  }

  function replayRetainedEvents(pageEpoch: string): void {
    const retained = [...semanticEvents.values()]
      .filter((event) => event.topology?.pageEpoch === pageEpoch)
      .sort(
        (left, right) =>
          (left.topology?.captureSequence ?? 0) -
          (right.topology?.captureSequence ?? 0)
      );
    for (const event of retained) {
      if (event.topology) {
        syncCoordinator.applyLive(event.topology);
      }
    }
  }

  function activeIndex(): TopologyStateIndex {
    return semanticActive ? syncCoordinator.snapshot() : legacyIndex;
  }

  function currentMaterializedState(): TopologyState {
    if (!materializedStateDirty && materializedState) {
      return materializedState;
    }
    const activeState = snapshotPanelTopologyState(activeIndex());
    let selectedState = activeState;
    usingLegacyLiveFallback = false;
    if (semanticActive) {
      const fallbackState = legacyLiveFallbackIndex.snapshot();
      usingLegacyLiveFallback = fallbackPreservesAndExtendsStructure(
        activeState,
        fallbackState
      );
      if (usingLegacyLiveFallback) selectedState = fallbackState;
    }
    materializedState = mergePreservedHistory(selectedState);
    if (materializedScopeStructureDirty) {
      const nextStructureKeys = [...topologyStructuralKeys(materializedState, false)];
      if (!sameOrderedKeys(materializedScopeStructureKeys, nextStructureKeys)) {
        scopeStructureRevision += 1;
      }
      materializedScopeStructureKeys = nextStructureKeys;
      materializedScopeStructureDirty = false;
    }
    materializedStateDirty = false;
    return materializedState;
  }

  function rememberHistory(state: TopologyState): void {
    for (const client of state.clients) {
      const historicalSessions = client.sessions.filter((session) => session.historical);
      if (historicalSessions.length === 0) continue;
      const previous = preservedHistory.get(client.id);
      const sessions = new Map(
        previous?.sessions.map((session) => [session.key, session]) ?? []
      );
      for (const session of historicalSessions) {
        sessions.set(session.key, session);
      }
      preservedHistory.set(client.id, {
        ...client,
        waitingSubscriptions: [],
        sessions: [...sessions.values()]
          .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
          .slice(0, 5)
      });
    }
  }

  function mergePreservedHistory(state: TopologyState): TopologyState {
    if (!semanticActive || preservedHistory.size === 0) {
      return state;
    }
    const clients = new Map(state.clients.map((client) => [client.id, client]));
    for (const [clientId, historicalClient] of preservedHistory) {
      const current = clients.get(clientId);
      if (!current) {
        clients.set(clientId, historicalClient);
        continue;
      }
      const sessions = new Map(current.sessions.map((session) => [session.key, session]));
      for (const session of historicalClient.sessions) {
        if (!sessions.has(session.key)) sessions.set(session.key, session);
      }
      clients.set(clientId, { ...current, sessions: [...sessions.values()] });
    }
    const mergedClients = [...clients.values()];
    return {
      ...state,
      clients: mergedClients,
      clientCount: mergedClients.length,
      historicalSessionCount: mergedClients
        .flatMap((client) => client.sessions)
        .filter((session) => session.historical).length
    };
  }

  function resetSemanticProjection(): void {
    generation += 1;
    syncCoordinator = createTopologySyncCoordinator(
      `panel:legacy:${generation}`,
      syncAdapter
    );
    semanticActive = false;
    coverage = null;
    semanticEvents.clear();
    retiredPageEpochs.clear();
    preservedHistory.clear();
    staleSemanticEventIds.clear();
    retainedSemanticEventIds.clear();
    legacyLiveFallbackIndex.clear();
    usingLegacyLiveFallback = false;
    invalidateMaterializedState();
  }

  return {
    ingestCapture,
    ingestHistory,
    replaceHistory,
    applySyncFrame,

    snapshot() {
      return currentMaterializedState();
    },

    scopeStructureRevision() {
      currentMaterializedState();
      return scopeStructureRevision;
    },

    sensitiveStructureRevision() {
      return sensitiveStructureRevision;
    },

    status() {
      currentMaterializedState();
      if (usingLegacyLiveFallback) {
        return {
          semanticActive: false,
          syncState: "legacy",
          coverage: null
        };
      }
      return {
        semanticActive,
        syncState: semanticActive ? syncCoordinator.status().state : "legacy",
        coverage
      };
    },

    resetCurrentObservations() {
      resetPanelTopologyObservations(activeIndex());
      legacyLiveFallbackIndex.resetCurrentObservations();
      invalidateMaterializedState();
    },

    clearHistory() {
      sensitiveStructureRevision += 1;
      activeIndex().clearHistory();
      legacyLiveFallbackIndex.clearHistory();
      preservedHistory.clear();
      invalidateMaterializedState();
    },

    clear() {
      sensitiveStructureRevision += 1;
      legacyIndex.clear();
      resetSemanticProjection();
    }
  };
}

function fallbackPreservesAndExtendsStructure(
  semanticState: TopologyState,
  fallbackState: TopologyState
): boolean {
  const semanticKeys = topologyStructuralKeys(semanticState);
  const fallbackKeys = topologyStructuralKeys(fallbackState);
  return (
    fallbackKeys.size > semanticKeys.size &&
    [...semanticKeys].every((key) => fallbackKeys.has(key))
  );
}

function topologyStructuralKeys(
  state: TopologyState,
  includeNonScopeNodes = true
): Set<string> {
  const keys = new Set<string>();
  const addSubscription = (
    client: TopologyClient | null,
    session: TopologyClient["sessions"][number] | null,
    subscription: TopologyState["unassignedSubscriptions"][number]
  ): void => {
    keys.add(topologySubscriptionKey(client, session, subscription));
    for (const item of subscription.items) {
      keys.add(topologyItemKey(client, session, subscription, item));
      for (const listenerId of item.listenerIds) {
        keys.add(
          topologyListenerKey(client, session, subscription, item, listenerId)
        );
      }
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        keys.add(
          topologyListenerKey(client, session, subscription, null, listenerId)
        );
      }
    }
    if (includeNonScopeNodes) {
      for (const generation of subscription.commandGenerations) {
        keys.add(
          topologyCommandGenerationKey(client, session, subscription, generation)
        );
        for (const child of generation.inferredChildren) {
          keys.add(
            topologyInferredChildKey(
              client,
              session,
              subscription,
              generation,
              child
            )
          );
        }
      }
    }
  };

  for (const client of state.clients) {
    keys.add(topologyClientKey(client));
    for (const subscription of client.waitingSubscriptions) {
      addSubscription(client, null, subscription);
    }
    for (const session of client.sessions) {
      keys.add(topologySessionKey(client, session));
      for (const subscription of session.subscriptions) {
        addSubscription(client, session, subscription);
      }
    }
  }
  for (const subscription of state.unassignedSubscriptions) {
    addSubscription(null, null, subscription);
  }
  return keys;
}

/**
 * Item updates are the topology hot path. They cannot change Scope membership
 * when every referenced owner is already present at the exact active path and
 * the listener is already attached to the item. Unknown or partial ownership
 * remains structural so this optimization can never hide a new Scope node.
 */
function eventMayChangeScopeStructure(
  event: LightstreamerEventEnvelope,
  state: TopologyState | null
): boolean {
  if (event.kind !== "item-update" || !state) return true;

  const clientId = event.client?.id;
  const sessionId = event.client?.sessionId;
  const subscriptionId = event.subscription?.id;
  if (!clientId || !sessionId || !subscriptionId) return true;

  const client = state.clients.find((candidate) => candidate.id === clientId);
  const session = client?.sessions.find(
    (candidate) =>
      candidate.id === sessionId && candidate.active && !candidate.historical
  );
  const subscription = session?.subscriptions.find(
    (candidate) =>
      candidate.id === subscriptionId &&
      candidate.active &&
      candidate.serverEstablished
  );
  if (!subscription) return true;

  const configuredItems = event.subscription?.items;
  if (
    configuredItems &&
    !sameOrderedKeys(subscription.configuredItems ?? [], configuredItems)
  ) {
    return true;
  }

  const itemName = event.item?.name;
  const itemPosition = event.item?.position;
  if (itemName === undefined && itemPosition === undefined) {
    return event.listener?.id
      ? !subscription.listeners.some(
          (listener) => listener.id === event.listener?.id
        )
      : false;
  }
  const item = subscription.items.find(
    (candidate) =>
      (itemName === undefined || candidate.name === itemName) &&
      (itemPosition === undefined || candidate.position === itemPosition)
  );
  if (!item) return true;

  const listenerId = event.listener?.id;
  return listenerId
    ? !subscription.listeners.some((listener) => listener.id === listenerId) ||
        !item.listenerIds.includes(listenerId)
    : false;
}

function eventMayChangeSensitiveStructure(
  event: LightstreamerEventEnvelope,
  scopeStructureMayHaveChanged: boolean
): boolean {
  if (scopeStructureMayHaveChanged) return true;
  const subscription = event.subscription;
  return Boolean(
    event.client?.serverAddress !== undefined ||
    event.client?.serverInstanceAddress !== undefined ||
    event.client?.clientIp !== undefined ||
    subscription?.fields ||
    subscription?.fieldSchema !== undefined ||
    subscription?.commandSecondLevelFields ||
    subscription?.commandSecondLevelFieldSchema !== undefined ||
    event.update?.command ||
    event.update?.key
  );
}

function semanticEventKey(
  observation: Pick<TopologyObservation, "pageEpoch" | "captureSequence">
): string {
  return `${observation.pageEpoch}:${observation.captureSequence}`;
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function sameOrderedKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function trimMap<K, V>(map: Map<K, V>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

function trimSet<T>(set: Set<T>, limit: number): void {
  while (set.size > limit) {
    const oldest = set.values().next().value as T | undefined;
    if (oldest === undefined) return;
    set.delete(oldest);
  }
}
