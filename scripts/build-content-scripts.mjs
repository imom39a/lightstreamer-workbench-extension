import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const entries = [
  {
    entryPoint: "src/content/content-script.ts",
    outfile: "dist/content/content-script.js"
  },
  {
    entryPoint: "src/injected/lightstreamer-instrumentation.ts",
    outfile: "dist/injected/lightstreamer-instrumentation.js"
  }
];

await Promise.all(
  entries.map(async ({ outfile }) => {
    await mkdir(dirname(resolve(projectRoot, outfile)), { recursive: true });
  })
);

await Promise.all(
  entries.map(({ entryPoint, outfile }) =>
    build({
      absWorkingDir: projectRoot,
      entryPoints: [entryPoint],
      outfile,
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "chrome114",
      minify: true,
      sourcemap: false,
      logLevel: "info"
    })
  )
);
