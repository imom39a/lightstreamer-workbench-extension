export const PERFORMANCE_OPERATION_KEY = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
export const FORCED_GC_PASSES = 3;

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_REQUEST_CEILING_MS = 5_000;
const DEFAULT_HEAP_GC_DEADLINE_MS = 240_000;
const DEFAULT_PROGRESS_AGE_CEILING_MS = 120_000;
const DEFAULT_STARTUP_PROGRESS_CEILING_MS = 30_000;
const DEFAULT_QUERY_TOTAL_PROGRESS_CEILING_MS = 120_000;

const MATRIX_SHARDS = Object.freeze([
  Object.freeze({ id: "matrix-indexeddb-sustained", kind: "matrix", adapter: "indexeddb", workload: "sustained", firstCellIndex: 1, collectAfterFinal: true }),
  Object.freeze({ id: "matrix-indexeddb-burst", kind: "matrix", adapter: "indexeddb", workload: "burst", firstCellIndex: 10, collectAfterFinal: true }),
  Object.freeze({ id: "matrix-memory-sustained", kind: "matrix", adapter: "memory", workload: "sustained", firstCellIndex: 19, collectAfterFinal: true }),
  Object.freeze({ id: "matrix-memory-burst", kind: "matrix", adapter: "memory", workload: "burst", firstCellIndex: 28, collectAfterFinal: false })
]);
const SCENARIO_SHARD = Object.freeze({ id: "scenarios", kind: "scenarios" });
export const PERFORMANCE_SELECTION_MODES = Object.freeze({
  FULL_RELEASE: "full-release",
  FILTER_IMPL_08: "filter-impl-08"
});
export const FILTER_IMPL_08_PROOF_GATES = Object.freeze([
  "native-real-chrome-indexeddb-memory-query-matrix",
  "bounded-hydration-index-telemetry",
  "post-gc-heap-check",
  "exact-query-and-heap-thresholds"
]);
export const FILTER_IMPL_08_EXCLUDED_SCENARIOS = Object.freeze([
  "terminal-pressure",
  "checkpoint-pressure",
  "lifecycle"
]);
const FILTER_IMPL_08_QUERY_SHARD = Object.freeze({
  id: "filter-impl-08-query",
  kind: "filter-impl-08"
});

export function createPerformanceShardPlan(selectionMode = PERFORMANCE_SELECTION_MODES.FULL_RELEASE) {
  if (selectionMode === PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08) {
    return [{ ...FILTER_IMPL_08_QUERY_SHARD }];
  }
  if (selectionMode !== PERFORMANCE_SELECTION_MODES.FULL_RELEASE) {
    throw new Error(`Unsupported Event History performance selection mode: ${String(selectionMode)}.`);
  }
  return [...MATRIX_SHARDS, SCENARIO_SHARD].map((shard) => ({ ...shard }));
}

export function aggregatePerformanceShardResults(results, selectionMode = PERFORMANCE_SELECTION_MODES.FULL_RELEASE) {
  if (selectionMode === PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08) {
    return aggregateFilterImpl08ShardResults(results);
  }
  const plan = createPerformanceShardPlan(selectionMode);
  if (!Array.isArray(results) || results.length !== plan.length) {
    throw new Error(`Performance proof requires exactly ${plan.length} ordered shards.`);
  }
  const baseline = results[0];
  const stableFields = ["anchors", "config", "shapeFacts"];
  if (baseline?.proofMode !== undefined) stableFields.push("proofMode", "frameProof");
  const pageTokens = new Set();
  const cells = [];
  const cellCleanupGc = [];
  let terminalScenarios = null;
  let checkpointScenarios = null;
  let queryCells = null;
  const shards = [];
  for (let index = 0; index < plan.length; index += 1) {
    const expected = plan[index];
    const result = results[index];
    if (!result || typeof result !== "object") throw new Error(`Performance shard ${index + 1} result is missing.`);
    const selection = result.selection;
    if (!selection || selection.id !== expected.id || selection.kind !== expected.kind
      || (expected.kind === "matrix" && (selection.adapter !== expected.adapter
        || selection.workload !== expected.workload
        || selection.firstCellIndex !== expected.firstCellIndex
        || selection.collectAfterFinal !== expected.collectAfterFinal))) {
      throw new Error(`Performance shard ${index + 1} identity does not match the deterministic plan.`);
    }
    if (typeof selection.pageToken !== "string" || selection.pageToken.length === 0 || pageTokens.has(selection.pageToken)) {
      throw new Error(`Performance shard ${index + 1} must have a unique non-empty page token.`);
    }
    pageTokens.add(selection.pageToken);
    for (const field of stableFields) {
      if (JSON.stringify(result[field]) !== JSON.stringify(baseline[field])) {
        throw new Error(`Performance shard ${index + 1} ${field} mismatch.`);
      }
    }
    if (expected.kind === "matrix") {
      if (!Array.isArray(result.cells) || result.cells.length !== 9) throw new Error(`Performance shard ${index + 1} must contain exactly 9 cells.`);
      if ((result.terminalScenarios?.length ?? -1) !== 0 || (result.checkpointScenarios?.length ?? -1) !== 0) {
        throw new Error(`Performance matrix shard ${index + 1} must not execute scenarios.`);
      }
      const shapes = ["small-lifecycle", "ordinary-item-update", "large-json-rich"];
      const expectedCells = shapes.flatMap((shape) => [1, 2, 3].map((sample) => `${expected.adapter}/${expected.workload}/${shape}/${sample}`));
      const actualCells = result.cells.map((cell) => `${cell.adapter}/${cell.workload}/${cell.shape}/${cell.sample}`);
      if (actualCells.join("|") !== expectedCells.join("|")) throw new Error(`Performance shard ${index + 1} cell identity/order mismatch.`);
      const expectedCleanupCount = expected.collectAfterFinal ? 9 : 8;
      if (!Array.isArray(result.cellCleanupGc) || result.cellCleanupGc.length !== expectedCleanupCount) {
        throw new Error(`Performance shard ${index + 1} cleanup evidence count mismatch.`);
      }
      const cleanupIndices = result.cellCleanupGc.map((entry) => entry.afterCellIndex);
      const expectedCleanup = Array.from({ length: expectedCleanupCount }, (_, offset) => expected.firstCellIndex + offset);
      if (cleanupIndices.join(",") !== expectedCleanup.join(",")) throw new Error(`Performance shard ${index + 1} cleanup evidence order mismatch.`);
      cells.push(...result.cells);
      cellCleanupGc.push(...result.cellCleanupGc);
    } else {
      if ((result.cells?.length ?? -1) !== 0 || (result.cellCleanupGc?.length ?? -1) !== 0) {
        throw new Error("Performance scenario shard must not execute matrix cells.");
      }
      if (!Array.isArray(result.terminalScenarios) || result.terminalScenarios.length !== 4
        || !Array.isArray(result.checkpointScenarios) || result.checkpointScenarios.length !== 4) {
        throw new Error("Performance scenario shard must execute each terminal and checkpoint scenario exactly once.");
      }
      terminalScenarios = result.terminalScenarios;
      checkpointScenarios = result.checkpointScenarios;
      if (!Array.isArray(result.queryCells) || result.queryCells.length !== 6) {
        throw new Error("Performance scenario shard must execute exactly six filter query samples.");
      }
      const queryCellIds = result.queryCells.map((cell) => `${cell.adapter}/${cell.sample}`);
      if (queryCellIds.join("|") !== "indexeddb/1|indexeddb/2|indexeddb/3|memory/1|memory/2|memory/3") {
        throw new Error("Performance scenario query-cell identity/order mismatch.");
      }
      queryCells = result.queryCells;
    }
    shards.push({ ...selection, cellCount: result.cells.length, cleanupCount: result.cellCleanupGc.length });
  }
  if (cells.length !== 36 || new Set(cells.map((cell) => `${cell.adapter}/${cell.workload}/${cell.shape}/${cell.sample}`)).size !== 36) {
    throw new Error("Performance shard aggregation requires exactly 36 unique matrix cells.");
  }
  if (cellCleanupGc.length !== 35 || cellCleanupGc.some((entry, index) => entry.afterCellIndex !== index + 1)) {
    throw new Error("Performance shard aggregation requires ordered cleanup evidence after cells 1 through 35.");
  }
  return {
    schemaVersion: 2,
    proofMode: baseline.proofMode,
    frameProof: baseline.frameProof,
    anchors: baseline.anchors,
    config: baseline.config,
    shapeFacts: baseline.shapeFacts,
    cells,
    cellCleanupGc,
    terminalScenarios,
    checkpointScenarios,
    queryCells,
    shards
  };
}

function aggregateFilterImpl08ShardResults(results) {
  const plan = createPerformanceShardPlan(PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08);
  if (!Array.isArray(results) || results.length !== plan.length) {
    throw new Error("filter-impl-08 proof requires exactly one ordered query shard.");
  }
  const result = results[0];
  const selection = result?.selection;
  if (!result || typeof result !== "object" || !selection
    || selection.id !== plan[0].id || selection.kind !== plan[0].kind
    || typeof selection.pageToken !== "string" || selection.pageToken.length === 0) {
    throw new Error("filter-impl-08 query shard identity is invalid.");
  }
  if ((result.cells?.length ?? -1) !== 0 || (result.cellCleanupGc?.length ?? -1) !== 0) {
    throw new Error("filter-impl-08 proof must not execute the full-release event matrix.");
  }
  if ((result.terminalScenarios?.length ?? -1) !== 0 || (result.checkpointScenarios?.length ?? -1) !== 0) {
    throw new Error("filter-impl-08 proof must exclude terminal and checkpoint pressure scenarios.");
  }
  const expectedQueryIds = "indexeddb/1|indexeddb/2|indexeddb/3|memory/1|memory/2|memory/3";
  if (!Array.isArray(result.queryCells) || result.queryCells.length !== 6
    || result.queryCells.map((cell) => `${cell.adapter}/${cell.sample}`).join("|") !== expectedQueryIds) {
    throw new Error("filter-impl-08 proof must execute the complete indexeddb/memory query matrix.");
  }
  return {
    schemaVersion: 2,
    selectionMode: PERFORMANCE_SELECTION_MODES.FILTER_IMPL_08,
    proofMode: result.proofMode,
    frameProof: result.frameProof,
    anchors: result.anchors,
    config: result.config,
    shapeFacts: result.shapeFacts,
    cells: [],
    cellCleanupGc: [],
    terminalScenarios: [],
    checkpointScenarios: [],
    queryCells: result.queryCells,
    shards: [{ ...selection, cellCount: 0, cleanupCount: 0, queryCellCount: result.queryCells.length }]
  };
}

export class PerformanceOperationTimeout extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PerformanceOperationTimeout";
    this.status = status;
  }
}

export async function collectHeapAfterRepeatedGc(cdp, passes = FORCED_GC_PASSES, options = {}) {
  if (passes !== FORCED_GC_PASSES) throw new Error(`Heap measurement requires exactly ${FORCED_GC_PASSES} forced GC passes.`);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = options.deadlineAt === undefined
    ? positiveFinite(options.deadlineMs ?? DEFAULT_HEAP_GC_DEADLINE_MS, "heap GC deadlineMs")
    : options.deadlineAt - startedAt;
  if (!Number.isFinite(deadlineMs)) throw new Error("heap GC deadlineAt must be finite.");
  const requestCeilingMs = positiveFinite(options.requestCeilingMs ?? DEFAULT_REQUEST_CEILING_MS, "heap GC requestCeilingMs");
  const deadlineAt = options.deadlineAt ?? startedAt + deadlineMs;
  const request = (method, phase) => requestWithDeadline(cdp, {}, deadlineAt, requestCeilingMs, now, phase, false, method);
  await request("HeapProfiler.enable", "heap-gc-enable");
  for (let pass = 1; pass <= passes; pass += 1) {
    await request("HeapProfiler.collectGarbage", `heap-gc-collection-${pass}`);
  }
  const usage = await request("Runtime.getHeapUsage", "heap-gc-usage");
  return { ...usage, gcPasses: passes };
}

function normalizeCleanupFailure(error, fallbackCode, fallbackMessage) {
  if (error instanceof Error) return error;
  const normalized = new Error(error === undefined ? fallbackMessage : String(error));
  normalized.code = fallbackCode;
  return normalized;
}

function completeCloseOutcome(value) {
  return value !== null && typeof value === "object"
    && value.ok === true
    && value.value !== null && typeof value.value === "object"
    && value.value.dataDisposition === "ERASED"
    && value.value.cleanupDisposition === "COMPLETE";
}

export async function releaseHeapSessionWithCleanup({ release, removeRoot, yieldFrame, forceGc, deadlineAt, now = Date.now }) {
  let firstFailure = null;
  let closeOutcome = null;
  let rootRemoved = false;
  let frameYielded = false;
  let gcPasses = null;
  let gcSample = null;
  try {
    assertSharedDeadline(deadlineAt, now, "lifecycle-release");
    closeOutcome = await release();
    if (!completeCloseOutcome(closeOutcome)) {
      const problem = closeOutcome !== null && typeof closeOutcome === "object" && "problem" in closeOutcome
        && closeOutcome.problem !== null && typeof closeOutcome.problem === "object"
        ? closeOutcome.problem
        : null;
      const failure = new Error(problem !== null && "message" in problem && typeof problem.message === "string"
        ? problem.message
        : "Lifecycle heap cleanup close did not complete with ERASED/COMPLETE disposition.");
      failure.code = problem !== null && "code" in problem && typeof problem.code === "string" ? problem.code : "CLOSE_FAILED";
      firstFailure ??= failure;
    }
  } catch (error) {
    firstFailure ??= normalizeCleanupFailure(error, "CLOSE_FAILED", "Lifecycle heap cleanup close failed.");
  }
  try {
    assertSharedDeadline(deadlineAt, now, "lifecycle-remove-root");
    rootRemoved = await removeRoot();
    if (rootRemoved !== true) {
      const failure = new Error("Lifecycle heap cleanup did not remove its owned root.");
      failure.code = "ROOT_REMOVAL_FAILED";
      firstFailure ??= failure;
    }
  } catch (error) {
    firstFailure ??= normalizeCleanupFailure(error, "ROOT_REMOVAL_FAILED", "Lifecycle heap cleanup root removal failed.");
  }
  try {
    assertSharedDeadline(deadlineAt, now, "lifecycle-yield-frame");
    frameYielded = await yieldFrame();
    if (frameYielded !== true) {
      const failure = new Error("Lifecycle heap cleanup did not yield a frame.");
      failure.code = "FRAME_YIELD_FAILED";
      firstFailure ??= failure;
    }
  } catch (error) {
    firstFailure ??= normalizeCleanupFailure(error, "FRAME_YIELD_FAILED", "Lifecycle heap cleanup frame yield failed.");
  }
  try {
    assertSharedDeadline(deadlineAt, now, "lifecycle-gc");
    gcSample = await forceGc();
    gcPasses = gcSample?.gcPasses ?? null;
    if (gcPasses !== FORCED_GC_PASSES) {
      const failure = new Error(`Lifecycle heap cleanup requires exactly ${FORCED_GC_PASSES} forced GC passes.`);
      failure.code = "GC_FAILED";
      firstFailure ??= failure;
    }
  } catch (error) {
    firstFailure ??= normalizeCleanupFailure(error, "GC_FAILED", "Lifecycle heap cleanup GC failed.");
  }
  if (firstFailure) {
    Object.assign(firstFailure, { closeOutcome, rootRemoved, frameYielded, gcPasses, gcSample });
    throw firstFailure;
  }
  return { ...gcSample, closeOutcome, rootRemoved, frameYielded, gcPasses };
}

export async function runHeapMeasurementPlan({
  adapters = ["indexeddb", "memory"],
  eventCounts,
  sampleCount = 3,
  prepare,
  forceGc,
  record,
  close,
  removeRoot,
  yieldFrame,
  deadlineAt,
  now = Date.now
}) {
  if (sampleCount !== 3) throw new Error("Heap measurement requires exactly three samples per adapter.");
  const heapSamples = [];
  const heapRuns = [];
  const sessionIds = new Set();
  const databaseNames = new Set();
  for (const adapter of adapters) {
    assertSharedDeadline(deadlineAt, now, "heap");
    const eventCount = eventCounts[adapter];
    let warmup = null;
    let prepareFailure = null;
    try {
      assertSharedDeadline(deadlineAt, now, "heap-warmup");
      warmup = await prepare({ adapter, eventCount, phase: "warmup", sample: null, deadlineAt });
    } catch (error) {
      prepareFailure = error;
      if (error?.cleanupEvidence) {
        heapRuns.push(await finishFailedPreparationCleanup(error.cleanupEvidence, {
          adapter,
          eventCount,
          sample: null,
          forceGc
        }));
      }
    }
    if (prepareFailure) {
      throw new Error(`Heap warm-up failed for ${adapter}: ${errorMessage(prepareFailure)}`, { cause: prepareFailure });
    }
    let warmupFailure = null;
    try {
      assertHeapSessionIdentity(warmup, adapter, "warm-up", null, sessionIds, databaseNames);
      assertRetainedCount(warmup, adapter, "warm-up", null, eventCount);
    } catch (error) {
      warmupFailure = error;
    }
    try {
      const evidence = await cleanupHeapSession({ adapter, eventCount, phase: "warmup", sample: null, session: warmup, close, removeRoot, yieldFrame, forceGc, deadlineAt, now });
      heapRuns.push(evidence);
    } catch (error) {
      if (error.evidence) heapRuns.push(error.evidence);
      warmupFailure ??= error;
    }
    if (warmupFailure) {
      throw new Error(`Heap warm-up failed for ${adapter}: ${errorMessage(warmupFailure)}`, { cause: warmupFailure });
    }

    for (let sample = 1; sample <= sampleCount; sample += 1) {
      assertSharedDeadline(deadlineAt, now, "heap-sample");
      let session = null;
      let baseline = null;
      let retained = null;
      let recorded = null;
      let failure = null;
      let cleanupEvidence = null;
      try {
        baseline = await forceGc({ adapter, eventCount, phase: "baseline", sample, deadlineAt });
        assertGcPasses(baseline, "baseline", adapter, sample);
        session = await prepare({ adapter, eventCount, phase: "sample", sample, deadlineAt });
        assertHeapSessionIdentity(session, adapter, "sample", sample, sessionIds, databaseNames);
        assertRetainedCount(session, adapter, "sample", sample, eventCount);
        retained = await forceGc({ adapter, eventCount, phase: "retained", sample, deadlineAt });
        assertGcPasses(retained, "retained", adapter, sample);
        recorded = await record({ adapter, eventCount, sample, session, baseline, retained });
      } catch (error) {
        failure = error;
      }

      if (!session && failure?.cleanupEvidence) {
        heapRuns.push(await finishFailedPreparationCleanup(failure.cleanupEvidence, {
          adapter,
          eventCount,
          sample,
          forceGc
        }));
      } else if (!session && failure) {
        heapRuns.push({
          adapter,
          phase: "cleanup",
          sample,
          eventCount,
          retained: null,
          sessionId: null,
          databaseName: null,
          close: null,
          rootRemoved: false,
          frameYielded: false,
          gcPasses: null,
          status: "FAIL",
          failure: failureDetails(failure)
        });
      }

      if (session) {
        try {
          cleanupEvidence = await cleanupHeapSession({ adapter, eventCount, phase: "cleanup", sample, session, close, removeRoot, yieldFrame, forceGc, deadlineAt, now });
          heapRuns.push(cleanupEvidence);
        } catch (error) {
          cleanupEvidence = error.evidence ?? null;
          if (cleanupEvidence) heapRuns.push(cleanupEvidence);
          failure ??= error;
        }
      }
      if (failure) {
        const cleanupEvidence = failure.cleanupEvidence;
        heapSamples.push({
          adapter,
          sample,
          eventCount,
          sessionId: session?.sessionId ?? cleanupEvidence?.sessionId ?? null,
          databaseName: session?.databaseName ?? cleanupEvidence?.databaseName ?? null,
          status: "FAIL",
          failure: failureDetails(failure),
          baselineUsedSizeBytes: baseline?.usedSize ?? null,
          retainedUsedSizeBytes: retained?.usedSize ?? null,
          postGcHeapDeltaBytes: null
        });
      } else {
        heapSamples.push({
          ...recorded,
          adapter,
          sample,
          eventCount,
          sessionId: session.sessionId,
          databaseName: session.databaseName ?? null,
          status: "PASS",
          failure: null
        });
      }
    }
  }
  return { heapSamples, heapRuns };
}

async function cleanupHeapSession({ adapter, eventCount, phase, sample, session, close, removeRoot, yieldFrame, forceGc, deadlineAt, now }) {
  let failure = null;
  let closeOutcome = null;
  let rootRemoved = false;
  let frameYielded = false;
  let gc = null;
  try {
    assertSharedDeadline(deadlineAt, now, `${phase}-close`);
    closeOutcome = await close(session);
    if (closeOutcome?.ok !== true || closeOutcome.value?.dataDisposition !== "ERASED" || closeOutcome.value?.cleanupDisposition !== "COMPLETE") {
      const error = new Error(`authoritative close did not confirm ERASED/COMPLETE: ${JSON.stringify(closeOutcome)}`);
      error.code = closeOutcome?.problem?.code ?? "CLOSE_FAILED";
      throw error;
    }
  } catch (error) {
    closeOutcome ??= error?.closeOutcome ?? null;
    failure = error;
  }
  try {
    assertSharedDeadline(deadlineAt, now, `${phase}-remove-root`);
    rootRemoved = (await removeRoot(session)) === true;
    if (!rootRemoved) throw new Error("owned DOM root was not confirmed removed.");
  } catch (error) {
    failure ??= error;
  }
  try {
    assertSharedDeadline(deadlineAt, now, `${phase}-yield-frame`);
    frameYielded = (await yieldFrame({ adapter, eventCount, phase, sample })) === true;
    if (!frameYielded) throw new Error("task/frame yield was not confirmed.");
  } catch (error) {
    failure ??= error;
  }
  try {
    assertSharedDeadline(deadlineAt, now, `${phase}-gc`);
    gc = await forceGc({ adapter, eventCount, phase: phase === "warmup" ? "warmup-cleanup" : "cleanup", sample });
    assertGcPasses(gc, phase === "warmup" ? "warmup-cleanup" : "cleanup", adapter, sample);
  } catch (error) {
    failure ??= error;
  }
  const evidence = {
    adapter,
    phase,
    sample,
    eventCount,
    retained: session.retained,
    sessionId: session.sessionId,
    databaseName: session.databaseName ?? null,
    close: closeOutcome,
    rootRemoved,
    frameYielded,
    gcPasses: gc?.gcPasses ?? null,
    status: failure ? "FAIL" : "PASS",
    failure: failure ? failureDetails(failure) : null
  };
  if (failure) {
    failure.evidence = evidence;
    throw failure;
  }
  return evidence;
}

function assertHeapSessionIdentity(session, adapter, phase, sample, sessionIds, databaseNames) {
  if (!session || typeof session.sessionId !== "string" || session.sessionId.length === 0) {
    throw new Error(`missing Panel Session identity for ${adapter} ${phase} sample ${sample ?? "warmup"}`);
  }
  if (adapter === "indexeddb" && (typeof session.databaseName !== "string" || session.databaseName.length === 0)) {
    throw new Error(`missing IndexedDB database identity for ${adapter} ${phase} sample ${sample ?? "warmup"}`);
  }
  if (sessionIds.has(session.sessionId)) throw new Error(`duplicate Panel Session identity: ${session.sessionId}`);
  sessionIds.add(session.sessionId);
  if (adapter === "indexeddb") {
    if (databaseNames.has(session.databaseName)) throw new Error(`duplicate IndexedDB database identity: ${session.databaseName}`);
    databaseNames.add(session.databaseName);
  }
}

function assertRetainedCount(session, adapter, phase, sample, expected) {
  if (session?.retained !== expected) {
    throw new Error(`retained workload mismatch for ${adapter} ${phase} sample ${sample ?? "warmup"}: expected ${expected}, received ${String(session?.retained)}`);
  }
}

function assertGcPasses(value, phase, adapter, sample) {
  if (value?.gcPasses !== 3) {
    throw new Error(`forced GC sequence for ${adapter} ${phase} sample ${sample ?? "warmup"} must run exactly three collections.`);
  }
}

async function finishFailedPreparationCleanup(evidence, { adapter, eventCount, sample, forceGc }) {
  const completed = { ...evidence };
  try {
    const gc = await forceGc({ adapter, eventCount, phase: sample === null ? "warmup-cleanup" : "cleanup", sample });
    assertGcPasses(gc, sample === null ? "warmup-cleanup" : "cleanup", adapter, sample);
    completed.gcPasses = gc.gcPasses;
  } catch (error) {
    completed.gcPasses = null;
    completed.gcFailure = failureDetails(error);
  }
  return completed;
}

export function createSharedDeadlineTimeout(phase, deadlineAt, now = Date.now, operation = null) {
  const elapsedMs = Math.max(0, now() - (deadlineAt ?? now()));
  const status = {
    phase,
    ...(operation ?? { operationId: null, state: "pending", heartbeat: 0, progress: null }),
    state: "rejected",
    elapsedMs,
    error: {
      name: "CdpRequestTimeout",
      code: "SHARED_DEADLINE_EXCEEDED",
      message: `Event History performance proof deadline expired during ${phase}.`,
      stack: null
    }
  };
  return new PerformanceOperationTimeout(status.error.message, status);
}

export function requestControlCdpWithDeadline(cdp, method, params, options = {}) {
  const now = options.now ?? Date.now;
  const startedAt = options.startedAt ?? now();
  const deadlineAt = options.deadlineAt;
  if (!Number.isFinite(deadlineAt)) throw new Error("control CDP deadlineAt must be finite.");
  const requestCeilingMs = positiveFinite(options.requestCeilingMs ?? DEFAULT_REQUEST_CEILING_MS, "control CDP requestCeilingMs");
  return requestWithDeadline(
    cdp,
    params,
    deadlineAt,
    requestCeilingMs,
    now,
    options.phase ?? method,
    options.allowAfterDeadline === true,
    method
  ).catch((error) => {
    if (!(error instanceof CdpRequestTimeout)) throw error;
    const operation = options.operation ?? null;
    const status = {
      phase: error.phase,
      ...(operation ?? { operationId: null, state: "pending", heartbeat: 0, progress: null }),
      state: "rejected",
      elapsedMs: Math.max(error.timeoutMs, now() - startedAt, 0),
      lastRequestTimeout: { phase: error.phase, timeoutMs: error.timeoutMs, ceilingMs: error.ceilingMs },
      error: {
        name: error.name,
        code: "SHARED_DEADLINE_EXCEEDED",
        message: error.message,
        stack: null
      }
    };
    throw new PerformanceOperationTimeout(`Event History performance control request timed out during ${method}.`, status);
  });
}

function failureDetails(error) {
  return {
    code: typeof error?.code === "string" ? error.code : error?.name ?? "HEAP_MEASUREMENT_FAILED",
    message: errorMessage(error),
    ...(error?.cleanupEvidence ? { cleanupEvidence: error.cleanupEvidence } : {})
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

class CdpRequestTimeout extends Error {
  constructor(phase, timeoutMs, ceilingMs) {
    super(`CDP ${phase} request timed out after ${timeoutMs} ms.`);
    this.name = "CdpRequestTimeout";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
    this.ceilingMs = ceilingMs;
  }
}

function progressAgeCeilingMs(progress) {
  if (!progress) return null;
  const stage = typeof progress.stage === "string" ? progress.stage : "";
  const substage = typeof progress.substage === "string" ? progress.substage : "";
  const stageAndSubstage = `${stage} ${substage}`;
  if (progress.phase === "terminal"
    && progress.trigger === "PENDING_AGE"
    && stage === "PENDING_AGE-read"
    && substage === "PENDING_AGE-receipt-settlement") {
    return 120_000;
  }
  const phaseCeiling = progress.phase === "heap"
    ? 240_000
    : progress.phase === "terminal" || progress.phase === "checkpoint"
      ? 120_000
      : DEFAULT_PROGRESS_AGE_CEILING_MS;
  const stageCeiling = /cleanup|close|read/u.test(stage)
    ? 30_000
    : /offer|receipt|commit/u.test(stageAndSubstage)
      ? 120_000
      : /query/u.test(stage)
        ? 30_000
        : null;
  const frameCeiling = /frame/u.test(stage) ? 30_000 : null;
  const ceilings = [phaseCeiling, stageCeiling, frameCeiling].filter((ceiling) => ceiling !== null);
  return Math.min(...ceilings);
}

function isQueryTotalProgress(progress) {
  return progress?.phase === "cells"
    && typeof progress.stage === "string"
    && /^cell-\d+-query$/u.test(progress.stage);
}

function progressTotalStageKey(progress) {
  if (!isQueryTotalProgress(progress)) return null;
  return JSON.stringify([
    progress.phase,
    progress.stage,
    progress.substage,
    progress.sample,
    progress.trigger,
    progress.scenario,
    progress.cellIndex,
    progress.adapter,
    progress.workload,
    progress.shape,
    progress.workloadPhase
  ]);
}

function progressTotalStageCeilingMs(progress) {
  return isQueryTotalProgress(progress) ? DEFAULT_QUERY_TOTAL_PROGRESS_CEILING_MS : null;
}

function progressStageKey(progress) {
  if (!progress) return null;
  return JSON.stringify([
    progress.phase,
    progress.stage,
    progress.substage,
    progress.sample,
    progress.trigger,
    progress.scenario,
    progress.cellIndex,
    progress.adapter,
    progress.workload,
    progress.shape,
    progress.workloadPhase,
    progress.query
  ]);
}

function observeProgressStatus(status, monitor, now) {
  const progress = status.progress;
  if (progress && Number.isSafeInteger(progress.sequence) && progress.sequence > monitor.sequence) {
    const observedAt = now();
    const nextStageKey = progressStageKey(progress);
    const nextTotalStageKey = progressTotalStageKey(progress);
    if (monitor.stageKey !== nextStageKey) {
      monitor.stageKey = nextStageKey;
      monitor.stageStartedAt = observedAt;
      monitor.stageDeadlineMs = progressAgeCeilingMs(progress) ?? DEFAULT_PROGRESS_AGE_CEILING_MS;
    }
    if (monitor.totalStageKey !== nextTotalStageKey) {
      monitor.totalStageKey = nextTotalStageKey;
      monitor.totalStageStartedAt = observedAt;
      monitor.totalStageDeadlineMs = progressTotalStageCeilingMs(progress);
    }
    monitor.sequence = progress.sequence;
    monitor.lastObservedAt = observedAt;
    monitor.ceilingMs = progressAgeCeilingMs(progress);
  }
  const progressAgeMs = monitor.lastObservedAt === null ? null : Math.max(0, now() - monitor.lastObservedAt);
  const progressStageAgeMs = Math.max(0, now() - monitor.stageStartedAt);
  const progressTotalStageAgeMs = monitor.totalStageKey === null
    ? null
    : Math.max(0, now() - monitor.totalStageStartedAt);
  return {
    ...status,
    progressSequence: monitor.sequence >= 0 ? monitor.sequence : null,
    progressAgeMs,
    progressAgeCeilingMs: monitor.ceilingMs,
    lastProgressObservedAt: monitor.lastObservedAt,
    progressStageKey: monitor.stageKey,
    progressStageAgeMs,
    progressStageDeadlineMs: monitor.stageDeadlineMs,
    progressTotalStageKey: monitor.totalStageKey,
    progressTotalStageAgeMs,
    progressTotalStageDeadlineMs: monitor.totalStageDeadlineMs
  };
}

function assertProgressAge(status, monitor, now) {
  const ageMs = monitor.lastObservedAt === null ? null : Math.max(0, now() - monitor.lastObservedAt);
  const stageAgeMs = Math.max(0, now() - monitor.stageStartedAt);
  const totalStageAgeMs = monitor.totalStageKey === null ? null : Math.max(0, now() - monitor.totalStageStartedAt);
  const inactivityExceeded = ageMs !== null && monitor.ceilingMs !== null && ageMs > monitor.ceilingMs;
  const stageExceeded = stageAgeMs > monitor.stageDeadlineMs;
  const totalStageExceeded = totalStageAgeMs !== null
    && monitor.totalStageDeadlineMs !== null
    && totalStageAgeMs > monitor.totalStageDeadlineMs;
  if (inactivityExceeded || stageExceeded || totalStageExceeded) {
    const reason = totalStageExceeded ? "absolute total stage" : stageExceeded ? "absolute stage" : "inactivity";
    throw new PerformanceOperationTimeout(
      `Event History performance operation exceeded its ${reason} progress ceiling in ${status.progress?.stage ?? "startup"}.`,
      {
        ...status,
        progressAgeMs: ageMs,
        progressStageAgeMs: stageAgeMs,
        progressStageDeadlineMs: monitor.stageDeadlineMs,
        progressTotalStageAgeMs: totalStageAgeMs,
        progressTotalStageDeadlineMs: monitor.totalStageDeadlineMs
      }
    );
  }
}

export async function runPageOperation(cdp, expression, options = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const startedAt = now();
  const deadlineMs = options.deadlineAt === undefined
    ? positiveFinite(options.deadlineMs ?? 3_600_000, "deadlineMs")
    : options.deadlineAt - startedAt;
  if (!Number.isFinite(deadlineMs)) throw new Error("deadlineAt must be finite.");
  const pollIntervalMs = positiveFinite(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
  const requestCeilingMs = positiveFinite(options.requestCeilingMs ?? DEFAULT_REQUEST_CEILING_MS, "requestCeilingMs");
  const operationId = options.operationId ?? `${now()}-${Math.random().toString(36).slice(2)}`;
  const deadlineAt = options.deadlineAt ?? startedAt + deadlineMs;
  let lastRequestTimeout = null;
  let pollToken = 0;
  const progressMonitor = {
    sequence: -1,
    lastObservedAt: null,
    ceilingMs: null,
    stageKey: null,
    stageStartedAt: startedAt,
    stageDeadlineMs: DEFAULT_STARTUP_PROGRESS_CEILING_MS,
    totalStageKey: null,
    totalStageStartedAt: startedAt,
    totalStageDeadlineMs: null
  };
  const statusAt = (value, requestTimeout = null) => observeProgressStatus(
    operationStatus(value, startedAt, now, requestTimeout, operationId),
    progressMonitor,
    now
  );
  let lastStatus = statusAt({ operationId, state: "pending", heartbeat: 0 });
  await emitHeartbeat(options.onHeartbeat, lastStatus, options.propagateHeartbeatErrors === true);

  try {
    const startResponse = await requestWithDeadline(cdp, {
      expression: startOperationExpression(expression, operationId),
      awaitPromise: false,
      returnByValue: true
    }, deadlineAt, requestCeilingMs, now, "start");
    lastStatus = statusAt(evaluationValue(startResponse));
    assertProgressAge(lastStatus, progressMonitor, now);

    while (true) {
      let pollResponse;
      try {
        pollResponse = await requestWithDeadline(cdp, {
          expression: pollOperationExpression(operationId, pollToken),
          awaitPromise: false,
          returnByValue: true
        }, deadlineAt, requestCeilingMs, now, "poll");
      } catch (error) {
        if (!(error instanceof CdpRequestTimeout) || error.phase !== "poll") throw error;
        lastRequestTimeout = requestTimeoutDetails(error);
        lastStatus = statusAt(lastStatus, lastRequestTimeout);
        await emitHeartbeat(options.onHeartbeat, lastStatus, options.propagateHeartbeatErrors === true);
        assertProgressAge(lastStatus, progressMonitor, now);
        if (lastStatus.elapsedMs >= deadlineMs) {
          throw new PerformanceOperationTimeout(
            `Event History performance operation timed out after ${lastStatus.elapsedMs} ms.`,
            lastStatus
          );
        }
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - lastStatus.elapsedMs)));
        continue;
      }
      lastStatus = statusAt(evaluationValue(pollResponse), lastRequestTimeout);
      await emitHeartbeat(options.onHeartbeat, lastStatus, options.propagateHeartbeatErrors === true);
      assertProgressAge(lastStatus, progressMonitor, now);
      if (lastStatus.state === "resolved") return lastStatus.result;
      if (lastStatus.state === "rejected") throw remoteOperationError(lastStatus.error);
      if (lastStatus.state !== "pending") throw new Error(`Performance operation entered invalid state: ${lastStatus.state}.`);
      pollToken += 1;
      if (lastStatus.elapsedMs >= deadlineMs) {
        throw new PerformanceOperationTimeout(
          `Event History performance operation timed out after ${lastStatus.elapsedMs} ms.`,
          lastStatus
        );
      }
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - lastStatus.elapsedMs)));
    }
  } catch (error) {
    if (error instanceof CdpRequestTimeout) {
      const timeoutStatus = statusAt(lastStatus, requestTimeoutDetails(error));
      throw new PerformanceOperationTimeout(
        `Event History performance operation timed out during the ${error.phase} CDP request after ${timeoutStatus.elapsedMs} ms.`,
        timeoutStatus
      );
    }
    throw error;
  } finally {
    try {
      await requestWithDeadline(cdp, {
        expression: clearOperationExpression(operationId),
        awaitPromise: false,
        returnByValue: true
      }, deadlineAt, requestCeilingMs, now, "cleanup", true);
    } catch {
      // Preserve the operation result, rejection, or timeout if cleanup itself fails.
    }
  }
}

export function createTimeoutDiagnostic({
  generatedAt,
  source,
  runner,
  environment,
  referencePath,
  deadlineMs,
  operation,
  identity = null,
  foregroundKeeper = null
}) {
  return {
    schemaVersion: 2,
    status: "TIMED_OUT",
    generatedAt,
    source,
    runner,
    environment,
    identity,
    foregroundKeeper,
    operation: {
      deadlineMs,
      phase: operation.phase ?? operation.lastRequestTimeout?.phase ?? null,
      lastStatus: operation,
      progress: operation.progress ?? null
    },
    classification: "NOT_CLASSIFIED",
    reference: {
      path: referencePath,
      separatelyPinned: true,
      adopted: false
    },
    decision: {
      verdict: "FAIL",
      failures: [`Event History performance operation timed out after ${operation.elapsedMs} ms.`],
      reviewReasons: [],
      checkedCells: 0,
      checkedSamples: 0
    }
  };
}

function startOperationExpression(expression, operationId) {
  return `(() => {
    const key = ${JSON.stringify(PERFORMANCE_OPERATION_KEY)};
    const operationId = ${JSON.stringify(operationId)};
    const serializePageProgress = ${serializeOperationProgress.toString()};
    const serializePageCleanupEvidence = ${serializeCleanupEvidence.toString()};
    const existing = globalThis[key];
    if (existing?.state === "pending") throw new Error("A performance operation is already pending.");
    const operation = {
      operationId,
      state: "pending",
      startedAt: performance.now(),
      lastHeartbeatAt: performance.now(),
      heartbeat: 0,
      lastPollToken: null
    };
    globalThis[key] = operation;
    Promise.resolve().then(() => (${expression})).then(
      (result) => {
        if (globalThis[key] !== operation) return;
        operation.state = "resolved";
        operation.result = result;
        operation.completedAt = performance.now();
      },
      (error) => {
        if (globalThis[key] !== operation) return;
        const rawCleanupEvidence = error?.cleanupEvidence;
        const cleanupEvidence = rawCleanupEvidence && typeof rawCleanupEvidence === "object"
          ? serializePageCleanupEvidence(rawCleanupEvidence)
          : null;
        const rawProgress = error?.progress;
        const progress = rawProgress && typeof rawProgress === "object" ? serializePageProgress(rawProgress, operationId) : null;
        operation.state = "rejected";
        operation.error = {
          name: typeof error?.name === "string" ? error.name : "Error",
          message: typeof error?.message === "string" ? error.message : String(error),
          stack: typeof error?.stack === "string" ? error.stack : null,
          ...(typeof error?.code === "string" ? { code: error.code } : {}),
          ...(progress ? { progress } : {}),
          ...(cleanupEvidence ? { cleanupEvidence } : {})
        };
        operation.completedAt = performance.now();
      }
    );
    return { operationId, state: operation.state, startedAt: operation.startedAt, heartbeat: operation.heartbeat };
  })()`;
}

function pollOperationExpression(operationId, logicalPollToken) {
  return `(() => {
    const key = ${JSON.stringify(PERFORMANCE_OPERATION_KEY)};
    const operation = globalThis[key];
    if (!operation || operation.operationId !== ${JSON.stringify(operationId)}) {
      return { operationId: ${JSON.stringify(operationId)}, state: "missing", heartbeat: 0 };
    }
    const logicalPollToken = ${JSON.stringify(logicalPollToken)};
    if (operation.state === "pending"
      && (operation.lastPollToken === null || logicalPollToken > operation.lastPollToken)) {
      operation.heartbeat += 1;
      operation.lastHeartbeatAt = performance.now();
      operation.lastPollToken = logicalPollToken;
    }
    return {
      ...operation,
      ...(operation.progress && typeof operation.progress === "object" ? operation.progress : {})
    };
  })()`;
}

function clearOperationExpression(operationId) {
  return `(() => {
    const key = ${JSON.stringify(PERFORMANCE_OPERATION_KEY)};
    const operation = globalThis[key];
    if (operation?.operationId !== ${JSON.stringify(operationId)}) return false;
    delete globalThis[key];
    return true;
  })()`;
}

function evaluationValue(response) {
  if (response?.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Runtime.evaluate failed.");
  }
  return response?.result?.value;
}

function operationStatus(value, startedAt, now, lastRequestTimeout = null, expectedOperationId) {
  const operationId = value?.operationId === undefined ? null : value.operationId;
  if (operationId !== null && typeof operationId !== "string") {
    throw new Error("Performance operation status has an invalid operationId.");
  }
  if (operationId !== expectedOperationId) {
    throw new Error("Performance operation status has an operationId that does not match the requested operation.");
  }
  const hasProgress = value !== null
    && typeof value === "object"
    && Object.prototype.hasOwnProperty.call(value, "progress");
  if (hasProgress
    && typeof value.progress?.operationId === "string"
    && value.progress.operationId !== expectedOperationId) {
    throw new Error("Performance operation status has an operationId mismatch between status and progress.");
  }
  if (hasProgress && !hasMatchingProgressOperationId(value.progress, expectedOperationId)) {
    throw new Error("Performance operation status has invalid progress or progress operationId.");
  }
  const progress = hasProgress ? serializeOperationProgress(value.progress, expectedOperationId) : null;
  const rawError = value?.error;
  const hasErrorProgress = rawError !== null
    && typeof rawError === "object"
    && Object.prototype.hasOwnProperty.call(rawError, "progress");
  if (hasErrorProgress && !hasMatchingProgressOperationId(rawError.progress, expectedOperationId)) {
    throw new Error("Performance operation status has invalid rejected progress or progress operationId.");
  }
  const error = rawError === undefined ? null : serializeOperationError(rawError, expectedOperationId);
  if (progress !== null && progress.operationId !== null && progress.operationId !== operationId) {
    throw new Error("Performance operation status has an operationId mismatch between status and progress.");
  }
  return {
    state: value?.state ?? "missing",
    elapsedMs: Math.max(0, now() - startedAt),
    heartbeat: Number.isFinite(value?.heartbeat) ? value.heartbeat : 0,
    lastHeartbeatAt: value?.lastHeartbeatAt ?? null,
    ...(lastRequestTimeout ? { lastRequestTimeout } : {}),
    ...(progress ? { ...progress, progress } : {}),
    operationId,
    ...(value?.result !== undefined ? { result: value.result } : {}),
    ...(error ? { error } : {})
  };
}

function hasMatchingProgressOperationId(value, expectedOperationId) {
  return Boolean(value
    && typeof value === "object"
    && typeof value.operationId === "string"
    && value.operationId === expectedOperationId);
}

function requestTimeoutDetails(error) {
  return {
    phase: error.phase,
    timeoutMs: error.timeoutMs,
    ceilingMs: error.ceilingMs
  };
}

function remoteOperationError(details) {
  const safeDetails = serializeOperationError(details);
  const error = new Error(safeDetails?.message ?? "Performance operation rejected.");
  error.name = safeDetails?.name ?? "Error";
  if (safeDetails?.code) error.code = safeDetails.code;
  if (safeDetails?.progress) error.progress = safeDetails.progress;
  if (safeDetails?.cleanupEvidence) error.cleanupEvidence = safeDetails.cleanupEvidence;
  if (safeDetails?.stack) error.stack = safeDetails.stack;
  return error;
}

function serializeOperationError(value, expectedOperationId = null) {
  if (!value || typeof value !== "object") return null;
  const progress = serializeOperationProgress(value.progress, expectedOperationId);
  const cleanupEvidence = serializeCleanupEvidence(value.cleanupEvidence);
  return {
    name: typeof value.name === "string" ? value.name : "Error",
    message: typeof value.message === "string" ? value.message : String(value),
    stack: typeof value.stack === "string" ? value.stack : null,
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(progress ? { progress } : {}),
    ...(cleanupEvidence ? { cleanupEvidence } : {})
  };
}

function serializeOperationProgress(value, expectedOperationId = null) {
  if (!value || typeof value !== "object") return null;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const serializeBoundary = (boundary) => {
    if (boundary === null) return null;
    if (!boundary || typeof boundary !== "object"
      || typeof boundary.intervalId !== "string" || boundary.intervalId.length === 0
      || !Number.isSafeInteger(boundary.sequence) || boundary.sequence < 1
      || typeof boundary.eventId !== "string" || boundary.eventId.length === 0) return undefined;
    return { intervalId: boundary.intervalId, sequence: boundary.sequence, eventId: boundary.eventId };
  };
  const serializeRuntimeDiagnostics = (diagnostics) => {
    if (!diagnostics || typeof diagnostics !== "object") return null;
    const required = [
      "expectedFinalId", "disposed", "visible", "committedEvidenceBoundary", "renderedEvidenceBoundary",
      "pendingVisibleCount", "pendingVisibleHead", "pendingVisibleTail", "evidenceQueryPending",
      "passiveRefreshPending", "queryGeneration", "liveEvidenceTotal", "liveEvidenceTail",
      "lastEvidenceQueryError", "documentVisibilityState", "visibleFrameHeartbeat", "lastVisibleFrameAtMs", "panel"
    ];
    if (!required.every((field) => has(diagnostics, field))) return null;
    const committedEvidenceBoundary = serializeBoundary(diagnostics.committedEvidenceBoundary);
    const renderedEvidenceBoundary = serializeBoundary(diagnostics.renderedEvidenceBoundary);
    const pendingVisibleHead = serializeBoundary(diagnostics.pendingVisibleHead);
    const pendingVisibleTail = serializeBoundary(diagnostics.pendingVisibleTail);
    const validBoundary = (boundary) => boundary !== undefined;
    const liveEvidenceTail = diagnostics.liveEvidenceTail === null
      ? null
      : diagnostics.liveEvidenceTail && typeof diagnostics.liveEvidenceTail === "object"
        && typeof diagnostics.liveEvidenceTail.eventId === "string" && diagnostics.liveEvidenceTail.eventId.length > 0
        ? { eventId: diagnostics.liveEvidenceTail.eventId }
        : undefined;
    const validCount = (count) => Number.isSafeInteger(count) && count >= 0;
    const validOptionalTimestamp = (timestamp) => timestamp === null
      || (Number.isFinite(timestamp) && timestamp >= 0);
    const panel = diagnostics.panel;
    const panelLayoutEffectBoundary = serializeBoundary(panel?.lastLayoutEffectBoundary);
    const validPanel = panel && typeof panel === "object"
      && typeof panel.rootMounted === "boolean"
      && typeof panel.subscriptionActive === "boolean"
      && (panel.lastLayoutEffectSnapshotVersion === null || validCount(panel.lastLayoutEffectSnapshotVersion))
      && panelLayoutEffectBoundary !== undefined
      && typeof panel.animationFramePending === "boolean"
      && validCount(panel.animationFrameRequestCount)
      && validOptionalTimestamp(panel.lastAnimationFrameRequestedAtMs)
      && validCount(panel.animationFrameCallbackCount)
      && validOptionalTimestamp(panel.lastAnimationFrameCallbackAtMs)
      && validCount(panel.animationFrameCancelCount);
    if (typeof diagnostics.expectedFinalId !== "string" || diagnostics.expectedFinalId.length === 0
      || typeof diagnostics.disposed !== "boolean" || typeof diagnostics.visible !== "boolean"
      || !validBoundary(committedEvidenceBoundary) || !validBoundary(renderedEvidenceBoundary)
      || !validBoundary(pendingVisibleHead) || !validBoundary(pendingVisibleTail)
      || !validCount(diagnostics.pendingVisibleCount)
      || typeof diagnostics.evidenceQueryPending !== "boolean" || typeof diagnostics.passiveRefreshPending !== "boolean"
      || !validCount(diagnostics.queryGeneration) || !validCount(diagnostics.liveEvidenceTotal)
      || liveEvidenceTail === undefined
      || (diagnostics.lastEvidenceQueryError !== null && typeof diagnostics.lastEvidenceQueryError !== "string")
      || !["hidden", "visible", "prerender", "unavailable"].includes(diagnostics.documentVisibilityState)
      || !validCount(diagnostics.visibleFrameHeartbeat)
      || (diagnostics.lastVisibleFrameAtMs !== null
        && (!Number.isFinite(diagnostics.lastVisibleFrameAtMs) || diagnostics.lastVisibleFrameAtMs < 0))
      || !validPanel) return null;
    return {
      expectedFinalId: diagnostics.expectedFinalId,
      disposed: diagnostics.disposed,
      visible: diagnostics.visible,
      committedEvidenceBoundary,
      renderedEvidenceBoundary,
      pendingVisibleCount: diagnostics.pendingVisibleCount,
      pendingVisibleHead,
      pendingVisibleTail,
      evidenceQueryPending: diagnostics.evidenceQueryPending,
      passiveRefreshPending: diagnostics.passiveRefreshPending,
      queryGeneration: diagnostics.queryGeneration,
      liveEvidenceTotal: diagnostics.liveEvidenceTotal,
      liveEvidenceTail,
      lastEvidenceQueryError: diagnostics.lastEvidenceQueryError,
      documentVisibilityState: diagnostics.documentVisibilityState,
      visibleFrameHeartbeat: diagnostics.visibleFrameHeartbeat,
      lastVisibleFrameAtMs: diagnostics.lastVisibleFrameAtMs,
      panel: {
        rootMounted: panel.rootMounted,
        subscriptionActive: panel.subscriptionActive,
        lastLayoutEffectSnapshotVersion: panel.lastLayoutEffectSnapshotVersion,
        lastLayoutEffectBoundary: panelLayoutEffectBoundary,
        animationFramePending: panel.animationFramePending,
        animationFrameRequestCount: panel.animationFrameRequestCount,
        lastAnimationFrameRequestedAtMs: panel.lastAnimationFrameRequestedAtMs,
        animationFrameCallbackCount: panel.animationFrameCallbackCount,
        lastAnimationFrameCallbackAtMs: panel.lastAnimationFrameCallbackAtMs,
        animationFrameCancelCount: panel.animationFrameCancelCount
      }
    };
  };
  const operationId = value.operationId === undefined ? null : value.operationId;
  const validPhase = ["cells", "terminal", "checkpoint", "heap", "lifecycle"].includes(value.phase);
  const validWorkload = value.workload === null || value.workload === "sustained" || value.workload === "burst";
  const validShape = value.shape === null || ["small-lifecycle", "ordinary-item-update", "large-json-rich"].includes(value.shape);
  const validWorkloadPhase = value.workloadPhase === null || ["capture", "commit", "paint", "query"].includes(value.workloadPhase);
  const validTrigger = value.trigger === null || value.trigger === "PENDING_BYTES" || value.trigger === "PENDING_AGE";
  const validSample = value.sample === null || (Number.isInteger(value.sample) && value.sample >= 1 && value.sample <= 3);
  const validCellIndex = value.cellIndex === null || (Number.isSafeInteger(value.cellIndex) && value.cellIndex >= 1 && value.cellIndex <= 36);
  const validCount = (count) => count === null || (Number.isSafeInteger(count) && count >= 0);
  const hasRuntimeDiagnostics = has(value, "runtimeDiagnostics");
  const runtimeDiagnostics = hasRuntimeDiagnostics ? serializeRuntimeDiagnostics(value.runtimeDiagnostics) : null;
  if (!validPhase
    || (operationId !== null && typeof operationId !== "string")
    || (expectedOperationId !== null && operationId !== expectedOperationId)
    || typeof value.stage !== "string" || value.stage.length === 0
    || typeof value.substage !== "string" || value.substage.length === 0
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !Number.isFinite(value.pageElapsedMs) || value.pageElapsedMs < 0
    || !validSample || !validTrigger
    || (value.scenario !== null && typeof value.scenario !== "string")
    || !validCellIndex || value.cellTotal !== 36
    || (value.adapter !== null && value.adapter !== "indexeddb" && value.adapter !== "memory")
    || !validWorkload || !validShape || !validWorkloadPhase
    || !validCount(value.offered) || !validCount(value.settled)
    || (value.query !== null && typeof value.query !== "string")
    || (hasRuntimeDiagnostics && runtimeDiagnostics === null)) return null;
  return {
    operationId,
    phase: value.phase,
    stage: value.stage,
    substage: value.substage,
    sequence: value.sequence,
    pageElapsedMs: value.pageElapsedMs,
    sample: value.sample,
    trigger: value.trigger,
    scenario: value.scenario,
    cellIndex: value.cellIndex,
    cellTotal: 36,
    adapter: value.adapter,
    workload: value.workload,
    shape: value.shape,
    workloadPhase: value.workloadPhase,
    offered: value.offered,
    settled: value.settled,
    query: value.query,
    ...(runtimeDiagnostics ? { runtimeDiagnostics } : {})
  };
}

function serializeCleanupEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const requiredFields = [
    "adapter", "phase", "sample", "eventCount", "retained", "sessionId", "databaseName", "close",
    "disposeError", "rootRemoved", "frameYielded", "gcPasses", "status", "failure"
  ];
  if (!requiredFields.every((field) => has(value, field))) return null;
  if (value.adapter !== "indexeddb" && value.adapter !== "memory") return null;
  if (value.phase !== "warmup" && value.phase !== "cleanup") return null;
  if (value.sample !== null && (!Number.isInteger(value.sample) || value.sample < 1 || value.sample > 3)) return null;
  if (!Number.isSafeInteger(value.eventCount) || value.eventCount < 0) return null;
  if (value.retained !== null && (!Number.isSafeInteger(value.retained) || value.retained < 0)) return null;
  if (value.sessionId !== null && typeof value.sessionId !== "string") return null;
  if (value.databaseName !== null && typeof value.databaseName !== "string") return null;
  if (value.disposeError !== null && typeof value.disposeError !== "string") return null;
  if (typeof value.rootRemoved !== "boolean" || typeof value.frameYielded !== "boolean") return null;
  if (value.gcPasses !== null && value.gcPasses !== 3) return null;
  if (value.status !== "PASS" && value.status !== "FAIL") return null;

  let safeClose = null;
  if (value.close !== null) {
    const close = value.close;
    if (!close || typeof close !== "object" || typeof close.ok !== "boolean") return null;
    safeClose = { ok: close.ok };
    if (has(close, "value")) {
      if (!close.value || typeof close.value !== "object"
        || (close.value.dataDisposition !== "ERASED" && close.value.dataDisposition !== "ERASURE_UNCONFIRMED")
        || (close.value.cleanupDisposition !== "COMPLETE" && close.value.cleanupDisposition !== "DEFERRED")) return null;
      safeClose.value = {
        dataDisposition: close.value.dataDisposition,
        cleanupDisposition: close.value.cleanupDisposition
      };
    }
    if (has(close, "problem")) {
      if (!close.problem || typeof close.problem !== "object"
        || typeof close.problem.code !== "string" || typeof close.problem.message !== "string") return null;
      safeClose.problem = { code: close.problem.code, message: close.problem.message };
    }
    if (close.ok === true && !has(close, "value")) return null;
    if (close.ok === false && !has(close, "problem")) return null;
  }

  let failure = null;
  if (value.failure !== null) {
    if (!value.failure || typeof value.failure !== "object"
      || typeof value.failure.code !== "string" || typeof value.failure.message !== "string") return null;
    failure = { code: value.failure.code, message: value.failure.message };
  }
  return {
    adapter: value.adapter,
    phase: value.phase,
    sample: value.sample,
    eventCount: value.eventCount,
    retained: value.retained,
    sessionId: value.sessionId,
    databaseName: value.databaseName,
    close: safeClose,
    disposeError: value.disposeError,
    rootRemoved: value.rootRemoved,
    frameYielded: value.frameYielded,
    gcPasses: value.gcPasses,
    status: value.status,
    failure
  };
}

async function emitHeartbeat(onHeartbeat, status, propagateErrors) {
  try {
    await onHeartbeat?.(status);
  } catch (error) {
    if (propagateErrors) throw error;
    // Ordinary heartbeat reporting must never change the operation verdict.
  }
}

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  return value;
}

function assertSharedDeadline(deadlineAt, now, phase) {
  if (deadlineAt !== undefined && deadlineAt - now() <= 0) {
    throw createSharedDeadlineTimeout(phase, deadlineAt, now);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestWithDeadline(cdp, params, deadlineAt, requestCeilingMs, now, phase, allowAfterDeadline = false, method = "Runtime.evaluate") {
  const remainingMs = deadlineAt - now();
  if (remainingMs <= 0 && !allowAfterDeadline) {
    return Promise.reject(new CdpRequestTimeout(phase, 0, requestCeilingMs));
  }
  const timeoutMs = remainingMs <= 0 && allowAfterDeadline
    ? requestCeilingMs
    : Math.max(1, Math.min(requestCeilingMs, remainingMs));
  return new Promise((resolve, reject) => {
    let settled = false;
    let cancelRequest = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        cancelRequest?.();
      } catch {
        // Local request retirement is best effort; the bounded operation remains fail-closed.
      }
      reject(new CdpRequestTimeout(phase, timeoutMs, requestCeilingMs));
    }, timeoutMs);
    let request;
    try {
      const rawRequest = cdp.request(method, params);
      cancelRequest = typeof rawRequest?.cancel === "function" ? rawRequest.cancel.bind(rawRequest) : null;
      request = Promise.resolve(rawRequest);
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      reject(error);
      return;
    }
    request.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
