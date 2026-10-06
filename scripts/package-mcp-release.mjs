#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { deflateRawSync, gunzipSync, inflateRawSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, process.env.MCP_RELEASE_DIR ?? "release");
const crcTable = makeCrcTable();
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function makeReleaseManifest({ extension, agent, sourceSha, publish = false, dirtyPaths = [] }) {
  const source = `${sourceSha ?? ""}`;
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("Expected the full 40-character source commit SHA.");
  if (extension.version !== extension.manifestVersion) throw new Error("Extension package and manifest versions do not match.");
  if (!stableVersion.test(agent.version ?? "")) throw new Error("MCP companion version must be stable major.minor.patch semver.");
  if (agent.name !== "lightstreamer-workbench-agent") throw new Error("Unexpected MCP companion package name.");
  if (agent.sha !== source) throw new Error("MCP package provenance does not match the bundle source commit.");
  if (!Array.isArray(dirtyPaths)) throw new Error("Expected dirtyPaths to be an array.");
  if (dirtyPaths.length) throw new Error(`Release source has tracked uncommitted changes: ${dirtyPaths.join(", ")}`);
  return {
    format: "lightstreamer-workbench-mcp-release-v1",
    state: "prepared-unpublished",
    source: { commit: source, workingTree: "clean", dirtyPaths: [] },
    publicationIntent: publish ? "guarded-publish-after-verification" : "not-planned",
    extension: artifactDetails(extension),
    mcp: { name: agent.name, version: agent.version, ...artifactDetails(agent) }
  };
}

function artifactDetails(artifact) {
  if (typeof artifact.file !== "string" || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
    throw new Error("Release artifact requires a filename, positive byte size and SHA-256.");
  }
  return { version: artifact.version, file: artifact.file, size: artifact.size, sha256: artifact.sha256 };
}

export async function createReleaseBundle({ releaseDir: directory, sourceSha, dirtyPaths = [] }) {
  const rootDir = resolve(directory);
  const packageMetadata = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const publicManifest = JSON.parse(await readFile(resolve(root, "public/manifest.json"), "utf8"));
  const sourceAgent = JSON.parse(await readFile(resolve(root, "agent/package.json"), "utf8"));
  const plan = JSON.parse(await readFile(join(rootDir, "agent-release.json"), "utf8"));
  if (typeof plan.publish !== "boolean") throw new Error("MCP release plan must state its publication intent.");
  if (publicManifest.version !== packageMetadata.version) throw new Error("Extension package and source manifest versions do not match.");
  if (sourceAgent.name !== plan.name || !stableVersion.test(plan.version ?? "")) throw new Error("MCP release plan does not match the source package identity or stable version.");
  if (plan.sha !== sourceSha) throw new Error("MCP package provenance does not match the bundle source commit.");
  if (plan.filename !== `${plan.name.replace(/^@/, "").replaceAll("/", "-")}-${plan.version}.tgz`) {
    throw new Error("MCP release plan filename does not match its package identity and version.");
  }
  const extensionName = `${packageMetadata.name}-v${packageMetadata.version}.zip`;
  const agentName = `${plan.name}-${plan.version}.tgz`;
  const extensionPath = join(rootDir, extensionName);
  const agentPath = join(rootDir, agentName);
  const entries = [
    { name: `extension/${extensionName}`, path: extensionPath },
    { name: `agent/${agentName}`, path: agentPath }
  ];
  for (const item of entries) {
    const info = await stat(item.path).catch(() => null);
    if (!info?.isFile() || info.size === 0) throw new Error(`Missing or empty release input: ${item.path}`);
    item.bytes = await readFile(item.path);
  }
  const extensionManifest = readZipJson(entries[0].bytes, "manifest.json");
  if (extensionManifest.manifest_version !== 3 || extensionManifest.version !== packageMetadata.version) {
    throw new Error("Extension ZIP manifest does not match the candidate version or Manifest V3.");
  }
  const packedAgent = readTgzJson(entries[1].bytes, "package/package.json");
  if (packedAgent.name !== sourceAgent.name || packedAgent.name !== plan.name || packedAgent.version !== plan.version || packedAgent.gitHead !== sourceSha) {
    throw new Error("npm tarball package metadata does not match the source package, release plan and source commit.");
  }
  const manifest = makeReleaseManifest({
    extension: { version: packageMetadata.version, manifestVersion: publicManifest.version, file: entries[0].name, size: entries[0].bytes.length, sha256: sha256(entries[0].bytes) },
    agent: { name: plan.name, version: plan.version, sha: plan.sha, file: entries[1].name, size: entries[1].bytes.length, sha256: sha256(entries[1].bytes) },
    sourceSha,
    publish: plan.publish,
    dirtyPaths
  });
  const files = entries.map(entry => ({ name: entry.name, bytes: entry.bytes }));
  const sums = files.map(entry => `${sha256(entry.bytes)}  ${entry.name}`).join("\n") + "\n";
  files.push({ name: "release-manifest.json", bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  files.push({ name: "SHA256SUMS", bytes: Buffer.from(sums) });
  files.push({ name: "README.txt", bytes: Buffer.from(bundleReadme(manifest)) });
  const output = join(rootDir, `lightstreamer-workbench-mcp-v${packageMetadata.version}.zip`);
  await mkdir(rootDir, { recursive: true });
  await writeDeterministicZip(files, output);
  return { output, manifest, size: (await stat(output)).size };
}

function readZipJson(archive, entryName) {
  let cursor = 0;
  while (cursor + 30 <= archive.length && archive.readUInt32LE(cursor) === 0x04034b50) {
    const method = archive.readUInt16LE(cursor + 8);
    const compressedSize = archive.readUInt32LE(cursor + 18);
    const nameLength = archive.readUInt16LE(cursor + 26);
    const extraLength = archive.readUInt16LE(cursor + 28);
    const nameStart = cursor + 30;
    const name = archive.toString("utf8", nameStart, nameStart + nameLength);
    const dataStart = nameStart + nameLength + extraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    if (name === entryName) {
      const bytes = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!bytes) throw new Error(`Unsupported compression method for ${entryName}.`);
      return JSON.parse(bytes.toString("utf8"));
    }
    cursor = dataStart + compressedSize;
  }
  throw new Error(`ZIP archive is missing ${entryName}.`);
}

function readTgzJson(archive, entryName) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = header.toString("ascii", 124, 136).replace(/\0.*$/, "").trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("Invalid tar entry size in npm archive.");
    const size = Number.parseInt(sizeText, 8);
    const contentStart = offset + 512;
    if (path === entryName) return JSON.parse(tar.subarray(contentStart, contentStart + size).toString("utf8"));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  throw new Error(`npm tarball is missing ${entryName}.`);
}

function bundleReadme(manifest) {
  return `Lightstreamer Workbench MCP release bundle\n\n` +
    `State: ${manifest.state} at bundle creation. This archive is a preparation artifact; any npm publication can happen only after portable verification and only when its guard is enabled. The Chrome Web Store is not published by this workflow.\n` +
    `Source commit: ${manifest.source.commit}\n` +
    `Extension: ${manifest.extension.file} (version ${manifest.extension.version})\n` +
    `Companion: ${manifest.mcp.file} (version ${manifest.mcp.version})\n\n` +
    `SHA256SUMS lists the digests for both embedded artifacts. In Windows PowerShell, use Get-FileHash -Algorithm SHA256 on each file and compare with that list.\n` +
    `Extract this bundle. Unzip the extension archive into a folder and load that folder as an unpacked extension in chrome://extensions.\n` +
    `Install the companion tarball with npm install --prefix ./workbench-companion ./agent/${manifest.mcp.file.split("/").at(-1)}\n` +
    `Then run: node ./workbench-companion/node_modules/lightstreamer-workbench-agent/dist/cli.mjs setup --local --extension-id YOUR_UNPACKED_EXTENSION_ID\n` +
    `The installed companion guide is ./workbench-companion/node_modules/lightstreamer-workbench-agent/README.md; Windows guidance is in WINDOWS.md.\n` +
    `See https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/ for the public setup guide.\n`;
}

async function main() {
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceSha = process.env.GITHUB_SHA ?? headSha;
  if (sourceSha !== headSha) throw new Error(`Requested source SHA ${sourceSha} does not match checked-out HEAD ${headSha}.`);
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
  const dirtyPaths = status.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).replaceAll("\\", "/"));
  const result = await createReleaseBundle({ releaseDir, sourceSha, dirtyPaths });
  console.log(`Prepared unpublished MCP release: ${result.output} (${result.size} bytes, source ${sourceSha})`);
}

export async function writeDeterministicZip(files, output) {
  const local = [], central = [];
  let offset = 0;
  const date = (1 << 5) | 1; // 1980-01-01
  for (const file of files) {
    if (file.name.startsWith("/") || file.name.split("/").includes("..")) throw new Error(`Unsafe archive path: ${file.name}`);
    const name = Buffer.from(file.name, "utf8");
    const packed = deflateRawSync(file.bytes, { level: 9 });
    const crc = crc32(file.bytes);
    if (offset + packed.length > 0xffffffff || file.bytes.length > 0xffffffff) throw new Error("MCP bundle exceeds ZIP32 limits.");
    const entry = { name, packed, crc, size: file.bytes.length, offset, date };
    local.push(localHeader(entry), packed);
    central.push(centralHeader(entry));
    offset += 30 + name.length + packed.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralStart, 16);
  await writeFile(output, Buffer.concat([...local, ...central, end]));
}

function localHeader(entry) {
  const out = Buffer.alloc(30);
  out.writeUInt32LE(0x04034b50, 0); out.writeUInt16LE(20, 4); out.writeUInt16LE(0x800, 6); out.writeUInt16LE(8, 8);
  out.writeUInt16LE(entry.date, 12); out.writeUInt32LE(entry.crc, 14); out.writeUInt32LE(entry.packed.length, 18);
  out.writeUInt32LE(entry.size, 22); out.writeUInt16LE(entry.name.length, 26);
  return Buffer.concat([out, entry.name]);
}

function centralHeader(entry) {
  const out = Buffer.alloc(46);
  out.writeUInt32LE(0x02014b50, 0); out.writeUInt16LE(20, 4); out.writeUInt16LE(20, 6); out.writeUInt16LE(0x800, 8);
  out.writeUInt16LE(8, 10); out.writeUInt16LE(entry.date, 14); out.writeUInt32LE(entry.crc, 16);
  out.writeUInt32LE(entry.packed.length, 20); out.writeUInt32LE(entry.size, 24); out.writeUInt16LE(entry.name.length, 28);
  out.writeUInt32LE(0o100644 * 0x10000, 38); out.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([out, entry.name]);
}

function makeCrcTable() {
  return Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
