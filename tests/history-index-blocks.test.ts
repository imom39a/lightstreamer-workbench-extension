import { describe, expect, it } from "vitest";
import {
  EVENT_INDEX_BLOCK_SIZE, SEARCH_BLOCK_FILTER_BYTES, expandFacetPostingBlock,
  facetPostingToken, groupFacetPostings, groupSearchProjections, indexBlockStart,
  mergeFacetPostingBlock, mergeSearchIndexBlock, readFacetPostingBlock,
  readSearchIndexBlock, searchBlockMayContain
} from "../src/core/indexeddb/event-index-blocks";
import { normalizeEvidenceSearchText } from "../src/core/evidence-facets";

const projection = (sequence: number, searchText: string, intervalId = "interval") => ({ sequence, searchText, intervalId });

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
});
