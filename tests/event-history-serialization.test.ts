import { describe, expect, it } from "vitest";

import {
  deserializeJournalEvidenceCandidate,
  serializeJournalEvidenceCandidate
} from "../src/core/event-history-serialization";
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
});
