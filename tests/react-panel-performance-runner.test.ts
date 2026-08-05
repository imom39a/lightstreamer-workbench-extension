import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runner = join(rootDir, "scripts", "measure-react-panel.mjs");
const temporaryDirectories: string[] = [];
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("React panel performance evidence runner", () => {
  it("exposes one repeatable build-and-measure command and documents its bounded evidence", () => {
    expect(packageJson.scripts["measure:react-panel"]).toBe(
      "npm run build && npm run build:react && node scripts/measure-react-panel.mjs"
    );

    const result = run(["--help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("five cold semantic-control loads");
    expect(result.stdout).toContain("sustained high-volume Capture");
    expect(result.stdout).toContain("retained heap lifecycle cycles");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--lifecycle-only");
    expect(result.stdout).toContain("--warmup-cycles");
    expect(result.stdout).toContain("--recorded-cycles");
    expect(result.stdout).toContain("--lifecycle-runs");
    expect(result.stdout).toContain("--lifecycle-scenario");
    expect(result.stdout).toContain("--inspect-harness");
  });

  it("pins the measured standalone harness to React's production build", () => {
    const result = run(["--inspect-harness"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ reactBuild: "production" });
    expect(result.stdout).toContain("react.production");
    expect(result.stdout).not.toContain("react.development");
  });

  it("prints the lifecycle-only configuration without starting a browser", () => {
    const result = run([
      "--lifecycle-only",
      "--warmup-cycles",
      "2",
      "--recorded-cycles",
      "4",
      "--lifecycle-runs",
      "3",
      "--lifecycle-scenario",
      "capture",
      "--print-config"
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "lifecycle-only",
      warmupCycles: 2,
      recordedCycles: 4,
      lifecycleRuns: 3,
      lifecycleScenario: "capture"
    });
  });

  it("uses a steady-state default lifecycle window", () => {
    const result = run(["--lifecycle-only", "--print-config"]);

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      warmupCycles: 12,
      recordedCycles: 30
    });
  });

  it("fails only the explicit long-task and monotonic lifecycle triggers", () => {
    const passing = writeReport({
      highVolume: { longTasks: [], maxLongTaskMs: 0 },
      lifecycle: { retainedHeapBytes: [100, 120, 110, 125] }
    });
    const passResult = run(["--evaluate", passing]);
    expect(passResult.status, passResult.stderr).toBe(0);

    const failing = writeReport({
      highVolume: { longTasks: [{ startMs: 2, durationMs: 51 }], maxLongTaskMs: 51 },
      lifecycle: { retainedHeapBytes: [100, 110, 120, 130] }
    });
    const failResult = run(["--evaluate", failing]);
    expect(failResult.status).toBe(1);
    expect(`${failResult.stdout}\n${failResult.stderr}`).toContain(
      "panel task exceeded 50 ms"
    );
    expect(`${failResult.stdout}\n${failResult.stderr}`).toContain(
      "monotonic retained-heap growth"
    );
  });

  it("evaluates every lifecycle-only run while preserving the legacy lifecycle report seam", () => {
    const passing = writeReport({
      mode: "lifecycle-only",
      configuration: { mode: "lifecycle-only", lifecycleRuns: 2, lifecycleScenario: "capture" },
      lifecycle: { gcSupported: true, retainedHeapBytes: [100, 130, 120, 140] },
      lifecycleRuns: [
        { run: 1, scenario: "capture", gcSupported: true, retainedHeapBytes: [100, 130, 120, 140] },
        { run: 2, scenario: "capture", gcSupported: true, retainedHeapBytes: [200, 210, 205, 220] }
      ]
    });
    expect(run(["--evaluate", passing]).status).toBe(0);

    const reproducing = writeReport({
      mode: "lifecycle-only",
      configuration: { mode: "lifecycle-only", lifecycleRuns: 2, lifecycleScenario: "capture" },
      lifecycle: { gcSupported: true, retainedHeapBytes: [100, 130, 120, 140] },
      lifecycleRuns: [
        { run: 1, scenario: "capture", gcSupported: true, retainedHeapBytes: [100, 130, 120, 140] },
        { run: 2, scenario: "capture", gcSupported: true, retainedHeapBytes: [200, 210, 220, 230] }
      ]
    });
    const result = run(["--evaluate", reproducing]);
    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain("Run 2");
    expect(`${result.stdout}\n${result.stderr}`).toContain("monotonic retained-heap growth");
  });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: rootDir,
    encoding: "utf8"
  });
}

function writeReport(report: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "lsew-react-performance-test-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "report.json");
  writeFileSync(path, JSON.stringify(report));
  return path;
}
