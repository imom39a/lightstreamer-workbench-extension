import { describe, expect, it, vi } from "vitest";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { getWorkbenchScenario } from "./support/workbench-scenarios";

describe("main Evidence with integrated Activity during passive Capture", () => {
  it("publishes a matching arrival while keeping a Filter-hidden selection", async () => {
    const scenario = getWorkbenchScenario("filter-hidden-selection");
    const history = createInMemoryEventHistory({ panelSessionId: "activity-passive-filter-proof" });
    await Promise.all(scenario.initialEvents.map((event) => history.offer(event).settled));
    const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().evidence.events.length).toBeGreaterThan(0));
      runtime.dispatch({ type: "select-evidence", eventId: scenario.selectedEventId! });
      const filter = runtime.getSnapshot().evidence.investigation.filter;
      runtime.dispatch({
        type: "apply-filter-mutations",
        expectedRevision: filter.revision,
        operations: [{ type: "set-text", text: scenario.filterQuery! }]
      });
      await Promise.all(scenario.laterEvents!.map((event) => history.offer(event).settled));

      await vi.waitFor(() => {
        const snapshot = runtime.getSnapshot();
        expect(snapshot.evidence.events.map((event) => event.id), JSON.stringify({
          publication: runtime.getPerformanceDiagnostics?.(),
          activityMatches: snapshot.activity?.projection.matchingEvidence,
          activityBoundary: snapshot.activity?.readPoint.committedEvidenceBoundary
        })).toContain("scenario-event-1-passive");
        expect(snapshot.activity?.projection.matchingEvidence).toBe(2);
        expect(snapshot.evidence.selectedEventId).toBe("scenario-event-3");
        expect(snapshot.selectedEvidence?.id).toBe("scenario-event-3");
        expect(snapshot.evidence.investigation.filter.text).toBe("scenario-event-1");
      });
    } finally {
      runtime.dispose();
    }
  });
});
