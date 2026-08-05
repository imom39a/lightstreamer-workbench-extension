import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const renderer = args.renderer ?? "legacy";
const outDir = args.outDir ?? (renderer === "react" ? "dist-react" : "dist");

if (renderer !== "legacy" && renderer !== "react") {
  fail('Expected --renderer "legacy" or "react".');
}

const environment = {
  ...process.env,
  LSEW_PANEL_RENDERER: renderer,
  LSEW_EXTENSION_OUT_DIR: outDir
};

run("npx", ["vite", "build"], environment);
run(process.execPath, ["scripts/build-content-scripts.mjs"], environment);
run(process.execPath, ["scripts/verify-extension-build.mjs"], environment);
run(process.execPath, ["scripts/verify-panel-renderer-build.mjs", "--dist", outDir, "--renderer", renderer], environment);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function run(command, commandArgs, env) {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env,
    shell: process.platform === "win32",
    stdio: "inherit"
  });
  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
