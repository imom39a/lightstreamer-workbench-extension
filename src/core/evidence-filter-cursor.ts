import { type EvidenceIdentity, type EvidenceQueryRequest, type EvidenceReadPoint } from "./evidence-filter-contract";

function stableQueryValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableQueryValue).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableQueryValue(entry)}`).join(",")}}`;
}

function cursorBoundary(readPoint: EvidenceReadPoint): string {
  return stableQueryValue({ interval: readPoint.interval, boundary: readPoint.committedEvidenceBoundary, range: readPoint.retainedRange });
}

function cursorQueryBinding(request: EvidenceQueryRequest): string {
  return stableQueryValue({
    discover: request.discover ?? null,
    filter: request.filter,
    find: request.find ?? null,
    lookup: request.lookup ?? null,
    page: { order: request.page.order, size: request.page.size }
  });
}

export type EvidenceQueryCursor = Readonly<{ anchor: EvidenceIdentity }>;

/**
 * Cursors are keyset anchors, never offsets.  The read point and complete
 * query binding remain part of the token so a cursor cannot be reused after a
 * clear, boundary change, filter change, or page-shape change.
 */
export function encodeEvidenceQueryCursor(readPoint: EvidenceReadPoint, request: EvidenceQueryRequest, anchor: EvidenceIdentity): string {
  return encodeURIComponent(JSON.stringify({ v: 3, anchor, query: cursorQueryBinding(request), point: cursorBoundary(readPoint) }));
}

export function decodeEvidenceQueryCursor(cursor: string | undefined, readPoint: EvidenceReadPoint, request: EvidenceQueryRequest): EvidenceQueryCursor | null {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as { v?: unknown; anchor?: unknown; query?: unknown; point?: unknown };
    const anchor = value.anchor as Partial<EvidenceIdentity> | undefined;
    const sequenceValue = anchor?.sequence;
    if (value.v !== 3 || value.query !== cursorQueryBinding(request) || value.point !== cursorBoundary(readPoint)
      || !anchor || typeof anchor.intervalId !== "string" || typeof anchor.pageId !== "string"
      || typeof anchor.ownerId !== "string" || typeof anchor.eventId !== "string"
      || !Number.isSafeInteger(sequenceValue) || (sequenceValue as number) < 1) {
      throw new Error("The page cursor is not bound to this query.");
    }
    const sequence = anchor.sequence as number;
    return Object.freeze({ anchor: Object.freeze({
      intervalId: anchor.intervalId,
      pageId: anchor.pageId,
      ownerId: anchor.ownerId,
      sequence,
      eventId: anchor.eventId
    }) });
  } catch {
    throw new Error("The page cursor is malformed or no longer valid.");
  }
}
