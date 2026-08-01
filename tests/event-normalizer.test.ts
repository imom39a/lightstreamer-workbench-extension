import { describe, expect, it } from "vitest";

import {
  TOPOLOGY_OBSERVATION_VERSION,
  createCaptureMessage,
  type TopologyObservation
} from "../src/bridge/messages";
import { toPersistableEventEnvelope } from "../src/core/event-envelope";
import { normalizeCaptureMessage } from "../src/core/event-normalizer";

describe("event normalizer", () => {
  it("preserves COMMAND command and key values", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        client: { id: "client-1" },
        subscription: { id: "subscription-1", mode: "COMMAND" },
        listener: { id: "listener-1" },
        item: { name: "scenario.add-update-delete", position: 1 },
        update: {
          isSnapshot: false,
          fields: {
            command: "ADD",
            key: "gamma",
            name: "Gamma",
            qty: "3"
          },
          changedFields: {
            command: "ADD",
            key: "gamma"
          }
        }
      }),
      "event-42"
    );

    expect(event.id).toBe("event-42");
    expect(event.direction).toBe("inbound");
    expect(event.source).toBe("server");
    expect(event.synthetic).toBe(false);
    expect(event.update?.command).toBe("ADD");
    expect(event.update?.key).toBe("gamma");
  });

  it("keeps current fields and changed fields separate", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        update: {
          fields: {
            command: "UPDATE",
            key: "alpha",
            name: "Alpha",
            qty: "12",
            status: "open"
          },
          changedFields: {
            qty: "12",
            status: "open"
          }
        }
      })
    );

    expect(event.update?.fields).toEqual({
      command: "UPDATE",
      key: "alpha",
      name: "Alpha",
      qty: "12",
      status: "open"
    });
    expect(event.update?.changedFields).toEqual({
      qty: "12",
      status: "open"
    });
  });

  it("preserves snapshot status at update time", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          isSnapshot: true,
          fields: {
            command: "ADD",
            key: "alpha"
          }
        }
      })
    );

    expect(event.item?.name).toBe("scenario.snapshot-basic");
    expect(event.update?.isSnapshot).toBe(true);
  });

  it("maps WebSocket TLCP diagnostics to wire capture source", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          fields: { command: "ADD", key: "alpha" },
          changedFields: { command: "ADD", key: "alpha" }
        },
        raw: { captureSource: "websocket-tlcp" }
      })
    );

    expect(event.source).toBe("server");
    expect(event.captureSource).toBe("wire");
  });

  it("keeps semantic topology in memory and removes it from persistence projections", () => {
    const topology: TopologyObservation = {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "item-update",
      pageEpoch: "page-a",
      captureSequence: 42,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "complete", getters: {} },
      subscription: { id: "sub-a" }
    };
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", { subscription: { id: "sub-a" } }, 10, topology)
    );

    expect(event.topology).toEqual(topology);
    expect(toPersistableEventEnvelope(event)).not.toHaveProperty("topology");
    expect(event.topology).toEqual(topology);
  });

  it("keeps all connection intervals and valueless semantic states", () => {
    const topology: TopologyObservation = {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "client-created",
      pageEpoch: "page-a",
      captureSequence: 1,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "partial", getters: {} },
      client: {
        id: { state: "inferred", value: "client-1" },
        retryDelay: { state: "unknown", reason: "getter-missing" },
        clientIp: { state: "redacted", context: "masked-client-ip" },
        realMaxBandwidth: { state: "unavailable" },
        forcedTransport: { state: "not-applicable" }
      }
    };
    const event = normalizeCaptureMessage(
      createCaptureMessage(
        "client-created",
        {
          client: {
            id: "client-1",
            reverseHeartbeatInterval: 1_000,
            pollingInterval: 2_000,
            idleTimeout: 3_000
          }
        },
        10,
        topology
      )
    );

    expect(event.client).toMatchObject({
      reverseHeartbeatInterval: 1_000,
      pollingInterval: 2_000,
      idleTimeout: 3_000,
      semanticValueStates: {
        retryDelay: { state: "unknown", reason: "getter-missing" },
        clientIp: { state: "redacted", context: "masked-client-ip" },
        realMaxBandwidth: { state: "unavailable" },
        forcedTransport: { state: "not-applicable" }
      }
    });
  });

  it("keeps subscription semantic states live but strips all semantic metadata when persisted", () => {
    const topology: TopologyObservation = {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind: "item-update",
      pageEpoch: "page-a",
      captureSequence: 7,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: { status: "partial", getters: {} },
      client: {
        id: "client-1",
        status: { state: "real", value: "CONNECTED:WS-STREAMING" }
      },
      subscription: {
        id: "subscription-1",
        mode: { state: "requested", value: "COMMAND" },
        active: { state: "real", value: true },
        subscribed: { state: "inferred", value: true },
        listenerCount: { state: "unknown", reason: "getter-missing" },
        dataAdapter: { state: "unavailable" },
        selector: { state: "redacted", context: "capture-boundary" },
        commandSecondLevelDataAdapter: { state: "not-applicable" }
      }
    };
    const event = normalizeCaptureMessage(
      createCaptureMessage(
        "item-update",
        {
          client: { id: "client-1", status: "CONNECTED:WS-STREAMING" },
          subscription: {
            id: "subscription-1",
            mode: "COMMAND",
            active: true,
            semanticValueStates: {
              requestedSnapshot: { state: "requested" }
            }
          },
          item: { name: "orders", position: 1 },
          update: { command: "ADD", key: "order-1", fields: { qty: "10" } }
        },
        10,
        topology
      )
    );

    expect(event.subscription?.semanticValueStates).toEqual({
      requestedSnapshot: { state: "requested" },
      mode: { state: "requested" },
      active: { state: "real" },
      subscribed: { state: "inferred" },
      listenerCount: { state: "unknown", reason: "getter-missing" },
      dataAdapter: { state: "unavailable" },
      selector: { state: "redacted", context: "capture-boundary" },
      commandSecondLevelDataAdapter: { state: "not-applicable" }
    });

    const persisted = toPersistableEventEnvelope(event);
    expect(persisted).not.toHaveProperty("topology");
    expect(persisted.client).not.toHaveProperty("semanticValueStates");
    expect(persisted.subscription).not.toHaveProperty("semanticValueStates");
    expect(persisted).toMatchObject({
      client: { id: "client-1", status: "CONNECTED:WS-STREAMING" },
      subscription: { id: "subscription-1", mode: "COMMAND", active: true },
      item: { name: "orders", position: 1 },
      update: { command: "ADD", key: "order-1", fields: { qty: "10" } }
    });
    expect(event.client).toHaveProperty("semanticValueStates");
    expect(event.subscription).toHaveProperty("semanticValueStates");
  });
});
