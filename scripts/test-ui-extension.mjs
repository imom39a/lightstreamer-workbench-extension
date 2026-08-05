#!/usr/bin/env node

import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const renderer = process.argv.includes("--react") ? "react" : "legacy";
const browserTest = join(rootDir, "tests", "extension-panel.browser.spec.ts");
const temporaryRoot = await mkdtemp(
  join(rootDir, "tests", ".lsew-extension-panel-browser-test-")
);
const outputPath = join(temporaryRoot, "extension-panel.browser.spec.mjs");

try {
  await build({
    entryPoints: [browserTest],
    outfile: outputPath,
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent"
  });
  await runProcess(process.execPath, [outputPath]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function runProcess(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: rootDir,
      env: {
        ...process.env,
        LSEW_PROJECT_ROOT: rootDir,
        LSEW_EXTENSION_DIR: renderer === "react" ? "dist-react" : "dist",
        LSEW_EXPECTED_RENDERER: renderer
      },
      shell: false,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", (error) => {
      rejectPromise(
        new Error(
          `Unable to run ${executable}. Confirm it is installed and available on PATH. ${error.message}`
        )
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `${executable} exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`
          )
        );
      }
    });
  });
}
