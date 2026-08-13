import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("release packaging verification gate", () => {
  it("isolates the fake-IndexedDB suites while keeping the release gate serial", () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const packageScript = readFileSync(join(projectRoot, "scripts/package-extension.mjs"), "utf8");

    expect(packageJson.scripts.test).toBe("node scripts/test-unit.mjs");
    expect(packageJson.scripts["test:release"]).toBe(
      "vitest run --no-file-parallelism --maxWorkers=1"
    );

    const serialGate = 'run("npm", ["run", "test:release"]);';
    const buildGate = 'run("npm", ["run", "build"]);';
    const serialIndex = packageScript.indexOf(serialGate);
    const buildIndex = packageScript.indexOf(buildGate);

    expect(serialIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(serialIndex);
    expect(packageScript).toContain("if (result.status !== 0)");

    const testRunner = readFileSync(join(projectRoot, "scripts/test-unit.mjs"), "utf8");
    expect(testRunner).toContain("discoverTestFiles");
    expect(testRunner).toContain("validatePlan");
    expect(testRunner).toContain('"tests/authoritative-event-history-indexeddb.test.ts"');
    expect(testRunner).toContain('"tests/history-impl-09-lifecycle-blockers.test.ts"');
    expect(testRunner).toContain('"--no-file-parallelism", "--maxWorkers=1"');
    expect(testRunner).toContain("if (ordinaryStatus !== 0) process.exit(ordinaryStatus);");
    expect(testRunner).toContain("process.exit(isolatedStatus);");
  });

  it("discovers a complete disjoint two-phase test plan", () => {
    const result = spawnSync(process.execPath, [join(projectRoot, "scripts/test-unit.mjs"), "--print-plan"], {
      cwd: projectRoot,
      encoding: "utf8"
    });
    expect(result.status, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout) as { ordinary: string[]; isolated: string[] };
    expect(plan.ordinary).toHaveLength(71);
    expect(plan.isolated).toEqual([
      "tests/authoritative-event-history-contract.test.ts",
      "tests/authoritative-event-history-indexeddb.test.ts",
      "tests/event-history-admission-performance.test.ts",
      "tests/history-impl-05-capacity.test.ts",
      "tests/history-impl-08-lifecycle.test.ts",
      "tests/history-impl-09-lifecycle-blockers.test.ts",
      "tests/filter-impl-07-failure-cleanup.test.ts",
      "tests/filter-impl-07-postings.test.ts",
      "tests/filter-impl-07-schema.test.ts"
    ]);
    expect(new Set([...plan.ordinary, ...plan.isolated]).size).toBe(80);
  });
});
