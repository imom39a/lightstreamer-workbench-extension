import { describe, expect, it } from "vitest";
import { createFilter } from "../src/core/filter-algebra";
import { openActivityDocument, reduceActivityDocument, closeActivityDocument, reconcileActivityDocumentProjection } from "../src/core/activity-document";
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

  it("keeps a selected bucket's absolute range when projection duration rebuckets", () => {
    const { filter, readPoint } = fixture();
    const first: ActivityEvidence = { intervalId: "interval-1", sequence: 1, event: { id: "event-1", timestamp: 1_000, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: "logical-1", client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1" }, update: {} } };
    const second = { ...first, sequence: 2, event: { ...first.event, id: "event-2", logicalEventId: "logical-2", timestamp: 2_000 } };
    const far = { ...first, sequence: 3, event: { ...first.event, id: "event-3", logicalEventId: "logical-3", timestamp: 200_000 } };
    const initialReadPoint = { ...readPoint, committedEvidenceBoundary: { ...readPoint.committedEvidenceBoundary!, sequence: 2, eventId: "event-2" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 2_000, sequence: 2 } } };
    const initial = rebuildActivityProjection({ evidence: [first, second], scope: { kind: "PAGE" }, filter, readPoint: initialReadPoint });
    const document = openActivityDocument(initial, { scope: { kind: "PAGE" }, filter, readPoint: initialReadPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const selected = reduceActivityDocument(document, { type: "select", selection: { kind: "bucket", id: "0" } }).state;
    const rebucketed = rebuildActivityProjection({ evidence: [first, second, far], scope: { kind: "PAGE" }, filter, readPoint: { ...readPoint, committedEvidenceBoundary: { ...readPoint.committedEvidenceBoundary!, sequence: 3, eventId: "event-3" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 200_000, sequence: 3 } } } });

    const updated = reconcileActivityDocumentProjection(selected, rebucketed.readPoint, rebucketed);
    expect(updated.selectionRange).toEqual({ start: 1_000, end: 2_000 });
    expect(updated.selection).toEqual({ kind: "bucket", id: initial.buckets[0].id });
  });

  it("normalizes bucket selection to stable identity while retaining an absolute overlay", () => {
    const { filter, readPoint } = fixture();
    const first: ActivityEvidence = { intervalId: "interval-1", sequence: 1, event: { id: "event-1", timestamp: 1_000, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: "logical-1", client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1" }, update: {} } };
    const second = { ...first, sequence: 2, event: { ...first.event, id: "event-2", logicalEventId: "logical-2", timestamp: 2_000 } };
    const far = { ...first, sequence: 3, event: { ...first.event, id: "event-3", logicalEventId: "logical-3", timestamp: 200_000 } };
    const initialReadPoint = { ...readPoint, committedEvidenceBoundary: { ...readPoint.committedEvidenceBoundary!, sequence: 2, eventId: "event-2" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 2_000, sequence: 2 } } };
    const initial = rebuildActivityProjection({ evidence: [first, second], scope: { kind: "PAGE" }, filter, readPoint: initialReadPoint });
    const selected = reduceActivityDocument(openActivityDocument(initial, { scope: { kind: "PAGE" }, filter, readPoint: initialReadPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null }), { type: "select", selection: { kind: "bucket", id: "0" } }).state;

    expect(selected.selection).toEqual({ kind: "bucket", id: initial.buckets[0].id });
    const rebucketed = rebuildActivityProjection({ evidence: [first, second, far], scope: { kind: "PAGE" }, filter, readPoint: { ...readPoint, committedEvidenceBoundary: { ...readPoint.committedEvidenceBoundary!, sequence: 3, eventId: "event-3" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 200_000, sequence: 3 } } } });
    const updated = reconcileActivityDocumentProjection(selected, rebucketed.readPoint, rebucketed);

    expect(updated.selection).toEqual({ kind: "bucket", id: initial.buckets[0].id });
    expect(updated.selectionRange).toEqual({ start: 1_000, end: 2_000 });
  });

  it("restores all Activity presentation preferences from a supporting-Evidence return state", () => {
    const { filter, readPoint, projection } = fixture();
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: "event-1", evidenceFocusId: "event-1", evidenceScrollTop: 42, view: "FOLLOW LIVE", localDraftId: "draft-1" });
    const configured = reduceActivityDocument(document, { type: "select", selection: { kind: "marker", id: "0" } }).state;
    const withPreferences = reduceActivityDocument(configured, { type: "set-timeline-series", series: "SERVER_LIVE" }).state;
    const withLocal = reduceActivityDocument(withPreferences, { type: "set-local-series", enabled: true }).state;
    const withSort = reduceActivityDocument(withLocal, { type: "set-ranking-sort", sort: "UPDATE_DELIVERIES" }).state;
    const withScroll = reduceActivityDocument(withSort, { type: "set-scroll", documentTop: 84, plotLeft: 19 }).state;
    const closed = closeActivityDocument(withScroll);

    expect(closed).toEqual({ scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: "event-1", evidenceFocusId: "event-1", evidenceScrollTop: 42, view: "FOLLOW LIVE", localDraftId: "draft-1" });
    expect(withScroll).toMatchObject({ selection: { kind: "marker", id: "0" }, timelineSeries: "SERVER_LIVE", localSeries: true, rankingSort: "UPDATE_DELIVERIES", documentScrollTop: 84, plotScrollLeft: 19 });
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

  it("clips supporting Evidence to the retained half-open range", () => {
    const { filter, readPoint, projection } = fixture();
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const selected = reduceActivityDocument(document, { type: "select", selection: { kind: "bucket", id: "0" } }).state;
    const result = reduceActivityDocument(selected, { type: "supporting-evidence" });

    expect(result.supportingEvidence?.filter.around).toEqual({ intervalId: "interval-1", start: 1_000, end: 1_001 });
  });

  it("drills from a selected marker into its containing retained Evidence bucket", () => {
    const event: ActivityEvidence = { intervalId: "interval-1", sequence: 1, event: { id: "error-1", timestamp: 1_000, direction: "inbound", source: "server", synthetic: false, kind: "subscription-error", logicalEventId: undefined, client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1" }, raw: { code: 17, message: "bad selector" } } };
    const filter = createFilter(1);
    const readPoint = { intervalId: "interval-1", committedEvidenceBoundary: { intervalId: "interval-1", sequence: 1, eventId: "error-1" }, retainedRange: { first: { timestamp: 1_000, sequence: 1 }, last: { timestamp: 1_000, sequence: 1 } }, coverage: "LIMITED" as const, terminal: false };
    const projection = rebuildActivityProjection({ evidence: [event], scope: { kind: "PAGE" }, filter, readPoint });
    const document = openActivityDocument(projection, { scope: { kind: "PAGE" }, filter, readPoint, evidenceSelectionId: null, evidenceScrollTop: 0, view: "FOLLOW LIVE", localDraftId: null });
    const selected = reduceActivityDocument(document, { type: "select", selection: { kind: "marker", id: "0" } }).state;

    expect(reduceActivityDocument(selected, { type: "supporting-evidence" }).supportingEvidence?.filter.around).toEqual({ intervalId: "interval-1", start: 1_000, end: 1_001 });
  });
});
