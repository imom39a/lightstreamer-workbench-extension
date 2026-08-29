import { type EventSubscription, type LightstreamerEventEnvelope } from "../../src/core/event-envelope";
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
import type { DiagnosticObservationInput } from "../../src/core/diagnostic-observation";

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
  "integrated-activity-main",
  "integrated-activity-single-snapshot",
  "integrated-activity-held-source",
  "integrated-activity-pager-growth",
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
  "diagnostic-server-callbacks",
  "diagnostic-anomalies",
  "diagnostic-subscription-context",
  "notifications-volume",
  "notifications-empty",
  "notifications-operational",
  "raw-evidence",
  "filter-find",
  "filter-hidden-selection",
  "local-injection-retention-failure",
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
  ,"local-injection-scenario-diagnostic-authoring"
  ,"local-injection-scenario-diagnostic-review"
  ,"local-injection-scenario-diagnostic-waiting"
  ,"local-injection-scenario-diagnostic-pass"
  ,"local-injection-scenario-diagnostic-fail"
  ,"local-injection-scenario-diagnostic-unavailable"
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
  diagnosticJournal?: "available" | "unsupported";
  diagnosticObservationsAfterReview?: readonly DiagnosticObservationInput[];
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
    case "integrated-activity-pager-growth":
      return { id, initialEvents: highVolumeEvents(1, 60), deferredEvents: highVolumeEvents(61, 1), captureStatus: "capturing" };
    case "integrated-activity-held-source": {
      const source = highVolumeEvents(1, 1)[0]!;
      const startedAt = Math.floor(source.timestamp / 10_000) * 10_000;
      const capturedUpdate = (sequence: number, offset: number): LightstreamerEventEnvelope => ({
        ...source,
        id: `activity-held-source-${sequence}`,
        logicalEventId: `activity-held-source-logical-${sequence}`,
        timestamp: startedAt + offset
      });
      return {
        id,
        initialEvents: [capturedUpdate(1, 0), capturedUpdate(2, 1_000), capturedUpdate(3, 2_000)],
        deferredEvents: [capturedUpdate(4, 300_000)],
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
    case "integrated-activity-main":
      return integratedActivityMainScenario(id);
    case "integrated-activity-single-snapshot":
      return integratedActivitySingleSnapshotScenario(id);
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
    case "notifications-empty":
      return { id, initialEvents: [], captureStatus: "idle" };
    case "notifications-operational":
      return { id, initialEvents: [], captureStatus: "idle", storage: { mode: "memory", reason: "IndexedDB is unavailable" } };
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
    case "diagnostic-server-callbacks":
      return {
        id,
        initialEvents: diagnosticServerEvents(canonical),
        captureStatus: "capturing"
      };
    case "diagnostic-anomalies":
      return {
        id,
        initialEvents: [],
        laterEvents: diagnosticAnomalyEvents(canonical),
        topologySyncFrames: topology.topologySyncFrames,
        captureMessages: topology.captureMessages,
        captureStatus: "capturing",
        selectedScope: { kind: "subscription", retired: false, label: "topology-small-subscription" }
      };
    case "diagnostic-subscription-context":
      return {
        id,
        initialEvents: diagnosticSubscriptionContextEvents(canonical),
        captureStatus: "capturing",
        selectedScope: {
          kind: "subscription",
          retired: false,
          label: "duplicate-a"
        }
      };
    case "notifications-volume": {
      const notices = notificationSnapshotEvents(canonical);
      return {
        id,
        initialEvents: notices.slice(0, 152),
        deferredEvents: notices.slice(152),
        selectedEventId: "notification-snapshot-100",
        captureStatus: "capturing"
      };
    }
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
    case "local-injection-retention-failure": {
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
    case "local-injection-scenario-diagnostic-authoring":
      return localInjectionDiagnosticScenario(id, "authoring");
    case "local-injection-scenario-diagnostic-review":
      return localInjectionDiagnosticScenario(id, "review");
    case "local-injection-scenario-diagnostic-waiting":
      return localInjectionDiagnosticScenario(id, "waiting");
    case "local-injection-scenario-diagnostic-pass":
      return localInjectionDiagnosticScenario(id, "pass");
    case "local-injection-scenario-diagnostic-fail":
      return localInjectionDiagnosticScenario(id, "fail");
    case "local-injection-scenario-diagnostic-unavailable":
      return localInjectionDiagnosticScenario(id, "unavailable");
  }
}

type DiagnosticCheckpointVisualState = "authoring" | "review" | "waiting" | "pass" | "fail" | "unavailable";

function localInjectionDiagnosticScenario(id: WorkbenchScenarioId, state: DiagnosticCheckpointVisualState): WorkbenchScenario {
  const affected = { kind: "subscription", pageId: "topology-small-page", clientId: "topology-small-client", sessionId: "topology-small-session", subscriptionId: "topology-small-subscription" } as const;
  const assertion: ScenarioAssertion = {
    id: "assertion-diagnostic", kind: "diagnostic-observation-exists", contractVersion: 1,
    ruleCode: "subscription.lost-updates", lifecycle: "occurrence", minimumSeverity: "warning", affected,
    ...(state === "waiting" ? { withinActiveMs: 60_000 } : {})
  };
  const base = localInjectionScenario(id, false, 0);
  const diagnostic: DiagnosticObservationInput = {
    code: "subscription.lost-updates", severity: "error", lifecycle: { kind: "occurrence", occurrenceId: "scenario-lost-updates" }, affected,
    observedAt: 1_780_872_000_900, observed: "SubscriptionListener reported lost updates.", limitation: "The callback reports a count but not the missing values.", consequence: "The local view may omit updates.", route: { kind: "inspect-affected" }
  };
  return {
    ...base,
    diagnosticJournal: state === "unavailable" ? "unsupported" : "available",
    ...(state === "pass" ? { diagnosticObservationsAfterReview: [diagnostic] } : {}),
    localInjection: {
      ...base.localInjection!,
      scenario: {
        ...base.localInjection!.scenario!,
        checkpoints: [{ name: diagnosticCheckpointVisualName(state), assertions: [assertion], beforeSteps: true }],
        review: state !== "authoring",
        steps: state === "waiting" || state === "pass" || state === "fail" || state === "unavailable" ? 1 : 0
      }
    }
  };
}

function diagnosticCheckpointVisualName(state: DiagnosticCheckpointVisualState): string {
  switch (state) {
    case "authoring": return "Author normalized diagnostic observation";
    case "review": return "Reviewed diagnostic observation contract";
    case "waiting": return "Wait for a later lost-updates observation";
    case "pass": return "Later lost-updates observation exists";
    case "fail": return "Required lost-updates observation is absent";
    case "unavailable": return "Diagnostic Observation journal unavailable";
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
    localInjection: { entry: "selection", execute: true, executorOutcome: outcome }
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

function notificationSnapshotEvents(canonical: readonly LightstreamerEventEnvelope[]): readonly LightstreamerEventEnvelope[] {
  const source = canonical[0]!;
  const client = { id: "notifications-client", status: "CONNECTED:WS-STREAMING", sessionId: "notifications-session" };
  const subscription = { id: "notifications-subscription", mode: "MERGE", items: ["prices"], fields: ["value"], active: true, subscribed: true };
  const make = (id: string, kind: LightstreamerEventEnvelope["kind"], sequence: number): LightstreamerEventEnvelope => ({
    ...source,
    id,
    kind,
    timestamp: source.timestamp + sequence,
    client,
    subscription,
    item: { name: "prices", position: 1 },
    update: undefined,
    listener: undefined,
    raw: { callback: "onEndOfSnapshot", args: ["prices", 1] },
    topology: {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind,
      pageEpoch: "notifications-page",
      captureSequence: sequence,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "complete", getters: {} }
    }
  });
  return [
    { ...make("notifications-client-created", "client-created", 1), subscription: undefined, item: undefined, raw: {} },
    { ...make("notifications-subscription-started", "subscription-started", 2), item: undefined, raw: {} },
    ...Array.from({ length: 190 }, (_, index) => make(`notification-snapshot-${index + 1}`, "end-of-snapshot", index + 3))
  ];
}

function diagnosticServerEvents(canonical: readonly LightstreamerEventEnvelope[]): readonly LightstreamerEventEnvelope[] {
  const source = canonical[0];
  if (!source) throw new Error("The canonical scenario must include a source event for diagnostics.");
  const client = { id: "diagnostic-client", status: "CONNECTED:WS-STREAMING", sessionId: "diagnostic-session", transport: "WS-STREAMING" };
  const topology = (kind: "server-error" | "server-keepalive", captureSequence: number) => ({
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind,
    pageEpoch: "diagnostic-page",
    captureSequence,
    provenance: { instrumentationSource: "official-public-api" as const },
    coverage: { status: "complete" as const, getters: {} },
    client: { id: client.id, sessionId: { state: "real" as const, value: client.sessionId } }
  });
  const serverError: LightstreamerEventEnvelope = {
      ...source,
      id: "diagnostic-server-error",
      timestamp: source.timestamp + 1,
      kind: "server-error",
      client,
      subscription: undefined,
      listener: { id: "diagnostic-listener", callbacks: ["onServerError", "onServerKeepalive"] },
      item: undefined,
      update: undefined,
      serverError: { code: -7, message: "Application denied the operation", messageState: "safe" },
      keepalive: undefined,
      raw: { callback: "onServerError" },
      topology: topology("server-error", 1)
    };
  const serverKeepalive: LightstreamerEventEnvelope = {
      ...source,
      id: "diagnostic-server-keepalive",
      timestamp: source.timestamp + 2,
      kind: "server-keepalive",
      client,
      subscription: undefined,
      listener: { id: "diagnostic-listener", callbacks: ["onServerError", "onServerKeepalive"] },
      item: undefined,
      update: undefined,
      serverError: undefined,
      keepalive: { count: 14, windowId: "diagnostic-session:1", firstObservedAt: source.timestamp, lastObservedAt: source.timestamp + 2, aggregate: true },
      raw: { callback: "onServerKeepalive", aggregation: "fixed-session-window" },
      topology: topology("server-keepalive", 2)
    };
  return Object.freeze([serverError, serverKeepalive]);
}

function diagnosticSubscriptionContextEvents(canonical: readonly LightstreamerEventEnvelope[]): readonly LightstreamerEventEnvelope[] {
  const source = canonical[0];
  if (!source) throw new Error("The canonical scenario must include a source event for diagnostics.");
  const client = { id: "configuration-client", status: "CONNECTED:WS-STREAMING", sessionId: "configuration-session", adapterSet: "DEMO" };
  const topology = (kind: LightstreamerEventEnvelope["kind"], captureSequence: number, reason?: "late-attachment") => ({
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind,
    pageEpoch: "configuration-page",
    captureSequence,
    provenance: { instrumentationSource: "official-public-api" as const },
    coverage: { status: reason ? "partial" as const : "complete" as const, ...(reason ? { reason } : {}), getters: {} }
  });
  const configured = (
    id: string,
    mode: "MERGE" | "RAW",
    captureSequence: number,
    requestedBufferSize: number | null = null
  ): LightstreamerEventEnvelope => ({
    ...source,
    id,
    timestamp: source.timestamp + captureSequence,
    kind: "subscription-started",
    client,
    subscription: {
      id,
      mode,
      items: ["prices"],
      fields: ["price"],
      dataAdapter: "QUOTE_ADAPTER",
      selector: null,
      requestedSnapshot: "yes",
      requestedBufferSize,
      requestedMaxFrequency: null,
      commandSecondLevelFieldSchema: null,
      commandSecondLevelDataAdapter: null,
      active: true,
      subscribed: true
    },
    listener: undefined,
    item: undefined,
    update: undefined,
    raw: { callback: "onSubscription" },
    topology: topology("subscription-started", captureSequence)
  });
  const events: LightstreamerEventEnvelope[] = [{
    ...source,
    id: "configuration-client-status",
    timestamp: source.timestamp + 1,
    kind: "client-status",
    client,
    subscription: undefined,
    listener: undefined,
    item: undefined,
    update: undefined,
    raw: { callback: "onStatusChange" },
    topology: topology("client-status", 1, "late-attachment")
  }, configured("duplicate-a", "MERGE", 2), configured("duplicate-b", "MERGE", 3), configured("semantic-overlap", "MERGE", 4, 10), configured("raw-capability", "RAW", 5, 20)];
  for (let index = 0; index < 6; index += 1) {
    const kind = index % 2 === 0 ? "listener-added" as const : "listener-removed" as const;
    events.push({
      ...source,
      id: `configuration-listener-${index + 1}`,
      timestamp: source.timestamp + 6 + index,
      kind,
      client,
      subscription: { id: "duplicate-a" },
      listener: { id: "configuration-listener", callbacks: ["onItemUpdate"] },
      item: undefined,
      update: undefined,
      raw: { callback: kind === "listener-added" ? "addListener" : "removeListener" },
      topology: topology(kind, 6 + index)
    });
  }
  return Object.freeze(events);
}

function diagnosticAnomalyEvents(canonical: readonly LightstreamerEventEnvelope[]): readonly LightstreamerEventEnvelope[] {
  const source = canonical[0];
  if (!source) throw new Error("The canonical scenario must include a source event for diagnostics.");
  const client = { id: "topology-small-client", status: "CONNECTED:WS-STREAMING", sessionId: "topology-small-session", adapterSet: "DEMO" };
  const topology = (kind: LightstreamerEventEnvelope["kind"], captureSequence: number) => ({
    version: TOPOLOGY_OBSERVATION_VERSION,
    kind,
    pageEpoch: "anomaly-page",
    captureSequence,
    provenance: { instrumentationSource: "official-public-api" as const },
    coverage: { status: "complete" as const, getters: {} }
  });
  const prefix: LightstreamerEventEnvelope[] = [{
    ...source,
    id: "anomaly-client-status",
    timestamp: source.timestamp,
    kind: "client-status",
    client,
    subscription: undefined,
    item: undefined,
    listener: undefined,
    update: undefined,
    topology: topology("client-status", 1)
  }, {
    ...source,
    id: "anomaly-subscription-started",
    timestamp: source.timestamp + 1,
    kind: "subscription-started",
    client,
    subscription: {
      id: "topology-small-subscription",
      mode: "COMMAND",
      items: ["portfolio"],
      fields: ["command", "key", "value"],
      dataAdapter: "PORTFOLIO_ADAPTER",
      requestedSnapshot: "yes",
      requestedBufferSize: null,
      requestedMaxFrequency: null,
      active: true,
      subscribed: true
    },
    item: undefined,
    listener: undefined,
    update: undefined,
    topology: topology("subscription-started", 2)
  }];
  const updates = canonical.slice(0, 4).map((event, index): LightstreamerEventEnvelope => ({
    ...event,
    id: `anomaly-update-${index + 1}`,
    timestamp: source.timestamp + 2 + index,
    client,
    subscription: { ...event.subscription, id: "topology-small-subscription", mode: "COMMAND" },
    item: { name: "topology-small-item", position: 1 },
    topology: topology("item-update", 3 + index)
  }));
  const lost: LightstreamerEventEnvelope = {
    ...source,
    id: "anomaly-lost-updates",
    timestamp: source.timestamp + 8,
    kind: "lost-updates",
    client,
    subscription: { id: "topology-small-subscription", mode: "COMMAND" },
    item: { name: "topology-small-item", position: 1 },
    listener: { id: "anomaly-listener", callbacks: ["onItemLostUpdates"] },
    update: { lostUpdates: 3 },
    raw: { callback: "onItemLostUpdates", args: ["portfolio", 3] },
    topology: topology("lost-updates", 8)
  };
  const unknownKey: LightstreamerEventEnvelope = {
    ...source,
    id: "anomaly-unknown-command-key",
    timestamp: source.timestamp + 7,
    kind: "item-update",
    client,
    subscription: { id: "topology-small-subscription", mode: "COMMAND" },
    item: { name: "topology-small-item", position: 1 },
    listener: { id: "anomaly-listener", callbacks: ["onItemUpdate"] },
    update: {
      isSnapshot: false,
      command: "UPDATE",
      key: "ghost",
      fields: { command: "UPDATE", key: "ghost", value: "not-established" }
    },
    raw: { callback: "onItemUpdate" },
    topology: topology("item-update", 7)
  };
  return Object.freeze([...prefix, ...updates, unknownKey, lost]);
}

function integratedActivityMainScenario(
  id: WorkbenchScenarioId,
): WorkbenchScenario {
  const startedAt = Date.UTC(2026, 7, 17, 14, 30, 0);
  const client = {
    id: "activity-main-client-orders-terminal",
    sessionId: "activity-main-session-2026-08-17-143000",
    status: "CONNECTED",
  };
  const ordersSubscription: EventSubscription = {
    id: "activity-main-orders-command-subscription",
    mode: "COMMAND",
    items: ["portfolio/orders"],
    fields: ["command", "key", "quantity"],
    requestedSnapshot: "yes",
    active: true,
    subscribed: true,
  };
  const tradesSubscription: EventSubscription = {
    id: "activity-main-trades-merge-subscription",
    mode: "MERGE",
    items: ["portfolio/trades"],
    fields: ["price", "size"],
    requestedSnapshot: "yes",
    active: true,
    subscribed: true,
  };
  const sessionStatus: LightstreamerEventEnvelope = {
    id: "activity-main-client-connected",
    timestamp: startedAt,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "client-status",
    client,
    raw: { callback: "onStatusChange", status: "CONNECTED" },
  };
  const sessionEstablished: LightstreamerEventEnvelope = {
    id: "activity-main-session-established",
    timestamp: startedAt + 500,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "client-status",
    client,
    raw: { callback: "onStatusChange", status: "CONNECTED" },
    topology: {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "session-established",
      pageEpoch: "activity-main-page",
      captureSequence: 2,
      timestamp: startedAt + 500,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: {
        status: "complete",
        getters: { clientId: "available", sessionId: "available" },
      },
      client: {
        id: { state: "requested", value: client.id },
        sessionId: { state: "requested", value: client.sessionId },
      },
    },
  };
  const subscriptionStarted: LightstreamerEventEnvelope = {
    id: "activity-main-orders-started",
    timestamp: startedAt + 1_000,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "subscription-started",
    client,
    subscription: ordersSubscription,
    raw: { callback: "onSubscription" },
  };
  const snapshotDeliveries = Array.from(
    { length: 1_692 },
    (_, index): readonly LightstreamerEventEnvelope[] => {
      const logicalSequence = index + 1;
      const logicalEventId = `activity-main-snapshot-logical-${logicalSequence}`;
      const timestamp = startedAt + 2_000 + index * 5;
      const update = {
        isSnapshot: true,
        command: "ADD",
        key: `order-${String(logicalSequence).padStart(4, "0")}`,
        fields: {
          command: "ADD",
          key: `order-${String(logicalSequence).padStart(4, "0")}`,
          quantity: String(100 + logicalSequence),
        },
        changedFields: { quantity: String(100 + logicalSequence) },
      } as const;
      const primary: LightstreamerEventEnvelope = {
        id: `${logicalEventId}-primary-listener`,
        timestamp,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "item-update",
        logicalEventId,
        client,
        subscription: ordersSubscription,
        listener: {
          id: "activity-main-orders-primary-listener",
          callbacks: ["onItemUpdate"],
          metricOwner: true,
        },
        item: { name: "portfolio/orders", position: 1 },
        update,
        raw: { callback: "onItemUpdate", logicalEventId, phase: "SNAPSHOT" },
      };
      return [primary];
    },
  ).flat();
  const finalSnapshotTimestamp = snapshotDeliveries.at(-1)?.timestamp;
  if (finalSnapshotTimestamp === undefined) {
    throw new Error(
      "Integrated Activity fixture requires snapshot deliveries.",
    );
  }
  // Listener callbacks may arrive after the primary listener's final Snapshot
  // callback. Keeping the controlled duplicates at that final timestamp keeps
  // the Snapshot burst contiguous while preserving its delivery count.
  const snapshotDuplicateDeliveries = snapshotDeliveries
    .slice(-4)
    .map((primary): LightstreamerEventEnvelope => ({
      ...primary,
      id: `${primary.logicalEventId}-secondary-listener`,
      timestamp: finalSnapshotTimestamp,
      listener: {
        id: "activity-main-orders-secondary-listener",
        callbacks: ["onItemUpdate"],
        metricOwner: false,
      },
    }));
  const endOfSnapshot: LightstreamerEventEnvelope = {
    id: "activity-main-orders-end-of-snapshot",
    timestamp: startedAt + 10_500,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "end-of-snapshot",
    client,
    subscription: ordersSubscription,
    raw: { callback: "onEndOfSnapshot" },
  };
  const liveServerUpdates = Array.from(
    { length: 8 },
    (_, index): LightstreamerEventEnvelope => {
      const sequence = index + 1;
      const subscription =
        sequence % 2 === 0 ? tradesSubscription : ordersSubscription;
      const itemName =
        subscription === ordersSubscription
          ? "portfolio/orders"
          : "portfolio/trades";
      return {
        id: `activity-main-live-server-${sequence}`,
        timestamp: startedAt + 70_000 + index * 2_000,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "item-update",
        logicalEventId: `activity-main-live-server-logical-${sequence}`,
        client,
        subscription,
        listener: {
          id: `activity-main-live-listener-${subscription.id}`,
          callbacks: ["onItemUpdate"],
          metricOwner: true,
        },
        item: { name: itemName, position: 1 },
        update:
          subscription === ordersSubscription
            ? {
                isSnapshot: false,
                command: "UPDATE",
                key: `order-${String(sequence).padStart(4, "0")}`,
                fields: {
                  command: "UPDATE",
                  key: `order-${String(sequence).padStart(4, "0")}`,
                  quantity: String(500 + sequence),
                },
                changedFields: { quantity: String(500 + sequence) },
              }
            : {
                isSnapshot: false,
                fields: {
                  price: String(95 + sequence),
                  size: String(10 + sequence),
                },
                changedFields: {
                  price: String(95 + sequence),
                  size: String(10 + sequence),
                },
              },
        raw: { callback: "onItemUpdate", phase: "LIVE" },
      };
    },
  );
  const localUpdates = Array.from(
    { length: 3 },
    (_, index): LightstreamerEventEnvelope => {
      const sequence = index + 1;
      return {
      id: `activity-main-local-${sequence}`,
      timestamp: startedAt + (index === 0 ? 50_000 : 90_000 + (index - 1) * 1_000),
        direction: "inbound",
        source: "synthetic",
        captureSource: "listener",
        synthetic: true,
        kind: "item-update",
        logicalEventId: `activity-main-local-logical-${sequence}`,
        client,
        subscription: ordersSubscription,
        listener: {
          id: "activity-main-orders-primary-listener",
          callbacks: ["onItemUpdate"],
          metricOwner: true,
        },
        item: { name: "portfolio/orders", position: 1 },
        update: {
          isSnapshot: false,
          command: "UPDATE",
          key: `order-${String(sequence).padStart(4, "0")}`,
          fields: {
            command: "UPDATE",
            key: `order-${String(sequence).padStart(4, "0")}`,
            quantity: String(800 + sequence),
          },
          changedFields: { quantity: String(800 + sequence) },
        },
        raw: { callback: "onItemUpdate", injection: "LOCAL" },
      };
    },
  );
  const diagnosticMarkers: readonly LightstreamerEventEnvelope[] = [
    {
      id: "activity-main-lost-updates",
      timestamp: startedAt + 95_000,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "lost-updates",
      client,
      subscription: ordersSubscription,
      listener: {
        id: "activity-main-orders-primary-listener",
        callbacks: ["onItemLostUpdates"],
      },
      item: { name: "portfolio/orders", position: 1 },
      update: { lostUpdates: 2 },
      raw: { callback: "onItemLostUpdates", count: 2 },
    },
    {
      id: "activity-main-subscription-error",
      // Shares the loss timestamp so the timeline must expose both immutable
      // diagnostic records through its coincident-marker chooser.
      timestamp: startedAt + 95_000,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "subscription-error",
      client,
      subscription: tradesSubscription,
      raw: {
        callback: "onSubscriptionError",
        code: 17,
        message: "Deterministic trade entitlement diagnostic",
      },
    },
    {
      id: "activity-main-client-stalled",
      timestamp: startedAt + 97_000,
      direction: "inbound",
      source: "server",
      captureSource: "listener",
      synthetic: false,
      kind: "client-status",
      client: { ...client, status: "STALLED" },
      raw: { callback: "onStatusChange", status: "STALLED" },
    },
  ];
  const passiveLiveUpdate: LightstreamerEventEnvelope = {
    id: "activity-main-passive-live-server",
    timestamp: startedAt + 100_000,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    logicalEventId: "activity-main-passive-live-server-logical",
    client,
    subscription: ordersSubscription,
    listener: {
      id: "activity-main-orders-primary-listener",
      callbacks: ["onItemUpdate"],
      metricOwner: true,
    },
    item: { name: "portfolio/orders", position: 1 },
    update: {
      isSnapshot: false,
      command: "UPDATE",
      key: "order-0001",
      fields: { command: "UPDATE", key: "order-0001", quantity: "999" },
      changedFields: { quantity: "999" },
    },
    raw: { callback: "onItemUpdate", phase: "LIVE", passive: true },
  };
  return {
    id,
    initialEvents: [
      sessionStatus,
      sessionEstablished,
      subscriptionStarted,
      ...snapshotDeliveries,
      ...snapshotDuplicateDeliveries,
      endOfSnapshot,
      localUpdates[0]!,
      ...liveServerUpdates,
      ...localUpdates.slice(1),
      ...diagnosticMarkers,
    ],
    deferredEvents: [passiveLiveUpdate],
    selectedEventId: "activity-main-live-server-1",
    captureStatus: "capturing",
  };
}

function integratedActivitySingleSnapshotScenario(
  id: WorkbenchScenarioId,
): WorkbenchScenario {
  const startedAt = Date.UTC(2026, 7, 18, 14, 0, 0);
  const client = {
    id: "activity-single-snapshot-client",
    sessionId: "activity-single-snapshot-session",
    status: "CONNECTED",
  };
  const subscription: EventSubscription = {
    id: "activity-single-snapshot-subscription",
    mode: "MERGE",
    items: ["portfolio/single-snapshot"],
    fields: ["price"],
    requestedSnapshot: "yes",
    active: true,
    subscribed: true,
  };
  const listener = {
    id: "activity-single-snapshot-listener",
    callbacks: ["onItemUpdate"],
    metricOwner: true,
  };
  return {
    id,
    initialEvents: [
      {
        id: "activity-single-snapshot-initial",
        timestamp: startedAt,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "item-update",
        logicalEventId: "activity-single-snapshot-initial-logical",
        client,
        subscription,
        listener,
        item: { name: "portfolio/single-snapshot", position: 1 },
        update: {
          isSnapshot: true,
          fields: { price: "100" },
          changedFields: { price: "100" },
        },
        raw: { callback: "onItemUpdate", phase: "SNAPSHOT" },
      },
      {
        id: "activity-single-snapshot-end",
        timestamp: startedAt + 1,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "end-of-snapshot",
        client,
        subscription,
        raw: { callback: "onEndOfSnapshot" },
      },
      {
        id: "activity-single-snapshot-live-99s",
        timestamp: startedAt + 99_000,
        direction: "inbound",
        source: "server",
        captureSource: "listener",
        synthetic: false,
        kind: "item-update",
        logicalEventId: "activity-single-snapshot-live-logical",
        client,
        subscription,
        listener,
        item: { name: "portfolio/single-snapshot", position: 1 },
        update: {
          isSnapshot: false,
          fields: { price: "101" },
          changedFields: { price: "101" },
        },
        raw: { callback: "onItemUpdate", phase: "LIVE" },
      },
    ],
    captureStatus: "capturing",
  };
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
