import { describe, expect, it } from "vitest";

import {
  TOPOLOGY_OBSERVATION_VERSION,
  TOPOLOGY_SYNC_BEGIN,
  TOPOLOGY_SYNC_CHUNK,
  TOPOLOGY_SYNC_COMPLETE,
  TOPOLOGY_SYNC_VERSION,
  isTopologySyncFrame,
  type TopologyAbsoluteRecord,
  type TopologySyncBeginFrame,
  type TopologySyncChunkFrame,
  type TopologySyncCompleteFrame
} from "../src/bridge/messages";
import type { CommittedEvidence, TopologyCheckpointEvidenceCandidate } from "../src/core/event-history-authoritative";
import {
  createTopologyCheckpointEvidenceCandidate,
  decodeTopologyCheckpointEvidenceCandidate,
  type TopologyCheckpointEvidenceCodecRejection
} from "../src/extension/panel/topology-checkpoint-evidence-codec";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

const PANEL_SESSION_ID = "panel-00000000-0000-4000-8000-000000000001";
const PAGE_EPOCH = "page-a";

function records(): TopologyAbsoluteRecord[] {
  return [
    { kind: "page", id: PAGE_EPOCH, pageEpoch: PAGE_EPOCH, captureSequence: 1 },
    {
      kind: "client",
      id: "client-a",
      parentId: PAGE_EPOCH,
      pageEpoch: PAGE_EPOCH,
      captureSequence: 1
    },
    {
      kind: "subscription",
      id: "subscription-a",
      parentId: "client-a",
      clientId: "client-a",
      pageEpoch: PAGE_EPOCH,
      captureSequence: 2,
      clientActive: true,
      serverEstablished: true
    }
  ];
}

function frameSequence(
  syncId = "sync-a",
  checkpointRecords = records()
): readonly [TopologySyncBeginFrame, TopologySyncChunkFrame, TopologySyncCompleteFrame] {
  const metadata = {
    version: TOPOLOGY_SYNC_VERSION,
    syncId,
    panelSessionId: PANEL_SESSION_ID,
    pageEpoch: PAGE_EPOCH,
    cutoffCaptureSequence: 2,
    chunkCount: 1,
    recordCount: checkpointRecords.length,
    coverage: { status: "complete" as const, getters: {} }
  };
  return [
    { type: TOPOLOGY_SYNC_BEGIN, ...metadata },
    { type: TOPOLOGY_SYNC_CHUNK, ...metadata, chunkIndex: 0, records: checkpointRecords },
    { type: TOPOLOGY_SYNC_COMPLETE, ...metadata }
  ];
}

function committed(candidate: TopologyCheckpointEvidenceCandidate): CommittedEvidence {
  return { intervalId: "interval-a", sequence: 1, eventId: candidate.id, candidate };
}

describe("topology checkpoint evidence codec", () => {
  it("encodes validated frames into immutable evidence with a stable bounded id", () => {
    const source = frameSequence();
    const first = createTopologyCheckpointEvidenceCandidate(source);
    const second = createTopologyCheckpointEvidenceCandidate(source);

    expect(first).toMatchObject({ ok: true, value: { kind: "topology-checkpoint" } });
    if (!first.ok || !second.ok) return;
    expect(first.value.id).toBe(second.value.id);
    const changed = createTopologyCheckpointEvidenceCandidate(
      frameSequence("sync-a", records().map((record) =>
        record.id === "subscription-a" ? { ...record, serverEstablished: false } : record
      ))
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(first.value.id).not.toBe(changed.value.id);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen(first.value.checkpoint)).toBe(true);
    expect(first.value.id).toMatch(
      /^topology-checkpoint:sync-sync-a:session-panel-00000000-0000-4000-8000-00:page-page-a:cutoff-2:hash-[0-9a-f]{16}$/
    );
    expect(first.value.id.length).toBeLessThan(180);
    expect(first.value.id).not.toContain('"records"');
  });

  it("sanitizes metadata segments while retaining a bounded id", () => {
    const source = frameSequence("sync/a value with spaces and / separators");
    const encoded = createTopologyCheckpointEvidenceCandidate(source);

    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.id).toContain("sync-sync-a-value-with-spaces-and-se");
    expect(encoded.value.id).not.toMatch(/[ /]/);
    expect(encoded.value.id).toMatch(/:hash-[0-9a-f]{16}$/);
  });

  it("decodes only a complete committed checkpoint into validated topology frames", () => {
    const encoded = createTopologyCheckpointEvidenceCandidate(frameSequence());
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeTopologyCheckpointEvidenceCandidate(encoded.value);
    expect(decoded).not.toBeNull();
    expect(decoded?.every(isTopologySyncFrame)).toBe(true);
    expect(decoded).toEqual([
      frameSequence()[0],
      { ...frameSequence()[1], records: [records()[1], records()[0], records()[2]] },
      frameSequence()[2]
    ]);
  });

  it("types malformed and unsupported input as rejection and returns null for malformed candidates", () => {
    const malformedFrames = createTopologyCheckpointEvidenceCandidate([
      frameSequence()[0]
    ]);
    expect(malformedFrames).toEqual({
      ok: false,
      rejection: { code: "UNSUPPORTED_FRAME_SEQUENCE" }
    } satisfies { ok: false; rejection: TopologyCheckpointEvidenceCodecRejection });

    const malformedCandidate = {
      kind: "topology-checkpoint",
      id: "malformed",
      checkpoint: { pageEpoch: PAGE_EPOCH, records: "not-an-array" }
    } as unknown as TopologyCheckpointEvidenceCandidate;
    expect(decodeTopologyCheckpointEvidenceCandidate(malformedCandidate)).toBeNull();
  });

  it("does not project a malformed committed checkpoint", () => {
    const projection = createTopologyProjection();
    const malformedCandidate = {
      kind: "topology-checkpoint",
      id: "malformed",
      checkpoint: {
        pageEpoch: PAGE_EPOCH,
        records: [{ kind: "page", id: "", pageEpoch: PAGE_EPOCH, captureSequence: 0 }]
      }
    } as unknown as TopologyCheckpointEvidenceCandidate;

    expect(projection.ingestCommittedEvidence(committed(malformedCandidate))).toEqual({
      accepted: false,
      resetConsumerState: false
    });
    expect(projection.snapshot().clients).toEqual([]);
    expect(projection.snapshot().unassignedSubscriptions).toEqual([]);
  });
});
