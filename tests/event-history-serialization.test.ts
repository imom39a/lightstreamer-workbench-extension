import { describe, expect, it, vi } from "vitest";

import {
  deserializeJournalEvidenceCandidate,
  JOURNAL_LOGICAL_FRAME_BYTES,
  JOURNAL_LOGICAL_FRAME_VERSION,
  journalAccountedBytes,
  serializeJournalEvidenceCandidate
} from "../src/core/event-history-serialization";
import { estimateHistoryCandidateBytes } from "../src/core/event-history-capacity";
import { type EvidenceCandidate } from "../src/core/event-history-authoritative";

describe("journal replay serialization", () => {
  it("round-trips undefined and supported unknown primitive values without invalid JSON", () => {
    const candidate: EvidenceCandidate = {
      id: "unknown-values",
      kind: "topology-checkpoint",
      checkpoint: {
        explicitUndefined: undefined,
        values: [undefined, NaN, Infinity, -Infinity, -0, 7n]
      }
    };

    const serialized = serializeJournalEvidenceCandidate(candidate);
    expect(() => JSON.parse(serialized.payload)).not.toThrow();
    const restored = deserializeJournalEvidenceCandidate(serialized.payload);
    const values = restored.kind === "topology-checkpoint" ? restored.checkpoint.values as unknown[] : [];
    expect(restored.kind).toBe("topology-checkpoint");
    expect(restored.kind === "topology-checkpoint" && restored.checkpoint.explicitUndefined).toBeUndefined();
    expect(values[0]).toBeUndefined();
    expect(Number.isNaN(values[1] as number)).toBe(true);
    expect(values[2]).toBe(Infinity);
    expect(values[3]).toBe(-Infinity);
    expect(Object.is(values[4], -0)).toBe(true);
    expect(values[5]).toBe(7n);
    expect(serialized.bytes).toBe(new TextEncoder().encode(serialized.payload).byteLength);
  });

  it("uses one canonical logical frame for capacity accounting", () => {
    const candidate: EvidenceCandidate = {
      id: "framed-candidate",
      kind: "topology-checkpoint",
      checkpoint: { z: 1, a: "stable" }
    };
    const serialized = serializeJournalEvidenceCandidate(candidate);

    expect(JOURNAL_LOGICAL_FRAME_VERSION).toBe(1);
    expect(JOURNAL_LOGICAL_FRAME_BYTES).toBe(8);
    expect(journalAccountedBytes(serialized.bytes)).toBe(serialized.bytes + 8);
    expect(estimateHistoryCandidateBytes(candidate)).toBe(serialized.bytes + 8);
    expect(serializeJournalEvidenceCandidate({ ...candidate, checkpoint: { a: "stable", z: 1 } }).payload).toBe(serialized.payload);
  });

  it("does not recursively decode an ordinary JSON-rich replay payload", () => {
    const candidate: EvidenceCandidate = {
      id: "json-rich",
      kind: "topology-checkpoint",
      checkpoint: {
        nested: { values: Array.from({ length: 32 }, (_, index) => ({ index, value: "payload" })) }
      }
    };
    const serialized = serializeJournalEvidenceCandidate(candidate);
    const fromEntries = vi.spyOn(Object, "fromEntries");

    expect(deserializeJournalEvidenceCandidate(serialized.payload)).toEqual(candidate);
    expect(fromEntries).not.toHaveBeenCalled();

    fromEntries.mockRestore();
  });
});
