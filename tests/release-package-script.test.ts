import { readFileSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { join, relative } from "node:path";
import { tmpdir as systemTmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function discoverUnitTestFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverUnitTestFiles(path);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [relative(projectRoot, path).replaceAll("\\", "/")] : [];
  }).sort();
}

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
    expect(testRunner).toContain('"tests/filter-impl-09-indexeddb-discovery.test.ts"');
    expect(testRunner).toContain('"tests/filter-impl-09-indexeddb-parity.test.ts"');
    expect(testRunner).toContain('"tests/filter-impl-09-indexeddb-workload.test.ts"');
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
    expect(plan.isolated).toEqual(expect.arrayContaining([
      "tests/authoritative-event-history-contract.test.ts",
      "tests/authoritative-event-history-indexeddb.test.ts",
      "tests/event-history-admission-performance.test.ts",
      "tests/history-impl-05-capacity.test.ts",
      "tests/history-impl-08-lifecycle.test.ts",
      "tests/history-impl-09-lifecycle-blockers.test.ts",
      "tests/filter-impl-07-failure-cleanup.test.ts",
      "tests/filter-impl-07-postings.test.ts",
      "tests/filter-impl-07-schema.test.ts",
      "tests/filter-impl-09-indexeddb-discovery.test.ts",
      "tests/filter-impl-09-indexeddb-parity.test.ts",
      "tests/filter-impl-09-indexeddb-workload.test.ts"
     ]));
    const discovered = discoverUnitTestFiles(join(projectRoot, "tests"));
    expect(plan.ordinary).toHaveLength(discovered.length - plan.isolated.length);
    expect(new Set([...plan.ordinary, ...plan.isolated])).toEqual(new Set(discovered));
     expect(new Set(plan.isolated).size).toBe(plan.isolated.length);
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
          expect(secondBytes.readUInt16LE(offset + 6)).toBe(0x800);
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
      expect(names).toEqual([...names].sort(compareCodePoints));
      expect(packageScript()).toContain("compareArchiveNames");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });

  it("proves central-directory, EOCD, UTF-8, CRC, path, and local parity", () => {
    const output = mkdtempSync(join(systemTmpdir(), "lsew-package-integrity-"));
    try {
      const result = spawnSync(process.execPath, [join(projectRoot, "scripts/package-extension.mjs"), "--skip-tests", "--skip-typecheck", "--skip-build", "--out-dir", output], { cwd: projectRoot, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      const bytes = readFileSync(join(output, "lightstreamer-workbench-v2.0.0.zip"));
      const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      expect(eocd).toBeGreaterThan(0);
      const count = bytes.readUInt16LE(eocd + 10);
      const centralSize = bytes.readUInt32LE(eocd + 12);
      const centralOffset = bytes.readUInt32LE(eocd + 16);
      expect(centralOffset + centralSize).toBe(eocd);
      const central = new Map<string, { crc: number; compressedSize: number; uncompressedSize: number; method: number; flags: number; offset: number }>();
      let cursor = centralOffset;
      for (let index = 0; index < count; index += 1) {
        expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
        const nameLength = bytes.readUInt16LE(cursor + 28);
        const extraLength = bytes.readUInt16LE(cursor + 30);
        const commentLength = bytes.readUInt16LE(cursor + 32);
        const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
        expect(bytes.readUInt16LE(cursor + 8) & 0x800).toBe(0x800);
        expect(name).not.toMatch(/(^|\/)\.\.?($|\/)|\.\./u);
        expect(central.has(name)).toBe(false);
        central.set(name, { flags: bytes.readUInt16LE(cursor + 8), method: bytes.readUInt16LE(cursor + 10), crc: bytes.readUInt32LE(cursor + 16), compressedSize: bytes.readUInt32LE(cursor + 20), uncompressedSize: bytes.readUInt32LE(cursor + 24), offset: bytes.readUInt32LE(cursor + 42) });
        cursor += 46 + nameLength + extraLength + commentLength;
      }
      expect(cursor).toBe(eocd);
      for (const [name, entry] of central) {
        expect(bytes.readUInt32LE(entry.offset)).toBe(0x04034b50);
        const localNameLength = bytes.readUInt16LE(entry.offset + 26);
        const localExtraLength = bytes.readUInt16LE(entry.offset + 28);
        expect(bytes.subarray(entry.offset + 30, entry.offset + 30 + localNameLength).toString("utf8")).toBe(name);
        expect(bytes.readUInt16LE(entry.offset + 6)).toBe(entry.flags);
        expect(bytes.readUInt16LE(entry.offset + 8)).toBe(entry.method);
        expect(bytes.readUInt32LE(entry.offset + 14)).toBe(entry.crc);
        expect(bytes.readUInt32LE(entry.offset + 18)).toBe(entry.compressedSize);
        expect(bytes.readUInt32LE(entry.offset + 22)).toBe(entry.uncompressedSize);
        const compressed = bytes.subarray(entry.offset + 30 + localNameLength + localExtraLength, entry.offset + 30 + localNameLength + localExtraLength + entry.compressedSize);
        const content = inflateRawSync(compressed);
        expect(content.byteLength).toBe(entry.uncompressedSize);
        expect(crc32(content)).toBe(entry.crc);
      }
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  });
});

function compareCodePoints(left: string, right: string): number {
  const a = [...left], b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

function packageScript(): string {
  return readFileSync(join(projectRoot, "scripts/package-extension.mjs"), "utf8");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let value = (crc ^ byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    crc = (crc >>> 8) ^ value;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
