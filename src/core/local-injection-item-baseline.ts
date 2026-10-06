import type { LightstreamerEventEnvelope } from "./event-envelope";
import type { NativeChangeBaseline } from "./local-injection-change-semantics";

export type NativeItemBaselineTarget = Readonly<{ pageEpoch: string; clientId: string; sessionId: string; subscriptionId: string; item: Readonly<{ name: string | null; position: number | null }> }>;
export type NativeItemBaselineEvidence = Readonly<{ intervalId: string; sequence: number; eventId: string }>;
type Entry = Readonly<{ target: NativeItemBaselineTarget; baseline: NativeChangeBaseline; evidence: NativeItemBaselineEvidence; bytes: number }>;

/** Bounded Local Effective values for non-COMMAND Item Update derivation only.
 * Admission is called at the existing committed Evidence boundary, not Capture.
 * Eviction means unavailable baseline and never establishes a first update. */
export function createNativeItemBaselineIndex(limits: Readonly<{ maxRows?: number; maxBytes?: number }> = {}) {
  const maxRows = limits.maxRows ?? 256, maxBytes = limits.maxBytes ?? 4 * 1024 * 1024;
  const rows = new Map<string, Entry>();
  let bytes = 0;
  const key = (target: NativeItemBaselineTarget) => JSON.stringify([target.pageEpoch, target.clientId, target.sessionId, target.subscriptionId, target.item.name, target.item.position]);
  const drop = (identity: string) => { const entry = rows.get(identity); if (entry) { bytes -= entry.bytes; rows.delete(identity); } };
  return {
    apply(event: LightstreamerEventEnvelope, evidence: NativeItemBaselineEvidence, pageEpoch: string | null): void {
      if (event.kind === "subscription-started" || event.kind === "subscription-ended") {
        for (const [identity, row] of rows) if (row.target.pageEpoch === pageEpoch && row.target.clientId === event.client?.id && row.target.sessionId === event.client.sessionId && row.target.subscriptionId === event.subscription?.id) drop(identity);
      }
      if (event.kind !== "item-update" || !["MERGE", "DISTINCT"].includes(event.subscription?.mode ?? "") || !event.update?.fields
        || !pageEpoch || !event.client?.id || !event.client.sessionId || !event.subscription?.id || !event.item
        || (event.item.name == null && event.item.position == null)) return;
      const target: NativeItemBaselineTarget = { pageEpoch, clientId: event.client.id, sessionId: event.client.sessionId, subscriptionId: event.subscription.id, item: { name: event.item.name ?? null, position: event.item.position ?? null } };
      const identity = key(target);
      drop(identity);
      const fields = { ...event.update.fields };
      const fieldValueStates = Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, event.update!.fieldValueStates?.[field] ?? (value === null && !event.synthetic && event.captureSource !== "wire" ? "ambiguous-null" : "concrete")]));
      const baseline: NativeChangeBaseline = Object.freeze({ fields: Object.freeze(fields), fieldValueStates: Object.freeze(fieldValueStates), basis: `Local Effective Item Update ${evidence.eventId}` });
      const accounted = new TextEncoder().encode(JSON.stringify({ target, baseline, evidence })).byteLength;
      if (accounted > maxBytes || maxRows < 1) return;
      while (rows.size >= maxRows || bytes + accounted > maxBytes) drop(rows.keys().next().value!);
      rows.set(identity, { target, baseline, evidence: Object.freeze({ ...evidence }), bytes: accounted });
      bytes += accounted;
    },
    read(target: NativeItemBaselineTarget, intervalId: string, gapAfterSequence?: number): NativeChangeBaseline | null {
      const row = rows.get(key(target));
      if (!row || row.evidence.intervalId !== intervalId || (gapAfterSequence !== undefined && row.evidence.sequence <= gapAfterSequence)) return null;
      return row.baseline;
    },
    clear(): void { rows.clear(); bytes = 0; },
    status(): Readonly<{ rows: number; bytes: number; maxRows: number; maxBytes: number }> { return Object.freeze({ rows: rows.size, bytes, maxRows, maxBytes }); }
  };
}
