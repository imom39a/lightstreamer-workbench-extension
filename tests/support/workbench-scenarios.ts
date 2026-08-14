import { type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
import {
  createCaptureMessage,
  TOPOLOGY_OBSERVATION_VERSION,
  type CaptureMessage,
  type CaptureStatus,
  type TopologySyncFrame
} from "../../src/bridge/messages";
import { getPanelScenario } from "./panel-scenarios";
import type { HistoryCapacityOverrides } from "../../src/core/event-history-authoritative";
import type { ScenarioAssertion } from "../../src/core/local-injection-scenario";

export const WORKBENCH_SCENARIO_IDS = [
  "live-selected",
  "active-no-selection",
  "selected-local-evidence",
  "frozen-high-volume",
  "activity-10k",
  "activity-graphical",
  "activity-connection-lanes",
  "activity-layers",
  "activity-clock-discontinuity",
  "activity-aggregation-failure",
  "activity-terminal",
  "activity-rebucket",
  "activity-ranking-pages",
  "live-high-scope",
  "filter-high-cardinality",
  "filter-active-zero",
  "filter-no-concrete",
  "filter-collision",
  "limited-capture",
  "storage-headroom-warning",
  "empty-scope",
  "disconnected",
  "memory-fallback",
  "diagnostics-stress",
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
  ,"local-injection-scenario-edit"
  ,"local-injection-scenario-review"
  ,"local-injection-scenario-complete"
  ,"local-injection-scenario-partial"
  ,"local-injection-scenario-high-volume"
  ,"local-injection-scenario-stop-in-flight"
  ,"local-injection-scenario-listener-drift"
  ,"local-injection-scenario-server-drift"
  ,"local-injection-scenario-unknown"
  ,"local-injection-scenario-unretained"
  ,"local-injection-scenario-cleared"
  ,"local-injection-scenario-checkpoint-authoring"
  ,"local-injection-scenario-checkpoint-review"
  ,"local-injection-scenario-checkpoint-waiting"
  ,"local-injection-scenario-checkpoint-pass"
  ,"local-injection-scenario-checkpoint-fail"
  ,"local-injection-scenario-checkpoint-wire-unavailable"
  ,"local-injection-scenario-checkpoint-ambiguous-null"
  ,"local-injection-scenario-checkpoint-high-volume"
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
  historyCapacity?: HistoryCapacityOverrides;
  activityProjectionFailure?: string;
  storageEstimate?: Readonly<{ usageBytes: number; quotaBytes: number }>;
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
    executorOutcome?: "pending" | "delivered" | "delayed" | "failed" | "partial" | "unknown";
    terminalLimit?: boolean;
    scenario?: Readonly<{
      addEventId?: string;
      authoredSteps?: number;
      checkpoints?: readonly Readonly<{
        name: string;
        assertions: readonly ScenarioAssertion[];
        beforeSteps?: boolean;
      }>[];
      review?: boolean;
      steps?: number;
      delayMs?: number;
      speed?: 0.25 | 0.5 | 1 | 2 | 4;
      play?: boolean;
      driftEvent?: LightstreamerEventEnvelope;
      driftFrames?: readonly TopologySyncFrame[];
      clearAfterRun?: boolean;
    }>;
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
    case "activity-10k":
      return {
        id,
        initialEvents: highVolumeEvents(1, 10_000).map((event, index) => ({
          ...event,
          logicalEventId: `activity-logical-${index + 1}`,
          listener: { ...(event.listener ?? { id: `activity-listener-${index % 4}` }), metricOwner: true }
        })),
        selectedEventId: highVolumeEventId(10_000),
        captureStatus: "capturing"
      };
    case "activity-graphical":
      return {
        id,
        initialEvents: highVolumeEvents(1, 40).map((event, index) => ({
          ...event,
          logicalEventId: `activity-graphical-logical-${index + 1}`,
          client: { ...(event.client ?? { id: "activity-graphical-client" }), id: event.client?.id ?? "activity-graphical-client", requestedMaxBandwidth: 10, realMaxBandwidth: index < 20 ? 5 : 7 },
          subscription: { ...event.subscription, id: `activity-graphical-subscription-${index % 12}`, requestedMaxFrequency: 4, realMaxFrequency: index < 20 ? 2 : 3 },
          ...(index === 0 ? { source: "synthetic" as const, synthetic: true } : {}),
          listener: index % 3 === 0 ? undefined : { ...(event.listener ?? { id: `activity-graphical-listener-${index % 4}` }), metricOwner: true }
        })),
        selectedEventId: highVolumeEventId(40),
        captureStatus: "capturing"
      };
    case "activity-connection-lanes": {
      const sourceEvents = highVolumeEvents(1, 7);
      return {
        id,
        initialEvents: sourceEvents.map((event, index) => ({
          ...event,
          id: `activity-connection-lanes-event-${index + 1}`,
          logicalEventId: `activity-connection-lanes-logical-${index + 1}`,
          timestamp: event.timestamp + index * 1_000,
          client: {
            ...(event.client ?? {}),
            id: `activity-connection-lanes-client-${index + 1}`,
            sessionId: `activity-connection-lanes-session-${index + 1}`,
            requestedMaxBandwidth: 10,
            realMaxBandwidth: index < 3 ? 5 : 7
          },
          subscription: {
            ...(event.subscription ?? {}),
            id: `activity-connection-lanes-subscription-${index + 1}`,
            requestedMaxFrequency: 4,
            realMaxFrequency: index < 3 ? 2 : 3
          },
          item: {
            ...(event.item ?? {}),
            name: `activity-connection-lanes-item-${index + 1}`,
            position: index + 1
          },
          listener: {
            ...(event.listener ?? { id: `activity-connection-lanes-listener-${index + 1}` }),
            id: `activity-connection-lanes-listener-${index + 1}`,
            metricOwner: true
          }
        })),
        selectedEventId: "activity-connection-lanes-event-7",
        captureStatus: "capturing"
      };
    }
    case "activity-layers": {
      const updates = highVolumeEvents(1, 8).map((event, index) => ({ ...event, logicalEventId: `activity-layers-logical-${index + 1}` }));
      const source = updates[0];
      if (!source) throw new Error("Activity layer scenario requires a source update.");
      const client = { ...(source.client ?? {}), id: source.client?.id ?? "activity-layers-client" };
      const clientStatus: LightstreamerEventEnvelope = { ...source, id: "activity-layers-client-status", kind: "client-status", client: { ...client, status: "DISCONNECTED" }, subscription: undefined, listener: undefined, item: undefined, update: undefined };
      const lostUpdates: LightstreamerEventEnvelope = { ...source, id: "activity-layers-lost-updates", kind: "lost-updates", subscription: undefined, listener: undefined, item: undefined, update: { lostUpdates: 3 } };
      const subscriptionError: LightstreamerEventEnvelope = { ...source, id: "activity-layers-subscription-error", kind: "subscription-error", subscription: { ...source.subscription, id: "activity-layers-subscription" }, listener: undefined, item: undefined, update: undefined, raw: { code: 500, message: "deterministic Activity layer error" } };
      return {
        id,
        initialEvents: [
          ...updates,
          clientStatus,
          lostUpdates,
          subscriptionError
        ],
        selectedEventId: updates.at(-1)?.id,
        captureStatus: "capturing"
      };
    }
    case "activity-clock-discontinuity": {
      const sourceEvents = highVolumeEvents(1, 8);
      const anchor = sourceEvents[0]?.timestamp ?? 0;
      const events = sourceEvents.map((event, index) => ({
        ...event,
        logicalEventId: `activity-clock-logical-${index + 1}`,
        timestamp: anchor + (index < 4 ? index * 1_000 : -100_000 + (index - 4) * 1_000)
      }));
      return { id, initialEvents: events, selectedEventId: events.at(-1)?.id, captureStatus: "capturing" };
    }
    case "activity-aggregation-failure":
      return { id, initialEvents: highVolumeEvents(1, 8), captureStatus: "capturing", activityProjectionFailure: "Synthetic Activity aggregation failure for browser verification." };
    case "activity-terminal":
      return {
        id,
        initialEvents: highVolumeEvents(1, 8),
        selectedEventId: highVolumeEventId(4),
        captureStatus: "capturing",
        historyCapacity: { maxRetainedCount: 4, retainedWarningCount: 3 }
      };
    case "activity-rebucket": {
      const initial = highVolumeEvents(1, 8).map((event, index) => ({ ...event, logicalEventId: `activity-rebucket-logical-${index + 1}` }));
      const source = initial.at(-1);
      if (!source) throw new Error("Activity rebucketing scenario requires a source update.");
      return {
        id,
        initialEvents: initial,
        deferredEvents: [{ ...source, id: highVolumeEventId(9), logicalEventId: "activity-rebucket-logical-9", timestamp: source.timestamp + 200_000 }],
        captureStatus: "capturing"
      };
    }
    case "activity-ranking-pages":
      return {
        id,
        initialEvents: highVolumeEvents(1, 120).map((event, index) => ({
          ...event,
          logicalEventId: `activity-ranking-page-logical-${index + 1}`,
          subscription: { ...event.subscription, id: `activity-ranking-page-subscription-${index}` },
          listener: { ...(event.listener ?? { id: `activity-ranking-page-listener-${index % 4}` }), metricOwner: true }
        })),
        selectedEventId: highVolumeEventId(120),
        captureStatus: "capturing"
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
    case "filter-high-cardinality":
      return {
        id,
        initialEvents: highScopeEvents(1, 220),
        captureStatus: "capturing"
      };
    case "filter-active-zero": {
      const statusEvent = canonical[0];
      if (!statusEvent) throw new Error("The canonical scenario must include a Filter event.");
      return {
        id,
        initialEvents: [
          ...canonical,
          {
            ...statusEvent,
            id: "filter-active-zero-client-status",
            kind: "client-status",
            subscription: undefined,
            listener: undefined,
            item: undefined,
            update: undefined,
            raw: { scenario: "filter-active-zero" }
          }
        ],
        captureStatus: "capturing"
      };
    }
    case "filter-no-concrete": {
      const statusEvent = canonical[0];
      if (!statusEvent) throw new Error("The canonical scenario must include a Filter event.");
      return {
        id,
        initialEvents: [{
          ...statusEvent,
          id: "filter-no-concrete-client-status",
          kind: "client-status",
          subscription: undefined,
          listener: undefined,
          item: undefined,
          update: undefined,
          raw: { scenario: "filter-no-concrete" }
        }],
        captureStatus: "capturing"
      };
    }
    case "filter-collision": {
      const first = canonical[0];
      const second = canonical[1];
      if (!first || !second) throw new Error("The canonical scenario must include two Filter events.");
      return {
        id,
        initialEvents: [
          { ...first, id: "filter-collision-position", client: { ...(first.client ?? {}), id: first.client?.id ?? "collision-client", sessionId: "collision-session" }, item: { name: "1", position: 1 } },
          { ...second, id: "filter-collision-name", client: { ...(second.client ?? {}), id: second.client?.id ?? "collision-client", sessionId: "collision-session" }, item: { name: "1", position: 2 } }
        ],
        captureStatus: "capturing"
      };
    }
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
          recovery: "Reload the inspected page with DevTools open"
        }
      };
    case "storage-headroom-warning":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        storageEstimate: { usageBytes: 32 * 1_048_576, quotaBytes: 200 * 1_048_576 }
      };
    case "empty-scope":
      return { id, initialEvents: [], captureStatus: "idle" };
    case "disconnected":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "bridge disconnected"
      };
    case "memory-fallback":
      return {
        id,
        initialEvents: canonical,
        selectedEventId: "scenario-event-3",
        captureStatus: "capturing",
        storage: { mode: "memory", reason: "IndexedDB is unavailable" }
      };
    case "diagnostics-stress":
      return {
        id,
        initialEvents: canonical,
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: [
          ...(topology.captureMessages?.slice(1) ?? []),
          semanticSessionStatus("CONNECTED:WS-STREAMING", "topology-next-session", 7)
        ],
        selectedEventId: "scenario-event-3",
        selectedScope: {
          kind: "session",
          retired: true,
          label: "Historical session topology-small-session"
        },
        captureStatus: "bridge disconnected",
        historyCapacity: {
          maxRetainedCount: 100,
          retainedWarningCount: 1
        }
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
        initialEvents: [
          ...topology.capturedEvents,
          {
            ...priorLocalSource,
            id: "retained-prior-local-evidence",
            timestamp: priorLocalSource.timestamp + 1,
            source: "synthetic",
            synthetic: false,
            update: {
              ...priorLocalSource.update,
              command: "UPDATE",
              fields: { command: "UPDATE", key: "small-alpha", value: "7" },
              changedFields: { value: "7" }
            }
          }
        ],
        captureMessages: [],
        selectedEventId: priorLocalSource.id,
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
    case "local-injection-scenario-edit":
      return localInjectionScenario(id, false, 0);
    case "local-injection-scenario-review":
      return localInjectionScenario(id, true, 0, "delivered", { delayMs: 60_000, speed: 2, play: true });
    case "local-injection-scenario-complete":
      return localInjectionScenario(id, true, 2);
    case "local-injection-scenario-partial":
      return localInjectionScenario(id, true, 1, "partial");
    case "local-injection-scenario-high-volume":
      return localInjectionHighVolumeScenario(id);
    case "local-injection-scenario-stop-in-flight":
      return localInjectionScenario(id, true, 0, "delayed", { play: true });
    case "local-injection-scenario-listener-drift":
      return localInjectionScenario(id, true, 0, "delivered", { driftEventKind: "listener" });
    case "local-injection-scenario-server-drift":
      return localInjectionScenario(id, true, 0, "delivered", { driftEventKind: "server" });
    case "local-injection-scenario-unknown":
      return localInjectionScenario(id, true, 1, "unknown");
    case "local-injection-scenario-unretained":
      return { ...localInjectionScenario(id, true, 1, "delivered"), failLocalEvidenceRetention: true };
    case "local-injection-scenario-cleared":
      return localInjectionScenario(id, true, 2, "delivered", { clearAfterRun: true });
    case "local-injection-scenario-checkpoint-authoring":
      return localInjectionCheckpointScenario(id, "authoring");
    case "local-injection-scenario-checkpoint-review":
      return localInjectionCheckpointScenario(id, "review");
    case "local-injection-scenario-checkpoint-waiting":
      return localInjectionCheckpointScenario(id, "waiting");
    case "local-injection-scenario-checkpoint-pass":
      return localInjectionCheckpointScenario(id, "pass");
    case "local-injection-scenario-checkpoint-fail":
      return localInjectionCheckpointScenario(id, "fail");
    case "local-injection-scenario-checkpoint-wire-unavailable":
      return localInjectionCheckpointScenario(id, "wire-unavailable");
    case "local-injection-scenario-checkpoint-ambiguous-null":
      return localInjectionCheckpointScenario(id, "ambiguous-null");
    case "local-injection-scenario-checkpoint-high-volume":
      return localInjectionCheckpointHighVolumeScenario(id);
  }
}

type CheckpointVisualState = "authoring" | "review" | "waiting" | "pass" | "fail" | "wire-unavailable" | "ambiguous-null";

function localInjectionCheckpointScenario(id: WorkbenchScenarioId, state: CheckpointVisualState): WorkbenchScenario {
  const beforeSteps = state === "ambiguous-null";
  const assertions: readonly ScenarioAssertion[] = state === "waiting"
    ? [{ id: "assertion-waiting-key", kind: "command-key-exists", item: { name: "topology-small-item", position: 1 }, key: "never-arrives", expected: "present", withinActiveMs: 60_000 }]
    : state === "pass"
      ? [{ id: "assertion-correlated-evidence", kind: "correlated-local-evidence-exists", stepId: "step-2" }]
      : state === "fail"
        ? [{ id: "assertion-mismatched-value", kind: "command-field-equals", item: { name: "topology-small-item", position: 1 }, key: "small-alpha", field: "value", expected: "expected-but-not-observed" }]
        : state === "wire-unavailable"
          ? [{ id: "assertion-wire-listeners", kind: "listener-count", stepId: "step-1", count: "delivered", expected: 1 }]
          : state === "ambiguous-null"
            ? [{ id: "assertion-server-null", kind: "command-field-equals", item: { name: "topology-small-item", position: 1 }, key: "small-alpha", field: "note", expected: null }]
            : [{ id: "assertion-delivered", kind: "prior-injection-outcome", stepId: "step-2", expectedDisposition: "delivered" }];
  const review = state !== "authoring";
  const steps = state === "waiting" || state === "pass" || state === "fail" ? 3 : state === "ambiguous-null" ? 1 : 0;
  const base = localInjectionScenario(id, false, 0);
  const configured: WorkbenchScenario = {
    ...base,
    localInjection: {
      ...base.localInjection!,
      scenario: {
        ...base.localInjection!.scenario!,
        checkpoints: [{ name: checkpointVisualName(state), assertions, ...(beforeSteps ? { beforeSteps: true } : {}) }],
        review,
        steps
      }
    }
  };
  if (state === "wire-unavailable") return withWireScenarioSource(configured);
  if (state === "ambiguous-null") return withAmbiguousServerNull(configured);
  return configured;
}

function checkpointVisualName(state: CheckpointVisualState): string {
  switch (state) {
    case "authoring": return "Confirm the reviewed delivery";
    case "review": return "Reviewed local delivery contract";
    case "waiting": return "Wait for the committed key";
    case "pass": return "Correlated Local Evidence retained";
    case "fail": return "Expected failure did not occur";
    case "wire-unavailable": return "Listener count unavailable on wire";
    case "ambiguous-null": return "Server null requires attribution";
  }
}

function localInjectionCheckpointHighVolumeScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const base = localInjectionHighVolumeScenario(id);
  const checkpoints = Array.from({ length: 100 }, (_, index) => ({
    name: `Checkpoint ${String(index + 1).padStart(3, "0")} · retained outcome boundary`,
    assertions: [{ id: `assertion-${index + 1}`, kind: "prior-injection-outcome" as const, stepId: `step-${index + 1}`, expectedDisposition: "delivered" as const }]
  }));
  return {
    ...base,
    localInjection: {
      ...base.localInjection!,
      scenario: { ...base.localInjection!.scenario!, checkpoints }
    }
  };
}

function withWireScenarioSource(scenario: WorkbenchScenario): WorkbenchScenario {
  const selected = scenario.initialEvents.find(({ id }) => id === scenario.selectedEventId);
  if (!selected?.update) throw new Error("Wire Checkpoint scenario requires its selected Item Update.");
  const wire = { ...selected, id: "scenario-wire-update", captureSource: "wire" as const, listener: undefined };
  return {
    ...scenario,
    initialEvents: [...scenario.initialEvents, wire],
    selectedEventId: wire.id,
    localInjection: {
      ...scenario.localInjection!,
      scenario: { ...scenario.localInjection!.scenario!, addEventId: undefined }
    }
  };
}

function withAmbiguousServerNull(scenario: WorkbenchScenario): WorkbenchScenario {
  const selectedId = scenario.selectedEventId;
  const schemaEvents = scenario.initialEvents.map((event): LightstreamerEventEnvelope => event.kind === "item-update" && event.subscription
    ? {
        ...event,
        subscription: { ...event.subscription, fields: [...(event.subscription.fields ?? ["command", "key", "value"]), "note"] },
      }
    : event);
  const selected = schemaEvents.find((event) => event.id === selectedId);
  if (!selected?.update) throw new Error("Ambiguous-null Checkpoint scenario requires its selected Item Update.");
  const ambiguous: LightstreamerEventEnvelope = {
    ...selected,
    id: "scenario-ambiguous-server-null",
    timestamp: selected.timestamp + 10,
    update: {
      ...selected.update,
      command: "UPDATE",
      fields: { command: "UPDATE", key: "small-alpha", note: null },
      changedFields: { note: null }
    }
  };
  const topologySyncFrames = scenario.topologySyncFrames?.map((frame) => frame.type === "lsew:topology-sync-chunk"
    ? {
        ...frame,
        records: frame.records.map((record) => record.kind === "subscription" && record.values?.subscription
          ? { ...record, values: { ...record.values, subscription: { ...(record.values.subscription as Record<string, unknown>), fields: ["command", "key", "value", "note"] } } }
          : record)
      }
    : frame);
  return {
    ...scenario,
    initialEvents: schemaEvents,
    laterEvents: [...(scenario.laterEvents ?? []), ambiguous],
    topologySyncFrames,
    localInjection: {
      ...scenario.localInjection!,
      rawText: JSON.stringify({
        command: "ADD",
        key: "small-alpha",
        isSnapshot: false,
        fields: { command: "ADD", key: "small-alpha", value: "1", note: "explicit Local replacement" }
      }, null, 2),
      scenario: { ...scenario.localInjection!.scenario!, addEventId: undefined }
    }
  };
}

function localInjectionHighVolumeScenario(id: WorkbenchScenarioId): WorkbenchScenario {
  const base = localInjectionCapturedScenario(id);
  const representativeFields = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`field_${String(index + 1).padStart(3, "0")}`, `value-${index + 1}`]));
  const fields = { command: "ADD", key: "high-volume", value: "representative", ...representativeFields };
  const schemaFields = Object.keys(fields);
  return {
    ...base,
    topologySyncFrames: base.topologySyncFrames?.map((frame) => frame.type === "lsew:topology-sync-chunk"
      ? {
          ...frame,
          records: frame.records.map((record) => record.kind === "subscription" && record.values?.subscription
            ? { ...record, values: { ...record.values, subscription: { ...(record.values.subscription as Record<string, unknown>), fields: schemaFields } } }
            : record)
        }
      : frame),
    captureMessages: base.captureMessages?.map((message) => message.payload.subscription
      ? { ...message, payload: { ...message.payload, subscription: { ...(message.payload.subscription as Record<string, unknown>), fields: schemaFields } } }
      : message),
    localInjection: {
      entry: "selection",
      rawText: JSON.stringify({ command: "ADD", key: "high-volume", isSnapshot: false, fields }, null, 2),
      scenario: { authoredSteps: 99 }
    }
  };
}

function localInjectionScenario(
  id: WorkbenchScenarioId,
  review: boolean,
  steps: number,
  executorOutcome: "delivered" | "delayed" | "partial" | "unknown" = "delivered",
  controls: Readonly<{ delayMs?: number; speed?: 0.25 | 0.5 | 1 | 2 | 4; play?: boolean; driftEventKind?: "listener" | "server"; clearAfterRun?: boolean }> = {}
): WorkbenchScenario {
  const topology = getPanelScenario("topology-small");
  const source = topology.capturedEvents.find(({ id: eventId }) => eventId === "event-5") ?? topology.capturedEvents.at(-1);
  if (!source?.update) throw new Error("Topology scenario requires a captured Item Update.");
  const second: LightstreamerEventEnvelope = {
    ...source,
    id: "scenario-compatible-update",
    timestamp: source.timestamp + 1,
    update: {
      ...source.update,
      command: "UPDATE",
      fields: { ...source.update.fields, command: "UPDATE", value: "2" },
      changedFields: { command: "UPDATE", value: "2" }
    }
  };
  const bulk: LightstreamerEventEnvelope = {
    ...second,
    id: "scenario-compatible-bulk-update",
    timestamp: second.timestamp + 1,
    update: {
      ...second.update,
      fields: { ...second.update!.fields, value: "3" },
      changedFields: { command: "UPDATE", value: "3" }
    }
  };
  const driftEvent: LightstreamerEventEnvelope | undefined = controls.driftEventKind === "listener"
    ? undefined
    : controls.driftEventKind === "server"
      ? { ...second, id: "scenario-server-interleave", timestamp: source.timestamp + 2 }
      : undefined;
  const driftFrames = controls.driftEventKind === "listener" ? topology.topologySyncFrames?.map((frame) => {
    const common = { ...frame, syncId: "topology-small-listener-drift-sync", cutoffCaptureSequence: 7, recordCount: 7 };
    return frame.type === "lsew:topology-sync-chunk"
      ? { ...common, records: [...frame.records, { kind: "listener-attachment" as const, id: "topology-small-listener-2-attachment", parentId: "topology-small-subscription", subscriptionId: "topology-small-subscription", pageEpoch: "topology-small-page", captureSequence: 7, values: { clientId: "topology-small-client", sessionId: "topology-small-session", listenerId: "scenario-listener-2", callbacks: ["onItemUpdate"], registrationCount: 1, active: true } }] }
      : common;
  }) : undefined;
  return {
    id,
    initialEvents: [...topology.capturedEvents, second, bulk],
    topologySyncFrames: topology.topologySyncFrames,
    selectedEventId: source.id,
    captureStatus: "capturing",
    localInjection: {
      entry: "selection",
      executorOutcome,
      terminalLimit: false,
      scenario: { addEventId: second.id, review, steps, ...(controls.delayMs !== undefined ? { delayMs: controls.delayMs } : {}), ...(controls.speed !== undefined ? { speed: controls.speed } : {}), ...(controls.play !== undefined ? { play: controls.play } : {}), ...(driftEvent ? { driftEvent } : {}), ...(driftFrames ? { driftFrames } : {}), ...(controls.clearAfterRun ? { clearAfterRun: true } : {}) }
    }
  };
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
