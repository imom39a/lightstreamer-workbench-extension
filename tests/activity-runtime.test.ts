import { describe, expect, it } from "vitest";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";

function update(id: string, timestamp: number): LightstreamerEventEnvelope {
  return { id, timestamp, direction: "inbound", source: "server", synthetic: false, kind: "item-update", logicalEventId: id, client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1", mode: "MERGE" }, item: { name: "item-1", position: 1 }, update: { isSnapshot: false } };
}

describe("Activity runtime seam", () => {
  it("publishes only committed Evidence with an explicit read point and supports promotion", async () => {
    const history = createAuthoritativeHistory({ precommitted: [update("event-1", 1_000), update("event-2", 2_000)] });
    const runtime = createWorkbenchRuntime({ history });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    const activity = runtime.getSnapshot().activity!;

    expect(activity.readPoint.committedEvidenceBoundary?.sequence).toBe(2);
    expect(activity.readPoint.retainedRange?.first.timestamp).toBe(1_000);
    expect(activity.projection.logicalUpdateTotal).toBe(2);
    expect(activity.projection.state).toBe("AVAILABLE");
    runtime.dispatch({ type: "open-activity" });
    expect(runtime.getSnapshot().activity?.open).toBe(true);
    runtime.dispose();
  });
});
