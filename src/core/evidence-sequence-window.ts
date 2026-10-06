import type { EvidenceReadPoint, EvidenceSequenceWindow } from "./evidence-filter-contract";
export class EvidenceSequenceWindowUnavailable extends Error {}
export function resolveEvidenceSequenceWindow(point: EvidenceReadPoint, window?: EvidenceSequenceWindow): { first: number; last: number } {
  const first = point.retainedRange?.first.sequence ?? 1;
  const last = Math.min(point.retainedRange?.last.sequence ?? 0, point.committedEvidenceBoundary?.sequence ?? 0);
  if (!window) return { first, last };
  const through = window.through ?? (point.committedEvidenceBoundary?.sequence ?? 0);
  if (!Number.isSafeInteger(window.after) || window.after < 0 || !Number.isSafeInteger(through) || through < window.after
    || through > (point.committedEvidenceBoundary?.sequence ?? 0)) throw new Error("Evidence sequence windows require 0 <= after <= through <= committed boundary.");
  if (window.after < first - 1 && through > window.after) throw new EvidenceSequenceWindowUnavailable("Retention advanced past the requested Evidence sequence window.");
  return { first: Math.max(first, window.after + 1), last: Math.min(last, through) };
}
