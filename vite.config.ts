import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { normalizePath } from "vite";

const projectRoot = __dirname;
const sourceRoot = resolve(projectRoot, "src");
const extensionOutDir = process.env.LSEW_EXTENSION_OUT_DIR ?? "dist";

export default defineConfig({
  root: sourceRoot,
  envDir: projectRoot,
  publicDir: resolve(projectRoot, "public"),
  build: {
    emptyOutDir: true,
    outDir: resolve(projectRoot, extensionOutDir),
    rollupOptions: {
      input: {
        "extension/background": resolve(sourceRoot, "extension/background.ts"),
        "extension/devtools": resolve(sourceRoot, "extension/devtools.ts"),
        "extension/panel/index": resolve(sourceRoot, "extension/panel/index.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: [normalizePath(resolve(projectRoot, "tests/**/*.test.ts"))],
    benchmark: {
      include: [normalizePath(resolve(projectRoot, "benchmarks/**/*.bench.ts"))]
    }
  }
});
