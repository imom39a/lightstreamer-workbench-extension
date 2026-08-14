import { MIB } from "../../core/event-history-capacity";

/**
 * The shipped normal History Capacity used as a comparison target for advisory
 * browser telemetry. It does not reserve browser storage or override the
 * authoritative write-time admission boundary.
 */
export const PROPOSED_NORMAL_HISTORY_HEADROOM = Object.freeze({
  recordCount: 100_000,
  canonicalBytes: 256 * MIB
});

export type StorageEstimateThreshold = "BEFORE_CAPTURE" | "NEAR_LIMIT" | "EXHAUSTED";

export type StorageEstimateObservation = Readonly<{
  source: "navigator.storage.estimate";
  status: "AVAILABLE" | "UNAVAILABLE";
  usageBytes: number | null;
  quotaBytes: number | null;
  headroomBytes: number | null;
  failure: Readonly<{ code: string; message: string }> | null;
}>;

export type StorageHeadroomDiagnostic = Readonly<{
  severity: "Warning";
  title: string;
  affected: string;
  detail: string;
  recovery: string;
}>;

export type StorageEstimateStorage = Pick<StorageManager, "estimate">;

export type StorageHeadroomSampler = Readonly<{
  sample(threshold: StorageEstimateThreshold): Promise<StorageEstimateObservation>;
}>;

function unavailable(code: string, message: string): StorageEstimateObservation {
  return Object.freeze({
    source: "navigator.storage.estimate",
    status: "UNAVAILABLE",
    usageBytes: null,
    quotaBytes: null,
    headroomBytes: null,
    failure: Object.freeze({ code, message })
  });
}

function isValidEstimateValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function defaultStorage(): StorageEstimateStorage | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.storage;
}

/** Reads one extension-origin estimate and deliberately swallows all failures. */
export async function sampleStorageEstimate(
  storage: StorageEstimateStorage | undefined = defaultStorage()
): Promise<StorageEstimateObservation> {
  if (!storage || typeof storage.estimate !== "function") {
    return unavailable(
      "STORAGE_ESTIMATE_UNAVAILABLE",
      "navigator.storage.estimate is unavailable."
    );
  }
  try {
    const estimate = await storage.estimate();
    const usage = estimate.usage;
    const quota = estimate.quota;
    if (!isValidEstimateValue(usage) || !isValidEstimateValue(quota)) {
      return unavailable(
        "STORAGE_ESTIMATE_INVALID",
        "navigator.storage.estimate returned invalid usage or quota."
      );
    }
    if (usage > quota) {
      return unavailable(
        "STORAGE_ESTIMATE_CONTRADICTORY",
        "navigator.storage.estimate reported usage above quota."
      );
    }
    return Object.freeze({
      source: "navigator.storage.estimate",
      status: "AVAILABLE",
      usageBytes: usage,
      quotaBytes: quota,
      headroomBytes: quota - usage,
      failure: null
    });
  } catch (error) {
    return unavailable(
      "STORAGE_ESTIMATE_FAILED",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function unstableObservation(): StorageEstimateObservation {
  return unavailable(
    "STORAGE_ESTIMATE_UNSTABLE",
    "The browser estimate changed across the advisory warning boundary."
  );
}

function reconcileEstimate(
  previous: StorageEstimateObservation | null,
  next: StorageEstimateObservation
): StorageEstimateObservation {
  if (
    previous?.status === "AVAILABLE" &&
    next.status === "AVAILABLE" &&
    ((previous.headroomBytes ?? 0) < PROPOSED_NORMAL_HISTORY_HEADROOM.canonicalBytes) !==
      ((next.headroomBytes ?? 0) < PROPOSED_NORMAL_HISTORY_HEADROOM.canonicalBytes)
  ) {
    return unstableObservation();
  }
  return next;
}

/**
 * Makes coarse pressure sampling explicit and idempotent. A threshold is
 * marked before the asynchronous read starts, so a burst of history status
 * publications cannot turn advisory telemetry into a polling loop.
 */
export function createStorageHeadroomSampler(
  read: (threshold: StorageEstimateThreshold) => Promise<StorageEstimateObservation> =
    async () => sampleStorageEstimate()
): StorageHeadroomSampler {
  const sampled = new Set<StorageEstimateThreshold>();
  const observations = new Map<StorageEstimateThreshold, Promise<StorageEstimateObservation>>();
  let previous: StorageEstimateObservation | null = null;

  return Object.freeze({
    sample(threshold) {
      const existing = observations.get(threshold);
      if (existing) return existing;
      if (sampled.has(threshold)) {
        return Promise.resolve(
          observations.get(threshold)?.then((value) => value) ??
            unavailable("STORAGE_ESTIMATE_UNAVAILABLE", "Storage estimate was not retained.")
        );
      }
      sampled.add(threshold);
      const observation = Promise.resolve()
        .then(() => read(threshold))
        .catch((error) => unavailable(
          "STORAGE_ESTIMATE_FAILED",
          error instanceof Error ? error.message : String(error)
        ))
        .then((value) => {
          const reconciled = reconcileEstimate(previous, value);
          previous = reconciled.status === "AVAILABLE" ? reconciled : null;
          return reconciled;
        });
      observations.set(threshold, observation);
      return observation;
    }
  });
}

export function storageHeadroomDiagnostic(
  observation: StorageEstimateObservation | null
): StorageHeadroomDiagnostic | null {
  if (
    observation?.status !== "AVAILABLE" ||
    observation.headroomBytes === null ||
    observation.headroomBytes >= PROPOSED_NORMAL_HISTORY_HEADROOM.canonicalBytes
  ) {
    return null;
  }
  const headroomMiB = Math.floor(observation.headroomBytes / MIB).toLocaleString();
  const targetMiB = Math.floor(PROPOSED_NORMAL_HISTORY_HEADROOM.canonicalBytes / MIB).toLocaleString();
  return Object.freeze({
    severity: "Warning",
    title: "Estimated storage headroom is low",
    affected: "Extension origin",
    detail: `The browser estimates about ${headroomMiB} MiB free, below the proposed normal History Capacity of ${PROPOSED_NORMAL_HISTORY_HEADROOM.recordCount.toLocaleString()} Evidence records or ${targetMiB} MiB canonical accounted bytes. This is advisory only: rough, not a reservation or acceptance guarantee. Canonical count/byte admission and actual QuotaExceededError remain authoritative.`,
    recovery: "Free browser storage or reduce extension-origin usage, then reopen DevTools. No unlimitedStorage permission is requested."
  });
}
