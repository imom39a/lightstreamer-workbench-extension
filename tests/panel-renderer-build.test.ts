import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("panel renderer build audit", () => {
  it("accepts an artifact containing only its declared renderer", async () => {
    const dist = await createDist({ markers: ["react"] });

    const result = await runAudit(dist, "react");

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Verified React-only panel renderer build");
  });

  it("rejects an artifact that retains the inactive renderer", async () => {
    const dist = await createDist({ markers: ["legacy", "react"] });

    const result = await runAudit(dist, "legacy");

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("contains inactive react renderer marker");
  });

  it("rejects a renderer marker outside the panel bundle", async () => {
    const dist = await createDist({ markers: ["legacy"] });
    await writeFile(resolve(dist, "extension/background.js"), '"LSEW_PANEL_RENDERER:legacy";');

    const result = await runAudit(dist, "legacy");

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("renderer marker escaped the panel bundle");
  });
});

async function createDist({ markers }: { markers: Array<"legacy" | "react"> }): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "lsew-panel-renderer-"));
  temporaryDirectories.push(directory);
  await mkdir(resolve(directory, "extension/panel"), { recursive: true });
  await writeFile(
    resolve(directory, "extension/panel/index.js"),
    markers.map((marker) => `"LSEW_PANEL_RENDERER:${marker}";`).join("\n")
  );
  return directory;
}

async function runAudit(dist: string, renderer: "legacy" | "react"): Promise<{ exitCode: number; output: string }> {
  const childProcess = await import("node:child_process");
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(
      process.execPath,
      ["scripts/verify-panel-renderer-build.mjs", "--dist", dist, "--renderer", renderer],
      { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, output }));
  });
}
