import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTimeoutDiagnostic,
  collectHeapAfterRepeatedGc,
  runHeapMeasurementPlan,
  PerformanceOperationTimeout,
  releaseHeapSessionWithCleanup,
  runPageOperation
} from "../scripts/event-history-performance-runner-operations.mjs";

type FakeCdpResponse = Readonly<{
  result: Readonly<{ value: unknown }>;
}>;

type FakeCdpReply = FakeCdpResponse | Promise<FakeCdpResponse>;
type CancelableFakeCdpRequest = Promise<FakeCdpResponse> & { cancel?: () => void };

class FakeCdp {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  cancelledRequests = 0;
  private readonly responses: FakeCdpReply[];

  constructor(responses: readonly FakeCdpReply[]) {
    this.responses = [...responses];
  }

  request(method: string, params: Record<string, unknown> = {}): CancelableFakeCdpRequest {
    this.calls.push({ method, params });
    const response = this.responses.shift();
    const request = (response
      ? Promise.resolve(response)
      : Promise.reject(new Error(`Unexpected CDP request ${method}.`))) as CancelableFakeCdpRequest;
    request.cancel = () => { this.cancelledRequests += 1; };
    return request;
  }
}

class LatePollCdp {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  private readonly page = {
    operationId: "late-poll-operation",
    state: "pending",
    heartbeat: 0,
    lastPollToken: null as number | null,
    result: null as { source: string } | null
  };
  private resolveOriginal!: (response: FakeCdpResponse) => void;
  private cleaned = false;
  lateSnapshot: Record<string, unknown> | null = null;
  terminalLateSnapshot: Record<string, unknown> | null = null;

  request(method: string, params: Record<string, unknown> = {}): CancelableFakeCdpRequest {
    this.calls.push({ method, params });
    if (this.calls.length === 1) {
      return Promise.resolve(evaluated({ operationId: this.page.operationId, state: "pending", heartbeat: 0 })) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 2) {
      const request = new Promise<FakeCdpResponse>((resolve) => { this.resolveOriginal = resolve; }) as CancelableFakeCdpRequest;
      request.cancel = () => undefined;
      return request;
    }
    if (this.calls.length === 3) {
      this.page.state = "resolved";
      this.page.result = { source: "retry" };
      return Promise.resolve(this.evaluatePoll(params)) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 4) {
      this.terminalLateSnapshot = this.evaluatePoll({ expression: "const logicalPollToken = 1;" }).result.value as Record<string, unknown>;
      this.cleaned = true;
      return Promise.resolve(evaluated(true)) as CancelableFakeCdpRequest;
    }
    return Promise.resolve(evaluated(true)) as CancelableFakeCdpRequest;
  }

  resolveLateOriginal(): void {
    const response = this.evaluatePoll(this.calls[1]?.params ?? {});
    this.lateSnapshot = response.result.value as Record<string, unknown>;
    this.resolveOriginal(response);
  }

  private evaluatePoll(params: Record<string, unknown>): FakeCdpResponse {
    if (this.cleaned) return evaluated({ operationId: this.page.operationId, state: "missing", heartbeat: 0 });
    const expression = String(params.expression ?? "");
    const tokenMatch = expression.match(/const logicalPollToken = (\d+);/u);
    const token = tokenMatch ? Number(tokenMatch[1]) : null;
    const hasMonotonicGuard = expression.includes("logicalPollToken > operation.lastPollToken");
    const hasPendingGuard = expression.includes('operation.state === "pending"');
    const acceptsToken = hasMonotonicGuard
      ? (this.page.lastPollToken === null || token !== null && token > this.page.lastPollToken)
      : (token === null || this.page.lastPollToken !== token);
    if ((!hasPendingGuard || this.page.state === "pending") && acceptsToken) {
      this.page.heartbeat += 1;
      this.page.lastPollToken = token;
    }
    return evaluated({ ...this.page });
  }
}

class OrderedPollCdp {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly snapshots: Record<string, unknown>[] = [];
  private readonly order: "before-retry" | "after-token";
  private readonly page = {
    operationId: "ordered-poll-operation",
    state: "pending",
    heartbeat: 0,
    lastPollToken: null as number | null,
    result: null as { source: string } | null
  };
  private resolveOriginal!: (response: FakeCdpResponse) => void;
  originalSnapshot: Record<string, unknown> | null = null;

  constructor(order: "before-retry" | "after-token") {
    this.order = order;
  }

  request(method: string, params: Record<string, unknown> = {}): CancelableFakeCdpRequest {
    this.calls.push({ method, params });
    if (this.calls.length === 1) {
      return Promise.resolve(evaluated({ operationId: this.page.operationId, state: "pending", heartbeat: 0 })) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 2) {
      const request = new Promise<FakeCdpResponse>((resolve) => { this.resolveOriginal = resolve; }) as CancelableFakeCdpRequest;
      request.cancel = () => {
        if (this.order === "before-retry") this.resolveOriginal(this.captureOriginal());
      };
      return request;
    }
    if (this.calls.length === 3) {
      const response = this.capturePoll(params);
      return Promise.resolve(response) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 4 && this.order === "before-retry") {
      this.page.state = "resolved";
      this.page.result = { source: "before-retry" };
      return Promise.resolve(this.capturePoll(params)) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 4) {
      const response = this.capturePoll(params);
      const originalResponse = this.captureOriginal();
      this.resolveOriginal(originalResponse);
      return Promise.resolve(response) as CancelableFakeCdpRequest;
    }
    if (this.calls.length === 5) {
      this.page.state = "resolved";
      this.page.result = { source: "after-token" };
      return Promise.resolve(this.capturePoll(params)) as CancelableFakeCdpRequest;
    }
    return Promise.resolve(evaluated(true)) as CancelableFakeCdpRequest;
  }

  private captureOriginal(): FakeCdpResponse {
    const response = this.evaluatePoll(this.calls[1]?.params ?? {});
    this.originalSnapshot = response.result.value as Record<string, unknown>;
    return response;
  }

  private capturePoll(params: Record<string, unknown>): FakeCdpResponse {
    const response = this.evaluatePoll(params);
    this.snapshots.push(response.result.value as Record<string, unknown>);
    return response;
  }

  private evaluatePoll(params: Record<string, unknown>): FakeCdpResponse {
    const expression = String(params.expression ?? "");
    const tokenMatch = expression.match(/const logicalPollToken = (\d+);/u);
    const token = tokenMatch ? Number(tokenMatch[1]) : null;
    const hasMonotonicGuard = expression.includes("logicalPollToken > operation.lastPollToken");
    const hasPendingGuard = expression.includes('operation.state === "pending"');
    const acceptsToken = hasMonotonicGuard
      ? (this.page.lastPollToken === null || token !== null && token > this.page.lastPollToken)
      : (token === null || this.page.lastPollToken !== token);
    if ((!hasPendingGuard || this.page.state === "pending") && acceptsToken) {
      this.page.heartbeat += 1;
      this.page.lastPollToken = token;
    }
    return evaluated({ ...this.page });
  }
}

function evaluated(value: unknown): FakeCdpResponse {
  return { result: { value } };
}

function watchdog<T>(promise: Promise<T>, milliseconds = 100): Promise<T | "WATCHDOG"> {
  return Promise.race([
    promise,
    new Promise<"WATCHDOG">((resolve) => setTimeout(() => resolve("WATCHDOG"), milliseconds))
  ]);
}

function expectTimeoutOutcome(result: unknown): PerformanceOperationTimeout {
  expect(result).not.toBe("WATCHDOG");
  expect(result).toHaveProperty("error");
  expect(result).not.toHaveProperty("value");
  const error = (result as { error: unknown }).error;
  expect(error).toBeInstanceOf(PerformanceOperationTimeout);
  return error as PerformanceOperationTimeout;
}

describe("Event History performance runner reference preflight", () => {
  it("wires the production runner through the heap plan and repeated GC seam", () => {
    const source = readFileSync("scripts/event-history-performance.mjs", "utf8");
    expect(source).toContain("runHeapMeasurementPlan");
    expect(source).toContain("collectHeapAfterRepeatedGc");
    expect(source).toContain("removeRetainedHeapRoot");
    expect(source).toContain("yieldRetainedHeapFrame");
    expect(source).toContain("heapRuns: heapPlan.heapRuns");
    expect(source).toContain("releaseHeapSessionWithCleanup");
    expect(readFileSync("benchmarks/event-history-performance-harness.ts", "utf8")).toContain("captureStorageEstimate");
    expect(source).toContain("offerToPublicationP95Ms");
    expect(source).toContain("behindBacklogMs");
    expect(source).toContain("longTaskRows");
    expect(source).toContain("terminalRows");
    expect(source).toContain("heapRunRows");
    expect(source).toContain("${checkpointRows}");
    expect(source).toContain("## Checkpoint evidence");
    expect(source).toContain("interleavedWhileStaging");
    expect(source).toContain("identityEvidence");
    expect(source).toContain("navigator.storage.estimate()");
    expect(source).not.toContain("function gcHeap");
  });

  it("rejects a pending reference before looking for or launching Chrome", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lsew-reference-preflight-test-"));
    const referencePath = join(temporaryRoot, "pending-reference.json");
    writeFileSync(referencePath, JSON.stringify({
      schemaVersion: 2,
      referenceVersion: "history-impl-11-initial",
      disposition: "PENDING_MAINTAINER_BASELINE",
      rationale: "pending",
      environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64" },
      cells: []
    }));

    try {
      expect(() => execFileSync(process.execPath, ["scripts/event-history-performance.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LSEW_BROWSER_HEADLESS: "false",
          LSEW_UI_HEADLESS: "false",
          LSEW_BROWSER_CACHE_DIR: join(temporaryRoot, "missing-cache"),
          LSEW_EVENT_HISTORY_PERF_REFERENCE: referencePath
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })).toThrow(/Pinned reference preflight failed/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("Event History heap measurement plan", () => {
  it("performs exactly three forced collections before each heap usage read", async () => {
    const cdp = new FakeCdp(Array.from({ length: 15 }, () => evaluated({ usedSize: 1 })));

    await collectHeapAfterRepeatedGc(cdp);
    await collectHeapAfterRepeatedGc(cdp);
    await collectHeapAfterRepeatedGc(cdp);

    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "HeapProfiler.enable", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage",
      "HeapProfiler.enable", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage",
      "HeapProfiler.enable", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "HeapProfiler.collectGarbage", "Runtime.getHeapUsage"
    ]);
  });

  it.each([
    ["enable", [new Promise<FakeCdpResponse>(() => undefined)]],
    ["collection", [evaluated({}), new Promise<FakeCdpResponse>(() => undefined)]],
    ["usage", [evaluated({}), evaluated({}), evaluated({}), evaluated({}), new Promise<FakeCdpResponse>(() => undefined)]]
  ] as const)("bounds a hung heap-GC %s request", async (phase, responses) => {
    const result = await watchdog(collectHeapAfterRepeatedGc(new FakeCdp(responses), 3, {
      deadlineMs: 10,
      requestCeilingMs: 5
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    ));

    expect(result).not.toBe("WATCHDOG");
    expect(result).toHaveProperty("error");
    expect((result as { error: { name: string; phase: string } }).error).toMatchObject({
      name: "CdpRequestTimeout",
      phase: phase === "collection" ? "heap-gc-collection-1" : `heap-gc-${phase}`
    });
  });

  it("keeps lifecycle cleanup bounded when its repeated-GC request hangs", async () => {
    const events: string[] = [];
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([neverSettles]);
    const result = await watchdog(releaseHeapSessionWithCleanup({
      release: async () => { events.push("close"); return { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } }; },
      removeRoot: async () => { events.push("remove"); return true; },
      yieldFrame: async () => { events.push("yield"); return true; },
      forceGc: () => collectHeapAfterRepeatedGc(cdp, 3, { deadlineMs: 10, requestCeilingMs: 5 })
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    ));

    expect(result).not.toBe("WATCHDOG");
    expect(result).toHaveProperty("error");
    expect((result as { error: { name: string; phase: string; gcPasses: null; rootRemoved: boolean; frameYielded: boolean } }).error).toMatchObject({
      name: "CdpRequestTimeout",
      phase: "heap-gc-enable",
      gcPasses: null,
      rootRemoved: true,
      frameYielded: true
    });
    expect(events).toEqual(["close", "remove", "yield"]);
  });

  it("attempts root removal, frame yield, and three-GC cleanup after a close failure", async () => {
    const events: string[] = [];
    await expect(releaseHeapSessionWithCleanup({
      release: async () => { events.push("close"); return { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } }; },
      removeRoot: async () => { events.push("remove"); return false; },
      yieldFrame: async () => { events.push("yield"); return false; },
      forceGc: async () => { events.push("gc"); return { usedSize: 1, gcPasses: 3 }; }
    })).rejects.toMatchObject({ code: "CLOSE_FAILED", rootRemoved: false, frameYielded: false, gcPasses: 3 });
    expect(events).toEqual(["close", "remove", "yield", "gc"]);
  });

  it("runs one warm-up and three ordered independent samples without dropping slots", async () => {
    const events: string[] = [];
    let identity = 0;
    const result = await runHeapMeasurementPlan({
      adapters: ["indexeddb"],
      eventCounts: { indexeddb: 10_000 },
      prepare: async ({ adapter, eventCount, phase, sample }) => {
        const sessionId = `${adapter}-${phase}-${sample ?? "warmup"}-${identity += 1}`;
        events.push(`prepare:${phase}:${sample ?? "warmup"}:${eventCount}`);
        return { adapter, eventCount, phase, sample, retained: eventCount, sessionId, databaseName: `db-${identity}` };
      },
      forceGc: async ({ phase, sample }) => {
        events.push(`gc:${phase}:${sample ?? "warmup"}`);
        return { usedSize: sample ?? 0, gcPasses: 3 };
      },
      record: ({ adapter, eventCount, sample, session, baseline, retained }) => {
        events.push(`record:${sample}`);
        return {
          adapter,
          sample,
          eventCount,
          sessionId: session.sessionId,
          databaseName: session.databaseName,
          baselineUsedSizeBytes: baseline.usedSize,
          retainedUsedSizeBytes: retained.usedSize,
          postGcHeapDeltaBytes: retained.usedSize - baseline.usedSize
        };
      },
      close: async (session) => {
        events.push(`close:${session.phase}:${session.sample ?? "warmup"}`);
        return { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } };
      },
      removeRoot: async (session) => { events.push(`remove:${session.phase}:${session.sample ?? "warmup"}`); return true; },
      yieldFrame: async ({ phase, sample }) => { events.push(`yield:${phase}:${sample ?? "warmup"}`); return true; }
    });

    expect(result.heapSamples).toHaveLength(3);
    expect(result.heapSamples.map(({ sample }) => sample)).toEqual([1, 2, 3]);
    expect(new Set(result.heapSamples.map(({ sessionId }) => sessionId)).size).toBe(3);
    expect(events).toEqual([
      "prepare:warmup:warmup:10000",
      "close:warmup:warmup",
      "remove:warmup:warmup",
      "yield:warmup:warmup",
      "gc:warmup-cleanup:warmup",
      "gc:baseline:1",
      "prepare:sample:1:10000",
      "gc:retained:1",
      "record:1",
      "close:sample:1",
      "remove:sample:1",
      "yield:cleanup:1",
      "gc:cleanup:1",
      "gc:baseline:2",
      "prepare:sample:2:10000",
      "gc:retained:2",
      "record:2",
      "close:sample:2",
      "remove:sample:2",
      "yield:cleanup:2",
      "gc:cleanup:2",
      "gc:baseline:3",
      "prepare:sample:3:10000",
      "gc:retained:3",
      "record:3",
      "close:sample:3",
      "remove:sample:3",
      "yield:cleanup:3",
      "gc:cleanup:3"
    ]);
  });

  it("keeps a measured cleanup failure in its original slot without retrying", async () => {
    const prepared: string[] = [];
    const closed: number[] = [];
    const result = await runHeapMeasurementPlan({
      adapters: ["memory"],
      eventCounts: { memory: 5_000 },
      prepare: async ({ phase, sample }) => {
        const current = sample ?? 0;
        prepared.push(phase === "warmup" ? "warmup" : `${current}`);
        return { adapter: "memory", eventCount: 5_000, phase, sample, retained: 5_000, sessionId: `memory-${phase}-${current}`, databaseName: null };
      },
      forceGc: async () => ({ usedSize: 1, gcPasses: 3 }),
      record: ({ adapter, eventCount, sample, session, baseline, retained }) => ({
        adapter,
        sample,
        eventCount,
        sessionId: session.sessionId,
        databaseName: session.databaseName,
        baselineUsedSizeBytes: baseline.usedSize,
        retainedUsedSizeBytes: retained.usedSize,
        postGcHeapDeltaBytes: retained.usedSize - baseline.usedSize
      }),
      close: async (session) => {
        closed.push(session.sample ?? 0);
        return session.sample === 2
          ? { ok: false, problem: { code: "CLOSE_FAILED", message: "cleanup failed" } }
          : { ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } };
      },
      removeRoot: async () => true,
      yieldFrame: async () => true
    });

    expect(prepared).toEqual(["warmup", "1", "2", "3"]);
    expect(closed).toEqual([0, 1, 2, 3]);
    expect(result.heapSamples.map(({ sample }) => sample)).toEqual([1, 2, 3]);
    expect(result.heapSamples[1]).toMatchObject({ sample: 2, status: "FAIL" });
    expect(result.heapSamples[1]?.failure).toMatchObject({ code: "CLOSE_FAILED", message: expect.stringContaining("authoritative close") });
  });

  it("retains IndexedDB prepare-failure identity and cleanup evidence in its slot", async () => {
    const result = await runHeapMeasurementPlan({
      adapters: ["indexeddb"],
      eventCounts: { indexeddb: 10_000 },
      prepare: async ({ phase, sample, eventCount }) => {
        if (phase === "sample" && sample === 2) {
          const error = Object.assign(new Error("offer failed"), { code: "PREPARE_FAILED", cleanupEvidence: {
            adapter: "indexeddb",
            phase: "cleanup",
            sample: 2,
            eventCount,
            retained: null,
            sessionId: "idb-sample-2",
            databaseName: "idb-db-2",
            close: { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } },
            rootRemoved: true,
            frameYielded: true,
            gcPasses: null,
            status: "FAIL",
            failure: { code: "PREPARE_FAILED", message: "offer failed" }
          } });
          throw error;
        }
        return { adapter: "indexeddb", eventCount, phase, sample, retained: eventCount, sessionId: `idb-sample-${sample ?? "warmup"}`, databaseName: `idb-db-${sample ?? "warmup"}` };
      },
      forceGc: async () => ({ usedSize: 10, gcPasses: 3 }),
      record: ({ adapter, eventCount, sample, session, baseline, retained }) => ({ adapter, sample, eventCount, sessionId: session.sessionId, databaseName: session.databaseName, baselineUsedSizeBytes: baseline.usedSize, retainedUsedSizeBytes: retained.usedSize, postGcHeapDeltaBytes: 0 }),
      close: async () => ({ ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } }),
      removeRoot: async () => true,
      yieldFrame: async () => true
    });

    expect(result.heapSamples[1]).toMatchObject({ sample: 2, sessionId: "idb-sample-2", databaseName: "idb-db-2", status: "FAIL" });
    expect(result.heapRuns).toContainEqual(expect.objectContaining({ phase: "cleanup", sample: 2, sessionId: "idb-sample-2", status: "FAIL" }));
  });

  it("runs cleanup GC after warm-up and measured prepare rejection without retrying", async () => {
    const warmupGc: string[] = [];
    const warmupError = Object.assign(new Error("warmup rejected"), { code: "PREPARE_FAILED",
      cleanupEvidence: { adapter: "memory", phase: "warmup", sample: null, eventCount: 5_000, retained: null, sessionId: "warmup", databaseName: null, close: null, rootRemoved: true, frameYielded: true, gcPasses: null, status: "FAIL", failure: { code: "PREPARE_FAILED", message: "warmup rejected" } }
    });
    await expect(runHeapMeasurementPlan({
      adapters: ["memory"],
      eventCounts: { memory: 5_000 },
      prepare: async () => { throw warmupError; },
      forceGc: async ({ phase }) => { warmupGc.push(phase); return { usedSize: 1, gcPasses: 3 }; },
      record: ({ adapter, eventCount, sample }) => ({ adapter, sample: sample ?? 1, eventCount, sessionId: null, databaseName: null, baselineUsedSizeBytes: null, retainedUsedSizeBytes: null, postGcHeapDeltaBytes: null }),
      close: async () => ({ ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } }),
      removeRoot: async () => true,
      yieldFrame: async () => true
    })).rejects.toThrow(/warmup rejected/u);
    expect(warmupGc).toEqual(["warmup-cleanup"]);

    const measuredGc: string[] = [];
    const result = await runHeapMeasurementPlan({
      adapters: ["memory"],
      eventCounts: { memory: 5_000 },
      prepare: async ({ phase, sample, eventCount }) => {
        if (phase === "sample" && sample === 2) {
          throw Object.assign(new Error("sample rejected"), { code: "PREPARE_FAILED",
            cleanupEvidence: { adapter: "memory", phase: "cleanup", sample: 2, eventCount, retained: null, sessionId: "failed-2", databaseName: null, close: null, rootRemoved: true, frameYielded: true, gcPasses: null, status: "FAIL", failure: { code: "PREPARE_FAILED", message: "sample rejected" } }
          });
        }
        return { adapter: "memory", eventCount, phase, sample, retained: eventCount, sessionId: `${phase}-${sample ?? "warmup"}`, databaseName: null };
      },
      forceGc: async ({ phase, sample }) => { measuredGc.push(`${phase}:${sample ?? "warmup"}`); return { usedSize: 1, gcPasses: 3 }; },
      record: ({ adapter, eventCount, sample, session, baseline, retained }) => ({ adapter, sample, eventCount, sessionId: session.sessionId, databaseName: null, baselineUsedSizeBytes: baseline.usedSize, retainedUsedSizeBytes: retained.usedSize, postGcHeapDeltaBytes: 0 }),
      close: async () => ({ ok: true, value: { dataDisposition: "ERASED", cleanupDisposition: "COMPLETE" } }),
      removeRoot: async () => true,
      yieldFrame: async () => true
    });
    expect(measuredGc).toContain("cleanup:2");
    expect(result.heapRuns.find((run) => run.sample === 2)).toMatchObject({ gcPasses: 3 });
    expect(result.heapSamples.find((sample) => sample.sample === 2)?.failure).toMatchObject({ code: "PREPARE_FAILED" });
  });

  it("fails closed when warm-up cleanup is not ERASED and COMPLETE", async () => {
    await expect(runHeapMeasurementPlan({
      adapters: ["indexeddb"],
      eventCounts: { indexeddb: 10_000 },
      prepare: async () => ({ adapter: "indexeddb", eventCount: 10_000, phase: "warmup" as const, sample: null, sessionId: "warmup", retained: 10_000, databaseName: "db-warmup" }),
      forceGc: async () => ({ usedSize: 1, gcPasses: 3 }),
      record: () => { throw new Error("record must not run"); },
      close: async () => ({ ok: true, value: { dataDisposition: "ERASURE_UNCONFIRMED", cleanupDisposition: "DEFERRED" } }),
      removeRoot: async () => true,
      yieldFrame: async () => true
    })).rejects.toThrow(/warm-up.*ERASED.*COMPLETE/u);
  });
});

describe("Event History performance runner page operation", () => {
  it("observes a long-pending operation with visible state heartbeats and times out", async () => {
    let now = 0;
    const heartbeats: Array<{ state: string; elapsedMs: number }> = [];
    const cdp = new FakeCdp([
      evaluated({ operationId: "pending-operation", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "pending-operation", state: "pending", heartbeat: 1 }),
      evaluated({ operationId: "pending-operation", state: "pending", heartbeat: 2 }),
      evaluated(true)
    ]);

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "pending-operation",
      deadlineMs: 20,
      pollIntervalMs: 10,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      onHeartbeat: (status) => heartbeats.push({ state: status.state, elapsedMs: status.elapsedMs })
    })).rejects.toBeInstanceOf(PerformanceOperationTimeout);

    expect(heartbeats).toEqual([
      { state: "pending", elapsedMs: 0 },
      { state: "pending", elapsedMs: 0 },
      { state: "pending", elapsedMs: 10 },
      { state: "pending", elapsedMs: 20 }
    ]);
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
    expect(cdp.calls.every(({ params }) => params.awaitPromise === false)).toBe(true);
  });

  it("returns the exact resolved page report and cleans the operation record", async () => {
    const report = { anchors: { issue16TotalEvents: 1_692 }, cells: [] };
    const cdp = new FakeCdp([
      evaluated({ operationId: "resolved-operation", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "resolved-operation", state: "resolved", heartbeat: 1, result: report }),
      evaluated(true)
    ]);

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "resolved-operation",
      deadlineMs: 100,
      pollIntervalMs: 10
    })).resolves.toBe(report);
    expect(cdp.calls).toHaveLength(3);
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
  });

  it("propagates structured harness progress through operation status", async () => {
    const progress = {
      phase: "cells",
      stage: "receipt-settlement",
      substage: "receipt-settlement",
      sequence: 17,
      pageElapsedMs: 4_321,
      sample: 2,
      trigger: null,
      scenario: null,
      cellIndex: 7,
      cellTotal: 36,
      adapter: "indexeddb",
      workload: "burst",
      shape: "large-json-rich",
      workloadPhase: "commit",
      offered: 1_692,
      settled: 41,
      query: null
    };
    const statuses: Array<Record<string, unknown>> = [];
    const cdp = new FakeCdp([
      evaluated({ operationId: "progress-operation", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "progress-operation", state: "resolved", heartbeat: 1, progress, result: { complete: true } }),
      evaluated(true)
    ]);

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "progress-operation",
      onHeartbeat: (status) => statuses.push(status as Record<string, unknown>)
    })).resolves.toEqual({ complete: true });

    expect(statuses.at(-1)).toMatchObject({
      phase: "cells",
      cellIndex: 7,
      progress
    });
  });

  it("fails closed on host-observed progress age even when polls keep succeeding", async () => {
    let now = 0;
    const progress = {
      phase: "cells",
      stage: "cell-7-receipts",
      substage: "receipt-settlement",
      sequence: 4,
      pageElapsedMs: 1,
      sample: 1,
      trigger: null,
      scenario: null,
      cellIndex: 7,
      cellTotal: 36,
      adapter: "indexeddb",
      workload: "burst",
      shape: "large-json-rich",
      workloadPhase: "commit",
      offered: 1_692,
      settled: 1,
      query: null
    };
    const cdp = new FakeCdp([
      evaluated({ operationId: "stale-progress", state: "pending", heartbeat: 0, progress }),
      evaluated({ operationId: "stale-progress", state: "pending", heartbeat: 1, progress }),
      evaluated({ operationId: "stale-progress", state: "pending", heartbeat: 2, progress }),
      evaluated(true)
    ]);

    const result = await runPageOperation(cdp, "window.run()", {
      operationId: "stale-progress",
      deadlineMs: 200_000,
      pollIntervalMs: 1,
      now: () => now,
      sleep: async () => { now += 120_001; }
    }).then(() => null, (error) => error);

    expect(result).toBeInstanceOf(PerformanceOperationTimeout);
    expect(result.status).toMatchObject({
      progressSequence: 4,
      progressAgeMs: 120_001,
      progressAgeCeilingMs: 120_000,
      lastProgressObservedAt: 0,
      progress: { stage: "cell-7-receipts" }
    });
  });

  it("enforces progress age after a bounded poll retry", async () => {
    let now = 0;
    let calls = 0;
    const progress = {
      phase: "heap",
      stage: "cleanup-close",
      substage: "cleanup-close",
      sequence: 9,
      pageElapsedMs: 2,
      sample: 2,
      trigger: null,
      scenario: null,
      cellIndex: null,
      cellTotal: 36,
      adapter: "indexeddb",
      workload: null,
      shape: null,
      workloadPhase: null,
      offered: 10_000,
      settled: 10_000,
      query: null
    };
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined) as CancelableFakeCdpRequest;
    neverSettles.cancel = () => { now = 30_001; };
    const cdp = {
      request: (_method: string, params: Record<string, unknown> = {}) => {
        calls += 1;
        if (String(params.expression ?? "").includes("delete globalThis")) return Promise.resolve(evaluated(true));
        if (calls === 1) return Promise.resolve(evaluated({ operationId: "retry-stale-progress", state: "pending", heartbeat: 0, progress }));
        if (calls === 2) return neverSettles;
        return Promise.resolve(evaluated({ operationId: "retry-stale-progress", state: "pending", heartbeat: calls - 1, progress }));
      }
    };

    const result = await runPageOperation(cdp, "window.run()", {
      operationId: "retry-stale-progress",
      deadlineMs: 100_000,
      pollIntervalMs: 1,
      now: () => now,
      requestCeilingMs: 10
    }).then(() => null, (error) => error);

    expect(result).toBeInstanceOf(PerformanceOperationTimeout);
    expect(result.status).toMatchObject({
      progressAgeMs: 30_001,
      progressAgeCeilingMs: 30_000,
      lastProgressObservedAt: 0,
      lastRequestTimeout: { phase: "poll", ceilingMs: 10 }
    });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it.each([
    ["terminal", "terminal-read"],
    ["checkpoint", "checkpoint-close"]
  ])("uses the narrower 30s ceiling for %s %s progress", async (phase, stage) => {
    let now = 0;
    let calls = 0;
    const progress = {
      phase,
      stage,
      substage: stage,
      sequence: 11,
      pageElapsedMs: 3,
      sample: null,
      trigger: phase === "terminal" ? "PENDING_AGE" : null,
      scenario: phase === "checkpoint" ? "representative" : null,
      cellIndex: null,
      cellTotal: 36,
      adapter: "indexeddb",
      workload: null,
      shape: null,
      workloadPhase: null,
      offered: null,
      settled: null,
      query: null
    };
    const cdp = {
      request: (_method: string, params: Record<string, unknown> = {}) => {
        if (String(params.expression ?? "").includes("delete globalThis")) return Promise.resolve(evaluated(true));
        calls += 1;
        return Promise.resolve(evaluated({ operationId: `narrow-${phase}`, state: "pending", heartbeat: calls, progress }));
      }
    };

    const result = await runPageOperation(cdp, "window.run()", {
      operationId: `narrow-${phase}`,
      deadlineMs: 100_000,
      pollIntervalMs: 1,
      now: () => now,
      sleep: async () => { now += 30_001; }
    }).then(() => null, (error) => error);

    expect(result).toBeInstanceOf(PerformanceOperationTimeout);
    expect(result.status).toMatchObject({
      progressAgeMs: 30_001,
      progressAgeCeilingMs: 30_000,
      progress: { phase, stage }
    });
  });

  it("preserves the original rejected error fields and cleans the operation record", async () => {
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "rejected-operation", state: "pending", heartbeat: 0 }),
      neverSettles,
      evaluated({
        operationId: "rejected-operation",
        state: "rejected",
        heartbeat: 1,
        error: {
          name: "TypeError",
          message: "original failure",
          stack: "TypeError: original failure\\n at page.js:4",
          code: "PREPARE_FAILED",
          progress: {
      phase: "heap",
      stage: "sample-receipt-settlement",
      substage: "sample-receipt-settlement",
      sequence: 18,
      pageElapsedMs: 12_345,
      sample: 2,
      trigger: null,
      scenario: null,
            cellIndex: null,
            cellTotal: 36,
            adapter: "indexeddb",
            workload: null,
            shape: null,
            workloadPhase: null,
            offered: 10_000,
            settled: 9_999,
            query: null
          },
          cleanupEvidence: {
            adapter: "indexeddb",
            phase: "cleanup",
            sample: 2,
            eventCount: 10_000,
            retained: null,
            sessionId: "idb-session-2",
            databaseName: "idb-database-2",
            close: { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } },
            disposeError: "dispose failed",
            rootRemoved: true,
            frameYielded: true,
            gcPasses: null,
            status: "FAIL",
            failure: { code: "PREPARE_FAILED", message: "original failure" }
          }
        }
      }),
      evaluated(true)
    ]);

    const rejected = await runPageOperation(cdp, "window.run()", {
      operationId: "rejected-operation",
      deadlineMs: 100,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    }).then(() => null, (error) => error);
    expect(rejected).toMatchObject({
      name: "TypeError",
      message: "original failure",
      code: "PREPARE_FAILED",
      stack: "TypeError: original failure\\n at page.js:4",
      progress: {
        phase: "heap",
        stage: "sample-receipt-settlement",
        sequence: 18,
        pageElapsedMs: 12_345,
        sample: 2,
        adapter: "indexeddb",
        offered: 10_000,
        settled: 9_999
      },
      cleanupEvidence: {
        adapter: "indexeddb",
        phase: "cleanup",
        sample: 2,
        eventCount: 10_000,
        retained: null,
        sessionId: "idb-session-2",
        databaseName: "idb-database-2",
        close: { ok: false, problem: { code: "CLOSE_FAILED", message: "close failed" } },
        disposeError: "dispose failed",
        rootRemoved: true,
        frameYielded: true,
        gcPasses: null,
        status: "FAIL",
        failure: { code: "PREPARE_FAILED", message: "original failure" }
      }
    });
    const startExpression = cdp.calls[0]?.params.expression as string;
    expect(startExpression).toContain("rawCleanupEvidence");
    expect(startExpression).not.toContain("serializeCleanupEvidence(error");
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
  });

  it("creates a fail-closed timeout artifact without classification or reference adoption", () => {
    const artifact = createTimeoutDiagnostic({
      generatedAt: "2026-08-11T00:00:00.000Z",
      source: { revision: "5a7c168", dirty: false },
      runner: {
        kind: "real-chrome",
        headless: false,
        fakeIndexedDbUsed: false,
        product: "Chrome/151.0.7922.77",
        userAgent: "CFT user agent",
        jsVersion: "15.1.206.10"
      },
      environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64", headless: false },
      referencePath: "docs/reference/event-history-performance-reference.json",
      deadlineMs: 60_000,
      operation: {
        operationId: "timed-out-operation",
        state: "pending",
        elapsedMs: 60_001,
        heartbeat: 12,
        lastHeartbeatAt: 59_998,
        progress: {
          phase: "cells",
          stage: "cell-36-read",
          substage: "cell-36-read",
          sequence: 99,
          pageElapsedMs: 60_001,
          sample: 3,
          trigger: null,
          scenario: null,
          cellIndex: 36,
          cellTotal: 36,
          adapter: "memory",
          workload: "burst",
          shape: "ordinary-item-update",
          workloadPhase: "query",
          offered: 1_692,
          settled: 1_692,
          query: "full"
        }
      }
    });

    expect(JSON.parse(JSON.stringify(artifact))).toMatchObject({
      status: "TIMED_OUT",
      source: { revision: "5a7c168", dirty: false },
      runner: { product: "Chrome/151.0.7922.77", headless: false },
      environment: { chromeMajor: 151, headless: false },
      operation: {
        deadlineMs: 60_000,
        lastStatus: {
          state: "pending",
          elapsedMs: 60_001,
          heartbeat: 12,
          progress: { phase: "cells", stage: "cell-36-read", cellIndex: 36, query: "full" }
        },
        progress: { phase: "cells", stage: "cell-36-read", cellIndex: 36, query: "full" }
      },
      classification: "NOT_CLASSIFIED",
      reference: { separatelyPinned: true, adopted: false },
      decision: { verdict: "FAIL", checkedCells: 0, checkedSamples: 0 }
    });
  });

  it("guards against stale completion after cleanup before the next operation", async () => {
    let now = 0;
    const first = new FakeCdp([
      evaluated({ operationId: "first-operation", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "first-operation", state: "pending", heartbeat: 1 }),
      evaluated({ operationId: "first-operation", state: "pending", heartbeat: 2 }),
      evaluated(true)
    ]);
    await expect(runPageOperation(first, "window.run()", {
      operationId: "first-operation",
      deadlineMs: 1,
      now: () => now,
      sleep: async () => { now = 1; }
    })).rejects.toBeInstanceOf(PerformanceOperationTimeout);

    expect(first.calls[0]?.params.expression).toContain("if (globalThis[key] !== operation) return");
    expect(first.calls.at(-1)?.params.expression).toContain("operationId");

    const second = new FakeCdp([
      evaluated({ operationId: "second-operation", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "second-operation", state: "resolved", heartbeat: 1, result: { run: 2 } }),
      evaluated(true)
    ]);
    await expect(runPageOperation(second, "window.run()", { operationId: "second-operation" })).resolves.toEqual({ run: 2 });
  });

  it("keeps retrying bounded poll requests until the true global deadline", async () => {
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "hung-poll", state: "pending", heartbeat: 0 }),
      ...Array.from({ length: 20 }, () => neverSettles),
      evaluated(true)
    ]);
    const startedAt = Date.now();
    const result = await watchdog(runPageOperation(cdp, "window.run()", {
      operationId: "hung-poll",
      deadlineMs: 35,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    ));

    expect(Date.now() - startedAt).toBeLessThan(100);
    const timeout = expectTimeoutOutcome(result);
    expect(timeout.status).toMatchObject({ operationId: "hung-poll", state: "pending" });
    expect(timeout.status.elapsedMs).toBeGreaterThanOrEqual(35);
    expect(timeout.status.lastRequestTimeout).toMatchObject({ phase: "poll", ceilingMs: 10 });
    expect(cdp.calls.length).toBeGreaterThan(3);
    expect(cdp.cancelledRequests).toBeGreaterThan(1);
    expect(createTimeoutDiagnostic({
      generatedAt: "2026-08-11T00:00:00.000Z",
      source: { revision: "5a7c168", dirty: false },
      runner: { product: "Chrome/151.0.7922.77", headless: false },
      environment: { chromeMajor: 151, headless: false },
      referencePath: "reference.json",
      deadlineMs: 100,
      operation: timeout.status
    })).toMatchObject({ status: "TIMED_OUT", classification: "NOT_CLASSIFIED", reference: { adopted: false } });
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
  });

  it("recovers when one bounded poll request hangs but a later poll observes completion", async () => {
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "recoverable-poll", state: "pending", heartbeat: 0 }),
      neverSettles,
      evaluated({ operationId: "recoverable-poll", state: "resolved", heartbeat: 2, result: { recovered: true } }),
      evaluated(true)
    ]);

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "recoverable-poll",
      deadlineMs: 100,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    })).resolves.toEqual({ recovered: true });

    expect(cdp.calls.map(({ method }) => method)).toEqual([
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate",
      "Runtime.evaluate"
    ]);
    expect(cdp.cancelledRequests).toBe(1);
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
  });

  it("deduplicates a late original poll execution against its retry token", async () => {
    const cdp = new LatePollCdp();

    const result = await runPageOperation(cdp, "window.run()", {
      operationId: "late-poll-operation",
      deadlineMs: 100,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    });
    cdp.resolveLateOriginal();
    await new Promise((resolve) => setImmediate(resolve));

    expect(result).toMatchObject({ source: "retry" });
    expect(cdp.terminalLateSnapshot).toMatchObject({
      operationId: "late-poll-operation",
      state: "resolved",
      heartbeat: 1,
      result: { source: "retry" }
    });
    expect(cdp.lateSnapshot).toMatchObject({
      operationId: "late-poll-operation",
      state: "missing",
      heartbeat: 0
    });
    expect(cdp.calls[1]?.params.expression).toContain("logicalPollToken = 0");
    expect(cdp.calls[2]?.params.expression).toContain("logicalPollToken = 0");
  });

  it("does not increment when the original token executes before its retry", async () => {
    const cdp = new OrderedPollCdp("before-retry");

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "ordered-poll-operation",
      deadlineMs: 100,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    })).resolves.toMatchObject({ source: "before-retry" });

    expect(cdp.originalSnapshot).toMatchObject({ heartbeat: 1, lastPollToken: 0 });
    expect(cdp.snapshots[0]).toMatchObject({ heartbeat: 1, lastPollToken: 0 });
    expect(cdp.calls[1]?.params.expression).toContain("logicalPollToken = 0");
    expect(cdp.calls[2]?.params.expression).toContain("logicalPollToken = 0");
  });

  it("rejects a stale token after a newer token has been observed", async () => {
    const cdp = new OrderedPollCdp("after-token");

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "ordered-poll-operation",
      deadlineMs: 100,
      pollIntervalMs: 1,
      requestCeilingMs: 10
    })).resolves.toMatchObject({ source: "after-token" });

    expect(cdp.originalSnapshot).toMatchObject({ heartbeat: 2, lastPollToken: 1, state: "pending" });
    expect(cdp.snapshots[1]).toMatchObject({ heartbeat: 2, lastPollToken: 1 });
    expect(cdp.snapshots[2]).toMatchObject({ heartbeat: 2, lastPollToken: 1, state: "resolved" });
    expect(cdp.calls[1]?.params.expression).toContain("logicalPollToken = 0");
    expect(cdp.calls[2]?.params.expression).toContain("logicalPollToken = 0");
    expect(cdp.calls[3]?.params.expression).toContain("logicalPollToken = 1");
  });

  it("bounds cleanup that never settles after a deadline timeout", async () => {
    let now = 0;
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "hung-cleanup", state: "pending", heartbeat: 0 }),
      evaluated({ operationId: "hung-cleanup", state: "pending", heartbeat: 1 }),
      evaluated({ operationId: "hung-cleanup", state: "pending", heartbeat: 2 }),
      neverSettles
    ]);
    const result = await watchdog(runPageOperation(cdp, "window.run()", {
      operationId: "hung-cleanup",
      deadlineMs: 1,
      pollIntervalMs: 1,
      requestCeilingMs: 10,
      now: () => now,
      sleep: async () => { now = 1; }
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    ));

    expectTimeoutOutcome(result);
    expect(cdp.calls.at(-1)?.params.expression).toContain("delete globalThis");
  });

  it("ignores a late poll rejection after timeout without an unhandled rejection or stale result", async () => {
    let rejectLatePoll!: (error: Error) => void;
    const latePoll = new Promise<FakeCdpResponse>((_, reject) => { rejectLatePoll = reject; });
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "late-poll", state: "pending", heartbeat: 0 }),
      latePoll,
      ...Array.from({ length: 10 }, () => neverSettles),
      evaluated(true)
    ]);
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await watchdog(runPageOperation(cdp, "window.run()", {
        operationId: "late-poll",
        deadlineMs: 30,
        pollIntervalMs: 1,
        requestCeilingMs: 10
      }).then(
        (value) => ({ value }),
        (error) => ({ error })
      ));
      expectTimeoutOutcome(result);
      rejectLatePoll(new Error("late poll failure"));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(cdp.calls.length).toBeGreaterThan(3);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
