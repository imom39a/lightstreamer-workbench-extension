import { describe, expect, it } from "vitest";

import {
  createTopologyCheckpointEvidenceCandidate,
  decodeTopologyCheckpointEvidenceCandidate
} from "../src/extension/panel/topology-checkpoint-evidence-codec";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createStagedTopologyCheckpointCandidate } from "../benchmarks/event-history-performance-harness";
import { TOPOLOGY_OBSERVATION_VERSION } from "../src/bridge/messages";
import { createTopologyProjection } from "../src/extension/panel/topology-projection";

describe("Event History performance checkpoint workload", () => {
  it("constructs the exact browser checkpoint seeds at their requested sizes", () => {
    for (const [seed, syncId, minimumBytes] of [
      ["checkpoint-indexeddb-representative", "sync-representative", 64 * 1_024],
      ["checkpoint-indexeddb-maximum-2MiB", "sync-maximum-2MiB", 2 * 1_048_576]
    ] as const) {
      const candidate = createStagedTopologyCheckpointCandidate(seed, syncId, minimumBytes);
      expect(journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes)).toBe(minimumBytes);
    }
  }, 30_000);

  it("constructs representative and maximum checkpoints through production staging", () => {
    for (const [name, minimumBytes] of [
      ["representative", 64 * 1_024],
      ["maximum-2MiB", 2 * 1_048_576]
    ] as const) {
      const candidate = createStagedTopologyCheckpointCandidate(
        `harness-${name}`,
        `harness-sync-${name}`,
        minimumBytes
      );
      expect(candidate.kind).toBe("topology-checkpoint");
      expect(journalAccountedBytes(serializeJournalEvidenceCandidate(candidate).bytes)).toBe(minimumBytes);
      expect(decodeTopologyCheckpointEvidenceCandidate(candidate), name).not.toBeNull();
    }
  }, 30_000);

  it("rejects a checkpoint whose frames are not in begin/chunk/complete order", () => {
    const candidate = createStagedTopologyCheckpointCandidate("harness-order", "harness-order-sync", 64 * 1_024);
    const frames = decodeTopologyCheckpointEvidenceCandidate(candidate);
    expect(frames).not.toBeNull();

    const result = createTopologyCheckpointEvidenceCandidate([...frames!].reverse());

    expect(result).toEqual({ ok: false, rejection: { code: "UNSUPPORTED_FRAME_SEQUENCE" } });
  });

  it.each([
    ["representative", 64 * 1_024],
    ["maximum-2MiB", 2 * 1_048_576]
  ] as const)("keeps %s checkpoint staging valid while observations interleave between chunks", (_name, minimumBytes) => {
    const source = createStagedTopologyCheckpointCandidate(
      minimumBytes === 64 * 1_024 ? "harness-representative" : "harness-maximum-2MiB",
      `harness-interleave-sync-${minimumBytes}`,
      minimumBytes
    );
    expect(journalAccountedBytes(serializeJournalEvidenceCandidate(source).bytes)).toBe(minimumBytes);
    const frames = decodeTopologyCheckpointEvidenceCandidate(source);
    expect(frames).not.toBeNull();
    const projection = createTopologyProjection();
    const firstFrame = frames![0]!;
    const pageEpoch = firstFrame.pageEpoch;
    const cutoff = firstFrame.cutoffCaptureSequence;
    let observed = 0;

    let finalResult: ReturnType<typeof projection.applySyncFrame> | null = null;
    for (const frame of frames!) {
      if (frame.type === "lsew:topology-sync-complete") {
        finalResult = projection.applySyncFrame(frame);
        continue;
      }
      expect(projection.applySyncFrame(frame).accepted).toBe(true);
      if (frame.type !== "lsew:topology-sync-chunk") continue;
      observed += 1;
      expect(projection.ingestCapture({
        id: `interleaved-observation-${minimumBytes}-${observed}`,
        timestamp: cutoff + observed,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        topology: {
          version: TOPOLOGY_OBSERVATION_VERSION,
          kind: "item-update",
          pageEpoch,
          captureSequence: cutoff + observed,
          provenance: { instrumentationSource: "official-public-api" },
          coverage: { status: "complete", getters: {} },
          values: { interleaved: { state: "real", value: String(observed) } }
        }
      }).accepted).toBe(true);
    }

    expect(finalResult?.accepted).toBe(true);
    expect(finalResult?.candidate?.checkpoint.observations).toHaveLength(observed);
    expect(finalResult?.candidate).toBeDefined();
    expect(decodeTopologyCheckpointEvidenceCandidate(finalResult!.candidate!)).not.toBeNull();
  }, 30_000);
});
