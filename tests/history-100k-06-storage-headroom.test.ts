import { describe, expect, it, vi } from "vitest";

import {
  PROPOSED_NORMAL_HISTORY_HEADROOM,
  createStorageHeadroomSampler,
  sampleStorageEstimate,
  storageHeadroomDiagnostic,
  type StorageEstimateObservation
} from "../src/extension/panel/storage-headroom";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

const MIB = 1_048_576;

function available(usageBytes: number, quotaBytes: number): StorageEstimateObservation {
  return {
    source: "navigator.storage.estimate",
    status: "AVAILABLE",
    usageBytes,
    quotaBytes,
    headroomBytes: quotaBytes - usageBytes,
    failure: null
  };
}

describe("history-100k-06 storage headroom", () => {
  it("normalizes a browser estimate as advisory headroom, not a reservation", async () => {
    const observation = await sampleStorageEstimate({
      estimate: async () => ({ usage: 32 * MIB, quota: 200 * MIB })
    });

    expect(observation).toEqual({
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: 32 * MIB,
      quotaBytes: 200 * MIB,
      headroomBytes: 168 * MIB,
      failure: null
    });
    expect(storageHeadroomDiagnostic(observation)).toMatchObject({
      severity: "Warning",
      title: "Estimated storage headroom is low",
      affected: "Extension origin",
      detail: expect.stringContaining("advisory"),
      recovery: expect.stringContaining("Free browser storage")
    });
    expect(PROPOSED_NORMAL_HISTORY_HEADROOM).toEqual({
      recordCount: 100_000,
      canonicalBytes: 256 * MIB
    });
    expect(storageHeadroomDiagnostic(available(1, 512 * MIB))).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["rejected", { estimate: async () => { throw new Error("denied"); } }],
    ["invalid", { estimate: async () => ({ usage: Number.NaN, quota: 10 }) }],
    ["contradictory", { estimate: async () => ({ usage: 11, quota: 10 }) }]
  ])("treats %s estimates as harmless unavailable telemetry", async (_name, storage) => {
    const observation = await sampleStorageEstimate(storage as StorageManager | undefined);
    expect(observation.status).toBe("UNAVAILABLE");
    expect(observation.headroomBytes).toBeNull();
    expect(storageHeadroomDiagnostic(observation)).toBeNull();
  });

  it("marks a warning-boundary flip between coarse samples as unstable without a diagnostic", async () => {
    const sampler = createStorageHeadroomSampler(async (threshold) =>
      threshold === "BEFORE_CAPTURE" ? available(0, 512 * MIB) : available(0, 128 * MIB)
    );

    await sampler.sample("BEFORE_CAPTURE");
    const unstable = await sampler.sample("NEAR_LIMIT");

    expect(unstable.failure?.code).toBe("STORAGE_ESTIMATE_UNSTABLE");
    expect(storageHeadroomDiagnostic(unstable)).toBeNull();
  });

  it("samples once before Capture and once per coarse pressure threshold", async () => {
    const calls: string[] = [];
    const sampler = createStorageHeadroomSampler(async (threshold) => {
      calls.push(threshold);
      return available(0, 128 * MIB);
    });

    await sampler.sample("BEFORE_CAPTURE");
    await sampler.sample("BEFORE_CAPTURE");
    await sampler.sample("NEAR_LIMIT");
    await sampler.sample("NEAR_LIMIT");
    await sampler.sample("EXHAUSTED");
    await sampler.sample("EXHAUSTED");

    expect(calls).toEqual(["BEFORE_CAPTURE", "NEAR_LIMIT", "EXHAUSTED"]);
  });

  it("publishes only the advisory warning through the global diagnostic boundary", async () => {
    const history = createInMemoryEventHistory({
      panelSessionId: "history-100k-06-runtime",
      capacity: { maxRetainedCount: 2, retainedWarningCount: 1, maxRetainedBytes: 1_000_000 }
    });
    const sample = vi.fn(async () => available(0, 128 * MIB));
    const runtime = createWorkbenchRuntime({
      history,
      storageEstimate: available(0, 512 * MIB),
      storageHeadroomSampler: { sample }
    });

    expect(runtime.getSnapshot().diagnostics).not.toContainEqual(
      expect.objectContaining({ title: "Estimated storage headroom is low" })
    );
    const first = history.offer({
      id: "headroom-event-1",
      timestamp: 1,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      item: { name: "orders", position: 1 },
      update: { fields: { value: 1 } }
    });
    await first.settled;
    await Promise.resolve();
    await Promise.resolve();

    expect(sample).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().diagnostics).toContainEqual(
      expect.objectContaining({
        category: "storage",
        title: "Estimated storage headroom is low",
        detail: expect.stringContaining("QuotaExceededError")
      })
    );
    expect(runtime.getSnapshot().retention.historyStatus.accepted).toBe(1);
    expect(runtime.getSnapshot().capture.coverage).not.toBe("UNAVAILABLE");
    runtime.dispose();
  });
});
