import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  EVENT_INDEX_BLOCK_SIZE, SEARCH_BLOCK_FILTER_BYTES, appendSearchIndexBlocks, expandFacetPostingBlock,
  facetPostingToken, groupFacetPostings, groupSearchProjections, groupSearchRowsProjections, indexBlockStart,
  mergeFacetPostingBlock, mergeSearchIndexBlock, mergeSearchIndexRowsBlock, readFacetPostingBlock,
  readSearchIndexBlock, readSearchIndexRowsBlock, searchBlockMayContain, searchIndexRowFacets, trimSearchIndexRowsBlock,
  type SearchIndexRowsBlock, type SearchIndexRowsProjection
} from "../src/core/indexeddb/event-index-blocks";
import { normalizeEvidenceSearchText } from "../src/core/evidence-facets";
import { typedFacetValue } from "../src/core/evidence-filter-contract";

const projection = (sequence: number, searchText: string, intervalId = "interval") => ({ sequence, searchText, intervalId });
const exactProjection = (sequence: number, overrides: Partial<SearchIndexRowsProjection> = {}): SearchIndexRowsProjection => ({
  sequence, intervalId: "interval", eventId: `event-${sequence}`, timestamp: 1_700_000_000_000 + sequence,
  summary: "Item Update", searchText: `value-${sequence}`, facets: {}, ...overrides
});

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Transaction failed."));
  });
}

async function indexDatabase(): Promise<IDBDatabase> {
  const request = new IDBFactory().open("search-index-test", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("searchBlocks", { keyPath: "sequence" });
  return await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

async function storedBlocks(database: IDBDatabase): Promise<unknown[]> {
  const transaction = database.transaction("searchBlocks", "readonly");
  const result = transaction.objectStore("searchBlocks").getAll();
  await transactionDone(transaction);
  return result.result;
}

describe("bounded history indexes", () => {
  it("preserves exact facet identities and observations across batch and block boundaries", () => {
    const identity = JSON.stringify(["v1", "key", "string", 'key-["nested"]-😀']);
    const posting = (sequence: number) => ({ token: facetPostingToken(identity), sequence, intervalId: "interval", eventId: `event-${sequence}`, facet: "key", facetIdentity: identity });
    const first = groupFacetPostings([posting(250), posting(256)])[0]!;
    const later = groupFacetPostings([posting(257), posting(300)]);
    expect(later).toHaveLength(1);
    expect(later[0]!.sequence).toBe(257);
    const merged = mergeFacetPostingBlock(groupFacetPostings([posting(1)])[0], first);
    expect(expandFacetPostingBlock(structuredClone(merged))).toEqual([posting(1), posting(250), posting(256)]);
    expect(() => mergeFacetPostingBlock(first, first)).toThrow(/Overlapping/);
    expect(() => mergeFacetPostingBlock(first, later[0]!)).toThrow(/Overlapping/);
    expect(() => readFacetPostingBlock({ ...first, observations: [[256, "event"], [255, "other"]] })).toThrow();
    expect(() => readFacetPostingBlock({ ...first, token: "wrong" })).toThrow();
  });

  it("never excludes normalized substrings, including whitespace, Unicode and partial surrogate pairs", () => {
    const text = " LONG-identifier-0123456789\t aB😀CD\n  Café  東京🔎X e\u0301 ";
    const block = readSearchIndexBlock(structuredClone(groupSearchProjections([projection(1, text)])[0]));
    const normalized = normalizeEvidenceSearchText(text);
    for (let start = 0; start < normalized.length; start++) {
      for (let end = start + 1; end <= normalized.length; end++) {
        expect(searchBlockMayContain(block, normalized.slice(start, end)), `${start}:${end}`).toBe(true);
      }
    }
    expect(searchBlockMayContain(block, "Café   東京")).toBe(true);
    expect(searchBlockMayContain(block, "ZZZ-absent-string")).toBe(false);
  });

  it("bounds text indexing independently of text size and merges every appended trigram", () => {
    const text = Array.from({ length: 20000 }, (_, i) => String.fromCharCode(32 + i % 250, 32 + (i * 17) % 300, 32 + i % 197)).join("");
    const first = groupSearchProjections([projection(127, text)])[0]!;
    const next = groupSearchProjections([projection(128, "unique later token 東京")])[0]!;
    const merged = readSearchIndexBlock(structuredClone(mergeSearchIndexBlock(first, next)));
    expect(merged.bloom.byteLength).toBe(SEARCH_BLOCK_FILTER_BYTES);
    expect(merged).toMatchObject({ sequence: 1, firstSequence: 127, lastSequence: 128 });
    for (let offset = 0; offset < text.length - 16; offset += 97) expect(searchBlockMayContain(merged, text.slice(offset, offset + 16))).toBe(true);
    expect(searchBlockMayContain(merged, "later token 東京")).toBe(true);
    expect(() => mergeSearchIndexBlock(merged, next)).toThrow(/Noncontiguous/);
    expect(() => mergeSearchIndexBlock(first, groupSearchProjections([projection(129, "gap")])[0]!)).toThrow(/Noncontiguous/);
    expect(() => mergeSearchIndexBlock(first, { ...next, intervalId: "other" })).toThrow();
  });

  it("rejects malformed and damaged filters instead of silently omitting Find matches", () => {
    const block = groupSearchProjections([projection(256, "needle")])[0]!;
    expect(indexBlockStart(256)).toBe(1);
    expect(indexBlockStart(257)).toBe(257);
    expect(() => indexBlockStart(0)).toThrow();
    expect(() => readSearchIndexBlock({ ...block, sequence: 2 })).toThrow();
    expect(() => readSearchIndexBlock({ ...block, lastSequence: EVENT_INDEX_BLOCK_SIZE + 1 })).toThrow();
    expect(() => readSearchIndexBlock({ ...block, bloom: new Uint8Array(16) })).toThrow();
    expect(() => readSearchIndexBlock({ ...block, bloom: [] })).toThrow();
    const corrupted = structuredClone(block);
    corrupted.bloom[0]! ^= 1;
    expect(() => readSearchIndexBlock(corrupted)).toThrow(/Corrupt/);
  });

  it("stores exact normalized rows, excludes checkpoints and preserves typed facet identities", () => {
    const text = " LONG-identifier\t aB😀CD\n Café 東京 e\u0301 \ud800 ";
    const stringKey = typedFacetValue("key", "string", "7", "String seven");
    const numberKey = typedFacetValue("key", "number", "7", "Number seven");
    const session = typedFacetValue("session", "string", 'client-A/session-["owned"]');
    const block = readSearchIndexRowsBlock(structuredClone(groupSearchRowsProjections([
      exactProjection(1, { searchText: text, facets: { key: stringKey, session } }),
      exactProjection(2, { facets: { key: numberKey, session: { ...session } } }),
      exactProjection(3, { facets: { key: { ...stringKey, label: "Same typed identity" } } }),
      exactProjection(4, { summary: "Topology checkpoint", searchText: "checkpoint must not match", timestamp: 0 })
    ])[0]!));
    expect(block).toMatchObject({ sequence: -1, firstSequence: 1, lastSequence: 4, version: 1 });
    expect(block.texts).toEqual([normalizeEvidenceSearchText(text), "value-2", "value-3", ""]);
    expect([...block.evidence]).toEqual([1, 1, 1, 0]);
    expect([...block.timestamps]).toEqual([1_700_000_000_001, 1_700_000_000_002, 1_700_000_000_003, 0]);
    expect(block.facets.find(column => column.facet === "key")?.values).toEqual([stringKey, numberKey]);
    expect(block.facets.find(column => column.facet === "session")?.values).toHaveLength(1);
    expect(searchIndexRowFacets(block, 0)).toEqual({ key: stringKey, session });
    expect(searchIndexRowFacets(block, 1, ["key"])).toEqual({ key: numberKey });
    expect(searchIndexRowFacets(block, 2, ["session"])).toEqual({});
    expect(searchIndexRowFacets(block, 0, [])).toEqual({});
    expect(() => searchIndexRowFacets(block, 4)).toThrow();
    expect(() => searchIndexRowFacets(block, -1)).toThrow();
    expect(Object.keys(block)).not.toContain("payload");
    expect(Object.keys(block)).not.toContain("summary");
  });

  it("bounds exact rows at block edges and merges partial appends without losing facet dictionaries", () => {
    const first = groupSearchRowsProjections([
      exactProjection(254, { facets: { key: typedFacetValue("key", "string", "A") } }),
      exactProjection(255, { facets: { key: typedFacetValue("key", "string", "B") } })
    ])[0]!;
    const next = groupSearchRowsProjections([
      exactProjection(256, { facets: { key: typedFacetValue("key", "string", "A") } }), exactProjection(257)
    ]);
    expect(next.map(block => block.sequence)).toEqual([-1, -257]);
    const merged = readSearchIndexRowsBlock(structuredClone(mergeSearchIndexRowsBlock(first, next[0]!)));
    expect(merged.eventIds).toEqual(["event-254", "event-255", "event-256"]);
    expect(merged.facets[0]!.values).toHaveLength(2);
    expect([...merged.facets[0]!.codes]).toEqual([1, 2, 1]);
    expect(() => mergeSearchIndexRowsBlock(merged, next[0]!)).toThrow(/Noncontiguous/);
    expect(() => mergeSearchIndexRowsBlock(first, next[1]!)).toThrow(/Noncontiguous/);
    expect(() => groupSearchRowsProjections([exactProjection(1), exactProjection(3)])).toThrow();
    expect(() => groupSearchRowsProjections([exactProjection(1), exactProjection(2, { intervalId: "other" })])).toThrow();
    const all = groupSearchRowsProjections(Array.from({ length: 257 }, (_, row) => exactProjection(row + 1)));
    expect(all.map(block => block.texts.length)).toEqual([EVENT_INDEX_BLOCK_SIZE, 1]);
  });

  it("trims retained suffixes without leaving removed exact text, event ids or facet identities", () => {
    const block = groupSearchRowsProjections([
      exactProjection(11, { searchText: "removed-secret", facets: { key: typedFacetValue("key", "string", "removed-key") } }),
      exactProjection(12, { facets: { key: typedFacetValue("key", "string", "retained-key") } }),
      exactProjection(13)
    ])[0]!;
    const trimmed = readSearchIndexRowsBlock(structuredClone(trimSearchIndexRowsBlock(block, 12)!));
    expect(trimmed).toMatchObject({ sequence: -1, firstSequence: 12, lastSequence: 13 });
    expect(trimmed.eventIds).toEqual(["event-12", "event-13"]);
    expect(trimmed.texts).toEqual(["value-12", "value-13"]);
    expect(trimmed.facets[0]!.values.map(value => value.value)).toEqual(["retained-key"]);
    expect([...trimmed.facets[0]!.codes]).toEqual([1, 0]);
    expect(trimSearchIndexRowsBlock(block, 1)).toBe(block);
    expect(trimSearchIndexRowsBlock(block, 14)).toBeNull();
    expect(() => trimSearchIndexRowsBlock(block, 0)).toThrow();
    expect(block.texts[0]).toBe("removed-secret");
  });

  it("fails closed on damaged exact row fields, typed arrays, dictionary values and codes", () => {
    const block = groupSearchRowsProjections([
      exactProjection(1, { facets: { key: typedFacetValue("key", "string", "A") } }), exactProjection(2)
    ])[0]!;
    const mutate = (change: (value: SearchIndexRowsBlock) => void) => {
      const value = structuredClone(block); change(value);
      expect(() => readSearchIndexRowsBlock(value)).toThrow();
    };
    mutate(value => { value.texts[0] = "different"; });
    mutate(value => { value.eventIds[0] = "other-event"; });
    mutate(value => { value.timestamps[0]! += 1; });
    mutate(value => { value.evidence[1] = 0; value.texts[1] = ""; });
    mutate(value => { value.facets[0]!.codes[1] = 1; });
    mutate(value => { value.facets[0]!.codes[1] = 2; });
    mutate(value => { value.facets[0]!.values[0] = typedFacetValue("key", "string", "changed"); });
    mutate(value => { value.intervalId = "other"; });
    mutate(value => { value.firstSequence = 2; value.lastSequence = 3; });
    expect(() => readSearchIndexRowsBlock({ ...block, extra: true })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, version: 2 })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, sequence: 1 })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, eventIds: ["only-one"] })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, timestamps: new Float32Array(2) })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, evidence: [1, 1] })).toThrow();
    expect(() => readSearchIndexRowsBlock({ ...block, checksum: undefined })).toThrow();
    expect(() => groupSearchRowsProjections([exactProjection(1, { timestamp: Number.NaN })])).toThrow();
  });

  it("keeps the version-one checksum stable across optimized UTF-16 hashing", () => {
    const block = groupSearchRowsProjections([exactProjection(1, {
      searchText: " AB😀C café\t東京 ", facets: { key: typedFacetValue("key", "string", "7", "Seven") }
    })])[0]!;
    expect(block.checksum).toBe(414_961_847);
    const roundTripped = readSearchIndexRowsBlock(structuredClone(block));
    expect(roundTripped.checksum).toBe(block.checksum);
    expect(roundTripped.texts).toEqual(block.texts);
  });

  it("keeps legacy Bloom-only input valid and exposes partial exact coverage after a legacy append", async () => {
    expect(groupSearchRowsProjections([projection(1, "legacy")])).toEqual([]);
    expect(groupSearchRowsProjections([exactProjection(1), projection(2, "legacy")])).toEqual([]);
    const database = await indexDatabase();
    try {
      let transaction = database.transaction("searchBlocks", "readwrite");
      appendSearchIndexBlocks(transaction.objectStore("searchBlocks"), [projection(1, "legacy")]);
      await transactionDone(transaction);
      expect(await storedBlocks(database)).toHaveLength(1);
      transaction = database.transaction("searchBlocks", "readwrite");
      appendSearchIndexBlocks(transaction.objectStore("searchBlocks"), [exactProjection(2)]);
      await transactionDone(transaction);
      const stored = await storedBlocks(database) as Array<{ sequence: number }>;
      const bloom = readSearchIndexBlock(stored.find(value => value.sequence === 1));
      const exact = readSearchIndexRowsBlock(stored.find(value => value.sequence === -1));
      expect(bloom).toMatchObject({ firstSequence: 1, lastSequence: 2 });
      expect(exact).toMatchObject({ firstSequence: 2, lastSequence: 2 });
      expect(exact.eventIds).toEqual(["event-2"]);
    } finally { database.close(); }
  });

  it("atomically writes both index records and aborts both on a corrupt existing exact block", async () => {
    const database = await indexDatabase();
    try {
      let transaction = database.transaction("searchBlocks", "readwrite");
      appendSearchIndexBlocks(transaction.objectStore("searchBlocks"), [exactProjection(1), exactProjection(2)]);
      await transactionDone(transaction);
      transaction = database.transaction("searchBlocks", "readwrite");
      appendSearchIndexBlocks(transaction.objectStore("searchBlocks"), [exactProjection(3)]);
      await transactionDone(transaction);
      let stored = await storedBlocks(database) as Array<{ sequence: number }>;
      const exact = readSearchIndexRowsBlock(stored.find(value => value.sequence === -1));
      expect(exact.eventIds).toEqual(["event-1", "event-2", "event-3"]);
      const damaged = structuredClone(exact);
      damaged.texts[0] = "damage without checksum";
      transaction = database.transaction("searchBlocks", "readwrite");
      transaction.objectStore("searchBlocks").put(damaged);
      await transactionDone(transaction);
      transaction = database.transaction("searchBlocks", "readwrite");
      appendSearchIndexBlocks(transaction.objectStore("searchBlocks"), [exactProjection(4)]);
      await expect(transactionDone(transaction)).rejects.toThrow();
      stored = await storedBlocks(database) as Array<{ sequence: number }>;
      expect(readSearchIndexBlock(stored.find(value => value.sequence === 1)).lastSequence).toBe(3);
      expect(stored.find(value => value.sequence === -1)).toEqual(damaged);
    } finally { database.close(); }
  });
});
