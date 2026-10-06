import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { companionMode, installWorkbenchSkill } from "../src/agent/companion/setup";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe("combined Workbench setup", () => {
  it("offers setup on an interactive bare npx invocation while preserving stdio MCP launches", () => {
    expect(companionMode(undefined, true)).toBe("setup");
    expect(companionMode(undefined, false)).toBe("mcp");
    expect(companionMode("mcp", true)).toBe("mcp");
    expect(companionMode("update", true)).toBe("setup");
  });

  it.each([
    ["codex", ".agents/skills"],
    ["claude-code", ".claude/skills"],
    ["kiro-cli", ".kiro/skills"]
  ])("installs and updates the complete bundled skill for %s through the real skills dependency", async (agent, skillsDirectory) => {
    const directory = await mkdtemp(join(tmpdir(), "workbench setup with spaces "));
    directories.push(directory);
    const bundle = join(directory, "companion");
    await mkdir(join(bundle, "dist"), { recursive: true });
    await cp(resolve(".agents/skills/lightstreamer-workbench"), join(bundle, "skills/lightstreamer-workbench"), { recursive: true });
    const project = join(directory, "application project");
    await mkdir(project);
    const cli = join(bundle, "dist/cli.mjs");
    const options = { agents: [agent], yes: true, cwd: project, quiet: true };
    await installWorkbenchSkill(cli, options);
    const installed = join(project, skillsDirectory, "lightstreamer-workbench");
    for (const file of ["SKILL.md", "references/connection.md", "references/investigation.md", "references/local-injection.md", "references/server-injection.md", "references/application-context.md", "references/query-planning.md"]) {
      expect(await readFile(join(installed, file), "utf8")).toBe(await readFile(join(bundle, "skills/lightstreamer-workbench", file), "utf8"));
    }
    // Re-running the same combined flow replaces stale shipped guidance.
    await rm(join(installed, "references/investigation.md"));
    await installWorkbenchSkill(cli, options);
    expect(await readFile(join(installed, "references/investigation.md"), "utf8")).toContain("Evidence");
  }, 15_000);
});
