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
});
