export const PERFORMANCE_OPERATION_KEY = "__LSEW_EVENT_HISTORY_PERFORMANCE_OPERATION__";

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_REQUEST_CEILING_MS = 5_000;

export class PerformanceOperationTimeout extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PerformanceOperationTimeout";
    this.status = status;
  }
}

class CdpRequestTimeout extends Error {
  constructor(phase, timeoutMs) {
    super(`CDP ${phase} request timed out after ${timeoutMs} ms.`);
    this.name = "CdpRequestTimeout";
    this.phase = phase;
    this.timeoutMs = timeoutMs;
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
      const pollResponse = await requestWithDeadline(cdp, {
        expression: pollOperationExpression(operationId),
        awaitPromise: false,
        returnByValue: true
      }, deadlineAt, requestCeilingMs, now, "poll");
      lastStatus = operationStatus(evaluationValue(pollResponse), startedAt, now);
      emitHeartbeat(options.onHeartbeat, lastStatus);
      if (lastStatus.state === "resolved") return lastStatus.result;
      if (lastStatus.state === "rejected") throw remoteOperationError(lastStatus.error);
      if (lastStatus.state !== "pending") throw new Error(`Performance operation entered invalid state: ${lastStatus.state}.`);
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
      const timeoutStatus = operationStatus(lastStatus, startedAt, now);
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
      lastStatus: operation
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
      heartbeat: 0
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
        operation.state = "rejected";
        operation.error = {
          name: typeof error?.name === "string" ? error.name : "Error",
          message: typeof error?.message === "string" ? error.message : String(error),
          stack: typeof error?.stack === "string" ? error.stack : null
        };
        operation.completedAt = performance.now();
      }
    );
    return { operationId, state: operation.state, startedAt: operation.startedAt, heartbeat: operation.heartbeat };
  })()`;
}

function pollOperationExpression(operationId) {
  return `(() => {
    const key = ${JSON.stringify(PERFORMANCE_OPERATION_KEY)};
    const operation = globalThis[key];
    if (!operation || operation.operationId !== ${JSON.stringify(operationId)}) {
      return { operationId: ${JSON.stringify(operationId)}, state: "missing", heartbeat: 0 };
    }
    operation.heartbeat += 1;
    operation.lastHeartbeatAt = performance.now();
    return { ...operation };
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

function operationStatus(value, startedAt, now) {
  return {
    operationId: value?.operationId ?? null,
    state: value?.state ?? "missing",
    elapsedMs: Math.max(0, now() - startedAt),
    heartbeat: Number.isFinite(value?.heartbeat) ? value.heartbeat : 0,
    lastHeartbeatAt: value?.lastHeartbeatAt ?? null,
    ...(value?.result !== undefined ? { result: value.result } : {}),
    ...(value?.error !== undefined ? { error: value.error } : {})
  };
}

function remoteOperationError(details) {
  const error = new Error(details?.message ?? "Performance operation rejected.");
  error.name = details?.name ?? "Error";
  if (details?.stack) error.stack = details.stack;
  return error;
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

function requestWithDeadline(cdp, params, deadlineAt, requestCeilingMs, now, phase, allowAfterDeadline = false) {
  const remainingMs = deadlineAt - now();
  if (remainingMs <= 0 && !allowAfterDeadline) {
    return Promise.reject(new CdpRequestTimeout(phase, 0));
  }
  const timeoutMs = remainingMs <= 0 && allowAfterDeadline
    ? requestCeilingMs
    : Math.max(1, Math.min(requestCeilingMs, remainingMs));
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CdpRequestTimeout(phase, timeoutMs));
    }, timeoutMs);
    let request;
    try {
      request = Promise.resolve(cdp.request("Runtime.evaluate", params));
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
