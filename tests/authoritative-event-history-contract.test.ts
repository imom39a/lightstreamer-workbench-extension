import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import {
  createMemoryEventHistoryForTests,
  openEventHistory,
  type EventHistory
} from "../src/core/event-history-authoritative";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  authoritativeEventDatabaseName,
  deleteAuthoritativeEventDatabase
} from "../src/core/indexeddb/authoritative-event-db";

function candidate(id: string): LightstreamerEventEnvelope {
  return {
    id,
    timestamp: 1_700_000_000_000,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    subscription: { id: "sub-contract", mode: "COMMAND" },
    update: { key: id, command: "ADD" }
  };
}

type HistoryFactory = () => Promise<EventHistory>;

function sharedContract(name: string, createHistory: HistoryFactory): void {
  describe(`${name} authoritative EventHistory contract`, () => {
    it("commits, reads, and follows the same ordered Evidence", async () => {
      const history = await createHistory();
      const publications: string[] = [];
      history.follow({ from: "CURRENT_INTERVAL_START" }, (publication) => {
        if (publication.type === "committed-evidence") {
          publications.push(...publication.evidence.map((entry) => entry.eventId));
        }
      });

      const first = history.offer(candidate("contract-1"));
      const second = history.offer(candidate("contract-2"));
      await expect(Promise.all([first.settled, second.settled])).resolves.toMatchObject([
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 1 } },
        { outcome: "BECAME_EVIDENCE", evidence: { sequence: 2 } }
      ]);
      await expect(history.read({})).resolves.toMatchObject({
        ok: true,
        value: {
          total: 2,
          evidence: [
            expect.objectContaining({ eventId: "contract-1" }),
            expect.objectContaining({ eventId: "contract-2" })
          ]
        }
      });
      expect(publications).toEqual(["contract-1", "contract-2"]);
      await history.close();
    });

    it("keeps exact filters, partial Find, and recent paging equivalent", async () => {
      const history = await createHistory();
      await history.offer(candidate("alpha")).settled;
      await history.offer(candidate("beta")).settled;
      await history.offer({ ...candidate("other"), subscription: { id: "other", mode: "MERGE" } }).settled;

      await expect(history.read({ filters: { mode: "COMMAND" }, find: "LPH" })).resolves.toMatchObject({
        ok: true,
        value: { total: 1, evidence: [expect.objectContaining({ eventId: "alpha" })] }
      });
      await expect(history.read({ offsetFromNewest: 1, limit: 1 })).resolves.toMatchObject({
        ok: true,
        value: { total: 3, evidence: [expect.objectContaining({ eventId: "beta" })] }
      });
      await history.close();
    });
  });
}

sharedContract("memory", () => createMemoryEventHistoryForTests());
sharedContract("fake IndexedDB", async () => {
  const panelSessionId = "shared-contract-indexeddb";
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId });
});
