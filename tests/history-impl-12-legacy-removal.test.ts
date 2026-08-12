import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : resolve(process.cwd());
const legacyModules = [
  "src/core/event-store.ts",
  "src/core/event-repository.ts",
  "src/core/event-history.ts",
  "src/core/indexeddb/event-db.ts",
  "tests/event-store.test.ts",
  "tests/event-history.test.ts"
] as const;

const migratedConsumers = [
  "scripts/generate-store-listing-assets.mjs",
  "benchmarks/topology-performance-harness.ts",
  "benchmarks/workbench-runtime-high-volume.bench.ts",
  "benchmarks/event-history-indexeddb.bench.ts"
] as const;

describe("history-impl-12 legacy EventStore contraction", () => {
  it("removes the legacy modules and their obsolete behavioral tests", () => {
    for (const relativePath of legacyModules) {
      expect(existsSync(resolve(root, relativePath)), relativePath).toBe(false);
    }
  });

  it("keeps every remaining tooling consumer on the authoritative contract", () => {
    for (const relativePath of migratedConsumers) {
      const source = readFileSync(resolve(root, relativePath), "utf8");
      expect(source, relativePath).toMatch(/event-history-(authoritative|indexeddb)/u);
      expect(source, relativePath).not.toContain("src/core/event-history.ts");
      expect(source, relativePath).not.toContain("src/core/event-store");
      expect(source, relativePath).not.toContain("src/core/event-repository");
      expect(source, relativePath).not.toContain("indexeddb/event-db");
      expect(source, relativePath).not.toContain("EventStore");
      expect(source, relativePath).not.toContain("EventRepository");
      expect(source, relativePath).not.toContain(".toPromise()");
    }
  });
});
