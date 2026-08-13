import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { authoritativeEventDatabaseName } from "../src/core/indexeddb/authoritative-event-db";
import { type EvidenceFilter, typedFacetValue } from "../src/core/evidence-filter-contract";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { EventHistory } from "../src/core/event-history-authoritative";

const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });
const keyCount = 3_842;
const evidenceCount = 10_000;
const runLargeFakeWorkload = process.env.LSEW_FILTER_IMPL_09_RUN_LARGE === "true";

function workloadEvent(sequence: number): LightstreamerEventEnvelope {
  const key = `key-${String(sequence % keyCount).padStart(4, "0")}`;
  return {
    id: `workload-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    captureSource: sequence % 2 === 0 ? "listener" : "wire",
    synthetic: false,
    kind: "item-update",
    client: { id: "workload-client", sessionId: "workload-session" },
    subscription: { id: "workload-subscription", mode: "COMMAND" },
    item: { name: "workload-items" },
    listener: { id: "workload-listener" },
    update: { isSnapshot: false, key, command: sequence % 3 === 0 ? "ADD" : "UPDATE", fields: { key, sequence } }
  };
}

async function postingCount(name: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(authoritativeEventDatabaseName(name));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("facetPostings", "readonly");
      const count = transaction.objectStore("facetPostings").count();
      count.onerror = () => reject(count.error);
      count.onsuccess = () => resolve(count.result);
      transaction.oncomplete = () => database.close();
    };
  });
}

async function offerBatch(history: EventHistory, candidates: readonly LightstreamerEventEnvelope[]): Promise<void> {
  const receipts = candidates.map((candidate) => history.offer(candidate));
  expect(receipts.every((receipt) => receipt.intake === "QUEUED")).toBe(true);
  const results = await Promise.all(receipts.map((receipt) => receipt.settled));
  expect(results.every((result) => result.outcome === "BECAME_EVIDENCE"), JSON.stringify(results.find((result) => result.outcome !== "BECAME_EVIDENCE"))).toBe(true);
}

describe("filter-impl-09 durable IndexedDB workload", () => {
  it("builds a 20-record fixture through the public queued-offer path before discovery", async () => {
    const name = `filter-impl-09-workload-smoke-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId: name });
    try {
      await offerBatch(durable, Array.from({ length: 20 }, (_, sequence) => workloadEvent(sequence)));
      const result = await durable.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 20 },
        filter: emptyFilter(),
        discover: [{ facet: "key", search: "key-", size: 20 }]
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected the smoke fixture query to succeed");
      expect(result.value.discoveries.get("key")).toMatchObject({ state: "AVAILABLE", distinctTotal: 20, baseEvidenceCount: 20 });
      expect(result.value.telemetry).toMatchObject({
        payloadHydrations: 0,
        fullEvidencePayloadHydrations: 0,
        discoveryAggregateReads: 20,
        discoveryAggregateObservationReads: 20,
        discoveryPostingValidationReads: 20,
        discoveryProjectionReads: 0,
        fullRetainedScan: false
      });
    } finally {
      await durable.close();
    }
  });

  it.skipIf(!runLargeFakeWorkload)("discovers all 3,842 COMMAND keys across 10,000 Evidence without payload hydration", async () => {
    const name = `filter-impl-09-workload-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId: name });
    try {
      const phases: Record<string, number> = {};
      let phaseStarted = performance.now();
      await offerBatch(durable, Array.from({ length: evidenceCount }, (_, sequence) => workloadEvent(sequence)));
      phases.offerBatchMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      expect(await postingCount(name)).toBe(evidenceCount * 12);
      phases.postingCountMs = Math.round(performance.now() - phaseStarted);

      const request = {
        at: "LATEST_COMMITTED" as const,
        page: { order: "OLDEST_FIRST" as const, size: 97 },
        filter: emptyFilter(),
        discover: [{ facet: "key", search: "key-", size: 97 }]
      };
      phaseStarted = performance.now();
      const first = await durable.query!(request);
      phases.firstDiscoveryMs = Math.round(performance.now() - phaseStarted);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("Expected the durable workload query to succeed");
      const initial = first.value.discoveries.get("key");
      expect(initial, JSON.stringify(initial)).toMatchObject({ state: "AVAILABLE", distinctTotal: keyCount, baseEvidenceCount: evidenceCount });
      expect(first.value.telemetry).toMatchObject({
        payloadHydrations: 0,
        lookupPayloadHydrations: 0,
        fullEvidencePayloadHydrations: 0,
        discoveryCandidateCount: evidenceCount,
        discoveryAggregateReads: keyCount,
        discoveryAggregateObservationReads: evidenceCount,
        discoveryPostingValidationReads: evidenceCount,
        discoveryProjectionReads: 0,
        fullRetainedScan: false
      });
      expect(first.value.telemetry?.discoveryMaterializedCandidates).toBeLessThanOrEqual(97);
      expect(first.value.telemetry?.discoveryCompactIdentityCount).toBe(keyCount);
      expect(first.value.telemetry?.postingCandidates).toBe(0);

      if (!initial || initial.state !== "AVAILABLE") throw new Error("Expected the first discovery page to be available");
      const seen = new Map<string, number>(initial.values.map((entry) => [entry.value.identity, entry.count]));
      let cursor = initial.nextCursor;
      let pages = 1;
      phaseStarted = performance.now();
      while (cursor !== null) {
        const next = await durable.query!({ ...request, discover: [{ facet: "key", search: "key-", size: 97, cursor }] });
        expect(next.ok).toBe(true);
        if (!next.ok) throw new Error("Expected every discovery continuation to succeed");
        const discovery = next.value.discoveries.get("key");
        expect(discovery).toMatchObject({ state: "AVAILABLE", distinctTotal: keyCount, baseEvidenceCount: evidenceCount });
        expect(next.value.telemetry).toMatchObject({
          payloadHydrations: 0,
          lookupPayloadHydrations: 0,
          fullEvidencePayloadHydrations: 0,
          discoveryCandidateCount: evidenceCount,
          discoveryAggregateReads: keyCount,
          discoveryAggregateObservationReads: evidenceCount,
          discoveryPostingValidationReads: evidenceCount,
          discoveryProjectionReads: 0,
          fullRetainedScan: false
        });
        expect(next.value.telemetry?.discoveryMaterializedCandidates).toBeLessThanOrEqual(97);
        if (!discovery || discovery.state !== "AVAILABLE") throw new Error("Expected continuation discovery to be available");
        for (const entry of discovery.values) seen.set(entry.value.identity, entry.count);
        cursor = discovery.nextCursor;
        pages += 1;
      }
      phases.continuationMs = Math.round(performance.now() - phaseStarted);
      console.info("filter-impl-09 durable workload phases", JSON.stringify({ ...phases, pages }));

      expect(pages).toBe(Math.ceil(keyCount / 97));
      expect(seen.size).toBe(keyCount);
      for (let index = 0; index < keyCount; index += 1) {
        const identity = typedFacetValue("key", "string", `key-${String(index).padStart(4, "0")}`).identity;
        expect(seen.get(identity)).toBe(Math.floor(evidenceCount / keyCount) + (index < evidenceCount % keyCount ? 1 : 0));
      }
    } finally {
      await durable.close();
    }
  }, 600_000);

  it("pins a search-mismatching active key with an exact zero count", async () => {
    const name = `filter-impl-09-search-pin-${Date.now()}`;
    Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
    const durable = await createIndexedDbEventHistory({ panelSessionId: name });
    try {
      await durable.offer(workloadEvent(0)).settled;
      const active = typedFacetValue("key", "string", "key-never-observed");
      const result = await durable.query!({
        at: "LATEST_COMMITTED",
        page: { order: "OLDEST_FIRST", size: 10 },
        filter: { ...emptyFilter(), criteria: { key: { include: [active], exclude: [] } } },
        discover: [{ facet: "key", search: "does-not-match", size: 10 }]
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Expected search-mismatch query to succeed");
      expect(result.value.discoveries.get("key")).toEqual({
        state: "AVAILABLE", facet: "key", values: [{ value: active, count: 0, pinned: true }],
        distinctTotal: 0, nextCursor: null, baseEvidenceCount: 1
      });
    } finally {
      await durable.close();
    }
  });
});
