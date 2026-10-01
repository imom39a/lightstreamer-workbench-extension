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
    ["fixture:test", "test"],
    ["fixture:test:browser", "browser-test"],
    ["fixture:test:dry-run", "test --dry-run"]
  ])("runs %s through Node instead of a platform shell", (scriptName, command) => {
    expect(packageJson.scripts[scriptName]).toBe(
      `node scripts/lightstreamer/fixture.mjs ${command}`
    );
  });

  it("uses the cross-platform Puppeteer browser installer", () => {
    expect(packageJson.scripts["fixture:browser:install"]).toBe(
      "browsers install chrome@151 --path .cache/lsew-browsers"
    );
  });

  it("loads the fixture runner without requiring Docker, Maven, Bash, or curl", () => {
    const result = spawnSync(process.execPath, [runnerPath, "--help"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "fixture.mjs <build|start|wait|stop|test|browser-test>"
    );
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

  it("builds and deploys the adapter and waits for HTTP readiness before reporting startup", () => {
    const result = spawnSync(process.execPath, [runnerPath, "start", "--dry-run"], {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        LIGHTSTREAMER_PORT: "18080",
        LSEW_FIXTURE_URL: "http://localhost:18080/",
        LSEW_FIXTURE_WAIT_SECONDS: "12"
      }
    });

    expect(result.status, result.stderr).toBe(0);
    const stages = [
      "[dry-run] bundle",
      "[dry-run] mvn -q -f",
      "[dry-run] copy",
      "[dry-run] docker rm -f",
      "[dry-run] docker run --detach",
      "[dry-run] wait 12s for http://localhost:18080/",
      "Lightstreamer fixture started at http://localhost:18080/"
    ];
    let previousIndex = -1;
    for (const stage of stages) {
      const index = result.stdout.indexOf(stage);
      expect(index, `Missing startup stage: ${stage}`).toBeGreaterThanOrEqual(0);
      expect(index, `Startup stage out of order: ${stage}`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("returns a failure when HTTP readiness times out", () => {
    const result = spawnSync(process.execPath, [runnerPath, "wait"], {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        LSEW_FIXTURE_URL: "http://127.0.0.1:1/",
        LSEW_FIXTURE_WAIT_SECONDS: "1"
      }
    });

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Timed out waiting for Lightstreamer fixture");
    expect(result.stdout).not.toContain("fixture ready");
    expect(result.stdout).not.toContain("fixture started");
  });

  it("runs the loaded-extension Playwright proof inside the managed fixture lifecycle", () => {
    const result = spawnSync(process.execPath, [runnerPath, "browser-test", "--dry-run"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("docker run --detach");
    expect(result.stdout).toContain("[dry-run] wait");
    expect(result.stdout).not.toContain("fixture started");
    expect(result.stdout).toContain(
      "npm exec -- playwright test --config playwright.extension.config.ts"
    );
    expect(result.stdout.indexOf("docker run --detach")).toBeLessThan(
      result.stdout.indexOf("[dry-run] wait")
    );
    expect(result.stdout.indexOf("[dry-run] wait")).toBeLessThan(
      result.stdout.indexOf("npm exec -- playwright test")
    );
  });

  it("exposes one production unpacked-extension smoke command", () => {
    expect(packageJson.scripts["test:ui:extension"]).toBe(
      "node scripts/test-ui-extension.mjs"
    );
    expect(packageJson.scripts["test:ui:extension:react"]).toBeUndefined();
    expect(packageJson.scripts["fixture:test:react"]).toBeUndefined();
  });
});
