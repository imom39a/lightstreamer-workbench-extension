import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runner = join(rootDir, "scripts", "generate-react-slice1-visual-evidence.mjs");

describe("React Slice 1 visual-evidence runner", () => {
  it("publishes the deterministic reference/current/diff matrix without starting browsers", () => {
    const result = spawnSync(process.execPath, [runner, "--print-matrix"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      artifactRoot: "test-results/react-slice1-visual-qa",
      scenarios: [
        {
          id: "normal-selected-dark",
          viewport: { width: 900, height: 700 },
          theme: "dark",
          prototypeState: "selected",
          reactScenario: "live-selected",
          disposition: "comparable"
        },
        {
          id: "compact-selected-light",
          viewport: { width: 563, height: 700 },
          theme: "light",
          prototypeState: "selected",
          reactScenario: "live-selected",
          disposition: "comparable"
        },
        {
          id: "shallow-frozen-dark",
          viewport: { width: 900, height: 320 },
          theme: "dark",
          prototypeState: "frozen",
          reactScenario: "frozen-high-volume",
          disposition: "comparable"
        },
        {
          id: "wide-command-dark",
          viewport: { width: 1440, height: 900 },
          theme: "dark",
          prototypeState: "command",
          reactScenario: "live-selected",
          disposition: "reference-only"
        }
      ]
    });
  });

  it("documents that generated diffs are inspectable reference deltas, not parity gates", () => {
    const result = spawnSync(process.execPath, [runner, "--help"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("base, changed, and diff PNGs");
    expect(result.stdout).toContain("not a pixel-parity acceptance gate");
    expect(result.stdout).toContain("--print-matrix");
  });
});
