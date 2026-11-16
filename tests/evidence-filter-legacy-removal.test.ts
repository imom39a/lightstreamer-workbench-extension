import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(testDirectory, "../src");

function productionSource(): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  visit(sourceRoot);
  return files.sort().map((path) => readFileSync(path, "utf8")).join("\n");
}

describe("filter-impl-15 legacy contraction", () => {
  it("keeps one canonical typed Filter production path", () => {
    const source = productionSource();
    expect(existsSync(join(sourceRoot, "core/event-filter.ts"))).toBe(false);
    for (const obsolete of [
      "EventFilterState",
      "LegacyScalarFilter",
      "canonicalFilterFromLegacyScalars",
      "legacyFilterOperations",
      "replace-filter",
      'type: "set-filters"',
      'type: "clear-filters"',
      "matchesEventFilters",
      "filterEvents",
      "hasActiveFilters",
      "createEventSearchText",
      "legacy:item-position",
      "legacyFiltersFromEvidenceFilter",
      "query.filters",
      "exactFacetQueryTokens",
      "facetTokens"
    ]) {
      expect(source, obsolete).not.toContain(obsolete);
    }
  });

  it("does not keep a renderer-owned Find rescan or full-history filter read", () => {
    const runtime = readFileSync(join(sourceRoot, "extension/panel/workbench-runtime.ts"), "utf8");
    const history = readFileSync(join(sourceRoot, "core/event-history-authoritative.ts"), "utf8");
    const indexedDb = readFileSync(join(sourceRoot, "core/event-history-indexeddb.ts"), "utf8");
    expect(runtime).not.toContain("findMatchIndexes");
    expect(runtime).not.toContain("findResultEvents");
    expect(runtime).not.toContain("this.findEvidence");
    expect(history).not.toContain("filters?:");
    expect(history).not.toContain("matchesCandidateFilters");
    expect(indexedDb).not.toContain("hasCompleteExactFacetPredicates");
  });
});
