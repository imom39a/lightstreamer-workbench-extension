import { describe, expect, it } from "vitest";

import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

function event(id: string, item: string, sequence: number) {
  return {
    id,
    timestamp: sequence,
    direction: "inbound" as const,
    source: "server" as const,
    synthetic: false,
    kind: "item-update" as const,
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: "subscription-1", mode: "MERGE" },
    item: { name: item, position: 1 },
    update: { fields: { value: id } }
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("filter-impl-13 structured discovery runtime seam", () => {
  it("requests an exact contextual facet page through the canonical investigation query", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("event-1", "orders", 1));
    history.offer(event("event-2", "quotes", 2));
    const runtime = createWorkbenchRuntime({ history });

    await settle();
    runtime.dispatch({ type: "request-filter-discovery", request: { facet: "item", size: 1 } });
    await settle();

    const discovery = runtime.getSnapshot().evidence.investigation.discoveries.get("item");
    expect(discovery).toMatchObject({ state: "AVAILABLE", facet: "item", distinctTotal: 2, baseEvidenceCount: 2 });
    expect(discovery?.state === "AVAILABLE" ? discovery.values : []).toHaveLength(1);
    expect(discovery?.state === "AVAILABLE" ? discovery.nextCursor : null).toBeTruthy();
    runtime.dispose();
  });

  it("keeps continuation bound to the same facet search and read point", async () => {
    const history = createAuthoritativeHistory();
    history.offer(event("event-1", "orders", 1));
    history.offer(event("event-2", "quotes", 2));
    const runtime = createWorkbenchRuntime({ history });

    await settle();
    runtime.dispatch({ type: "request-filter-discovery", request: { facet: "item", size: 1 } });
    await settle();
    const first = runtime.getSnapshot().evidence.investigation.discoveries.get("item");
    const cursor = first?.state === "AVAILABLE" ? first.nextCursor : null;
    expect(cursor).toBeTruthy();

    runtime.dispatch({ type: "request-filter-discovery", request: { facet: "item", size: 1, cursor: cursor ?? undefined } });
    await settle();
    const second = runtime.getSnapshot().evidence.investigation.discoveries.get("item");
    expect(second).toMatchObject({ state: "AVAILABLE", distinctTotal: 2 });
    expect(second?.state === "AVAILABLE" ? second.values[0]?.value.label : null).toBe("quotes");
    runtime.dispose();
  });
});
