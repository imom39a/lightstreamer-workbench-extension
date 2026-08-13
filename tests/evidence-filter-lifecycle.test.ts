import { describe, expect, it } from "vitest";

import {
  createEvidenceFilterFixture,
  type EvidenceFilterQueryAdapter,
  type EvidenceReadPoint
} from "../src/core/evidence-filter-contract";
import { createReferenceLifecycleHarness } from "./support/evidence-filter-reference";


describe("storage-neutral filter lifecycle seam", () => {
  it("invalidates a read point on Clear and exposes the empty new interval", async () => {
    const harness = createReferenceLifecycleHarness(createEvidenceFilterFixture(3_842).records);
    const before = await harness.query({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const stale = before.value.readPoint;
    harness.clear();
    const after = await harness.query({ at: "LATEST_COMMITTED", page: { order: "OLDEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(after.ok && after.value.readPoint.committedEvidenceBoundary).toBeNull();
    const rejected = await harness.query({ at: stale, page: { order: "OLDEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(rejected).toMatchObject({ ok: false, problem: { code: "HISTORY_INTERVAL_UNAVAILABLE" } });
  });

  it("keeps terminal final boundaries, fallback storage, and limited coverage explicit", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const harness = createReferenceLifecycleHarness(fixture.records, { storage: "MEMORY_FALLBACK", coverage: "LIMITED" });
    harness.terminate();
    expect(harness.state()).toMatchObject({ phase: "TERMINAL", storage: "MEMORY_FALLBACK", coverage: "LIMITED", committedEvidenceBoundary: fixture.records.at(-1)?.identity });
    const result = await harness.query({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 3 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(result.ok && result.value.page.evidence).toHaveLength(3);
  });

  it("publishes a new committed boundary for concurrent Capture without mutating the old result", async () => {
    const fixture = createEvidenceFilterFixture(3_842);
    const harness = createReferenceLifecycleHarness(fixture.records);
    const old = await harness.query({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    const appended = fixture.records[0]!;
    harness.capture({ ...appended, identity: { ...appended.identity, sequence: 3_843, eventId: "filter-event-03843" } });
    expect(harness.state().committedEvidenceBoundary?.sequence).toBe(3_843);
    const stale = await harness.query({ at: old.value.readPoint as EvidenceReadPoint, page: { order: "NEWEST_FIRST", size: 1 }, filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] } });
    expect(stale).toMatchObject({ ok: false, problem: { code: "READ_POINT_UNAVAILABLE" } });
  });

  it("keeps the adapter contract assignable for alternate storage implementations", () => {
    const adapter: EvidenceFilterQueryAdapter = createReferenceLifecycleHarness([]);
    expect(adapter).toBeDefined();
  });
});
