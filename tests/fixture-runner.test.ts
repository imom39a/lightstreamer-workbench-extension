import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runnerPath = join(rootDir, "scripts", "lightstreamer", "fixture.mjs");
const packageJson = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8")
) as { scripts: Record<string, string> };

describe("cross-platform Lightstreamer fixture commands", () => {
  it.each([
    ["fixture:build", "build"],
    ["fixture:start", "start"],
    ["fixture:wait", "wait"],
    ["fixture:stop", "stop"],
    ["fixture:test", "test"]
  ])("runs %s through Node instead of a platform shell", (scriptName, command) => {
    expect(packageJson.scripts[scriptName]).toBe(
      `node scripts/lightstreamer/fixture.mjs ${command}`
    );
  });

  it("loads the fixture runner without requiring Docker, Maven, Bash, or curl", () => {
    const result = spawnSync(process.execPath, [runnerPath, "--help"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("fixture.mjs <build|start|wait|stop|test>");
  });

  it("constructs fixture startup as argument-safe Docker commands", () => {
    const result = spawnSync(process.execPath, [runnerPath, "start", "--dry-run"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        LIGHTSTREAMER_PORT: "18080",
        LSEW_LIGHTSTREAMER_CONTAINER: "lsew cross platform"
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("docker rm -f \"lsew cross platform\"");
    expect(result.stdout).toContain("docker run --detach");
    expect(result.stdout).toContain("--publish 18080:8080");
    expect(result.stdout).toContain("Lightstreamer fixture started at http://localhost:18080/");
  });
});
