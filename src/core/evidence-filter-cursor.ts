import { type EvidenceQueryRequest, type EvidenceReadPoint } from "./evidence-filter-contract";

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

export function encodeEvidenceQueryCursor(readPoint: EvidenceReadPoint, request: EvidenceQueryRequest, offset: number): string {
  return encodeURIComponent(JSON.stringify({ v: 2, offset, query: cursorQueryBinding(request), point: cursorBoundary(readPoint) }));
}

export function decodeEvidenceQueryCursor(cursor: string | undefined, readPoint: EvidenceReadPoint, request: EvidenceQueryRequest): number {
  if (cursor === undefined) return 0;
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as { v?: unknown; offset?: unknown; query?: unknown; point?: unknown };
    if (value.v !== 2 || value.query !== cursorQueryBinding(request) || value.point !== cursorBoundary(readPoint) || !Number.isSafeInteger(value.offset) || (value.offset as number) < 0) throw new Error("The page cursor is not bound to this query.");
    return value.offset as number;
  } catch {
    throw new Error("The page cursor is malformed or no longer valid.");
  }
}
