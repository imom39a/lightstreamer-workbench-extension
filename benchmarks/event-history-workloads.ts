import { type LightstreamerEventEnvelope, toPersistableEventEnvelope } from "../src/core/event-envelope";
import { createEventSearchText } from "../src/core/event-filter";

/** Kept in step with fixtures/lightstreamer/pages/fixture-client.js ISSUE_16_GROUPS. */
export const ISSUE_16_TOTAL_EVENTS = 1_692;
/** Kept in step with the deterministic Timeline scenario's 20 ms stream interval. */
export const TIMELINE_SUSTAINED_EVENTS_PER_SECOND = 50;

/**
 * Stable, application-neutral event fixtures for Event History measurements.
 * They intentionally exercise the primitive shapes Workbench captures, rather
 * than replaying customer data or assuming an application schema.
 */
export const EVENT_HISTORY_SHAPES = [
  "small-lifecycle",
  "ordinary-item-update",
  "large-json-rich"
] as const;

export type EventHistoryShape = (typeof EVENT_HISTORY_SHAPES)[number];

export type EventHistoryShapeFact = {
  id: EventHistoryShape;
  description: string;
  provenance: string;
  persistedJsonBytes: number;
  indexedDbWritesPerEvent: number;
  searchTokenCount: number;
};

export function createEventHistoryWorkloadEvent(
  shape: EventHistoryShape,
  sequence: number,
  runId = "event-history"
): LightstreamerEventEnvelope {
  const id = `${runId}-${shape}-${sequence}`;
  const timestamp = 1_700_000_000_000 + sequence;
  const common = {
    id,
    timestamp,
    direction: "inbound" as const,
    source: "server" as const,
    captureSource: "listener" as const,
    synthetic: false
  };

  switch (shape) {
    case "small-lifecycle":
      return {
        ...common,
        kind: "client-status",
        client: {
          id: "client-primary",
          status: "CONNECTED:STREAM-SENSING",
          sessionId: "session-primary"
        },
        raw: { status: "CONNECTED:STREAM-SENSING" }
      };
    case "ordinary-item-update":
      return {
        ...common,
        kind: "item-update",
        client: { id: "client-primary", sessionId: "session-primary" },
        subscription: {
          id: "fixture-command",
          mode: "COMMAND",
          items: ["scenario.add-update-delete"],
          fields: ["command", "key", "name", "qty", "status", "version"]
        },
        item: { name: "scenario.add-update-delete", position: 1 },
        update: {
          isSnapshot: sequence < 10,
          key: `fixture-${sequence % 100}`,
          command: sequence % 17 === 0 ? "DELETE" : sequence % 3 === 0 ? "UPDATE" : "ADD",
          fields: {
            command: sequence % 17 === 0 ? "DELETE" : sequence % 3 === 0 ? "UPDATE" : "ADD",
            key: `fixture-${sequence % 100}`,
            name: `Fixture ${sequence % 100}`,
            qty: String(10 + (sequence % 25)),
            status: sequence % 2 === 0 ? "live-update" : "live-add",
            version: String(sequence + 1)
          },
          changedFields: {
            qty: String(10 + (sequence % 25)),
            status: sequence % 2 === 0 ? "live-update" : "live-add",
            version: String(sequence + 1)
          }
        },
        raw: {
          callback: "onItemUpdate",
          fixture: "scenario.add-update-delete",
          logicalEventId: `logical-${sequence}`
        }
      };
    case "large-json-rich":
      return {
        ...common,
        kind: "item-update",
        client: {
          id: "client-primary",
          sessionId: "session-primary",
          serverAddress: "https://stream.example.test/lightstreamer",
          adapterSet: "DEMO",
          libraryVersion: "9.2.3"
        },
        subscription: {
          id: "portfolio-command",
          mode: "COMMAND",
          items: ["portfolio-1", "portfolio-2"],
          fields: ["key", "command", "payload", "status", "version"],
          requestedSnapshot: "yes",
          requestedBufferSize: "unlimited",
          requestedMaxFrequency: "unlimited"
        },
        item: { name: `portfolio-${(sequence % 2) + 1}`, position: (sequence % 2) + 1 },
        update: {
          key: `order-${sequence % 100}`,
          command: "UPDATE",
          fields: {
            key: `order-${sequence % 100}`,
            command: "UPDATE",
            status: "OPEN",
            version: sequence,
            payload: JSON.stringify(largePayload(sequence))
          },
          changedFields: { payload: JSON.stringify(largePayload(sequence)) },
          jsonPatches: {
            "/order/metrics": largePayload(sequence),
            "/order/audit": { receivedAt: timestamp, source: "official-public-api" }
          }
        },
        raw: { callback: "onItemUpdate", logicalEventId: `logical-${sequence}`, payload: largePayload(sequence) }
      };
  }
}

export function representativeEventHistoryShapeFacts(): EventHistoryShapeFact[] {
  return EVENT_HISTORY_SHAPES.map((id) => ({
    id,
    description: shapeDescription(id),
    provenance: shapeProvenance(id),
    persistedJsonBytes: utf8JsonBytes(createEventHistoryWorkloadEvent(id, 42, "shape-fact")),
    searchTokenCount: eventSearchTokenCount(createEventHistoryWorkloadEvent(id, 42, "shape-fact")),
    indexedDbWritesPerEvent: 2 + eventSearchTokenCount(createEventHistoryWorkloadEvent(id, 42, "shape-fact"))
  }));
}

export function utf8JsonBytes(event: LightstreamerEventEnvelope): number {
  return new TextEncoder().encode(JSON.stringify(toPersistableEventEnvelope(event))).byteLength;
}

function shapeDescription(shape: EventHistoryShape): string {
  switch (shape) {
    case "small-lifecycle":
      return "Client lifecycle/status evidence with a compact raw callback payload.";
    case "ordinary-item-update":
      return "Official-fixture COMMAND item update with subscription, item, changed-field, and logical-update evidence.";
    case "large-json-rich":
      return "COMMAND item update carrying nested JSON in raw evidence and JSON patches.";
  }
}

function shapeProvenance(shape: EventHistoryShape): string {
  switch (shape) {
    case "small-lifecycle":
      return "Official-fixture topology lifecycle/status capture shape.";
    case "ordinary-item-update":
      return "Official Lightstreamer fixture COMMAND ItemUpdate shape.";
    case "large-json-rich":
      return "Expanded from the canonical deterministic Workbench JSON-patch scenario to cover a large raw/JSON-rich update.";
  }
}

function eventSearchTokenCount(event: LightstreamerEventEnvelope): number {
  return new Set(
    createEventSearchText(event)
      .trim()
      .toLowerCase()
      .split(/[^a-z0-9_.:-]+/i)
      .filter((token) => token.length > 0)
  ).size;
}

function largePayload(sequence: number) {
  return {
    order: {
      id: `order-${sequence % 100}`,
      venue: "XNYS",
      tags: ["risk-reviewed", "streamed", "customer-visible", "audit-retained"],
      legs: Array.from({ length: 12 }, (_, index) => ({
        id: `${sequence}-${index}`,
        instrument: `instrument-${index}`,
        quantity: 100 + index * 25,
        price: 100.12 + index / 100,
        metadata: "x".repeat(96)
      }))
    },
    diagnostics: {
      traceId: `trace-${sequence.toString(36).padStart(8, "0")}`,
      annotations: Array.from({ length: 8 }, (_, index) => `annotation-${index}-${"y".repeat(48)}`)
    }
  };
}
