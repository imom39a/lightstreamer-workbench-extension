import { describe, expect, it } from "vitest";
import { createFilter } from "../src/core/filter-algebra";
import { openActivityDocument, reduceActivityDocument, closeActivityDocument } from "../src/core/activity-document";
import { rebuildActivityProjection, type ActivityEvidence } from "../src/core/activity-projection";

function fixture() {
  const evidence: ActivityEvidence[] = [{ intervalId: "interval-1", sequence: 1, event: { id: "event-1", timestamp: 1_000, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: "logical-1", client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1" }, update: {} } }];
  const filter = createFilter(1);
  const readPoint = { intervalId: "interval-1", committedEvidenceBoundary: { intervalId: "interval-1", sequence: 1, eventId: "event-1" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 1_000, sequence: 1 } }, coverage: "USEFUL" as const, terminal: false };
  const projection = rebuildActivityProjection({ evidence, scope: { kind: "PAGE" }, filter, readPoint });
  return { filter, readPoint, projection };
}

describe("promoted Activity document seam", () => {
  it("opens subordinate to Evidence and restores the exact origin on close", () => {
    const { filter, readPoint, projection } = fixture();
    const origin = { scope: { kind: "PAGE" as const }, filter, readPoint, evidenceSelectionId: "event-7", evidenceScrollTop: 42, view: "FROZEN" as const, localDraftId: "draft-1" };
    const document = openActivityDocument(projection, origin);
    expect(document.open).toBe(true);
    expect(closeActivityDocument(document)).toEqual(origin);
  });

  it("keeps presentation preferences while Scope or Filter recomputation clears stale aggregate selection", () => {
    const { filter, readPoint, projection } = fixture();
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const selected = reduceActivityDocument(document, { type: "select", selection: { kind: "bucket", id: "0" } }).state;
    const changed = reduceActivityDocument(selected, { type: "scope-or-filter-changed", scope: { kind: "CLIENT", clientId: "client-1" }, filter, readPoint, projection }).state;
    expect(changed.selection).toBeNull();
    expect(changed.rankingSort).toBe("LOGICAL_UPDATES");
  });

  it("does not invent a private pause and reports newer matching Evidence while frozen", () => {
    const { filter, readPoint, projection } = fixture();
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const frozen = reduceActivityDocument(document, { type: "freeze" }).state;
    const updated = reduceActivityDocument(frozen, { type: "captured-while-frozen", newerMatchingEvidence: 3 }).state;
    expect(updated.view).toBe("FROZEN");
    expect(updated.newerMatchingEvidence).toBe(3);
  });

  it("preserves Local visibility and ranking sort while clearing stale aggregate selection", () => {
    const { filter, readPoint, projection } = fixture();
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const configured = reduceActivityDocument(document, { type: "set-local-series", enabled: true }).state;
    const sorted = reduceActivityDocument(configured, { type: "set-ranking-sort", sort: "UPDATE_DELIVERIES" }).state;
    const selected = reduceActivityDocument(sorted, { type: "select", selection: { kind: "ranking", id: "subscription-1" } }).state;
    const changed = reduceActivityDocument(selected, { type: "scope-or-filter-changed", scope: { kind: "PAGE" }, filter, readPoint, projection }).state;

    expect(changed.selection).toBeNull();
    expect(changed.localSeries).toBe(true);
    expect(changed.rankingSort).toBe("UPDATE_DELIVERIES");
  });
});
