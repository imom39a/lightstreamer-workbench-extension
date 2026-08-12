import { beforeEach, describe, expect, it, vi } from "vitest";

const serialization = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../src/core/event-history-serialization", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/core/event-history-serialization")>();
  return {
    ...original,
    serializeJournalEvidenceCandidate(candidate: Parameters<typeof original.serializeJournalEvidenceCandidate>[0]) {
      serialization.calls += 1;
      return original.serializeJournalEvidenceCandidate(candidate);
    }
  };
});

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";

describe("owned Event History search text", () => {
  beforeEach(() => {
    serialization.calls = 0;
  });

  it("canonicalizes each of 1,692 large retained candidates only at intake across three find reads", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "search-cache-large" });
    const receipts = Array.from({ length: 1_692 }, (_, sequence) =>
      history.offer(createEventHistoryWorkloadEvent("large-json-rich", sequence, "search-cache-large"))
    );
    await Promise.all(receipts.map((receipt) => receipt.settled));

    expect(serialization.calls).toBe(1_692);
    for (let sample = 0; sample < 3; sample += 1) {
      const read = await history.read({ find: "order", order: "asc" });
      expect(read.ok && read.value.total).toBe(1_692);
    }

    expect(serialization.calls).toBe(1_692);
    await history.close();
  }, 30_000);

  it("searches the owned replay snapshot without exposing cache state or observing post-offer mutation", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "search-cache-isolation" });
    const raw = { marker: "original-marker" };
    const offered = { ...createEventHistoryWorkloadEvent("large-json-rich", 1, "search-cache-isolation"), raw };
    await history.offer(offered).settled;
    raw.marker = "mutated-marker";

    const original = await history.read({ find: "original-marker" });
    const mutated = await history.read({ find: "mutated-marker" });
    const full = await history.read({});

    expect(original.ok && original.value.total).toBe(1);
    expect(mutated.ok && mutated.value.total).toBe(0);
    expect(full.ok).toBe(true);
    if (!full.ok) throw new Error("Expected an authoritative read.");
    expect(Object.keys(full.value.evidence[0].candidate)).not.toContain("searchText");
    expect(Object.keys(full.value.evidence[0].candidate)).not.toContain("cache");
    expect(serialization.calls).toBe(1);
    await history.close();
  });
});
