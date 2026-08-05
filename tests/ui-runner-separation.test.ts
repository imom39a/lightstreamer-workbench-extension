import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("coexisting UI browser suites", () => {
  it("keeps the normal UI runner legacy-only and gives React its dedicated command", () => {
    const legacy = spawnSync(process.execPath, [join(rootDir, "scripts/test-ui.mjs"), "--list"], {
      cwd: rootDir,
      encoding: "utf8"
    });
    expect(legacy.status, legacy.stderr).toBe(0);
    expect(legacy.stdout).toContain("timeline.spec.ts");
    expect(legacy.stdout).not.toContain("react-diagnose.spec.ts");

    const playwright = join(
      rootDir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "playwright.cmd" : "playwright"
    );
    const react = spawnSync(
      playwright,
      ["test", "--config", "tests/ui/react.playwright.config.ts", "--list"],
      { cwd: rootDir, encoding: "utf8", shell: process.platform === "win32" }
    );
    expect(react.status, react.stderr).toBe(0);
    expect(react.stdout).toContain("react-diagnose.spec.ts");
    expect(react.stdout).not.toContain("timeline.spec.ts");
    expect(packageJson.scripts["test:ui:react"]).toBe(
      "playwright test --config tests/ui/react.playwright.config.ts"
    );
  });
});
