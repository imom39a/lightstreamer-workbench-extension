import { normalizeEvidenceSearchText } from "../evidence-facets";

export const EVENT_INDEX_BLOCK_SIZE = 256;
export const SEARCH_BLOCK_FILTER_BYTES = 2048;
const SEARCH_BLOCK_FILTER_MASK = SEARCH_BLOCK_FILTER_BYTES * 8 - 1;
export const FACET_POSTING_NAMESPACE = "facet-v2";

export type FacetPosting = {
  token: string;
  sequence: number;
  intervalId: string;
  eventId: string;
  facet: string;
  facetIdentity: string;
};

export type FacetPostingBlock = Omit<FacetPosting, "eventId"> & {
  observations: Array<[sequence: number, eventId: string]>;
};

export type SearchIndexBlock = {
  sequence: number;
  intervalId: string;
  firstSequence: number;
  lastSequence: number;
  bloom: Uint8Array;
  checksum: number;
};

export function indexBlockStart(sequence: number): number {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Invalid index sequence.");
  return Math.floor((sequence - 1) / EVENT_INDEX_BLOCK_SIZE) * EVENT_INDEX_BLOCK_SIZE + 1;
}

export function facetPostingToken(identity: string): string {
  return JSON.stringify([FACET_POSTING_NAMESPACE, identity]);
}

export function facetIdentityParts(facetIdentity: string): { facet: string; type: string; value: string } | null {
  try {
    const parsed = JSON.parse(facetIdentity) as unknown;
    return Array.isArray(parsed) && parsed.length === 4 && parsed[0] === "v1" && typeof parsed[1] === "string"
      && typeof parsed[2] === "string" && typeof parsed[3] === "string"
      ? { facet: parsed[1], type: parsed[2], value: parsed[3] }
      : null;
  } catch {
    return null;
  }
}


function exactKeys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid index block.");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== expected.sort().join("\0")) throw new Error("Invalid index block fields.");
}

export function readFacetPostingBlock(input: unknown): FacetPostingBlock {
  exactKeys(input, ["token", "sequence", "intervalId", "facet", "facetIdentity", "observations"]);
  const value = input as FacetPostingBlock;
  const identity = typeof value.facetIdentity === "string" ? facetIdentityParts(value.facetIdentity) : null;
  if (typeof value.intervalId !== "string" || !value.intervalId || typeof value.facet !== "string" || !value.facet
    || !identity || identity.facet !== value.facet
    || value.token !== facetPostingToken(value.facetIdentity) || indexBlockStart(value.sequence) !== value.sequence
    || !Array.isArray(value.observations) || value.observations.length < 1 || value.observations.length > EVENT_INDEX_BLOCK_SIZE) {
    throw new Error("Corrupt facet posting block.");
  }
  let previous = value.sequence - 1;
  for (const observation of value.observations) {
    if (!Array.isArray(observation) || observation.length !== 2 || !Number.isSafeInteger(observation[0])
      || observation[0] <= previous || indexBlockStart(observation[0]) !== value.sequence
      || typeof observation[1] !== "string" || !observation[1]) throw new Error("Corrupt facet posting observations.");
    previous = observation[0];
  }
  return value as FacetPostingBlock;
}

export function expandFacetPostingBlock(value: unknown): FacetPosting[] {
  const block = readFacetPostingBlock(value);
  return block.observations.map(([sequence, eventId]) => ({
    token: block.token, sequence, eventId, intervalId: block.intervalId,
    facet: block.facet, facetIdentity: block.facetIdentity
  }));
}

export function groupFacetPostings(postings: readonly FacetPosting[]): FacetPostingBlock[] {
  const blocks = new Map<string, FacetPostingBlock>();
  for (const posting of postings) {
    const sequence = indexBlockStart(posting.sequence);
    const key = JSON.stringify([posting.token, sequence]);
    let block = blocks.get(key);
    if (!block) {
      block = { token: posting.token, sequence, intervalId: posting.intervalId, facet: posting.facet, facetIdentity: posting.facetIdentity, observations: [] };
      blocks.set(key, block);
    }
    block.observations.push([posting.sequence, posting.eventId]);
  }
  return [...blocks.values()];
}

export function mergeFacetPostingBlock(previous: unknown, addition: FacetPostingBlock): FacetPostingBlock {
  readFacetPostingBlock(addition);
  if (previous === undefined) return addition;
  const current = readFacetPostingBlock(previous);
  if (current.sequence !== addition.sequence || current.intervalId !== addition.intervalId || current.token !== addition.token
    || current.observations.at(-1)![0] >= addition.observations[0]![0]) throw new Error("Overlapping facet posting append.");
  return { ...current, observations: [...current.observations, ...addition.observations] };
}

/** Queue bounded read/modify/write operations in the caller's atomic commit. */
export function appendFacetPostingBlocks(store: IDBObjectStore, postings: readonly FacetPosting[]): void {
  for (const addition of groupFacetPostings(postings)) {
    const request = store.get([addition.token, addition.sequence]);
    request.onsuccess = () => {
      try { store.put(mergeFacetPostingBlock(request.result, addition)); }
      catch { store.transaction.abort(); }
    };
  }
}

/** A Bloom filter is only a candidate accelerator: matches are always checked
 * against exact normalized text. Hash collisions can add work, never hide a match. */
function visitTrigramBits(text: string, visit: (a: number, b: number, c: number) => boolean): boolean {
  const normalized = normalizeEvidenceSearchText(text);
  // String.includes uses UTF-16 units, including unpaired surrogates. Use the
  // same units here so even those substrings cannot become false negatives.
  for (let index = 2; index < normalized.length; index++) {
    const first = normalized.charCodeAt(index - 2);
    const second = normalized.charCodeAt(index - 1);
    const third = normalized.charCodeAt(index);
    let hash = Math.imul(first, 0x9e3779b1) ^ Math.imul(second, 0x85ebca6b) ^ Math.imul(third, 0xc2b2ae35);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash ^= hash >>> 13;
    const step = Math.imul(hash ^ 0x27d4eb2d, 0xc2b2ae35) | 1;
    if (!visit(hash & SEARCH_BLOCK_FILTER_MASK, (hash + step) & SEARCH_BLOCK_FILTER_MASK, (hash + Math.imul(2, step)) & SEARCH_BLOCK_FILTER_MASK)) return false;
  }
  return true;
}

function addSearchText(bloom: Uint8Array, text: string): void {
  visitTrigramBits(text, (a, b, c) => {
    bloom[a >>> 3]! |= 1 << (a & 7);
    bloom[b >>> 3]! |= 1 << (b & 7);
    bloom[c >>> 3]! |= 1 << (c & 7);
    return true;
  });
}

export function searchBlockMayContain(block: SearchIndexBlock, text: string): boolean {
  return visitTrigramBits(text, (a, b, c) => Boolean(
    (block.bloom[a >>> 3]! & (1 << (a & 7)))
    && (block.bloom[b >>> 3]! & (1 << (b & 7)))
    && (block.bloom[c >>> 3]! & (1 << (c & 7)))
  ));
}

function filterChecksum(bloom: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bloom) hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}

export function readSearchIndexBlock(input: unknown): SearchIndexBlock {
  exactKeys(input, ["sequence", "intervalId", "firstSequence", "lastSequence", "bloom", "checksum"]);
  const value = input as SearchIndexBlock;
  if (typeof value.intervalId !== "string" || !value.intervalId || indexBlockStart(value.sequence) !== value.sequence
    || indexBlockStart(value.firstSequence) !== value.sequence || indexBlockStart(value.lastSequence) !== value.sequence
    || value.lastSequence < value.firstSequence || !ArrayBuffer.isView(value.bloom)
    || Object.prototype.toString.call(value.bloom) !== "[object Uint8Array]"
    || value.bloom.byteLength !== SEARCH_BLOCK_FILTER_BYTES
    || value.checksum !== filterChecksum(value.bloom)) throw new Error("Corrupt search index block.");
  return value as SearchIndexBlock;
}

export function groupSearchProjections(projections: readonly { sequence: number; intervalId: string; searchText: string }[]): SearchIndexBlock[] {
  const blocks = new Map<number, SearchIndexBlock>();
  for (const projection of projections) {
    const sequence = indexBlockStart(projection.sequence);
    let group = blocks.get(sequence);
    if (!group) {
      group = { sequence, intervalId: projection.intervalId, firstSequence: projection.sequence, lastSequence: projection.sequence, bloom: new Uint8Array(SEARCH_BLOCK_FILTER_BYTES), checksum: 0 };
      blocks.set(sequence, group);
    } else if (projection.intervalId !== group.intervalId || projection.sequence !== group.lastSequence + 1) {
      throw new Error("Noncontiguous search index append.");
    }
    group.lastSequence = projection.sequence;
    addSearchText(group.bloom, projection.searchText);
  }
  return [...blocks.values()].map(block => ({ ...block, checksum: filterChecksum(block.bloom) }));
}

export function mergeSearchIndexBlock(previous: unknown, addition: SearchIndexBlock): SearchIndexBlock {
  readSearchIndexBlock(addition);
  if (previous === undefined) return addition;
  const current = readSearchIndexBlock(previous);
  if (current.sequence !== addition.sequence || current.intervalId !== addition.intervalId || current.lastSequence + 1 !== addition.firstSequence) {
    throw new Error("Noncontiguous search block append.");
  }
  const bloom = current.bloom.slice();
  for (let index = 0; index < bloom.length; index++) bloom[index]! |= addition.bloom[index]!;
  return { ...current, lastSequence: addition.lastSequence, bloom, checksum: filterChecksum(bloom) };
}

export function appendSearchIndexBlocks(store: IDBObjectStore, projections: readonly { sequence: number; intervalId: string; searchText: string }[]): void {
  for (const addition of groupSearchProjections(projections)) {
    const request = store.get(addition.sequence);
    request.onsuccess = () => {
      try { store.put(mergeSearchIndexBlock(request.result, addition)); }
      catch { store.transaction.abort(); }
    };
  }
}
