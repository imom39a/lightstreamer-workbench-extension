import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = __dirname;
const sourceRoot = resolve(projectRoot, "src");

export default defineConfig({
  root: sourceRoot,
  publicDir: resolve(projectRoot, "public"),
  build: {
    emptyOutDir: true,
    outDir: resolve(projectRoot, "dist"),
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
    include: [resolve(projectRoot, "tests/**/*.test.ts")]
  }
});
