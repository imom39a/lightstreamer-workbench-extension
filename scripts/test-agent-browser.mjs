import { spawn } from "node:child_process";

for (const args of [["run", "agent:build"], ["run", "fixture:test:browser"]]) {
  await new Promise((resolve, reject) => {
    const child = spawn("npm", args, { stdio: "inherit", env: { ...process.env, LSEW_AGENT_BROWSER_PROOF: "1" } });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Agent browser proof exited ${code}.`)));
  });
}
