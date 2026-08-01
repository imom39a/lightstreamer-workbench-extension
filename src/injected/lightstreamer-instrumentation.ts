import {
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_LIMITS,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_LIMITS,
  TOPOLOGY_SYNC_VERSION,
  type CaptureKind,
  type CapturePayload,
  PAGE_REINJECTION_BRIDGE_GLOBAL,
  PAGE_REINJECTION_BRIDGE_VERSION,
  PAGE_REINJECT_REQUEST,
  RUNTIME_REINJECT_RESULT,
  type ReinjectionDraftPayload,
  type ReinjectionResult,
  type TopologyEvidenceRecord,
  type TopologyCoverage,
  type TopologyAbsoluteRecord,
  type TopologyObservation,
  type TopologySyncFrame,
  type TopologyValue,
  createCaptureMessage,
  isTopologyObservationForCapture,
  isTopologySyncFrame,
  isPageCaptureSyncRequestMessage,
  isPageReinjectRequestMessage,
  topologySyncUtf8Bytes
} from "../bridge/messages";
import { createStableIdAllocator, type StableIdAllocator } from "../core/ids";
import {
  type LightstreamerClientLike,
  type LightstreamerHost,
  type LightstreamerListenerLike,
  type LightstreamerSubscriptionLike
} from "../core/lightstreamer-types";

type InstrumentationState = {
  pageEpoch: string;
  captureSequence: number;
  topologyRecords: Map<string, TopologyAbsoluteRecord>;
  topologyCounters: Map<string, { updateCount: number; lostUpdates: number }>;
  topologyObservedDispatches: Set<string>;
  topologyEstablishmentEpochs: Map<string, number>;
  topologyCommandEpochs: Map<string, number>;
  topologyCommandGenerations: Map<string, string>;
  topologyCoverage: "complete" | "partial";
  clientTopologyCoverages: Map<string, TopologyCoverage>;
  clientIds: StableIdAllocator;
  subscriptionIds: StableIdAllocator;
  listenerIds: StableIdAllocator;
  updateIds: StableIdAllocator;
  wrappedClients: WeakSet<object>;
  wrappedSubscriptions: WeakSet<object>;
  wrappedClientListeners: WeakSet<object>;
  subscriptionListenerProxies: WeakMap<object, WeakMap<object, LightstreamerListenerLike>>;
  listenerProxyOriginals: WeakMap<object, LightstreamerListenerLike>;
  subscriptionClients: WeakMap<object, object>;
  clientMetadata: WeakMap<object, CapturePayload>;
  activeSubscriptions: Map<string, CapturePayload>;
  commandReplayRows: Map<string, Map<string, CapturePayload>>;
  retiredFallbackSubscriptionIds: Set<string>;
  listenerTargets: Map<string, ReinjectionListenerTarget>;
  listenerRegistrations: Map<string, ListenerRegistrationState>;
  subscriptionListenerIds: Map<string, Set<string>>;
  wireTargets: Map<string, WireReinjectionTarget>;
  syntheticWireEvents: WeakSet<object>;
  originalItemUpdateCallbacks: WeakMap<object, (update: SyntheticItemUpdate) => unknown>;
  emit(kind: CaptureKind, payload: CapturePayload): void;
  emitLegacy(kind: CaptureKind, payload: CapturePayload): void;
};

type MethodOwner = Record<string, unknown>;
type ReinjectionListenerTarget = {
  subscriptionId: string;
  listenerId: string;
  subscription: object;
  listener: LightstreamerListenerLike;
  fieldNames: string[];
  callback(update: SyntheticItemUpdate): unknown;
};

type ListenerRegistrationState = {
  addCount: number;
  active: boolean;
  callbacks: string[];
};

type WireReinjectionTarget = {
  subscriptionId: string;
  socket: WebSocket;
  subscription: WireSubscriptionState;
};

type SyntheticFieldSelector = string | number;

type SyntheticItemUpdate = {
  forEachField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
  forEachChangedField(iterator: (fieldName: string, fieldPos: number, value: unknown) => void): void;
  getItemName(): string | null;
  getItemPos(): number | null;
  getValue(fieldNameOrPos: SyntheticFieldSelector): unknown;
  getValueAsJSONPatchIfAvailable(fieldNameOrPos: SyntheticFieldSelector): null;
  isSnapshot(): boolean;
  isValueChanged(fieldNameOrPos: SyntheticFieldSelector): boolean;
};

type WireConnectionState = {
  socket: WebSocket;
  clientId: string;
  url: string;
  status: string;
  sessionId: string | null;
  adapterSet: string | null;
  subscriptions: Map<string, WireSubscriptionState>;
};

type WireSubscriptionState = {
  id: string;
  rawSubId: string;
  ended: boolean;
  mode: string | null;
  itemNames: string[] | null;
  fieldNames: string[];
  dataAdapter: string | null;
  requestedSnapshot: string | null;
  keyPosition: number | null;
  commandPosition: number | null;
  itemStates: Map<string, WireItemState>;
  snapshotEndedItems: Set<string>;
  firstUpdateItems: Set<string>;
};

type WireItemState = {
  fields: Record<string, string | number | boolean | null>;
};

type DecodedWireFields = {
  fields: Record<string, string | number | boolean | null>;
  changedFields: Record<string, string | number | boolean | null>;
  jsonPatches: CapturePayload;
  unsupportedDiffFields: string[];
};

const CALLBACKS_TO_CAPTURE = [
  "onEndOfSnapshot",
  "onItemLostUpdates",
  "onClearSnapshot",
  "onItemUpdate",
  "onRealMaxFrequency",
  "onSubscription",
  "onUnsubscription",
  "onSubscriptionError",
  "onCommandSecondLevelItemLostUpdates",
  "onCommandSecondLevelSubscriptionError"
] as const;

export function installLightstreamerInstrumentation(
  host: LightstreamerHost = window,
  postMessage: (message: unknown) => void = (message) => host.postMessage?.(message, "*")
): boolean {
  if (host.__LSEW_INSTRUMENTED__) {
    return false;
  }

  const activeSubscriptions = new Map<string, CapturePayload>();
  const commandReplayRows = new Map<string, Map<string, CapturePayload>>();
  const retiredFallbackSubscriptionIds = new Set<string>();
  const state: InstrumentationState = {
    pageEpoch: createPageEpoch(),
    captureSequence: 0,
    topologyRecords: new Map<string, TopologyAbsoluteRecord>(),
    topologyCounters: new Map<string, { updateCount: number; lostUpdates: number }>(),
    topologyObservedDispatches: new Set<string>(),
    topologyEstablishmentEpochs: new Map<string, number>(),
    topologyCommandEpochs: new Map<string, number>(),
    topologyCommandGenerations: new Map<string, string>(),
    topologyCoverage: "complete",
    clientTopologyCoverages: new Map<string, TopologyCoverage>(),
    clientIds: createStableIdAllocator("client"),
    subscriptionIds: createStableIdAllocator("subscription"),
    listenerIds: createStableIdAllocator("listener"),
    updateIds: createStableIdAllocator("update"),
    wrappedClients: new WeakSet<object>(),
    wrappedSubscriptions: new WeakSet<object>(),
    wrappedClientListeners: new WeakSet<object>(),
    subscriptionListenerProxies: new WeakMap<object, WeakMap<object, LightstreamerListenerLike>>(),
    listenerProxyOriginals: new WeakMap<object, LightstreamerListenerLike>(),
    subscriptionClients: new WeakMap<object, object>(),
    clientMetadata: new WeakMap<object, CapturePayload>(),
    activeSubscriptions,
    commandReplayRows,
    retiredFallbackSubscriptionIds,
    listenerTargets: new Map<string, ReinjectionListenerTarget>(),
    listenerRegistrations: new Map<string, ListenerRegistrationState>(),
    subscriptionListenerIds: new Map<string, Set<string>>(),
    wireTargets: new Map<string, WireReinjectionTarget>(),
    syntheticWireEvents: new WeakSet<object>(),
    originalItemUpdateCallbacks: new WeakMap<object, (update: SyntheticItemUpdate) => unknown>(),
    emit(kind, payload) {
      try {
        const sanitizedPayload = sanitizeCapturePayload(payload);
        if (isRetiredFallbackCapture(retiredFallbackSubscriptionIds, sanitizedPayload)) {
          return;
        }
        trackActiveSubscription(activeSubscriptions, kind, sanitizedPayload);
        trackCommandReplayRows(commandReplayRows, kind, sanitizedPayload);
        let topology = createTopologyObservation(kind, sanitizedPayload, state);
        const topologySequence = topology?.captureSequence;
        if (topology && !isTopologyObservationForCapture(kind, topology)) {
          state.topologyCoverage = "partial";
          const aggregateCoverage = aggregateTopologyCoverage(state);
          topology = {
            version: TOPOLOGY_OBSERVATION_VERSION,
            kind,
            pageEpoch: state.pageEpoch,
            captureSequence: topologySequence ?? state.captureSequence,
            provenance: { instrumentationSource: "official-public-api" },
            coverage: {
              ...aggregateCoverage,
              status: "partial",
              reason: "limit-exceeded"
            }
          };
        }
        if (topology) {
          updateTopologyShadow(kind, sanitizedPayload, topology, state);
        }
        postMessage(createCaptureMessage(kind, sanitizedPayload, Date.now(), topology));
      } catch (_error) {
        // Capture and its transport are best-effort and must never affect the page.
      }
    },
    emitLegacy(kind, payload) {
      try {
        const sanitizedPayload = sanitizeCapturePayload(payload);
        postMessage(createCaptureMessage(kind, sanitizedPayload));
      } catch (_error) {
        // Compatibility replay is optional and must remain fail-open.
      }
    }
  };
  installReinjectionHandler(host, postMessage, state);
  installCaptureSyncHandler(host, state);
  installWebSocketFallback(host, state);

  let installed = false;
  const clientConstructorWrappers = new WeakMap<Function, Function>();
  const subscriptionConstructorWrappers = new WeakMap<Function, Function>();

  const wrapClientConstructor = (OriginalClient: NonNullable<LightstreamerHost["LightstreamerClient"]>) => {
    const cached = clientConstructorWrappers.get(OriginalClient);
    if (cached) {
      return cached as typeof OriginalClient;
    }
    function InstrumentedLightstreamerClient(
      this: LightstreamerClientLike,
      ...args: unknown[]
    ): unknown {
      if (!new.target) {
        return Reflect.apply(
          OriginalClient as unknown as (...constructorArgs: unknown[]) => unknown,
          this,
          args
        );
      }
      const instance = Reflect.construct(
        OriginalClient,
        args,
        new.target === InstrumentedLightstreamerClient ? OriginalClient : new.target
      ) as LightstreamerClientLike;
      try {
        const clientId = state.clientIds.getId(instance);
        const clientMetadata = readClientMetadata(instance, compactJsonObject({
          id: clientId,
          serverAddress: toJsonValue(args[0]),
          adapterSet: toJsonValue(args[1]),
          libraryVersion: readConstructorString(OriginalClient, "LIB_VERSION"),
          instrumentationSource: "public-api",
          coverageStatus: "full"
        }), state);

        activatePrimaryInstrumentation(host);
        wrapClient(instance, state);
        state.clientMetadata.set(instance, clientMetadata);
        state.emit("client-created", {
          client: clientMetadata
        });
      } catch (_error) {
        // Instrumentation is best-effort; the page owns constructor behavior.
      }

      return instance;
    }

    InstrumentedLightstreamerClient.prototype = OriginalClient.prototype;
    Object.setPrototypeOf(InstrumentedLightstreamerClient, OriginalClient);
    clientConstructorWrappers.set(OriginalClient, InstrumentedLightstreamerClient);
    clientConstructorWrappers.set(InstrumentedLightstreamerClient, InstrumentedLightstreamerClient);
    return InstrumentedLightstreamerClient as unknown as typeof OriginalClient;
  };

  installed =
    installConstructorHook(host, "LightstreamerClient", wrapClientConstructor) || installed;

  const wrapSubscriptionConstructor = (
    OriginalSubscription: NonNullable<LightstreamerHost["Subscription"]>
  ) => {
    const cached = subscriptionConstructorWrappers.get(OriginalSubscription);
    if (cached) {
      return cached as typeof OriginalSubscription;
    }
    function InstrumentedSubscription(
      this: LightstreamerSubscriptionLike,
      ...args: unknown[]
    ): unknown {
      if (!new.target) {
        return Reflect.apply(
          OriginalSubscription as unknown as (...constructorArgs: unknown[]) => unknown,
          this,
          args
        );
      }
      const instance = Reflect.construct(
        OriginalSubscription,
        args,
        new.target === InstrumentedSubscription ? OriginalSubscription : new.target
      ) as LightstreamerSubscriptionLike;
      try {
        const subscriptionId = state.subscriptionIds.getId(instance);

        activatePrimaryInstrumentation(host);
        const subscriptionMetadataErrors: string[] = [];
        const subscriptionMetadata = readSubscriptionMetadata(
          instance,
          args,
          subscriptionMetadataErrors
        );

        wrapSubscription(instance, state);
        state.emit("subscription-created", compactJsonObject({
          subscription: {
            id: subscriptionId,
            ...subscriptionMetadata
          },
          raw:
            subscriptionMetadataErrors.length > 0
              ? { subscriptionMetadataErrors }
              : undefined
        }));
      } catch (_error) {
        // Instrumentation is best-effort; the page owns constructor behavior.
      }

      return instance;
    }

    InstrumentedSubscription.prototype = OriginalSubscription.prototype;
    Object.setPrototypeOf(InstrumentedSubscription, OriginalSubscription);
    subscriptionConstructorWrappers.set(OriginalSubscription, InstrumentedSubscription);
    subscriptionConstructorWrappers.set(InstrumentedSubscription, InstrumentedSubscription);
    return InstrumentedSubscription as unknown as typeof OriginalSubscription;
  };

  installed = installConstructorHook(host, "Subscription", wrapSubscriptionConstructor) || installed;

  installed =
    installNamespaceHook(host, wrapClientConstructor, wrapSubscriptionConstructor) || installed;

  try {
    host.__LSEW_INSTRUMENTED__ = installed;
  } catch (_error) {
    // A frozen page host remains authoritative even when it cannot be marked.
  }
  return installed;
}

let nextPageEpoch = 1;

function createPageEpoch(): string {
  const epoch = nextPageEpoch;
  nextPageEpoch += 1;
  return `page-${Date.now().toString(36)}-${epoch}`;
}

function createTopologyObservation(
  kind: CaptureKind,
  payload: CapturePayload,
  state: InstrumentationState
): TopologyObservation | undefined {
  const raw = captureObject(payload.raw);
  if (raw?.captureSource === "websocket-tlcp") {
    return undefined;
  }
  state.captureSequence += 1;
  const clientSource = captureObject(payload.client);
  const clientId = topologyString(clientSource?.id);
  const clientCoverage = clientId ? state.clientTopologyCoverages.get(clientId) : undefined;
  const client = topologyEvidence(clientSource, "client", clientCoverage);
  const subscriptionSource = captureObject(payload.subscription);
  const subscription = topologyEvidence(subscriptionSource, "subscription");
  const item = topologyEvidence(captureObject(payload.item), "item");
  const listener = topologyEvidence(captureObject(payload.listener), "listener");
  const listenerAttachment = createListenerAttachmentEvidence(subscription, listener);
  const dispatchAndDelivery = createDispatchAndDeliveryEvidence(
    kind,
    raw,
    subscription,
    listener,
    state.captureSequence
  );
  const topologyValues = subscriptionSource
    ? createSubscriptionActivityFacts(kind, subscriptionSource, raw)
    : undefined;
  const observationKind = specializedTopologyObservationKind(kind, payload, topologyValues);
  const specializedValues = specializedTopologyValues(
    observationKind,
    payload,
    dispatchAndDelivery,
    state
  );
  const values = topologyValues || specializedValues
    ? { ...topologyValues, ...specializedValues }
    : undefined;
  return {
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind: observationKind,
    pageEpoch: state.pageEpoch,
    captureSequence: state.captureSequence,
    provenance: { instrumentationSource: "official-public-api" },
    coverage: aggregateTopologyCoverage(state),
    ...(client ? { client } : {}),
    ...(subscription ? { subscription } : {}),
    ...(item ? { item } : {}),
    ...(listener ? { listener } : {}),
    ...(listenerAttachment ? { listenerAttachment } : {}),
    ...dispatchAndDelivery,
    ...(values ? { values } : {})
  };
}

function aggregateTopologyCoverage(state: InstrumentationState): TopologyCoverage {
  let aggregate: TopologyCoverage = { status: "complete", getters: {} };
  for (const coverage of state.clientTopologyCoverages.values()) {
    aggregate = mergeTopologyCoverage(aggregate, coverage);
  }
  if (state.topologyCoverage === "partial") {
    return {
      ...aggregate,
      status: "partial",
      reason: "limit-exceeded"
    };
  }
  return aggregate;
}

function mergeTopologyCoverage(
  current: TopologyCoverage,
  incoming: TopologyCoverage
): TopologyCoverage {
  const getters = { ...current.getters };
  const rank = { available: 0, missing: 1, threw: 2 } as const;
  for (const [getter, status] of Object.entries(incoming.getters)) {
    const previous = getters[getter];
    if (!previous || rank[status] > rank[previous]) {
      getters[getter] = status;
    }
  }
  const statuses = Object.values(getters);
  const reason = statuses.includes("threw")
    ? "getter-threw" as const
    : statuses.includes("missing")
      ? "getter-missing" as const
      : current.status === "partial"
        ? current.reason
        : incoming.status === "partial"
          ? incoming.reason
          : undefined;
  return {
    status: current.status === "partial" || incoming.status === "partial" || reason
      ? "partial"
      : "complete",
    getters,
    ...(reason ? { reason } : {})
  };
}

function specializedTopologyObservationKind(
  kind: CaptureKind,
  payload: CapturePayload,
  values: Record<string, TopologyValue> | undefined
): TopologyObservation["kind"] {
  const raw = captureObject(payload.raw);
  if (
    raw?.callback === "onCommandSecondLevelItemLostUpdates" ||
    raw?.callback === "onCommandSecondLevelSubscriptionError"
  ) {
    return "second-level-observed";
  }
  if (
    kind === "subscription-started" &&
    topologyFactPrimitive(values?.serverEstablished) === true
  ) {
    return "subscription-established";
  }
  const subscription = captureObject(payload.subscription);
  const update = captureObject(payload.update);
  const fields = captureObject(update?.fields);
  const command = normalizedString(update?.command ?? fields?.command);
  const key = nonEmptyString(update?.key ?? fields?.key);
  if (
    kind === "item-update" &&
    normalizedString(subscription?.mode) === "COMMAND" &&
    command !== null &&
    ["ADD", "UPDATE", "DELETE"].includes(command) &&
    key
  ) {
    return "command-key-generation";
  }
  return kind;
}

function specializedTopologyValues(
  kind: TopologyObservation["kind"],
  payload: CapturePayload,
  dispatchAndDelivery: Pick<TopologyObservation, "dispatch" | "delivery">,
  state: InstrumentationState
): Record<string, TopologyValue> | undefined {
  const subscription = captureObject(payload.subscription);
  const subscriptionId = nonEmptyString(subscription?.id);
  if (kind === "subscription-established" && subscriptionId) {
    const active = Array.from(state.topologyRecords.values()).find(
      (record) => record.kind === "establishment" && record.subscriptionId === subscriptionId
    );
    const epoch = active
      ? state.topologyEstablishmentEpochs.get(subscriptionId) ?? topologyEpochFromId(active.id) ?? 1
      : (state.topologyEstablishmentEpochs.get(subscriptionId) ?? 0) + 1;
    const id = active?.id ?? `establishment:${subscriptionId}:${epoch}`;
    return {
      establishmentEpoch: { state: "real", value: epoch },
      establishmentId: { state: "real", value: id }
    };
  }
  if (kind !== "command-key-generation" || !subscriptionId) {
    return undefined;
  }
  const update = captureObject(payload.update);
  const fields = captureObject(update?.fields);
  const command = normalizedString(update?.command ?? fields?.command);
  const key = nonEmptyString(update?.key ?? fields?.key);
  const itemId = itemTopologyIdentity(subscriptionId, captureObject(payload.item));
  if (!command || !key || !itemId) {
    return undefined;
  }
  const generationKey = commandGenerationKey(subscriptionId, itemId, key);
  const activeId = state.topologyCommandGenerations.get(generationKey);
  const activeRecord = activeId
    ? state.topologyRecords.get(topologyRecordKey("command-generation", activeId))
    : undefined;
  const dispatchId = topologyString(dispatchAndDelivery.dispatch?.id);
  let generationId = activeId;
  let generationEpoch = activeId
    ? state.topologyCommandEpochs.get(generationKey) ?? topologyEpochFromId(activeId)
    : undefined;
  if (
    command !== "DELETE" &&
    (!generationId || (command === "ADD" && activeRecord?.values?.dispatchId !== dispatchId))
  ) {
    generationEpoch = (state.topologyCommandEpochs.get(generationKey) ?? 0) + 1;
    generationId = `command-generation:${subscriptionId}:${itemId}:${key}:${generationEpoch}`;
  }
  return {
    command: { state: "real", value: command },
    commandKey: { state: "real", value: key },
    ...(generationEpoch !== undefined && generationId
      ? {
          generationEpoch: { state: "real", value: generationEpoch } as TopologyValue,
          generationId: { state: "real", value: generationId } as TopologyValue
        }
      : {})
  };
}

function topologyEpochFromId(id: string): number | undefined {
  const suffix = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isSafeInteger(suffix) && suffix > 0 ? suffix : undefined;
}

function topologyEvidence(
  source: CapturePayload | null,
  domain: "client" | "subscription" | "item" | "listener",
  coverage?: TopologyCoverage
): TopologyEvidenceRecord | undefined {
  if (!source) {
    return undefined;
  }
  const evidence: TopologyEvidenceRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (isSensitiveCaptureKey(key)) {
      continue;
    }
    if (key === "id") {
      evidence.id = value;
      continue;
    }
    if (key === "clientIp") {
      const getterCoverage = coverage?.getters["ConnectionDetails.getClientIp"];
      evidence.clientIp =
        value === null && (getterCoverage === "missing" || getterCoverage === "threw")
          ? {
              state: "unknown",
              reason: getterCoverage === "threw" ? "getter-threw" : "getter-missing"
            }
          : { state: "redacted", context: "masked-client-ip" };
      if (typeof value === "string" && value !== "[redacted]") {
        evidence.clientIpMasked = value;
      }
      continue;
    }
    if (value === "[redacted]") {
      evidence[key] = { state: "redacted", reason: "sanitization-failed" };
      continue;
    }
    const factState = topologyFactState(domain, key);
    evidence[key] = { state: factState, value } as TopologyValue;
  }
  if (domain === "client") {
    for (const { key, getter } of CLIENT_TOPOLOGY_GETTERS) {
      if (!(key in source)) {
        evidence[key] = {
          state: "unknown",
          reason: coverage?.getters[getter] === "threw" ? "getter-threw" : "getter-missing"
        };
      } else if (source[key] === null && key !== "clientIp") {
        evidence[key] = key === "forcedTransport"
          ? { state: "not-applicable" }
          : { state: "unavailable" };
      }
    }
  }
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function createSubscriptionActivityFacts(
  kind: CaptureKind,
  subscription: CapturePayload,
  raw: CapturePayload | null
): Record<string, TopologyValue> {
  const activeEvidence = [
    "subscription-started",
    "subscription-frequency",
    "listener-added",
    "item-update"
  ].includes(kind);
  const establishedEvidence =
    raw?.callback === "onSubscription" ||
    ["subscription-frequency", "item-update", "end-of-snapshot", "lost-updates", "clear-snapshot"].includes(kind);
  const secondLevelCallback = nonEmptyString(raw?.callback);
  const secondLevelArgs = Array.isArray(raw?.args) ? raw.args : [];
  const secondLevelKey = nonEmptyString(
    secondLevelCallback === "onCommandSecondLevelItemLostUpdates"
      ? secondLevelArgs[1]
      : secondLevelCallback === "onCommandSecondLevelSubscriptionError"
        ? secondLevelArgs[2]
        : undefined
  );
  return {
    clientActive:
      subscription.active === true
        ? { state: "real", value: true }
        : activeEvidence
          ? { state: "inferred", value: true }
          : subscription.active === false
            ? { state: "real", value: false }
            : { state: "unknown", reason: "getter-missing" },
    serverEstablished:
      typeof subscription.subscribed === "boolean" && subscription.subscribed
        ? { state: "real", value: true }
        : establishedEvidence
          ? { state: "inferred", value: true }
          : { state: "unknown", reason: "getter-missing" },
    ...(secondLevelKey
      ? {
          secondLevelKey: { state: "inferred", value: secondLevelKey } as TopologyValue,
          secondLevelProvenance: {
            state: "inferred",
            value: "inferred-second-level"
          } as TopologyValue
        }
      : {})
  };
}

const CLIENT_TOPOLOGY_GETTERS = [
  { key: "serverAddress", getter: "ConnectionDetails.getServerAddress" },
  { key: "adapterSet", getter: "ConnectionDetails.getAdapterSet" },
  { key: "sessionId", getter: "ConnectionDetails.getSessionId" },
  { key: "serverInstanceAddress", getter: "ConnectionDetails.getServerInstanceAddress" },
  { key: "serverSocketName", getter: "ConnectionDetails.getServerSocketName" },
  { key: "clientIp", getter: "ConnectionDetails.getClientIp" },
  { key: "status", getter: "LightstreamerClient.getStatus" },
  { key: "requestedMaxBandwidth", getter: "ConnectionOptions.getRequestedMaxBandwidth" },
  { key: "realMaxBandwidth", getter: "ConnectionOptions.getRealMaxBandwidth" },
  { key: "keepaliveInterval", getter: "ConnectionOptions.getKeepaliveInterval" },
  { key: "retryDelay", getter: "ConnectionOptions.getRetryDelay" },
  { key: "firstRetryMaxDelay", getter: "ConnectionOptions.getFirstRetryMaxDelay" },
  { key: "stalledTimeout", getter: "ConnectionOptions.getStalledTimeout" },
  { key: "reconnectTimeout", getter: "ConnectionOptions.getReconnectTimeout" },
  { key: "sessionRecoveryTimeout", getter: "ConnectionOptions.getSessionRecoveryTimeout" },
  { key: "forcedTransport", getter: "ConnectionOptions.getForcedTransport" },
  { key: "reverseHeartbeatInterval", getter: "ConnectionOptions.getReverseHeartbeatInterval" },
  { key: "pollingInterval", getter: "ConnectionOptions.getPollingInterval" },
  { key: "idleTimeout", getter: "ConnectionOptions.getIdleTimeout" }
] as const;

function topologyFactState(
  domain: "client" | "subscription" | "item" | "listener",
  key: string
): "requested" | "real" | "inferred" {
  if (
    key === "status" ||
    key === "sessionId" ||
    key === "transport" ||
    key.startsWith("real") ||
    key === "active" ||
    key === "subscribed" ||
    key === "listenerCount"
  ) {
    return "real";
  }
  if (domain === "item" || domain === "listener") {
    return "real";
  }
  return "requested";
}

function createListenerAttachmentEvidence(
  subscription: TopologyEvidenceRecord | undefined,
  listener: TopologyEvidenceRecord | undefined
): TopologyEvidenceRecord | undefined {
  const subscriptionId = typeof subscription?.id === "string" ? subscription.id : null;
  const listenerId = typeof listener?.id === "string" ? listener.id : null;
  const registration = topologyFactPrimitive(listener?.registrationCount) ?? 1;
  if (!subscriptionId || !listenerId) {
    return undefined;
  }
  return {
    id: `listener-attachment:${subscriptionId}:${listenerId}:${registration}`,
    subscriptionId,
    listenerId,
    registrationCount: registration
  };
}

function createDispatchAndDeliveryEvidence(
  kind: CaptureKind,
  raw: CapturePayload | null,
  subscription: TopologyEvidenceRecord | undefined,
  listener: TopologyEvidenceRecord | undefined,
  sequence: number
): Pick<TopologyObservation, "dispatch" | "delivery"> {
  if (kind !== "item-update" && !raw?.callback) {
    return {};
  }
  const logicalEventId = typeof raw?.logicalEventId === "string" ? raw.logicalEventId : null;
  const subscriptionId = typeof subscription?.id === "string" ? subscription.id : "unknown";
  const listenerId = typeof listener?.id === "string" ? listener.id : "unowned";
  const dispatchId = logicalEventId
    ? `dispatch:${logicalEventId}`
    : `dispatch:${subscriptionId}:${sequence}`;
  return {
    dispatch: { id: dispatchId, subscriptionId },
    delivery: { id: `${dispatchId}:${listenerId}`, dispatchId, listenerId }
  };
}

function topologyFactPrimitive(value: unknown): string | number | boolean | null | undefined {
  if (!isObject(value) || !("value" in value)) {
    return undefined;
  }
  const primitive = value.value;
  return primitive === null ||
    typeof primitive === "string" ||
    typeof primitive === "number" ||
    typeof primitive === "boolean"
    ? primitive
    : undefined;
}

function updateTopologyShadow(
  kind: CaptureKind,
  payload: CapturePayload,
  topology: TopologyObservation,
  state: InstrumentationState
): void {
  const sequence = topology.captureSequence;
  putTopologyRecord(state, {
    kind: "page",
    id: state.pageEpoch,
    pageEpoch: state.pageEpoch,
    captureSequence: sequence
  });

  const clientId = topologyString(topology.client?.id);
  const clientPayload = captureObject(payload.client);
  const clientEvidence = captureObject(topology.client) ?? clientPayload ?? { id: clientId ?? "unknown" };
  if (clientId) {
    putTopologyRecord(state, {
      kind: "client",
      id: clientId,
      parentId: state.pageEpoch,
      pageEpoch: state.pageEpoch,
      captureSequence: sequence,
      values: { client: clientEvidence }
    });
    const sessionId = topologyFactString(topology.client?.sessionId);
    const clientStatus = nonEmptyString(clientPayload?.status);
    const sessionAbsent =
      clientStatus?.startsWith("DISCONNECTED") === true || clientPayload?.sessionId === null;
    if (sessionAbsent) {
      retireClientSessionTopology(state, clientId, sequence);
    } else if (sessionId) {
      for (const [key, record] of state.topologyRecords) {
        if (record.kind === "session" && record.clientId === clientId) {
          state.topologyRecords.delete(key);
        }
      }
      putTopologyRecord(state, {
        kind: "session",
        id: `session:${clientId}:${sessionId}`,
        parentId: clientId,
        clientId,
        pageEpoch: state.pageEpoch,
        captureSequence: sequence,
        values: {
          client: clientEvidence,
          sessionId: topology.client?.sessionId ?? { state: "real", value: sessionId }
        }
      });
    }
  }

  const subscriptionId = topologyString(topology.subscription?.id);
  if (!subscriptionId) {
    return;
  }
  if (kind === "subscription-ended" || kind === "subscription-error") {
    deleteSubscriptionTopology(state, subscriptionId);
    return;
  }
  if (!clientId) {
    return;
  }

  const recordKey = topologyRecordKey("subscription", subscriptionId);
  const previous = state.topologyRecords.get(recordKey);
  const subscriptionPayload = captureObject(payload.subscription);
  const subscriptionEvidence = captureObject(topology.subscription) ??
    subscriptionPayload ?? { id: subscriptionId };
  const raw = captureObject(payload.raw);
  const activeEvidence = [
    "subscription-started",
    "subscription-frequency",
    "listener-added",
    "item-update"
  ].includes(kind);
  const clientActive =
    activeEvidence
      ? true
      : typeof subscriptionPayload?.active === "boolean"
      ? subscriptionPayload.active
      : previous?.clientActive ?? false;
  const establishmentEvidence =
    raw?.callback === "onSubscription" ||
    ["subscription-frequency", "item-update", "end-of-snapshot", "lost-updates", "clear-snapshot"].includes(kind);
  const serverEstablished =
    establishmentEvidence
      ? true
      : typeof subscriptionPayload?.subscribed === "boolean"
        ? subscriptionPayload.subscribed
        : previous?.serverEstablished ?? false;
  putTopologyRecord(state, {
    kind: "subscription",
    id: subscriptionId,
    parentId: clientId,
    clientId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: sequence,
    clientActive,
    serverEstablished,
    values: {
      client: clientEvidence,
      subscription: subscriptionEvidence,
      ...(topology.values ? { facts: topology.values } : {})
    }
  });

  updateEstablishmentRecord(state, subscriptionId, serverEstablished, sequence);

  updateListenerAttachmentRecord(kind, payload, topology, subscriptionId, state);
  updateItemAndCounterRecords(kind, payload, topology, subscriptionId, state);
  updateAggregateRecord(subscriptionId, sequence, state);
}

function retireClientSessionTopology(
  state: InstrumentationState,
  clientId: string,
  sequence: number
): void {
  const subscriptions: string[] = [];
  for (const [key, record] of state.topologyRecords) {
    if (record.kind === "session" && record.clientId === clientId) {
      state.topologyRecords.delete(key);
    } else if (record.kind === "subscription" && record.clientId === clientId) {
      subscriptions.push(record.id);
      state.topologyRecords.set(key, {
        ...record,
        captureSequence: sequence,
        serverEstablished: false
      });
    }
  }
  for (const subscriptionId of subscriptions) {
    updateEstablishmentRecord(state, subscriptionId, false, sequence);
  }
}

function updateEstablishmentRecord(
  state: InstrumentationState,
  subscriptionId: string,
  established: boolean,
  sequence: number
): void {
  const current = Array.from(state.topologyRecords.entries()).find(
    ([, record]) => record.kind === "establishment" && record.subscriptionId === subscriptionId
  );
  if (!established) {
    if (current) {
      state.topologyRecords.delete(current[0]);
    }
    return;
  }
  if (current) {
    state.topologyRecords.set(current[0], {
      ...current[1],
      captureSequence: sequence,
      values: { established: true }
    });
    return;
  }
  const epoch = (state.topologyEstablishmentEpochs.get(subscriptionId) ?? 0) + 1;
  state.topologyEstablishmentEpochs.set(subscriptionId, epoch);
  putTopologyRecord(state, {
    kind: "establishment",
    id: `establishment:${subscriptionId}:${epoch}`,
    parentId: subscriptionId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: sequence,
    values: { established: true, epoch }
  });
}

function updateListenerAttachmentRecord(
  kind: CaptureKind,
  payload: CapturePayload,
  topology: TopologyObservation,
  subscriptionId: string,
  state: InstrumentationState
): void {
  const attachmentId = topologyString(topology.listenerAttachment?.id);
  if (!attachmentId || (kind !== "listener-added" && kind !== "listener-removed")) {
    return;
  }
  if (kind === "listener-removed") {
    state.topologyRecords.delete(topologyRecordKey("listener-attachment", attachmentId));
    synchronizeAttachmentCounts(state, subscriptionId, topology.captureSequence);
    return;
  }
  const listenerPayload = captureObject(payload.listener);
  const clientPayload = captureObject(payload.client);
  const subscriptionPayload = captureObject(payload.subscription);
  const listenerId = topologyString(topology.listener?.id);
  for (const [recordKey, record] of state.topologyRecords) {
    if (
      record.kind === "listener-attachment" &&
      record.subscriptionId === subscriptionId &&
      record.id !== attachmentId &&
      record.values?.listenerId === listenerId
    ) {
      state.topologyRecords.delete(recordKey);
    }
  }
  const listenerCount = countListenerAttachments(state, subscriptionId) +
    (state.topologyRecords.has(topologyRecordKey("listener-attachment", attachmentId)) ? 0 : 1);
  putTopologyRecord(state, {
    kind: "listener-attachment",
    id: attachmentId,
    parentId: subscriptionId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: topology.captureSequence,
    values: compactJsonObject({
      listenerId,
      callbacks: listenerPayload?.callbacks,
      registrationCount: listenerPayload?.registrationCount,
      listenerCount,
      active: true,
      client: clientPayload,
      subscription: subscriptionPayload,
      listener: listenerPayload
    })
  });
  synchronizeAttachmentCounts(state, subscriptionId, topology.captureSequence);
}

function synchronizeAttachmentCounts(
  state: InstrumentationState,
  subscriptionId: string,
  sequence: number
): void {
  const listenerCount = countListenerAttachments(state, subscriptionId);
  for (const [key, record] of state.topologyRecords) {
    if (record.kind !== "listener-attachment" || record.subscriptionId !== subscriptionId) {
      continue;
    }
    state.topologyRecords.set(key, {
      ...record,
      captureSequence: sequence,
      values: { ...record.values, listenerCount }
    });
  }
}

function updateItemAndCounterRecords(
  kind: CaptureKind,
  payload: CapturePayload,
  topology: TopologyObservation,
  subscriptionId: string,
  state: InstrumentationState
): void {
  const itemPayload = captureObject(payload.item);
  const clientPayload = captureObject(payload.client);
  const subscriptionPayload = captureObject(payload.subscription);
  const updatePayload = captureObject(payload.update);
  const itemIdentity = itemTopologyIdentity(subscriptionId, itemPayload);
  if (itemIdentity && ["item-update", "end-of-snapshot", "lost-updates", "clear-snapshot"].includes(kind)) {
    putTopologyRecord(state, {
      kind: "item",
      id: itemIdentity,
      parentId: subscriptionId,
      subscriptionId,
      pageEpoch: state.pageEpoch,
      captureSequence: topology.captureSequence,
      values: compactJsonObject({
        captureKind: kind,
        client: clientPayload,
        subscription: subscriptionPayload,
        item: itemPayload,
        update: updatePayload
      })
    });
  }

  const counters = state.topologyCounters.get(subscriptionId) ?? { updateCount: 0, lostUpdates: 0 };
  if (kind === "item-update" && topology.kind !== "second-level-observed") {
    const dispatchId = topologyString(topology.dispatch?.id);
    if (!dispatchId || !state.topologyObservedDispatches.has(dispatchId)) {
      counters.updateCount += 1;
      if (dispatchId) {
        state.topologyObservedDispatches.add(dispatchId);
        while (state.topologyObservedDispatches.size > TOPOLOGY_SYNC_LIMITS.maxBufferedLive) {
          state.topologyObservedDispatches.delete(
            state.topologyObservedDispatches.values().next().value as string
          );
        }
      }
    }
  } else if (kind === "lost-updates") {
    const update = captureObject(payload.update);
    const listener = captureObject(payload.listener);
    if (listener?.metricOwner !== false) {
      counters.lostUpdates +=
        typeof update?.lostUpdates === "number" && Number.isFinite(update.lostUpdates)
          ? update.lostUpdates
          : 0;
    }
  }
  state.topologyCounters.set(subscriptionId, counters);

  updateInferredSecondLevelRecord(kind, payload, topology, subscriptionId, state);

  if (kind !== "item-update" || topology.kind === "second-level-observed" || !itemIdentity) {
    return;
  }
  const update = updatePayload;
  const fields = captureObject(update?.fields);
  const command = normalizedString(update?.command ?? fields?.command);
  const key = nonEmptyString(update?.key ?? fields?.key);
  if (!command || !key || !["ADD", "UPDATE", "DELETE"].includes(command)) {
    return;
  }
  const generationKey = commandGenerationKey(subscriptionId, itemIdentity, key);
  const currentGenerationId = state.topologyCommandGenerations.get(generationKey);
  if (command === "DELETE") {
    if (currentGenerationId) {
      retireCommandGeneration(state, generationKey, currentGenerationId);
    }
    return;
  }
  const dispatchId = topologyString(topology.dispatch?.id);
  let generationId = currentGenerationId;
  const currentRecord = generationId
    ? state.topologyRecords.get(topologyRecordKey("command-generation", generationId))
    : undefined;
  if (
    !generationId ||
    (command === "ADD" && currentRecord?.values?.dispatchId !== dispatchId)
  ) {
    if (generationId) {
      retireCommandGeneration(state, generationKey, generationId);
    }
    const epoch = (state.topologyCommandEpochs.get(generationKey) ?? 0) + 1;
    state.topologyCommandEpochs.set(generationKey, epoch);
    generationId = `command-generation:${subscriptionId}:${itemIdentity}:${key}:${epoch}`;
    state.topologyCommandGenerations.set(generationKey, generationId);
  }
  putTopologyRecord(state, {
    kind: "command-generation",
    id: generationId,
    parentId: subscriptionId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: topology.captureSequence,
    values: compactJsonObject({
      itemId: itemIdentity,
      key,
      command,
      dispatchId,
      client: clientPayload,
      subscription: subscriptionPayload,
      item: itemPayload,
      update: updatePayload
    })
  });
}

function commandGenerationKey(subscriptionId: string, itemId: string, key: string): string {
  return `${subscriptionId}\u0000${itemId}\u0000${key}`;
}

function retireCommandGeneration(
  state: InstrumentationState,
  generationKey: string,
  generationId: string
): void {
  state.topologyRecords.delete(topologyRecordKey("command-generation", generationId));
  for (const [recordKey, record] of state.topologyRecords) {
    if (record.kind === "inferred-child" && record.parentId === generationId) {
      state.topologyRecords.delete(recordKey);
    }
  }
  state.topologyCommandGenerations.delete(generationKey);
}

function updateInferredSecondLevelRecord(
  kind: CaptureKind,
  payload: CapturePayload,
  topology: TopologyObservation,
  subscriptionId: string,
  state: InstrumentationState
): void {
  const raw = captureObject(payload.raw);
  const callback = nonEmptyString(raw?.callback);
  if (
    callback !== "onCommandSecondLevelItemLostUpdates" &&
    callback !== "onCommandSecondLevelSubscriptionError"
  ) {
    return;
  }
  const args = Array.isArray(raw?.args) ? raw.args : [];
  const key = nonEmptyString(
    callback === "onCommandSecondLevelItemLostUpdates" ? args[1] : args[2]
  );
  if (!key) {
    return;
  }
  const generationEntry = Array.from(state.topologyCommandGenerations.entries()).find(
    ([generationKey]) =>
      generationKey.startsWith(`${subscriptionId}\u0000`) && generationKey.endsWith(`\u0000${key}`)
  );
  if (!generationEntry) {
    return;
  }
  const generationId = generationEntry[1];
  putTopologyRecord(state, {
    kind: "inferred-child",
    id: `inferred-child:${generationId}:${callback}`,
    parentId: generationId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: topology.captureSequence,
    values: compactJsonObject({
      generationId,
      key,
      captureKind: kind,
      callback,
      label:
        callback === "onCommandSecondLevelItemLostUpdates"
          ? "Second-level lost updates"
          : "Second-level subscription error",
      provenance: "inferred-second-level",
      client: payload.client,
      subscription: payload.subscription,
      update: payload.update
    })
  });
}

function updateAggregateRecord(
  subscriptionId: string,
  sequence: number,
  state: InstrumentationState
): void {
  const counters = state.topologyCounters.get(subscriptionId) ?? { updateCount: 0, lostUpdates: 0 };
  putTopologyRecord(state, {
    kind: "aggregate",
    id: `aggregate:${subscriptionId}`,
    parentId: subscriptionId,
    subscriptionId,
    pageEpoch: state.pageEpoch,
    captureSequence: sequence,
    values: {
      listenerCount: countListenerAttachments(state, subscriptionId),
      updateCount: counters.updateCount,
      lostUpdates: counters.lostUpdates
    }
  });
}

function putTopologyRecord(state: InstrumentationState, record: TopologyAbsoluteRecord): void {
  const key = topologyRecordKey(record.kind, record.id);
  if (!state.topologyRecords.has(key) && state.topologyRecords.size >= TOPOLOGY_SYNC_LIMITS.maxRecords) {
    state.topologyCoverage = "partial";
    return;
  }
  state.topologyRecords.set(key, record);
}

function deleteSubscriptionTopology(state: InstrumentationState, subscriptionId: string): void {
  for (const [key, record] of state.topologyRecords) {
    if (record.id === subscriptionId || record.subscriptionId === subscriptionId) {
      state.topologyRecords.delete(key);
    }
  }
  state.topologyCounters.delete(subscriptionId);
  for (const [generationKey, generationId] of state.topologyCommandGenerations) {
    if (generationKey.startsWith(`${subscriptionId}\u0000`)) {
      retireCommandGeneration(state, generationKey, generationId);
    }
  }
}

function countListenerAttachments(state: InstrumentationState, subscriptionId: string): number {
  let count = 0;
  for (const record of state.topologyRecords.values()) {
    if (record.kind === "listener-attachment" && record.subscriptionId === subscriptionId) {
      count += 1;
    }
  }
  return count;
}

function itemTopologyIdentity(subscriptionId: string, item: CapturePayload | null): string | null {
  if (!item) {
    return null;
  }
  const position = typeof item.position === "number" && Number.isSafeInteger(item.position)
    ? String(item.position)
    : null;
  const name = nonEmptyString(item.name);
  return position || name ? `item:${subscriptionId}:${position ?? name}` : null;
}

function topologyRecordKey(kind: TopologyAbsoluteRecord["kind"], id: string): string {
  return `${kind}:${id}`;
}

function topologyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function topologyFactString(value: unknown): string | null {
  const primitive = topologyFactPrimitive(value);
  return typeof primitive === "string" && primitive.trim() ? primitive : null;
}


function activatePrimaryInstrumentation(host: LightstreamerHost): void {
  if (host.__LSEW_PRIMARY_ACTIVE__) {
    return;
  }

  host.__LSEW_PRIMARY_ACTIVE__ = true;
}

function reconcileFallbackSubscription(
  state: InstrumentationState,
  primaryClient: CapturePayload,
  primarySubscription: CapturePayload
): CapturePayload[] {
  const candidates = Array.from(state.activeSubscriptions.values()).filter((payload) => {
    const raw = captureObject(payload.raw);
    return (
      raw?.captureSource === "websocket-tlcp" &&
      clientsDescribeSameEndpoint(captureObject(payload.client), primaryClient) &&
      subscriptionsDescribeSameTarget(
        captureObject(payload.subscription),
        primarySubscription
      )
    );
  });
  if (candidates.length !== 1) {
    return [];
  }

  const payload = candidates[0];
  const raw = captureObject(payload.raw);
  const subscription = captureObject(payload.subscription);
  const subscriptionId = nonEmptyString(subscription?.id);
  if (!subscriptionId) {
    return [];
  }
  const replayRows = Array.from(state.commandReplayRows.get(subscriptionId)?.values() ?? []);

  state.emit("subscription-ended", compactJsonObject({
    client: payload.client,
    subscription: payload.subscription,
    raw: compactJsonObject({
      ...raw,
      captureHandoff: "primary-api"
    })
  }));
  state.retiredFallbackSubscriptionIds.add(subscriptionId);
  state.wireTargets.delete(subscriptionId);
  return replayRows;
}

function subscriptionsDescribeSameTarget(
  fallback: CapturePayload | null,
  primary: CapturePayload
): boolean {
  const fallbackMode = normalizedString(fallback?.mode);
  const primaryMode = normalizedString(primary.mode);
  if (!fallbackMode || fallbackMode !== primaryMode) {
    return false;
  }

  const fallbackItems = normalizedListOrGroup(fallback?.items, fallback?.itemGroup);
  const primaryItems = normalizedListOrGroup(primary.items, primary.itemGroup);
  const fallbackFields = normalizedListOrGroup(fallback?.fields, fallback?.fieldSchema);
  const primaryFields = normalizedListOrGroup(primary.fields, primary.fieldSchema);
  if (
    !fallbackItems ||
    fallbackItems !== primaryItems ||
    !fallbackFields ||
    fallbackFields !== primaryFields
  ) {
    return false;
  }

  const fallbackAdapter = nonEmptyString(fallback?.dataAdapter);
  const primaryAdapter = nonEmptyString(primary.dataAdapter);
  if (fallbackAdapter !== primaryAdapter) {
    return false;
  }

  const fallbackSnapshot = normalizedSnapshotRequest(fallback?.requestedSnapshot);
  const primarySnapshot = normalizedSnapshotRequest(primary.requestedSnapshot);
  return (
    fallbackSnapshot === null ||
    primarySnapshot === null ||
    fallbackSnapshot === primarySnapshot
  );
}

function clientsDescribeSameEndpoint(
  fallback: CapturePayload | null,
  primary: CapturePayload
): boolean {
  const fallbackEndpoint = normalizedServerEndpoint(fallback?.serverAddress);
  const primaryEndpoint = normalizedServerEndpoint(primary.serverAddress);
  if (!fallbackEndpoint || fallbackEndpoint !== primaryEndpoint) {
    return false;
  }

  const fallbackAdapterSet = nonEmptyString(fallback?.adapterSet);
  const primaryAdapterSet = nonEmptyString(primary.adapterSet);
  return (
    !fallbackAdapterSet ||
    !primaryAdapterSet ||
    fallbackAdapterSet === primaryAdapterSet
  );
}

function normalizedListOrGroup(list: unknown, group: unknown): string | null {
  if (Array.isArray(list) && list.every((entry) => typeof entry === "string")) {
    const normalized = list.map((entry) => entry.trim()).filter(Boolean).join(" ");
    if (normalized) {
      return normalized;
    }
  }
  return nonEmptyString(group);
}

function normalizedString(value: unknown): string | null {
  return nonEmptyString(value)?.toUpperCase() ?? null;
}

function normalizedServerEndpoint(value: unknown): string | null {
  const address = nonEmptyString(value);
  if (!address) {
    return null;
  }
  try {
    const parsed = new URL(address);
    const path = parsed.pathname
      .replace(/\/lightstreamer\/?$/i, "")
      .replace(/\/+$/, "");
    return `${parsed.host.toLowerCase()}${path || "/"}`;
  } catch (_error) {
    return null;
  }
}

function normalizedSnapshotRequest(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = normalizedString(value);
  if (normalized === "TRUE" || normalized === "YES") {
    return true;
  }
  if (normalized === "FALSE" || normalized === "NO") {
    return false;
  }
  return null;
}

function installNamespaceHook(
  host: LightstreamerHost,
  wrapClientConstructor: (
    constructor: NonNullable<LightstreamerHost["LightstreamerClient"]>
  ) => NonNullable<LightstreamerHost["LightstreamerClient"]>,
  wrapSubscriptionConstructor: (
    constructor: NonNullable<LightstreamerHost["Subscription"]>
  ) => NonNullable<LightstreamerHost["Subscription"]>
): boolean {
  const hookNamespace = (namespace: unknown): boolean => {
    if (!isObject(namespace)) {
      return false;
    }

    let namespaceInstalled = false;
    namespaceInstalled =
      installConstructorHook(namespace, "LightstreamerClient", wrapClientConstructor) ||
      namespaceInstalled;
    namespaceInstalled =
      installConstructorHook(namespace, "Subscription", wrapSubscriptionConstructor) ||
      namespaceInstalled;
    return namespaceInstalled;
  };

  try {
    const locatedDescriptor = findPropertyDescriptor(host, "Lightstreamer");
    if (locatedDescriptor && locatedDescriptor.owner !== host) {
      return false;
    }
    const descriptor = locatedDescriptor?.descriptor;
    if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      return false;
    }
    if (descriptor?.writable === false) {
      return false;
    }
    const current = host.Lightstreamer;
    if (isObject(current)) {
      return hookNamespace(current);
    }
    if (current !== undefined || descriptor?.configurable === false) {
      return false;
    }

    let assignedNamespace: LightstreamerHost["Lightstreamer"];
    Object.defineProperty(host, "Lightstreamer", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        return assignedNamespace;
      },
      set(value) {
        assignedNamespace = value;
        hookNamespace(assignedNamespace);
      }
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function installConstructorHook<K extends "LightstreamerClient" | "Subscription">(
  host: Pick<LightstreamerHost, "LightstreamerClient" | "Subscription">,
  property: K,
  wrap: (constructor: NonNullable<LightstreamerHost[K]>) => NonNullable<LightstreamerHost[K]>
): boolean {
  try {
    const locatedDescriptor = findPropertyDescriptor(host, property);
    if (locatedDescriptor && locatedDescriptor.owner !== host) {
      return false;
    }
    const descriptor = locatedDescriptor?.descriptor;
    if (descriptor && !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      return false;
    }
    const current = host[property];
    if (typeof current === "function") {
      if (descriptor?.writable === false) {
        return false;
      }
      return Reflect.set(
        host,
        property,
        wrap(current as NonNullable<LightstreamerHost[K]>)
      );
    }
    if (
      current !== undefined ||
      descriptor?.configurable === false ||
      descriptor?.writable === false
    ) {
      return false;
    }

    let assigned = current;
    Object.defineProperty(host, property, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get() {
        return assigned;
      },
      set(value) {
        if (typeof value !== "function") {
          assigned = value;
          return;
        }
        try {
          assigned = wrap(value as NonNullable<LightstreamerHost[K]>);
        } catch (_error) {
          assigned = value;
        }
      }
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function findPropertyDescriptor(
  target: object,
  property: PropertyKey
): { owner: object; descriptor: PropertyDescriptor } | undefined {
  for (
    let current: object | null = target;
    current !== null;
    current = Object.getPrototypeOf(current)
  ) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) {
      return { owner: current, descriptor };
    }
  }
  return undefined;
}

function installWebSocketFallback(host: LightstreamerHost, state: InstrumentationState): boolean {
  if (host.__LSEW_WS_FALLBACK__ || typeof host.WebSocket !== "function") {
    return false;
  }

  const OriginalWebSocket = host.WebSocket;

  function InstrumentedWebSocket(this: WebSocket, ...args: ConstructorParameters<typeof WebSocket>) {
    const socket = Reflect.construct(
      OriginalWebSocket,
      args,
      new.target ?? InstrumentedWebSocket
    ) as WebSocket;
    const url = webSocketUrlToString(args[0]);

    if (!host.__LSEW_PRIMARY_ACTIVE__ && isLightstreamerWebSocketUrl(url)) {
      installWireCaptureForSocket(host, socket, url, state);
    }

    return socket;
  }

  InstrumentedWebSocket.prototype = OriginalWebSocket.prototype;
  Object.setPrototypeOf(InstrumentedWebSocket, OriginalWebSocket);
  host.WebSocket = InstrumentedWebSocket as unknown as typeof WebSocket;
  host.__LSEW_WS_FALLBACK__ = true;
  return true;
}

function installWireCaptureForSocket(
  host: LightstreamerHost,
  socket: WebSocket,
  url: string,
  state: InstrumentationState
): void {
  const wire: WireConnectionState = {
    socket,
    clientId: state.clientIds.getId(socket),
    url,
    status: "CONNECTING",
    sessionId: null,
    adapterSet: null,
    subscriptions: new Map<string, WireSubscriptionState>()
  };

  state.emit("client-created", {
    client: {
      id: wire.clientId,
      serverAddress: url,
      status: "CONNECTING",
      transport: "websocket",
      instrumentationSource: "websocket-tlcp",
      coverageStatus: "limited"
    },
    raw: wireRaw({
      frameDirection: "constructor",
      url
    })
  });

  wrapWireSend(socket, wire, state);

  if (typeof socket.addEventListener !== "function") {
    return;
  }

  socket.addEventListener("message", (event) => {
    if (state.syntheticWireEvents.has(event)) {
      return;
    }
    const text = textWirePayload(event.data);
    if (text === null) {
      return;
    }
    handleWireInboundFrame(text, wire, state);
  });
  socket.addEventListener("close", (event) => {
    handleWireClose(event, wire, state);
  });
}

function handleWireClose(
  event: CloseEvent,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  wire.status = "DISCONNECTED";
  for (const subscription of wire.subscriptions.values()) {
    if (subscription.ended) {
      continue;
    }
    subscription.ended = true;
    unregisterWireReinjectionTarget(subscription, state);
    state.emit("subscription-ended", {
      client: wireClientPayload(wire),
      subscription: wireSubscriptionPayload(subscription),
      raw: wireRaw({
        frameDirection: "close",
        rawSubId: subscription.rawSubId,
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      })
    });
  }
  wire.subscriptions.clear();
  state.emit("client-status", {
    client: wireClientPayload(wire),
    raw: wireRaw({
      frameDirection: "close",
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    })
  });
}

function wrapWireSend(
  socket: WebSocket,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const originalSend = socket.send;
  if (typeof originalSend !== "function") {
    return;
  }

  try {
    socket.send = function wrappedWireSend(this: WebSocket, ...args: Parameters<WebSocket["send"]>) {
      const text = textWirePayload(args[0]);
      if (text !== null) {
        handleWireOutboundFrame(text, wire, state);
      }
      return originalSend.apply(this, args);
    };
  } catch (_error) {
    // Some browser implementations may make send non-writable; message capture still works.
  }
}

function handleWireOutboundFrame(
  frame: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  for (const params of parseTlcpParameterLines(frame)) {
    wire.adapterSet = params.get("LS_adapter_set") ?? wire.adapterSet;
    const operation = params.get("LS_op");
    if (operation === "add") {
      handleWireSubscriptionAdd(params, wire, state);
    } else if (operation === "delete") {
      handleWireSubscriptionDelete(params, wire, state);
    }
  }
}

function handleWireSubscriptionAdd(
  params: URLSearchParams,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = params.get("LS_subId");
  if (!rawSubId) {
    return;
  }

  const subscription = createWireSubscription(rawSubId, params, state);
  wire.subscriptions.set(rawSubId, subscription);
  registerWireReinjectionTarget(wire, subscription, state);
  state.emit("subscription-created", {
    client: wireClientPayload(wire),
    subscription: wireSubscriptionPayload(subscription),
    raw: wireRaw({
      frameDirection: "outbound",
      operation: "add",
      request: paramsToJson(params)
    })
  });
}

function handleWireSubscriptionDelete(
  params: URLSearchParams,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = params.get("LS_subId");
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  subscription.ended = true;
  unregisterWireReinjectionTarget(subscription, state);
  state.emit("subscription-ended", {
    client: wireClientPayload(wire),
    subscription: { id: subscription.id },
    raw: wireRaw({
      frameDirection: "outbound",
      operation: "delete",
      request: paramsToJson(params)
    })
  });
}

function handleWireInboundFrame(
  frame: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  for (const line of splitTlcpLines(frame)) {
    if (line.startsWith("CONOK,")) {
      handleWireConok(line, wire, state);
    } else if (line.startsWith("SUBOK,")) {
      handleWireSubscriptionOk(line, wire, state, false);
    } else if (line.startsWith("SUBCMD,")) {
      handleWireSubscriptionOk(line, wire, state, true);
    } else if (line.startsWith("UNSUB,")) {
      handleWireUnsub(line, wire, state);
    } else if (line.startsWith("EOS,")) {
      handleWireEndOfSnapshot(line, wire, state);
    } else if (line.startsWith("CS,")) {
      handleWireClearSnapshot(line, wire, state);
    } else if (line.startsWith("OV,")) {
      handleWireOverflow(line, wire, state);
    } else if (line.startsWith("U,")) {
      handleWireUpdate(line, wire, state);
    }
  }
}

function handleWireConok(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  wire.sessionId = parts[1] ?? wire.sessionId;
  wire.status = "CONNECTED:WS-STREAMING";
  state.emit("client-status", {
    client: wireClientPayload(wire),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "CONOK",
      sessionId: wire.sessionId
    })
  });
}

function handleWireSubscriptionOk(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState,
  commandMode: boolean
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  const fieldCount = toPositiveInteger(parts[3]);
  if (fieldCount !== null) {
    ensureWireFieldCount(subscription, fieldCount);
  }

  if (commandMode) {
    subscription.mode = "COMMAND";
    subscription.keyPosition = toPositiveInteger(parts[4]);
    subscription.commandPosition = toPositiveInteger(parts[5]);
    applyCommandFieldAliases(subscription);
  }

  state.emit("subscription-started", {
    client: wireClientPayload(wire),
    subscription: wireSubscriptionPayload(subscription),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: commandMode ? "SUBCMD" : "SUBOK",
      rawSubId
    })
  });
}

function handleWireUnsub(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const rawSubId = line.split(",")[1];
  if (!rawSubId) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  subscription.ended = true;
  unregisterWireReinjectionTarget(subscription, state);
  state.emit("subscription-ended", {
    client: wireClientPayload(wire),
    subscription: { id: subscription.id },
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "UNSUB",
      rawSubId
    })
  });
}

function handleWireEndOfSnapshot(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  const itemKey = String(itemPosition);
  subscription.snapshotEndedItems.add(itemKey);
  state.emit("end-of-snapshot", {
    client: wireClientPayload(wire),
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "EOS",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireClearSnapshot(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  subscription.itemStates.delete(String(itemPosition));
  state.emit("clear-snapshot", {
    client: wireClientPayload(wire),
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "CS",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireOverflow(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parts = line.split(",");
  const rawSubId = parts[1];
  const itemPosition = toPositiveInteger(parts[2]);
  const lostUpdates = toPositiveInteger(parts[3]);
  if (!rawSubId || itemPosition === null) {
    return;
  }

  const subscription = ensureWireSubscription(wire, rawSubId, state);
  if (subscription.ended) {
    return;
  }
  state.emit("lost-updates", {
    client: wireClientPayload(wire),
    subscription: { id: subscription.id },
    item: wireItemPayload(subscription, itemPosition),
    update: compactJsonObject({ lostUpdates }),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "OV",
      rawSubId,
      itemPosition
    })
  });
}

function handleWireUpdate(
  line: string,
  wire: WireConnectionState,
  state: InstrumentationState
): void {
  const parsed = parseWireUpdateLine(line);
  if (!parsed) {
    return;
  }

  const subscription = ensureWireSubscription(wire, parsed.rawSubId, state);
  if (subscription.ended) {
    return;
  }
  const itemKey = String(parsed.itemPosition);
  const itemState = getWireItemState(subscription, itemKey);
  const decoded = decodeWireFields(subscription, parsed.fieldData, itemState.fields);
  const isSnapshot = inferWireSnapshot(subscription, itemKey);
  const command = readCommandField(subscription, decoded.fields);
  const key = readKeyField(subscription, decoded.fields);

  itemState.fields = decoded.fields;
  subscription.firstUpdateItems.add(itemKey);

  state.emit("item-update", {
    client: wireClientPayload(wire),
    subscription: wireSubscriptionPayload(subscription),
    item: wireItemPayload(subscription, parsed.itemPosition),
    update: compactJsonObject({
      isSnapshot,
      fields: decoded.fields,
      changedFields: decoded.changedFields,
      jsonPatches: decoded.jsonPatches,
      command,
      key
    }),
    raw: wireRaw({
      frameDirection: "inbound",
      frameTag: "U",
      rawSubId: parsed.rawSubId,
      itemPosition: parsed.itemPosition,
      unsupportedDiffFields: decoded.unsupportedDiffFields
    })
  });
}

function createWireSubscription(
  rawSubId: string,
  params: URLSearchParams,
  state: InstrumentationState
): WireSubscriptionState {
  const fieldNames = splitWireList(params.get("LS_schema")) ?? [];
  const subscription: WireSubscriptionState = {
    id: "",
    rawSubId,
    ended: false,
    mode: params.get("LS_mode"),
    itemNames: splitWireList(params.get("LS_group")),
    fieldNames,
    dataAdapter: params.get("LS_data_adapter"),
    requestedSnapshot: params.get("LS_snapshot"),
    keyPosition: null,
    commandPosition: null,
    itemStates: new Map<string, WireItemState>(),
    snapshotEndedItems: new Set<string>(),
    firstUpdateItems: new Set<string>()
  };
  subscription.id = state.subscriptionIds.getId(subscription);

  return subscription;
}

function ensureWireSubscription(
  wire: WireConnectionState,
  rawSubId: string,
  state: InstrumentationState
): WireSubscriptionState {
  const existing = wire.subscriptions.get(rawSubId);
  if (existing) {
    if (!existing.ended) {
      registerWireReinjectionTarget(wire, existing, state);
    }
    return existing;
  }

  const subscription: WireSubscriptionState = {
    id: "",
    rawSubId,
    ended: false,
    mode: null,
    itemNames: null,
    fieldNames: [],
    dataAdapter: null,
    requestedSnapshot: null,
    keyPosition: null,
    commandPosition: null,
    itemStates: new Map<string, WireItemState>(),
    snapshotEndedItems: new Set<string>(),
    firstUpdateItems: new Set<string>()
  };
  subscription.id = state.subscriptionIds.getId(subscription);
  wire.subscriptions.set(rawSubId, subscription);
  registerWireReinjectionTarget(wire, subscription, state);
  return subscription;
}

function registerWireReinjectionTarget(
  wire: WireConnectionState,
  subscription: WireSubscriptionState,
  state: InstrumentationState
): void {
  state.wireTargets.set(subscription.id, {
    subscriptionId: subscription.id,
    socket: wire.socket,
    subscription
  });
}

function unregisterWireReinjectionTarget(
  subscription: WireSubscriptionState,
  state: InstrumentationState
): void {
  const target = state.wireTargets.get(subscription.id);
  if (target?.subscription === subscription) {
    state.wireTargets.delete(subscription.id);
  }
}

function getWireItemState(subscription: WireSubscriptionState, itemKey: string): WireItemState {
  const existing = subscription.itemStates.get(itemKey);
  if (existing) {
    return existing;
  }

  const itemState = { fields: {} };
  subscription.itemStates.set(itemKey, itemState);
  return itemState;
}

function decodeWireFields(
  subscription: WireSubscriptionState,
  fieldData: string,
  previousFields: Record<string, string | number | boolean | null>
): DecodedWireFields {
  const fields = { ...previousFields };
  const changedFields: Record<string, string | number | boolean | null> = {};
  const jsonPatches: CapturePayload = {};
  const unsupportedDiffFields: string[] = [];
  let pointer = 0;

  for (const token of fieldData.split("|")) {
    if (token === "") {
      pointer += 1;
      continue;
    }

    if (/^\^\d+$/.test(token)) {
      pointer += Number(token.slice(1));
      continue;
    }

    const fieldName = fieldNameAt(subscription, pointer);
    if (token === "#") {
      fields[fieldName] = null;
      changedFields[fieldName] = null;
      pointer += 1;
      continue;
    }

    if (token === "$") {
      fields[fieldName] = "";
      changedFields[fieldName] = "";
      pointer += 1;
      continue;
    }

    if (/^\^[A-Za-z]/.test(token)) {
      const diffFormat = token[1];
      const diffValue = decodeTlcpValue(token.slice(2));
      if (diffFormat === "P") {
        jsonPatches[fieldName] = parseJsonPatch(diffValue);
      }
      unsupportedDiffFields.push(fieldName);
      changedFields[fieldName] = diffValue;
      if (!Object.prototype.hasOwnProperty.call(fields, fieldName)) {
        fields[fieldName] = diffValue;
      }
      pointer += 1;
      continue;
    }

    const value = decodeTlcpValue(token);
    fields[fieldName] = value;
    changedFields[fieldName] = value;
    pointer += 1;
  }

  return {
    fields,
    changedFields,
    jsonPatches,
    unsupportedDiffFields
  };
}

function inferWireSnapshot(subscription: WireSubscriptionState, itemKey: string): boolean {
  if (!isSnapshotRequested(subscription.requestedSnapshot)) {
    return false;
  }

  if (subscription.mode === "MERGE") {
    return !subscription.firstUpdateItems.has(itemKey);
  }

  if (subscription.mode === "RAW") {
    return false;
  }

  return !subscription.snapshotEndedItems.has(itemKey);
}

function isSnapshotRequested(value: string | null): boolean {
  if (value === null) {
    return false;
  }
  const normalized = value.toLowerCase();
  return normalized !== "false" && normalized !== "no";
}

function wireSubscriptionPayload(subscription: WireSubscriptionState): CapturePayload {
  return compactJsonObject({
    id: subscription.id,
    mode: subscription.mode,
    items: subscription.itemNames,
    fields: subscription.fieldNames.length > 0 ? subscription.fieldNames : undefined,
    dataAdapter: subscription.dataAdapter,
    requestedSnapshot: subscription.requestedSnapshot,
    keyPosition: subscription.keyPosition,
    commandPosition: subscription.commandPosition
  });
}

function wireClientPayload(wire: WireConnectionState): CapturePayload {
  return compactJsonObject({
    id: wire.clientId,
    serverAddress: wire.url,
    adapterSet: wire.adapterSet,
    status: wire.status,
    sessionId: wire.sessionId,
    transport: "websocket",
    instrumentationSource: "websocket-tlcp",
    coverageStatus: "limited"
  });
}

function wireItemPayload(subscription: WireSubscriptionState, itemPosition: number): CapturePayload {
  return compactJsonObject({
    name: subscription.itemNames?.[itemPosition - 1] ?? null,
    position: itemPosition
  });
}

function wireRaw(source: Record<string, unknown>): CapturePayload {
  return compactJsonObject({
    captureSource: "websocket-tlcp",
    transport: "websocket",
    ...source
  });
}

function parseWireUpdateLine(
  line: string
): { rawSubId: string; itemPosition: number; fieldData: string } | null {
  const first = line.indexOf(",");
  const second = first >= 0 ? line.indexOf(",", first + 1) : -1;
  const third = second >= 0 ? line.indexOf(",", second + 1) : -1;
  if (first < 0 || second < 0 || third < 0) {
    return null;
  }

  const rawSubId = line.slice(first + 1, second);
  const itemPosition = toPositiveInteger(line.slice(second + 1, third));
  if (!rawSubId || itemPosition === null) {
    return null;
  }

  return {
    rawSubId,
    itemPosition,
    fieldData: line.slice(third + 1)
  };
}

function parseTlcpParameterLines(frame: string): URLSearchParams[] {
  return splitTlcpLines(frame)
    .filter((line) => line.includes("="))
    .map((line) => new URLSearchParams(line))
    .filter((params) => params.has("LS_op") || params.has("LS_adapter_set"));
}

function splitTlcpLines(frame: string): string[] {
  return frame
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function paramsToJson(params: URLSearchParams): CapturePayload {
  const payload: CapturePayload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
}

function splitWireList(value: string | null): string[] | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  return value.split(/\s+/).filter(Boolean);
}

function ensureWireFieldCount(subscription: WireSubscriptionState, count: number): void {
  while (subscription.fieldNames.length < count) {
    subscription.fieldNames.push(`field-${subscription.fieldNames.length + 1}`);
  }
}

function fieldNameAt(subscription: WireSubscriptionState, index: number): string {
  ensureWireFieldCount(subscription, index + 1);
  return subscription.fieldNames[index] ?? `field-${index + 1}`;
}

function applyCommandFieldAliases(subscription: WireSubscriptionState): void {
  const keyIndex = subscription.keyPosition === null ? -1 : subscription.keyPosition - 1;
  const commandIndex =
    subscription.commandPosition === null ? -1 : subscription.commandPosition - 1;

  if (keyIndex >= 0) {
    ensureWireFieldCount(subscription, keyIndex + 1);
    if (/^field-\d+$/.test(subscription.fieldNames[keyIndex])) {
      subscription.fieldNames[keyIndex] = "key";
    }
  }

  if (commandIndex >= 0) {
    ensureWireFieldCount(subscription, commandIndex + 1);
    if (/^field-\d+$/.test(subscription.fieldNames[commandIndex])) {
      subscription.fieldNames[commandIndex] = "command";
    }
  }
}

function readCommandField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>
): string | null {
  return readPositionedField(subscription, fields, subscription.commandPosition) ?? readNamedField(fields, "command");
}

function readKeyField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>
): string | null {
  return readPositionedField(subscription, fields, subscription.keyPosition) ?? readNamedField(fields, "key");
}

function readPositionedField(
  subscription: WireSubscriptionState,
  fields: Record<string, string | number | boolean | null>,
  position: number | null
): string | null {
  if (position === null) {
    return null;
  }
  const fieldName = subscription.fieldNames[position - 1];
  return fieldName ? asNullableString(fields[fieldName]) : null;
}

function readNamedField(
  fields: Record<string, string | number | boolean | null>,
  fieldName: string
): string | null {
  return asNullableString(fields[fieldName]);
}

function decodeTlcpValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch (_error) {
    return value.replace(/\+/g, " ");
  }
}

function parseJsonPatch(value: string): CapturePayload[string] {
  try {
    return toJsonValue(JSON.parse(value));
  } catch (_error) {
    return value;
  }
}

function webSocketUrlToString(value: string | URL): string {
  return String(value);
}

function isLightstreamerWebSocketUrl(url: string): boolean {
  return url.toLowerCase().includes("/lightstreamer");
}

function textWirePayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toPositiveInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function wrapClient(client: LightstreamerClientLike, state: InstrumentationState): void {
  if (!isObject(client) || state.wrappedClients.has(client)) {
    return;
  }
  state.wrappedClients.add(client);

  wrapMethod(client, "connect", function afterConnect(target) {
    state.emit("client-status", {
      client: compactJsonObject({
        ...clientPayload(target, state),
        status: readGetter(target, "getStatus") ?? "connect-called"
      }),
      raw: { callback: "connect" }
    });
  });

  wrapMethod(client, "disconnect", function afterDisconnect(target) {
    state.emit("client-status", {
      client: compactJsonObject({
        ...clientPayload(target, state),
        status: readGetter(target, "getStatus") ?? "disconnect-called"
      }),
      raw: { callback: "disconnect" }
    });
  });

  wrapMethod(client, "subscribe", function afterSubscribe(target, args) {
    const subscription = args[0];
    if (!isObject(subscription)) {
      return;
    }
    const subscriptionMetadataErrors: string[] = [];
    const subscriptionMetadata = readSubscriptionMetadata(
      subscription as LightstreamerSubscriptionLike,
      [],
      subscriptionMetadataErrors
    );
    const clientMetadata = clientPayload(target, state);
    const primarySubscription = {
      id: state.subscriptionIds.getId(subscription),
      ...subscriptionMetadata
    };
    const handoffRows = reconcileFallbackSubscription(
      state,
      clientMetadata,
      primarySubscription
    );
    wrapSubscription(subscription as LightstreamerSubscriptionLike, state);
    state.subscriptionClients.set(subscription, target);
    state.emit("subscription-started", compactJsonObject({
      client: clientMetadata,
      subscription: primarySubscription,
      raw:
        subscriptionMetadataErrors.length > 0
          ? { subscriptionMetadataErrors }
          : undefined
    }));
    for (const row of handoffRows) {
      state.emit(
        "item-update",
        commandReplayPayload(
          row,
          { client: clientMetadata, subscription: primarySubscription },
          "handoff"
        )
      );
    }
  });

  wrapMethod(client, "unsubscribe", function afterUnsubscribe(target, args) {
    const subscription = args[0];
    state.emit("subscription-ended", {
      client: clientPayload(target, state),
      subscription: isObject(subscription)
        ? {
            id: state.subscriptionIds.getId(subscription),
            ...readSubscriptionMetadata(subscription as LightstreamerSubscriptionLike)
          }
        : { id: "unknown" }
    });
  });

  wrapMethod(client, "addListener", function afterAddListener(target, args) {
    const listener = args[0];
    if (!isObject(listener)) {
      return;
    }
    wrapClientListener(target, listener as LightstreamerListenerLike, state);
    state.emit("listener-added", {
      client: clientPayload(target, state),
      listener: { id: state.listenerIds.getId(listener) }
    });
  });

  wrapMethod(client, "removeListener", function afterRemoveListener(target, args) {
    const listener = args[0];
    state.emit("listener-removed", {
      client: clientPayload(target, state),
      listener: isObject(listener) ? { id: state.listenerIds.getId(listener) } : { id: "unknown" }
    });
  });
}

function wrapSubscription(
  subscription: LightstreamerSubscriptionLike,
  state: InstrumentationState
): void {
  if (!isObject(subscription) || state.wrappedSubscriptions.has(subscription)) {
    return;
  }
  state.wrappedSubscriptions.add(subscription);

  wrapSubscriptionListenerMethods(subscription, state);
}

function wrapClientListener(
  client: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): void {
  if (state.wrappedClientListeners.has(listener)) {
    return;
  }
  state.wrappedClientListeners.add(listener);

  wrapCallback(listener, "onStatusChange", function beforeStatusChange(args) {
    state.emit("client-status", {
      client: compactJsonObject({
        ...clientPayload(client, state),
        status: toJsonValue(args[0])
      }),
      listener: { id: state.listenerIds.getId(listener) },
      raw: {
        callback: "onStatusChange",
        args: args.map((entry) => toJsonValue(entry))
      }
    });
  });

  wrapCallback(listener, "onPropertyChange", function beforePropertyChange(args) {
    state.emit("client-status", {
      // Read every public value synchronously inside the notification. Lightstreamer
      // settings are asynchronous and a later read can observe a different value.
      client: clientPayload(client, state),
      listener: { id: state.listenerIds.getId(listener) },
      raw: {
        callback: "onPropertyChange",
        property: toJsonValue(args[0]),
        args: args.map((entry) => toJsonValue(entry))
      }
    });
  });
}

function wrapSubscriptionListenerMethods(
  subscription: LightstreamerSubscriptionLike,
  state: InstrumentationState
): void {
  const originalAddListener = subscription.addListener;
  if (typeof originalAddListener === "function") {
    subscription.addListener = function wrappedSubscriptionAddListener(this: object, ...args: unknown[]) {
      const listener = args[0];
      if (!isObject(listener)) {
        return originalAddListener.apply(this, args);
      }

      const actualSubscription = isObject(this) ? this : subscription;
      let forwardedListener: unknown = listener;
      try {
        forwardedListener = getOrCreateSubscriptionListenerProxy(
          actualSubscription,
          listener as LightstreamerListenerLike,
          state
        );
      } catch (_error) {
        // Proxy creation is optional; the original listener stays authoritative.
      }
      const result = originalAddListener.apply(this, [forwardedListener, ...args.slice(1)]);

      try {
        const effective = isSubscriptionListenerEffective(
          actualSubscription,
          listener,
          forwardedListener
        );
        if (effective !== false) {
          acknowledgeSubscriptionListenerLifecycle(
            actualSubscription,
            listener as LightstreamerListenerLike,
            "start",
            state
          );
        }
      } catch (_error) {
        // Post-registration capture cannot replace the page-owned return.
      }

      return result;
    };
  }

  const originalRemoveListener = subscription.removeListener;
  if (typeof originalRemoveListener === "function") {
    subscription.removeListener = function wrappedSubscriptionRemoveListener(this: object, ...args: unknown[]) {
      const listener = args[0];
      const actualSubscription = isObject(this) ? this : subscription;
      let proxy: LightstreamerListenerLike | null = null;
      try {
        proxy = isObject(listener)
          ? getSubscriptionListenerProxy(actualSubscription, listener as LightstreamerListenerLike, state)
          : null;
      } catch (_error) {
        // Removal falls back to the page-provided listener identity.
      }
      const result = originalRemoveListener.apply(this, [
        proxy ?? listener,
        ...args.slice(1)
      ]);

      try {
        if (isObject(listener)) {
          const effective = isSubscriptionListenerEffective(
            actualSubscription,
            listener,
            proxy ?? listener
          );
          if (effective !== true) {
            acknowledgeSubscriptionListenerLifecycle(
              actualSubscription,
              listener as LightstreamerListenerLike,
              "end",
              state
            );
          }
        }
      } catch (_error) {
        // Post-removal capture cannot replace the page-owned return.
      }

      return result;
    };
  }

  const originalGetListeners = subscription.getListeners;
  if (typeof originalGetListeners === "function") {
    subscription.getListeners = function wrappedSubscriptionGetListeners(
      this: object,
      ...args: unknown[]
    ) {
      const result = Reflect.apply(
        originalGetListeners as unknown as (...getListenerArgs: unknown[]) => unknown,
        this,
        args
      );
      if (!Array.isArray(result)) {
        return result;
      }
      return result.map((entry) =>
        isObject(entry) ? state.listenerProxyOriginals.get(entry) ?? entry : entry
      );
    };
  }
}

function getOrCreateSubscriptionListenerProxy(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): LightstreamerListenerLike {
  let proxies = state.subscriptionListenerProxies.get(subscription);
  if (!proxies) {
    proxies = new WeakMap<object, LightstreamerListenerLike>();
    state.subscriptionListenerProxies.set(subscription, proxies);
  }

  const existing = proxies.get(listener);
  if (existing) {
    return existing;
  }

  const originalItemUpdate = listener.onItemUpdate;
  if (typeof originalItemUpdate === "function") {
    state.originalItemUpdateCallbacks.set(
      listener,
      originalItemUpdate.bind(listener) as (update: SyntheticItemUpdate) => unknown
    );
  }

  const capturedCallbacks = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const proxy = new Proxy(listener, {
    get(target, property, receiver) {
      if (property === "onListenStart" || property === "onListenEnd") {
        const existingCallback = capturedCallbacks.get(property);
        if (existingCallback) {
          return existingCallback;
        }
        const wrappedLifecycleCallback = (...args: unknown[]) => {
          try {
            acknowledgeSubscriptionListenerLifecycle(
              subscription,
              listener,
              property === "onListenStart" ? "start" : "end",
              state
            );
          } catch (_error) {
            // Lifecycle evidence is best-effort and cannot replace the page callback.
          }
          const callback = target[property];
          return typeof callback === "function" ? callback.apply(listener, args) : undefined;
        };
        capturedCallbacks.set(property, wrappedLifecycleCallback);
        return wrappedLifecycleCallback;
      }
      if (typeof property === "string" && isCapturedSubscriptionCallback(property)) {
        const callback = target[property];
        if (typeof callback !== "function") {
          return Reflect.get(target, property, receiver);
        }

        const existingCallback = capturedCallbacks.get(property);
        if (existingCallback) {
          return existingCallback;
        }

        const wrappedCallback = (...args: unknown[]) => {
          try {
            emitSubscriptionListenerCallback(subscription, listener, property, args, state);
          } catch (_error) {
            // Capture extraction cannot suppress or replace the page callback.
          }
          return callback.apply(listener, args);
        };
        capturedCallbacks.set(property, wrappedCallback);
        return wrappedCallback;
      }

      return Reflect.get(target, property, receiver);
    }
  });

  proxies.set(listener, proxy);
  state.listenerProxyOriginals.set(proxy, listener);
  return proxy;
}

function getSubscriptionListenerProxy(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): LightstreamerListenerLike | null {
  return state.subscriptionListenerProxies.get(subscription)?.get(listener) ?? null;
}

function deleteSubscriptionListenerProxy(
  subscription: object,
  listener: object,
  state: InstrumentationState
): void {
  state.subscriptionListenerProxies.get(subscription)?.delete(listener);
}

function emitSubscriptionListenerCallback(
  subscription: object,
  listener: LightstreamerListenerLike,
  callback: (typeof CALLBACKS_TO_CAPTURE)[number],
  args: readonly unknown[],
  state: InstrumentationState
): void {
  const kind = callbackToKind(callback);
  if (!kind) {
    return;
  }
  const callbackPayload =
    callback === "onItemUpdate"
      ? readItemUpdatePayload(args[0])
      : readSubscriptionCallbackPayload(callback, args);
  const itemRaw = isObject(callbackPayload.raw) ? callbackPayload.raw : {};
  const subscriptionMetadataErrors: string[] = [];
  const subscriptionMetadata = readSubscriptionMetadata(
    subscription as LightstreamerSubscriptionLike,
    [],
    subscriptionMetadataErrors
  );

  const frequencyMetadata =
    callback === "onRealMaxFrequency"
      ? { realMaxFrequency: toJsonValue(args[0]) }
      : {};

  state.emit(kind, compactJsonObject({
    client: readSubscriptionClient(subscription, state),
    subscription: {
      id: state.subscriptionIds.getId(subscription),
      ...subscriptionMetadata,
      ...frequencyMetadata
    },
    listener: subscriptionListenerPayload(subscription, listener, state),
    ...callbackPayload,
    raw: {
      ...itemRaw,
      callback,
      logicalEventId:
        callback === "onItemUpdate" && isObject(args[0])
          ? state.updateIds.getId(args[0])
          : undefined,
      targetAvailable: state.listenerTargets.has(
        targetKey(
          state.subscriptionIds.getId(subscription),
          state.listenerIds.getId(listener)
        )
      ),
      args:
        callback === "onItemUpdate"
          ? ["[ItemUpdate]"]
          : callback === "onSubscriptionError"
            ? args.map((entry, index) => index === 0 ? toJsonValue(entry) : "[redacted]")
            : callback === "onCommandSecondLevelSubscriptionError"
              ? args.map((entry, index) => index === 1 ? "[redacted]" : toJsonValue(entry))
            : args.map((entry) => toJsonValue(entry)),
      ...(subscriptionMetadataErrors.length > 0 ? { subscriptionMetadataErrors } : {})
    }
  }));
}

function isCapturedSubscriptionCallback(
  callback: string
): callback is (typeof CALLBACKS_TO_CAPTURE)[number] {
  return (CALLBACKS_TO_CAPTURE as readonly string[]).includes(callback);
}

function registerReinjectionTarget(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): void {
  const callback = state.originalItemUpdateCallbacks.get(listener);
  if (!callback) {
    return;
  }

  const subscriptionId = state.subscriptionIds.getId(subscription);
  const listenerId = state.listenerIds.getId(listener);
  state.listenerTargets.set(targetKey(subscriptionId, listenerId), {
    subscriptionId,
    listenerId,
    subscription,
    listener,
    fieldNames: readSubscriptionFieldNames(subscription),
    callback
  });
}

function registerSubscriptionListener(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): boolean {
  const subscriptionId = state.subscriptionIds.getId(subscription);
  const listenerId = state.listenerIds.getId(listener);
  const key = targetKey(subscriptionId, listenerId);
  const existing = state.listenerRegistrations.get(key);
  if (existing?.active) {
    existing.callbacks = subscriptionListenerCallbacks(listener);
    return false;
  }
  state.listenerRegistrations.set(key, {
    addCount: (existing?.addCount ?? 0) + 1,
    active: true,
    callbacks: subscriptionListenerCallbacks(listener)
  });
  const listenerIds = state.subscriptionListenerIds.get(subscriptionId) ?? new Set<string>();
  listenerIds.add(listenerId);
  state.subscriptionListenerIds.set(subscriptionId, listenerIds);
  return true;
}

function unregisterSubscriptionListener(
  subscription: object,
  listener: object,
  state: InstrumentationState
): boolean {
  const subscriptionId = state.subscriptionIds.getId(subscription);
  const listenerId = state.listenerIds.getId(listener);
  const key = targetKey(subscriptionId, listenerId);
  const registration = state.listenerRegistrations.get(key);
  if (!registration?.active) {
    return false;
  }
  registration.active = false;
  const listenerIds = state.subscriptionListenerIds.get(subscriptionId);
  listenerIds?.delete(listenerId);
  if (listenerIds?.size === 0) {
    state.subscriptionListenerIds.delete(subscriptionId);
  }
  return true;
}

function acknowledgeSubscriptionListenerLifecycle(
  subscription: object,
  listener: LightstreamerListenerLike,
  lifecycle: "start" | "end",
  state: InstrumentationState
): void {
  const transitioned = lifecycle === "start"
    ? registerSubscriptionListener(subscription, listener, state)
    : unregisterSubscriptionListener(subscription, listener, state);
  if (!transitioned) {
    return;
  }
  if (lifecycle === "start") {
    registerReinjectionTarget(subscription, listener, state);
  } else {
    unregisterReinjectionTarget(subscription, listener, state);
    deleteSubscriptionListenerProxy(subscription, listener, state);
  }
  const subscriptionId = state.subscriptionIds.getId(subscription);
  state.emit(lifecycle === "start" ? "listener-added" : "listener-removed", compactJsonObject({
    client: readSubscriptionClient(subscription, state),
    subscription: {
      id: subscriptionId,
      ...readSubscriptionMetadata(subscription as LightstreamerSubscriptionLike)
    },
    listener: subscriptionListenerPayload(subscription, listener, state),
    raw: {
      targetAvailable: state.listenerTargets.has(
        targetKey(subscriptionId, state.listenerIds.getId(listener))
      )
    }
  }));
}

function isSubscriptionListenerEffective(
  subscription: object,
  listener: object,
  forwardedListener: unknown
): boolean | undefined {
  const getListeners = (subscription as LightstreamerSubscriptionLike).getListeners;
  if (typeof getListeners !== "function") {
    return undefined;
  }
  try {
    const listeners = Reflect.apply(getListeners, subscription, []);
    return Array.isArray(listeners)
      ? listeners.some((entry) => entry === listener || entry === forwardedListener)
      : undefined;
  } catch (_error) {
    return undefined;
  }
}

function subscriptionListenerPayload(
  subscription: object,
  listener: LightstreamerListenerLike,
  state: InstrumentationState
): CapturePayload {
  const subscriptionId = state.subscriptionIds.getId(subscription);
  const listenerId = state.listenerIds.getId(listener);
  const registration = state.listenerRegistrations.get(targetKey(subscriptionId, listenerId));
  return compactJsonObject({
    id: listenerId,
    callbacks: registration?.callbacks ?? subscriptionListenerCallbacks(listener),
    registrationCount: registration?.addCount ?? 1,
    metricOwner: metricOwnerId(subscriptionId, state) === listenerId
  });
}

function subscriptionListenerCallbacks(listener: LightstreamerListenerLike): string[] {
  return CALLBACKS_TO_CAPTURE.filter((callback) => typeof listener[callback] === "function");
}

function metricOwnerId(
  subscriptionId: string,
  state: InstrumentationState
): string | null {
  return Array.from(state.subscriptionListenerIds.get(subscriptionId) ?? []).sort()[0] ?? null;
}

function readSubscriptionFieldNames(subscription: object): string[] {
  const fields = readGetter(subscription, "getFields");
  return Array.isArray(fields) && fields.every((fieldName) => typeof fieldName === "string")
    ? fields
    : [];
}

function unregisterReinjectionTarget(
  subscription: object,
  listener: object,
  state: InstrumentationState
): void {
  state.listenerTargets.delete(
    targetKey(state.subscriptionIds.getId(subscription), state.listenerIds.getId(listener))
  );
}

function isRetiredFallbackCapture(
  retiredSubscriptionIds: Set<string>,
  payload: CapturePayload
): boolean {
  const raw = captureObject(payload.raw);
  if (raw?.captureSource !== "websocket-tlcp") {
    return false;
  }
  const subscription = captureObject(payload.subscription);
  const subscriptionId = nonEmptyString(subscription?.id);
  return Boolean(subscriptionId && retiredSubscriptionIds.has(subscriptionId));
}

function trackCommandReplayRows(
  replayRows: Map<string, Map<string, CapturePayload>>,
  kind: CaptureKind,
  payload: CapturePayload
): void {
  const subscription = captureObject(payload.subscription);
  const subscriptionId = nonEmptyString(subscription?.id);
  if (!subscriptionId) {
    return;
  }

  if (kind === "subscription-ended" || kind === "subscription-error") {
    replayRows.delete(subscriptionId);
    return;
  }
  if (kind !== "item-update") {
    return;
  }

  const rows = replayRows.get(subscriptionId);
  if (normalizedString(subscription?.mode) !== "COMMAND" && !rows) {
    return;
  }

  const update = captureObject(payload.update);
  const fields = captureObject(update?.fields);
  const command = normalizedString(update?.command ?? fields?.command);
  const key = nonEmptyString(update?.key ?? fields?.key);
  const item = captureObject(payload.item);
  if (!command || !key || !item || !["ADD", "UPDATE", "DELETE"].includes(command)) {
    return;
  }
  if (command === "UPDATE" && update?.isSnapshot === true) {
    return;
  }

  const rowId = JSON.stringify([item.position ?? null, item.name ?? null, key]);
  if (command === "DELETE") {
    rows?.delete(rowId);
    return;
  }

  const nextRows = rows ?? new Map<string, CapturePayload>();
  const previous = nextRows.get(rowId);
  const previousSubscription = captureObject(previous?.subscription);
  const previousItem = captureObject(previous?.item);
  const previousUpdate = captureObject(previous?.update);
  const previousFields = captureObject(previousUpdate?.fields);
  const mergedFields = compactJsonObject({
    ...previousFields,
    ...fields,
    command,
    key
  });

  nextRows.set(
    rowId,
    compactJsonObject({
      client: payload.client ?? previous?.client,
      subscription: compactJsonObject({
        ...previousSubscription,
        ...subscription
      }),
      listener: payload.listener ?? previous?.listener,
      item: compactJsonObject({
        ...previousItem,
        ...item
      }),
      update: compactJsonObject({
        ...previousUpdate,
        ...update,
        fields: mergedFields,
        command,
        key
      }),
      raw: payload.raw ?? previous?.raw
    })
  );
  replayRows.set(subscriptionId, nextRows);
}

function commandReplayPayload(
  row: CapturePayload,
  activeSubscription: CapturePayload,
  reason: "sync" | "handoff" = "sync"
): CapturePayload {
  const activeClient = captureObject(activeSubscription.client);
  const activeMetadata = captureObject(activeSubscription.subscription);
  const rowSubscription = captureObject(row.subscription);
  const update = captureObject(row.update);
  const fields = captureObject(update?.fields);
  const key = nonEmptyString(update?.key ?? fields?.key);
  const replayFields = compactJsonObject({
    ...fields,
    command: "ADD",
    key
  });
  const raw = captureObject(row.raw);

  return compactJsonObject({
    ...row,
    client: activeClient ?? row.client,
    subscription: compactJsonObject({
      ...rowSubscription,
      ...activeMetadata
    }),
    update: compactJsonObject({
      ...update,
      isSnapshot: true,
      fields: replayFields,
      changedFields: replayFields,
      command: "ADD",
      key
    }),
    raw: compactJsonObject({
      ...raw,
      captureSource: reason === "handoff" ? undefined : raw?.captureSource,
      captureSync: reason === "sync" ? true : undefined,
      commandStateSync: reason === "sync" ? true : undefined,
      captureHandoff: reason === "handoff" ? "primary-api" : raw?.captureHandoff,
      commandStateHandoff: reason === "handoff" ? true : undefined
    })
  });
}

function trackActiveSubscription(
  activeSubscriptions: Map<string, CapturePayload>,
  kind: CaptureKind,
  payload: CapturePayload
): void {
  const subscription = captureObject(payload.subscription);
  const subscriptionId =
    typeof subscription?.id === "string" && subscription.id.trim() !== ""
      ? subscription.id
      : null;
  if (!subscriptionId) {
    return;
  }

  if (kind === "subscription-ended" || kind === "subscription-error") {
    activeSubscriptions.delete(subscriptionId);
    return;
  }

  if (
    kind !== "subscription-started" &&
    kind !== "subscription-frequency" &&
    kind !== "item-update"
  ) {
    return;
  }

  const previous = activeSubscriptions.get(subscriptionId);
  const previousSubscription = captureObject(previous?.subscription);
  const client = captureObject(payload.client) ?? captureObject(previous?.client);
  const raw = captureObject(payload.raw);
  const previousRaw = captureObject(previous?.raw);
  const captureDiagnostics = compactJsonObject({
    captureSource: raw?.captureSource ?? previousRaw?.captureSource,
    transport: raw?.transport ?? previousRaw?.transport,
    rawSubId: raw?.rawSubId ?? previousRaw?.rawSubId
  });

  activeSubscriptions.set(
    subscriptionId,
    compactJsonObject({
      client,
      subscription: compactJsonObject({
        ...previousSubscription,
        ...subscription
      }),
      raw: Object.keys(captureDiagnostics).length > 0 ? captureDiagnostics : undefined
    })
  );
}

function installCaptureSyncHandler(host: LightstreamerHost, state: InstrumentationState): void {
  if (typeof host.addEventListener !== "function") {
    return;
  }

  host.addEventListener("message", (event) => {
    if (event.source !== host || !isPageCaptureSyncRequestMessage(event.data)) {
      return;
    }

    emitAbsoluteTopologyCheckpoint(host, state);

    for (const [subscriptionId, rows] of state.commandReplayRows.entries()) {
      const activeSubscription = state.activeSubscriptions.get(subscriptionId);
      if (!activeSubscription) {
        continue;
      }
      for (const row of Array.from(rows.values())) {
        state.emitLegacy("item-update", commandReplayPayload(row, activeSubscription));
      }
    }
  });
}

function emitAbsoluteTopologyCheckpoint(host: LightstreamerHost, state: InstrumentationState): void {
  try {
    const cutoffCaptureSequence = state.captureSequence;
    const records = Array.from(state.topologyRecords.values()).sort(topologyRecordSort);
    const syncId = `sync:${state.pageEpoch}:${cutoffCaptureSequence}`;
    const frames = packAbsoluteTopologyCheckpoint(
      records,
      syncId,
      state.pageEpoch,
      cutoffCaptureSequence,
      aggregateTopologyCoverage(state),
      state.topologyCoverage === "partial"
    );
    for (const frame of frames) {
      host.postMessage?.(frame, "*");
    }
  } catch (_error) {
    emitPartialTopologyCheckpoint(host, state, "serialization-failed");
  }
}

function packAbsoluteTopologyCheckpoint(
  records: readonly TopologyAbsoluteRecord[],
  syncId: string,
  pageEpoch: string,
  cutoffCaptureSequence: number,
  coverage: TopologyCoverage,
  structuralPartial: boolean
): TopologySyncFrame[] {
  if (structuralPartial || records.length > TOPOLOGY_SYNC_LIMITS.maxRecords) {
    return partialTopologyFrames(
      syncId,
      pageEpoch,
      cutoffCaptureSequence,
      "limit-exceeded",
      coverage
    );
  }
  const recordChunks: TopologyAbsoluteRecord[][] = [];
  for (let offset = 0; offset < records.length; offset += 128) {
    recordChunks.push(records.slice(offset, offset + 128));
  }
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: recordChunks.length,
    recordCount: records.length,
    coverage
  };
  const frames: TopologySyncFrame[] = [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    ...recordChunks.map((chunk, chunkIndex) => ({
      type: TOPOLOGY_SYNC_CHUNK,
      ...metadata,
      chunkIndex,
      records: chunk
    }) as TopologySyncFrame),
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  ];
  const totalBytes = frames.reduce((total, frame) => total + topologySyncUtf8Bytes(frame), 0);
  if (
    frames.length - 2 > TOPOLOGY_SYNC_LIMITS.maxChunks ||
    totalBytes > TOPOLOGY_SYNC_LIMITS.maxStagedBytes ||
    frames.some(
      (frame) => !isTopologySyncFrame(frame) || topologySyncUtf8Bytes(frame) > TOPOLOGY_LIMITS.utf8Bytes
    )
  ) {
    return partialTopologyFrames(
      syncId,
      pageEpoch,
      cutoffCaptureSequence,
      "limit-exceeded",
      coverage
    );
  }
  return frames;
}

function partialTopologyFrames(
  syncId: string,
  pageEpoch: string,
  cutoffCaptureSequence: number,
  reason: "limit-exceeded" | "serialization-failed",
  aggregateCoverage: TopologyCoverage
): TopologySyncFrame[] {
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    pageEpoch,
    cutoffCaptureSequence,
    chunkCount: 0,
    recordCount: 0,
    coverage: {
      ...aggregateCoverage,
      status: "partial" as const,
      reason: reason === "limit-exceeded" ? "limit-exceeded" as const : "sanitization-failed" as const
    }
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata, reason }
  ];
}

function emitPartialTopologyCheckpoint(
  host: LightstreamerHost,
  state: InstrumentationState,
  reason: "limit-exceeded" | "serialization-failed"
): void {
  try {
    const cutoff = state.captureSequence;
    for (const frame of partialTopologyFrames(
      `sync:${state.pageEpoch}:${cutoff}`,
      state.pageEpoch,
      cutoff,
      reason,
      aggregateTopologyCoverage(state)
    )) {
      host.postMessage?.(frame, "*");
    }
  } catch (_error) {
    // A broken page transport remains outside instrumentation authority.
  }
}

function topologyRecordSort(left: TopologyAbsoluteRecord, right: TopologyAbsoluteRecord): number {
  const order: Record<TopologyAbsoluteRecord["kind"], number> = {
    page: 0,
    client: 1,
    session: 2,
    subscription: 3,
    establishment: 4,
    "listener-attachment": 5,
    item: 6,
    "command-generation": 7,
    "inferred-child": 8,
    aggregate: 9
  };
  return order[left.kind] - order[right.kind] || left.id.localeCompare(right.id);
}

function installReinjectionHandler(
  host: LightstreamerHost,
  postMessage: (message: unknown) => void,
  state: InstrumentationState
): void {
  const bridge = {
    version: PAGE_REINJECTION_BRIDGE_VERSION,
    reinject(requestId: unknown, draft: unknown): ReinjectionResult {
      const message = {
        type: PAGE_REINJECT_REQUEST,
        requestId,
        draft
      };
      if (!isPageReinjectRequestMessage(message)) {
        return pageBridgeErrorResult(
          typeof requestId === "string" && requestId ? requestId : "invalid-request",
          "The inspected page rejected an invalid reinjection request."
        );
      }
      return reinjectDraft(message.requestId, message.draft, state);
    }
  };

  try {
    Object.defineProperty(host, PAGE_REINJECTION_BRIDGE_GLOBAL, {
      configurable: true,
      enumerable: false,
      value: bridge
    });
  } catch (_error) {
    try {
      (host as LightstreamerHost & Record<string, unknown>)[PAGE_REINJECTION_BRIDGE_GLOBAL] = bridge;
    } catch (_assignmentError) {
      // Frozen/non-extensible hosts simply do not expose the optional direct bridge.
    }
  }

  if (typeof host.addEventListener !== "function") {
    return;
  }

  host.addEventListener("message", (event) => {
    if (event.source !== host || !isPageReinjectRequestMessage(event.data)) {
      return;
    }

    const resultMessage = {
      type: RUNTIME_REINJECT_RESULT,
      result: bridge.reinject(event.data.requestId, event.data.draft)
    };
    const responsePort = event.ports?.[0];
    if (responsePort) {
      try {
        responsePort.postMessage(resultMessage);
      } catch {
        // Older or already-closed ports still have the window-message fallback.
      } finally {
        responsePort.close();
      }
    }
    postMessage(resultMessage);
  });
}

function pageBridgeErrorResult(requestId: string, error: string): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "bridge-error",
    timestamp: Date.now(),
    error
  };
}

function reinjectDraft(
  requestId: string,
  draft: ReinjectionDraftPayload,
  state: InstrumentationState
): ReinjectionResult {
  if (draft.executionTarget === "captured-wire") {
    return reinjectWireDraft(requestId, draft, state);
  }

  const listenerId = draft.target.listenerId;
  const target = listenerId
    ? state.listenerTargets.get(targetKey(draft.target.subscriptionId, listenerId))
    : undefined;

  if (!target) {
    return {
      requestId,
      ok: false,
      status: "stale-target",
      timestamp: Date.now(),
      error: "Original subscription listener is no longer available."
    };
  }

  try {
    target.callback(createSyntheticItemUpdate(draft, target.fieldNames));
    return {
      requestId,
      ok: true,
      status: "success",
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      requestId,
      ok: false,
      status: "listener-error",
      timestamp: Date.now(),
      error: error instanceof Error ? error.message.slice(0, 500) : "Listener callback failed."
    };
  }
}

function reinjectWireDraft(
  requestId: string,
  draft: ReinjectionDraftPayload,
  state: InstrumentationState
): ReinjectionResult {
  const target = state.wireTargets.get(draft.target.subscriptionId);
  if (!target || target.subscription.ended || target.socket.readyState !== 1) {
    return {
      requestId,
      ok: false,
      status: "stale-target",
      timestamp: Date.now(),
      error: "Captured Lightstreamer WebSocket subscription is no longer available."
    };
  }

  const itemPosition = draft.item.position;
  if (!itemPosition || itemPosition < 1) {
    return wireErrorResult(requestId, "Captured wire item position is missing.");
  }

  const fieldNames = target.subscription.fieldNames;
  if (fieldNames.length === 0) {
    return wireErrorResult(requestId, "Captured wire field schema is unavailable.");
  }

  const draftFields: Record<string, string | number | boolean | null> = {
    ...draft.fields
  };
  if (draft.command !== null) {
    draftFields.command = draft.command;
  }
  if (draft.key !== null) {
    draftFields.key = draft.key;
  }
  const unknownFields = Object.keys(draftFields).filter(
    (fieldName) => !fieldNames.includes(fieldName)
  );
  if (unknownFields.length > 0) {
    return wireErrorResult(
      requestId,
      `Draft fields are not present in the captured wire schema: ${unknownFields.join(", ")}.`
    );
  }

  let messageEvent: MessageEvent | null = null;
  try {
    const fieldData = fieldNames
      .map((fieldName) =>
        Object.prototype.hasOwnProperty.call(draftFields, fieldName)
          ? encodeTlcpFieldValue(draftFields[fieldName] ?? null)
          : ""
      )
      .join("|");
    const frame = `U,${target.subscription.rawSubId},${itemPosition},${fieldData}\r\n`;
    messageEvent = new MessageEvent("message", {
      data: frame,
      origin: webSocketOrigin(target.socket)
    });
    state.syntheticWireEvents.add(messageEvent);
    target.socket.dispatchEvent(messageEvent);
    return {
      requestId,
      ok: true,
      status: "success",
      timestamp: Date.now()
    };
  } catch (error) {
    return wireErrorResult(
      requestId,
      error instanceof Error ? error.message.slice(0, 500) : "Wire replay failed."
    );
  } finally {
    if (messageEvent) {
      state.syntheticWireEvents.delete(messageEvent);
    }
  }
}

function encodeTlcpFieldValue(value: string | number | boolean | null): string {
  if (value === null) {
    return "#";
  }
  const text = String(value);
  return text === "" ? "$" : encodeURIComponent(text);
}

function webSocketOrigin(socket: WebSocket): string {
  try {
    return new URL(String(socket.url)).origin;
  } catch {
    return "";
  }
}

function wireErrorResult(requestId: string, error: string): ReinjectionResult {
  return {
    requestId,
    ok: false,
    status: "wire-error",
    timestamp: Date.now(),
    error
  };
}

function createSyntheticItemUpdate(
  draft: ReinjectionDraftPayload,
  subscriptionFieldNames: readonly string[]
): SyntheticItemUpdate {
  const fields: Record<string, string | number | boolean | null> = { ...draft.fields };
  if (draft.command !== null) {
    fields.command = draft.command;
  }
  if (draft.key !== null) {
    fields.key = draft.key;
  }
  const changedFields = { ...draft.changedFields };
  const fieldNames = orderedSyntheticFieldNames(
    subscriptionFieldNames,
    Object.keys(fields),
    Object.keys(changedFields)
  );
  const fieldPositions = new Map(fieldNames.map((fieldName, index) => [fieldName, index + 1]));
  const fieldEntries = fieldNames
    .filter((fieldName) => Object.prototype.hasOwnProperty.call(fields, fieldName))
    .map((fieldName) => [fieldName, fields[fieldName]] as const);
  const changedFieldEntries = fieldNames
    .filter((fieldName) => Object.prototype.hasOwnProperty.call(changedFields, fieldName))
    .map((fieldName) => [fieldName, changedFields[fieldName]] as const);

  return {
    forEachField(iterator) {
      fieldEntries.forEach(([fieldName, value]) => {
        iterator(fieldName, fieldPositions.get(fieldName) ?? 0, value);
      });
    },
    forEachChangedField(iterator) {
      changedFieldEntries.forEach(([fieldName, value]) => {
        iterator(fieldName, fieldPositions.get(fieldName) ?? 0, value);
      });
    },
    getItemName() {
      return draft.item.name ?? null;
    },
    getItemPos() {
      return draft.item.position ?? null;
    },
    getValue(fieldNameOrPos) {
      const fieldName = resolveSyntheticFieldName(fieldNameOrPos, fieldNames);
      if (!fieldName) {
        return null;
      }
      return Object.prototype.hasOwnProperty.call(fields, fieldName) ? fields[fieldName] : null;
    },
    getValueAsJSONPatchIfAvailable() {
      return null;
    },
    isSnapshot() {
      return draft.isSnapshot;
    },
    isValueChanged(fieldNameOrPos) {
      const fieldName = resolveSyntheticFieldName(fieldNameOrPos, fieldNames);
      if (!fieldName) {
        return false;
      }
      return Object.prototype.hasOwnProperty.call(changedFields, fieldName);
    }
  };
}

function orderedSyntheticFieldNames(...groups: readonly (readonly string[])[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const fieldName of group) {
      if (!seen.has(fieldName)) {
        seen.add(fieldName);
        names.push(fieldName);
      }
    }
  }
  return names;
}

function resolveSyntheticFieldName(
  fieldNameOrPos: SyntheticFieldSelector,
  fieldNames: readonly string[]
): string | null {
  if (typeof fieldNameOrPos === "string") {
    return fieldNameOrPos;
  }
  if (!Number.isInteger(fieldNameOrPos) || fieldNameOrPos < 1) {
    return null;
  }
  return fieldNames[fieldNameOrPos - 1] ?? null;
}

function targetKey(subscriptionId: string, listenerId: string): string {
  return `${subscriptionId}:${listenerId}`;
}

function wrapMethod<T extends MethodOwner>(
  target: T,
  name: string,
  after: (target: T, args: unknown[], result: unknown) => void
): void {
  const original = target[name];
  if (typeof original !== "function") {
    return;
  }

  (target as MethodOwner)[name] = function wrappedMethod(this: T, ...args: unknown[]) {
    const result = original.apply(this, args);
    try {
      after(this, args, result);
    } catch (_error) {
      // Capture is best-effort and cannot replace a page-owned return value.
    }
    return result;
  };
}

function wrapCallback(
  listener: LightstreamerListenerLike,
  name: string,
  before: (args: unknown[]) => void
): void {
  const original = listener[name];
  if (typeof original !== "function") {
    return;
  }

  listener[name] = function wrappedCallback(this: LightstreamerListenerLike, ...args: unknown[]) {
    try {
      before(args);
    } catch (_error) {
      // Capture is best-effort and cannot suppress a page-owned callback.
    }
    return original.apply(this, args);
  };
}

function callbackToKind(callback: string): CaptureKind | null {
  switch (callback) {
    case "onEndOfSnapshot":
      return "end-of-snapshot";
    case "onItemLostUpdates":
      return "lost-updates";
    case "onCommandSecondLevelItemLostUpdates":
      return "item-update";
    case "onClearSnapshot":
      return "clear-snapshot";
    case "onItemUpdate":
      return "item-update";
    case "onRealMaxFrequency":
      return "subscription-frequency";
    case "onSubscription":
      return "subscription-started";
    case "onUnsubscription":
      return "subscription-ended";
    case "onSubscriptionError":
      return "subscription-error";
    case "onCommandSecondLevelSubscriptionError":
      return "item-update";
    default:
      return null;
  }
}

function readSubscriptionCallbackPayload(
  callback: (typeof CALLBACKS_TO_CAPTURE)[number],
  args: readonly unknown[]
): CapturePayload {
  if (callback === "onCommandSecondLevelItemLostUpdates") {
    return {
      update: compactJsonObject({ lostUpdates: toJsonValue(args[0]) })
    };
  }
  if (
    callback === "onEndOfSnapshot" ||
    callback === "onItemLostUpdates" ||
    callback === "onClearSnapshot"
  ) {
    return compactJsonObject({
      item: compactJsonObject({
        name: toJsonValue(args[0]),
        position: toJsonValue(args[1])
      }),
      update:
        callback === "onItemLostUpdates"
          ? compactJsonObject({ lostUpdates: toJsonValue(args[2]) })
          : undefined
    });
  }
  return {};
}

function readSubscriptionClient(subscription: object, state: InstrumentationState): CapturePayload | undefined {
  const client = state.subscriptionClients.get(subscription);
  return client ? clientPayload(client, state) : undefined;
}

function clientPayload(client: object, state: InstrumentationState): CapturePayload {
  const metadata = readClientMetadata(
    client as LightstreamerClientLike,
    state.clientMetadata.get(client) ?? { id: state.clientIds.getId(client) },
    state
  );
  state.clientMetadata.set(client, metadata);
  return metadata;
}

function readItemUpdatePayload(update: unknown): CapturePayload {
  if (!isObject(update)) {
    return {
      item: {},
      update: {},
      raw: {
        extractionErrors: ["ItemUpdate callback argument was not an object"]
      }
    };
  }

  const extractionErrors: string[] = [];
  const fields = readUpdateFields(update, "forEachField", extractionErrors);
  const changedFields = readUpdateFields(update, "forEachChangedField", extractionErrors);
  const jsonPatches = readJsonPatches(update, fields, changedFields, extractionErrors);
  const command = asNullableString(fields.command ?? changedFields.command);
  const key = asNullableString(fields.key ?? changedFields.key);

  return {
    item: compactJsonObject({
      name: readUpdateGetter(update, "getItemName", extractionErrors),
      position: readUpdateGetter(update, "getItemPos", extractionErrors)
    }),
    update: compactJsonObject({
      isSnapshot: readUpdateGetter(update, "isSnapshot", extractionErrors),
      fields,
      changedFields,
      jsonPatches,
      command,
      key
    }),
    raw: compactJsonObject({
      extractionErrors: extractionErrors.slice(0, 8),
      fieldCount: Object.keys(fields).length,
      changedFieldCount: Object.keys(changedFields).length
    })
  };
}

function readUpdateFields(
  update: Record<string, unknown>,
  methodName: "forEachField" | "forEachChangedField",
  extractionErrors: string[]
): CapturePayload {
  const fields: CapturePayload = {};
  const iterator = update[methodName];
  if (typeof iterator !== "function") {
    return fields;
  }

  try {
    iterator.call(update, (...args: unknown[]) => {
      const fieldName = args[0];
      const value = args.length >= 3 ? args[2] : args[1];
      if (fieldName !== undefined && fieldName !== null) {
        fields[String(fieldName)] = toJsonValue(value);
      }
    });
  } catch (error) {
    extractionErrors.push(`${methodName}:capture-failed`);
  }

  return fields;
}

function readJsonPatches(
  update: Record<string, unknown>,
  fields: CapturePayload,
  changedFields: CapturePayload,
  extractionErrors: string[]
): CapturePayload {
  const patches: CapturePayload = {};
  const getter = update.getValueAsJSONPatchIfAvailable;
  if (typeof getter !== "function") {
    return patches;
  }

  for (const fieldName of new Set([...Object.keys(fields), ...Object.keys(changedFields)])) {
    try {
      const patch = getter.call(update, fieldName);
      if (patch !== null && patch !== undefined) {
        patches[fieldName] = toJsonValue(patch);
      }
    } catch (_error) {
      extractionErrors.push(
        `getValueAsJSONPatchIfAvailable:${fieldName}:capture-failed`
      );
    }
  }

  return patches;
}

function readUpdateGetter(
  update: Record<string, unknown>,
  methodName: "getItemName" | "getItemPos" | "isSnapshot",
  extractionErrors: string[]
) {
  const getter = update[methodName];
  if (typeof getter !== "function") {
    return undefined;
  }

  try {
    return toJsonValue(getter.call(update));
  } catch (_error) {
    extractionErrors.push(`${methodName}:capture-failed`);
    return undefined;
  }
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function readSubscriptionMetadata(
  subscription: LightstreamerSubscriptionLike,
  constructorArgs: unknown[] = [],
  metadataErrors?: string[]
): CapturePayload {
  const itemDescriptor = constructorArgs[1];
  const fieldDescriptor = constructorArgs[2];
  return compactJsonObject({
    mode: readGetter(subscription, "getMode", metadataErrors) ?? toJsonValue(constructorArgs[0]),
    items:
      readGetter(subscription, "getItems", metadataErrors) ??
      (Array.isArray(itemDescriptor) ? toJsonValue(itemDescriptor) : undefined),
    itemGroup:
      readGetter(subscription, "getItemGroup", metadataErrors) ??
      (typeof itemDescriptor === "string" ? itemDescriptor : undefined),
    fields:
      readGetter(subscription, "getFields", metadataErrors) ??
      (Array.isArray(fieldDescriptor) ? toJsonValue(fieldDescriptor) : undefined),
    fieldSchema:
      readGetter(subscription, "getFieldSchema", metadataErrors) ??
      (typeof fieldDescriptor === "string" ? fieldDescriptor : undefined),
    dataAdapter: readGetter(subscription, "getDataAdapter", metadataErrors),
    selector: readGetter(subscription, "getSelector", metadataErrors),
    requestedSnapshot: readGetter(subscription, "getRequestedSnapshot", metadataErrors),
    requestedBufferSize: readGetter(subscription, "getRequestedBufferSize", metadataErrors),
    requestedMaxFrequency: readGetter(
      subscription,
      "getRequestedMaxFrequency",
      metadataErrors
    ),
    active: readGetter(subscription, "isActive", metadataErrors),
    subscribed: readGetter(subscription, "isSubscribed", metadataErrors),
    listenerCount: readListenerCount(subscription, metadataErrors),
    commandSecondLevelDataAdapter: readGetter(
      subscription,
      "getCommandSecondLevelDataAdapter",
      metadataErrors
    ),
    commandSecondLevelFields: readGetter(
      subscription,
      "getCommandSecondLevelFields",
      metadataErrors
    ),
    commandSecondLevelFieldSchema: readGetter(
      subscription,
      "getCommandSecondLevelFieldSchema",
      metadataErrors
    ),
    keyPosition: readGetter(subscription, "getKeyPosition", metadataErrors),
    commandPosition: readGetter(subscription, "getCommandPosition", metadataErrors)
  });
}

function readClientMetadata(
  client: LightstreamerClientLike,
  baseline: CapturePayload,
  state?: InstrumentationState
): CapturePayload {
  const getters: Record<string, "available" | "missing" | "threw"> = {};
  const detailsSurface = readClientSurface(client, "connectionDetails");
  const optionsSurface = readClientSurface(client, "connectionOptions");
  const detail = (name: string) => readTopologyGetter(
    detailsSurface.value,
    name,
    `ConnectionDetails.${name}`,
    getters,
    detailsSurface.threw
  );
  const option = (name: string) => readTopologyGetter(
    optionsSurface.value,
    name,
    `ConnectionOptions.${name}`,
    getters,
    optionsSurface.threw
  );
  const status = readTopologyGetter(
    client,
    "getStatus",
    "LightstreamerClient.getStatus",
    getters,
    false
  );
  const clientIp = detail("getClientIp");

  const metadata = compactJsonObject({
    ...baseline,
    status,
    serverAddress: detail("getServerAddress") ?? baseline.serverAddress,
    adapterSet: detail("getAdapterSet") ?? baseline.adapterSet,
    sessionId: detail("getSessionId"),
    serverInstanceAddress: detail("getServerInstanceAddress"),
    serverSocketName: detail("getServerSocketName"),
    clientIp: toJsonValue(clientIp),
    transport: transportFromStatus(status),
    requestedMaxBandwidth: option("getRequestedMaxBandwidth"),
    realMaxBandwidth: option("getRealMaxBandwidth"),
    keepaliveInterval: option("getKeepaliveInterval"),
    retryDelay: option("getRetryDelay"),
    firstRetryMaxDelay: option("getFirstRetryMaxDelay"),
    stalledTimeout: option("getStalledTimeout"),
    reconnectTimeout: option("getReconnectTimeout"),
    sessionRecoveryTimeout: option("getSessionRecoveryTimeout"),
    forcedTransport: option("getForcedTransport"),
    reverseHeartbeatInterval: option("getReverseHeartbeatInterval"),
    pollingInterval: option("getPollingInterval"),
    idleTimeout: option("getIdleTimeout")
  });
  const clientId = nonEmptyString(metadata.id);
  if (state && clientId) {
    const statuses = Object.values(getters);
    const threw = statuses.includes("threw");
    const missing = statuses.includes("missing");
    const coverage: TopologyCoverage = {
      status: threw || missing ? "partial" : "complete",
      getters,
      ...(threw
        ? { reason: "getter-threw" as const }
        : missing
          ? { reason: "getter-missing" as const }
          : {})
    };
    state.clientTopologyCoverages.set(
      clientId,
      mergeTopologyCoverage(
        state.clientTopologyCoverages.get(clientId) ?? { status: "complete", getters: {} },
        coverage
      )
    );
  }
  return metadata;
}

function readClientSurface(
  client: LightstreamerClientLike,
  property: "connectionDetails" | "connectionOptions"
): { value: object | null; threw: boolean } {
  try {
    const value = client[property];
    return { value: isObject(value) ? value : null, threw: false };
  } catch (_error) {
    return { value: null, threw: true };
  }
}

function readTopologyGetter(
  target: object | null,
  name: string,
  coverageKey: string,
  coverage: Record<string, "available" | "missing" | "threw">,
  surfaceThrew: boolean
): CapturePayload[string] | undefined {
  if (surfaceThrew) {
    coverage[coverageKey] = "threw";
    return undefined;
  }
  if (!target) {
    coverage[coverageKey] = "missing";
    return undefined;
  }
  try {
    const getter = (target as Record<string, unknown>)[name];
    if (typeof getter !== "function") {
      coverage[coverageKey] = "missing";
      return undefined;
    }
    const value = toJsonValue(getter.call(target));
    coverage[coverageKey] = "available";
    return value;
  } catch (_error) {
    coverage[coverageKey] = "threw";
    return undefined;
  }
}

function readListenerCount(
  subscription: LightstreamerSubscriptionLike,
  metadataErrors?: string[]
): number | undefined {
  const getter = subscription.getListeners;
  if (typeof getter !== "function") {
    return undefined;
  }
  try {
    const listeners = getter.call(subscription);
    return Array.isArray(listeners) ? listeners.length : undefined;
  } catch (_error) {
    metadataErrors?.push(
      "getListeners:capture-failed"
    );
    return undefined;
  }
}

function readConstructorString(constructor: object, property: string): string | undefined {
  const value = (constructor as Record<string, unknown>)[property];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function transportFromStatus(status: CapturePayload[string] | undefined): string | undefined {
  if (typeof status !== "string") {
    return undefined;
  }
  const separator = status.indexOf(":");
  if (separator < 0) {
    return undefined;
  }
  const transport = status.slice(separator + 1).toLowerCase();
  return transport || undefined;
}

function readGetter(target: object, name: string, extractionErrors?: string[]) {
  try {
    const getter = (target as Record<string, unknown>)[name];
    if (typeof getter !== "function") {
      return undefined;
    }
    return toJsonValue(getter.call(target));
  } catch (_error) {
    extractionErrors?.push(`${name}:capture-failed`);
    return undefined;
  }
}

function toJsonValue(value: unknown): CapturePayload[string] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }

  if (isObject(value)) {
    return compactJsonObject(value);
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null;
  }

  return String(value);
}

function captureObject(value: CapturePayload[string] | undefined): CapturePayload | null {
  return isObject(value) && !Array.isArray(value) ? (value as CapturePayload) : null;
}

function compactJsonObject(source: Record<string, unknown>): CapturePayload {
  const result: CapturePayload = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      result[key] = toJsonValue(value);
    }
  }
  return result;
}

function sanitizeCapturePayload(payload: CapturePayload): CapturePayload {
  return sanitizeCaptureObject(payload);
}

function sanitizeCaptureObject(source: CapturePayload): CapturePayload {
  const sanitized: CapturePayload = {};
  for (const [key, value] of Object.entries(source)) {
    if (isSensitiveCaptureKey(key) || key === "reason" || key === "error") {
      sanitized[key] = value === null ? null : "[redacted]";
      continue;
    }
    if (key === "clientIp") {
      sanitized[key] =
        typeof value === "string" ? maskClientIp(value) ?? "[redacted]" : null;
      continue;
    }
    if (
      (key === "serverAddress" || key === "serverInstanceAddress" || key === "url") &&
      typeof value === "string"
    ) {
      sanitized[key] = sanitizeServerUrl(value);
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value.map(sanitizeCaptureValue);
      continue;
    }
    sanitized[key] =
      isObject(value) && !Array.isArray(value)
        ? sanitizeCaptureObject(value as CapturePayload)
        : value;
  }
  return sanitized;
}

function sanitizeCaptureValue(value: CapturePayload[string]): CapturePayload[string] {
  if (Array.isArray(value)) {
    return value.map(sanitizeCaptureValue);
  }
  return isObject(value) ? sanitizeCaptureObject(value as CapturePayload) : value;
}

function isSensitiveCaptureKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized === "password" ||
    normalized === "cookie" ||
    normalized === "setcookie" ||
    normalized === "token" ||
    normalized === "accesstoken" ||
    normalized === "refreshtoken" ||
    normalized === "idtoken" ||
    normalized === "headers" ||
    normalized === "httpextraheaders" ||
    normalized.endsWith("password") ||
    normalized.endsWith("token")
  );
}

function sanitizeServerUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.hostname) {
      return "[redacted]";
    }
    const authority = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    return `${parsed.protocol}//${authority}${parsed.pathname || "/"}`;
  } catch (_error) {
    return "[redacted]";
  }
}

function maskClientIp(value: string): string | null {
  const normalized = value.trim().replace(/^\[|\]$/g, "");
  const ipv4 = parseIpv4(normalized);
  if (ipv4) {
    return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.0/24`;
  }

  const hextets = parseIpv6(normalized);
  if (!hextets) {
    return null;
  }
  if (
    hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff
  ) {
    return `${hextets[6] >> 8}.${hextets[6] & 0xff}.${hextets[7] >> 8}.0/24`;
  }
  return `${hextets[0].toString(16)}:${hextets[1].toString(16)}:${hextets[2].toString(
    16
  )}:0:0:0:0:0/48`;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets as [number, number, number, number];
}

function parseIpv6(value: string): number[] | null {
  if (!value || value.includes("%") || value.split("::").length > 2) {
    return null;
  }
  const [leftText, rightText] = value.toLowerCase().split("::");
  const left = parseIpv6Side(leftText ?? "");
  const right = parseIpv6Side(rightText ?? "");
  if (!left || !right) {
    return null;
  }
  if (!value.includes("::")) {
    return left.length === 8 ? left : null;
  }
  const zeroCount = 8 - left.length - right.length;
  return zeroCount > 0 ? [...left, ...Array<number>(zeroCount).fill(0), ...right] : null;
}

function parseIpv6Side(value: string): number[] | null {
  if (!value) {
    return [];
  }
  const parts = value.split(":");
  const hextets: number[] = [];
  for (const [index, part] of parts.entries()) {
    const ipv4 = parseIpv4(part);
    if (ipv4) {
      if (index !== parts.length - 1) {
        return null;
      }
      hextets.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }
    hextets.push(Number.parseInt(part, 16));
  }
  return hextets;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (typeof window !== "undefined") {
  installLightstreamerInstrumentation(window);
}
