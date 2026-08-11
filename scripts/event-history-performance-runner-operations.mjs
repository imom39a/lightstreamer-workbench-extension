export const PERFORMANCE_OPERATION_KEY = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";
export const FORCED_GC_PASSES = 3;

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_REQUEST_CEILING_MS = 5_000;
const DEFAULT_HEAP_GC_DEADLINE_MS = 240_000;

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
  const deadlineMs = positiveFinite(options.deadlineMs ?? DEFAULT_HEAP_GC_DEADLINE_MS, "heap GC deadlineMs");
  const requestCeilingMs = positiveFinite(options.requestCeilingMs ?? DEFAULT_REQUEST_CEILING_MS, "heap GC requestCeilingMs");
  const deadlineAt = now() + deadlineMs;
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

export async function releaseHeapSessionWithCleanup({ release, removeRoot, yieldFrame, forceGc }) {
  let firstFailure = null;
  let closeOutcome = null;
  let rootRemoved = false;
  let frameYielded = false;
  let gcPasses = null;
  let gcSample = null;
  try {
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
  yieldFrame
}) {
  if (sampleCount !== 3) throw new Error("Heap measurement requires exactly three samples per adapter.");
  const heapSamples = [];
  const heapRuns = [];
  const sessionIds = new Set();
  const databaseNames = new Set();
  for (const adapter of adapters) {
    const eventCount = eventCounts[adapter];
    let warmup = null;
    let prepareFailure = null;
    try {
      warmup = await prepare({ adapter, eventCount, phase: "warmup", sample: null });
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
      const evidence = await cleanupHeapSession({ adapter, eventCount, phase: "warmup", sample: null, session: warmup, close, removeRoot, yieldFrame, forceGc });
      heapRuns.push(evidence);
    } catch (error) {
      if (error.evidence) heapRuns.push(error.evidence);
      warmupFailure ??= error;
    }
    if (warmupFailure) {
      throw new Error(`Heap warm-up failed for ${adapter}: ${errorMessage(warmupFailure)}`, { cause: warmupFailure });
    }

    for (let sample = 1; sample <= sampleCount; sample += 1) {
      let session = null;
      let baseline = null;
      let retained = null;
      let recorded = null;
      let failure = null;
      let cleanupEvidence = null;
      try {
        baseline = await forceGc({ adapter, eventCount, phase: "baseline", sample });
        assertGcPasses(baseline, "baseline", adapter, sample);
        session = await prepare({ adapter, eventCount, phase: "sample", sample });
        assertHeapSessionIdentity(session, adapter, "sample", sample, sessionIds, databaseNames);
        assertRetainedCount(session, adapter, "sample", sample, eventCount);
        retained = await forceGc({ adapter, eventCount, phase: "retained", sample });
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
          cleanupEvidence = await cleanupHeapSession({ adapter, eventCount, phase: "cleanup", sample, session, close, removeRoot, yieldFrame, forceGc });
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

async function cleanupHeapSession({ adapter, eventCount, phase, sample, session, close, removeRoot, yieldFrame, forceGc }) {
  let failure = null;
  let closeOutcome = null;
  let rootRemoved = false;
  let frameYielded = false;
  let gc = null;
  try {
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
    rootRemoved = (await removeRoot(session)) === true;
    if (!rootRemoved) throw new Error("owned DOM root was not confirmed removed.");
  } catch (error) {
    failure ??= error;
  }
  try {
    frameYielded = (await yieldFrame({ adapter, eventCount, phase, sample })) === true;
    if (!frameYielded) throw new Error("task/frame yield was not confirmed.");
  } catch (error) {
    failure ??= error;
  }
  try {
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

export async function runPageOperation(cdp, expression, options = {}) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const deadlineMs = positiveFinite(options.deadlineMs ?? 3_600_000, "deadlineMs");
  const pollIntervalMs = positiveFinite(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
  const requestCeilingMs = positiveFinite(options.requestCeilingMs ?? DEFAULT_REQUEST_CEILING_MS, "requestCeilingMs");
  const operationId = options.operationId ?? `${now()}-${Math.random().toString(36).slice(2)}`;
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;
  let lastRequestTimeout = null;
  let pollToken = 0;
  let lastStatus = operationStatus({ operationId, state: "pending", heartbeat: 0 }, startedAt, now);
  emitHeartbeat(options.onHeartbeat, lastStatus);

  try {
    const startResponse = await requestWithDeadline(cdp, {
      expression: startOperationExpression(expression, operationId),
      awaitPromise: false,
      returnByValue: true
    }, deadlineAt, requestCeilingMs, now, "start");
    lastStatus = operationStatus(evaluationValue(startResponse), startedAt, now);

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
        lastStatus = operationStatus(lastStatus, startedAt, now, lastRequestTimeout);
        emitHeartbeat(options.onHeartbeat, lastStatus);
        if (lastStatus.elapsedMs >= deadlineMs) {
          throw new PerformanceOperationTimeout(
            `Event History performance operation timed out after ${lastStatus.elapsedMs} ms.`,
            lastStatus
          );
        }
        await sleep(Math.min(pollIntervalMs, Math.max(0, deadlineMs - lastStatus.elapsedMs)));
        continue;
      }
      lastStatus = operationStatus(evaluationValue(pollResponse), startedAt, now, lastRequestTimeout);
      emitHeartbeat(options.onHeartbeat, lastStatus);
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
      const timeoutStatus = operationStatus(lastStatus, startedAt, now, requestTimeoutDetails(error));
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
  operation
}) {
  return {
    schemaVersion: 2,
    status: "TIMED_OUT",
    generatedAt,
    source,
    runner,
    environment,
    operation: {
      deadlineMs,
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
        const cleanupEvidence = rawCleanupEvidence && typeof rawCleanupEvidence === "object" ? {
          adapter: rawCleanupEvidence.adapter === "indexeddb" ? "indexeddb" : "memory",
          phase: rawCleanupEvidence.phase === "warmup" ? "warmup" : "cleanup",
          sample: rawCleanupEvidence.sample === null || (Number.isInteger(rawCleanupEvidence.sample) && rawCleanupEvidence.sample >= 1 && rawCleanupEvidence.sample <= 3) ? rawCleanupEvidence.sample : null,
          eventCount: Number.isSafeInteger(rawCleanupEvidence.eventCount) ? rawCleanupEvidence.eventCount : 0,
          retained: rawCleanupEvidence.retained === null || Number.isSafeInteger(rawCleanupEvidence.retained) ? rawCleanupEvidence.retained : null,
          sessionId: typeof rawCleanupEvidence.sessionId === "string" ? rawCleanupEvidence.sessionId : null,
          databaseName: typeof rawCleanupEvidence.databaseName === "string" ? rawCleanupEvidence.databaseName : null,
          close: rawCleanupEvidence.close && typeof rawCleanupEvidence.close === "object" ? {
            ok: rawCleanupEvidence.close.ok === true,
            ...(rawCleanupEvidence.close.value && typeof rawCleanupEvidence.close.value === "object" ? { value: {
              dataDisposition: rawCleanupEvidence.close.value.dataDisposition === "ERASED" ? "ERASED" : "ERASURE_UNCONFIRMED",
              cleanupDisposition: rawCleanupEvidence.close.value.cleanupDisposition === "COMPLETE" ? "COMPLETE" : "DEFERRED"
            } } : {}),
            ...(rawCleanupEvidence.close.problem && typeof rawCleanupEvidence.close.problem === "object" ? { problem: {
              code: typeof rawCleanupEvidence.close.problem.code === "string" ? rawCleanupEvidence.close.problem.code : "CLOSE_FAILED",
              message: typeof rawCleanupEvidence.close.problem.message === "string" ? rawCleanupEvidence.close.problem.message : "Event History cleanup failed."
            } } : {})
          } : null,
          disposeError: typeof rawCleanupEvidence.disposeError === "string" ? rawCleanupEvidence.disposeError : null,
          rootRemoved: rawCleanupEvidence.rootRemoved === true,
          frameYielded: rawCleanupEvidence.frameYielded === true,
          gcPasses: rawCleanupEvidence.gcPasses === 3 ? 3 : null,
          status: rawCleanupEvidence.status === "PASS" ? "PASS" : "FAIL",
          failure: rawCleanupEvidence.failure && typeof rawCleanupEvidence.failure === "object" ? {
            code: typeof rawCleanupEvidence.failure.code === "string" ? rawCleanupEvidence.failure.code : "HEAP_MEASUREMENT_FAILED",
            message: typeof rawCleanupEvidence.failure.message === "string" ? rawCleanupEvidence.failure.message : "Heap measurement failed."
          } : null
        } : null;
        const rawProgress = error?.progress;
        const progress = rawProgress && typeof rawProgress === "object" ? {
          phase: ["cells", "terminal", "checkpoint", "heap", "lifecycle"].includes(rawProgress.phase) ? rawProgress.phase : "cells",
          stage: typeof rawProgress.stage === "string" ? rawProgress.stage : "unknown",
          cellIndex: rawProgress.cellIndex === null || (Number.isSafeInteger(rawProgress.cellIndex) && rawProgress.cellIndex >= 1 && rawProgress.cellIndex <= 36) ? rawProgress.cellIndex : null,
          cellTotal: 36,
          adapter: rawProgress.adapter === "indexeddb" || rawProgress.adapter === "memory" ? rawProgress.adapter : null,
          workload: rawProgress.workload === "sustained" || rawProgress.workload === "burst" ? rawProgress.workload : null,
          shape: ["small-lifecycle", "ordinary-item-update", "large-json-rich"].includes(rawProgress.shape) ? rawProgress.shape : null,
          workloadPhase: ["capture", "commit", "paint", "query"].includes(rawProgress.workloadPhase) ? rawProgress.workloadPhase : null,
          offered: Number.isSafeInteger(rawProgress.offered) && rawProgress.offered >= 0 ? rawProgress.offered : null,
          settled: Number.isSafeInteger(rawProgress.settled) && rawProgress.settled >= 0 ? rawProgress.settled : null,
          query: typeof rawProgress.query === "string" ? rawProgress.query : null
        } : null;
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

function operationStatus(value, startedAt, now, lastRequestTimeout = null) {
  const progress = value?.progress && typeof value.progress === "object" ? value.progress : null;
  return {
    operationId: value?.operationId ?? null,
    state: value?.state ?? "missing",
    elapsedMs: Math.max(0, now() - startedAt),
    heartbeat: Number.isFinite(value?.heartbeat) ? value.heartbeat : 0,
    lastHeartbeatAt: value?.lastHeartbeatAt ?? null,
    ...(lastRequestTimeout ? { lastRequestTimeout } : {}),
    ...(progress ? { ...progress, progress } : {}),
    ...(value?.result !== undefined ? { result: value.result } : {}),
    ...(value?.error !== undefined ? { error: value.error } : {})
  };
}

function requestTimeoutDetails(error) {
  return {
    phase: error.phase,
    timeoutMs: error.timeoutMs,
    ceilingMs: error.ceilingMs
  };
}

function remoteOperationError(details) {
  const error = new Error(details?.message ?? "Performance operation rejected.");
  error.name = details?.name ?? "Error";
  if (typeof details?.code === "string") error.code = details.code;
  const progress = serializeOperationProgress(details?.progress);
  if (progress) error.progress = progress;
  const cleanupEvidence = serializeCleanupEvidence(details?.cleanupEvidence);
  if (cleanupEvidence) error.cleanupEvidence = cleanupEvidence;
  if (details?.stack) error.stack = details.stack;
  return error;
}

function serializeOperationProgress(value) {
  if (!value || typeof value !== "object") return null;
  return {
    phase: ["cells", "terminal", "checkpoint", "heap", "lifecycle"].includes(value.phase) ? value.phase : "cells",
    stage: typeof value.stage === "string" ? value.stage : "unknown",
    cellIndex: value.cellIndex === null || (Number.isSafeInteger(value.cellIndex) && value.cellIndex >= 1 && value.cellIndex <= 36) ? value.cellIndex : null,
    cellTotal: 36,
    adapter: value.adapter === "indexeddb" || value.adapter === "memory" ? value.adapter : null,
    workload: value.workload === "sustained" || value.workload === "burst" ? value.workload : null,
    shape: ["small-lifecycle", "ordinary-item-update", "large-json-rich"].includes(value.shape) ? value.shape : null,
    workloadPhase: ["capture", "commit", "paint", "query"].includes(value.workloadPhase) ? value.workloadPhase : null,
    offered: Number.isSafeInteger(value.offered) && value.offered >= 0 ? value.offered : null,
    settled: Number.isSafeInteger(value.settled) && value.settled >= 0 ? value.settled : null,
    query: typeof value.query === "string" ? value.query : null
  };
}

function serializeCleanupEvidence(value) {
  if (!value || typeof value !== "object") return null;
  const close = value.close;
  const safeClose = close && typeof close === "object"
    ? {
        ok: close.ok === true,
        ...(close.value && typeof close.value === "object" ? {
          value: {
            dataDisposition: close.value.dataDisposition === "ERASED" ? "ERASED" : "ERASURE_UNCONFIRMED",
            cleanupDisposition: close.value.cleanupDisposition === "COMPLETE" ? "COMPLETE" : "DEFERRED"
          }
        } : {}),
        ...(close.problem && typeof close.problem === "object" ? {
          problem: {
            code: typeof close.problem.code === "string" ? close.problem.code : "CLOSE_FAILED",
            message: typeof close.problem.message === "string" ? close.problem.message : "Event History cleanup failed."
          }
        } : {})
      }
    : null;
  return {
    adapter: value.adapter === "indexeddb" ? "indexeddb" : "memory",
    phase: value.phase === "warmup" ? "warmup" : "cleanup",
    sample: value.sample === null || (Number.isInteger(value.sample) && value.sample >= 1 && value.sample <= 3) ? value.sample : null,
    eventCount: Number.isSafeInteger(value.eventCount) ? value.eventCount : 0,
    retained: value.retained === null || Number.isSafeInteger(value.retained) ? value.retained : null,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
    databaseName: typeof value.databaseName === "string" ? value.databaseName : null,
    close: safeClose,
    disposeError: typeof value.disposeError === "string" ? value.disposeError : null,
    rootRemoved: value.rootRemoved === true,
    frameYielded: value.frameYielded === true,
    gcPasses: value.gcPasses === 3 ? 3 : null,
    status: value.status === "PASS" ? "PASS" : "FAIL",
    failure: value.failure && typeof value.failure === "object" ? {
      code: typeof value.failure.code === "string" ? value.failure.code : "HEAP_MEASUREMENT_FAILED",
      message: typeof value.failure.message === "string" ? value.failure.message : "Heap measurement failed."
    } : null
  };
}

function emitHeartbeat(onHeartbeat, status) {
  try {
    onHeartbeat?.(status);
  } catch {
    // Heartbeat reporting must never change the operation verdict.
  }
}

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`);
  return value;
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
