import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import type { EvidenceFilter, EvidenceIdentity, EvidenceQueryRequest, EvidenceSnapshot } from "../src/core/evidence-filter-contract";

type Adapter = "indexeddb" | "memory";
type Measurement = Readonly<{
  operation: string;
  sample: number;
  elapsedMs: number;
  totalMatches: number | null;
  currentSequence: number | null;
  currentIndex: number | null;
  revealRows: number;
  resultRows: number;
  compatibilityIdentities: number;
  telemetry: EvidenceSnapshot["telemetry"];
}>;

const eventId = (sequence: number) => `search-event-${String(sequence).padStart(6, "0")}`;
const emptyFilter = (): EvidenceFilter => ({ revision: 1, text: "", criteria: {}, around: null, unsupported: [] });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function candidate(sequence: number, count: number): LightstreamerEventEnvelope {
  const key = `order-${sequence % 5_000}`;
  return {
    id: eventId(sequence), timestamp: 1_700_000_000_000 + sequence,
    direction: "inbound", source: "server", captureSource: "listener", synthetic: false, kind: "item-update",
    client: { id: "search-client", sessionId: "search-session" },
    subscription: { id: "search-subscription", mode: "COMMAND" },
    item: { name: "search-items", position: 1 }, listener: { id: "search-listener" },
    update: { key, command: "UPDATE", isSnapshot: false, fields: {
      key, command: "UPDATE", value: "all-search-token", category: sequence % 2 === 1 ? "keep-category" : "exclude-category",
      quantity: sequence % 100, rare: sequence === count - 1 ? "late-only-needle" : "ordinary"
    } }
  };
}

async function run(adapter: Adapter, samples: number, retainedCount?: number, liveAppend = false, diagnosticProfileThresholdMs?: number) {
  const productionCount = adapter === "indexeddb" ? 100_000 : 25_000;
  const count = retainedCount ?? productionCount;
  const initialCount = liveAppend ? count - 10 : count;
  assert(Number.isSafeInteger(count) && count >= 2_000 && count % 2 === 0 && count <= productionCount, "Retained fixture count must be even, at least 2,000 and no larger than the adapter's production limit.");
  const sessionId = `evidence-search-perf-${adapter}-${crypto.randomUUID()}`;
  const history: EventHistory = adapter === "indexeddb"
    ? await createIndexedDbEventHistory({ panelSessionId: sessionId, capacityTier: "NORMAL" })
    : createInMemoryEventHistory({ panelSessionId: sessionId, capacityTier: "LOWER" });
  const measurements: Measurement[] = [];
  const progress: {
    adapter: Adapter;
    phase: "seeding" | "querying" | "complete" | "failed";
    accepted: number;
    targetCount: number;
    seedMs: number | null;
    measurements: Measurement[];
    failure?: Readonly<{ operation: string; sample: number; elapsedMs: number; problem: unknown }>;
    error?: string;
  } = { adapter, phase: "seeding", accepted: 0, targetCount: count, seedMs: null, measurements };
  Reflect.set(globalThis, "__evidenceSearchPerformanceProgress", progress);
  const startedAt = performance.now();
  let seedMs = 0;
  try {
    for (let start = 1; start <= initialCount; start += 256) {
      const receipts = Array.from({ length: Math.min(256, initialCount - start + 1) }, (_, index) => history.offer(candidate(start + index, count)));
      assert(receipts.every(({ intake }) => intake === "QUEUED"), `${adapter}: every fixture must enter the production acceptance path`);
      const settled = await Promise.all(receipts.map(({ settled }) => settled));
      assert(settled.every(({ outcome }) => outcome === "BECAME_EVIDENCE"), `${adapter}: all fixture events must commit`);
      progress.accepted += settled.length;
      if (start % 10_240 === 1 || progress.accepted >= count * .98) console.info(`search-performance ${adapter}: accepted ${progress.accepted}/${count}`);
    }
    seedMs = performance.now() - startedAt;
    progress.seedMs = seedMs;
    progress.phase = "querying";
    const seededStatus = history.status();
    assert(seededStatus.retained === initialCount && seededStatus.accepted === initialCount && seededStatus.notAccepted === 0, `${adapter}: initial fixture must be fully retained`);
    assert(seededStatus.capacity.tier === (adapter === "indexeddb" ? "NORMAL" : "LOWER"), `${adapter}: wrong production retention tier`);
    assert(seededStatus.retention?.evicted.count === 0, `${adapter}: search proof cannot silently omit evicted events`);
    assert(history.storage.mode === adapter, `${adapter}: unexpected storage fallback`);
    console.info(`search-performance ${adapter}: ${initialCount}-record fixture ready; query measurements begin next`);
    const beforeQueries = Reflect.get(globalThis, "__evidenceSearchPerformanceBeforeQueries") as (() => Promise<void>) | undefined;
    if (typeof beforeQueries === "function") await beforeQueries();
    // An opened panel already owns an ordinary Evidence read point before Find.
    // Resolve an actual adapter identity without warming any Find query.
    const ready = await history.query!({ at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 1 }, filter: emptyFilter() });
    assert(ready.ok && ready.value.page.evidence.length === 1, `${adapter}: initial Evidence page must be available`);
    const firstIdentity = { ...ready.value.page.evidence[0]!.identity, sequence: 1, eventId: eventId(1) };
    const measure = async (operation: string, sample: number, request: EvidenceQueryRequest): Promise<EvidenceSnapshot> => {
      const beforeMeasure = Reflect.get(globalThis, "__evidenceSearchPerformanceBeforeMeasure") as ((operation: string, sample: number) => Promise<void>) | undefined;
      const afterMeasure = Reflect.get(globalThis, "__evidenceSearchPerformanceAfterMeasure") as ((operation: string, sample: number) => Promise<void>) | undefined;
      if (typeof beforeMeasure === "function") await beforeMeasure(operation, sample);
      const before = performance.now();
      const result = await history.query!(request);
      const elapsedMs = performance.now() - before;
      if (typeof afterMeasure === "function") await afterMeasure(operation, sample);
      if (!result.ok) progress.failure = { operation, sample, elapsedMs, problem: result.problem };
      assert(result.ok, `${adapter}/${operation}: ${!result.ok ? JSON.stringify(result.problem) : ""}`);
      const value = result.value;
      const find = value.find;
      assert(value.page.evidence.length <= 60, `${operation}: ordinary page exceeded 60 records`);
      assert((find?.page?.evidence.length ?? 0) <= 60, `${operation}: reveal page exceeded 60 records`);
      assert((find?.results?.length ?? 0) <= (request.find?.size ?? 50), `${operation}: result page exceeded its requested bound`);
      assert((find?.matches?.length ?? 0) <= 1_000, `${operation}: compatibility identities were unbounded`);
      assert((value.telemetry?.fullEvidencePayloadHydrations ?? 0) <= 1, `${operation}: search hydrated an unbounded payload collection`);
      measurements.push({ operation, sample, elapsedMs, totalMatches: find?.total ?? null,
        currentSequence: find?.current?.sequence ?? null, currentIndex: find?.currentIndex ?? null,
        revealRows: find?.page?.evidence.length ?? 0, resultRows: find?.results?.length ?? 0,
        compatibilityIdentities: find?.matches?.length ?? 0, telemetry: value.telemetry });
      console.info(`search-performance-result ${JSON.stringify({ adapter, ...measurements.at(-1) })}`);
      console.info(`search-performance ${adapter} ${operation} sample ${sample}: ${elapsedMs.toFixed(1)} ms`);
      return value;
    };

    if (liveAppend) {
      const base: EvidenceQueryRequest = {
        at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 60 }, filter: emptyFilter(),
        find: { text: "all-search-token", scopeToFilter: true, includeMatchPayload: true,
          current: { ...firstIdentity, sequence: initialCount - 1, eventId: eventId(initialCount - 1) } }
      };
      const beforeAppend = await measure("pre-append-broad-query", 1, base);
      assert(beforeAppend.find?.total === initialCount && beforeAppend.find.next?.sequence === initialCount, "Pre-append Find must include the complete initial fixture");
      const appendStarted = performance.now();
      const receipts = Array.from({ length: 10 }, (_, index) => history.offer(candidate(initialCount + index + 1, count)));
      assert(receipts.every(receipt => receipt.intake === "QUEUED"), "Live appended records must enter normal capture acceptance");
      const settled = await Promise.all(receipts.map(receipt => receipt.settled));
      assert(settled.every(receipt => receipt.outcome === "BECAME_EVIDENCE"), "Live appended records must commit");
      seedMs += performance.now() - appendStarted;
      progress.seedMs = seedMs;
      progress.accepted += settled.length;
      const afterAppend = await measure("latched-next-after-live-append", 1, {
        ...base, at: beforeAppend.readPoint, find: { ...base.find!, current: beforeAppend.find.next }
      });
      assert(afterAppend.find?.total === initialCount && afterAppend.find.last?.sequence === initialCount
        && afterAppend.find.current?.sequence === initialCount && afterAppend.find.next === null, "Latched Find must exclude newly appended records while navigating its final match");
      assert(afterAppend.readPoint.committedEvidenceBoundary?.sequence === initialCount, "Live append must preserve the latched readpoint");
      for (const record of [...afterAppend.page.evidence, ...(afterAppend.find.page?.evidence ?? [])]) {
        assert(record.identity.sequence <= initialCount, "Live append leaked newer rows into latched context");
      }
      if (adapter === "indexeddb") assert(afterAppend.telemetry?.findCursorReads === 0, "Live append must preserve the unchanged latched Find index");
    }
    const status = history.status();
    assert(status.retained === count && status.accepted === count && status.notAccepted === 0 && status.retention?.evicted.count === 0,
      `${adapter}: complete fixture must remain retained without omission`);

    for (let sample = 1; sample <= samples; sample += 1) {
      const base: EvidenceQueryRequest = {
        at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 60 }, filter: emptyFilter(),
        find: { text: "all-search-token", scopeToFilter: true, includeMatchPayload: true, current: firstIdentity }
      };
      const initial = await measure("initial-broad-query", sample, base);
      assert(initial.find?.total === count && initial.find.current?.sequence === 1, "Broad search must count every retained event and reach its first match");
      assert(initial.find.first?.sequence === 1, "Broad search must identify its first match");
      assert(initial.find.last?.sequence === count, "Broad search must include the final retained event beyond the compatibility window");
      const identity = (sequence: number): EvidenceIdentity => ({ ...initial.find!.first!, sequence, eventId: eventId(sequence) });
      const latched = { ...base, at: initial.readPoint };
      const changed = await measure("changed-selective-query", sample, { ...latched, find: { ...base.find!, text: "late-only-needle" } });
      assert(changed.find?.total === 1 && changed.find.current?.sequence === count - 1, "Changed query must reveal the unique late match");

      const late = await measure("late-broad-query", sample, { ...latched, find: { ...base.find!, current: identity(count - 2) } });
      assert(late.find?.currentIndex === count - 3 && late.find.next?.sequence === count - 1, "Late broad query must preserve the full global match ordinal and next match");
      const next = await measure("next-late-match", sample, { ...latched, find: { ...base.find!, current: late.find.next! } });
      assert(next.find?.current?.sequence === count - 1 && next.find.previous?.sequence === count - 2, "Next must reach a late match and retain its previous neighbor");
      const previous = await measure("previous-late-match", sample, { ...latched, find: { ...base.find!, current: next.find.previous! } });
      assert(previous.find?.current?.sequence === count - 2, "Previous must restore the prior late match");
      const beyond = await measure("beyond-1000-match", sample, { ...latched, find: { ...base.find!, current: identity(1_001) } });
      assert(beyond.find?.currentIndex === 1_000 && beyond.find.previous?.sequence === 1_000 && beyond.find.next?.sequence === 1_002, "Complete neighbors must work after the first 1,000 matches");

      const filtered = await measure("filtered-broad-reveal", sample, {
        ...latched, filter: { ...emptyFilter(), text: "keep-category" }, find: { ...base.find!, current: identity(count - 3) }
      });
      assert(filtered.find?.total === count / 2 && filtered.totals.matching === count / 2, "Filtered Find must count only eligible events");
      assert(filtered.find.current?.sequence === count - 3, "Filtered Find must reveal the requested eligible late match");
      assert(filtered.find.page?.evidence.length === 60, "Filtered reveal must supply the full bounded context page");
      for (const record of [...filtered.page.evidence, ...filtered.find.page.evidence]) {
        assert(record.identity.sequence % 2 === 1 && record.searchText.includes("keep-category"), "Find leaked an excluded record into the filtered page");
      }
      const continuation = await measure("bounded-result-continuation", sample, {
        ...latched, find: { text: "all-search-token", scopeToFilter: true, reveal: false, after: identity(count - 10), size: 7 }
      });
      assert(continuation.find?.total === count && continuation.find.hasMore === true && continuation.find.results?.length === 7, "Result continuation must have bounded output and a complete count");
      assert(continuation.find.results[0]?.identity.sequence === count - 9 && continuation.find.results.at(-1)?.identity.sequence === count - 3, "Result continuation must reach late Evidence beyond 1,000 matches");
      assert(continuation.find.page === undefined && continuation.find.match?.payload === undefined, "Companion-style search must omit reveal windows and unrequested payloads");

      // A literal Find can begin and end inside words and cross normalized
      // whitespace. Exercise that path across every retained row as well as
      // the single-token queries above.
      const crossToken = await measure("cross-token-broad-query", sample, {
        ...latched, find: { ...base.find!, text: "ALUE  all-SEARCH-to" }
      });
      assert(crossToken.find?.total === count && crossToken.find.current?.sequence === 1,
        "Cross-token partial Find must include every retained event");
      const filteredCrossToken = await measure("filtered-cross-token-query", sample, {
        ...latched, filter: { ...emptyFilter(), text: "category keep-category" },
        find: { ...base.find!, text: "alue all-search-to" }
      });
      assert(filteredCrossToken.find?.total === count / 2 && filteredCrossToken.totals.matching === count / 2,
        "Multi-token Filter and partial Find must keep exact eligible counts");
      for (const record of [...filteredCrossToken.page.evidence, ...(filteredCrossToken.find.page?.evidence ?? [])]) {
        assert(record.identity.sequence % 2 === 1, "Multi-token Find leaked an excluded row into its context");
      }
    }
    let diagnosticProfile: Readonly<{ elapsedMs: number; totalMatches: number; telemetry: EvidenceSnapshot["telemetry"]; purpose: string }> | null = null;
    if (diagnosticProfileThresholdMs !== undefined && measurements.some(measurement => measurement.elapsedMs > diagnosticProfileThresholdMs)) {
      const beforeProfile = Reflect.get(globalThis, "__evidenceSearchPerformanceBeforeDiagnosticProfile") as (() => Promise<void>) | undefined;
      const afterProfile = Reflect.get(globalThis, "__evidenceSearchPerformanceAfterDiagnosticProfile") as (() => Promise<void>) | undefined;
      assert(typeof beforeProfile === "function" && typeof afterProfile === "function", "Diagnostic profiling requires the browser runner bindings");
      console.info(`search-performance ${adapter}: acceptance timings complete; profiling a new broad query for diagnosis only`);
      await beforeProfile();
      try {
        const before = performance.now();
        const result = await history.query!({
          at: "LATEST_COMMITTED", page: { order: "NEWEST_FIRST", size: 60 }, filter: emptyFilter(),
          // A different substring forces a cold Find index while keeping exactly
          // the same broad match set in this synthetic retained fixture.
          find: { text: "all-search-toke", scopeToFilter: true, includeMatchPayload: true, current: firstIdentity }
        });
        const elapsedMs = performance.now() - before;
        assert(result.ok && result.value.find?.total === count, "Diagnostic broad query must preserve the full fixture match count");
        diagnosticProfile = { elapsedMs, totalMatches: result.value.find.total, telemetry: result.value.telemetry,
          purpose: "CPU attribution after acceptance timings, with a fresh normalized Find query on the same retained fixture; excluded from latency acceptance samples." };
        console.info(`search-performance ${adapter}: diagnostic-only broad query ${elapsedMs.toFixed(1)} ms`);
      } finally { await afterProfile(); }
    }
    progress.phase = "complete";
    return {
      adapter, samples, retainedCount: count, atProductionRetentionLimit: count === productionCount, liveAppend,
      firstColdOperation: liveAppend ? "pre-append-broad-query" : "initial-broad-query", acceptedCount: status.accepted, seedMs, capacity: status.capacity,
      canonicalBytes: status.capacity.measurements?.retainedBytes ?? null, measurements, diagnosticProfile,
      correctness: { exactRetention: true, completeMatchCount: true, beyond1000: true, lateNavigation: true, filteredPage: true, crossTokenSubstrings: true, multiTokenFilter: true, boundedResponses: true, boundedPayloadHydration: true, ...(liveAppend ? { latchedLiveAppend: true } : {}) },
      elapsedMs: performance.now() - startedAt
    };
  } catch (error) {
    progress.phase = "failed";
    progress.error = String(error);
    throw error;
  } finally { await history.close(); }
}

Reflect.set(globalThis, "__evidenceSearchPerformance", { run });
