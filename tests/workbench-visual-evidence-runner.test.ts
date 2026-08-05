import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runner = join(rootDir, "scripts", "generate-workbench-visual-evidence.mjs");

describe("Workbench visual-evidence runner", () => {
  it("publishes the accepted prototype and production comparison matrix without starting browsers", () => {
    const result = spawnSync(process.execPath, [runner, "--print-matrix"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      artifactRoot: "test-results/workbench-visual-qa",
      scenarios: [
        {
          id: "normal-density-dark",
          viewport: { width: 900, height: 700 },
          theme: "dark",
          prototype: { variant: "A", state: "selected", frame: "normal" },
          production: { scenario: "live-selected", setup: "none" }
        },
        {
          id: "compact-captured-draft-light",
          viewport: { width: 563, height: 700 },
          theme: "light",
          prototype: { variant: "B", state: "edit", frame: "compact" },
          production: { scenario: "local-injection-captured", setup: "captured-draft" }
        },
        {
          id: "shallow-authored-review-dark",
          viewport: { width: 900, height: 320 },
          theme: "dark",
          prototype: { variant: "B", state: "review", frame: "shallow" },
          production: { scenario: "local-injection-authored", setup: "authored-review" }
        },
        {
          id: "wide-command-comparison-light",
          viewport: { width: 1440, height: 900 },
          theme: "light",
          prototype: { variant: "A", state: "command", frame: "wide" },
          production: { scenario: "command-projection-matching", setup: "command-comparison" }
        }
      ]
    });
  });
});
