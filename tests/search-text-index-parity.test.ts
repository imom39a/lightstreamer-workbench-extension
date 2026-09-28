import { describe, expect, it } from "vitest";
import {
  groupSearchRowsProjections,
  readSearchIndexRowsBlock,
  searchIndexRowText,
  searchIndexRowTextMatcher,
  type SearchIndexRowsProjection
} from "../src/core/indexeddb/event-index-blocks";
import { normalizeEvidenceSearchText } from "../src/core/evidence-facets";

function row(sequence: number, searchText: string, summary = "Item Update"): SearchIndexRowsProjection {
  return {
    sequence,
    intervalId: "parity-review",
    eventId: `event-${sequence}`,
    timestamp: sequence,
    summary,
    searchText,
    facets: {}
  };
}

describe("version-three exact search text parity", () => {
  it("reconstructs rows and matches native normalized substring semantics", () => {
    const originals = [
      "",
      " \t\n ",
      "  Café\t東京  repeat repeat café  ",
      "Prefix-middle-Suffix across words",
      "astral 😀 characters and e\u0301 combining",
      "absent-text row"
    ];
    const block = readSearchIndexRowsBlock(groupSearchRowsProjections([
      ...originals.map((searchText, index) => row(index + 1, searchText)),
      row(7, "checkpoint must remain hidden", "Topology checkpoint")
    ])[0]!);

    expect(originals.map((_text, index) => searchIndexRowText(block, index)))
      .toEqual(originals.map(normalizeEvidenceSearchText));
    expect(searchIndexRowText(block, 6)).toBe("");

    const queries = [
      "", "  \t\n", "café", "Café", "af", "京", "repeat repeat", "repeat café", "e\u0301",
      "prefix-middle", "middle-Suffix", "words across", "suffix across", "middle-suffix ac", "fix-middle-Suf", "😀 char", "combining",
      "not-present", "absent-text", "row"
    ];
    for (const query of queries) {
      const expectedQuery = normalizeEvidenceSearchText(query);
      const matches = searchIndexRowTextMatcher(block, query);
      for (let index = 0; index < originals.length; index++) {
        expect(matches(index), `query=${JSON.stringify(query)} row=${index}`)
          .toBe(normalizeEvidenceSearchText(originals[index]!).includes(expectedQuery));
      }
      expect(matches(6), `checkpoint query=${JSON.stringify(query)}`)
        .toBe("".includes(expectedQuery));
    }
  });

  it("uses Uint32 codes above 65,535 distinct tokens and rejects malformed encoded fields", () => {
    const original = Array.from({ length: 65_536 }, (_unused, index) => `token${index.toString(16)}`).join(" ");
    const block = readSearchIndexRowsBlock(groupSearchRowsProjections([row(1, original)])[0]!);
    expect(block.textDictionary).toHaveLength(65_536);
    expect(block.textCodes).toBeInstanceOf(Uint32Array);
    expect(searchIndexRowText(block, 0)).toBe(normalizeEvidenceSearchText(original));

    const queries = ["token0", "tokenffff", "tokenfffe", "tokenffff token0", "missing-token"];
    for (const query of queries) {
      expect(searchIndexRowTextMatcher(block, query)(0))
        .toBe(normalizeEvidenceSearchText(original).includes(normalizeEvidenceSearchText(query)));
    }

    const malformedOffset = structuredClone(block);
    malformedOffset.textOffsets![1] = malformedOffset.textOffsets![1]! - 1;
    expect(() => readSearchIndexRowsBlock(malformedOffset)).toThrow();

    const malformedCode = structuredClone(block);
    malformedCode.textCodes![0] = malformedCode.textDictionary!.length;
    expect(() => readSearchIndexRowsBlock(malformedCode)).toThrow();

    const malformedToken = structuredClone(block);
    malformedToken.textDictionary![0] = "changed-token";
    expect(() => readSearchIndexRowsBlock(malformedToken)).toThrow();

    const malformedChecksum = structuredClone(block);
    malformedChecksum.checksum ^= 1;
    expect(() => readSearchIndexRowsBlock(malformedChecksum)).toThrow();
  });
});
