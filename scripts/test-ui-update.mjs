#!/usr/bin/env node

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runner = join(rootDir, "scripts", "test-ui.mjs");

await new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(process.execPath, [runner, ...process.argv.slice(2)], {
    cwd: rootDir,
    env: { ...process.env, LSEW_UI_UPDATE: "1" },
    stdio: "inherit",
    windowsHide: true
  });
  child.once("error", rejectPromise);
  child.once("close", (code, signal) => {
    if (code === 0) {
      resolvePromise();
      return;
    }
    rejectPromise(
      new Error(`Playwright baseline update exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`)
    );
  });
});
