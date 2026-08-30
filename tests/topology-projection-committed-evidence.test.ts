import { describe, expect, it } from "vitest";

import {
  TOPOLOGY_OBSERVATION_VERSION,
  type TopologyAbsoluteRecord,
  type TopologyCoverage
} from "../src/bridge/messages";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createTopologyProjection,
  type TopologyProjection
} from "../src/extension/panel/topology-projection";
import {
  type CommittedEvidence,
  type TopologyCheckpointEvidenceCandidate
} from "../src/core/event-history-authoritative";
import type { TopologyState } from "../src/core/topology-state";

type EvidenceSequence = Readonly<{
  intervalId: string;
  sequence: number;
}>;

const PAGE_EPOCH = "checkpoint-page";
const CLIENT_ID = "checkpoint-client";
const COMMAND_SUBSCRIPTION = "command-sub";
const VALUE_SUBSCRIPTION = "value-sub";

function topologyEvent(
  id: string,
  subscriptionId: string,
  captureSequence: number,
  options: {
    kind?: LightstreamerEventEnvelope["kind"];
    mode?: string;
    coverage?: TopologyCoverage;
    command?: string | null;
    key?: string | null;
    value?: string;
  } = {}
): LightstreamerEventEnvelope {
  const kind = options.kind ?? "subscription-started";
  const mode = options.mode ?? "MERGE";
  const client = {
    id: CLIENT_ID,
    status: "CONNECTED:WS-STREAMING",
    sessionId: "checkpoint-session"
  };
  const base: LightstreamerEventEnvelope = {
    id,
    timestamp: 1_700_000_000_000 + captureSequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind,
    client,
    subscription: {
      id: subscriptionId,
      mode,
      items: ["item-1"],
      fields: ["value"],
      active: true,
      subscribed: true
    },
    topology: {
      version: TOPOLOGY_OBSERVATION_VERSION,
      kind,
      pageEpoch: PAGE_EPOCH,
      captureSequence,
      provenance: { instrumentationSource: "official-public-api" },
      coverage: options.coverage ?? completeCoverage,
      client,
      subscription: { id: subscriptionId, mode }
    }
  };

  if (kind === "item-update") {
    return {
      ...base,
      item: { name: "item-1", position: 1 },
      update: {
        isSnapshot: false,
        fields: { value: options.value ?? "" },
        changedFields: { value: options.value ?? "" },
        ...(options.command !== undefined ? { command: options.command, key: options.key ?? null } : {})
      }
    };
  }

  return base;
}

function checkpointEvidence(
  records: readonly TopologyAbsoluteRecord[],
  cutoffCaptureSequence: number,
  id: string,
  coverage: TopologyCoverage = completeCoverage
): TopologyCheckpointEvidenceCandidate {
  return {
    kind: "topology-checkpoint",
    id,
    checkpoint: {
      pageEpoch: PAGE_EPOCH,
      records,
      cutoffCaptureSequence,
      coverage,
      panelSessionId: "panel-session"
    }
  };
}

function committedEvidence(
  candidate: TopologyCheckpointEvidenceCandidate | LightstreamerEventEnvelope,
  sequence: EvidenceSequence
): CommittedEvidence {
  return {
    ...sequence,
    candidate,
    eventId: candidate.id
  };
}

function checkpointRecords(): TopologyAbsoluteRecord[] {
  const now = 1_700_000_010_000;
  return [
    {
      kind: "page",
      id: PAGE_EPOCH,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      timestamp: now
    },
    {
      kind: "client",
      id: CLIENT_ID,
      parentId: PAGE_EPOCH,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      clientActive: true,
      timestamp: now
    },
    {
      kind: "subscription",
      id: COMMAND_SUBSCRIPTION,
      parentId: CLIENT_ID,
      clientId: CLIENT_ID,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      clientActive: true,
      serverEstablished: true,
      timestamp: now
    },
    {
      kind: "subscription",
      id: VALUE_SUBSCRIPTION,
      parentId: CLIENT_ID,
      clientId: CLIENT_ID,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1,
      clientActive: true,
      serverEstablished: true,
      timestamp: now
    }
  ];
}

function createProjection(): TopologyProjection {
  return createTopologyProjection();
}

const completeCoverage: TopologyCoverage = {
  status: "complete",
  getters: {}
};

const VOLATILE_STATE_KEYS = new Set([
  "observingSince",
  "createdAt",
  "startedAt",
  "endedAt",
  "firstSeenAt",
  "lastSeenAt",
  "firstDeliveryAt",
  "lastDeliveryAt",
  "firstUpdateAt",
  "lastUpdateAt",
  "firstSyntheticUpdateAt",
  "lastSyntheticUpdateAt"
]);

function summarizeTopologySnapshot(value: TopologyState): unknown {
  return sanitizeTopologyValue(value);
}

function sanitizeTopologyValue(candidate: unknown): unknown {
  if (candidate === null || typeof candidate !== "object") {
    return candidate;
  }
  if (Array.isArray(candidate)) {
    return candidate.map((entry) => sanitizeTopologyValue(entry));
  }
  const source = candidate as Record<string, unknown>;
  const entries = Object.entries(source).filter(([key]) => !VOLATILE_STATE_KEYS.has(key));
  return Object.fromEntries(
    entries.map(([key, value]) => [key, sanitizeTopologyValue(value)])
  );
}

function findSubscriptionStates(state: TopologyState, subscriptionId: string) {
  return state.clients
    .flatMap((client) => [
      ...client.waitingSubscriptions,
      ...client.sessions.flatMap((session) => session.subscriptions)
    ])
    .filter(({ id }) => id === subscriptionId);
}

function hydrateCaptureEvents(projection: TopologyProjection): void {
  const events = [
    topologyEvent("stale-seq-1", "stale-sub", 1, { kind: "subscription-started" }),
    topologyEvent("command-sub-start", COMMAND_SUBSCRIPTION, 2, {
      kind: "subscription-started",
      mode: "COMMAND"
    }),
    topologyEvent("command-add", COMMAND_SUBSCRIPTION, 3, {
      kind: "item-update",
      mode: "COMMAND",
      command: "ADD",
      key: "k1",
      value: "one"
    }),
    topologyEvent("command-update", COMMAND_SUBSCRIPTION, 4, {
      kind: "item-update",
      mode: "COMMAND",
      command: "UPDATE",
      key: "k1",
      value: "two"
    }),
    topologyEvent("command-delete", COMMAND_SUBSCRIPTION, 5, {
      kind: "item-update",
      mode: "COMMAND",
      command: "DELETE",
      key: "k1",
      value: "three"
    }),
    topologyEvent("value-sub-start", VALUE_SUBSCRIPTION, 6, {
      kind: "subscription-started",
      mode: "MERGE"
    }),
    topologyEvent("value-update-1", VALUE_SUBSCRIPTION, 7, {
      kind: "item-update",
      mode: "MERGE",
      value: "10"
    }),
    topologyEvent("value-update-2", VALUE_SUBSCRIPTION, 8, {
      kind: "item-update",
      mode: "MERGE",
      value: "20"
    })
  ];
  events.forEach((event, index) => {
    projection.ingestCommittedEvidence(committedEvidence(event, {
      intervalId: "hydrate",
      sequence: index + 1
    }));
  });
}

function committedOrdinaryHistoryEvent(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_010_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: {
      id: CLIENT_ID,
      status: "CONNECTED:WS-STREAMING",
      sessionId: "checkpoint-session"
    },
    subscription: {
      id: COMMAND_SUBSCRIPTION,
      mode: "COMMAND",
      items: ["item-1"],
      fields: ["value"],
      active: true,
      subscribed: true
    },
    item: {
      name: "item-1",
      position: 1
    },
    update: {
      isSnapshot: false,
      command: "UPDATE",
      key: "k2",
      fields: { value: "late" },
      changedFields: { value: "late" }
    }
  };
}

function committedTopologyOrdinaryHistoryEvent(
  id: string,
  options: {
    captureSequence?: number;
    mode?: string;
    command?: string;
    key?: string;
    value?: string;
  } = {}
): LightstreamerEventEnvelope {
  return topologyEvent(id, COMMAND_SUBSCRIPTION, options.captureSequence ?? 9, {
    kind: "item-update",
    mode: options.mode,
    command: options.command ?? "UPDATE",
    key: options.key ?? "k2",
    value: options.value ?? "late"
  });
}

describe("topology committed-evidence ingest", () => {
  it("keeps newer semantic facts while dropping stale-at-or-below cutoff", () => {
    const projection = createProjection();
    hydrateCaptureEvents(projection);

    const sequence: EvidenceSequence = { intervalId: "interval-1", sequence: 1 };
    const checkpoint = committedEvidence(
      checkpointEvidence(checkpointRecords(), 2, "checkpoint-1"),
      sequence
    );

    expect(projection.ingestCommittedEvidence(checkpoint).accepted).toBe(true);

    const ids = projection.snapshot().clients.flatMap((client) =>
      client.sessions.flatMap((session) => session.subscriptions.map(({ id }) => id))
    );

    expect(ids).toContain(COMMAND_SUBSCRIPTION);
    expect(ids).toContain(VALUE_SUBSCRIPTION);
    expect(ids).not.toContain("stale-sub");
  });

  it("replays retained semantic facts equivalently for one-by-one and replayed committed batches", () => {
    const sequenceCounter = { intervalId: "interval-1", sequence: 1 };
    const oneByOne = createProjection();
    hydrateCaptureEvents(oneByOne);

    const replay = createProjection();
    hydrateCaptureEvents(replay);

    const partialCoverage: TopologyCoverage = {
      status: "partial",
      getters: { "ConnectionDetails.getSessionId": "missing" },
      reason: "limit-exceeded"
    };

    const checkpoint = checkpointEvidence(checkpointRecords(), 2, "checkpoint-2", partialCoverage);
    const checkpointCommitted = committedEvidence(checkpoint, { ...sequenceCounter });
    sequenceCounter.sequence += 1;
    const ordinary = committedEvidence(committedOrdinaryHistoryEvent("history-1"), {
      ...sequenceCounter
    });

    expect(oneByOne.ingestCommittedEvidence(checkpointCommitted)).toMatchObject({
      accepted: true,
      checkpoint: {
        syncId: "checkpoint-2",
        pageEpoch: PAGE_EPOCH,
        cutoffCaptureSequence: 2,
        completeness: "PARTIAL"
      }
    });
    expect(oneByOne.ingestCommittedEvidence(ordinary).accepted).toBe(true);

    const replayBatchResult = replay.ingestCommittedEvidence([checkpointCommitted, ordinary]);
    expect(replayBatchResult).toMatchObject({
      accepted: true,
      resetConsumerState: false,
      checkpoint: { completeness: "PARTIAL" }
    });

    const replayState = replay.snapshot();
    const liveState = oneByOne.snapshot();
    expect(summarizeTopologySnapshot(replayState)).toEqual(
      summarizeTopologySnapshot(liveState)
    );

    expect(oneByOne.status()).toMatchObject({
      semanticActive: true,
      syncState: "partial",
      coverage: partialCoverage
    });
    expect(replay.status()).toMatchObject({
      semanticActive: true,
      syncState: "partial",
      coverage: partialCoverage
    });

    const commandSubscriptions = findSubscriptionStates(replayState, COMMAND_SUBSCRIPTION);
    expect(commandSubscriptions.length).toBeGreaterThan(0);
    const commandSubscription =
      commandSubscriptions.find(({ items }) => items.length > 0) ??
      commandSubscriptions[0];
    expect(commandSubscription).toBeDefined();
    expect(commandSubscription).toMatchObject({
      id: COMMAND_SUBSCRIPTION,
      mode: "COMMAND"
    });
    expect(commandSubscription?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lastCommand: "DELETE",
          activeCommandKeyCount: 0,
          deletedCommandKeyCount: 1,
          updateCount: 3
        })
      ])
    );

    const valueSubscriptions = findSubscriptionStates(replayState, VALUE_SUBSCRIPTION);
    expect(valueSubscriptions.length).toBeGreaterThan(0);
    const valueSubscription =
      valueSubscriptions.find(({ items }) => items.length > 0) ??
      valueSubscriptions[0];
    expect(valueSubscription).toBeDefined();
    expect(valueSubscription?.items?.[0]?.updateCount).toBe(2);
    expect(valueSubscription?.items?.[0]?.listenerIds).toEqual(expect.arrayContaining([]));
  });

  it("replays committed topology facts so ordinary entries are semantically projected without pre-ingest", () => {
    const sequenceCounter = { intervalId: "interval-2", sequence: 1 };
    const oneByOne = createProjection();
    hydrateCaptureEvents(oneByOne);
    const replay = createProjection();
    hydrateCaptureEvents(replay);

    const checkpoint = checkpointEvidence(checkpointRecords(), 2, "checkpoint-3");
    const checkpointCommitted = committedEvidence(
      checkpoint,
      { ...sequenceCounter }
    );
    sequenceCounter.sequence += 1;
    const ordinary = committedTopologyOrdinaryHistoryEvent("history-topology", {
      command: "UPDATE",
      key: "k2",
      value: "late",
      mode: "COMMAND"
    });
    const ordinaryCommitted = committedEvidence(ordinary, { ...sequenceCounter });

    expect(oneByOne.ingestCommittedEvidence(checkpointCommitted).accepted).toBe(true);
    expect(oneByOne.ingestCommittedEvidence(ordinaryCommitted).accepted).toBe(true);

    const replayBatchResult = replay.ingestCommittedEvidence([
      checkpointCommitted,
      ordinaryCommitted
    ]);
    expect(replayBatchResult).toMatchObject({
      accepted: true,
      resetConsumerState: false
    });

    const replayState = replay.snapshot();
    const liveState = oneByOne.snapshot();
    expect(summarizeTopologySnapshot(replayState)).toEqual(
      summarizeTopologySnapshot(liveState)
    );

    const commandSubscriptions = findSubscriptionStates(replayState, COMMAND_SUBSCRIPTION);
    const commandSubscription =
      commandSubscriptions.find(({ items }) => items.length > 0) ??
      commandSubscriptions[0];
    expect(commandSubscription?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          lastCommand: "UPDATE",
          activeCommandKeyCount: 1,
          deletedCommandKeyCount: 1,
          updateCount: 4
        })
      ])
    );
  });
});
