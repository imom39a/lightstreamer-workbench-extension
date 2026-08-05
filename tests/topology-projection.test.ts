import { describe, expect, it } from "vitest";

import { TOPOLOGY_OBSERVATION_VERSION } from "../src/bridge/messages";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

function subscriptionEvent(
  id: string,
  subscriptionId: string,
  pageEpoch?: string,
  captureSequence = 1
): LightstreamerEventEnvelope {
  const client = {
    id: `client-${pageEpoch ?? "legacy"}`,
    status: "CONNECTED:WS-STREAMING",
    sessionId: `session-${pageEpoch ?? "legacy"}`
  };
  const subscription = {
    id: subscriptionId,
    mode: "MERGE",
    items: ["item-1"],
    fields: ["value"],
    active: true,
    subscribed: true
  };
  return {
    id,
    timestamp: 1_700_000_000_000 + captureSequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "subscription-started",
    client,
    subscription,
    ...(pageEpoch
      ? {
          topology: {
            version: TOPOLOGY_OBSERVATION_VERSION,
            kind: "subscription-started" as const,
            pageEpoch,
            captureSequence,
            provenance: { instrumentationSource: "official-public-api" as const },
            coverage: { status: "complete" as const, getters: {} },
            client,
            subscription
          }
        }
      : {})
  };
}

describe("topology projection", () => {
  it("owns legacy reconstruction behind the same snapshot interface", () => {
    const projection = createTopologyProjection();
    projection.ingestHistory(subscriptionEvent("legacy-1", "legacy-sub"));

    expect(projection.status()).toMatchObject({
      semanticActive: false,
      syncState: "legacy",
      coverage: null
    });
    expect(projection.snapshot().clients[0].sessions[0].subscriptions[0].id).toBe(
      "legacy-sub"
    );
  });

  it("switches semantic pages atomically and rejects retired-page events", () => {
    const projection = createTopologyProjection();
    const pageA = subscriptionEvent("semantic-a", "sub-a", "page-a", 1);
    const pageB = subscriptionEvent("semantic-b", "sub-b", "page-b", 1);

    expect(projection.ingestCapture(pageA)).toEqual({
      accepted: true,
      resetConsumerState: true
    });
    expect(projection.status()).toMatchObject({
      semanticActive: true,
      syncState: "retired",
      coverage: { status: "complete" }
    });
    expect(projection.snapshot().clients[0].sessions[0].subscriptions[0].id).toBe(
      "sub-a"
    );

    expect(projection.ingestCapture(pageB)).toEqual({
      accepted: true,
      resetConsumerState: true
    });
    expect(projection.snapshot().clients[0].sessions[0].subscriptions[0].id).toBe(
      "sub-b"
    );

    const stale = subscriptionEvent("semantic-stale", "stale-sub", "page-a", 2);
    expect(projection.ingestCapture(stale).accepted).toBe(false);
    expect(projection.ingestHistory({ ...stale, topology: undefined })).toBe(false);
    expect(JSON.stringify(projection.snapshot())).not.toContain("stale-sub");
  });

  it("uses an equal-depth fallback only when it preserves semantic nodes and adds live branches", () => {
    const projection = createTopologyProjection();
    const semantic = subscriptionEvent("semantic-1", "semantic-sub", "page-a", 1);
    projection.ingestCapture(semantic);
    projection.ingestCapture({
      ...semantic,
      id: "legacy-semantic-copy",
      topology: undefined
    });
    projection.ingestCapture(subscriptionEvent("legacy-extra", "legacy-sub"));

    const state = projection.snapshot();
    const subscriptionIds = state.clients.flatMap((client) =>
      client.sessions.flatMap((session) =>
        session.subscriptions.map((subscription) => subscription.id)
      )
    );

    expect(subscriptionIds).toEqual(expect.arrayContaining(["semantic-sub", "legacy-sub"]));
    expect(projection.status()).toMatchObject({
      semanticActive: false,
      syncState: "legacy",
      coverage: null
    });
  });

  it("keeps semantic ownership when fallback evidence moves the same subscription", () => {
    const projection = createTopologyProjection();
    const semantic = subscriptionEvent("semantic-1", "semantic-sub", "page-a", 1);
    projection.ingestCapture(semantic);
    projection.ingestCapture({
      ...semantic,
      id: "legacy-original-session",
      kind: "client-status",
      topology: undefined,
      subscription: undefined
    });
    const moved: LightstreamerEventEnvelope = {
      ...semantic,
      id: "legacy-moved",
      topology: undefined,
      client: {
        ...semantic.client,
        id: semantic.client?.id ?? "client-page-a",
        sessionId: "fallback-session"
      }
    };
    projection.ingestCapture(moved);
    projection.ingestCapture({
      ...moved,
      id: "legacy-extra",
      subscription: { ...moved.subscription, id: "legacy-sub" }
    });

    const state = projection.snapshot();
    const subscriptionIds = state.clients.flatMap((client) =>
      client.sessions.flatMap((session) =>
        session.subscriptions.map((subscription) => subscription.id)
      )
    );

    expect(subscriptionIds).toEqual(["semantic-sub"]);
    expect(projection.status().semanticActive).toBe(true);
  });

  it("refreshes volatile counters and newly observed Listener and Session membership", () => {
    const projection = createTopologyProjection();
    const base = subscriptionEvent("legacy-subscription", "legacy-sub");
    projection.ingestCapture(base);
    projection.ingestHistory(base);
    const update = (id: string, value: number): LightstreamerEventEnvelope => ({
      ...base,
      id,
      timestamp: base.timestamp + value,
      kind: "item-update",
      listener: { id: "listener-1", callbacks: ["onItemUpdate"] },
      item: { name: "item-1", position: 1 },
      update: { isSnapshot: false, fields: { value }, changedFields: { value } },
      raw: { logicalEventId: id, callback: "onItemUpdate" }
    });
    const firstDelivery = update("delivery-1", 1);
    projection.ingestCapture(firstDelivery);
    projection.ingestHistory(firstDelivery);
    const firstSnapshot = projection.snapshot();
    const firstStructureRevision = projection.scopeStructureRevision();
    expect(firstSnapshot.clients[0]?.sessions[0]?.subscriptions[0]).toMatchObject({
      updateCount: 1,
      deliveryCount: 1,
      items: [expect.objectContaining({ updateCount: 1, deliveryCount: 1 })],
      listeners: [expect.objectContaining({ id: "listener-1", deliveryCount: 1 })]
    });

    const secondDelivery = update("delivery-2", 2);
    projection.ingestCapture(secondDelivery);
    projection.ingestHistory(secondDelivery);
    const secondSnapshot = projection.snapshot();
    expect(secondSnapshot).not.toBe(firstSnapshot);
    expect(projection.scopeStructureRevision()).toBe(firstStructureRevision);
    expect(secondSnapshot.clients[0]?.sessions[0]?.subscriptions[0]).toMatchObject({
      updateCount: 2,
      deliveryCount: 2,
      items: [expect.objectContaining({ updateCount: 2, deliveryCount: 2 })],
      listeners: [expect.objectContaining({ id: "listener-1", deliveryCount: 2 })]
    });

    const newMembership: LightstreamerEventEnvelope = {
      ...update("delivery-3", 3),
      client: {
        ...base.client,
        id: base.client?.id ?? "client-legacy",
        sessionId: "session-next"
      },
      listener: { id: "listener-2", callbacks: ["onItemUpdate"] }
    };
    projection.ingestCapture(newMembership);
    projection.ingestHistory(newMembership);
    const membershipSnapshot = projection.snapshot();
    expect(projection.scopeStructureRevision()).toBeGreaterThan(firstStructureRevision);
    expect(membershipSnapshot.clients[0]?.sessions.map(({ id }) => id)).toEqual(
      expect.arrayContaining(["session-legacy", "session-next"])
    );
    const currentSubscription = membershipSnapshot.clients[0]?.sessions
      .find(({ id }) => id === "session-next")
      ?.subscriptions[0];
    expect(currentSubscription?.listeners).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "listener-2", deliveryCount: 1 })
    ]));
    expect(currentSubscription?.items[0]?.listenerIds).toContain("listener-2");
  });

  it("bumps Scope structure revision when the same identities reorder", () => {
    const projection = createTopologyProjection();
    const eventFor = (clientId: string, timestamp: number): LightstreamerEventEnvelope => ({
      ...subscriptionEvent(`reorder-${clientId}-${timestamp}`, `sub-${clientId}`),
      timestamp,
      client: {
        id: clientId,
        status: "CONNECTED:WS-STREAMING",
        sessionId: `session-${clientId}`
      }
    });
    projection.replaceHistory([eventFor("a", 1), eventFor("b", 2)]);
    expect(projection.snapshot().clients.map(({ id }) => id)).toEqual(["a", "b"]);
    const firstRevision = projection.scopeStructureRevision();

    projection.replaceHistory([eventFor("a", 3), eventFor("b", 2)]);

    expect(projection.snapshot().clients.map(({ id }) => id)).toEqual(["b", "a"]);
    expect(projection.scopeStructureRevision()).toBeGreaterThan(firstRevision);
  });
});
