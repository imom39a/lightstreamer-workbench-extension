import {
  createCaptureMessage,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  type CaptureMessage,
  type CaptureStatus,
  type JsonObject,
  type TopologyAbsoluteRecord,
  type TopologySyncFrame
} from "../../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";

export const FIXED_SCENARIO_TIMESTAMP = 1_780_872_000_000;

export type PanelScenarioView = "Timeline" | "Topology" | "COMMAND State";

export type PanelScenarioSetupAction =
  | {
      type: "select-row";
      selector: string;
      text: string;
    }
  | {
      type: "click";
      selector: string;
    }
  | {
      type: "set-value";
      selector: string;
      value: string;
    }
  | {
      type: "scroll-into-view";
      containerSelector: string;
      targetSelector: string;
      offset: number;
  };

export type PanelScenarioStream = {
  /** The interval is intentionally part of the contract so sustained behavior is repeatable. */
  intervalMs: number;
  initialDelayMs?: number;
  messages: readonly CaptureMessage[];
};

export type PanelScenario = {
  id: string;
  status: CaptureStatus;
  initialView: PanelScenarioView;
  capturedEvents: readonly LightstreamerEventEnvelope[];
  captureMessages?: readonly CaptureMessage[];
  topologySyncFrames?: readonly TopologySyncFrame[];
  setupActions: readonly PanelScenarioSetupAction[];
  postRenderSetupActions?: readonly PanelScenarioSetupAction[];
  stream?: PanelScenarioStream;
};

export const PANEL_SCENARIO_IDS = [
  "command-state",
  "timeline-detail",
  "new-command"
] as const;

export const PANEL_INTERACTION_SCENARIO_IDS = [
  "topology-small",
  "topology-large",
  "export-open",
  "timeline-live",
  "timeline-frozen"
] as const;

export const ALL_PANEL_SCENARIO_IDS = [
  ...PANEL_SCENARIO_IDS,
  ...PANEL_INTERACTION_SCENARIO_IDS
] as const;

export type PanelScenarioId = (typeof ALL_PANEL_SCENARIO_IDS)[number];

/** @deprecated Use PanelScenarioId for browser and panel scenario tooling. */
export type StoreListingScenarioId = PanelScenarioId;

export function isPanelScenarioId(value: string): value is PanelScenarioId {
  return (ALL_PANEL_SCENARIO_IDS as readonly string[]).includes(value);
}

export type TopologyPerformanceScenarioConfig = {
  subscriptionCount: number;
  itemsPerSubscription: number;
  listenersPerSubscription: number;
};

export function getPanelScenario(id: PanelScenarioId): PanelScenario {
  const common = {
    id,
    status: "bridge connected" as const,
    capturedEvents: createStoreListingCapture(),
    setupActions: [] as readonly PanelScenarioSetupAction[]
  };

  switch (id) {
    case "command-state":
      return {
        ...common,
        initialView: "COMMAND State",
        setupActions: [
          { type: "select-row", selector: ".command-current-row", text: "alpha" }
        ]
      };
    case "timeline-detail":
      return {
        ...common,
        initialView: "Timeline",
        setupActions: [
          { type: "select-row", selector: ".event-row", text: "UPDATE/alpha" }
        ]
      };
    case "new-command":
      return {
        ...common,
        initialView: "COMMAND State",
        setupActions: [
          { type: "select-row", selector: ".command-current-row", text: "alpha" },
          { type: "click", selector: ".new-command-button" },
          { type: "set-value", selector: ".command-draft-command", value: "UPDATE" },
          { type: "set-value", selector: ".command-draft-key", value: "alpha" },
          {
            type: "set-value",
            selector: '.command-draft-field-input[data-field-name="qty"]',
            value: "42"
          },
          {
            type: "set-value",
            selector: '.command-draft-field-input[data-field-name="status"]',
            value: "review"
          },
          {
            type: "scroll-into-view",
            containerSelector: ".command-detail-pane",
            targetSelector: ".new-command-editor",
            offset: 72
          }
        ]
      };
    case "topology-small":
      return createTopologySmallScenario();
    case "topology-large":
      return createTopologyLargeScenario();
    case "export-open":
      return createExportOpenScenario();
    case "timeline-live":
      return createTimelineScenario("timeline-live");
    case "timeline-frozen":
      return createTimelineScenario("timeline-frozen");
  }
}

export function createExportOpenScenario(): PanelScenario {
  const topology = createTopologySmallScenario();
  return {
    ...topology,
    id: "export-open",
    setupActions: [
      {
        type: "select-row",
        selector: ".topology-node",
        text: "topology-small-subscription"
      },
    ],
    postRenderSetupActions: [{ type: "click", selector: ".topology-export-toggle" }]
  };
}

export function createTimelineScenario(
  id: "timeline-live" | "timeline-frozen"
): PanelScenario {
  const streamMessages = Array.from({ length: 90 }, (_, index) => {
    const sequence = index + 1;
    const matching = sequence % 3 !== 0;
    return createCaptureMessage("item-update", {
      client: { id: "timeline-client", sessionId: "timeline-session" },
      subscription: { id: "timeline-subscription", mode: "MERGE" },
      item: { name: matching ? "timeline-match" : "timeline-other", position: 1 },
      update: {
        isSnapshot: false,
        fields: { value: sequence, stream: matching ? "match" : "other" },
        changedFields: { value: sequence, stream: matching ? "match" : "other" }
      },
      raw: { callback: "onItemUpdate", sustained: true, sequence }
    }, FIXED_SCENARIO_TIMESTAMP + 100 + sequence);
  });

  return {
    id,
    status: "capturing",
    initialView: "Timeline",
    capturedEvents: [],
    captureMessages: [
      createCaptureMessage("item-update", {
        client: { id: "timeline-client", sessionId: "timeline-session" },
        subscription: { id: "timeline-subscription", mode: "MERGE" },
        item: { name: "timeline-match", position: 1 },
        update: {
          isSnapshot: false,
          fields: { value: 0, stream: "match" },
          changedFields: { value: 0, stream: "match" }
        },
        raw: { callback: "onItemUpdate", sustained: true, sequence: 0 }
      }, FIXED_SCENARIO_TIMESTAMP + 100),
      createCaptureMessage("item-update", {
        client: { id: "timeline-client", sessionId: "timeline-session" },
        subscription: { id: "timeline-subscription", mode: "MERGE" },
        item: { name: "timeline-other", position: 1 },
        update: {
          isSnapshot: false,
          fields: { value: 0, stream: "other" },
          changedFields: { value: 0, stream: "other" }
        },
        raw: { callback: "onItemUpdate", sustained: true, sequence: -1 }
      }, FIXED_SCENARIO_TIMESTAMP + 101)
    ],
    stream: {
      intervalMs: 20,
      initialDelayMs: id === "timeline-frozen" ? 600 : undefined,
      messages: streamMessages
    },
    setupActions: []
  };
}

export function createTopologySmallScenario(): PanelScenario {
  const pageEpoch = "topology-small-page";
  const clientId = "topology-small-client";
  const sessionId = "topology-small-session";
  const subscriptionId = "topology-small-subscription";
  const itemName = "topology-small-item";
  const listenerId = "topology-small-listener";

  const capturedEvents = topologyGuardrailCaptureEvents({
    clientId,
    sessionId,
    subscriptionId,
    itemName,
    listenerId,
    key: "small-alpha"
  });
  return {
    id: "topology-small",
    status: "bridge connected",
    initialView: "Topology",
    capturedEvents,
    captureMessages: capturedEvents.map(toCaptureMessage),
    topologySyncFrames: createTopologyGuardrailSyncFrames({
      pageEpoch,
      syncId: "topology-small-sync",
      clientId,
      sessionId,
      subscriptionId,
      itemName,
      listenerId,
      generationCount: 1,
      generationKeyPrefix: "small"
    }),
    setupActions: []
  };
}

export function createTopologyLargeScenario(): PanelScenario {
  const pageEpoch = "topology-large-page";
  const clientId = "topology-large-client";
  const sessionId = "topology-large-session";
  const subscriptionId = "topology-large-subscription";
  const itemName = "topology-large-item";
  const listenerId = "topology-large-listener";

  const capturedEvents = topologyGuardrailCaptureEvents({
    clientId,
    sessionId,
    subscriptionId,
    itemName,
    listenerId,
    key: "large-0001"
  });
  return {
    id: "topology-large",
    status: "bridge connected",
    initialView: "Topology",
    capturedEvents,
    captureMessages: capturedEvents.map(toCaptureMessage),
    topologySyncFrames: createTopologyGuardrailSyncFrames({
      pageEpoch,
      syncId: "topology-large-sync",
      clientId,
      sessionId,
      subscriptionId,
      itemName,
      listenerId,
      generationCount: 1_000,
      generationKeyPrefix: "large"
    }),
    setupActions: []
  };
}

type TopologyGuardrailScenarioOptions = {
  pageEpoch: string;
  syncId: string;
  clientId: string;
  sessionId: string;
  subscriptionId: string;
  itemName: string;
  listenerId: string;
  generationCount: number;
  generationKeyPrefix: string;
};

function topologyGuardrailCaptureEvents(
  options: Pick<
    TopologyGuardrailScenarioOptions,
    "clientId" | "sessionId" | "subscriptionId" | "itemName" | "listenerId"
  > & { key: string }
): readonly LightstreamerEventEnvelope[] {
  const timestamp = FIXED_SCENARIO_TIMESTAMP + 100;
  const client = {
    id: options.clientId,
    status: "CONNECTED:WS-STREAMING",
    sessionId: options.sessionId,
    serverAddress: "https://user:password@push.example.test/lightstreamer?token=secret-token"
  };
  const subscription = {
    id: options.subscriptionId,
    mode: "COMMAND",
    items: [options.itemName],
    fields: ["command", "key", "value"],
    requestedSnapshot: "yes",
    active: true,
    subscribed: true,
    listenerCount: 1
  };

  return [
    topologyGuardrailEvent("client-created", timestamp, "client-created", {
      client: { id: options.clientId, status: "DISCONNECTED" }
    }),
    topologyGuardrailEvent("client-status", timestamp + 1, "client-status", {
      client
    }),
    topologyGuardrailEvent("subscription-started", timestamp + 2, "subscription-started", {
      client,
      subscription,
      raw: { callback: "onSubscription" }
    }),
    topologyGuardrailEvent("listener-added", timestamp + 3, "listener-added", {
      client,
      subscription: {
        id: options.subscriptionId,
        mode: "COMMAND",
        listenerCount: 1
      },
      listener: {
        id: options.listenerId,
        callbacks: ["onItemUpdate"],
        registrationCount: 1
      }
    }),
    topologyGuardrailEvent("item-update", timestamp + 4, "item-update", {
      client,
      subscription: { id: options.subscriptionId, mode: "COMMAND" },
      listener: { id: options.listenerId },
      item: { name: options.itemName, position: 1 },
      update: {
        isSnapshot: false,
        command: "ADD",
        key: options.key,
        fields: { command: "ADD", key: options.key, value: "1" },
        changedFields: { command: "ADD", key: options.key, value: "1" }
      },
      raw: { callback: "onItemUpdate", targetAvailable: true }
    })
  ];
}

function topologyGuardrailEvent(
  id: string,
  timestamp: number,
  kind: LightstreamerEventEnvelope["kind"],
  payload: Pick<
    LightstreamerEventEnvelope,
    "client" | "subscription" | "listener" | "item" | "update" | "raw"
  >
): LightstreamerEventEnvelope {
  return {
    id: `guardrail-${id}`,
    timestamp,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind,
    ...payload
  };
}

function createTopologyGuardrailSyncFrames(
  options: TopologyGuardrailScenarioOptions
): readonly TopologySyncFrame[] {
  const client = {
    id: options.clientId,
    status: "CONNECTED:WS-STREAMING",
    sessionId: options.sessionId,
    serverAddress: "https://user:password@push.example.test/lightstreamer?token=secret-token"
  };
  const subscription = {
    id: options.subscriptionId,
    mode: "COMMAND",
    items: [options.itemName],
    fields: ["command", "key", "value"],
    active: true,
    subscribed: true,
    listenerCount: 1
  };
  const records: TopologyAbsoluteRecord[] = [
    {
      kind: "page",
      id: options.pageEpoch,
      pageEpoch: options.pageEpoch,
      captureSequence: 1
    },
    {
      kind: "client",
      id: options.clientId,
      parentId: options.pageEpoch,
      clientId: options.clientId,
      pageEpoch: options.pageEpoch,
      captureSequence: 2,
      values: { client }
    },
    {
      kind: "subscription",
      id: options.subscriptionId,
      parentId: options.clientId,
      clientId: options.clientId,
      subscriptionId: options.subscriptionId,
      pageEpoch: options.pageEpoch,
      captureSequence: 3,
      clientActive: true,
      serverEstablished: true,
      values: { client, subscription }
    },
    {
      kind: "listener-attachment",
      id: `${options.listenerId}-attachment`,
      parentId: options.subscriptionId,
      subscriptionId: options.subscriptionId,
      pageEpoch: options.pageEpoch,
      captureSequence: 4,
      values: {
        clientId: options.clientId,
        sessionId: options.sessionId,
        listenerId: options.listenerId,
        callbacks: ["onItemUpdate"],
        registrationCount: 1,
        active: true
      }
    },
    {
      kind: "item",
      id: `item:${options.subscriptionId}:1`,
      parentId: options.subscriptionId,
      subscriptionId: options.subscriptionId,
      pageEpoch: options.pageEpoch,
      captureSequence: 5,
      values: {
        captureKind: "item-update",
        itemName: options.itemName,
        item: { name: options.itemName, position: 1 },
        update: {
          isSnapshot: false,
          command: "ADD",
          key: `${options.generationKeyPrefix}-0001`,
          fields: {
            command: "ADD",
            key: `${options.generationKeyPrefix}-0001`,
            value: "1"
          },
          changedFields: { command: "ADD", key: `${options.generationKeyPrefix}-0001` }
        }
      }
    }
  ];

  for (let index = 1; index <= options.generationCount; index += 1) {
    const key = `${options.generationKeyPrefix}-${String(index).padStart(4, "0")}`;
    records.push({
      kind: "command-generation",
      id: `generation:${options.subscriptionId}:${index}`,
      parentId: options.subscriptionId,
      subscriptionId: options.subscriptionId,
      pageEpoch: options.pageEpoch,
      captureSequence: 5 + index,
      values: {
        itemId: `item:${options.subscriptionId}:1`,
        key,
        command: index === 1 ? "ADD" : "UPDATE"
      }
    });
  }

  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId: options.syncId,
    pageEpoch: options.pageEpoch,
    cutoffCaptureSequence: records.at(-1)?.captureSequence ?? 0,
    chunkCount: 1,
    recordCount: records.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records },
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  ];
}

export function getExtensionPanelSmokeScenario(): PanelScenario {
  return {
    id: "extension-panel-smoke",
    status: "idle",
    initialView: "Timeline",
    capturedEvents: [],
    setupActions: []
  };
}

export function createTopologyPerformanceScenario(
  config: TopologyPerformanceScenarioConfig
): PanelScenario {
  validateTopologyPerformanceConfig(config);
  const timestamp = FIXED_SCENARIO_TIMESTAMP;
  const capturedEvents: LightstreamerEventEnvelope[] = [
    {
      id: "performance-client-created",
      timestamp,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "client-created",
      client: {
        id: "performance-client",
        status: "DISCONNECTED",
        serverAddress: "https://performance.example/lightstreamer",
        adapterSet: "PERFORMANCE",
        libraryVersion: "9.2.3",
        instrumentationSource: "public-api",
        coverageStatus: "full"
      }
    },
    {
      id: "performance-client-status",
      timestamp: timestamp + 1,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "client-status",
      client: {
        id: "performance-client",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "performance-session",
        transport: "ws-streaming"
      }
    }
  ];

  for (let subscriptionIndex = 0; subscriptionIndex < config.subscriptionCount; subscriptionIndex += 1) {
    const subscriptionNumber = subscriptionIndex + 1;
    const subscriptionId = `performance-subscription-${subscriptionNumber}`;
    const items = Array.from(
      { length: config.itemsPerSubscription },
      (_, itemIndex) => `performance-item-${subscriptionNumber}-${itemIndex + 1}`
    );
    capturedEvents.push({
      id: `${subscriptionId}-started`,
      timestamp: timestamp + 2 + subscriptionIndex,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "subscription-started",
      client: {
        id: "performance-client",
        status: "CONNECTED:WS-STREAMING",
        sessionId: "performance-session"
      },
      subscription: {
        id: subscriptionId,
        mode: "MERGE",
        items,
        fields: ["value", "sequence"],
        requestedSnapshot: "no",
        requestedMaxFrequency: "unlimited",
        active: true,
        subscribed: true,
        listenerCount: config.listenersPerSubscription
      },
      raw: { callback: "onSubscription" }
    });

    for (let listenerIndex = 0; listenerIndex < config.listenersPerSubscription; listenerIndex += 1) {
      const listenerNumber = listenerIndex + 1;
      capturedEvents.push({
        id: `${subscriptionId}-listener-${listenerNumber}`,
        timestamp: timestamp + 100 + subscriptionIndex * 10 + listenerIndex,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "listener-added",
        client: {
          id: "performance-client",
          sessionId: "performance-session"
        },
        subscription: {
          id: subscriptionId,
          mode: "MERGE",
          listenerCount: config.listenersPerSubscription
        },
        listener: {
          id: `${subscriptionId}-listener-${listenerNumber}`,
          callbacks: ["onItemUpdate"],
          registrationCount: 1,
          metricOwner: listenerIndex === 0
        },
        raw: { targetAvailable: true }
      });
    }
  }

  return {
    id: "topology-performance",
    status: "bridge connected",
    initialView: "Topology",
    capturedEvents,
    setupActions: []
  };
}

export function createTopologyPerformanceLogicalUpdate(
  config: TopologyPerformanceScenarioConfig,
  logicalIndex: number
): readonly LightstreamerEventEnvelope[] {
  validateTopologyPerformanceConfig(config);
  if (!Number.isInteger(logicalIndex) || logicalIndex <= 0) {
    throw new Error("logicalIndex must be a positive integer.");
  }

  const zeroBased = logicalIndex - 1;
  const subscriptionIndex = zeroBased % config.subscriptionCount;
  const itemIndex =
    Math.floor(zeroBased / config.subscriptionCount) % config.itemsPerSubscription;
  const subscriptionNumber = subscriptionIndex + 1;
  const subscriptionId = `performance-subscription-${subscriptionNumber}`;
  const itemName = `performance-item-${subscriptionNumber}-${itemIndex + 1}`;
  const logicalEventId = `performance-logical-update-${logicalIndex}`;
  const timestamp = FIXED_SCENARIO_TIMESTAMP + 1_000 + logicalIndex;

  return Array.from(
    { length: config.listenersPerSubscription },
    (_, listenerIndex): LightstreamerEventEnvelope => {
      const listenerNumber = listenerIndex + 1;
      return {
        id: `${logicalEventId}-listener-${listenerNumber}`,
        timestamp,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "item-update",
        logicalEventId,
        client: {
          id: "performance-client",
          sessionId: "performance-session"
        },
        subscription: {
          id: subscriptionId,
          mode: "MERGE"
        },
        listener: {
          id: `${subscriptionId}-listener-${listenerNumber}`,
          callbacks: ["onItemUpdate"],
          metricOwner: listenerIndex === 0
        },
        item: {
          name: itemName,
          position: itemIndex + 1
        },
        update: {
          isSnapshot: false,
          fields: {
            value: logicalIndex,
            sequence: logicalIndex
          },
          changedFields: {
            value: logicalIndex,
            sequence: logicalIndex
          }
        },
        raw: {
          callback: "onItemUpdate",
          logicalEventId,
          targetAvailable: true
        }
      };
    }
  );
}

export function createTopologyPerformanceCaptureMessages(
  config: TopologyPerformanceScenarioConfig
): readonly CaptureMessage[] {
  return createTopologyPerformanceScenario(config).capturedEvents.map(toCaptureMessage);
}

export function createTopologyPerformanceLogicalUpdateMessages(
  config: TopologyPerformanceScenarioConfig,
  logicalIndex: number
): readonly CaptureMessage[] {
  return createTopologyPerformanceLogicalUpdate(config, logicalIndex).map(toCaptureMessage);
}

function createStoreListingCapture(): readonly LightstreamerEventEnvelope[] {
  return [
    storeListingEvent("scenario-event-1", 1, {
      command: "ADD",
      key: "alpha",
      snapshot: true,
      fields: {
        command: "ADD",
        key: "alpha",
        name: "Alpha",
        qty: "10",
        status: "snapshot",
        version: "1"
      },
      changedFields: {
        command: "ADD",
        key: "alpha",
        name: "Alpha",
        qty: "10",
        status: "snapshot",
        version: "1"
      }
    }),
    storeListingEvent("scenario-event-2", 2, {
      command: "ADD",
      key: "beta",
      snapshot: true,
      fields: {
        command: "ADD",
        key: "beta",
        name: "Beta",
        qty: "5",
        status: "snapshot",
        version: "1"
      },
      changedFields: {
        command: "ADD",
        key: "beta",
        name: "Beta",
        qty: "5",
        status: "snapshot",
        version: "1"
      }
    }),
    storeListingEvent("scenario-event-3", 3, {
      command: "UPDATE",
      key: "alpha",
      fields: {
        command: "UPDATE",
        key: "alpha",
        name: "Alpha",
        qty: "15",
        status: "live",
        version: "2"
      },
      changedFields: {
        qty: "15",
        status: "live",
        version: "2"
      }
    }),
    storeListingEvent("scenario-event-4", 4, {
      command: "DELETE",
      key: "beta",
      fields: {
        command: "DELETE",
        key: "beta",
        name: "Beta",
        qty: "0",
        status: "deleted",
        version: "2"
      },
      changedFields: {
        status: "deleted",
        version: "2"
      }
    }),
    storeListingEvent("scenario-event-5", 5, {
      command: "UPDATE",
      key: "alpha",
      source: "synthetic",
      synthetic: true,
      fields: {
        command: "UPDATE",
        key: "alpha",
        name: "Alpha",
        qty: "18",
        status: "synthetic replay",
        version: "3"
      },
      changedFields: {
        qty: "18",
        status: "synthetic replay",
        version: "3"
      },
      raw: {
        sourceEventId: "scenario-event-3",
        targetSubscriptionId: "scenario-subscription-1",
        targetListenerId: "scenario-listener-1"
      }
    }),
    storeListingEvent("scenario-event-6", 6, {
      command: "UPDATE",
      key: "ghost",
      fields: {
        command: "UPDATE",
        key: "ghost",
        name: "Ghost",
        qty: "1",
        status: "diagnostic",
        version: "1"
      },
      changedFields: {
        status: "diagnostic"
      },
      raw: {
        diagnostic: "unknown-key-update"
      }
    })
  ];
}

type StoreListingEventOptions = {
  command: string;
  key: string;
  snapshot?: boolean;
  source?: LightstreamerEventEnvelope["source"];
  synthetic?: boolean;
  fields: Record<string, string>;
  changedFields: Record<string, string>;
  raw?: Record<string, string>;
};

function storeListingEvent(
  id: string,
  offset: number,
  options: StoreListingEventOptions
): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: FIXED_SCENARIO_TIMESTAMP + offset,
    direction: "inbound",
    source: options.source ?? "server",
    captureSource: "listener",
    synthetic: options.synthetic ?? false,
    kind: "item-update",
    client: {
      id: "scenario-client-1",
      status: "CONNECTED:WS-STREAMING",
      serverAddress: "https://push.example.test/lightstreamer"
    },
    subscription: {
      id: "scenario-subscription-1",
      mode: "COMMAND",
      items: ["scenario.snapshot-basic"],
      fields: ["command", "key", "name", "qty", "status", "version"],
      requestedSnapshot: "yes"
    },
    listener: { id: "scenario-listener-1" },
    item: { name: "scenario.snapshot-basic", position: 1 },
    update: {
      isSnapshot: options.snapshot ?? false,
      command: options.command,
      key: options.key,
      fields: options.fields,
      changedFields: options.changedFields
    },
    raw: {
      callback: "onItemUpdate",
      sample: true,
      ...options.raw
    }
  };
}

function validateTopologyPerformanceConfig(config: TopologyPerformanceScenarioConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer.`);
    }
  }
}

function toCaptureMessage(event: LightstreamerEventEnvelope): CaptureMessage {
  return createCaptureMessage(
    event.kind,
    {
      ...(event.client ? { client: event.client as unknown as JsonObject } : {}),
      ...(event.subscription ? { subscription: event.subscription as unknown as JsonObject } : {}),
      ...(event.listener ? { listener: event.listener as unknown as JsonObject } : {}),
      ...(event.item ? { item: event.item as unknown as JsonObject } : {}),
      ...(event.update ? { update: event.update as unknown as JsonObject } : {}),
      ...(event.raw ? { raw: event.raw } : {})
    },
    event.timestamp
  );
}
