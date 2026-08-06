import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import {
  createCaptureMessage,
  TOPOLOGY_OBSERVATION_VERSION,
  type CaptureMessage,
  type CaptureStatus,
  type TopologySyncFrame
} from "../../src/bridge/messages";
import { getPanelScenario } from "./panel-scenarios";

export const WORKBENCH_SCENARIO_IDS = [
  "live-selected",
  "active-no-selection",
  "selected-local-evidence",
  "frozen-high-volume",
  "live-high-scope",
  "limited-capture",
  "empty-scope",
  "disconnected",
  "memory-fallback",
  "raw-evidence",
  "filter-find",
  "filter-hidden-selection",
  "command-projection-matching",
  "command-projection-before-local",
  "command-projection-local-difference",
  "command-projection-retention-failure",
  "command-projection-unavailable",
  "recovering",
  "retired-scope",
  "local-injection-captured",
  "local-injection-json",
  "local-injection-authored",
  "local-injection-large",
  "local-injection-invalid",
  "local-injection-conflict",
  "local-injection-stale-edit",
  "local-injection-stale-review",
  "local-injection-pending",
  "local-injection-delivered",
  "local-injection-failed",
  "local-injection-partial",
  "local-injection-unknown"
] as const;

export type WorkbenchScenarioId = (typeof WORKBENCH_SCENARIO_IDS)[number];

export type WorkbenchScenario = Readonly<{
  id: WorkbenchScenarioId;
  initialEvents: readonly LightstreamerEventEnvelope[];
  laterEvents?: readonly LightstreamerEventEnvelope[];
  /** Browser-test Evidence held until the test explicitly releases one passive update batch. */
  deferredEvents?: readonly LightstreamerEventEnvelope[];
  topologySyncFrames?: readonly TopologySyncFrame[];
  captureMessages?: readonly CaptureMessage[];
  selectedEventId?: string;
  selectedScope?: Readonly<{
    kind: "session" | "subscription" | "item" | "listener";
    retired: boolean;
    label: string;
  }>;
  captureStatus: CaptureStatus;
  capture?: Readonly<{
    operation: "RUNNING" | "IDLE" | "STOPPED";
    coverage: "USEFUL" | "LIMITED" | "UNAVAILABLE";
    detail?: string;
    recovery?: string;
  }>;
  freezeBeforeLaterEvents?: boolean;
  storage?: Readonly<{ mode: "memory"; reason: string }>;
  openRawEvidence?: boolean;
  filterQuery?: string;
  findQuery?: string;
  failLocalEvidenceRetention?: boolean;
  localInjection?: Readonly<{
    entry: "selection" | "scope";
    rawText?: string;
    compareOpen?: boolean;
    minimized?: boolean;
    parked?: boolean;
    review?: boolean;
    staleBeforeReview?: boolean;
    staleAfterReview?: boolean;
    execute?: boolean;
    secondEntry?: "selection" | "scope";
    executorOutcome?: "pending" | "delivered" | "failed" | "partial" | "unknown";
  }>;
}>;

export function isWorkbenchScenarioId(value: string): value is WorkbenchScenarioId {
  return (WORKBENCH_SCENARIO_IDS as readonly string[]).includes(value);
}

export function highVolumeEventId(sequence: number): string {
  return `retained-evidence-event-${String(sequence).padStart(4, "0")}-from-orders-command-subscription-with-long-production-identity`;
}
/**
 * The browser contract deliberately reuses the canonical COMMAND capture
 * data, then expands it into a stable high-volume sequence without importing
 * legacy DOM actions or selectors.
 */
export function getWorkbenchScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const canonical = getPanelScenario("command-state").capturedEvents;
  const serverOnlyCanonical = canonical.filter((event) => !event.synthetic);
  const topology = getPanelScenario("topology-small");

  switch (id) {
    case "live-selected":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing"
      };
    case "active-no-selection":
      return { id, initialEvents: canonical, captureStatus: "capturing" };
    case "selected-local-evidence":
      return { id, initialEvents: canonical, selectedEventId: "scenario-event-5", captureStatus: "capturing" };
    case "frozen-high-volume":
      return {
        id,
        initialEvents: highVolumeEvents(1, 3_970),
        laterEvents: highVolumeEvents(3_971, 30),
        selectedEventId: highVolumeEventId(3_970),
        captureStatus: "capturing",
        freezeBeforeLaterEvents: true
      };
    case "live-high-scope":
      return {
        id,
        initialEvents: highScopeEvents(1, 220),
        deferredEvents: [...highScopeEvents(0, 1), ...highScopeEvents(221, 39)],
        selectedEventId: "high-scope-event-220",
        selectedScope: {
          kind: "subscription",
          retired: false,
          label: "high-scope-subscription-220"
        },
        captureStatus: "capturing"
      };
    case "limited-capture":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        capture: {
          operation: "RUNNING",
          coverage: "LIMITED",
          detail: "Earlier Snapshot Evidence may be incomplete.",
          recovery: "Open Capture diagnostics"
        }
      };
    case "empty-scope":
      return { id, initialEvents: [], captureStatus: "idle" };
    case "disconnected":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "bridge disconnected",
        capture: {
          operation: "STOPPED",
          coverage: "LIMITED",
          detail: "The inspected-page Capture bridge disconnected. Retained Evidence remains readable.",
          recovery: "Reconnect the inspected page and DevTools panel"
        }
      };
    case "memory-fallback":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        storage: { mode: "memory", reason: "IndexedDB is unavailable" }
      };
    case "raw-evidence":
      return { id, initialEvents: canonical, selectedEventId: "scenario-event-3", captureStatus: "capturing", openRawEvidence: true };
    case "filter-find":
      return { id, initialEvents: canonical, selectedEventId: "scenario-event-3", captureStatus: "capturing", filterQuery: "scenario-event", findQuery: "item update" };
    case "filter-hidden-selection": {
      const passive = canonical[0];
      const selected = canonical.find((event) => event.id === "scenario-event-3");
      if (!passive || !selected?.update) {
        throw new Error("The canonical scenario must include the passive and selected Item Updates.");
      }
      const retainedDetails = JSON.stringify({ passenger: { selected: false, priority: true } });
      const enrichedSelected: LightstreamerEventEnvelope = {
        ...selected,
        update: {
          ...selected.update,
          fields: { ...selected.update.fields, retainedDetails },
          changedFields: { retainedDetails },
          jsonPatches: {
            retainedDetails: [{ op: "replace", path: "/passenger/selected", value: false }]
          }
        }
      };
      return {
        id,
        initialEvents: canonical.map((event) => event.id === selected.id ? enrichedSelected : event),
        laterEvents: [{ ...passive, id: "scenario-event-1-passive", timestamp: passive.timestamp + 1000 }],
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        filterQuery: "scenario-event-1"
      };
    }
    case "command-projection-matching":
      return {
        id,
        initialEvents: serverOnlyCanonical,
        captureStatus: "capturing"
      };
    case "command-projection-local-difference":
      return {
        ...localInjectionCapturedScenario(id),
        localInjection: {
          entry: "selection",
          rawText: JSON.stringify({
            command: "UPDATE",
            key: "small-alpha",
            isSnapshot: false,
            fields: { command: "UPDATE", key: "small-alpha", value: "9" }
          }, null, 2),
          review: true,
          execute: true,
          executorOutcome: "delivered"
        }
      };
    case "command-projection-retention-failure": {
      const priorLocalSource = topology.capturedEvents.find((event) => event.kind === "item-update");
      if (!priorLocalSource?.update) {
        throw new Error("The topology scenario must include an Item Update.");
      }
      return {
        ...localInjectionCapturedScenario(id),
        initialEvents: [{
          ...priorLocalSource,
          id: "retained-prior-local-evidence",
          timestamp: priorLocalSource.timestamp - 1,
          source: "synthetic",
          synthetic: true,
          update: {
            ...priorLocalSource.update,
            command: "UPDATE",
            fields: { command: "UPDATE", key: "small-alpha", value: "7" },
            changedFields: { value: "7" }
          }
        }],
        failLocalEvidenceRetention: true,
        localInjection: {
          entry: "selection",
          rawText: JSON.stringify({
            command: "UPDATE",
            key: "small-alpha",
            isSnapshot: false,
            fields: { command: "UPDATE", key: "small-alpha", value: "9" }
          }, null, 2),
          review: true,
          execute: true,
          executorOutcome: "delivered"
        }
      };
    }
    case "command-projection-before-local":
      return localInjectionCapturedScenario(id);
    case "command-projection-unavailable":
      return {
        id,
        initialEvents: [],
        captureStatus: "idle",
        capture: {
          operation: "IDLE",
          coverage: "UNAVAILABLE",
          detail: "No captured Server Updates are available for this Scope."
        }
      };
    case "recovering":
      return {
        id,
        initialEvents: [],
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: [
          ...(topology.captureMessages?.slice(1) ?? []),
          semanticSessionStatus("DISCONNECTED:TRYING-RECOVERY", "topology-small-session", 7)
        ],
        selectedEventId: "event-5",
        captureStatus: "capturing"
      };
    case "retired-scope":
      return {
        id,
        initialEvents: [],
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: [
          ...(topology.captureMessages?.slice(1) ?? []),
          semanticSessionStatus("CONNECTED:WS-STREAMING", "topology-next-session", 7)
        ],
        selectedEventId: "event-4",
        selectedScope: {
          kind: "session",
          retired: true,
          label: "Historical session topology-small-session"
        },
        captureStatus: "capturing"
      };
    case "local-injection-captured":
      return localInjectionCapturedScenario(id);
    case "local-injection-json":
      return localInjectionJsonScenario(id);
    case "local-injection-authored":
      return {
        id,
        initialEvents: [],
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: topology.captureMessages,
        selectedScope: {
          kind: "subscription",
          retired: false,
          label: "topology-small-subscription"
        },
        captureStatus: "capturing"
      };
    case "local-injection-large": {
      const source = topology.capturedEvents.at(-1);
      if (!source?.update || !source.subscription) throw new Error("Topology scenario requires a captured Item Update source.");
      const fields = Object.fromEntries(Array.from({ length: 500 }, (_, index) => {
        if (index === 0) return ["command", "UPDATE"];
        if (index === 1) return ["key", "small-alpha"];
        return [`field_${String(index - 1).padStart(3, "0")}`, `value-${index - 1}`];
      }));
      const event: LightstreamerEventEnvelope = {
        ...source,
        id: "large-local-source",
        subscription: { ...source.subscription, fields: Object.keys(fields) },
        update: { ...source.update, command: "UPDATE", key: "small-alpha", fields, changedFields: fields }
      };
      return {
        id,
        initialEvents: [event],
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: topology.captureMessages,
        selectedEventId: event.id,
        captureStatus: "capturing",
        localInjection: { entry: "selection", compareOpen: true }
      };
    }
    case "local-injection-invalid":
      return {
        ...localInjectionCapturedScenario(id),
        localInjection: {
          entry: "selection",
          rawText: '{\n  "command": "UPDATE",\n  "command": "ADD",\n  "key": "missing",\n  "isSnapshot": false,\n  "fields": {"command": "UPDATE", "key": "missing", "value": "2"}\n}'
        }
      };
    case "local-injection-conflict":
      return {
        ...localInjectionCapturedScenario(id),
        localInjection: { entry: "selection", secondEntry: "selection" }
      };
    case "local-injection-stale-review":
      return {
        ...localInjectionCapturedScenario(id),
        localInjection: { entry: "selection", review: true, staleAfterReview: true, execute: true }
      };
    case "local-injection-stale-edit":
      return {
        ...localInjectionCapturedScenario(id),
        localInjection: { entry: "selection", staleBeforeReview: true, review: true }
      };
    case "local-injection-pending":
      return localInjectionOutcomeScenario(id, "pending");
    case "local-injection-delivered":
      return localInjectionOutcomeScenario(id, "delivered");
    case "local-injection-failed":
      return localInjectionOutcomeScenario(id, "failed");
    case "local-injection-partial":
      return localInjectionOutcomeScenario(id, "partial");
    case "local-injection-unknown":
      return localInjectionOutcomeScenario(id, "unknown");
  }
}

function localInjectionCapturedScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const topology = getPanelScenario("topology-small");
  return {
    id,
    initialEvents: [],
    topologySyncFrames: topology.topologySyncFrames,
    captureMessages: topology.captureMessages,
    selectedEventId: "event-5",
    captureStatus: "capturing"
  };
}

function localInjectionJsonScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const topology = getPanelScenario("topology-small");
  const source = topology.capturedEvents.at(-1);
  if (!source?.update || !source.subscription) {
    throw new Error("Topology scenario requires a captured Item Update source.");
  }
  const modelValues = JSON.stringify({
    passenger: {
      selected: false,
      priority: false,
      itinerary: Array.from({ length: 48 }, (_, index) => ({
        segment: index + 1,
        from: `AIRPORT-${String(index).padStart(2, "0")}`,
        to: `AIRPORT-${String(index + 1).padStart(2, "0")}`
      }))
    }
  });
  const fields = {
    command: "ADD",
    key: "json-string-alpha",
    modelValues,
    malformed: '{"passenger":',
    scalar: "true",
    ordinary: "customer"
  };
  const selected: LightstreamerEventEnvelope = {
    ...source,
    id: "json-string-event",
    timestamp: source.timestamp + 10,
    subscription: { ...source.subscription, fields: Object.keys(fields) },
    update: {
      ...source.update,
      command: "ADD",
      key: "json-string-alpha",
      fields,
      changedFields: { modelValues, ordinary: "customer" },
      jsonPatches: { modelValues: [{ op: "replace", path: "/passenger/selected", value: false }] }
    }
  };
  return {
    id,
    initialEvents: [selected],
    topologySyncFrames: topology.topologySyncFrames,
    captureMessages: topology.captureMessages,
    selectedEventId: selected.id,
    captureStatus: "capturing"
  };
}

function localInjectionOutcomeScenario(
  id: WorkbenchScenarioId,
  outcome: "pending" | "delivered" | "failed" | "partial" | "unknown"
): WorkbenchScenario {
  return {
    ...localInjectionCapturedScenario(id),
    localInjection: { entry: "selection", review: true, execute: true, executorOutcome: outcome }
  };
}

function semanticSessionStatus(
  status: string,
  sessionId: string,
  captureSequence: number
): CaptureMessage<"client-status"> {
  const client = {
    id: "topology-small-client",
    status,
    sessionId,
    transport: "WS-STREAMING"
  };
  return createCaptureMessage(
    "client-status",
    { client },
    1_780_872_000_200 + captureSequence,
    {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "client-status",
      pageEpoch: "topology-small-page",
      captureSequence,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "complete", getters: {} },
      client
    }
  );
}

function highVolumeEvents(first: number, count: number): readonly LightstreamerEventEnvelope[] {
  const source = getPanelScenario("command-state").capturedEvents[2];
  if (!source) {
    throw new Error("The canonical COMMAND scenario must include an UPDATE item for high-volume Evidence.");
  }
  return Array.from({ length: count }, (_, offset): LightstreamerEventEnvelope => {
    const sequence = first + offset;
    const findAnchor = sequence === 5 || sequence === 2_050 || sequence === 3_995;
    const event: LightstreamerEventEnvelope = {
      ...source,
      id: highVolumeEventId(sequence),
      timestamp: source.timestamp + sequence,
      client: {
        ...source.client,
        id: "lightstreamer-client-for-global-orders-monitoring-workspace",
        sessionId: "session-2026-08-05-primary-production-orders-command-stream"
      },
      subscription: {
        ...source.subscription,
        id: "subscription-orders-command-all-regions-with-production-identities",
        items: ["portfolio/orders/north-america/enterprise-customer-primary-book"]
      },
      listener: {
        ...source.listener,
        id: "listener-workbench-high-volume-orders-command-investigation"
      },
      item: {
        ...source.item,
        name: "portfolio/orders/north-america/enterprise-customer-primary-book"
      },
      update: {
        ...source.update,
        key: `customer-order-command-key-with-long-production-identity-${sequence % 17}`,
        fields: {
          ...source.update?.fields,
          key: `customer-order-command-key-with-long-production-identity-${sequence % 17}`,
          quantity_for_primary_execution_venue: String(sequence),
          retained_sequence_number: String(sequence),
          ...(findAnchor ? { complete_find_anchor: "complete-retained-find-anchor" } : {})
        },
        changedFields: {
          quantity_for_primary_execution_venue: String(sequence),
          retained_sequence_number: String(sequence),
          ...(findAnchor ? { complete_find_anchor: "complete-retained-find-anchor" } : {})
        }
      },
      raw: {
        ...source.raw,
        scenario: "react-frozen-high-volume-long-identities",
        sequence,
        ...(findAnchor ? { findAnchor: "complete-retained-find-anchor" } : {})
      }
    };
    if (sequence === 3_969 && event.update) {
      return {
        ...event,
        update: {
          ...event.update,
          key: undefined,
          fields: { ...event.update.fields, key: "field-only-key-must-not-be-inferred" }
        }
      };
    }
    if (sequence === 3_968) {
      return {
        ...event,
        kind: "client-status",
        subscription: undefined,
        listener: undefined,
        item: undefined,
        update: undefined
      };
    }
    return event;
  });
}

function highScopeEvents(first: number, count: number): readonly LightstreamerEventEnvelope[] {
  const source = getPanelScenario("command-state").capturedEvents[2];
  if (!source) {
    throw new Error("The canonical COMMAND scenario must include an UPDATE item for high Scope Evidence.");
  }
  return Array.from({ length: count }, (_, offset) => {
    const sequence = first + offset;
    return {
      ...source,
      id: `high-scope-event-${sequence}`,
      timestamp: source.timestamp + sequence,
      client: { ...source.client, id: "high-scope-client", sessionId: "high-scope-session" },
      subscription: {
        ...source.subscription,
        id: `high-scope-subscription-${String(sequence).padStart(3, "0")}`,
        items: [`high-scope-item-${String(sequence).padStart(3, "0")}`]
      },
      item: { ...source.item, name: `high-scope-item-${String(sequence).padStart(3, "0")}`, position: 1 },
      update: {
        ...source.update,
        command: "UPDATE",
        key: `high-scope-key-${String(sequence).padStart(3, "0")}`,
        fields: { command: "UPDATE", key: `high-scope-key-${String(sequence).padStart(3, "0")}`, sequence },
        changedFields: { sequence }
      }
    };
  });
}
