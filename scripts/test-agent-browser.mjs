import { spawn } from "cross-spawn";
import { resolve as resolvePath } from "node:path";
import { readFile } from "node:fs/promises";

const metadata = JSON.parse(await readFile(new URL("../agent/package.json", import.meta.url), "utf8"));

const browserScript = process.argv.includes("--extension-only") ? "test:ui:extension" : "fixture:test:browser";
for (const args of [["run", "agent:test:package"], ["run", browserScript]]) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit", env: { ...process.env, LSEW_AGENT_BROWSER_PROOF: "1", LSEW_AGENT_TEST_CLI: resolvePath("test-results/agent-package/node_modules", metadata.name, "dist/cli.mjs") } });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Agent browser proof exited ${code}.`)));
  });
}
