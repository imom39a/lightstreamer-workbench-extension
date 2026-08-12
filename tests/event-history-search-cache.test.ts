import { describe, expect, it, vi } from "vitest";

import { createEventHistoryWorkloadEvent } from "../benchmarks/event-history-workloads";
import { createMemoryEventHistoryForTests } from "../src/core/event-history-authoritative";
import { journalCandidateSearchText } from "../src/core/event-history-serialization";

describe("owned Event History search text", () => {
  it("materializes search text once per owned candidate only after the first find", async () => {
    const history = await createMemoryEventHistoryForTests({ panelSessionId: "search-cache-large" });
    const candidates = Array.from({ length: 10_000 }, (_, sequence) =>
      createEventHistoryWorkloadEvent("small-lifecycle", sequence, "search-cache-large")
    );
    const lowercase = vi.spyOn(String.prototype, "toLowerCase");
    for (let offset = 0; offset < candidates.length; offset += 500) {
      const receipts = candidates.slice(offset, offset + 500).map((candidate) => history.offer(candidate));
      await Promise.all(receipts.map((receipt) => receipt.settled));
    }
    const admissionLowercaseCalls = lowercase.mock.calls.length;
    lowercase.mockRestore();

    expect(admissionLowercaseCalls).toBe(0);

    const stringify = vi.spyOn(JSON, "stringify");
    const first = await history.read({ find: "search-cache-large", order: "asc" });
    const firstFindSerializations = stringify.mock.calls.length;
    stringify.mockClear();
    const second = await history.read({ find: "search-cache-large", order: "asc" });
    const third = await history.read({ find: "search-cache-large", order: "asc" });
    const repeatedFindSerializations = stringify.mock.calls.length;
    stringify.mockRestore();

    expect(first.ok && first.value.total).toBe(10_000);
    expect(second.ok && second.value.total).toBe(10_000);
    expect(third.ok && third.value.total).toBe(10_000);
    expect(firstFindSerializations).toBe(10_000);
    expect(repeatedFindSerializations).toBe(0);
    await history.close();
  }, 60_000);

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
    await history.close();
  });

  it("never caches search text for an unowned caller candidate", () => {
    const candidate = createEventHistoryWorkloadEvent("large-json-rich", 1, "search-cache-unowned");
    const stringify = vi.spyOn(JSON, "stringify");

    journalCandidateSearchText(candidate);
    journalCandidateSearchText(candidate);
    const serializations = stringify.mock.calls.length;
    stringify.mockRestore();

    expect(serializations).toBe(2);
  });
});
