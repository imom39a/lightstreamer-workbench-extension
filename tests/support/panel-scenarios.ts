import {
  createCaptureMessage,
  type CaptureMessage,
  type CaptureStatus,
  type JsonObject
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

export type PanelScenario = {
  id: string;
  status: CaptureStatus;
  initialView: PanelScenarioView;
  capturedEvents: readonly LightstreamerEventEnvelope[];
  setupActions: readonly PanelScenarioSetupAction[];
};

export const PANEL_SCENARIO_IDS = [
  "command-state",
  "timeline-detail",
  "new-command"
] as const;

export type PanelScenarioId = (typeof PANEL_SCENARIO_IDS)[number];

/** @deprecated Use PanelScenarioId for browser and panel scenario tooling. */
export type StoreListingScenarioId = PanelScenarioId;

export function isPanelScenarioId(value: string): value is PanelScenarioId {
  return (PANEL_SCENARIO_IDS as readonly string[]).includes(value);
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
  }
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
