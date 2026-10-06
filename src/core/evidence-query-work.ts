import type { EvidenceQueryTelemetry, EvidenceQueryWorkBudget } from "./evidence-filter-contract";

export class EvidenceQueryWorkLimit extends Error {
  constructor(message: string) { super(message); this.name = "EvidenceQueryWorkLimit"; }
}
export function validateEvidenceQueryWorkBudget(budget?: EvidenceQueryWorkBudget): void {
  if (!budget) return;
  for (const [name, value] of Object.entries(budget)) {
    if (!["maxProjectionReads", "maxPayloadHydrations", "deadlineMs"].includes(name)
      || !Number.isSafeInteger(value) || value < 1 || value > (name === "deadlineMs" ? 30000 : 1000000)) {
      throw new EvidenceQueryWorkLimit("Query work limits must be positive integers; deadlineMs is at most 30000 and work counts at most 1000000.");
    }
  }
}
/** Existing counters are the common enforcement seam for every storage tier. */
export function guardEvidenceQueryTelemetry<T extends Partial<EvidenceQueryTelemetry>>(telemetry: T, budget: EvidenceQueryWorkBudget | undefined, startedAt: number): T {
  if (!budget) return telemetry;
  const check = () => {
    if (budget.deadlineMs !== undefined && Date.now() - startedAt >= budget.deadlineMs) throw new EvidenceQueryWorkLimit("Evidence query computation deadline exceeded.");
    const projections = (telemetry.projectionReads ?? 0) + (telemetry.discoveryProjectionReads ?? 0);
    if (budget.maxProjectionReads !== undefined && projections > budget.maxProjectionReads) throw new EvidenceQueryWorkLimit("Evidence query projection-read budget exceeded; narrow the Scope or window.");
    if (budget.maxPayloadHydrations !== undefined && (telemetry.payloadHydrations ?? 0) > budget.maxPayloadHydrations) throw new EvidenceQueryWorkLimit("Evidence query payload-hydration budget exceeded; request fewer records or fields.");
  };
  return new Proxy(telemetry, { set(target, key, value) { Reflect.set(target, key, value); check(); return true; } });
}
/** Yield CPU scans to the browser task queue so cancellation can be observed. */
export async function cooperateEvidenceQuery(index: number, signal?: AbortSignal): Promise<void> {
  if (index % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (signal?.aborted) throw new Error("EVIDENCE_QUERY_CANCELLED");
}
