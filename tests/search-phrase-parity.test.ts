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
    intervalId: "phrase-parity",
    eventId: `event-${sequence}`,
    timestamp: sequence,
    summary,
    searchText,
    facets: {}
  };
}

describe("short phrase matcher parity", () => {
  it("matches normalized whole-row includes semantics for boundary and Unicode cases", () => {
    const originals = [
      "overlap aaa aaa aaaa",
      "prefix-middle-suffix whole middle exact",
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho",
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen",
      "Café cafe\u0301 東京 😀x \ud83d\ude00tail e\u0301x",
      "ends with alpha",
      "beta starts here",
      "",
      "ignored checkpoint text"
    ];
    const block = readSearchIndexRowsBlock(groupSearchRowsProjections([
      ...originals.map((text, index) => row(index + 1, text, index === 8 ? "Topology checkpoint" : "Item Update"))
    ])[0]!);
    const normalizedRows = originals.map((text, index) => index === 8 ? "" : normalizeEvidenceSearchText(text));
    expect(originals.map((_text, index) => searchIndexRowText(block, index))).toEqual(normalizedRows);

    const queries = [
      "aaa aaa", "aa aaa", "aaaa aa", "prefix-middle", "middle-suffix", "whole middle exact",
      "middle exact", "exact", "pha midd", "midd suff", "alpha middle", "middle omicron",
      "alpha beta gamma", "beta gamma delta", "alpha absent", "absent phrase",
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi",
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen",
      "CAFÉ", "cafe\u0301", "café cafe\u0301", "東京 😀", "x \ud83d", "\ude00tail", "e\u0301x", "éx",
      "alpha beta", "beta gamma", "not-present"
    ];

    let comparisons = 0;
    for (const query of queries) {
      const needle = normalizeEvidenceSearchText(query);
      const matches = searchIndexRowTextMatcher(block, query);
      for (let index = 0; index < normalizedRows.length; index++) {
        expect(matches(index), `normalized query=${JSON.stringify(needle)} row=${index}`)
          .toBe(normalizedRows[index]!.includes(needle));
        comparisons++;
      }
    }

    // The phrase spans two rows only if a matcher incorrectly carries tokens
    // between row offsets. Each individual normalized row lacks the phrase.
    const acrossBoundary = searchIndexRowTextMatcher(block, "alpha beta");
    expect(acrossBoundary(5)).toBe(false);
    expect(acrossBoundary(6)).toBe(false);
    expect(comparisons).toBe(queries.length * originals.length);
  });

  it("keeps single-token matching and raw canonical Filter whitespace significant", () => {
    const originals = ["  Alpha\tBeta  repeat repeat  café ", "alpha beta", ""];
    const block = readSearchIndexRowsBlock(groupSearchRowsProjections([
      row(1, originals[0]!), row(2, originals[1]!), row(3, "checkpoint", "Topology checkpoint")
    ])[0]!);
    const normalizedRows = [normalizeEvidenceSearchText(originals[0]!), normalizeEvidenceSearchText(originals[1]!), ""];

    const singleTokenQueries = ["ALP", "peat", "fé", "absent"];
    for (const query of singleTokenQueries) {
      const needle = normalizeEvidenceSearchText(query);
      const matches = searchIndexRowTextMatcher(block, query);
      normalizedRows.forEach((text, index) => {
        expect(matches(index), `single token=${JSON.stringify(needle)} row=${index}`).toBe(text.includes(needle));
      });
    }

    // Filter canonicalization trims and lowercases before calling the matcher,
    // while preserving each internal whitespace code point and its count.
    const rawFilterInputs = ["  ALPHA  BETA  ", " Alpha\tBeta ", "ALPHA beta"];
    for (const input of rawFilterInputs) {
      const canonicalText = input.trim().toLowerCase();
      const matches = searchIndexRowTextMatcher(block, canonicalText, false);
      normalizedRows.forEach((text, index) => {
        expect(matches(index), `raw Filter text=${JSON.stringify(canonicalText)} row=${index}`)
          .toBe(text.includes(canonicalText));
      });
    }

    expect(searchIndexRowTextMatcher(block, "", false)(2)).toBe(true);
    expect(searchIndexRowTextMatcher(block, "hidden", false)(2)).toBe(false);
  });

  it("uses the same oracle over a bounded deterministic generated corpus", () => {
    const words = ["repeat", "repeated", "pre-repeat", "東京", "😀x", "e\u0301", "plain"];
    const originals = Array.from({ length: 24 }, (_unused, index) => {
      const count = 1 + index % 7;
      return Array.from({ length: count }, (_word, offset) => words[(index * 3 + offset * 5) % words.length]!).join(offsetSpace(index));
    });
    const block = readSearchIndexRowsBlock(groupSearchRowsProjections(originals.map((text, index) => row(index + 1, text)))[0]!);
    const normalizedRows = originals.map(normalizeEvidenceSearchText);
    const queries = ["repeat", "repeat repeated", "東京 😀", "😀", "e\u0301 plain", "plain repeat", "re", "absent pair"];

    for (const query of queries) {
      const needle = normalizeEvidenceSearchText(query);
      const matches = searchIndexRowTextMatcher(block, query);
      normalizedRows.forEach((text, index) => {
        expect(matches(index), `generated query=${JSON.stringify(needle)} row=${index}`).toBe(text.includes(needle));
      });
    }
  });
});

function offsetSpace(index: number): string {
  return index % 3 === 0 ? " " : index % 3 === 1 ? "\t" : "  ";
}
