#!/usr/bin/env node

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const updateSnapshots = process.env.LSEW_UI_UPDATE === "1";
const args = [...process.argv.slice(2)];
const forwardedArgs = [];

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--update" || argument === "--update-snapshots") {
    throw new Error("Visual baselines are updated only by npm run test:ui:update.");
  }
  if (argument === "--scenario" || argument === "--theme" || argument === "--viewport") {
    const option = argument.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }
    process.env[`LSEW_UI_${option.toUpperCase()}`] = value;
    index += 1;
    continue;
  }
  if (argument.startsWith("--scenario=") || argument.startsWith("--theme=") || argument.startsWith("--viewport=")) {
    const separator = argument.indexOf("=");
    const option = argument.slice(2, separator).toUpperCase();
    process.env[`LSEW_UI_${option}`] = argument.slice(separator + 1);
    continue;
  }
  forwardedArgs.push(argument);
}

const playwrightBin = join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright"
);
const playwrightArgs = ["test", ...forwardedArgs];
if (updateSnapshots) {
  playwrightArgs.push("--update-snapshots");
}

await runProcess(playwrightBin, playwrightArgs);

function runProcess(executable, processArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, processArgs, {
      cwd: rootDir,
      env: { ...process.env },
      shell: process.platform === "win32",
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", (error) => rejectPromise(error));
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Playwright exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`
        )
      );
    });
  });
}
