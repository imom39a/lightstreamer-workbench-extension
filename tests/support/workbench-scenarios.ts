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
  "limited-capture",
  "empty-scope",
  "disconnected",
  "memory-fallback",
  "raw-evidence",
  "filter-find",
  "filter-hidden-selection",
  "recovering",
  "retired-scope",
  "local-injection-captured",
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
  topologySyncFrames?: readonly TopologySyncFrame[];
  captureMessages?: readonly CaptureMessage[];
  selectedEventId?: string;
  selectedScope?: Readonly<{
    kind: "session" | "item" | "listener";
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
/**
 * The browser contract deliberately reuses the canonical COMMAND capture
 * data, then expands it into a stable high-volume sequence without importing
 * legacy DOM actions or selectors.
 */
export function getWorkbenchScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const canonical = getPanelScenario("command-state").capturedEvents;
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
        initialEvents: highVolumeEvents(1, 90),
        laterEvents: highVolumeEvents(91, 30),
        selectedEventId: "high-volume-90",
        captureStatus: "capturing",
        freezeBeforeLaterEvents: true
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
      if (!passive) throw new Error("The canonical scenario must include the initial Item Update.");
      return {
        id,
        initialEvents: canonical,
        laterEvents: [{ ...passive, id: "scenario-event-1-passive", timestamp: passive.timestamp + 1000 }],
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        filterQuery: "scenario-event-1"
      };
    }
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
    case "local-injection-authored":
      return {
        id,
        initialEvents: [],
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: topology.captureMessages,
        selectedEventId: "event-5",
        selectedScope: {
          kind: "item",
          retired: false,
          label: "topology-small-item · #1"
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
  return Array.from({ length: count }, (_, offset) => {
    const sequence = first + offset;
    return {
      ...source,
      id: `high-volume-${sequence}`,
      timestamp: source.timestamp + sequence,
      item: { ...source.item, name: `orders-${sequence % 7}` },
      update: {
        ...source.update,
        fields: { ...source.update?.fields, qty: String(sequence), sequence: String(sequence) },
        changedFields: { qty: String(sequence), sequence: String(sequence) }
      },
      raw: { ...source.raw, scenario: "react-frozen-high-volume", sequence }
    };
  });
}
