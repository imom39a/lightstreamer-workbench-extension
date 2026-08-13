/** A bounded JSON array writer for operations that cannot retain all entries. */

export type IncrementalSerializationErrorCode = "OUTPUT_LIMIT" | "SERIALIZATION_FAILED";

export class IncrementalSerializationError extends Error {
  readonly code: IncrementalSerializationErrorCode;
  readonly bytes: number;
  readonly maxBytes: number;

  constructor(
    code: IncrementalSerializationErrorCode,
    message: string,
    bytes: number,
    maxBytes: number
  ) {
    super(message);
    this.name = "IncrementalSerializationError";
    this.code = code;
    this.bytes = bytes;
    this.maxBytes = maxBytes;
  }
}

export type IncrementalJsonArrayWriter = Readonly<{
  append(value: unknown): void;
  finish(): string;
  readonly bytes: number;
  readonly count: number;
  /** Always zero: entries are released after their serialized chunk is appended. */
  readonly retainedEntryCount: number;
}>;

export type IncrementalJsonArrayWriterOptions = Readonly<{
  maxBytes: number;
}>;

export function createIncrementalJsonArrayWriter(
  options: IncrementalJsonArrayWriterOptions
): IncrementalJsonArrayWriter {
  const maxBytes = normalizeMaxBytes(options.maxBytes);
  const chunks: string[] = ["["];
  let bytes = 1;
  let count = 0;
  let finished = false;
  let result: string | null = null;

  const append = (value: unknown): void => {
    if (finished) {
      throw new Error("The incremental JSON writer is already finished.");
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (error) {
      throw new IncrementalSerializationError(
        "SERIALIZATION_FAILED",
        error instanceof Error ? error.message : "Evidence serialization failed.",
        bytes,
        maxBytes
      );
    }
    if (serialized === undefined) {
      throw new IncrementalSerializationError(
        "SERIALIZATION_FAILED",
        "Evidence serialization produced no JSON value.",
        bytes,
        maxBytes
      );
    }
    const chunk = `${count === 0 ? "" : ","}${serialized}`;
    const nextBytes = bytes + utf8Bytes(chunk);
    if (nextBytes + 1 > maxBytes) {
      throw new IncrementalSerializationError(
        "OUTPUT_LIMIT",
        `The serialized Evidence output would exceed the ${maxBytes.toLocaleString()}-byte safety limit.`,
        bytes,
        maxBytes
      );
    }
    chunks.push(chunk);
    bytes = nextBytes;
    count += 1;
  };

  const finish = (): string => {
    if (result !== null) return result;
    if (bytes + 1 > maxBytes) {
      throw new IncrementalSerializationError(
        "OUTPUT_LIMIT",
        `The serialized Evidence output would exceed the ${maxBytes.toLocaleString()}-byte safety limit.`,
        bytes,
        maxBytes
      );
    }
    chunks.push("]");
    bytes += 1;
    result = chunks.join("");
    finished = true;
    return result;
  };

  return Object.freeze({
    append,
    finish,
    get bytes() { return bytes; },
    get count() { return count; },
    retainedEntryCount: 0
  });
}

function normalizeMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2) {
    throw new RangeError("The incremental JSON output limit must be at least two bytes.");
  }
  return value;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
