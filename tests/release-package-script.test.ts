import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";
import { tmpdir as systemTmpdir } from "node:os";

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
    expect(plan.ordinary).toHaveLength(74);
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
    expect(new Set([...plan.ordinary, ...plan.isolated]).size).toBe(83);
  });

  it("writes deterministic raw-DEFLATE entries with valid headers and contents", () => {
    const output = mkdtempSync(join(systemTmpdir(), "lsew-package-test-"));
    try {
      const first = spawnSync(process.execPath, [join(projectRoot, "scripts/package-extension.mjs"), "--skip-tests", "--skip-typecheck", "--skip-build", "--out-dir", output], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      expect(first.status, first.stderr).toBe(0);
      const zipPath = join(output, "lightstreamer-workbench-v2.0.0.zip");
      const firstBytes = readFileSync(zipPath);
      const second = spawnSync(process.execPath, [join(projectRoot, "scripts/package-extension.mjs"), "--skip-tests", "--skip-typecheck", "--skip-build", "--out-dir", output], {
        cwd: projectRoot,
        encoding: "utf8"
      });
      expect(second.status, second.stderr).toBe(0);
      const secondBytes = readFileSync(zipPath);
      expect(createHash("sha256").update(secondBytes).digest("hex")).toBe(createHash("sha256").update(firstBytes).digest("hex"));
      expect(statSync(zipPath).size).toBeLessThan(1_048_576);

      const names: string[] = [];
      let offset = 0;
      let centralOffset = -1;
      while (offset + 4 <= secondBytes.length) {
        const signature = secondBytes.readUInt32LE(offset);
        if (signature === 0x04034b50) {
          expect(secondBytes.readUInt16LE(offset + 8)).toBe(8);
          expect(secondBytes.readUInt16LE(offset + 6)).toBe(0);
          const compressedSize = secondBytes.readUInt32LE(offset + 18);
          const uncompressedSize = secondBytes.readUInt32LE(offset + 22);
          const nameLength = secondBytes.readUInt16LE(offset + 26);
          const extraLength = secondBytes.readUInt16LE(offset + 28);
          const name = secondBytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
          const compressed = secondBytes.subarray(offset + 30 + nameLength + extraLength, offset + 30 + nameLength + extraLength + compressedSize);
          const content = inflateRawSync(compressed);
          expect(content.byteLength).toBe(uncompressedSize);
          names.push(name);
          offset += 30 + nameLength + extraLength + compressedSize;
          continue;
        }
        if (signature === 0x02014b50) {
          centralOffset = offset;
          break;
        }
        throw new Error(`Unexpected ZIP signature at ${offset}: ${signature.toString(16)}`);
      }
      expect(centralOffset).toBeGreaterThan(0);
      expect(names).toContain("manifest.json");
      expect(names).toContain("icons/title-icon.svg");
      expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)));
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});
