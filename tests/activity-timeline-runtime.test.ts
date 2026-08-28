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
  it("reports Activity synchronization instead of transient empty metrics before the accepted-Evidence feed is coherent", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update(1)] });
    const runtime = createWorkbenchRuntime({ history });

    expect(runtime.getSnapshot().activity?.projection.state).toBe("LOADING");
    await settle();
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
      { start: 1_000, end: 2_001, logicalUpdates: 2, segment: 0 }
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
});
