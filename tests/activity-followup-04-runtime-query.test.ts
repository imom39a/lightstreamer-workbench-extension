import { describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";

import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

function update(
  id: string,
  timestamp: number,
  subscriptionId: string,
  itemName: string
): LightstreamerEventEnvelope {
  return {
    id,
    timestamp,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    logicalEventId: id,
    client: { id: "client-1", sessionId: "session-1" },
    subscription: { id: subscriptionId, mode: "MERGE" },
    item: { name: itemName, position: itemName === "item-a" ? 1 : 2 },
    update: { isSnapshot: false, fields: { value: id } }
  };
}

type Runtime = ReturnType<typeof createWorkbenchRuntime>;

function investigation(runtime: Runtime) {
  return runtime.getSnapshot().evidence.investigation;
}

async function waitForCurrentReady(
  runtime: Runtime,
  ready: (current: ReturnType<typeof investigation>) => boolean
): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const current = investigation(runtime);
    if (
      current.queryState === "ready" &&
      runtime.getPerformanceDiagnostics?.().evidenceQueryPending !== true &&
      ready(current)
    ) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("WorkbenchRuntime did not publish the expected current investigation snapshot.");
}

async function createHistory(adapter: "memory" | "fake IndexedDB"): Promise<EventHistory> {
  const panelSessionId = `activity-followup-04-${adapter}-${Date.now()}-${Math.random()}`;
  if (adapter === "memory") return createInMemoryEventHistory({ panelSessionId });
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  return createIndexedDbEventHistory({ panelSessionId });
}

describe("activity-followup-04 Page ranking investigation query", () => {
  it.each(["memory", "fake IndexedDB"] as const)(
    "keeps ranked Subscription drilldown exact through the %s public investigation seam",
    async (adapter) => {
      const history = await createHistory(adapter);
      const retained = [
        update("subscription-a-item-a", 1_000, "subscription-ranked", "item-a"),
        update("subscription-a-item-b", 2_000, "subscription-ranked", "item-b"),
        update("other-subscription-item", 3_000, "subscription-other", "item-other")
      ];
      try {
        for (const event of retained) await history.offer(event).settled;

        const runtime = createWorkbenchRuntime({ history });
        try {
          await waitForCurrentReady(runtime, (current) => current.counts.inScope === retained.length);
          await waitForCurrentReady(runtime, (current) => current.page.evidence.length === retained.length);

          runtime.dispatch({ type: "open-activity" });
          await waitForCurrentReady(runtime, (current) => current.counts.inScope === retained.length);

          const ranking = runtime.getSnapshot().activity?.projection.allRankings.find(
            (candidate) => candidate.identity === "subscription-ranked"
          );
          expect(ranking).toBeDefined();
          expect(ranking?.range).toEqual({ start: 1_000, end: 3_001 });
          expect(ranking?.supportingFilterMutations).toEqual(expect.arrayContaining([
            expect.objectContaining({ facet: "kind", type: "add-criterion", polarity: "include" }),
            expect.objectContaining({ facet: "provenance", type: "add-criterion", polarity: "include" }),
            expect.objectContaining({ facet: "subscription", type: "add-criterion", polarity: "include" })
          ]));

          const mutations = ranking?.supportingFilterMutations ?? [];
          runtime.dispatch({
            type: "show-activity-supporting-evidence",
            start: ranking?.range?.start,
            end: ranking?.range?.end,
            filterMutations: mutations
          });

          await waitForCurrentReady(runtime, (current) =>
            current.counts.matching === 2 &&
            current.filter.around?.start === 1_000 &&
            current.filter.around?.end === 3_001
          );

          const current = investigation(runtime);
          const subscriptionCriteria = current.filter.criteria.subscription?.include ?? [];
          const itemCriteria = [
            ...(current.filter.criteria.item?.include ?? []),
            ...(current.filter.criteria.item?.exclude ?? [])
          ];
          expect(subscriptionCriteria).toHaveLength(1);
          expect(subscriptionCriteria[0]?.type).toBe("structural-subscription");
          expect(subscriptionCriteria[0]?.value).toBe("subscription-ranked");
          expect(itemCriteria).toHaveLength(0);
          expect(current.filter.criteria.kind?.include[0]?.value).toBe("ITEM-UPDATE");
          expect(current.filter.criteria.provenance?.include[0]?.value).toBe("SERVER");
          expect(current.filter.around).toEqual({
            intervalId: expect.any(String),
            start: ranking?.range?.start,
            end: ranking?.range?.end
          });
          expect(current.page.evidence.map((record) => record.facets.item?.label)).toEqual([
            "item-b",
            "item-a"
          ]);
        } finally {
          runtime.dispose();
        }
      } finally {
        await history.close();
      }
    }
  );
});
