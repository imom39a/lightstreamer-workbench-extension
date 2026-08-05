import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("production UI runner", () => {
  it("runs the accepted panel from the normal command without a parallel renderer lane", () => {
    const result = spawnSync(process.execPath, [join(rootDir, "scripts/test-ui.mjs"), "--list"], {
      cwd: rootDir,
      encoding: "utf8"
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("workbench.spec.ts");
    expect(result.stdout).not.toContain("timeline.spec.ts");
    expect(packageJson.scripts["test:ui:react"]).toBeUndefined();
  });
});
