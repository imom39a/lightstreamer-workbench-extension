import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = readdirSync(resolve(root, "scripts"))
  .filter(name => name.endsWith(".test.mjs"))
  .sort()
  .map(name => resolve(root, "scripts", name));
if (files.length === 0) throw new Error("No maintained script contract tests were found.");
const result = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
