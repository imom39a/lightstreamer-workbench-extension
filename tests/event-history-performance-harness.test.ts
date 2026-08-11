import { describe, expect, it } from "vitest";

import { decodeTopologyCheckpointEvidenceCandidate } from "../src/extension/panel/topology-checkpoint-evidence-codec";
import { journalAccountedBytes, serializeJournalEvidenceCandidate } from "../src/core/event-history-serialization";
import { createStagedTopologyCheckpointCandidate } from "../benchmarks/event-history-performance-harness";

describe("Event History performance checkpoint workload", () => {
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
});
