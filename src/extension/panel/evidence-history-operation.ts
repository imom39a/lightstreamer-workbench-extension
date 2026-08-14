import {
  createIncrementalJsonArrayWriter,
  IncrementalSerializationError
} from "../../core/incremental-json-writer";
import {
  type DeterministicEvidenceRecord,
  type EvidenceFilterReadProblem,
  type EvidenceQueryRequest,
  type EvidenceReadPoint,
  type EvidenceSnapshot
} from "../../core/evidence-filter-contract";
import {
  type EvidenceInvestigationQuery,
  type StructuralEvidenceScope
} from "./evidence-investigation-query";
import { type Filter } from "../../core/filter-algebra";

export type StreamedEvidenceResult =
  | Readonly<{ ok: true; count: number; readPoint: EvidenceSnapshot["readPoint"] }>
  | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>;

export type StreamEvidenceOptions = Readonly<{
  query: EvidenceInvestigationQuery;
  scope: StructuralEvidenceScope;
  filter: Filter;
  order: "NEWEST_FIRST" | "OLDEST_FIRST";
  signal: AbortSignal;
  onLatch(readPoint: EvidenceSnapshot["readPoint"], total: number): void;
  onPage(page: readonly DeterministicEvidenceRecord[], readPoint: EvidenceSnapshot["readPoint"]): void | Promise<void>;
}>;

export type ScopedEvidenceCopyOptions = Readonly<{
  query: EvidenceInvestigationQuery;
  scope: StructuralEvidenceScope;
  filter: Filter;
  order: "NEWEST_FIRST" | "OLDEST_FIRST";
  signal: AbortSignal;
  maxBytes: number;
  scopeId: string;
  scopeLabel: string;
  serializeRecord(record: DeterministicEvidenceRecord): unknown;
  onLatch(readPoint: EvidenceSnapshot["readPoint"], total: number): void;
  onProgress(progress: Readonly<{ completed: number; outputBytes: number; readPoint: EvidenceSnapshot["readPoint"] }>): void;
}>;

export type ScopedEvidenceCopyResult =
  | Readonly<{ ok: true; count: number; text: string; readPoint: EvidenceSnapshot["readPoint"]; outputBytes: number }>
  | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>;

export async function streamEvidencePages(options: StreamEvidenceOptions): Promise<StreamedEvidenceResult> {
  const pageSize = 100;
  let at: EvidenceQueryRequest["at"] = "LATEST_COMMITTED";
  let cursor: string | undefined;
  let readPoint: EvidenceSnapshot["readPoint"] | null = null;
  let expectedTotal: number | null = null;
  let count = 0;
  let pageCount = 0;
  let expectedPageCount = Number.POSITIVE_INFINITY;
  while (true) {
    const result = await options.query.query({
      at,
      scope: options.scope,
      filter: options.filter,
      page: Object.freeze({
        order: options.order,
        size: pageSize,
        ...(cursor === undefined ? {} : { cursor })
      }),
      discover: [],
      includePayload: true,
      signal: options.signal
    });
    if (!result.ok) return result;
    if (readPoint === null) {
      readPoint = result.value.readPoint;
      expectedTotal = result.value.totals.inScope;
      expectedPageCount = Math.max(1, Math.ceil(expectedTotal / pageSize) + 1);
      options.onLatch(readPoint, expectedTotal);
    } else if (!sameEvidenceReadPoint(result.value.readPoint, readPoint)) {
      return queryFailure("QUERY_FAILED", "The Complete History read crossed a committed boundary.");
    }
    if (result.value.totals.inScope !== expectedTotal) {
      return queryFailure("QUERY_FAILED", "The Complete History read changed its latched Evidence total.");
    }
    if (result.value.page.evidence.some((record) => record.payload === undefined)) {
      return queryFailure("QUERY_FAILED", "The complete Evidence read did not return full payloads.");
    }
    if (options.signal.aborted) {
      return queryFailure("QUERY_CANCELLED", "The Complete History operation was cancelled before its artifact was published.");
    }
    const pageOperation = options.onPage(result.value.page.evidence, readPoint);
    if (pageOperation !== undefined) await pageOperation;
    if (options.signal.aborted) {
      return queryFailure("QUERY_CANCELLED", "The Complete History operation was cancelled before its artifact was published.");
    }
    count += result.value.page.evidence.length;
    pageCount += 1;
    if (result.value.page.nextCursor === null) break;
    if (pageCount >= expectedPageCount || result.value.page.nextCursor === cursor) {
      return queryFailure("QUERY_FAILED", "The complete Evidence read exceeded its bounded page contract.");
    }
    cursor = result.value.page.nextCursor;
    at = readPoint;
  }
  return { ok: true, count, readPoint: readPoint! };
}

export async function createScopedEvidenceCopy(
  options: ScopedEvidenceCopyOptions
): Promise<ScopedEvidenceCopyResult> {
  const writer = createIncrementalJsonArrayWriter({ maxBytes: options.maxBytes });
  const result = await streamEvidencePages({
    ...options,
    onPage: (page, readPoint) => {
      for (const record of page) {
        if (options.signal.aborted) return;
        try {
          writer.append(options.serializeRecord(record));
        } catch (error) {
          if (error instanceof IncrementalSerializationError) throw error;
          throw new IncrementalSerializationError(
            "SERIALIZATION_FAILED",
            error instanceof Error ? error.message : "Evidence serialization failed.",
            writer.bytes,
            options.maxBytes
          );
        }
      }
      options.onProgress({ completed: writer.count, outputBytes: writer.bytes, readPoint });
    }
  });
  if (!result.ok) return result;
  if (options.signal.aborted) {
    return { ok: false, problem: { code: "QUERY_CANCELLED", message: "The Complete History operation was cancelled before its artifact was published." } };
  }
  let text: string;
  try {
    const metadata = JSON.stringify({
      format: "lightstreamer-workbench/scoped-evidence-copy/v1",
      scope: { id: options.scopeId, label: options.scopeLabel },
      filter: options.filter,
      count: result.count
    });
    const events = writer.finish();
    text = `${metadata.slice(0, -1)},"events":${events}}`;
  } catch (error) {
    if (error instanceof IncrementalSerializationError) throw error;
    throw new IncrementalSerializationError(
      "SERIALIZATION_FAILED",
      error instanceof Error ? error.message : "Evidence serialization failed.",
      writer.bytes,
      options.maxBytes
    );
  }
  const outputBytes = utf8ByteLength(text);
  if (outputBytes > options.maxBytes) {
    throw new IncrementalSerializationError(
      "OUTPUT_LIMIT",
      `The serialized Evidence output would exceed the ${options.maxBytes.toLocaleString()}-byte safety limit.`,
      options.maxBytes,
      options.maxBytes
    );
  }
  return { ok: true, count: result.count, text, readPoint: result.readPoint, outputBytes };
}

function queryFailure(
  code: EvidenceFilterReadProblem["code"],
  message: string
): Readonly<{ ok: false; problem: EvidenceFilterReadProblem }> {
  return { ok: false, problem: Object.freeze({ code, message }) };
}

function sameEvidenceReadPoint(left: EvidenceReadPoint, right: EvidenceReadPoint): boolean {
  const sameIdentity = (first: EvidenceReadPoint["committedEvidenceBoundary"], second: EvidenceReadPoint["committedEvidenceBoundary"]): boolean =>
    first?.intervalId === second?.intervalId &&
    first?.pageId === second?.pageId &&
    first?.ownerId === second?.ownerId &&
    first?.sequence === second?.sequence &&
    first?.eventId === second?.eventId;
  return left.interval.id === right.interval.id &&
    left.interval.ordinal === right.interval.ordinal &&
    sameIdentity(left.committedEvidenceBoundary, right.committedEvidenceBoundary) &&
    sameIdentity(left.retainedRange?.first ?? null, right.retainedRange?.first ?? null) &&
    sameIdentity(left.retainedRange?.last ?? null, right.retainedRange?.last ?? null);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
