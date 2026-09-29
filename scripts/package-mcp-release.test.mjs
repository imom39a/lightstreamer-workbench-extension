import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, inflateRawSync } from "node:zlib";
import { createReleaseBundle, makeReleaseManifest } from "./package-mcp-release.mjs";

const sha = "c".repeat(40);
const agentVersion = "7.4.2";
const extension = { version: "2.0.5", manifestVersion: "2.0.5", file: "extension/lightstreamer-workbench-v2.0.5.zip", size: 18, sha256: "a".repeat(64) };
const agent = { name: "lightstreamer-workbench-agent", version: agentVersion, sha, file: `agent/lightstreamer-workbench-agent-${agentVersion}.tgz`, size: 17, sha256: "b".repeat(64) };
// The pure manifest tests above use fixed arbitrary versions. Bundle integration
// fixtures must follow the checked-out source package and manifest instead.
const sourceExtension = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const sourceAgent = JSON.parse(await readFile(new URL("../agent/package.json", import.meta.url), "utf8"));
const extensionVersion = sourceExtension.version;
const extensionFile = `extension/${sourceExtension.name}-v${extensionVersion}.zip`;
const companionVersion = sourceAgent.version;
const companionFile = `agent/${sourceAgent.name}-${companionVersion}.tgz`;
const wrongVersion = version => version === "0.0.0" ? "0.0.1" : "0.0.0";

test("release manifest binds artifact paths, versions and exact source SHA", () => {
  const manifest = makeReleaseManifest({ extension, agent, sourceSha: sha });
  assert.equal(manifest.state, "prepared-unpublished");
  assert.equal(manifest.source.commit, sha);
  assert.equal(manifest.extension.version, "2.0.5");
  assert.equal(manifest.extension.file, extension.file);
  assert.equal(manifest.mcp.version, agentVersion);
  assert.equal(manifest.mcp.file, agent.file);
});

test("release manifest fails closed on mismatched provenance, versions or dirty tracked files", () => {
  assert.throws(() => makeReleaseManifest({ extension: { ...extension, version: "2.0.4" }, agent, sourceSha: sha }), /versions do not match/);
  assert.throws(() => makeReleaseManifest({ extension, agent: { ...agent, sha: "d".repeat(40) }, sourceSha: sha }), /provenance/);
  assert.throws(() => makeReleaseManifest({ extension, agent, sourceSha: sha, dirtyPaths: ["src/agent/cli.ts"] }), /uncommitted changes/);
  assert.equal(makeReleaseManifest({ extension, agent: { ...agent, version: "7.4.3" }, sourceSha: sha }).mcp.version, "7.4.3");
});

test("bundle validates archive metadata and contains checksummed artifacts and instructions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-release-test-"));
  try {
    const extensionZip = makeZip({ "manifest.json": { manifest_version: 3, version: extensionVersion } });
    const agentTgz = makeTgz({ name: sourceAgent.name, version: companionVersion, gitHead: sha });
    await writeInputs(directory, extensionZip, agentTgz, sha);
    const { output, manifest } = await createReleaseBundle({ releaseDir: directory, sourceSha: sha });
    const entries = readZipEntries(await readFile(output));
    assert.deepEqual([...entries.keys()].sort(), [
      "README.txt", "SHA256SUMS", companionFile, extensionFile, "release-manifest.json"
    ]);
    assert.deepEqual(entries.get(extensionFile), extensionZip);
    assert.deepEqual(entries.get(companionFile), agentTgz);
    const emittedManifest = JSON.parse(entries.get("release-manifest.json"));
    assert.equal(emittedManifest.extension.file, extensionFile);
    assert.equal(emittedManifest.extension.size, extensionZip.length);
    assert.equal(emittedManifest.extension.sha256, digest(extensionZip));
    assert.equal(emittedManifest.mcp.file, companionFile);
    assert.equal(emittedManifest.mcp.size, agentTgz.length);
    assert.equal(emittedManifest.mcp.sha256, digest(agentTgz));
    assert.equal(emittedManifest.state, "prepared-unpublished");
    assert.match(entries.get("SHA256SUMS").toString(), /^[a-f0-9]{64}  extension\//m);
    assert.match(entries.get("README.txt").toString(), /prepared-unpublished/);
    assert.equal(manifest.source.commit, sha);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle rejects stale ZIP version and stale npm gitHead", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-release-invalid-test-"));
  try {
    const staleExtension = makeZip({ "manifest.json": { manifest_version: 3, version: wrongVersion(extensionVersion) } });
    const staleAgent = makeTgz({ name: sourceAgent.name, version: companionVersion, gitHead: "d".repeat(40) });
    await writeInputs(directory, staleExtension, staleAgent, sha);
    await assert.rejects(createReleaseBundle({ releaseDir: directory, sourceSha: sha }), /Extension ZIP manifest/);
    const matchingExtension = makeZip({ "manifest.json": { manifest_version: 3, version: extensionVersion } });
    await writeFile(join(directory, extensionFile.split("/").at(-1)), matchingExtension);
    await assert.rejects(createReleaseBundle({ releaseDir: directory, sourceSha: sha }), /npm tarball package metadata/);
    const wrongPackageVersion = makeTgz({ name: sourceAgent.name, version: wrongVersion(companionVersion), gitHead: sha });
    await writeFile(join(directory, companionFile.split("/").at(-1)), wrongPackageVersion);
    await assert.rejects(createReleaseBundle({ releaseDir: directory, sourceSha: sha }), /npm tarball package metadata/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bundle records guarded publication intent without publishing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mcp-release-intent-test-"));
  try {
    const extensionZip = makeZip({ "manifest.json": { manifest_version: 3, version: extensionVersion } });
    const agentTgz = makeTgz({ name: sourceAgent.name, version: companionVersion, gitHead: sha });
    await writeInputs(directory, extensionZip, agentTgz, sha, true);
    const { manifest } = await createReleaseBundle({ releaseDir: directory, sourceSha: sha });
    assert.equal(manifest.state, "prepared-unpublished");
    assert.equal(manifest.publicationIntent, "guarded-publish-after-verification");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function writeInputs(directory, extensionZip, agentTgz, sourceSha, publish = false) {
  const plan = { name: sourceAgent.name, version: companionVersion, filename: companionFile.split("/").at(-1), sha: sourceSha, publish };
  await writeFile(join(directory, extensionFile.split("/").at(-1)), extensionZip);
  await writeFile(join(directory, plan.filename), agentTgz);
  await writeFile(join(directory, "agent-release.json"), JSON.stringify(plan));
}

function makeZip(entries) {
  const locals = [];
  for (const [name, value] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(JSON.stringify(value));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    locals.push(header, nameBytes, data);
  }
  return Buffer.concat([...locals, Buffer.alloc(22)]);
}

function makeTgz(metadata) {
  const data = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  header.write("package/package.json", 0, "utf8");
  header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  header.write("0000644\0", 100, "ascii");
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return gzipSync(Buffer.concat([header, padded, Buffer.alloc(1024)]));
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function readZipEntries(archive) {
  const files = new Map();
  let cursor = 0;
  while (cursor < archive.length && archive.readUInt32LE(cursor) === 0x04034b50) {
    const method = archive.readUInt16LE(cursor + 8);
    const compressedSize = archive.readUInt32LE(cursor + 18);
    const nameLength = archive.readUInt16LE(cursor + 26);
    const extraLength = archive.readUInt16LE(cursor + 28);
    const nameStart = cursor + 30;
    const name = archive.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(compressed) : compressed);
    cursor = dataStart + compressedSize;
  }
  return files;
}
