import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("release extension build audit", () => {
  it("accepts one local, lazy, budgeted MV3 panel", async () => {
    const dist = await createDist();

    const result = await runAudit(dist);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Verified release extension build");
  });

  it("rejects an oversized initial panel chunk", async () => {
    const dist = await createDist({ panelSource: "x".repeat(500_001) });

    const result = await runAudit(dist);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("initial panel chunk exceeds 500000 raw bytes");
  });

  it("rejects React code outside the panel and remote executable scripts", async () => {
    const dist = await createDist();
    await writeFile(resolve(dist, "extension/background.js"), '"useSyncExternalStore";');
    await writeFile(
      resolve(dist, "extension/panel/index.html"),
      '<script type="module" src="https://example.test/panel.js"></script>'
    );

    const result = await runAudit(dist);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("React runtime escaped the panel artifact");
    expect(result.output).toContain("remote executable script");
  });

  it("rejects compatibility renderer residue and executable string compilation", async () => {
    const dist = await createDist({
      panelSource: 'import("../../assets/local-injection-document.js");"renderPanel";new Function("return 1")'
    });

    const result = await runAudit(dist);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("legacy panel compatibility residue");
    expect(result.output).toContain("new Function");
  });
});

async function createDist(options: { panelSource?: string } = {}): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "lsew-extension-audit-"));
  temporaryDirectories.push(directory);
  await Promise.all([
    mkdir(resolve(directory, "extension/panel"), { recursive: true }),
    mkdir(resolve(directory, "assets"), { recursive: true }),
    mkdir(resolve(directory, "content"), { recursive: true }),
    mkdir(resolve(directory, "injected"), { recursive: true })
  ]);
  await writeFile(resolve(directory, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    devtools_page: "devtools.html",
    background: { service_worker: "extension/background.js", type: "module" },
    content_scripts: [
      { js: ["content/content-script.js"] },
      { js: ["injected/lightstreamer-instrumentation.js"] }
    ]
  }));
  await writeFile(resolve(directory, "devtools.html"), '<script type="module" src="./extension/devtools.js"></script>');
  await writeFile(resolve(directory, "extension/devtools.js"), "");
  await writeFile(resolve(directory, "extension/background.js"), "");
  await writeFile(resolve(directory, "content/content-script.js"), "");
  await writeFile(resolve(directory, "injected/lightstreamer-instrumentation.js"), "");
  await writeFile(
    resolve(directory, "extension/panel/index.html"),
    '<script type="module" src="./index.js"></script>'
  );
  await writeFile(
    resolve(directory, "extension/panel/index.js"),
    options.panelSource ?? '"useSyncExternalStore";import("../../assets/local-injection-document.js")'
  );
  await writeFile(resolve(directory, "assets/local-injection-document.js"), "export default {};");
  return directory;
}

async function runAudit(dist: string): Promise<{ exitCode: number; output: string }> {
  const childProcess = await import("node:child_process");
  return new Promise((resolvePromise, reject) => {
    const child = childProcess.spawn(
      process.execPath,
      ["scripts/verify-extension-build.mjs", "--dist", dist],
      { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolvePromise({ exitCode: exitCode ?? 1, output }));
  });
}
