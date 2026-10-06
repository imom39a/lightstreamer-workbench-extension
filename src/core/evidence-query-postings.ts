import type { DeterministicEvidenceRecord, EvidenceFilter, TypedFacetValue } from "./evidence-filter-contract";

export function canUseEvidenceFacetPosting(facet: string, value: TypedFacetValue): boolean {
  if (value.type === "structural-none") return true;
  if (value.type.startsWith("structural-")) return false;
  return !(value.type === "string" && ["client", "session", "subscription", "item", "listener", "kind"].includes(facet));
}

/** Retention-owned compact postings for the IndexedDB adapter's volatile tier. */
export class VolatileEvidenceQueryIndex {
  readonly records = new Map<number, DeterministicEvidenceRecord>();
  private readonly postings = new Map<string, Set<number>>();
  add(record: DeterministicEvidenceRecord): void {
    this.remove(record.identity.sequence);
    this.records.set(record.identity.sequence, record);
    for (const value of Object.values(record.facets)) {
      if (!value) continue;
      const posting = this.postings.get(value.identity) ?? new Set<number>();
      posting.add(record.identity.sequence);
      this.postings.set(value.identity, posting);
    }
  }
  remove(sequence: number): void {
    const record = this.records.get(sequence);
    if (!record) return;
    this.records.delete(sequence);
    for (const value of Object.values(record.facets)) {
      if (!value) continue;
      const posting = this.postings.get(value.identity);
      posting?.delete(sequence);
      if (!posting?.size) this.postings.delete(value.identity);
    }
  }
  clear(): void { this.records.clear(); this.postings.clear(); }
  candidates(filter: EvidenceFilter): { sequences: Set<number>; reads: number; driver: string } | null {
    let chosen: { sequences: Set<number>; reads: number; driver: string } | null = null;
    for (const [facet, bucket] of Object.entries(filter.criteria)) {
      if (!bucket?.include.length || bucket.include.some(value => !canUseEvidenceFacetPosting(facet, value))) continue;
      const sequences = new Set<number>();
      for (const value of bucket.include) for (const sequence of this.postings.get(value.identity) ?? []) sequences.add(sequence);
      if (!chosen || sequences.size < chosen.sequences.size) chosen = { sequences, reads: bucket.include.length, driver: facet };
    }
    return chosen;
  }
}
