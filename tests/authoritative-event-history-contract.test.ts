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
      await expect(history.read({ order: "desc", offsetFromNewest: 1, limit: 2 })).resolves.toMatchObject({
        ok: true,
        value: {
          evidence: [expect.objectContaining({ eventId: "beta" }), expect.objectContaining({ eventId: "alpha" })]
        }
      });

      const pagingCases = [
        { query: { order: "asc" as const, limit: 2 }, ids: ["alpha", "beta"], total: 3 },
        { query: { order: "desc" as const, limit: 2 }, ids: ["other", "beta"], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: 0, limit: 2 }, ids: ["beta", "other"], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: 1, limit: 2 }, ids: ["alpha", "beta"], total: 3 },
        { query: { order: "desc" as const, offsetFromNewest: 1, limit: 2 }, ids: ["beta", "alpha"], total: 3 },
        { query: { order: "desc" as const, afterSequence: 1, limit: 1 }, ids: ["other"], total: 2 },
        { query: { order: "asc" as const, limit: 0 }, ids: [], total: 3 },
        { query: { order: "asc" as const, offsetFromNewest: -1, limit: -1 }, ids: [], total: 3 }
      ];
      for (const pagingCase of pagingCases) {
        const result = await history.read(pagingCase.query);
        expect(result).toMatchObject({ ok: true });
        if (result.ok) {
          expect(result.value.total).toBe(pagingCase.total);
          expect(result.value.evidence.map((entry) => entry.eventId)).toEqual(pagingCase.ids);
        }
      }

      const checkpoint = {
        kind: "topology-checkpoint" as const,
        id: "checkpoint-filtered",
        checkpoint: { pageEpoch: "epoch-command" }
      };
      await history.offer(checkpoint).settled;
      await expect(history.read({ filters: { mode: "COMMAND" } })).resolves.toMatchObject({
        ok: true,
        value: { total: 2, evidence: [expect.objectContaining({ eventId: "alpha" }), expect.objectContaining({ eventId: "beta" })] }
      });
      await expect(history.read({ filters: { query: "epoch-command" } })).resolves.toMatchObject({
        ok: true,
        value: { total: 1, evidence: [expect.objectContaining({ eventId: "checkpoint-filtered" })] }
      });
      await expect(history.read({ filters: { query: "not-present" } })).resolves.toMatchObject({
        ok: true,
        value: { total: 0, evidence: [] }
      });

      const firstRead = await history.read({});
      const firstInterval = firstRead.ok ? firstRead.value.interval.id : "";
      await history.clear();
      await history.offer(candidate("after-clear")).settled;
      await expect(history.read({ intervalId: firstInterval })).resolves.toMatchObject({
        ok: true,
        value: { total: 0, evidence: [] }
      });
      await history.close();
    });

    it("Finds canonical replay key order case-insensitively across adapters", async () => {
      const history = await createHistory();
      await historyFactoryOfferAndReadCanonicalReplay(history);
    });
  });
}

async function historyFactoryOfferAndReadCanonicalReplay(history: EventHistory): Promise<void> {
  await history.offer({
    ...candidate("canonical-order"),
    raw: { zulu: "LAST", alpha: "FIRST" }
  }).settled;

  await expect(history.read({ find: '"ALPHA":"FIRST","ZULU":"LAST"' })).resolves.toMatchObject({
    ok: true,
    value: {
      total: 1,
      evidence: [expect.objectContaining({ eventId: "canonical-order" })]
    }
  });
  await history.close();
}

sharedContract("memory", () => createMemoryEventHistoryForTests());
sharedContract("fake IndexedDB", async () => {
  const panelSessionId = "shared-contract-indexeddb";
  Reflect.set(globalThis, "indexedDB", new IDBFactory());
  await deleteAuthoritativeEventDatabase(authoritativeEventDatabaseName(panelSessionId));
  return openEventHistory({ panelSessionId });
});
