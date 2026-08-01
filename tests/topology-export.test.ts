import { describe, expect, it } from "vitest";

import {
  createTopologyStructuredSnapshot,
  serializeTopologySnapshot,
  TOPOLOGY_SNAPSHOT_SCHEMA,
  topologySensitiveCategoryCounts,
  type TopologySnapshotSubscription
} from "../src/extension/panel/topology-export";
import { renderTopologyHtmlReport } from "../src/extension/panel/topology-html-report";
import { type TopologyState, type TopologySubscription } from "../src/core/topology-state";

describe("Topology structured export", () => {
  it("serializes a deterministic compact snapshot with explicit evidence bounds", () => {
    const state = topologyFixture();
    const snapshot = createTopologyStructuredSnapshot(state, projectionStatus(), {
      generatedAt: 1_700_000_000_000,
      retainedEventCount: 12_345,
      redact: []
    });
    const subscription = firstSubscription(snapshot);
    const generations = subscription.semanticLifecycle.commandGenerations as {
      total: number;
      includedCount: number;
      omittedCount: number;
      truncated: boolean;
      samplingStrategy: string;
      entries: Array<{ key: string }>;
    };

    expect(snapshot.schema).toEqual({ id: TOPOLOGY_SNAPSHOT_SCHEMA, version: 1 });
    expect(snapshot.capture.retainedEventCount).toBe(12_345);
    expect(generations).toMatchObject({
      total: 30,
      includedCount: 25,
      omittedCount: 5,
      truncated: true,
      samplingStrategy: "latest"
    });
    expect(generations.entries[0]?.key).toBe("key-6");
    expect(serializeTopologySnapshot(snapshot)).toBe(
      serializeTopologySnapshot(
        createTopologyStructuredSnapshot(state, projectionStatus(), {
          generatedAt: 1_700_000_000_000,
          retainedEventCount: 12_345,
          redact: []
        })
      )
    );
  });

  it("includes complete evidence only when explicitly requested", () => {
    const snapshot = createTopologyStructuredSnapshot(topologyFixture(), projectionStatus(), {
      generatedAt: 1,
      completeEvidence: true,
      redact: []
    });
    const generations = firstSubscription(snapshot).semanticLifecycle.commandGenerations as {
      entries: unknown[];
      omittedCount: number;
      truncated: boolean;
      samplingStrategy: string;
    };
    expect(generations.entries).toHaveLength(30);
    expect(generations).toMatchObject({
      omittedCount: 0,
      truncated: false,
      samplingStrategy: "complete"
    });
    expect(snapshot.privacy.completeEvidenceIncluded).toBe(true);
  });

  it("redacts selected categories and always excludes credential-like data", () => {
    const state = topologyFixture();
    const redacted = createTopologyStructuredSnapshot(state, projectionStatus(), {
      generatedAt: 1
    });
    const redactedJson = serializeTopologySnapshot(redacted);
    expect(redactedJson).not.toContain("orders/private");
    expect(redactedJson).not.toContain("customer-1");
    expect(redactedJson).not.toContain("10.0.0.5");
    expect(redactedJson).toContain("[REDACTED:item-names]");

    state.clients[0]!.serverAddress = "node/path?token=secret-token&mode=streaming";
    const reviewed = createTopologyStructuredSnapshot(state, projectionStatus(), {
      generatedAt: 1,
      redact: []
    });
    const reviewedJson = serializeTopologySnapshot(reviewed);
    expect(reviewedJson).toContain("orders/private");
    expect(reviewedJson).not.toContain("user:password");
    expect(reviewedJson).not.toContain("authorization");
    expect(reviewedJson).not.toContain("secret-token");
    expect(reviewedJson).toContain("mode=streaming");
    expect(reviewed.privacy.credentialsExcluded).toBe(true);
  });

  it("captures an immutable document while the source Topology continues changing", () => {
    const state = topologyFixture();
    const snapshot = createTopologyStructuredSnapshot(state, projectionStatus(), {
      generatedAt: 1,
      redact: []
    });
    const before = serializeTopologySnapshot(snapshot);
    state.clients[0]!.sessions[0]!.subscriptions[0]!.commandGenerations.push({
      id: "generation-later",
      itemId: "item-later",
      key: "later",
      command: "ADD",
      captureSequence: 999,
      inferredChildren: []
    });
    state.clients[0]!.sessions[0]!.subscriptions[0]!.items[0]!.name = "changed";

    expect(serializeTopologySnapshot(snapshot)).toBe(before);
    expect(
      (firstSubscription(snapshot).semanticLifecycle.commandGenerations as { total: number }).total
    ).toBe(30);
    expect(topologySensitiveCategoryCounts(state)["command-keys"]).toBe(31);
  });

  it("renders a self-contained offline HTML report with snapshot parity", () => {
    const snapshot = createTopologyStructuredSnapshot(topologyFixture(), projectionStatus(), {
      generatedAt: 1_700_000_000_000,
      retainedEventCount: 44,
      redact: []
    });
    const html = renderTopologyHtmlReport(snapshot);

    expect(html).toContain("<!doctype html>");
    expect(html).toContain(snapshot.schema.id);
    expect(html).toContain(snapshot.generatedAt);
    expect(html).toContain("Client Count</span><strong>1");
    expect(html).toContain("COMMAND generations · 25 shown / 30 total · 5 omitted from report · snapshot included 25 (latest)");
    expect(html).toContain("Library Version</dt><dd>9.0.0");
    expect(html).toContain("Instrumentation Source</dt><dd>api");
    expect(html).toContain("Historical</dt><dd>false");
    expect(html).toContain('id="topology-search"');
    expect(html).toContain("data-search-node");
    expect(html).not.toMatch(/<(?:link|img|iframe)\b/i);
    expect(html).not.toMatch(/\b(?:src|href)=["']https?:/i);
    expect(html).not.toMatch(/@import|fetch\(|XMLHttpRequest|analytics/i);
  });

  it("escapes hostile captured strings and keeps large compact evidence bounded", () => {
    const state = topologyFixture();
    state.clients[0]!.id = '</script><script>globalThis.pwned=true</script><img src=x onerror=alert(1)>';
    const subscription = state.clients[0]!.sessions[0]!.subscriptions[0]!;
    subscription.id = '<svg onload="alert(1)">';
    subscription.commandGenerations = Array.from({ length: 1_000 }, (_, index) => ({
      id: `hostile-generation-${index + 1}`,
      itemId: "item-1",
      key: `<key-${index + 1}>`,
      command: "ADD",
      captureSequence: index + 1,
      inferredChildren: []
    }));
    const snapshot = createTopologyStructuredSnapshot(state, projectionStatus(), {
      generatedAt: 1,
      completeEvidence: true,
      redact: []
    });
    const html = renderTopologyHtmlReport(snapshot);

    expect(html).not.toContain("</script><script>globalThis.pwned");
    expect(html).not.toContain('<svg onload="alert(1)">');
    expect(html).toContain("&lt;/script&gt;&lt;script&gt;globalThis.pwned=true");
    expect(html.match(/hostile-generation-/g)).toHaveLength(25);
    expect(html).toContain("25 shown / 1,000 total · 975 omitted from report · snapshot included 1,000 (complete)");
  });
});

function firstSubscription(
  snapshot: ReturnType<typeof createTopologyStructuredSnapshot>
): TopologySnapshotSubscription {
  const subscription = snapshot.clients[0]?.sessions[0]?.subscriptions[0];
  if (!subscription) throw new Error("missing exported subscription");
  return subscription;
}

function projectionStatus() {
  return {
    semanticActive: true,
    syncState: "complete" as const,
    coverage: { status: "complete" as const, getters: {} }
  };
}

function topologyFixture(): TopologyState {
  const subscription = subscriptionFixture();
  return {
    observingSince: 100,
    clients: [
      {
        id: "client-private",
        status: "CONNECTED:WS-STREAMING",
        serverAddress: "https://user:password@example.test/lightstreamer?token=secret-token",
        adapterSet: "PRIVATE_ADAPTER",
        libraryVersion: "9.0.0",
        instrumentationSource: "api",
        coverageStatus: "full",
        normalizedStatus: "connected",
        firstSeenAt: 100,
        lastSeenAt: 200,
        clientListenerIds: ["client-listener-private"],
        waitingSubscriptions: [],
        sessions: [
          {
            key: "session-key-private",
            id: "session-private",
            active: true,
            historical: false,
            status: "CONNECTED:WS-STREAMING",
            normalizedStatus: "connected",
            transport: "WS-STREAMING",
            serverInstanceAddress: "https://server.test/path?authorization=Bearer",
            serverSocketName: "socket-private",
            clientIp: "10.0.0.5",
            firstSeenAt: 100,
            lastSeenAt: 200,
            endedAt: null,
            observingSince: 100,
            connectionEpochCount: 1,
            recoveryCount: 0,
            subscriptions: [subscription]
          }
        ]
      }
    ],
    unassignedSubscriptions: [],
    clientCount: 1,
    activeSessionCount: 1,
    historicalSessionCount: 0,
    subscriptionCount: 1,
    activeSubscriptionCount: 1,
    serverEstablishedSubscriptionCount: 1,
    itemCount: 1,
    listenerCount: 1
  };
}

function subscriptionFixture(): TopologySubscription {
  return {
    id: "subscription-private",
    mode: "COMMAND",
    configuredItems: ["orders/private"],
    fields: ["command", "key", "value", "authorization"],
    fieldSchema: null,
    commandSecondLevelFields: ["detail", "api_key"],
    clientId: "client-private",
    sessionKey: "session-key-private",
    lastSessionId: "session-private",
    active: true,
    serverEstablished: true,
    statusLabel: "Subscribed",
    pendingSince: null,
    waitingForSession: false,
    listenerIds: ["listener-private"],
    listeners: [
      {
        id: "listener-private",
        attachmentIds: ["attachment-private"],
        callbacks: ["onItemUpdate"],
        registrationCount: 1,
        active: true,
        metricOwner: true,
        deliveryCount: 30,
        firstDeliveryAt: 101,
        lastDeliveryAt: 200
      }
    ],
    listenerCount: 1,
    updateCount: 30,
    syntheticUpdateCount: 0,
    deliveryCount: 30,
    firstUpdateAt: 101,
    lastUpdateAt: 200,
    lastSyntheticUpdateAt: null,
    lostUpdateCount: 2,
    errorCount: 1,
    createdAt: 100,
    startedAt: 101,
    endedAt: null,
    duplicateKind: "none",
    duplicateCount: 1,
    exactDuplicateCount: 1,
    overlapCount: 1,
    captureSource: "listener",
    historical: false,
    establishments: [
      { id: "establishment-private", epoch: 1, captureSequence: 1 }
    ],
    commandGenerations: Array.from({ length: 30 }, (_, index) => ({
      id: `generation-private-${index + 1}`,
      itemId: "item-private",
      key: index === 0 ? "customer-1" : `key-${index + 1}`,
      command: "ADD",
      captureSequence: index + 1,
      inferredChildren: []
    })),
    items: [
      {
        id: "item-private",
        name: "orders/private",
        position: 1,
        resolution: "configured",
        updateCount: 30,
        syntheticUpdateCount: 0,
        deliveryCount: 30,
        firstUpdateAt: 101,
        lastUpdateAt: 200,
        lastSyntheticUpdateAt: null,
        snapshotPhase: "live",
        lostUpdateCount: 2,
        activeCommandKeyCount: 30,
        deletedCommandKeyCount: 0,
        lastCommand: "ADD",
        listenerIds: ["listener-private"]
      }
    ]
  };
}
