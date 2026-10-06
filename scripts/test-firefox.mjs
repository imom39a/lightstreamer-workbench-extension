import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

if (process.argv.includes("--help")) {
  console.log("Usage: npm run test:firefox\nRuns the real Firefox DevTools and MCP fixture proof. Requires built dist-firefox, the official fixture server, Firefox and marionette-driver. See docs/firefox-testing.md.");
} else {
  const output = resolve("test-results/firefox-runner/proof.mjs");
  await mkdir(resolve("test-results/firefox-runner"), { recursive: true });
  await build({ entryPoints: ["tests/firefox/workbench-proof.ts"], outfile: output, bundle: true, platform: "node", format: "esm", packages: "external" });
  const child = spawn(process.execPath, [output], { stdio: "inherit", env: process.env });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  process.exitCode = code ?? 1;
}
