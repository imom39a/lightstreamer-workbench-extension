import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractFrozenBrowser, readFrozenRelease } from "./package-mcp-release.mjs";

/** Select the bytes that each browser journey will actually load. */
export function prepareChromeTestInput(options) {
  return prepareBrowserTestInput({ ...options, browser: "chrome" });
}

export function prepareFirefoxTestInput(options) {
  return prepareBrowserTestInput({ ...options, browser: "firefox" });
}

async function prepareBrowserTestInput({ rootDir, environment = process.env, dryRun = false, browser }) {
  const directoryKey = browser === "chrome" ? "LSEW_EXTENSION_DIR" : "LSEW_FIREFOX_DIST";
  const env = { ...environment, LSEW_PROJECT_ROOT: rootDir, LSEW_ANALYTICS_DISABLED: "1" };
  if (!environment.LSEW_FROZEN_RELEASE_MANIFEST) {
    const directory = browser === "chrome" ? "dist" : environment.LSEW_FIREFOX_DIST ?? "dist-firefox";
    return { extensionDir: resolve(rootDir, directory), needsBuild: browser === "chrome",
      environment: { ...env, [directoryKey]: directory }, dispose: async () => {} };
  }
  const manifestPath = resolve(rootDir, environment.LSEW_FROZEN_RELEASE_MANIFEST);
  if (environment.GITHUB_SHA && environment.LSEW_FROZEN_RELEASE_SOURCE && environment.GITHUB_SHA !== environment.LSEW_FROZEN_RELEASE_SOURCE) {
    throw new Error("Frozen browser source override does not match the pinned GITHUB_SHA.");
  }
  const expectedSource = environment.GITHUB_SHA ?? environment.LSEW_FROZEN_RELEASE_SOURCE;
  const release = await readFrozenRelease({ manifestPath, expectedSource });
  if (environment.LSEW_AGENT_PACKAGE_TARBALL && resolve(rootDir, environment.LSEW_AGENT_PACKAGE_TARBALL) !== release.artifacts.npm.path) {
    throw new Error("Frozen browser verification must use the manifest-selected companion tarball.");
  }
  const cache = join(rootDir, ".cache", "release-verified");
  if (dryRun) {
    const extensionDir = join(cache, `${browser}-dry-run`);
    return { extensionDir, needsBuild: false,
      environment: { ...env, LSEW_FROZEN_RELEASE_MANIFEST: manifestPath,
        [directoryKey]: extensionDir, LSEW_AGENT_PACKAGE_TARBALL: release.artifacts.npm.path },
      dispose: async () => {} };
  }
  await mkdir(cache, { recursive: true });
  const extensionDir = await mkdtemp(join(cache, `${browser}-`));
  try {
    await extractFrozenBrowser({ manifestPath, expectedSource, browser, directory: extensionDir });
  } catch (error) {
    await rm(extensionDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
  return { extensionDir, needsBuild: false,
    environment: { ...env, LSEW_FROZEN_RELEASE_MANIFEST: manifestPath,
      [directoryKey]: extensionDir, LSEW_AGENT_PACKAGE_TARBALL: release.artifacts.npm.path },
    dispose: () => rm(extensionDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}
