import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createEventHistoryWorkloadEvent } from "./event-history-workloads";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";
import type { CaptureReceipt } from "../src/core/event-history-authoritative";

export type HistoryThroughputOptions = {
  count: number;
  payloadFields?: number;
  burstSize?: number;
  pauseMs?: number;
  drainEachBurst?: boolean;
  maxRetainedCount?: number;
};

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Real IndexedDB plus the production mounted panel. This measures commit
 * throughput and query correctness, not foreground/compositor performance. */
export async function runHistoryThroughput({ count, payloadFields = 40, burstSize = 64, pauseMs = 0, drainEachBurst = false, maxRetainedCount }: HistoryThroughputOptions) {
  const history = await createIndexedDbEventHistory({
    panelSessionId: `throughput-${crypto.randomUUID()}`,
    ...(maxRetainedCount === undefined ? {} : { capacity: { maxRetainedCount } })
  });
  const root = document.createElement("main");
  document.body.replaceChildren(root);
  const dispose = mountWorkbenchPanel(root, {
    openHistory: async () => history,
    connectBridge: () => ({ reinjectDraft: async () => { throw new Error("No Injection in the throughput fixture."); }, disconnect() {} })
  });
  const latencies: number[] = [];
  const offeredAt = new Map<string, number>();
  let maxPendingAgeMs = 0, maxPendingBytes = 0, accepted = 0;
  const sample = () => {
    const measurements = history.status().capacity?.measurements;
    if (!measurements) throw new Error("Missing history pressure measurements.");
    maxPendingAgeMs = Math.max(maxPendingAgeMs, measurements.oldestPendingAgeMs ?? 0);
    maxPendingBytes = Math.max(maxPendingBytes, measurements.pendingBytes);
  };
  const stop = history.follow({ from: "NOW" }, publication => {
    if (publication.type === "committed-evidence") {
      for (const entry of publication.evidence) {
        accepted++;
        const start = offeredAt.get(entry.eventId);
        if (start === undefined) throw new Error("Unexpected committed identity.");
        latencies.push(performance.now() - start);
        offeredAt.delete(entry.eventId);
      }
    }
    sample();
  });
  const timer = setInterval(sample, 100);
  try {
    while (!root.querySelector(".workbench-react")) await pause(1);
    const receipts: CaptureReceipt[] = [];
    const started = performance.now();
    for (let index = 0; index < count; index++) {
      const event = createEventHistoryWorkloadEvent("ordinary-item-update", index, "throughput");
      if (payloadFields && event.update) {
        const payload = JSON.stringify(Object.fromEntries(Array.from({ length: payloadFields }, (_, field) => [`field${field}`, `record-${index}-value-${field}-abcdefghijklmnop`])));
        event.update.fields = { ...event.update.fields, payload };
        event.update.changedFields = { ...event.update.changedFields, payload };
      }
      offeredAt.set(event.id, performance.now());
      receipts.push(history.offer(event));
      if ((index + 1) % burstSize === 0) {
        if (drainEachBurst) await Promise.all(receipts.slice(-burstSize).map(receipt => receipt.settled));
        await pause(pauseMs);
      }
      if ((index + 1) % 10000 === 0) console.info(JSON.stringify({
        type: "history-throughput-progress", offered: index + 1, committed: accepted,
        elapsedMs: performance.now() - started, maxPendingAgeMs
      }));
    }
    const outcomes = await Promise.all(receipts.map(receipt => receipt.settled));
    sample();
    const elapsedMs = performance.now() - started;
    latencies.sort((left, right) => left - right);
    const status = history.status();
    const latestId = `throughput-ordinary-item-update-${count - 1}`;
    const queryStarted = performance.now();
    const result = await history.query!({
      at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 1 },
      filter: { revision: 1, text: "", criteria: {}, around: null, unsupported: [] },
      find: { text: payloadFields ? `record-${count - 1}-value-0-` : latestId }
    });
    if (!result.ok) throw new Error(`Post-capture query failed: ${result.problem.message}`);
    return {
      count, payloadFields, burstSize, pauseMs, drainEachBurst, elapsedMs, accepted,
      refused: outcomes.filter(outcome => outcome.outcome !== "BECAME_EVIDENCE").length,
      maxPendingAgeMs, maxPendingBytes, p95CommitLatencyMs: latencies[Math.floor(latencies.length * 0.95)],
      persistence: status.persistence, retained: status.capacity?.measurements,
      queryMs: performance.now() - queryStarted, latestId: result.value.page.evidence[0]?.identity.eventId,
      findTotal: result.value.find?.total, findIds: result.value.find?.matches?.map(match => match.eventId),
      expectedLatestId: latestId
    };
  } finally {
    clearInterval(timer);
    stop();
    await dispose();
    await history.close();
  }
}

declare global { interface Window { runHistoryThroughput: typeof runHistoryThroughput } }
window.runHistoryThroughput = runHistoryThroughput;
