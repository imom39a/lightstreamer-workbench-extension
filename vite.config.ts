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
        assetFileNames: "assets/[name][extname]",
        // Keep the renderer-neutral Filter algebra shared and out of the
        // initial panel chunk as the runtime mutation seam grows.
        manualChunks(id) {
          if (id.includes("/src/core/filter-algebra.")) return "filter-algebra";
          if (id.includes("/src/core/evidence-filter-selection.")) return "evidence-filter-selection";
          if (id.includes("/src/core/evidence-filter-discovery.") || id.includes("/src/core/evidence-facets.")) return "filter-discovery";
          // Keep optional browser-storage telemetry out of the guarded initial
          // panel chunk; the panel still loads this local static dependency
          // before Capture connects.
          return id.includes("/src/extension/panel/storage-headroom.")
            ? "storage-headroom"
            : undefined;
        }
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
