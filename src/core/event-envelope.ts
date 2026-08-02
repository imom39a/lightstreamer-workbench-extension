import {
  type CaptureKind,
  type JsonObject,
  type TopologyCoverageReason,
  type TopologyObservation
} from "../bridge/messages";

export type EventDirection = "inbound" | "outbound";
export type EventSource = "server" | "synthetic";
export type EventCaptureSource = "listener" | "wire";

export type EventSemanticValueState = {
  state:
    | "requested"
    | "real"
    | "inferred"
    | "unknown"
    | "unavailable"
    | "redacted"
    | "not-applicable";
  reason?: TopologyCoverageReason;
  context?: string;
};

export type EventClient = {
  id: string;
  status?: string;
  serverAddress?: string | null;
  adapterSet?: string | null;
  libraryVersion?: string | null;
  instrumentationSource?: string | null;
  coverageStatus?: string | null;
  sessionId?: string | null;
  serverInstanceAddress?: string | null;
  serverSocketName?: string | null;
  clientIp?: string | null;
  transport?: string | null;
  requestedMaxBandwidth?: string | number | null;
  realMaxBandwidth?: string | number | null;
  keepaliveInterval?: number | null;
  reverseHeartbeatInterval?: number | null;
  pollingInterval?: number | null;
  idleTimeout?: number | null;
  retryDelay?: number | null;
  firstRetryMaxDelay?: number | null;
  stalledTimeout?: number | null;
  reconnectTimeout?: number | null;
  sessionRecoveryTimeout?: number | null;
  forcedTransport?: string | null;
  semanticValueStates?: Record<string, EventSemanticValueState>;
};

export type EventSubscription = {
  id: string;
  mode?: string | null;
  items?: string[];
  itemGroup?: string | null;
  fields?: string[];
  fieldSchema?: string | null;
  dataAdapter?: string | null;
  selector?: string | null;
  requestedSnapshot?: string | boolean | null;
  requestedBufferSize?: string | number | null;
  requestedMaxFrequency?: string | number | null;
  realMaxFrequency?: string | number | null;
  active?: boolean;
  subscribed?: boolean;
  listenerCount?: number | null;
  commandSecondLevelDataAdapter?: string | null;
  commandSecondLevelFields?: string[];
  commandSecondLevelFieldSchema?: string | null;
  keyPosition?: number | string | null;
  commandPosition?: number | string | null;
  semanticValueStates?: Record<string, EventSemanticValueState>;
};

export type EventListener = {
  id: string;
  callbacks?: string[];
  registrationCount?: number;
  metricOwner?: boolean;
};

export type EventItem = {
  name?: string | null;
  position?: number | null;
};

export type EventUpdate = {
  isSnapshot?: boolean;
  fields?: Record<string, string | number | boolean | null>;
  changedFields?: Record<string, string | number | boolean | null>;
  jsonPatches?: Record<string, unknown>;
  command?: string | null;
  key?: string | null;
  lostUpdates?: number | null;
};

export type EventErrorScope = "client" | "subscription" | "second-level";

export type EventError = {
  scope: EventErrorScope;
  code?: number | null;
  message?: string | null;
  key?: string | null;
};

export type EventDiagnostic = {
  code: string;
  scope: EventErrorScope;
  severity: "error" | "warning";
  title: string;
  explanation: string;
  suggestion: string;
  serverMessage?: string | null;
};

export type LightstreamerEventEnvelope = {
  id: string;
  timestamp: number;
  direction: EventDirection;
  source: EventSource;
  captureSource?: EventCaptureSource;
  synthetic: boolean;
  kind: CaptureKind;
  logicalEventId?: string;
  client?: EventClient;
  subscription?: EventSubscription;
  listener?: EventListener;
  item?: EventItem;
  update?: EventUpdate;
  error?: EventError;
  diagnostics?: EventDiagnostic[];
  raw?: JsonObject;
  /** Ephemeral semantic evidence for topology reconstruction; never persisted. */
  topology?: TopologyObservation;
};

export type PersistableLightstreamerEventEnvelope = Omit<
  LightstreamerEventEnvelope,
  "topology" | "client" | "subscription"
> & {
  client?: Omit<EventClient, "semanticValueStates">;
  subscription?: Omit<EventSubscription, "semanticValueStates">;
};

/** Removes all ephemeral semantic evidence before an event crosses a persistence boundary. */
export function toPersistableEventEnvelope(
  event: LightstreamerEventEnvelope
): PersistableLightstreamerEventEnvelope {
  const {
    topology: _topology,
    client,
    subscription,
    ...persistable
  } = event;
  const { semanticValueStates: _clientSemanticValueStates, ...persistableClient } = client ?? {};
  const {
    semanticValueStates: _subscriptionSemanticValueStates,
    ...persistableSubscription
  } = subscription ?? {};
  return {
    ...persistable,
    ...(client ? { client: persistableClient as Omit<EventClient, "semanticValueStates"> } : {}),
    ...(subscription
      ? {
          subscription: persistableSubscription as Omit<
            EventSubscription,
            "semanticValueStates"
          >
        }
      : {})
  };
}
