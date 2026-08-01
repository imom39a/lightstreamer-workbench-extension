import { describe, expect, it } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createEventNormalizer } from "../src/core/event-normalizer";
import {
  createTopologyStateIndex,
  reduceTopologyState
} from "../src/core/topology-state";

describe("topology state", () => {
  it("builds client, session, subscription, item, and listener topology", () => {
    const normalize = createEventNormalizer().normalize;
    const events = [
      normalize(
        createCaptureMessage(
          "client-created",
          {
            client: {
              id: "client-1",
              status: "DISCONNECTED",
              serverAddress: "https://push.example.test/lightstreamer",
              adapterSet: "DEMO",
              libraryVersion: "9.2.3",
              instrumentationSource: "public-api",
              coverageStatus: "full",
              requestedMaxBandwidth: "unlimited",
              keepaliveInterval: 5_000
            }
          },
          1_000
        )
      ),
      normalize(
        createCaptureMessage(
          "client-status",
          {
            client: {
              id: "client-1",
              status: "CONNECTED:WS-STREAMING",
              sessionId: "session-A",
              transport: "ws-streaming",
              serverInstanceAddress: "https://node-a.example.test",
              serverSocketName: "node-a",
              clientIp: "203.0.113.42",
              realMaxBandwidth: 12.5
            }
          },
          2_000
        )
      ),
      normalize(
        createCaptureMessage(
          "subscription-started",
          {
            client: {
              id: "client-1",
              status: "CONNECTED:WS-STREAMING",
              sessionId: "session-A"
            },
            subscription: {
              id: "subscription-1",
              mode: "COMMAND",
              items: ["portfolio"],
              fields: ["command", "key", "price"],
              dataAdapter: "QUOTE",
              selector: "desk-a",
              requestedSnapshot: "yes",
              requestedBufferSize: "10",
              requestedMaxFrequency: "2",
              active: true,
              subscribed: true,
              listenerCount: 1
            },
            listener: { id: "listener-1" },
            raw: { callback: "onSubscription" }
          },
          3_000
        )
      ),
      normalize(
        createCaptureMessage(
          "listener-added",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: { id: "subscription-1", mode: "COMMAND", listenerCount: 1 },
            listener: { id: "listener-1" }
          },
          3_100
        )
      ),
      normalize(
        createCaptureMessage(
          "subscription-frequency",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: {
              id: "subscription-1",
              mode: "COMMAND",
              realMaxFrequency: "1.5",
              active: true,
              subscribed: true
            }
          },
          3_200
        )
      ),
      normalize(
        createCaptureMessage(
          "item-update",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: { id: "subscription-1", mode: "COMMAND" },
            listener: { id: "listener-1" },
            item: { name: "portfolio", position: 1 },
            update: {
              isSnapshot: true,
              fields: { command: "ADD", key: "alpha", price: "10" },
              changedFields: { command: "ADD", key: "alpha", price: "10" }
            }
          },
          4_000
        )
      ),
      normalize(
        createCaptureMessage(
          "end-of-snapshot",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: { id: "subscription-1", mode: "COMMAND" },
            item: { name: "portfolio", position: 1 }
          },
          4_500
        )
      ),
      normalize(
        createCaptureMessage(
          "item-update",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: { id: "subscription-1", mode: "COMMAND" },
            item: { name: "portfolio", position: 1 },
            update: {
              isSnapshot: false,
              fields: { command: "UPDATE", key: "alpha", price: "11" },
              changedFields: { price: "11" }
            }
          },
          5_000
        )
      ),
      normalize(
        createCaptureMessage(
          "lost-updates",
          {
            client: { id: "client-1", sessionId: "session-A" },
            subscription: { id: "subscription-1", mode: "COMMAND" },
            item: { name: "portfolio", position: 1 },
            update: { lostUpdates: 3 }
          },
          5_100
        )
      )
    ];

    const state = reduceTopologyState(events);
    const client = state.clients[0];
    const session = client.sessions[0];
    const subscription = session.subscriptions[0];
    const item = subscription.items[0];

    expect(state.clientCount).toBe(1);
    expect(state.activeSessionCount).toBe(1);
    expect(client.libraryVersion).toBe("9.2.3");
    expect(client.coverageStatus).toBe("full");
    expect(session.id).toBe("session-A");
    expect(session.clientIp).toBe("203.0.113.42");
    expect(subscription.serverEstablished).toBe(true);
    expect(subscription.realMaxFrequency).toBe("1.5");
    expect(subscription.listenerCount).toBe(1);
    expect(subscription.updateCount).toBe(2);
    expect(subscription.lostUpdateCount).toBe(3);
    expect(item.snapshotPhase).toBe("live");
    expect(item.firstUpdateAt).toBe(4_000);
    expect(item.lastUpdateAt).toBe(5_000);
    expect(item.listenerIds).toEqual(["listener-1"]);
  });

  it("marks duplicate active subscriptions and waits for server establishment in a new session", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const append = (
      kind: Parameters<typeof createCaptureMessage>[0],
      payload: Parameters<typeof createCaptureMessage>[1],
      timestamp: number
    ) => index.apply(normalizer.normalize(createCaptureMessage(kind, payload, timestamp)));

    append(
      "client-status",
      { client: { id: "client-1", status: "CONNECTED:WS-STREAMING", sessionId: "one" } },
      1
    );
    for (const id of ["subscription-1", "subscription-2"]) {
      append(
        "subscription-started",
        {
          client: { id: "client-1", sessionId: "one" },
          subscription: {
            id,
            mode: "MERGE",
            items: ["quote"],
            fields: ["price"],
            active: true,
            subscribed: true
          }
        },
        2
      );
    }

    let state = index.snapshot();
    expect(state.clients[0].sessions[0].subscriptions).toHaveLength(2);
    expect(state.clients[0].sessions[0].subscriptions[0].duplicateCount).toBe(2);

    append(
      "client-status",
      { client: { id: "client-1", status: "CONNECTED:HTTP-POLLING", sessionId: "two" } },
      3
    );
    state = index.snapshot();

    expect(state.clients[0].sessions.find((session) => session.id === "two")?.subscriptions).toHaveLength(0);
    expect(state.clients[0].waitingSubscriptions).toHaveLength(2);
    expect(state.clients[0].sessions.find((session) => session.id === "one")?.active).toBe(false);
  });

  it("keeps constructor-only subscriptions visible until they are attached to a client", () => {
    const normalizer = createEventNormalizer();
    const state = reduceTopologyState([
      normalizer.normalize(
        createCaptureMessage("subscription-created", {
          subscription: {
            id: "subscription-1",
            mode: "DISTINCT",
            itemGroup: "portfolio",
            fieldSchema: "quote"
          }
        })
      )
    ]);

    expect(state.unassignedSubscriptions).toHaveLength(1);
    expect(state.unassignedSubscriptions[0].itemGroup).toBe("portfolio");
  });

  it("counts one logical update across listener deliveries and keeps delivery diagnostics", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const updatePayload = {
      client: { id: "client-1", sessionId: "session-A" },
      subscription: {
        id: "subscription-1",
        mode: "MERGE",
        active: true,
        subscribed: true
      },
      item: { name: "quote", position: 1 },
      update: {
        isSnapshot: false,
        fields: { price: "12" },
        changedFields: { price: "12" }
      },
      raw: { logicalEventId: "update-1", callback: "onItemUpdate" }
    } as const;

    index.apply(
      normalizer.normalize(
        createCaptureMessage("listener-added", {
          ...updatePayload,
          listener: {
            id: "listener-1",
            callbacks: ["onItemUpdate"],
            registrationCount: 1
          }
        })
      )
    );
    index.apply(
      normalizer.normalize(
        createCaptureMessage("listener-added", {
          ...updatePayload,
          listener: {
            id: "listener-2",
            callbacks: ["onItemUpdate"],
            registrationCount: 1
          }
        })
      )
    );
    index.apply(
      normalizer.normalize(
        createCaptureMessage("item-update", {
          ...updatePayload,
          listener: { id: "listener-1", metricOwner: true }
        })
      )
    );
    index.apply(
      normalizer.normalize(
        createCaptureMessage("item-update", {
          ...updatePayload,
          listener: { id: "listener-2", metricOwner: false }
        })
      )
    );

    const subscription = index.snapshot().clients[0].sessions[0].subscriptions[0];
    expect(subscription.updateCount).toBe(1);
    expect(subscription.deliveryCount).toBe(2);
    expect(subscription.items[0]).toMatchObject({
      updateCount: 1,
      deliveryCount: 2
    });
    expect(subscription.listeners).toEqual([
      expect.objectContaining({ id: "listener-1", deliveryCount: 1, metricOwner: true }),
      expect.objectContaining({ id: "listener-2", deliveryCount: 1, metricOwner: false })
    ]);
  });

  it("keeps synthetic activity separate from server topology health", () => {
    const server = eventEnvelope("server-update", {
      timestamp: 10,
      synthetic: false,
      source: "server"
    });
    const synthetic = eventEnvelope("synthetic-update", {
      timestamp: 20,
      synthetic: true,
      source: "synthetic",
      update: {
        isSnapshot: true,
        command: "DELETE",
        key: "alpha",
        fields: { command: "DELETE", key: "alpha" },
        changedFields: { command: "DELETE", key: "alpha" }
      }
    });

    const state = reduceTopologyState([server, synthetic]);
    const subscription = state.clients[0].sessions[0].subscriptions[0];
    const item = subscription.items[0];

    expect(subscription.updateCount).toBe(1);
    expect(subscription.syntheticUpdateCount).toBe(1);
    expect(subscription.firstUpdateAt).toBe(10);
    expect(subscription.lastUpdateAt).toBe(10);
    expect(subscription.serverEstablished).toBe(true);
    expect(item.snapshotPhase).toBe("live");
    expect(item.activeCommandKeyCount).toBe(1);
    expect(item.lastCommand).toBe("ADD");
  });

  it("distinguishes exact duplicates from overlapping delivery configurations", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const appendSubscription = (
      id: string,
      requestedMaxFrequency: string,
      requestedBufferSize = "10"
    ) => {
      index.apply(
        normalizer.normalize(
          createCaptureMessage("subscription-started", {
            client: {
              id: "client-1",
              status: "CONNECTED:WS-STREAMING",
              sessionId: "session-A"
            },
            subscription: {
              id,
              mode: "MERGE",
              items: ["quote"],
              fields: ["price"],
              dataAdapter: "QUOTE",
              selector: "desk-a",
              requestedSnapshot: "yes",
              requestedBufferSize,
              requestedMaxFrequency,
              active: true,
              subscribed: true
            },
            raw: { callback: "onSubscription" }
          })
        )
      );
    };

    appendSubscription("subscription-1", "2");
    appendSubscription("subscription-2", "2");
    appendSubscription("subscription-3", "1");

    const subscriptions = index.snapshot().clients[0].sessions[0].subscriptions;
    expect(subscriptions.find(({ id }) => id === "subscription-1")).toMatchObject({
      duplicateKind: "exact",
      exactDuplicateCount: 2,
      overlapCount: 3
    });
    expect(subscriptions.find(({ id }) => id === "subscription-3")).toMatchObject({
      duplicateKind: "overlap",
      exactDuplicateCount: 1,
      overlapCount: 3
    });
  });

  it("freezes compact historical topology, retains five sessions, and waits for establishment", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const apply = (
      kind: Parameters<typeof createCaptureMessage>[0],
      payload: Parameters<typeof createCaptureMessage>[1],
      timestamp: number
    ) => index.apply(normalizer.normalize(createCaptureMessage(kind, payload, timestamp)));

    for (let sessionNumber = 1; sessionNumber <= 7; sessionNumber += 1) {
      const sessionId = `session-${sessionNumber}`;
      apply(
        "client-status",
        {
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId
          }
        },
        sessionNumber * 100
      );
      apply(
        "subscription-started",
        {
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId
          },
          subscription: {
            id: "subscription-1",
            mode: "MERGE",
            items: ["quote"],
            fields: ["price"],
            active: true,
            subscribed: true
          },
          raw: { callback: "onSubscription" }
        },
        sessionNumber * 100 + 1
      );
      apply(
        "item-update",
        {
          client: { id: "client-1", sessionId },
          subscription: { id: "subscription-1", mode: "MERGE" },
          item: { name: "quote", position: 1 },
          update: {
            isSnapshot: false,
            fields: { price: String(sessionNumber) },
            changedFields: { price: String(sessionNumber) }
          },
          raw: { logicalEventId: `update-${sessionNumber}` }
        },
        sessionNumber * 100 + 2
      );
    }

    apply(
      "client-status",
      {
        client: {
          id: "client-1",
          status: "DISCONNECTED:WILL-RETRY",
          sessionId: null
        }
      },
      800
    );

    let client = index.snapshot().clients[0];
    expect(client.sessions.filter(({ historical }) => historical)).toHaveLength(5);
    expect(client.sessions.some(({ id }) => id === "session-1")).toBe(false);
    expect(client.sessions.some(({ id }) => id === "session-2")).toBe(false);
    expect(
      client.sessions.find(({ id }) => id === "session-7")?.subscriptions[0].items[0]
    ).toMatchObject({
      name: "quote",
      updateCount: 1
    });
    expect(client.waitingSubscriptions[0]).toMatchObject({
      id: "subscription-1",
      active: true,
      serverEstablished: false,
      lastSessionId: "session-7"
    });

    apply(
      "client-status",
      {
        client: {
          id: "client-1",
          status: "CONNECTED:WS-STREAMING",
          sessionId: "session-8"
        }
      },
      900
    );
    client = index.snapshot().clients[0];
    expect(client.waitingSubscriptions).toHaveLength(1);
    expect(
      client.sessions.find(({ id }) => id === "session-8")?.subscriptions
    ).toHaveLength(0);

    apply(
      "subscription-started",
      {
        client: {
          id: "client-1",
          status: "CONNECTED:WS-STREAMING",
          sessionId: "session-8"
        },
        subscription: {
          id: "subscription-1",
          mode: "MERGE",
          active: true,
          subscribed: true
        },
        raw: { callback: "onSubscription" }
      },
      901
    );
    client = index.snapshot().clients[0];
    expect(client.waitingSubscriptions).toHaveLength(0);
    expect(
      client.sessions.find(({ id }) => id === "session-8")?.subscriptions
    ).toHaveLength(1);
  });

  it("creates a new lifecycle when the server reuses a frozen session ID", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const status = (sessionId: string | null, timestamp: number) =>
      index.apply(
        normalizer.normalize(
          createCaptureMessage(
            "client-status",
            {
              client: {
                id: "client-1",
                status: sessionId ? "CONNECTED:WS-STREAMING" : "DISCONNECTED",
                sessionId
              }
            },
            timestamp
          )
        )
      );

    status("reused-session", 1);
    status(null, 2);
    const state = status("reused-session", 3);
    const matching = state.clients[0].sessions.filter(
      ({ id }) => id === "reused-session"
    );

    expect(matching).toHaveLength(2);
    expect(new Set(matching.map(({ key }) => key)).size).toBe(2);
    expect(matching.find(({ historical }) => historical)).toMatchObject({
      active: false,
      endedAt: 2
    });
    expect(matching.find(({ active }) => active)).toMatchObject({
      historical: false,
      firstSeenAt: 3
    });
  });

  it("resets only current observations and clears history independently", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    index.apply(
      normalizer.normalize(
        createCaptureMessage("client-status", {
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "session-A"
          }
        })
      )
    );
    index.apply(normalizer.normalize(createCaptureMessage("item-update", eventPayload())));
    index.apply(
      normalizer.normalize(
        createCaptureMessage("client-status", {
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "session-B"
          }
        })
      )
    );
    index.apply(
      normalizer.normalize(
        createCaptureMessage("subscription-started", {
          ...eventPayload(),
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "session-B"
          },
          subscription: {
            ...eventPayload().subscription,
            active: true,
            subscribed: true
          },
          raw: { callback: "onSubscription" }
        })
      )
    );
    index.apply(normalizer.normalize(createCaptureMessage("item-update", {
      ...eventPayload(),
      client: { id: "client-1", sessionId: "session-B" },
      raw: { logicalEventId: "session-B-update" }
    })));

    index.resetCurrentObservations(5_000);
    let state = index.snapshot();
    expect(state.observingSince).toBe(5_000);
    expect(state.clients[0].sessions.filter(({ historical }) => historical)).toHaveLength(1);
    expect(
      state.clients[0].sessions.find(({ id }) => id === "session-B")?.subscriptions[0]
    ).toMatchObject({
      updateCount: 0,
      listenerCount: 1,
      active: true,
      serverEstablished: true
    });

    index.clearHistory();
    state = index.snapshot();
    expect(state.clients[0].sessions.filter(({ historical }) => historical)).toHaveLength(0);
    expect(
      state.clients[0].sessions.find(({ id }) => id === "session-B")?.subscriptions
    ).toHaveLength(1);
  });

  it("keeps recovery with the same session id in one session and records a new epoch", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    const appendStatus = (
      status: string,
      sessionId: string | null,
      timestamp: number
    ) => {
      index.ingest(
        normalizer.normalize(
          createCaptureMessage(
            "client-status",
            { client: { id: "client-1", status, sessionId } },
            timestamp
          )
        )
      );
    };

    appendStatus("CONNECTED:WS-STREAMING", "session-A", 1);
    index.ingest(
      normalizer.normalize(
        createCaptureMessage(
          "subscription-started",
          {
            client: {
              id: "client-1",
              status: "CONNECTED:WS-STREAMING",
              sessionId: "session-A"
            },
            subscription: {
              id: "subscription-1",
              mode: "MERGE",
              items: ["quote"],
              fields: ["price"],
              active: true,
              subscribed: true
            },
            raw: { callback: "onSubscription" }
          },
          2
        )
      )
    );
    appendStatus("DISCONNECTED:TRYING-RECOVERY", null, 3);
    appendStatus("CONNECTED:HTTP-STREAMING", "session-A", 4);

    const client = index.snapshot().clients[0];
    expect(client.sessions).toHaveLength(1);
    expect(client.sessions[0]).toMatchObject({
      id: "session-A",
      historical: false,
      active: true,
      recoveryCount: 1,
      connectionEpochCount: 2
    });
    expect(client.sessions[0].subscriptions).toHaveLength(1);
  });

  it("distinguishes pending from waiting and moves no-snapshot items live on establishment", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    index.ingest(
      normalizer.normalize(
        createCaptureMessage("client-status", {
          client: {
            id: "client-1",
            status: "CONNECTED:WS-STREAMING",
            sessionId: "session-A"
          }
        })
      )
    );
    index.ingest(
      normalizer.normalize(
        createCaptureMessage("subscription-started", {
          client: { id: "client-1", sessionId: "session-A" },
          subscription: {
            id: "subscription-1",
            mode: "MERGE",
            items: ["quote"],
            fields: ["price"],
            requestedSnapshot: "no",
            active: true,
            subscribed: false
          }
        })
      )
    );

    let subscription = index.snapshot().clients[0].waitingSubscriptions[0];
    expect(subscription).toMatchObject({
      statusLabel: "Pending",
      waitingForSession: false,
      serverEstablished: false
    });
    expect(subscription.items[0].snapshotPhase).toBe("not-requested");

    index.ingest(
      normalizer.normalize(
        createCaptureMessage("subscription-started", {
          client: { id: "client-1", sessionId: "session-A" },
          subscription: {
            id: "subscription-1",
            mode: "MERGE",
            active: true,
            subscribed: true
          },
          raw: { callback: "onSubscription" }
        })
      )
    );
    subscription =
      index.snapshot().clients[0].sessions[0].subscriptions[0];
    expect(subscription.statusLabel).toBe("Subscribed");
    expect(subscription.items[0].snapshotPhase).toBe("live");

    index.ingest(
      normalizer.normalize(
        createCaptureMessage("client-status", {
          client: {
            id: "client-1",
            status: "DISCONNECTED:WILL-RETRY",
            sessionId: null
          }
        })
      )
    );
    subscription = index.snapshot().clients[0].waitingSubscriptions[0];
    expect(subscription).toMatchObject({
      statusLabel: "Waiting for session",
      waitingForSession: true
    });
  });

  it("resolves a position-only group item without creating a duplicate node", () => {
    const normalizer = createEventNormalizer();
    const index = createTopologyStateIndex();
    index.ingest(
      normalizer.normalize(
        createCaptureMessage("end-of-snapshot", {
          client: { id: "wire-client", sessionId: "wire-session" },
          subscription: {
            id: "wire-subscription",
            mode: "DISTINCT",
            itemGroup: "dynamic-group",
            fieldSchema: "quote"
          },
          item: { name: null, position: 1 },
          raw: { captureSource: "websocket-tlcp", frameTag: "EOS" }
        })
      )
    );
    index.ingest(
      normalizer.normalize(
        createCaptureMessage("item-update", {
          client: { id: "wire-client", sessionId: "wire-session" },
          subscription: { id: "wire-subscription", mode: "DISTINCT" },
          item: { name: "resolved-quote", position: 1 },
          update: {
            isSnapshot: false,
            fields: { price: "10" },
            changedFields: { price: "10" }
          },
          raw: {
            captureSource: "websocket-tlcp",
            logicalEventId: "wire-update-1"
          }
        })
      )
    );

    const items =
      index.snapshot().clients[0].sessions[0].subscriptions[0].items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "resolved-quote",
      position: 1,
      resolution: "observed",
      updateCount: 1
    });
  });

  it("does not let synthetic source metadata change live session topology", () => {
    const server = eventEnvelope("server-update", {
      timestamp: 10
    });
    const synthetic = eventEnvelope("synthetic-update", {
      timestamp: 20,
      source: "synthetic",
      synthetic: true,
      client: {
        ...server.client!,
        sessionId: "fabricated-session",
        status: "DISCONNECTED"
      }
    });

    const state = reduceTopologyState([server, synthetic]);
    expect(state.clients[0].sessions).toHaveLength(1);
    expect(state.clients[0].sessions[0].id).toBe("session-A");
    expect(state.clients[0].lastSeenAt).toBe(10);
    expect(state.clients[0].sessions[0].subscriptions[0]).toMatchObject({
      updateCount: 1,
      syntheticUpdateCount: 1,
      serverEstablished: true
    });
  });
});

function eventPayload() {
  return {
    client: { id: "client-1", sessionId: "session-A" },
    subscription: {
      id: "subscription-1",
      mode: "COMMAND",
      items: ["portfolio"],
      fields: ["command", "key", "price"],
      active: true,
      subscribed: true
    },
    listener: { id: "listener-1", metricOwner: true },
    item: { name: "portfolio", position: 1 },
    update: {
      isSnapshot: false,
      command: "ADD",
      key: "alpha",
      fields: { command: "ADD", key: "alpha", price: "10" },
      changedFields: { command: "ADD", key: "alpha", price: "10" }
    },
    raw: { logicalEventId: "update-1", callback: "onItemUpdate" }
  };
}

function eventEnvelope(
  id: string,
  overrides: Partial<LightstreamerEventEnvelope> = {}
): LightstreamerEventEnvelope {
  const payload = eventPayload();
  return {
    id,
    timestamp: 10,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    client: payload.client,
    subscription: payload.subscription,
    listener: payload.listener,
    item: payload.item,
    update: payload.update,
    raw: payload.raw,
    ...overrides
  };
}
