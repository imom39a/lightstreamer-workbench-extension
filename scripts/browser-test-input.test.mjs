import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReleaseBundle, extractReleaseBundle, writeDeterministicZip } from "./package-mcp-release.mjs";
import { prepareChromeTestInput, prepareFirefoxTestInput } from "./browser-test-input.mjs";

const source = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const agent = JSON.parse(await readFile(new URL("../agent/package.json", import.meta.url), "utf8"));
const sourceSha = "e".repeat(40);

test("a frozen browser journey loads the candidate bytes and companion without rebuilding dist", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "workbench-browser-input-"));
  let input;
  try {
    const frozen = await candidate(rootDir);
    input = await prepareChromeTestInput({ rootDir, environment: {
      LSEW_FROZEN_RELEASE_MANIFEST: frozen,
      GITHUB_SHA: sourceSha,
      LSEW_EXTENSION_DIR: "dist"
    } });
    assert.equal(input.needsBuild, false);
    assert.notEqual(input.extensionDir, join(rootDir, "dist"));
    assert.equal(input.environment.LSEW_EXTENSION_DIR, input.extensionDir);
    assert.equal(input.environment.LSEW_PROJECT_ROOT, rootDir);
    assert.equal(await readFile(join(input.extensionDir, "extension/background.js"), "utf8"), "frozen-store-worker-bytes");
    assert.equal(input.environment.LSEW_AGENT_PACKAGE_TARBALL, join(rootDir, "frozen/agent", `${agent.name}-${agent.version}.tgz`));
    assert.equal(JSON.parse(await readFile(join(input.extensionDir, "manifest.json"), "utf8")).version, source.version);
  } finally {
    await input?.dispose();
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("the official-client fixture dry run selects frozen bytes without an extension rebuild", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "workbench-frozen-fixture-"));
  try {
    const manifest = await candidate(rootDir);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./lightstreamer/fixture.mjs", import.meta.url)), "browser-test", "--dry-run"], {
      encoding: "utf8", env: { ...process.env, GITHUB_SHA: sourceSha, LSEW_FROZEN_RELEASE_SOURCE: sourceSha,
        LSEW_AGENT_PACKAGE_TARBALL: "", LSEW_FROZEN_RELEASE_MANIFEST: manifest }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /npm run build/);
    assert.match(result.stdout, /frozen Chrome input/);
    assert.match(result.stdout, /npm exec -- playwright test --config playwright.extension.config.ts/);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("a local source override cannot select a different package in a pinned CI browser journey", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "workbench-browser-source-"));
  try {
    const manifest = await candidate(rootDir);
    await assert.rejects(prepareChromeTestInput({ rootDir, environment: {
      LSEW_FROZEN_RELEASE_MANIFEST: manifest,
      LSEW_FROZEN_RELEASE_SOURCE: sourceSha,
      GITHUB_SHA: "f".repeat(40)
    } }), /source/i);
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});

test("a frozen Firefox journey loads its verified package from a private directory", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "workbench-firefox-input-"));
  let input;
  try {
    input = await prepareFirefoxTestInput({ rootDir, environment: {
      LSEW_FROZEN_RELEASE_MANIFEST: await candidate(rootDir), GITHUB_SHA: sourceSha,
      LSEW_FIREFOX_DIST: "a-different-prebuilt-directory"
    } });
    assert.equal(input.needsBuild, false);
    assert.equal(input.environment.LSEW_FIREFOX_DIST, input.extensionDir);
    assert.notEqual(input.extensionDir, join(rootDir, "a-different-prebuilt-directory"));
    assert.equal(await readFile(join(input.extensionDir, "extension/background.js"), "utf8"), "frozen-firefox-worker-bytes");
    const manifest = JSON.parse(await readFile(join(input.extensionDir, "manifest.json"), "utf8"));
    assert.equal(manifest.browser_specific_settings.gecko.id, "lightstreamer-workbench@imom39a");
    assert.equal(manifest.version, source.version);
  } finally {
    await input?.dispose();
    await rm(rootDir, { recursive: true, force: true });
  }
});

async function candidate(directory) {
  const chrome = `${source.name}-v${source.version}.zip`;
  const firefox = `${source.name}-firefox-v${source.version}.zip`;
  const reviewer = `${source.name}-firefox-source-v${source.version}.zip`;
  const npm = `${agent.name}-${agent.version}.tgz`;
  await writeDeterministicZip([
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify({ manifest_version: 3, version: source.version })) },
    { name: "extension/background.js", bytes: Buffer.from("frozen-store-worker-bytes") }
  ], join(directory, chrome));
  await writeDeterministicZip([{ name: "manifest.json", bytes: Buffer.from(JSON.stringify({
    manifest_version: 3, version: source.version, incognito: "not_allowed",
    browser_specific_settings: { gecko: { id: "lightstreamer-workbench@imom39a" } },
    background: { scripts: ["extension/background.js"] }
  })) }, { name: "extension/background.js", bytes: Buffer.from("frozen-firefox-worker-bytes") }], join(directory, firefox));
  await writeDeterministicZip([
    { name: "README.md", bytes: Buffer.from(`Source commit: ${sourceSha}\n`) },
    { name: "package.json", bytes: Buffer.from(JSON.stringify(source)) },
    { name: "public/manifest.json", bytes: Buffer.from(JSON.stringify({ manifest_version: 3, version: source.version })) }
  ], join(directory, reviewer));
  const bytes = Buffer.from(JSON.stringify({ name: agent.name, version: agent.version, gitHead: sourceSha }));
  const header = Buffer.alloc(512), padded = Buffer.alloc(Math.ceil(bytes.length / 512) * 512);
  header.write("package/package.json");
  header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  bytes.copy(padded);
  await writeFile(join(directory, npm), gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)])));
  await writeFile(join(directory, "agent-release.json"), JSON.stringify({ name: agent.name, version: agent.version, filename: npm, sha: sourceSha, publish: false }));
  await writeFile(join(directory, "firefox-submission.json"), JSON.stringify({ version: { release_notes: { "en-US": "Synthetic release" }, approval_notes: "Synthetic notes" } }));
  const bundle = await createReleaseBundle({ releaseDir: directory, sourceSha });
  const destination = join(directory, "frozen");
  await extractReleaseBundle({ bundlePath: bundle.output, directory: destination, expectedSource: sourceSha });
  return join(destination, "release-manifest.json");
}
