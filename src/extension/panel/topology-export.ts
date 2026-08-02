import {
  type TopologyClient,
  type TopologyCommandGeneration,
  type TopologyItem,
  type TopologyListener,
  type TopologySession,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";
import { type TopologyProjectionStatus } from "./topology-projection";

export const TOPOLOGY_SNAPSHOT_SCHEMA =
  "https://lightstreamer.com/workbench/topology-snapshot/v1";
export const TOPOLOGY_SNAPSHOT_VERSION = 1;
export const DEFAULT_TOPOLOGY_EVIDENCE_LIMIT = 25;

export type TopologySensitiveCategory =
  | "server-addresses"
  | "client-ips"
  | "item-names"
  | "command-keys"
  | "field-names"
  | "identifiers";

export const TOPOLOGY_SENSITIVE_CATEGORIES: readonly TopologySensitiveCategory[] = [
  "server-addresses",
  "client-ips",
  "item-names",
  "command-keys",
  "field-names",
  "identifiers"
];

export type TopologySnapshotOptions = {
  generatedAt?: number;
  retainedEventCount?: number;
  completeEvidence?: boolean;
  evidenceLimit?: number;
  redact?: Iterable<TopologySensitiveCategory>;
};

export type BoundedCollection<T> = {
  total: number;
  includedCount: number;
  omittedCount: number;
  truncated: boolean;
  samplingStrategy: "complete" | "latest";
  entries: T[];
};

export type TopologySnapshotItem = {
  id: string | null;
  name: string | null;
  position: number | null;
  resolution: string;
  snapshotPhase: string;
  metrics: Record<string, unknown>;
  listenerIds: Array<string | null>;
};

export type TopologySnapshotListener = {
  id: string | null;
  attachmentIds: Array<string | null>;
  callbacks: string[];
  registrationCount: number;
  active: boolean;
  metricOwner: boolean;
  deliveryCount: number;
  firstDeliveryAt: string | null;
  lastDeliveryAt: string | null;
};

export type TopologySnapshotSubscription = {
  id: string | null;
  clientId: string | null;
  lastSessionId: string | null;
  lifecycle: Record<string, unknown>;
  configuration: Record<string, unknown>;
  metrics: Record<string, unknown>;
  semanticLifecycle: {
    establishments: BoundedCollection<Record<string, unknown>>;
    commandGenerations: BoundedCollection<Record<string, unknown>>;
  };
  items: TopologySnapshotItem[];
  listeners: TopologySnapshotListener[];
};

export type TopologySnapshotSession = {
  key: string | null;
  id: string | null;
  active: boolean;
  historical: boolean;
  status: string | null;
  normalizedStatus: string;
  runtime: Record<string, unknown>;
  metrics: Record<string, unknown>;
  subscriptions: TopologySnapshotSubscription[];
};

export type TopologySnapshotClient = {
  id: string | null;
  libraryVersion: string | null;
  instrumentationSource: string | null;
  coverageStatus: string | null;
  runtime: Record<string, unknown>;
  metrics: Record<string, unknown>;
  sessions: TopologySnapshotSession[];
  waitingSubscriptions: TopologySnapshotSubscription[];
};

export type TopologyStructuredSnapshot = {
  schema: { id: string; version: number };
  generatedAt: string;
  privacy: {
    redactedCategories: TopologySensitiveCategory[];
    completeEvidenceIncluded: boolean;
    credentialsExcluded: true;
  };
  capture: {
    observingSince: string | null;
    retainedEventCount: number;
    semanticCapture: boolean;
    syncState: string;
    coverage: unknown;
  };
  overview: Omit<TopologyState, "clients" | "unassignedSubscriptions" | "observingSince">;
  clients: TopologySnapshotClient[];
  unassignedSubscriptions: TopologySnapshotSubscription[];
  diagnostics: Array<{
    severity: "info" | "warning";
    code: string;
    subject: string;
    message: string;
  }>;
};

type SnapshotContext = {
  redacted: Set<TopologySensitiveCategory>;
  completeEvidence: boolean;
  evidenceLimit: number;
};

export function createTopologyStructuredSnapshot(
  state: TopologyState,
  status: TopologyProjectionStatus,
  options: TopologySnapshotOptions = {}
): TopologyStructuredSnapshot {
  const redacted = new Set(options.redact ?? TOPOLOGY_SENSITIVE_CATEGORIES);
  const context: SnapshotContext = {
    redacted,
    completeEvidence: Boolean(options.completeEvidence),
    evidenceLimit: Math.max(
      0,
      Math.floor(options.evidenceLimit ?? DEFAULT_TOPOLOGY_EVIDENCE_LIMIT)
    )
  };
  const generatedAt = options.generatedAt ?? Date.now();

  const snapshot: TopologyStructuredSnapshot = {
    schema: { id: TOPOLOGY_SNAPSHOT_SCHEMA, version: TOPOLOGY_SNAPSHOT_VERSION },
    generatedAt: new Date(generatedAt).toISOString(),
    privacy: {
      redactedCategories: TOPOLOGY_SENSITIVE_CATEGORIES.filter((category) =>
        redacted.has(category)
      ),
      completeEvidenceIncluded: context.completeEvidence,
      credentialsExcluded: true
    },
    capture: {
      observingSince: state.observingSince === null
        ? null
        : new Date(state.observingSince).toISOString(),
      retainedEventCount: Math.max(0, Math.floor(options.retainedEventCount ?? 0)),
      semanticCapture: status.semanticActive,
      syncState: status.syncState,
      coverage: cloneCredentialSafe(status.coverage)
    },
    overview: {
      clientCount: state.clientCount,
      activeSessionCount: state.activeSessionCount,
      historicalSessionCount: state.historicalSessionCount,
      subscriptionCount: state.subscriptionCount,
      activeSubscriptionCount: state.activeSubscriptionCount,
      serverEstablishedSubscriptionCount: state.serverEstablishedSubscriptionCount,
      itemCount: state.itemCount,
      listenerCount: state.listenerCount
    },
    clients: state.clients.map((client) => snapshotClient(client, context)),
    unassignedSubscriptions: state.unassignedSubscriptions.map((subscription) =>
      snapshotSubscription(subscription, context)
    ),
    diagnostics: topologyDiagnostics(state, context)
  };

  return cloneCredentialSafe(snapshot) as TopologyStructuredSnapshot;
}

export function serializeTopologySnapshot(snapshot: TopologyStructuredSnapshot): string {
  return JSON.stringify(sortObjectKeys(snapshot), null, 2);
}

export function topologySnapshotFilename(
  snapshot: TopologyStructuredSnapshot,
  extension: "json" | "html"
): string {
  const context = topologySnapshotFilenameContext(snapshot);
  const generatedAt = compactFilenameTimestamp(snapshot.generatedAt);
  return `lightstreamer-topology-${context}-${generatedAt}.${extension}`;
}

function topologySnapshotFilenameContext(snapshot: TopologyStructuredSnapshot): string {
  if (!snapshot.privacy.redactedCategories.includes("identifiers")) {
    const activeSessions = snapshot.clients.flatMap((client) =>
      client.sessions.filter((session) => session.active && !session.historical)
    );
    if (activeSessions.length === 1) {
      const sessionId = safeFilenamePart(activeSessions[0]?.id);
      if (sessionId) {
        return sessionId.toLowerCase().startsWith("session-")
          ? sessionId
          : `session-${sessionId}`;
      }
    }

    if (snapshot.clients.length === 1) {
      const clientId = safeFilenamePart(snapshot.clients[0]?.id);
      if (clientId) {
        return clientId.toLowerCase().startsWith("client-")
          ? clientId
          : `client-${clientId}`;
      }
    }
  }

  const clientCount = snapshot.overview.clientCount;
  const sessionCount = snapshot.overview.activeSessionCount;
  const clients = `${clientCount}-${clientCount === 1 ? "client" : "clients"}`;
  const sessions = `${sessionCount}-${sessionCount === 1 ? "session" : "sessions"}`;
  return `${clients}-${sessions}`;
}

function safeFilenamePart(value: string | null | undefined): string | null {
  if (!value || value.startsWith("[REDACTED:")) return null;
  const sanitized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64)
    .replace(/[._-]+$/g, "");
  return sanitized || null;
}

function compactFilenameTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "unknown-time";
  return timestamp.toISOString().replace(/[-:.]/g, "");
}

export function topologySensitiveCategoryCounts(
  state: TopologyState
): Record<TopologySensitiveCategory, number> {
  const subscriptions = allSubscriptions(state);
  return {
    "server-addresses": state.clients.reduce(
      (total, client) =>
        total + Number(Boolean(client.serverAddress)) +
        client.sessions.reduce(
          (sessionTotal, session) =>
            sessionTotal + Number(Boolean(session.serverInstanceAddress)),
          0
        ),
      0
    ),
    "client-ips": state.clients.reduce(
      (total, client) =>
        total + client.sessions.reduce(
          (sessionTotal, session) => sessionTotal + Number(Boolean(session.clientIp)),
          0
        ),
      0
    ),
    "item-names": subscriptions.reduce(
      (total, subscription) =>
        total + subscription.items.filter(({ name }) => Boolean(name)).length,
      0
    ),
    "command-keys": subscriptions.reduce(
      (total, subscription) =>
        total + subscription.commandGenerations.filter(({ key }) => Boolean(key)).length,
      0
    ),
    "field-names": subscriptions.reduce(
      (total, subscription) =>
        total + (subscription.fields?.length ?? 0) +
        (subscription.commandSecondLevelFields?.length ?? 0) +
        Number(Boolean(subscription.fieldSchema)) +
        Number(Boolean(subscription.commandSecondLevelFieldSchema)),
      0
    ),
    identifiers:
      state.clients.length +
      state.clients.reduce(
        (total, client) =>
          total + client.sessions.length + client.clientListenerIds.length,
        0
      ) +
      subscriptions.length +
      subscriptions.reduce(
        (total, subscription) =>
          total + subscription.listeners.length + subscription.commandGenerations.length,
        0
      )
  };
}

function snapshotClient(
  client: TopologyClient,
  context: SnapshotContext
): TopologySnapshotClient {
  return {
    id: sensitive(client.id, "identifiers", context),
    libraryVersion: client.libraryVersion ?? null,
    instrumentationSource: client.instrumentationSource ?? null,
    coverageStatus: client.coverageStatus ?? null,
    runtime: {
      status: client.status ?? null,
      normalizedStatus: client.normalizedStatus,
      transport: client.transport ?? null,
      serverAddress: sensitive(
        credentialSafeUrl(client.serverAddress ?? null),
        "server-addresses",
        context
      ),
      adapterSet: sensitive(client.adapterSet ?? null, "identifiers", context),
      requestedMaxBandwidth: client.requestedMaxBandwidth ?? null,
      realMaxBandwidth: client.realMaxBandwidth ?? null,
      keepaliveInterval: client.keepaliveInterval ?? null,
      reverseHeartbeatInterval: client.reverseHeartbeatInterval ?? null,
      pollingInterval: client.pollingInterval ?? null,
      idleTimeout: client.idleTimeout ?? null,
      retryDelay: client.retryDelay ?? null,
      stalledTimeout: client.stalledTimeout ?? null,
      reconnectTimeout: client.reconnectTimeout ?? null,
      sessionRecoveryTimeout: client.sessionRecoveryTimeout ?? null,
      forcedTransport: client.forcedTransport ?? null
    },
    metrics: {
      firstSeenAt: isoTime(client.firstSeenAt),
      lastSeenAt: isoTime(client.lastSeenAt),
      clientListenerCount: client.clientListenerIds.length
    },
    sessions: client.sessions.map((session) => snapshotSession(session, context)),
    waitingSubscriptions: client.waitingSubscriptions.map((subscription) =>
      snapshotSubscription(subscription, context)
    )
  };
}

function snapshotSession(
  session: TopologySession,
  context: SnapshotContext
): TopologySnapshotSession {
  return {
    key: sensitive(session.key, "identifiers", context),
    id: sensitive(session.id, "identifiers", context),
    active: session.active,
    historical: session.historical,
    status: session.status,
    normalizedStatus: session.normalizedStatus,
    runtime: {
      transport: session.transport,
      serverInstanceAddress: sensitive(
        credentialSafeUrl(session.serverInstanceAddress),
        "server-addresses",
        context
      ),
      serverSocketName: sensitive(session.serverSocketName, "identifiers", context),
      clientIp: sensitive(session.clientIp, "client-ips", context)
    },
    metrics: {
      firstSeenAt: isoTime(session.firstSeenAt),
      lastSeenAt: isoTime(session.lastSeenAt),
      endedAt: isoTime(session.endedAt),
      observingSince: isoTime(session.observingSince),
      connectionEpochCount: session.connectionEpochCount,
      recoveryCount: session.recoveryCount
    },
    subscriptions: session.subscriptions.map((subscription) =>
      snapshotSubscription(subscription, context)
    )
  };
}

function snapshotSubscription(
  subscription: TopologySubscription,
  context: SnapshotContext
): TopologySnapshotSubscription {
  return {
    id: sensitive(subscription.id, "identifiers", context),
    clientId: sensitive(subscription.clientId, "identifiers", context),
    lastSessionId: sensitive(subscription.lastSessionId, "identifiers", context),
    lifecycle: {
      active: subscription.active,
      serverEstablished: subscription.serverEstablished,
      statusLabel: subscription.statusLabel,
      pendingSince: isoTime(subscription.pendingSince),
      waitingForSession: subscription.waitingForSession,
      createdAt: isoTime(subscription.createdAt),
      startedAt: isoTime(subscription.startedAt),
      endedAt: isoTime(subscription.endedAt),
      historical: subscription.historical,
      captureSource: subscription.captureSource
    },
    configuration: {
      mode: subscription.mode ?? null,
      items: subscription.configuredItems?.map((item) =>
        sensitive(item, "item-names", context)
      ) ?? null,
      itemGroup: sensitive(subscription.itemGroup ?? null, "item-names", context),
      fields: safeFieldNames(subscription.fields, context),
      fieldSchema: safeFieldName(subscription.fieldSchema, context),
      dataAdapter: sensitive(subscription.dataAdapter ?? null, "identifiers", context),
      selector: sensitive(subscription.selector ?? null, "identifiers", context),
      requestedSnapshot: subscription.requestedSnapshot ?? null,
      requestedBufferSize: subscription.requestedBufferSize ?? null,
      requestedMaxFrequency: subscription.requestedMaxFrequency ?? null,
      realMaxFrequency: subscription.realMaxFrequency ?? null,
      commandSecondLevelDataAdapter: sensitive(
        subscription.commandSecondLevelDataAdapter ?? null,
        "identifiers",
        context
      ),
      commandSecondLevelFields: safeFieldNames(
        subscription.commandSecondLevelFields,
        context
      ),
      commandSecondLevelFieldSchema: safeFieldName(
        subscription.commandSecondLevelFieldSchema,
        context
      )
    },
    metrics: {
      listenerCount: subscription.listenerCount,
      resolvedItemCount: subscription.items.length,
      updateCount: subscription.updateCount,
      localInjectedUpdateCount: subscription.syntheticUpdateCount,
      deliveryCount: subscription.deliveryCount,
      lostUpdateCount: subscription.lostUpdateCount,
      errorCount: subscription.errorCount,
      firstUpdateAt: isoTime(subscription.firstUpdateAt),
      lastUpdateAt: isoTime(subscription.lastUpdateAt),
      lastLocalInjectedUpdateAt: isoTime(subscription.lastSyntheticUpdateAt),
      duplicateKind: subscription.duplicateKind,
      exactDuplicateCount: subscription.exactDuplicateCount,
      overlapCount: subscription.overlapCount
    },
    semanticLifecycle: {
      establishments: bounded(
        subscription.establishments.map((entry) => ({
          ...entry,
          id: sensitive(entry.id, "identifiers", context)
        })),
        context
      ),
      commandGenerations: bounded(
        subscription.commandGenerations.map((generation) =>
          snapshotGeneration(generation, context)
        ),
        context
      )
    },
    items: subscription.items.map((item) => snapshotItem(item, context)),
    listeners: subscription.listeners.map((listener) =>
      snapshotListener(listener, context)
    )
  };
}

function snapshotGeneration(
  generation: TopologyCommandGeneration,
  context: SnapshotContext
): Record<string, unknown> {
  return {
    id: sensitive(generation.id, "identifiers", context),
    itemId: sensitive(generation.itemId, "identifiers", context),
    key: sensitive(generation.key, "command-keys", context),
    command: generation.command,
    captureSequence: generation.captureSequence,
    inferredChildren: generation.inferredChildren.map((child) => ({
      id: sensitive(child.id, "identifiers", context),
      label: sensitive(child.label, "identifiers", context),
      key: sensitive(child.key, "command-keys", context),
      captureKind: child.captureKind,
      callback: child.callback,
      provenance: child.provenance,
      captureSequence: child.captureSequence
    }))
  };
}

function snapshotItem(
  item: TopologyItem,
  context: SnapshotContext
): TopologySnapshotItem {
  return {
    id: sensitive(item.id, "identifiers", context),
    name: sensitive(item.name, "item-names", context),
    position: item.position,
    resolution: item.resolution,
    snapshotPhase: item.snapshotPhase,
    metrics: {
      updateCount: item.updateCount,
      localInjectedUpdateCount: item.syntheticUpdateCount,
      deliveryCount: item.deliveryCount,
      lostUpdateCount: item.lostUpdateCount,
      activeCommandKeyCount: item.activeCommandKeyCount,
      deletedCommandKeyCount: item.deletedCommandKeyCount,
      firstUpdateAt: isoTime(item.firstUpdateAt),
      lastUpdateAt: isoTime(item.lastUpdateAt),
      lastLocalInjectedUpdateAt: isoTime(item.lastSyntheticUpdateAt),
      lastCommand: item.lastCommand
    },
    listenerIds: item.listenerIds.map((id) => sensitive(id, "identifiers", context))
  };
}

function snapshotListener(
  listener: TopologyListener,
  context: SnapshotContext
): TopologySnapshotListener {
  return {
    id: sensitive(listener.id, "identifiers", context),
    attachmentIds: listener.attachmentIds.map((id) =>
      sensitive(id, "identifiers", context)
    ),
    callbacks: [...listener.callbacks],
    registrationCount: listener.registrationCount,
    active: listener.active,
    metricOwner: listener.metricOwner,
    deliveryCount: listener.deliveryCount,
    firstDeliveryAt: isoTime(listener.firstDeliveryAt),
    lastDeliveryAt: isoTime(listener.lastDeliveryAt)
  };
}

function bounded<T>(entries: T[], context: SnapshotContext): BoundedCollection<T> {
  const included = context.completeEvidence
    ? entries
    : entries.slice(-context.evidenceLimit);
  return {
    total: entries.length,
    includedCount: included.length,
    omittedCount: entries.length - included.length,
    truncated: included.length < entries.length,
    samplingStrategy: context.completeEvidence ? "complete" : "latest",
    entries: included
  };
}

function topologyDiagnostics(
  state: TopologyState,
  context: SnapshotContext
): TopologyStructuredSnapshot["diagnostics"] {
  const diagnostics: TopologyStructuredSnapshot["diagnostics"] = [];
  for (const client of state.clients) {
    if (client.coverageStatus === "limited") {
      diagnostics.push({
        severity: "warning",
        code: "limited-coverage",
        subject: String(sensitive(client.id, "identifiers", context)),
        message: "Client topology is reconstructed from limited capture evidence."
      });
    }
  }
  for (const subscription of allSubscriptions(state)) {
    const subject = String(sensitive(subscription.id, "identifiers", context));
    if (subscription.lostUpdateCount > 0) {
      diagnostics.push({
        severity: "warning",
        code: "lost-updates",
        subject,
        message: `${subscription.lostUpdateCount} lost updates observed.`
      });
    }
    if (subscription.errorCount > 0) {
      diagnostics.push({
        severity: "warning",
        code: "subscription-errors",
        subject,
        message: `${subscription.errorCount} subscription errors observed.`
      });
    }
    if (subscription.duplicateKind !== "none") {
      diagnostics.push({
        severity: "info",
        code: `subscription-${subscription.duplicateKind}`,
        subject,
        message: `${subscription.duplicateCount} related active subscription copies observed.`
      });
    }
  }
  return diagnostics;
}

function allSubscriptions(state: TopologyState): TopologySubscription[] {
  return [
    ...state.clients.flatMap((client) => [
      ...client.waitingSubscriptions,
      ...client.sessions.flatMap((session) => session.subscriptions)
    ]),
    ...state.unassignedSubscriptions
  ];
}

function sensitive<T extends string | null>(
  value: T,
  category: TopologySensitiveCategory,
  context: SnapshotContext
): T | string {
  return value !== null && context.redacted.has(category)
    ? `[REDACTED:${category}]`
    : value;
}

function safeFieldNames(
  fields: readonly string[] | undefined,
  context: SnapshotContext
): string[] | null {
  return fields
    ? fields
        .filter((field) => !isCredentialKey(field))
        .map((field) => String(sensitive(field, "field-names", context)))
    : null;
}

function safeFieldName(
  field: string | null | undefined,
  context: SnapshotContext
): string | null {
  if (!field || isCredentialKey(field)) {
    return null;
  }
  return String(sensitive(field, "field-names", context));
}

function credentialSafeUrl(value: string | null): string | null {
  if (!value) return value;
  const scrubbed = scrubCredentialQuery(value).replace(
    /\/\/[^/@\s]+@/,
    "//[CREDENTIALS-REMOVED]@"
  );
  try {
    const parsed = new URL(scrubbed);
    parsed.username = "";
    parsed.password = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isCredentialKey(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return scrubbed;
  }
}

function scrubCredentialQuery(value: string): string {
  const questionMark = value.indexOf("?");
  if (questionMark < 0) return value;
  const hashMark = value.indexOf("#", questionMark);
  const base = value.slice(0, questionMark);
  const query = value.slice(questionMark + 1, hashMark < 0 ? undefined : hashMark);
  const hash = hashMark < 0 ? "" : value.slice(hashMark);
  const params = new URLSearchParams(query);
  for (const key of Array.from(params.keys())) {
    if (isCredentialKey(key)) params.delete(key);
  }
  const safeQuery = params.toString();
  return `${base}${safeQuery ? `?${safeQuery}` : ""}${hash}`;
}

function cloneCredentialSafe(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneCredentialSafe);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const clone: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isCredentialKey(key)) {
      clone[key] = cloneCredentialSafe(entry);
    }
  }
  return clone;
}

function isCredentialKey(key: string): boolean {
  if (key === "credentialsExcluded") {
    return false;
  }
  return /(?:password|passwd|authorization|credential|secret|token|cookie|api[-_]?key)/i.test(
    key
  );
}

function isoTime(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, sortObjectKeys(entry)])
  );
}
