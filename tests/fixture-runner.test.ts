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
    ["fixture:test:react", "react-browser-test"],
    ["fixture:test:dry-run", "test --dry-run"]
  ])("runs %s through Node instead of a platform shell", (scriptName, command) => {
    expect(packageJson.scripts[scriptName]).toBe(
      `node scripts/lightstreamer/fixture.mjs ${command}`
    );
  });

  it("uses the cross-platform Puppeteer browser installer", () => {
    expect(packageJson.scripts["fixture:browser:install"]).toBe(
      "browsers install chrome@stable --path .cache/lsew-browsers"
    );
  });

  it("loads the fixture runner without requiring Docker, Maven, Bash, or curl", () => {
    const result = spawnSync(process.execPath, [runnerPath, "--help"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "fixture.mjs <build|start|wait|stop|test|browser-test|react-browser-test>"
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

  it("runs the loaded-extension Playwright proof inside the managed fixture lifecycle", () => {
    const result = spawnSync(process.execPath, [runnerPath, "browser-test", "--dry-run"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("docker run --detach");
    expect(result.stdout).toContain(
      "npm exec -- playwright test --config playwright.extension.config.ts"
    );
    expect(result.stdout.indexOf("docker run --detach")).toBeLessThan(
      result.stdout.indexOf("npm exec -- playwright test")
    );
  });

  it("runs the React read-only official-client proof against the React-only artifact", () => {
    const result = spawnSync(process.execPath, [runnerPath, "react-browser-test", "--dry-run"], {
      cwd: rootDir,
      encoding: "utf8"
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("npm run build:react");
    expect(result.stdout).toContain("docker run --detach");
    expect(result.stdout).toContain(
      "npm exec -- playwright test --config playwright.extension.config.ts"
    );
    expect(result.stdout).not.toContain("lightstreamer-mutate-reinject");
  });

  it("exposes a real unpacked React extension smoke command without changing the Store smoke", () => {
    expect(packageJson.scripts["test:ui:extension"]).toBe(
      "npm run build && node scripts/test-ui-extension.mjs"
    );
    expect(packageJson.scripts["test:ui:extension:react"]).toBe(
      "npm run build:react && node scripts/test-ui-extension.mjs --react"
    );
  });
});
