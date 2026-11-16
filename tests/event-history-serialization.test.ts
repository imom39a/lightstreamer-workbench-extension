import { describe, expect, it, vi } from "vitest";

import {
  deserializeJournalEvidenceCandidate,
  JOURNAL_LOGICAL_FRAME_BYTES,
  JOURNAL_LOGICAL_FRAME_VERSION,
  journalAccountedBytes,
  serializeJournalEvidenceCandidate,
  utf8ByteLength
} from "../src/core/event-history-serialization";
import { estimateHistoryCandidateBytes } from "../src/core/event-history-capacity";
import { type EvidenceCandidate } from "../src/core/event-history-authoritative";

describe("journal replay serialization", () => {
  it("computes UTF-8 byte length matching TextEncoder for every code-unit class and size", () => {
    const samples = [
      "",
      "ascii only",
      "caf\u00e9 \u00df",
      "\u20ac \u4e2d\u6587 \uffff",
      "\ud83d\ude00 emoji pair",
      "lone high \ud800 surrogate",
      "lone low \udc00 surrogate",
      "trailing high \udbff",
      "\udc00\ud800 reversed pair",
      "\u007f\u0080\u07ff\u0800"
    ];
    for (const sample of samples) {
      expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).byteLength);
    }
    let random = "";
    for (let index = 0; index < 2_000; index += 1) random += String.fromCharCode((index * 7_919) % 0x10000);
    expect(utf8ByteLength(random)).toBe(new TextEncoder().encode(random).byteLength);
    const large = `${"\u00e9\ud83d\ude00x".repeat(60_000)}\ud800`;
    expect(utf8ByteLength(large)).toBe(new TextEncoder().encode(large).byteLength);
    expect(utf8ByteLength("short again \u4e2d")).toBe(new TextEncoder().encode("short again \u4e2d").byteLength);
  });

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

  it("keeps a JSON-native string equal to the special-tag name on the fast path", () => {
    const candidate: EvidenceCandidate = {
      id: "tag-shaped-string",
      kind: "topology-checkpoint",
      checkpoint: { value: "__lsewReplayTag" }
    };
    const serialized = serializeJournalEvidenceCandidate(candidate);
    const fromEntries = vi.spyOn(Object, "fromEntries");

    expect(deserializeJournalEvidenceCandidate(serialized.payload)).toEqual(candidate);
    expect(fromEntries).not.toHaveBeenCalled();

    fromEntries.mockRestore();
  });
});
