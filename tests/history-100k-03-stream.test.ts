import { describe, expect, it, vi } from "vitest";

import {
  createIncrementalJsonArrayWriter,
  IncrementalSerializationError
} from "../src/core/incremental-json-writer";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime
} from "../src/extension/panel/workbench-runtime";
import {
  type DeterministicEvidenceRecord,
  type EvidenceIdentity,
} from "../src/core/evidence-filter-contract";
import { type EvidenceInvestigationQueryResult } from "../src/extension/panel/evidence-investigation-query";

function identity(sequence: number, eventId = `stream-${sequence}`): EvidenceIdentity {
  return {
    intervalId: "stream-session:interval-1",
    pageId: "stream-session:interval-1",
    ownerId: "memory-event-history",
    sequence,
    eventId
  };
}

function record(sequence: number): DeterministicEvidenceRecord {
  const event = {
    id: `stream-${sequence}`,
    timestamp: sequence,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    update: { fields: { sequence } }
  };
  return {
    identity: identity(sequence),
    timestamp: sequence,
    summary: "item-update",
    searchText: `stream-${sequence}`,
    facets: {},
    payload: event
  };
}

function readPoint(boundary: number): EvidenceIdentity {
  return identity(boundary);
}

function pageResult(
  records: readonly DeterministicEvidenceRecord[],
  boundary: number,
  nextCursor: string | null
): EvidenceInvestigationQueryResult {
  return {
    ok: true,
    value: {
      readPoint: {
        interval: { id: "stream-session:interval-1", ordinal: 1 },
        committedEvidenceBoundary: readPoint(boundary),
        retainedRange: {
          first: identity(1),
          last: readPoint(boundary)
        }
      },
      page: { evidence: records, nextCursor },
      totals: { matching: boundary, inScope: boundary },
      discoveries: new Map(),
      lookup: null,
      find: null,
      evaluation: "COMPLETE",
      coverage: "COMPLETE",
      storage: "MEMORY_FALLBACK"
    }
  };
}

let evidenceOperationModuleSettled = false;

async function flush(): Promise<void> {
  if (!evidenceOperationModuleSettled) {
    await import("../src/extension/panel/evidence-history-operation");
    evidenceOperationModuleSettled = true;
  }
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("history-100k-03 incremental Evidence operations", () => {
  it("serializes entries in exact order without retaining a payload array", () => {
    const writer = createIncrementalJsonArrayWriter({ maxBytes: 1024 });
    writer.append({ sequence: 1 });
    writer.append({ sequence: 2 });

    expect(writer.count).toBe(2);
    expect(writer.finish()).toBe('[{"sequence":1},{"sequence":2}]');
    expect(writer.retainedEntryCount).toBe(0);
  });

  it("refuses before exceeding the explicit output-byte guard", () => {
    const writer = createIncrementalJsonArrayWriter({ maxBytes: 23 });

    expect(() => writer.append({ sequence: 123456789 })).toThrowError(IncrementalSerializationError);
    expect(writer.bytes).toBeLessThanOrEqual(24);
  });

  it("latches one boundary, advances through bounded pages, and excludes later Capture", async () => {
    const calls: Array<{ at: unknown; cursor?: string }> = [];
    let copyActive = false;
    let releaseSecondPage: (() => void) | undefined;
    const query = vi.fn(async (request): Promise<EvidenceInvestigationQueryResult> => {
      if (!copyActive) return pageResult([], 0, null);
      calls.push({ at: request.at, cursor: request.page.cursor });
      if (request.page.cursor === undefined) {
        return pageResult([record(1)], 2, "cursor-1");
      }
      await new Promise<void>((resolve) => { releaseSecondPage = resolve; });
      return pageResult([record(2)], 2, null);
    });
    const runtime = createWorkbenchRuntime({ evidenceQuery: { query }, outputByteLimit: 1024 * 1024 });
    await flush();
    calls.splice(0);
    copyActive = true;

    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flush();
    expect(runtime.getSnapshot().evidenceCopy).toMatchObject({
      state: "preparing",
      progress: {
        completed: 1,
        total: 2,
        committedEvidenceBoundary: readPoint(2)
      }
    });

    runtime.dispatch({ type: "cancel-evidence-operation" });
    if (releaseSecondPage) releaseSecondPage();
    await flush();

    expect(runtime.getSnapshot().evidenceCopy).toMatchObject({
      state: "cancelled",
      text: null,
      outcome: "CANCELLED"
    });
    expect(calls[0]).toMatchObject({ at: "LATEST_COMMITTED" });
    expect(calls[1]).toMatchObject({ at: expect.objectContaining({
      interval: { id: "stream-session:interval-1", ordinal: 1 },
      committedEvidenceBoundary: readPoint(2)
    }), cursor: "cursor-1" });
    runtime.dispose();
  });

  it("publishes output refusal and serialization failure without a complete artifact", async () => {
    const query = async (): Promise<EvidenceInvestigationQueryResult> => pageResult([record(1)], 1, null);
    const refusal = createWorkbenchRuntime({ evidenceQuery: { query }, outputByteLimit: 8 });
    refusal.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flush();
    expect(refusal.getSnapshot().evidenceCopy).toMatchObject({
      state: "refused",
      text: null,
      outcome: "OUTPUT_REFUSED",
      recovery: expect.stringContaining("smaller")
    });
    refusal.dispose();

    const bad = {
      ...record(1),
      payload: {
        id: "stream-1",
        timestamp: 1,
        direction: "inbound",
        source: "server",
        synthetic: false,
        kind: "item-update",
        update: { fields: { bad: BigInt(1) } }
      }
    };
    const serialization = createWorkbenchRuntime({
      evidenceQuery: { query: async () => pageResult([bad], 1, null) },
      outputByteLimit: 1024 * 1024
    });
    serialization.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flush();
    expect(serialization.getSnapshot().evidenceCopy).toMatchObject({
      state: "error",
      text: null,
      outcome: "SERIALIZATION_FAILED"
    });
    serialization.dispose();
  });

  it("reports unavailable retained data with a direct recovery", async () => {
    const runtime = createWorkbenchRuntime({
      evidenceQuery: {
        query: async () => ({
          ok: false,
          problem: {
            code: "HISTORY_INTERVAL_UNAVAILABLE",
            message: "The History Interval is unavailable."
          }
        })
      }
    });
    runtime.dispatch({ type: "prepare-scoped-evidence-copy" });
    await flush();

    expect(runtime.getSnapshot().evidenceCopy).toMatchObject({
      state: "error",
      outcome: "HISTORY_UNAVAILABLE",
      recovery: expect.stringContaining("Clear")
    });
    runtime.dispose();
  });

  it("keeps Complete History export on the same incremental latch", async () => {
    const calls: unknown[] = [];
    const runtime: WorkbenchRuntime = createWorkbenchRuntime({
      evidenceQuery: {
        query: async (request) => {
          calls.push(request.at);
          return pageResult(request.page.cursor === undefined ? [record(1)] : [record(2)], 2, request.page.cursor === undefined ? "cursor-1" : null);
        }
      },
      outputByteLimit: 1024 * 1024
    });
    await flush();
    calls.splice(0);
    runtime.dispatch({ type: "set-export-complete-evidence", complete: true });
    runtime.dispatch({ type: "export-scope" });
    await flush();

    expect(runtime.getSnapshot().export.operation).toMatchObject({
      state: "ready",
      progress: {
        completed: 2,
        total: 2,
        committedEvidenceBoundary: readPoint(2)
      }
    });
    expect(calls[0]).toBe("LATEST_COMMITTED");
    expect(calls[1]).toMatchObject({ committedEvidenceBoundary: readPoint(2) });
    runtime.dispose();
  });
});
