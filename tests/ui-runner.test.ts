import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("production UI runner", () => {
  it("runs the accepted panel and visual regression matrix without a parallel renderer lane", () => {
    const result = spawnSync(process.execPath, [join(rootDir, "scripts/test-ui.mjs"), "--list"], {
      cwd: rootDir,
      encoding: "utf8"
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("workbench.spec.ts");
    expect(result.stdout).toContain("visual-regression.spec.ts");
    expect(result.stdout).not.toContain("timeline.spec.ts");
    expect(packageJson.scripts["test:ui:react"]).toBeUndefined();
  });

  it("keeps normal verification read-only and exposes deliberate evidence commands", () => {
    const rejected = spawnSync(process.execPath, [join(rootDir, "scripts/test-ui.mjs"), "--update"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("Visual baselines are updated only by npm run test:ui:update.");
    expect(packageJson.scripts["test:ui:update"]).toBe("node scripts/test-ui-update.mjs");
    expect(packageJson.scripts["test:ui:visual"]).toBe("node scripts/generate-workbench-visual-evidence.mjs");
    expect(packageJson.scripts["docs:check"]).toBe("node scripts/check-docs.mjs");
  });
});
