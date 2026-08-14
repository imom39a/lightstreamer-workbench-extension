import { createEventHistoryWorkloadEvent, type EventHistoryShape } from "./event-history-workloads";
import { type EventHistory, type HistoryPublication } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import {
  estimateHistoryCandidateBytes,
  MIB
} from "../src/core/event-history-capacity";
import { mountWorkbenchPanel } from "../src/extension/panel/panel";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { typedFacetValue } from "../src/core/evidence-filter-contract";

export const HISTORY_100K_TARGET_COUNT = 100_000;
export const HISTORY_100K_SAMPLE_COUNT = 3;
const FNV_OFFSET = 2_166_136_261;
const FNV_PRIME = 16_777_619;

export type History100kWorkload =
  | "small-lifecycle"
  | "ordinary-item-update"
  | "large-json-rich"
  | "representative-50-40-10";

export type History100kDigest = Readonly<{
  count: number;
  rollingDigest: string;
  firstEventId: string | null;
  lastEventId: string | null;
  samples: readonly Readonly<{ sequence: number; eventId: string }>[];
}>;

export type History100kActivationCell = Readonly<{
  workload: History100kWorkload;
  sample: number;
  requestedOfferCount: number;
  offeredCount: number;
  acceptedCount: number;
  refusedCount: number;
  retainedCount: number;
  canonicalLogicalBytes: number;
  physicalIndexedDbUsageBytes: number | null;
  physicalIndexedDbUsageDeltaBytes: number | null;
  quotaBytes: number | null;
  expected: History100kDigest;
  published: History100kDigest;
  retained: History100kDigest;
  correctness: Readonly<{
    exactCount: boolean;
    orderedPublication: boolean;
    orderedRetention: boolean;
    boundaryIdentity: boolean;
    retainedRangeIdentity: boolean;
    exactFirstMissingEvidence: boolean;
    exactlyOneTerminalPublication: boolean;
    panelRemainedMounted: boolean;
  }>;
  pressure: Readonly<{
    transitions: readonly string[];
    reachedNearLimit: boolean;
  }>;
  terminal: Readonly<{
    reason: string | null;
    dimension: string | null;
    committedBoundary: Readonly<{ sequence: number; eventId: string }> | null;
    firstMissingEventId: string | null;
  }>;
  queries: Readonly<{
    recentPageCount: number;
    structuredPageCount: number;
    findTotal: number | null;
    payloadHydrations: number;
    completePayloadCollection: false;
  }>;
  elapsedMs: number;
}>;

type DigestTracker = Readonly<{
  add(sequence: number, eventId: string): void;
  snapshot(): History100kDigest;
}>;

function rollDigest(hash: number, sequence: number, eventId: string): number {
  const value = `${sequence}\u0000${eventId}\u0000`;
  let next = hash;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, FNV_PRIME) >>> 0;
  }
  return next >>> 0;
}

function createDigestTracker(): DigestTracker {
  const sampleSequences = new Set([1, 2, 3, 50_000, 99_998, 99_999, 100_000]);
  const samples: Array<{ sequence: number; eventId: string }> = [];
  let count = 0;
  let digest = FNV_OFFSET;
  let firstEventId: string | null = null;
  let lastEventId: string | null = null;
  return {
    add(sequence, eventId) {
      count += 1;
      digest = rollDigest(digest, sequence, eventId);
      firstEventId ??= eventId;
      lastEventId = eventId;
      if (sampleSequences.has(sequence)) samples.push({ sequence, eventId });
    },
    snapshot() {
      return Object.freeze({
        count,
        rollingDigest: digest.toString(16).padStart(8, "0"),
        firstEventId,
        lastEventId,
        samples: Object.freeze(samples.slice())
      });
    }
  };
}

function shapeFor(workload: History100kWorkload, sequence: number): EventHistoryShape {
  if (workload !== "representative-50-40-10") return workload;
  const bucket = sequence % 10;
  return bucket < 5 ? "small-lifecycle" : bucket < 9 ? "ordinary-item-update" : "large-json-rich";
}

function expectedEvent(workload: History100kWorkload, sequence: number, runId: string) {
  return createEventHistoryWorkloadEvent(shapeFor(workload, sequence), sequence, runId);
}

function sameDigest(left: History100kDigest, right: History100kDigest): boolean {
  return left.count === right.count
    && left.rollingDigest === right.rollingDigest
    && left.firstEventId === right.firstEventId
    && left.lastEventId === right.lastEventId
    && left.samples.length === right.samples.length
    && left.samples.every((sample, index) => {
      const other = right.samples[index];
      return other?.sequence === sample.sequence && other.eventId === sample.eventId;
    });
}

async function waitFor(predicate: () => boolean, timeoutMs = 30_000): Promise<void> {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) throw new Error("100k activation harness timed out waiting for production state.");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function queryCount(history: EventHistory, request: Parameters<NonNullable<EventHistory["read"]>>[0]): Promise<{ count: number; payloadHydrations: number }> {
  const result = await history.read!(request);
  if (!result.ok) throw new Error(`100k activation query failed: ${result.problem.message}`);
  return {
    count: result.value.evidence.length,
    payloadHydrations: result.value.evidence.length
  };
}

async function canonicalQueryCount(
  history: EventHistory,
  options: Readonly<{ mode?: string; find?: string }>
): Promise<{ count: number; total: number; payloadHydrations: number }> {
  const filter = {
    revision: 1,
    text: "",
    criteria: options.mode === undefined
      ? {}
      : { mode: { include: [typedFacetValue("mode", "enum", options.mode)], exclude: [] } },
    around: null,
    unsupported: []
  };
  const result = await history.query!({
    at: "LATEST_COMMITTED",
    page: { order: "OLDEST_FIRST", size: 100 },
    filter,
    ...(options.find === undefined ? {} : { find: { text: options.find, scopeToFilter: true } })
  });
  if (!result.ok) throw new Error(`100k activation canonical query failed: ${result.problem.message}`);
  return {
    count: result.value.page.evidence.length,
    total: result.value.find?.total ?? result.value.totals.matching,
    payloadHydrations: result.value.telemetry?.payloadHydrations ?? result.value.page.evidence.length
  };
}

export async function runHistory100kActivationCell(
  workload: History100kWorkload,
  sample: number
): Promise<History100kActivationCell> {
  const startedAt = performance.now();
  const runId = `history-100k-07-${workload}-${sample}`;
  const history = await createIndexedDbEventHistory({ panelSessionId: runId, capacityTier: "NORMAL" });
  const beforeStorage = await (navigator.storage?.estimate() ?? Promise.resolve({})).catch(() => ({}));
  const root = document.createElement("main");
  root.id = "app";
  document.body.replaceChildren(root);
  let runtime: ReturnType<typeof createWorkbenchRuntime> | null = null;
  const disposePanel = mountWorkbenchPanel(root, {
    openHistory: async () => history,
    createRuntime: (options) => {
      runtime = createWorkbenchRuntime({ ...options, captureStatus: "capturing" });
      return runtime;
    },
    connectBridge: () => ({
      reinjectDraft: async () => {
        throw new Error("100k activation proof does not execute Local Injection.");
      },
      disconnect() {}
    })
  });
  try {
    await waitFor(() => runtime !== null && root.querySelector(".workbench-react") !== null);
    const published = createDigestTracker();
    const expected = createDigestTracker();
    const expectedPage = createDigestTracker();
    const retained = createDigestTracker();
    const transitions: string[] = [];
    let terminal: Extract<HistoryPublication, { type: "terminal" }>["terminal"] | null = null;
    let terminalPublicationCount = 0;
    const unsubscribe = history.follow({ from: "NOW" }, (publication) => {
      if (publication.type === "status") {
        const state = publication.status.capacity.state;
        if (transitions.at(-1) !== state) transitions.push(state);
      }
      if (publication.type === "terminal") {
        terminal = publication.terminal;
        terminalPublicationCount += 1;
      }
      if (publication.type === "committed-evidence") {
        for (const evidence of publication.evidence) published.add(evidence.sequence, evidence.eventId);
      }
    });

    const requestedOfferCount = workload === "large-json-rich"
      ? HISTORY_100K_TARGET_COUNT
      : HISTORY_100K_TARGET_COUNT + 1;
    let offeredCount = 0;
    let acceptedCount = 0;
    let refusedCount = 0;
    let canonicalLogicalBytes = 0;
    let firstMissingEventId: string | null = null;
    let inFlight: Array<Promise<unknown>> = [];
    for (let index = 0; index < requestedOfferCount; index += 1) {
      const candidate = expectedEvent(workload, index, runId);
      const sequence = index + 1;
      const receipt = history.offer(candidate);
      offeredCount += 1;
      if (receipt.intake !== "QUEUED") {
        refusedCount += 1;
        firstMissingEventId ??= candidate.id;
        await receipt.settled;
        break;
      }
      acceptedCount += 1;
      expected.add(sequence, candidate.id);
      if (sequence <= 100) expectedPage.add(sequence, candidate.id);
      canonicalLogicalBytes += estimateHistoryCandidateBytes(candidate);
      inFlight.push(receipt.settled);
      if (inFlight.length >= 256) {
        await Promise.all(inFlight);
        inFlight = [];
      }
    }
    await Promise.all(inFlight);
    await waitFor(() => history.status().awaitingAcceptance === 0, 60_000);
    const status = history.status();
    const afterStorage = await (navigator.storage?.estimate() ?? Promise.resolve({})).catch(() => ({}));
    const firstPage = await queryCount(history, { order: "asc", limit: 100 });
    const recentPage = await queryCount(history, { order: "desc", limit: 100 });
    const structured = await canonicalQueryCount(history, { mode: "COMMAND" });
    const find = await canonicalQueryCount(history, { find: "order" });
    const retainedPage = await history.read!({ order: "asc", limit: 100 });
    if (!retainedPage.ok) throw new Error(`100k activation retained page failed: ${retainedPage.problem.message}`);
    for (const evidence of retainedPage.value.evidence) {
      retained.add(evidence.sequence, evidence.eventId);
    }
    // The page above is deliberately bounded. Add only the retained-range
    // endpoints to a second bounded digest, never the complete payload set.
    const oldest = (await history.read!({ order: "asc", limit: 1 }));
    const newest = (await history.read!({ order: "desc", limit: 1 }));
    const retainedRangeIdentity = oldest.ok && newest.ok
      && oldest.value.evidence[0]?.identity.sequence === (status.retainedRange?.first.sequence ?? -1)
      && newest.value.evidence[0]?.identity.sequence === (status.retainedRange?.last.sequence ?? -1);
    const expectedDigest = expected.snapshot();
    const publishedDigest = published.snapshot();
    const retainedDigest = retained.snapshot();
    const terminalValue = terminal;
    const boundaryIdentity = terminalValue === null
      ? status.committedEvidenceBoundary?.sequence === acceptedCount
        && status.committedEvidenceBoundary?.eventId === expectedDigest.lastEventId
      : terminalValue.committedEvidenceBoundary?.sequence === acceptedCount
        && terminalValue.committedEvidenceBoundary?.eventId === expectedDigest.lastEventId;
    const expectedFirstMissing = acceptedCount < HISTORY_100K_TARGET_COUNT || requestedOfferCount > acceptedCount
      ? firstMissingEventId === (terminalValue?.firstMissingEventId ?? firstMissingEventId)
      : terminalValue === null;
    const exactCount = workload === "large-json-rich"
      ? acceptedCount < HISTORY_100K_TARGET_COUNT && canonicalLogicalBytes < 256 * MIB
      : acceptedCount === HISTORY_100K_TARGET_COUNT;
    const result: History100kActivationCell = Object.freeze({
      workload,
      sample,
      requestedOfferCount,
      offeredCount,
      acceptedCount,
      refusedCount,
      retainedCount: status.retained,
      canonicalLogicalBytes,
      physicalIndexedDbUsageBytes: typeof afterStorage?.usage === "number" ? afterStorage.usage : null,
      physicalIndexedDbUsageDeltaBytes: typeof afterStorage?.usage === "number" && typeof beforeStorage?.usage === "number"
        ? afterStorage.usage - beforeStorage.usage
        : null,
      quotaBytes: typeof afterStorage?.quota === "number" ? afterStorage.quota : null,
      expected: expectedDigest,
      published: publishedDigest,
      retained: retainedDigest,
      correctness: {
        exactCount,
        orderedPublication: sameDigest(expectedDigest, publishedDigest),
        orderedRetention: sameDigest(retainedDigest, expectedPage.snapshot()),
        boundaryIdentity,
        retainedRangeIdentity,
        exactFirstMissingEvidence: expectedFirstMissing,
        exactlyOneTerminalPublication: terminalValue === null ? terminalPublicationCount === 0 : terminalPublicationCount === 1,
        panelRemainedMounted: root.isConnected && root.querySelector(".workbench-react") !== null
      },
      pressure: {
        transitions: Object.freeze(transitions.slice()),
        reachedNearLimit: transitions.includes("NEAR_LIMIT")
      },
      terminal: {
        reason: terminalValue?.reason ?? null,
        dimension: terminalValue?.dimension ?? null,
        committedBoundary: terminalValue?.committedEvidenceBoundary
          ? { sequence: terminalValue.committedEvidenceBoundary.sequence, eventId: terminalValue.committedEvidenceBoundary.eventId }
          : status.committedEvidenceBoundary
            ? { sequence: status.committedEvidenceBoundary.sequence, eventId: status.committedEvidenceBoundary.eventId }
            : null,
        firstMissingEventId: terminalValue?.firstMissingEventId ?? firstMissingEventId
      },
      queries: {
        recentPageCount: recentPage.count,
        structuredPageCount: structured.count,
        findTotal: find.total,
        payloadHydrations: firstPage.payloadHydrations + recentPage.payloadHydrations + structured.payloadHydrations + find.payloadHydrations,
        completePayloadCollection: false
      },
      elapsedMs: performance.now() - startedAt
    });
    unsubscribe();
    return result;
  } finally {
    await disposePanel();
    if (history.status().phase !== "CLOSED") await history.close();
  }
}

declare global {
  interface Window {
    __LSEW_HISTORY_100K_ACTIVATION__?: {
      run(workload: History100kWorkload, sample: number): Promise<History100kActivationCell>;
    };
  }
}

window.__LSEW_HISTORY_100K_ACTIVATION__ = {
  run: runHistory100kActivationCell
};
