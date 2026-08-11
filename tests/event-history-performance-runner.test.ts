import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTimeoutDiagnostic,
  PerformanceOperationTimeout,
  runPageOperation
} from "../scripts/event-history-performance-runner-operations.mjs";

type FakeCdpResponse = Readonly<{
  result: Readonly<{ value: unknown }>;
}>;

type FakeCdpReply = FakeCdpResponse | Promise<FakeCdpResponse>;

class FakeCdp {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  constructor(private readonly responses: FakeCdpReply[]) {}

  request(method: string, params: Record<string, unknown> = {}): Promise<FakeCdpResponse> {
    this.calls.push({ method, params });
    const response = this.responses.shift();
    if (!response) return Promise.reject(new Error(`Unexpected CDP request ${method}.`));
    return Promise.resolve(response);
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
      { state: "pending", elapsedMs: 10 }
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

  it("preserves the original rejected error fields and cleans the operation record", async () => {
    const cdp = new FakeCdp([
      evaluated({ operationId: "rejected-operation", state: "pending", heartbeat: 0 }),
      evaluated({
        operationId: "rejected-operation",
        state: "rejected",
        heartbeat: 1,
        error: { name: "TypeError", message: "original failure", stack: "TypeError: original failure\\n at page.js:4" }
      }),
      evaluated(true)
    ]);

    await expect(runPageOperation(cdp, "window.run()", {
      operationId: "rejected-operation",
      deadlineMs: 100
    })).rejects.toMatchObject({
      name: "TypeError",
      message: "original failure",
      stack: "TypeError: original failure\\n at page.js:4"
    });
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
        lastHeartbeatAt: 59_998
      }
    });

    expect(JSON.parse(JSON.stringify(artifact))).toMatchObject({
      status: "TIMED_OUT",
      source: { revision: "5a7c168", dirty: false },
      runner: { product: "Chrome/151.0.7922.77", headless: false },
      environment: { chromeMajor: 151, headless: false },
      operation: {
        deadlineMs: 60_000,
        lastStatus: { state: "pending", elapsedMs: 60_001, heartbeat: 12 }
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

  it("turns a never-settling poll into a prompt timeout and preserves the diagnostic status", async () => {
    const neverSettles = new Promise<FakeCdpResponse>(() => undefined);
    const cdp = new FakeCdp([
      evaluated({ operationId: "hung-poll", state: "pending", heartbeat: 0 }),
      neverSettles,
      evaluated(true)
    ]);
    const startedAt = Date.now();
    const result = await watchdog(runPageOperation(cdp, "window.run()", {
      operationId: "hung-poll",
      deadlineMs: 100,
      requestCeilingMs: 10
    }).then(
      (value) => ({ value }),
      (error) => ({ error })
    ));

    expect(Date.now() - startedAt).toBeLessThan(100);
    const timeout = expectTimeoutOutcome(result);
    expect(timeout.status).toMatchObject({ operationId: "hung-poll", state: "pending" });
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
    const cdp = new FakeCdp([
      evaluated({ operationId: "late-poll", state: "pending", heartbeat: 0 }),
      latePoll,
      evaluated(true)
    ]);
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await watchdog(runPageOperation(cdp, "window.run()", {
        operationId: "late-poll",
        deadlineMs: 100,
        requestCeilingMs: 10
      }).then(
        (value) => ({ value }),
        (error) => ({ error })
      ));
      expectTimeoutOutcome(result);
      rejectLatePoll(new Error("late poll failure"));
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(cdp.calls).toHaveLength(3);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
