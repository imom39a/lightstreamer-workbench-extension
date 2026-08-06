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
          prototype: { variant: "A", state: "selected", frame: "normal", setup: "live-selected" },
          production: { scenario: "live-selected", setup: "none" }
        },
        {
          id: "compact-captured-draft-light",
          viewport: { width: 563, height: 700 },
          theme: "light",
          prototype: { variant: "B", state: "edit", frame: "compact", setup: "captured-draft" },
          production: { scenario: "local-injection-json", setup: "captured-draft" }
        },
        {
          id: "shallow-authored-review-dark",
          viewport: { width: 900, height: 320 },
          theme: "dark",
          prototype: { variant: "B", state: "review", frame: "shallow", setup: "authored-review" },
          production: { scenario: "local-injection-authored", setup: "authored-review" }
        },
        {
          id: "wide-command-comparison-light",
          viewport: { width: 1440, height: 900 },
          theme: "light",
          prototype: { variant: "A", state: "command", frame: "wide", setup: "command-comparison" },
          production: { scenario: "command-projection-matching", setup: "command-comparison" }
        },
        {
          id: "normal-retained-find-dark",
          viewport: { width: 900, height: 700 },
          theme: "dark",
          prototype: { variant: "A", state: "frozen", frame: "normal", setup: "retained-find" },
          production: { scenario: "frozen-high-volume", setup: "retained-find" }
        },
        {
          id: "compact-long-identities-light",
          viewport: { width: 563, height: 700 },
          theme: "light",
          prototype: { variant: "A", state: "frozen", frame: "compact", setup: "long-identities" },
          production: { scenario: "frozen-high-volume", setup: "none" }
        },
        {
          id: "shallow-more-actions-dark",
          viewport: { width: 900, height: 320 },
          theme: "dark",
          prototype: { variant: "A", state: "selected", frame: "shallow", setup: "more-actions" },
          production: { scenario: "live-selected", setup: "more-actions" }
        },
        {
          id: "wide-matching-summary-light",
          viewport: { width: 1440, height: 900 },
          theme: "light",
          prototype: { variant: "A", state: "selected", frame: "wide", setup: "matching-summary" },
          production: { scenario: "command-projection-matching", setup: "none" }
        },
        {
          id: "wide-selected-json-dark",
          viewport: { width: 1440, height: 900 },
          theme: "dark",
          prototype: { variant: "A", state: "selected", frame: "wide", setup: "selected-json" },
          production: { scenario: "local-injection-json", setup: "none" }
        },
        {
          id: "normal-limited-capture-light",
          viewport: { width: 900, height: 700 },
          theme: "light",
          prototype: { variant: "C", state: "coverage", frame: "normal", setup: "none" },
          production: { scenario: "limited-capture", setup: "none" }
        },
        {
          id: "compact-memory-fallback-dark",
          viewport: { width: 563, height: 700 },
          theme: "dark",
          prototype: { variant: "C", state: "storage", frame: "compact", setup: "none" },
          production: { scenario: "memory-fallback", setup: "none" }
        }
      ]
    });
  });
});
