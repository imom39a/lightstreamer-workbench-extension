import { type EvidenceCandidate } from "./event-history-authoritative";

export type SerializedJournalEvidence = Readonly<{
  payload: string;
  bytes: number;
}>;

/**
 * Logical journal framing is part of History Capacity, but is not an
 * IndexedDB storage-layout estimate. The frame is a four-byte payload length
 * followed by a four-byte framing version. Both are stable for every journal
 * implementation and can be computed synchronously before admission.
 */
export const JOURNAL_LOGICAL_FRAME_VERSION = 1;
export const JOURNAL_LOGICAL_FRAME_BYTES = Uint32Array.BYTES_PER_ELEMENT * 2;

export function journalAccountedBytes(payloadBytes: number): number {
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < 0) {
    throw new Error("Journal payload bytes must be a non-negative safe integer.");
  }
  const accountedBytes = payloadBytes + JOURNAL_LOGICAL_FRAME_BYTES;
  if (!Number.isSafeInteger(accountedBytes)) {
    throw new Error("Journal accounted bytes exceed the safe integer range.");
  }
  return accountedBytes;
}

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
  const parsed = JSON.parse(payload) as unknown;
  // The common Lightstreamer envelope is already JSON-native. Avoid walking
  // and copying every nested payload a second time unless the replay framing
  // actually contains one of the non-JSON values that needs decoding.
  return payload.includes(`"${REPLAY_TAG}"`)
    ? decode(parsed) as EvidenceCandidate
    : parsed as EvidenceCandidate;
}

const REPLAY_TAG = "__lsewReplayTag";

function canonicalJson(value: unknown): string {
  return JSON.stringify(encode(value));
}

function encode(value: unknown): unknown {
  if (value === undefined) return { [REPLAY_TAG]: "undefined" };
  if (typeof value === "bigint") return { [REPLAY_TAG]: "bigint", value: value.toString() };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { [REPLAY_TAG]: "number", value: "NaN" };
    if (value === Infinity) return { [REPLAY_TAG]: "number", value: "Infinity" };
    if (value === -Infinity) return { [REPLAY_TAG]: "number", value: "-Infinity" };
    if (Object.is(value, -0)) return { [REPLAY_TAG]: "number", value: "-0" };
    return value;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return { [REPLAY_TAG]: "date", value: value.toISOString() };
  if (Array.isArray(value)) return value.map((entry) => encode(entry));
  if (typeof value !== "object") throw new Error(`Unsupported replay value type: ${typeof value}.`);

  const object = value as Record<string, unknown>;
  const encoded = Object.fromEntries(Object.keys(object).sort().map((key) => [key, encode(object[key])]));
  return Object.prototype.hasOwnProperty.call(encoded, REPLAY_TAG)
    ? { [REPLAY_TAG]: "object", value: encoded }
    : encoded;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => decode(entry));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  switch (object[REPLAY_TAG]) {
    case "undefined": return undefined;
    case "bigint": return BigInt(object.value as string);
    case "number":
      return ({ NaN: Number.NaN, Infinity, "-Infinity": -Infinity, "-0": -0 } as const)[object.value as "NaN" | "Infinity" | "-Infinity" | "-0"];
    case "date": return new Date(object.value as string);
    case "object": return decode(object.value);
    default: return Object.fromEntries(Object.keys(object).map((key) => [key, decode(object[key])]));
  }
}
