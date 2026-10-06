import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire as createSkillRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

/** Bare interactive npx is onboarding; existing stdio launches remain MCP. */
export function companionMode(requested: string | undefined, interactive: boolean): string {
  return requested === "update" ? "setup" : requested ?? (interactive ? "setup" : "mcp");
}

export async function offerWorkbenchSkill(): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question("Install or update the matching Workbench skill? [Y/n] ")).trim().toLowerCase();
    return answer === "" || answer === "y" || answer === "yes";
  } finally { prompt.close(); }
}

export type WorkbenchSkillOptions = Readonly<{
  agents?: readonly string[];
  global?: boolean;
  yes?: boolean;
  cwd?: string;
  quiet?: boolean;
}>;

/** Use the dependency's public executable, including its prompts and agent
 * directory registry. Copy the release's complete skill into durable storage. */
export async function installWorkbenchSkill(cli: string, options: WorkbenchSkillOptions = {}): Promise<void> {
  if (options.yes && !options.agents?.length) throw new Error("Unattended skill setup requires --agent; choose an agent app explicitly.");
  const require = createSkillRequire(import.meta.url);
  const packagePath = require.resolve("skills/package.json");
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { bin: { skills: string } };
  const installer = resolve(dirname(packagePath), metadata.bin.skills);
  const skill = resolve(dirname(cli), "../skills/lightstreamer-workbench");
  const args = [installer, "add", skill, "--skill", "lightstreamer-workbench", "--copy",
    ...(options.agents?.length ? ["--agent", ...options.agents] : []),
    ...(options.global ? ["--global"] : []), ...(options.yes ? ["--yes"] : [])];
  await new Promise<void>((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: options.cwd, shell: false,
      stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
    let details = "";
    child.stderr?.on("data", chunk => { details = `${details}${String(chunk)}`.slice(-2048); });
    child.stdout?.on("data", () => { /* Drain bounded test output. */ });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? accept()
      : reject(new Error(`Workbench skill installation ${signal ? `ended with ${signal}` : `failed (exit ${code})`}.${details ? ` ${details.trim()}` : " Re-run the same setup command to recover."}`)));
  });
}
