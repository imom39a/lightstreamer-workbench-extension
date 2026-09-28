import { normalizeEvidenceSearchText } from "../evidence-facets";
import { typedFacetValue, type TypedFacetValue } from "../evidence-filter-contract";

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

type SearchProjection = { sequence: number; intervalId: string; searchText: string };

export type SearchIndexRowsProjection = SearchProjection & {
  eventId: string;
  timestamp: number;
  summary: string;
  facets: Readonly<Record<string, unknown>>;
};

export type SearchIndexRowsFacetColumn = {
  facet: string;
  values: Array<TypedFacetValue | SearchIndexRowsFacetValueV2>;
  /** Zero means absent; positive values address the one-based dictionary. */
  codes: Uint16Array;
};

/** Version two derives facet and identity from the containing column. A label
 * is stored only when it differs from the displayed value. */
export type SearchIndexRowsFacetValueV2 = Readonly<{ type: string; value: string; label?: string }>;

/** Exact search-only rows live at the negative key beside the positive Bloom
 * block. They contain neither replay payloads nor display projections. */
export type SearchIndexRowsBlock = {
  sequence: number;
  intervalId: string;
  firstSequence: number;
  lastSequence: number;
  version: 1 | 2;
  texts: string[];
  eventIds: string[];
  timestamps: Float64Array;
  /** Checkpoints are zero; observable Evidence rows are one. */
  evidence: Uint8Array;
  facets: SearchIndexRowsFacetColumn[];
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

export function groupSearchProjections(projections: readonly SearchProjection[]): SearchIndexBlock[] {
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

function typedArray(value: unknown, tag: string, length: number): boolean {
  return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === `[object ${tag}]`
    && (value as unknown as { length: number }).length === length;
}

function readRowsFacetValue(input: unknown, facet: string): TypedFacetValue {
  exactKeys(input, ["facet", "type", "value", "label", "identity"]);
  const value = input as TypedFacetValue;
  if (!facet || value.facet !== facet || typeof value.type !== "string" || typeof value.value !== "string"
    || typeof value.label !== "string" || value.identity !== JSON.stringify(["v1", facet, value.type, value.value])) {
    throw new Error("Corrupt exact search facet value.");
  }
  return value;
}

/** Hash every persisted field, including lengths, UTF-16 units and numeric
 * bytes. This detects damaged exact rows before they can omit Find matches. */
function rowsTextChecksum(hash: number, value: string): number {
  hash = Math.imul(hash ^ value.length, 0x01000193);
  // Keep the accumulator local to the hot loop. A per-character closure over
  // mutable checksum state prevents the browser from optimizing large blocks.
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return hash;
}

function rowsBytesChecksum(hash: number, array: ArrayBufferView): number {
  const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  hash = Math.imul(hash ^ data.length, 0x01000193);
  for (let index = 0; index < data.length; index++) hash = Math.imul(hash ^ data[index]!, 0x01000193);
  return hash;
}

function rowsChecksumV1(block: Omit<SearchIndexRowsBlock, "checksum">): number {
  let hash = rowsTextChecksum(0x811c9dc5, String(block.sequence));
  hash = rowsTextChecksum(hash, block.intervalId);
  hash = rowsTextChecksum(hash, String(block.firstSequence));
  hash = rowsTextChecksum(hash, String(block.lastSequence));
  hash = Math.imul(hash ^ block.version, 0x01000193);
  hash = Math.imul(hash ^ block.texts.length, 0x01000193);
  for (const value of block.texts) hash = rowsTextChecksum(hash, value);
  hash = Math.imul(hash ^ block.eventIds.length, 0x01000193);
  for (const value of block.eventIds) hash = rowsTextChecksum(hash, value);
  hash = rowsBytesChecksum(hash, block.timestamps);
  hash = rowsBytesChecksum(hash, block.evidence);
  hash = Math.imul(hash ^ block.facets.length, 0x01000193);
  for (const column of block.facets) {
    hash = rowsTextChecksum(hash, column.facet);
    hash = Math.imul(hash ^ column.values.length, 0x01000193);
    for (const inputValue of column.values) {
      const value = inputValue as TypedFacetValue;
      hash = rowsTextChecksum(hash, value.facet);
      hash = rowsTextChecksum(hash, value.type);
      hash = rowsTextChecksum(hash, value.value);
      hash = rowsTextChecksum(hash, value.label);
      hash = rowsTextChecksum(hash, value.identity);
    }
    hash = rowsBytesChecksum(hash, column.codes);
  }
  return hash >>> 0;
}

function rowsChecksumV2(block: Omit<SearchIndexRowsBlock, "checksum">): number {
  let hash = rowsTextChecksum(0x811c9dc5, String(block.sequence));
  hash = rowsTextChecksum(hash, block.intervalId);
  hash = rowsTextChecksum(hash, String(block.firstSequence));
  hash = rowsTextChecksum(hash, String(block.lastSequence));
  hash = Math.imul(hash ^ block.version, 0x01000193);
  hash = Math.imul(hash ^ block.texts.length, 0x01000193);
  for (const value of block.texts) hash = rowsTextChecksum(hash, value);
  hash = Math.imul(hash ^ block.eventIds.length, 0x01000193);
  for (const value of block.eventIds) hash = rowsTextChecksum(hash, value);
  hash = rowsBytesChecksum(hash, block.timestamps);
  hash = rowsBytesChecksum(hash, block.evidence);
  hash = Math.imul(hash ^ block.facets.length, 0x01000193);
  for (const column of block.facets) {
    hash = rowsTextChecksum(hash, column.facet);
    hash = Math.imul(hash ^ column.values.length, 0x01000193);
    for (const inputValue of column.values) {
      const value = inputValue as SearchIndexRowsFacetValueV2;
      hash = rowsTextChecksum(hash, value.type);
      hash = rowsTextChecksum(hash, value.value);
      hash = Math.imul(hash ^ (value.label === undefined ? 0 : 1), 0x01000193);
      if (value.label !== undefined) hash = rowsTextChecksum(hash, value.label);
    }
    hash = rowsBytesChecksum(hash, column.codes);
  }
  return hash >>> 0;
}

export function readSearchIndexRowsBlock(input: unknown): SearchIndexRowsBlock {
  exactKeys(input, ["sequence", "intervalId", "firstSequence", "lastSequence", "version", "texts", "eventIds", "timestamps", "evidence", "facets", "checksum"]);
  const block = input as SearchIndexRowsBlock;
  const length = block.lastSequence - block.firstSequence + 1;
  if ((block.version !== 1 && block.version !== 2) || typeof block.intervalId !== "string" || !block.intervalId
    || !Number.isSafeInteger(block.sequence) || block.sequence >= 0
    || indexBlockStart(block.firstSequence) !== -block.sequence || indexBlockStart(block.lastSequence) !== -block.sequence
    || !Number.isSafeInteger(length) || length < 1 || length > EVENT_INDEX_BLOCK_SIZE
    || !Array.isArray(block.texts) || block.texts.length !== length || block.texts.some(value => typeof value !== "string")
    || !Array.isArray(block.eventIds) || block.eventIds.length !== length || block.eventIds.some(value => typeof value !== "string" || !value)
    || !typedArray(block.timestamps, "Float64Array", length) || !typedArray(block.evidence, "Uint8Array", length)
    || !Array.isArray(block.facets)) throw new Error("Corrupt exact search index block.");
  for (let row = 0; row < length; row++) {
    if (!Number.isFinite(block.timestamps[row]) || (block.evidence[row] !== 0 && block.evidence[row] !== 1)
      || (block.evidence[row] === 0 && block.texts[row] !== "")) throw new Error("Corrupt exact search row.");
  }
  const facets = new Set<string>();
  for (const column of block.facets) {
    exactKeys(column, ["facet", "values", "codes"]);
    if (typeof column.facet !== "string" || !column.facet || facets.has(column.facet)
      || !Array.isArray(column.values) || column.values.length < 1 || column.values.length > length
      || !typedArray(column.codes, "Uint16Array", length)) throw new Error("Corrupt exact search facet column.");
    facets.add(column.facet);
    const identities = new Set<string>();
    const valuesByType = new Map<string, Set<string>>();
    for (const inputValue of column.values) {
      if (block.version === 1) {
        const identity = readRowsFacetValue(inputValue, column.facet).identity;
        if (identities.has(identity)) throw new Error("Duplicate exact search facet value.");
        identities.add(identity);
      } else {
        exactKeys(inputValue, inputValue && typeof inputValue === "object" && "label" in inputValue
          ? ["type", "value", "label"] : ["type", "value"]);
        const value = inputValue as SearchIndexRowsFacetValueV2;
        if (typeof value.type !== "string" || typeof value.value !== "string"
          || ("label" in value && (typeof value.label !== "string" || value.label === value.value))) {
          throw new Error("Corrupt compact exact search facet value.");
        }
        let values = valuesByType.get(value.type);
        if (!values) { values = new Set<string>(); valuesByType.set(value.type, values); }
        if (values.has(value.value)) throw new Error("Duplicate exact search facet value.");
        values.add(value.value);
      }
    }
    for (const code of column.codes) if (code > column.values.length) throw new Error("Corrupt exact search facet code.");
  }
  const expectedChecksum = block.version === 1 ? rowsChecksumV1(block) : rowsChecksumV2(block);
  if (!Number.isInteger(block.checksum) || block.checksum < 0 || block.checksum > 0xffff_ffff || block.checksum !== expectedChecksum) {
    throw new Error("Corrupt exact search index checksum.");
  }
  return block;
}

/** Read only the requested columns after validating the block once. Text-only
 * matching can use texts/evidence directly without constructing facet objects. */
export function searchIndexRowFacets(block: SearchIndexRowsBlock, rowIndex: number, requestedFacets?: readonly string[]): Readonly<Record<string, TypedFacetValue>> {
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= block.texts.length) throw new Error("Invalid exact search row offset.");
  const result: Record<string, TypedFacetValue> = Object.create(null) as Record<string, TypedFacetValue>;
  for (const column of block.facets) {
    if (requestedFacets !== undefined && !requestedFacets.includes(column.facet)) continue;
    const code = column.codes[rowIndex]!;
    if (code !== 0) {
      const value = column.values[code - 1]!;
      result[column.facet] = block.version === 1
        ? value as TypedFacetValue
        : typedFacetValue(column.facet, value.type, value.value, value.label ?? value.value);
    }
  }
  return result;
}

/** Reconstruct typed identities for block-level predicate evaluation. */
export function searchIndexRowFacetValues(block: SearchIndexRowsBlock, column: SearchIndexRowsFacetColumn): readonly TypedFacetValue[] {
  return block.version === 1
    ? column.values as TypedFacetValue[]
    : column.values.map(value => typedFacetValue(column.facet, value.type, value.value, value.label ?? value.value));
}

function buildRowsBlock(projections: readonly SearchIndexRowsProjection[]): SearchIndexRowsBlock {
  const first = projections[0]!;
  if (typeof first.intervalId !== "string" || !first.intervalId) throw new Error("Invalid exact search interval.");
  const columns = new Map<string, SearchIndexRowsFacetColumn>();
  const dictionaries = new Map<string, Map<string, number>>();
  const block: SearchIndexRowsBlock = {
    sequence: -indexBlockStart(first.sequence), intervalId: first.intervalId,
    firstSequence: first.sequence, lastSequence: projections.at(-1)!.sequence, version: 2,
    texts: [], eventIds: [], timestamps: new Float64Array(projections.length), evidence: new Uint8Array(projections.length), facets: [], checksum: 0
  };
  projections.forEach((projection, row) => {
    if (projection.sequence !== first.sequence + row || projection.intervalId !== first.intervalId
      || indexBlockStart(projection.sequence) !== -block.sequence || typeof projection.eventId !== "string" || !projection.eventId
      || !Number.isFinite(projection.timestamp) || typeof projection.summary !== "string"
      || !projection.facets || typeof projection.facets !== "object" || Array.isArray(projection.facets)) {
      throw new Error("Invalid exact search projection.");
    }
    const evidence = projection.summary !== "Topology checkpoint";
    block.texts.push(evidence ? normalizeEvidenceSearchText(projection.searchText) : "");
    block.eventIds.push(projection.eventId);
    block.timestamps[row] = projection.timestamp;
    block.evidence[row] = evidence ? 1 : 0;
    for (const [facet, inputValue] of Object.entries(projection.facets)) {
      const value = readRowsFacetValue(inputValue, facet);
      let column = columns.get(facet);
      let dictionary = dictionaries.get(facet);
      if (!column || !dictionary) {
        column = { facet, values: [], codes: new Uint16Array(projections.length) };
        dictionary = new Map<string, number>();
        columns.set(facet, column); dictionaries.set(facet, dictionary);
      }
      let code = dictionary.get(value.identity);
      if (code === undefined) {
        column.values.push({ type: value.type, value: value.value, ...(value.label === value.value ? {} : { label: value.label }) });
        code = column.values.length;
        dictionary.set(value.identity, code);
      }
      column.codes[row] = code;
    }
  });
  block.facets = [...columns.values()].sort((left, right) => left.facet.localeCompare(right.facet));
  block.checksum = rowsChecksumV2(block);
  return block;
}

function hasRowsMetadata(projection: SearchProjection): projection is SearchIndexRowsProjection {
  return "eventId" in projection && "timestamp" in projection && "summary" in projection && "facets" in projection;
}

/** Legacy callers can still supply only the three Bloom projection fields.
 * A block with incomplete row metadata is deliberately left without exact rows. */
export function groupSearchRowsProjections(projections: readonly SearchProjection[]): SearchIndexRowsBlock[] {
  const groups = new Map<number, SearchProjection[]>();
  for (const projection of projections) {
    const key = indexBlockStart(projection.sequence);
    const group = groups.get(key);
    if (group) group.push(projection);
    else groups.set(key, [projection]);
  }
  return [...groups.values()].flatMap(group => group.every(hasRowsMetadata) ? [buildRowsBlock(group)] : []);
}

export function mergeSearchIndexRowsBlock(previous: unknown, addition: SearchIndexRowsBlock): SearchIndexRowsBlock {
  readSearchIndexRowsBlock(addition);
  if (previous === undefined) return addition;
  const current = readSearchIndexRowsBlock(previous);
  if (current.sequence !== addition.sequence || current.intervalId !== addition.intervalId || current.lastSequence + 1 !== addition.firstSequence) {
    throw new Error("Noncontiguous exact search block append.");
  }
  const projections = [current, addition].flatMap(block => block.texts.map((searchText, row) => ({
    sequence: block.firstSequence + row, intervalId: block.intervalId, searchText,
    eventId: block.eventIds[row]!, timestamp: block.timestamps[row]!,
    summary: block.evidence[row] === 0 ? "Topology checkpoint" : "Evidence",
    facets: searchIndexRowFacets(block, row)
  })));
  return buildRowsBlock(projections);
}

/** Retention may keep a suffix of the boundary block. Rebuild its dictionaries
 * so removed identities and texts do not remain in the exact search index. */
export function trimSearchIndexRowsBlock(input: SearchIndexRowsBlock, firstSequence: number): SearchIndexRowsBlock | null {
  const block = readSearchIndexRowsBlock(input);
  if (!Number.isSafeInteger(firstSequence) || firstSequence < 1) throw new Error("Invalid exact search retention boundary.");
  if (firstSequence <= block.firstSequence) return block;
  if (firstSequence > block.lastSequence) return null;
  const offset = firstSequence - block.firstSequence;
  return buildRowsBlock(block.texts.slice(offset).map((searchText, index) => {
    const row = offset + index;
    return { sequence: firstSequence + index, intervalId: block.intervalId, searchText,
      eventId: block.eventIds[row]!, timestamp: block.timestamps[row]!,
      summary: block.evidence[row] === 0 ? "Topology checkpoint" : "Evidence", facets: searchIndexRowFacets(block, row) };
  }));
}

export function appendSearchIndexBlocks(store: IDBObjectStore, projections: readonly SearchProjection[]): void {
  const bloomAdditions = groupSearchProjections(projections);
  const rowAdditions = groupSearchRowsProjections(projections);
  for (const addition of bloomAdditions) {
    const request = store.get(addition.sequence);
    request.onsuccess = () => {
      try { store.put(mergeSearchIndexBlock(request.result, addition)); }
      catch { store.transaction.abort(); }
    };
  }
  for (const addition of rowAdditions) {
    const request = store.get(addition.sequence);
    request.onsuccess = () => {
      try { store.put(mergeSearchIndexRowsBlock(request.result, addition)); }
      catch { store.transaction.abort(); }
    };
  }
}
