import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runner = join(rootDir, "scripts", "generate-workbench-visual-evidence.mjs");
const runnerSource = readFileSync(runner, "utf8");
const matrix = JSON.parse(readFileSync(join(rootDir, "tests", "ui", "visual-matrix.json"), "utf8"));

describe("Workbench visual-evidence runner", () => {
  it("publishes the accepted prototype and production comparison matrix without starting browsers", () => {
    const result = spawnSync(process.execPath, [runner, "--print-matrix"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      artifactRoot: "test-results/workbench-visual-qa",
      scenarios: matrix
    });
  });

  it("records the diagnostic-footer baseline intent and stress matrix in the generated packet metadata", () => {
    expect(runnerSource).toContain(
      'baselineIntent: "Update tracked baselines that render diagnostics and add Darwin/Linux baselines for the four mixed-severity stress geometries. Five Darwin-only native-scrollbar snapshots are normalized to the current release-prep rendering; their semantic content is unchanged."'
    );
    expect(matrix.filter((scenario: { production?: { scenario?: string } }) =>
      scenario.production?.scenario === "diagnostics-stress"
    ).map((scenario: { id: string }) => scenario.id)).toEqual([
      "wide-diagnostics-stress-light",
      "normal-diagnostics-stress-dark",
      "shallow-diagnostics-stress-light",
      "compact-diagnostics-stress-dark"
    ]);
  });
});
