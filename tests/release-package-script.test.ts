import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

describe("release packaging verification gate", () => {
  it("keeps normal test parallelism unchanged and gates build/package on serial full Vitest", () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const packageScript = readFileSync(join(projectRoot, "scripts/package-extension.mjs"), "utf8");

    expect(packageJson.scripts.test).toBe("vitest run");
    expect(packageJson.scripts["test:release"]).toBe(
      "vitest run --no-file-parallelism --maxWorkers=1"
    );

    const serialGate = 'run("npm", ["run", "test:release"]);';
    const buildGate = 'run("npm", ["run", "build"]);';
    const serialIndex = packageScript.indexOf(serialGate);
    const buildIndex = packageScript.indexOf(buildGate);

    expect(serialIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(serialIndex);
    expect(packageScript).toContain("if (result.status !== 0)");
  });
});
