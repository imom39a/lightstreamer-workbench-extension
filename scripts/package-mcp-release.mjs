#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { deflateRawSync, gunzipSync, inflateRawSync } from "node:zlib";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, process.env.MCP_RELEASE_DIR ?? "release");
const crcTable = makeCrcTable();
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function makeReleaseManifest({ extension, firefox, firefoxSource, firefoxMetadata, agent, sourceSha, publish = false, publicationIntent, analytics = "verification", dirtyPaths = [] }) {
  const source = `${sourceSha ?? ""}`;
  if (!/^[a-f0-9]{40}$/.test(source)) throw new Error("Expected the full 40-character source commit SHA.");
  if (extension.version !== extension.manifestVersion) throw new Error("Extension package and manifest versions do not match.");
  if (!stableVersion.test(agent.version ?? "")) throw new Error("MCP companion version must be stable major.minor.patch semver.");
  if (agent.name !== "lightstreamer-workbench-agent") throw new Error("Unexpected MCP companion package name.");
  if (agent.sha !== source) throw new Error("MCP package provenance does not match the bundle source commit.");
  if (!Array.isArray(dirtyPaths)) throw new Error("Expected dirtyPaths to be an array.");
  if (dirtyPaths.length) throw new Error(`Release source has tracked uncommitted changes: ${dirtyPaths.join(", ")}`);
  const full = firefox !== undefined;
  if (full) {
    if (firefox.version !== extension.version || firefoxSource?.version !== extension.version) throw new Error("Chrome, Firefox and reviewer source versions do not match.");
    if (firefox.id !== "lightstreamer-workbench@imom39a") throw new Error("Unexpected Firefox add-on identity.");
    if (!publicationIntent || !["chrome", "firefox", "npm"].every(key => typeof publicationIntent[key] === "boolean") || Object.keys(publicationIntent).length !== 3) throw new Error("Release intent requires explicit Chrome, Firefox and npm booleans.");
    if (!["production", "verification"].includes(analytics)) throw new Error("Unknown analytics build configuration.");
  }
  return {
    format: full ? "lightstreamer-workbench-mcp-release-v2" : "lightstreamer-workbench-mcp-release-v1",
    state: "prepared-unpublished",
    source: { commit: source, workingTree: "clean", dirtyPaths: [] },
    publicationIntent: full ? publicationIntent : publish ? "guarded-publish-after-verification" : "not-planned",
    ...(full ? { build: { analytics }, firefox: { ...artifactDetails(firefox), id: firefox.id }, firefoxSource: artifactDetails(firefoxSource), firefoxMetadata: artifactDetails(firefoxMetadata) } : {}),
    extension: { ...artifactDetails(extension), ...(full ? { id: "kfpgbhfphbhkebglopimjhfnnmbifocf" } : {}) },
    mcp: { name: agent.name, version: agent.version, ...artifactDetails(agent) }
  };
}

function artifactDetails(artifact) {
  if (typeof artifact.file !== "string" || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
    throw new Error("Release artifact requires a filename, positive byte size and SHA-256.");
  }
  return { version: artifact.version, file: artifact.file, size: artifact.size, sha256: artifact.sha256 };
}

export async function createReleaseBundle({ releaseDir: directory, sourceSha, dirtyPaths = [], publicationIntent = { chrome: false, firefox: false, npm: false }, analytics = "verification" }) {
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
  const entries = [
    { name: `extension/${extensionName}`, path: join(rootDir, extensionName) },
    { name: `agent/${agentName}`, path: join(rootDir, agentName) },
    { name: `extension/${packageMetadata.name}-firefox-v${packageMetadata.version}.zip`, path: join(rootDir, `${packageMetadata.name}-firefox-v${packageMetadata.version}.zip`) },
    { name: `extension/${packageMetadata.name}-firefox-source-v${packageMetadata.version}.zip`, path: join(rootDir, `${packageMetadata.name}-firefox-source-v${packageMetadata.version}.zip`) },
    { name: "metadata/firefox-submission.json", path: join(rootDir, "firefox-submission.json") },
    { name: "agent-release.json", path: join(rootDir, "agent-release.json") }
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
  const firefoxManifest = readZipJson(entries[2].bytes, "manifest.json");
  if (firefoxManifest.manifest_version !== 3 || firefoxManifest.version !== packageMetadata.version || firefoxManifest.browser_specific_settings?.gecko?.id !== "lightstreamer-workbench@imom39a" || firefoxManifest.incognito !== "not_allowed" || !firefoxManifest.background?.scripts || firefoxManifest.background.service_worker) {
    throw new Error("Firefox ZIP manifest does not match the candidate version, identity or supported background/private browsing configuration.");
  }
  const reviewerPackage = readZipJson(entries[3].bytes, "package.json");
  const reviewerManifest = readZipJson(entries[3].bytes, "public/manifest.json");
  const reviewerReadme = readZipFile(entries[3].bytes, "README.md").toString("utf8");
  if (reviewerPackage.version !== packageMetadata.version || reviewerManifest.version !== packageMetadata.version || !reviewerReadme.includes(`Source commit: ${sourceSha}\n`)) throw new Error("Firefox reviewer source version or provenance does not match the candidate.");
  if (analytics === "production") assertStoreAnalyticsConfiguration(sourceAnalytics(entries[3].bytes));
  const firefoxNotes = JSON.parse(entries[4].bytes.toString("utf8"));
  if (!firefoxNotes.version?.release_notes?.["en-US"]?.trim() || !firefoxNotes.version?.approval_notes?.trim()) throw new Error("Firefox submission metadata requires release_notes.en-US and approval_notes.");
  const details = (entry, version = packageMetadata.version) => ({ version, file: entry.name, size: entry.bytes.length, sha256: sha256(entry.bytes) });
  const manifest = makeReleaseManifest({
    extension: { ...details(entries[0]), manifestVersion: publicManifest.version },
    firefox: { ...details(entries[2]), id: firefoxManifest.browser_specific_settings.gecko.id },
    firefoxSource: details(entries[3]),
    firefoxMetadata: details(entries[4]),
    agent: { name: plan.name, ...details(entries[1], plan.version), sha: plan.sha },
    sourceSha,
    publicationIntent,
    analytics,
    dirtyPaths
  });
  const files = entries.map(entry => ({ name: entry.name, bytes: entry.bytes }));
  const sums = files.map(entry => `${sha256(entry.bytes)}  ${entry.name}`).join("\n") + "\n";
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  files.push({ name: "release-manifest.json", bytes: manifestBytes });
  files.push({ name: "SHA256SUMS", bytes: Buffer.from(sums) });
  files.push({ name: "README.txt", bytes: Buffer.from(bundleReadme(manifest)) });
  const output = join(rootDir, `lightstreamer-workbench-mcp-v${packageMetadata.version}.zip`);
  await mkdir(rootDir, { recursive: true });
  await writeDeterministicZip(files, output);
  await writeFile(join(rootDir, "release-manifest.json"), manifestBytes);
  return { output, manifest, size: (await stat(output)).size };
}

// This is the public input seam shared by verification and publication. Every
// caller receives the bytes whose digest is bound by the immutable manifest.
export async function readFrozenRelease({ manifestPath, expectedSource }) {
  const directory = dirname(resolve(manifestPath));
  const canonicalDirectory = await realpath(directory);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.format !== "lightstreamer-workbench-mcp-release-v2" || manifest.state !== "prepared-unpublished") throw new Error("Expected a frozen v2 release manifest.");
  if (!/^[a-f0-9]{40}$/.test(expectedSource ?? "") || manifest.source?.commit !== expectedSource || manifest.source.workingTree !== "clean" || manifest.source.dirtyPaths?.length !== 0) throw new Error("Frozen release source does not match the expected clean source commit.");
  if (manifest.extension?.version !== manifest.firefox?.version || manifest.firefoxSource?.version !== manifest.extension?.version || !stableVersion.test(manifest.extension?.version ?? "") || !stableVersion.test(manifest.mcp?.version ?? "")) throw new Error("Frozen release browser/source versions do not match or are invalid.");
  if (manifest.extension.id !== "kfpgbhfphbhkebglopimjhfnnmbifocf" || manifest.firefox.id !== "lightstreamer-workbench@imom39a" || manifest.mcp.name !== "lightstreamer-workbench-agent") throw new Error("Frozen release package/browser identity mismatch.");
  if (!manifest.publicationIntent || Object.keys(manifest.publicationIntent).length !== 3 || !["chrome","firefox","npm"].every(channel => typeof manifest.publicationIntent[channel] === "boolean") || !["production","verification"].includes(manifest.build?.analytics)) throw new Error("Frozen release intent/build configuration is invalid.");
  const artifacts = {};
  for (const [channel,key] of [["chrome","extension"],["firefox","firefox"],["firefoxSource","firefoxSource"],["npm","mcp"],["metadata","firefoxMetadata"]]) {
    const details = artifactDetails(manifest[key]);
    const path = safePath(directory,details.file);
    const info = await lstat(path);
    const actualPath = await realpath(path);
    if (!info.isFile() || info.isSymbolicLink() || !inside(canonicalDirectory,actualPath)) throw new Error(`Frozen release input is not an owned regular file: ${details.file}`);
    const bytes = await readFile(path);
    if (bytes.length !== details.size || sha256(bytes) !== details.sha256) throw new Error(`Frozen release hash/size mismatch: ${details.file}`);
    artifacts[channel] = { ...manifest[key], path, bytes };
  }
  const chrome = readZipJson(artifacts.chrome.bytes,"manifest.json");
  const firefox = readZipJson(artifacts.firefox.bytes,"manifest.json");
  const sourcePackage = readZipJson(artifacts.firefoxSource.bytes,"package.json");
  const sourceManifest = readZipJson(artifacts.firefoxSource.bytes,"public/manifest.json");
  const sourceReadme = readZipFile(artifacts.firefoxSource.bytes,"README.md").toString("utf8");
  const npm = readTgzJson(artifacts.npm.bytes,"package/package.json");
  if (chrome.manifest_version !== 3 || firefox.manifest_version !== 3 || chrome.version !== manifest.extension.version || firefox.version !== manifest.extension.version || firefox.browser_specific_settings?.gecko?.id !== manifest.firefox.id || firefox.incognito !== "not_allowed" || !firefox.background?.scripts || firefox.background.service_worker) throw new Error("Frozen extension archive identity/version does not match the manifest.");
  if (sourcePackage.version !== manifest.extension.version || sourceManifest.version !== manifest.extension.version || !sourceReadme.includes(`Source commit: ${expectedSource}\n`)) throw new Error("Frozen Firefox reviewer source does not match the candidate source/version.");
  if (manifest.build.analytics === "production") assertStoreAnalyticsConfiguration(sourceAnalytics(artifacts.firefoxSource.bytes));
  if (npm.name !== manifest.mcp.name || npm.version !== manifest.mcp.version || npm.gitHead !== expectedSource) throw new Error("Frozen npm archive name/version/provenance mismatch.");
  const firefoxMetadata = JSON.parse(artifacts.metadata.bytes.toString("utf8"));
  if (!firefoxMetadata.version?.release_notes?.["en-US"]?.trim() || !firefoxMetadata.version?.approval_notes?.trim()) throw new Error("Frozen Firefox metadata requires release and reviewer notes.");
  delete artifacts.metadata;
  return { manifest, manifestSha256: sha256(manifestBytes), artifacts, firefoxMetadata };
}

export async function extractReleaseBundle({ bundlePath, directory, expectedSource }) {
  const entries = readZipEntries(await readFile(bundlePath));
  const manifestBytes = entries.get("release-manifest.json");
  if (!manifestBytes) throw new Error("Frozen bundle is missing its release manifest.");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const allowed = new Set(["release-manifest.json","SHA256SUMS","README.txt","agent-release.json",... ["extension","firefox","firefoxSource","mcp","firefoxMetadata"].map(key => manifest[key]?.file)]);
  if (manifest.format !== "lightstreamer-workbench-mcp-release-v2" || manifest.source?.commit !== expectedSource || entries.size !== allowed.size || [...entries.keys()].some(name => !allowed.has(name))) throw new Error("Frozen bundle source, manifest or entry inventory is invalid.");
  const destination = resolve(directory);
  await writeOwnedEntries(destination,entries);
  return readFrozenRelease({ manifestPath: join(destination,"release-manifest.json"),expectedSource });
}

export async function extractFrozenBrowser({ manifestPath, expectedSource, browser, directory }) {
  if (!["chrome","firefox"].includes(browser)) throw new Error("Frozen browser must be chrome or firefox.");
  const release = await readFrozenRelease({ manifestPath,expectedSource });
  const entries = readZipEntries(release.artifacts[browser].bytes);
  const destination = resolve(directory);
  await writeOwnedEntries(destination,entries);
  return destination;
}

async function writeOwnedEntries(destination,entries) {
  await emptyOwnedDirectory(destination);
  for (const [name,bytes] of entries) {
    const path = safePath(destination,name);
    await mkdir(dirname(path),{ recursive: true });
    await writeFile(path,bytes,{ flag: "wx" });
  }
}

function inside(directory,path) { const part=relative(directory,path); return !part.startsWith("..") && !isAbsolute(part); }
async function emptyOwnedDirectory(directory) {
  await mkdir(directory,{recursive:true});
  const info=await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(directory)).length) throw new Error("Frozen extraction requires a fresh empty owned directory.");
}
export function assertStoreAnalyticsConfiguration(configuration) {
  const measurementId=configuration.VITE_LSEW_GA_MEASUREMENT_ID,apiSecret=configuration.VITE_LSEW_GA_API_SECRET,debug=configuration.VITE_LSEW_GA_DEBUG;
  if (typeof measurementId!=="string" || !/^G-[A-Z0-9]+$/.test(measurementId) || typeof apiSecret!=="string" || !apiSecret.trim() || ![undefined,"","false","0"].includes(debug)) throw new Error("Production analytics configuration must be present with debug collection disabled.");
  if (/^G-(VERIFY|TEST|FAKE|EXAMPLE|LSEWTEST)/.test(measurementId) || /verification-only|synthetic|fake-secret|test-secret/i.test(apiSecret)) throw new Error("Synthetic analytics configuration cannot be used for publication.");
}
function sourceAnalytics(archive) {
  const text=readZipFile(archive,".env.production").toString("utf8"),configuration={};
  for (const key of ["VITE_LSEW_GA_MEASUREMENT_ID","VITE_LSEW_GA_API_SECRET","VITE_LSEW_GA_DEBUG"]) {
    const line=text.split("\n").find(line=>line.startsWith(`${key}=`));
    if (!line) throw new Error("Paired reviewer source is missing its analytics configuration.");
    configuration[key]=JSON.parse(line.slice(key.length+1));
  }
  return configuration;
}
function safePath(directory,name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || name.split("/").some(part => !part || part === "." || part === "..") || /^[a-z]:/i.test(name)) throw new Error(`Unsafe archive path: ${name}`);
  const path=resolve(directory,name);
  if (!inside(directory,path)) throw new Error(`Unsafe archive path: ${name}`);
  return path;
}

function readZipEntries(archive) {
  // Read the central directory rather than assuming local headers have sizes:
  // data descriptors are legal ZIP, including GitHub's outer artifact ZIPs.
  let end=-1;
  for (let cursor=archive.length-22;cursor>=Math.max(0,archive.length-65557);cursor--) {
    if (archive.readUInt32LE(cursor) === 0x06054b50 && cursor+22+archive.readUInt16LE(cursor+20) === archive.length) { end=cursor;break; }
  }
  if (end<0 || archive.readUInt16LE(end+4) || archive.readUInt16LE(end+6) || archive.readUInt16LE(end+8)!==archive.readUInt16LE(end+10)) throw new Error("Invalid or split ZIP archive.");
  const count=archive.readUInt16LE(end+10),centralSize=archive.readUInt32LE(end+12),centralStart=archive.readUInt32LE(end+16);
  if (count===65535 || count>20000 || centralStart+centralSize!==end) throw new Error("Unsupported ZIP directory bounds.");
  const files=new Map();let cursor=centralStart,total=0;
  for (let index=0;index<count;index++) {
    if (cursor+46>end || archive.readUInt32LE(cursor)!==0x02014b50) throw new Error("Invalid ZIP central entry.");
    const flags=archive.readUInt16LE(cursor+8),method=archive.readUInt16LE(cursor+10),crc=archive.readUInt32LE(cursor+16),packedSize=archive.readUInt32LE(cursor+20),size=archive.readUInt32LE(cursor+24);
    const nameSize=archive.readUInt16LE(cursor+28),extraSize=archive.readUInt16LE(cursor+30),commentSize=archive.readUInt16LE(cursor+32),offset=archive.readUInt32LE(cursor+42);
    const name=archive.toString("utf8",cursor+46,cursor+46+nameSize);
    safePath(root,name);
    if (files.has(name) || (archive.readUInt32LE(cursor+38)>>>16 & 0o170000)===0o120000 || flags&1 || ![0,8].includes(method) || offset+30>centralStart || cursor+46+nameSize+extraSize+commentSize>end) throw new Error("Unsafe, duplicate or unsupported ZIP entry.");
    if (archive.readUInt32LE(offset)!==0x04034b50 || archive.readUInt16LE(offset+8)!==method) throw new Error("ZIP local header mismatch.");
    const localNameSize=archive.readUInt16LE(offset+26),localExtraSize=archive.readUInt16LE(offset+28),dataStart=offset+30+localNameSize+localExtraSize;
    if (archive.toString("utf8",offset+30,offset+30+localNameSize)!==name || dataStart+packedSize>centralStart || (total+=size)>256*1024*1024) throw new Error("Invalid ZIP content bounds.");
    const packed=archive.subarray(dataStart,dataStart+packedSize);
    const bytes=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.max(1,size)});
    if (bytes.length!==size || crc32(bytes)!==crc) throw new Error("ZIP content size/checksum mismatch.");
    files.set(name,bytes);cursor+=46+nameSize+extraSize+commentSize;
  }
  if (cursor!==end) throw new Error("ZIP central directory size mismatch.");
  return files;
}

function readZipJson(archive, entryName) {
  return JSON.parse(readZipFile(archive, entryName).toString("utf8"));
}

function readZipFile(archive, entryName) {
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
      return bytes;
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
  return `Lightstreamer Workbench frozen release bundle\n\n` +
    `State: ${manifest.state} at bundle creation. Each channel requires explicit manual main intent and passing full verification before submission. Store review and public availability are tracked separately in channel receipts.\n` +
    `Source commit: ${manifest.source.commit}\n` +
    `Extension: ${manifest.extension.file} (version ${manifest.extension.version})\n` +
    `Firefox: ${manifest.firefox.file} (version ${manifest.firefox.version})\n` +
    `Firefox reviewer source: ${manifest.firefoxSource.file}\n` +
    `Companion: ${manifest.mcp.file} (version ${manifest.mcp.version})\n\n` +
    `SHA256SUMS lists the digests for all embedded inputs. In Windows PowerShell, use Get-FileHash -Algorithm SHA256 on each file and compare with that list.\n` +
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
