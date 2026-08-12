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

  it("records the final two tracked Darwin baseline updates in the generated packet metadata", () => {
    expect(runnerSource).toContain(
      'baselineIntent: "Update the final two tracked Darwin baselines — normal-help-resources-light-darwin and normal-limited-capture-light-darwin — for the intentional Panel Session lifecycle copy and typed lower-capacity footer condition; all other baselines remain unchanged."'
    );
    expect(runnerSource).not.toContain("seven affected Darwin baselines");
  });
});
