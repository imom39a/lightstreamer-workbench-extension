import { spawn } from "cross-spawn";

const browserScript = process.argv.includes("--extension-only") ? "test:ui:extension" : "fixture:test:browser";
for (const args of [["run", "agent:build"], ["run", browserScript]]) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit", env: { ...process.env, LSEW_AGENT_BROWSER_PROOF: "1" } });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Agent browser proof exited ${code}.`)));
  });
}
