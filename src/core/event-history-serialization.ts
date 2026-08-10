import { type EvidenceCandidate } from "./event-history-authoritative";

export type SerializedJournalEvidence = Readonly<{
  payload: string;
  bytes: number;
}>;

/**
 * The journal serializer is deliberately replay-complete. It preserves the
 * candidate's topology and semantic facts; export sanitization belongs to the
 * versioned topology-export serializer and is never used for acceptance.
 */
export function serializeJournalEvidenceCandidate(
  candidate: EvidenceCandidate
): SerializedJournalEvidence {
  const payload = canonicalJson(candidate);
  return Object.freeze({
    payload,
    bytes: new TextEncoder().encode(payload).byteLength
  });
}

export function deserializeJournalEvidenceCandidate(payload: string): EvidenceCandidate {
  return JSON.parse(payload) as EvidenceCandidate;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
