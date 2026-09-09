import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const outputDirectory = resolve(projectRoot, "test-results/production-extension-boundary");
const outputArgument = "test-results/production-extension-boundary";

afterEach(async () => {
  await rm(outputDirectory, { recursive: true, force: true });
});

describe("production built-extension boundary", () => {
  it("builds the real MV3 artifact without a browser runtime", async () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/build-extension.mjs", "--outDir", outputArgument],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          LSEW_EXTENSION_OUT_DIR: outputArgument,
          LSEW_ANALYTICS_DISABLED: "1",
          NODE_ENV: "production"
        },
        encoding: "utf8"
      }
    );
    const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8")) as {
      manifest_version: number;
      devtools_page: string;
      content_scripts: Array<{ js?: string[] }>;
    };
    const panelSource = await readFile(resolve(outputDirectory, "extension/panel/index.js"), "utf8");
    const lazyEditorSource = await readFile(
      resolve(outputDirectory, "assets/local-injection-document.js"),
      "utf8"
    );

    expect(output).toContain("Verified release extension build");
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.devtools_page).toBe("devtools.html");
    expect(manifest.content_scripts.flatMap((entry) => entry.js ?? [])).toEqual([
      "injected/lightstreamer-instrumentation.js",
      "content/content-script.js"
    ]);
    expect(panelSource).toMatch(/useSyncExternalStore|__REACT|react-dom/);
    expect(panelSource).toContain("local-injection-document.js");
    expect(lazyEditorSource).toContain("LocalInjection");
  });
});
