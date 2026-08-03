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
  let structuralSelectionDirty = true;
  let selectedStructuralState: TopologyState | null = null;
  let usingLegacyLiveFallback = false;

  function invalidateStructuralSelection(): void {
    structuralSelectionDirty = true;
    selectedStructuralState = null;
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
    const observation = event.topology;
    if (!observation) {
      legacyLiveFallbackIndex.ingest(event);
      invalidateStructuralSelection();
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
    invalidateStructuralSelection();
    return activation;
  }

  function ingestHistory(event: LightstreamerEventEnvelope): boolean {
    const belongsToCurrentPage = !staleSemanticEventIds.delete(event.id);
    const wasSemanticCapture = retainedSemanticEventIds.delete(event.id);
    legacyIndex.ingest(event);
    if (belongsToCurrentPage && !wasSemanticCapture) {
      legacyLiveFallbackIndex.ingest(event);
    }
    invalidateStructuralSelection();
    return belongsToCurrentPage;
  }

  function replaceHistory(events: readonly LightstreamerEventEnvelope[]): void {
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
    invalidateStructuralSelection();
  }

  function applySyncFrame(frame: TopologySyncFrame): TopologyProjectionResult {
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
    invalidateStructuralSelection();
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

  function structuralProjection(): TopologyState {
    if (!structuralSelectionDirty && selectedStructuralState) {
      return selectedStructuralState;
    }
    const activeState = snapshotPanelTopologyState(activeIndex());
    const fallbackState = legacyLiveFallbackIndex.snapshot();
    usingLegacyLiveFallback =
      semanticActive &&
      fallbackPreservesAndExtendsStructure(activeState, fallbackState);
    selectedStructuralState = usingLegacyLiveFallback ? fallbackState : activeState;
    structuralSelectionDirty = false;
    return selectedStructuralState;
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
    invalidateStructuralSelection();
  }

  return {
    ingestCapture,
    ingestHistory,
    replaceHistory,
    applySyncFrame,

    snapshot() {
      return mergePreservedHistory(structuralProjection());
    },

    status() {
      structuralProjection();
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
      invalidateStructuralSelection();
    },

    clearHistory() {
      activeIndex().clearHistory();
      legacyLiveFallbackIndex.clearHistory();
      preservedHistory.clear();
      invalidateStructuralSelection();
    },

    clear() {
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

function topologyStructuralKeys(state: TopologyState): Set<string> {
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

function semanticEventKey(
  observation: Pick<TopologyObservation, "pageEpoch" | "captureSequence">
): string {
  return `${observation.pageEpoch}:${observation.captureSequence}`;
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
