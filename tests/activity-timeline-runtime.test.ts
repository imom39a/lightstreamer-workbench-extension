import { describe, expect, it } from "vitest";
import { createWorkbenchRuntime, type WorkbenchRuntimeScheduler } from "../src/extension/panel/workbench-runtime";
import { applyFilterMutations } from "../src/core/filter-algebra";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";

function update(sequence: number, timestamp = sequence * 1_000): LightstreamerEventEnvelope {
  return {
    id: `timeline-${sequence}`,
    timestamp,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    logicalEventId: `logical-${sequence}`,
    client: { id: "client-1", sessionId: "session-1", semanticValueStates: { id: { state: "requested" }, sessionId: { state: "requested" } } },
    subscription: { id: "subscription-1", mode: "MERGE", semanticValueStates: { id: { state: "requested" } } },
    item: { name: "item-1", position: 1 },
    update: { isSnapshot: sequence <= 2 }
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 80; index += 1) await Promise.resolve();
}

async function settleReplay(): Promise<void> {
  for (let index = 0; index < 16; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settle();
  }
}

function publicationScheduler(): WorkbenchRuntimeScheduler & Readonly<{ flushFrame(): void }> {
  const frames: Array<() => void> = [];
  return {
    requestFrame(callback) { frames.push(callback); return callback; },
    cancelFrame(handle) { const index = frames.indexOf(handle as () => void); if (index >= 0) frames.splice(index, 1); },
    setTimeout(callback) { return callback; },
    clearTimeout() {},
    flushFrame() { frames.splice(0).forEach((callback) => callback()); }
  };
}

describe("compact Activity timeline runtime seam", () => {
  it("publishes an available timeline after a synchronous accepted-Evidence replay", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1)] });
    const runtime = createWorkbenchRuntime({ history });

    expect(runtime.getSnapshot().activity?.projection.state).toBe("AVAILABLE");
    runtime.dispose();
  });

  it("keeps a chunked initial replay pending between Activity metadata pages", async () => {
    const history = createInMemoryEventHistory();
    for (let index = 1; index <= 513; index += 1) await history.offer(update(index)).settled;
    const runtime = createWorkbenchRuntime({ history });
    await Promise.resolve();
    runtime.dispatch({ type: "refresh-evidence" });
    await Promise.resolve();

    const activity = runtime.getSnapshot().activity!;
    expect(activity.projection.state).toBe("LOADING");
    expect(activity.projection.timeline.domain).toBeNull();
    runtime.dispose();
  });

  it("settles a held replay with a captured Session transition into an available timeline", async () => {
    const history = createInMemoryEventHistory();
    const sessionEstablished: LightstreamerEventEnvelope = {
      ...update(1),
      id: "session-established",
      kind: "client-status",
      client: { id: "client-1", sessionId: "session-1", status: "CONNECTED" },
      topology: {
        version: 1,
        kind: "session-established",
        pageEpoch: "page-1",
        captureSequence: 1,
        provenance: { instrumentationSource: "official-public-api" },
        coverage: { status: "complete", getters: {} },
        client: { id: "client-1", sessionId: { state: "real", value: "session-1" }, status: "CONNECTED" }
      }
    };
    await history.offer(sessionEstablished).settled;
    for (let index = 2; index <= 513; index += 1) await history.offer(update(index)).settled;
    const runtime = createWorkbenchRuntime({ history });

    await Promise.resolve();
    expect(runtime.getSnapshot().activity?.projection.state).toBe("LOADING");
    await settleReplay();
    const activity = runtime.getSnapshot().activity!;
    expect(["AVAILABLE", "LIMITED"]).toContain(activity.projection.state);
    expect(activity.projection.timeline.markers).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "session-established", kind: "SESSION_TRANSITION" })
    ]));
    runtime.dispose();
  });

  it("keeps a complete bounded current-interval projection while the Activity document is closed", async () => {
    const history = createAuthoritativeHistory({
      precommitted: Array.from({ length: 1_001 }, (_, index) => update(index + 1))
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();

    const activity = runtime.getSnapshot().activity!;
    expect(activity.open).toBe(false);
    expect(activity.projection.logicalUpdateTotal).toBe(1_001);
    expect(activity.readPoint.retainedRange).toEqual({
      first: { timestamp: 1_000, sequence: 1 },
      last: { timestamp: 1_001_000, sequence: 1_001 }
    });
    expect(activity.projection.timeline).toMatchObject({
      originTimestamp: 1_000,
      domain: { start: 1_000, end: 1_001_001 },
      matchingRange: { start: 1_000, end: 1_001_001 }
    });
    runtime.dispose();
  });

  it("keeps the retained elapsed-time domain stable while Filter narrows the displayed Activity range", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1), update(2), update(3)] });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const before = runtime.getSnapshot().activity!.projection.timeline;
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    const result = applyFilterMutations(filter, filter.revision, [{
      type: "set-around",
      around: { intervalId: "authoritative-test:interval-1", start: 2_000, end: 3_001 }
    }]);
    if (!result.ok) throw new Error(result.problem.message);
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: filter.revision, operations: [{
      type: "set-around",
      around: { intervalId: "authoritative-test:interval-1", start: 2_000, end: 3_001 }
    }] });
    await settle();

    const after = runtime.getSnapshot().activity!.projection.timeline;
    expect(after.originTimestamp).toBe(before.originTimestamp);
    expect(after.domain).toEqual(before.domain);
    expect(after.matchingRange).toEqual({ start: 2_000, end: 3_001 });
    runtime.dispose();
  });

  it("freezes all timeline bounds at the frozen committed Evidence boundary", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1), update(2)] });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "freeze-activity" });
    history.offer(update(3));
    await settle();

    const activity = runtime.getSnapshot().activity!;
    expect(activity.document?.view).toBe("FROZEN");
    expect(activity.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(activity.projection.timeline).toMatchObject({
      domain: { start: 1_000, end: 2_001 },
      matchingRange: { start: 1_000, end: 2_001 }
    });
    runtime.dispose();
  });

  it("does not rehydrate a cleared prior interval into the compact timeline", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1)] });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "open-activity" });
    runtime.dispatch({ type: "request-clear-history" });
    runtime.dispatch({ type: "confirm-clear-history" });
    await settle();
    expect(runtime.getSnapshot().activity?.projection.state).toBe("EMPTY_INTERVAL");
    runtime.dispose();
  });

  it("latches a closed Activity timeline to Frozen Evidence before later commits", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1), update(2)] });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "freeze-evidence" });
    history.offer(update(3));
    await settle();

    const activity = runtime.getSnapshot().activity!;
    expect(activity.open).toBe(false);
    expect(activity.document).toBeNull();
    expect(activity.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(activity.projection.logicalUpdateTotal).toBe(2);
    expect(activity.projection.timeline.domain).toEqual({ start: 1_000, end: 2_001 });
    runtime.dispose();
  });

  it("retains canonical Evidence text matching after compacting update payloads", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [{ ...update(1), update: { isSnapshot: false, fields: { price: "needle" } } }]
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: filter.revision,
      operations: [{ type: "set-text", text: "needle" }]
    });
    await settle();

    expect(runtime.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(1);
    runtime.dispose();
  });

  it("keeps duplicate listener deliveries inside one exact snapshot burst", async () => {
    const first = update(1);
    const history = createAuthoritativeHistory({
      precommitted: [
        first,
        { ...first, id: "duplicate-delivery", timestamp: 1_001 },
        update(2, 2_000),
        update(3, 3_000)
      ]
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();

    expect(runtime.getSnapshot().activity?.projection.timeline.snapshotBursts).toEqual([
      { start: 1_000, end: 2_001, startSequence: 1, logicalUpdates: 2, segment: 0 }
    ]);
    runtime.dispose();
  });

  it("enables passive Capture publication when Filter supersedes the initial Evidence query", async () => {
    const releases: Array<() => void> = [];
    const history = createAuthoritativeHistory({
      precommitted: [update(1)],
      readControl: (_query, release) => releases.push(release)
    });
    const scheduler = publicationScheduler();
    const runtime = createWorkbenchRuntime({ history, scheduler });
    await settle();
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: filter.revision,
      operations: [{ type: "set-text", text: "timeline" }]
    });
    await settle();
    expect(releases.length).toBeGreaterThanOrEqual(2);
    releases.splice(0).forEach((release) => release());
    await settle();

    history.offer(update(2));
    scheduler.flushFrame();
    await settle();
    expect(releases.length).toBeGreaterThan(0);
    releases.splice(0).forEach((release) => release());
    await settle();
    expect(runtime.getSnapshot().evidence.events.map((event) => event.id)).toContain("timeline-2");
    runtime.dispose();
  });

  it("selects represented timeline source points and markers without changing Scope, Filter, Find, or Frozen Evidence", async () => {
    const local = { ...update(2), source: "synthetic" as const, synthetic: true, logicalEventId: "local-2" };
    const marker = {
      ...update(3),
      kind: "client-status" as const,
      client: { id: "client-1", sessionId: "session-1", status: "DISCONNECTED" },
      topology: {
        version: 1 as const,
        kind: "session-absent" as const,
        pageEpoch: "page-1",
        captureSequence: 3,
        provenance: { instrumentationSource: "official-public-api" as const },
        coverage: { status: "complete" as const, getters: {} },
        client: { id: "client-1", sessionId: { state: "real" as const, value: "session-1" }, status: "DISCONNECTED" }
      }
    };
    const history = createInMemoryEventHistory();
    for (const event of [update(1), local, marker]) await history.offer(event).settled;
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const filter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: filter.revision,
      operations: [{ type: "set-text", text: "timeline" }]
    });
    await settle();
    runtime.dispatch({ type: "set-find", value: "timeline" });
    await settle();
    runtime.dispatch({ type: "freeze-evidence" });
    await settle();
    await history.offer(update(4)).settled;
    await settle();

    const before = runtime.getSnapshot();
    const source = before.activity!.projection.timeline.sourcePoints.find((point) => point.eventId === "timeline-2")!;
    const timelineMarker = before.activity!.projection.timeline.markers.find((point) => point.eventId === "timeline-3")!;
    const frozenBoundary = before.activity!.readPoint.committedEvidenceBoundary;

    runtime.dispatch({ type: "select-activity-evidence", ...source, inspect: true });
    await settle();
    let after = runtime.getSnapshot();
    expect(after.evidence.selectedEventId).toBe("timeline-2");
    expect(after.evidence.investigation.lookup).toMatchObject({ state: "RETAINED", evidence: { identity: { eventId: "timeline-2" } } });
    expect(after.selectedEvidence?.id).toBe("timeline-2");
    expect(after.contextId).toBe("context:timeline-2");
    expect(after.scopeId).toBe(before.scopeId);
    expect(after.activity?.filter).toEqual(before.activity?.filter);
    expect(after.evidence.find).toBe("timeline");
    expect(after.evidence.mode).toBe("frozen");
    expect(after.activity?.readPoint.committedEvidenceBoundary).toEqual(frozenBoundary);

    runtime.dispatch({ type: "select-activity-evidence", ...timelineMarker, inspect: true });
    await settle();
    after = runtime.getSnapshot();
    expect(after.evidence.selectedEventId).toBe("timeline-3");
    expect(after.selectedEvidence?.id).toBe("timeline-3");
    expect(after.contextId).toBe("context:timeline-3");
    expect(after.activity?.filter).toEqual(before.activity?.filter);
    expect(after.evidence.find).toBe("timeline");
    expect(after.evidence.mode).toBe("frozen");
    expect(after.activity?.readPoint.committedEvidenceBoundary).toEqual(frozenBoundary);
    runtime.dispose();
  });

  it("keeps a held focused source point actionable after a later projection no longer represents it", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1), update(2), update(3)] });
    const runtime = createWorkbenchRuntime({ history, activityPublicationDelayMs: 0 });
    await settle();
    runtime.dispatch({ type: "open-activity" });
    await settle();
    const before = runtime.getSnapshot();
    const anchor = before.activity!.projection.timeline.sourcePoints.find((point) => point.eventId === "timeline-3")!;
    runtime.dispatch({ type: "select-activity-evidence", ...anchor, source: "LOCAL" });
    runtime.dispatch({ type: "select-activity-evidence", ...anchor, sequence: anchor.sequence + 1, eventId: "forged-future" });
    await settle();
    expect(runtime.getSnapshot().evidence.selectedEventId).toBeNull();
    history.offer(update(301));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settle();

    const beforeSelection = runtime.getSnapshot();
    expect(beforeSelection.activity!.projection.timeline.sourcePoints).not.toContainEqual(expect.objectContaining({ eventId: "timeline-3" }));
    runtime.dispatch({ type: "select-activity-evidence", ...anchor, inspect: true });
    await settle();

    const after = runtime.getSnapshot();
    expect(after.evidence.selectedEventId).toBe("timeline-3");
    expect(after.selectedEvidence?.id).toBe("timeline-3");
    expect(after.contextId).toBe("context:timeline-3");
    expect(after.activity?.filter).toEqual(beforeSelection.activity?.filter);
    runtime.dispose();
  });

  it("keeps the timestamped retained bounds usable around untimed topology checkpoints", async () => {
    const checkpoint = (id: string) => ({
      kind: "topology-checkpoint" as const,
      id,
      checkpoint: { pageEpoch: "checkpoint-page" }
    });
    const history = createAuthoritativeHistory({
      precommitted: [checkpoint("checkpoint-before"), update(1), checkpoint("checkpoint-between"), update(2), checkpoint("checkpoint-after")]
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const initial = runtime.getSnapshot().activity!;
    const filter = runtime.getSnapshot().evidence.investigation.filter;

    expect(initial.readPoint.retainedRange).toEqual({
      first: { timestamp: 1_000, sequence: 2 },
      last: { timestamp: 2_000, sequence: 4 }
    });
    expect(initial.readPoint.committedEvidenceBoundary?.sequence).toBe(5);
    expect(initial.projection.timeline).toMatchObject({ originTimestamp: 1_000, domain: { start: 1_000, end: 2_001 } });
    expect(initial.projection.logicalUpdateTotal).toBe(2);

    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: filter.revision,
      operations: [{ type: "set-around", around: { intervalId: initial.readPoint.intervalId, start: 2_000, end: 2_001 } }]
    });
    runtime.dispatch({ type: "freeze-evidence" });
    await history.offer(update(3)).settled;
    await settle();

    const frozen = runtime.getSnapshot().activity!;
    expect(frozen.readPoint.retainedRange).toEqual(initial.readPoint.retainedRange);
    expect(frozen.projection.timeline).toMatchObject({ originTimestamp: 1_000, domain: { start: 1_000, end: 2_001 } });
    expect(frozen.projection.logicalUpdateTotal).toBe(1);
    runtime.dispose();
  });


  it("pages an off-window LOCAL timeline anchor into Evidence while preserving an active range, Find, and Frozen boundary", async () => {
    const earlyLocal = { ...update(1), id: "early-local", source: "synthetic" as const, synthetic: true, logicalEventId: "early-local" };
    const history = createInMemoryEventHistory({ panelSessionId: "authoritative-test" });
    for (const event of [earlyLocal, ...Array.from({ length: 119 }, (_, index) => update(index + 2))]) {
      await history.offer(event).settled;
    }
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    const initialFilter = runtime.getSnapshot().evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: initialFilter.revision,
      operations: [{ type: "set-around", around: { intervalId: "authoritative-test:interval-1", start: 1_000, end: 120_001 } }]
    });
    await settle();
    runtime.dispatch({ type: "set-find", value: "timeline-120" });
    await settle();
    runtime.dispatch({ type: "freeze-evidence" });
    await settle();
    history.offer(update(121));
    await settle();

    const before = runtime.getSnapshot();
    const anchor = before.activity!.projection.timeline.sourcePoints.find((point) => point.eventId === "early-local")!;
    const frozenBoundary = before.activity!.readPoint.committedEvidenceBoundary;
    expect(before.evidence.events.map((event) => event.id)).not.toContain("early-local");

    runtime.dispatch({ type: "select-activity-evidence", ...anchor });
    await settle();
    const after = runtime.getSnapshot();
    expect(after.evidence.loading).toBe(false);
    expect(after.evidence.investigation.lookup).toMatchObject({ state: "RETAINED", evidence: { identity: { eventId: "early-local" } } });
    expect(after.evidence.offset).toBe(119);
    expect(after.evidence.events.map((event) => event.id)).toContain("early-local");
    expect(after.evidence.selectedEventId).toBe("early-local");
    expect(after.selectedEvidence?.id).toBe("early-local");
    expect(after.evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    expect(after.evidence.find).toBe("timeline-120");
    expect(after.evidence.mode).toBe("frozen");
    expect(after.activity?.readPoint.committedEvidenceBoundary).toEqual(frozenBoundary);

    const narrowed = after.evidence.investigation.filter;
    runtime.dispatch({
      type: "apply-filter-mutations",
      expectedRevision: narrowed.revision,
      operations: [{ type: "set-around", around: { intervalId: "authoritative-test:interval-1", start: 2_000, end: 120_001 } }]
    });
    await settle();
    const beforeStaleAnchor = runtime.getSnapshot();
    expect(beforeStaleAnchor.activity!.projection.timeline.sourcePoints.map((point) => point.eventId)).not.toContain("early-local");
    runtime.dispatch({ type: "select-activity-evidence", ...anchor, inspect: true });
    await settle();
    const afterStaleAnchor = runtime.getSnapshot();
    expect(afterStaleAnchor.evidence.selectedEventId).toBe(beforeStaleAnchor.evidence.selectedEventId);
    expect(afterStaleAnchor.contextId).toBe(beforeStaleAnchor.contextId);
    runtime.dispose();
  });

  it("keeps ordinary Find navigation independent from an unrelated visible selection", async () => {
    const history = createAuthoritativeHistory({
      precommitted: [
        { ...update(1), update: { isSnapshot: true, fields: { marker: "old-find-only" } } },
        ...Array.from({ length: 119 }, (_, index) => update(index + 2))
      ]
    });
    const runtime = createWorkbenchRuntime({ history });
    await settle();
    runtime.dispatch({ type: "select-evidence", eventId: "timeline-120" });
    await settle();
    runtime.dispatch({ type: "set-find", value: "old-find-only" });
    await settle();

    expect(runtime.getSnapshot().evidence.events.map((event) => event.id)).toContain("timeline-1");
    runtime.dispose();
  });
});
