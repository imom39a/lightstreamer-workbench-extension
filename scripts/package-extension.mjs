#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deterministicZipDate = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const crcTable = createCrcTable();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const format = String(args.format ?? "zip").toLowerCase();
if (!["zip", "crx", "both"].includes(format)) {
  fail(`Unsupported --format "${format}". Use zip, crx, or both.`);
}

const packageJson = await readJson(resolve(projectRoot, "package.json"));
const distDir = resolve(projectRoot, args.dist ?? "dist");
const releaseDir = resolve(projectRoot, args.outDir ?? "release");
const artifactBaseName = `${packageJson.name}-v${packageJson.version}`;

if (!args.skipTests) {
  run("npm", ["test"]);
}

if (!args.skipBuild) {
  run("npm", ["run", "build"]);
}

const manifest = await readJson(resolve(distDir, "manifest.json"));
await validateExtensionBuild({ manifest, packageJson, distDir });
await mkdir(releaseDir, { recursive: true });

if (format === "zip" || format === "both") {
  const zipPath = resolve(releaseDir, `${artifactBaseName}.zip`);
  await rm(zipPath, { force: true });
  await writeZipFromDirectory(distDir, zipPath);
  console.log(`ZIP: ${zipPath}`);
}

if (format === "crx" || format === "both") {
  const crxPath = await packCrx({
    artifactBaseName,
    chromePath: args.chromePath ?? process.env.CHROME_PATH,
    distDir,
    keyPath: args.crxKey ?? process.env.CRX_KEY_PATH,
    releaseDir
  });
  console.log(`CRX: ${crxPath}`);
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith("--")) {
      fail(`Unexpected argument "${arg}". Use --help for usage.`);
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = toCamelCase(rawKey);

    if (["help", "skipBuild", "skipTests"].includes(key)) {
      parsed[key] = true;
      continue;
    }

    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${rawKey}.`);
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: projectRoot,
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} exited with ${result.status}.`);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function validateExtensionBuild({ distDir, manifest, packageJson }) {
  if (manifest.manifest_version !== 3) {
    fail(`Expected Manifest V3 build, got manifest_version=${manifest.manifest_version}.`);
  }

  if (manifest.version !== packageJson.version) {
    fail(
      `Version mismatch: package.json is ${packageJson.version}, dist/manifest.json is ${manifest.version}.`
    );
  }

  const requiredFiles = [
    "manifest.json",
    manifest.devtools_page,
    manifest.background?.service_worker,
    ...((manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []))
  ].filter(Boolean);

  for (const file of requiredFiles) {
    const path = resolve(distDir, file);
    try {
      await access(path, constants.R_OK);
    } catch {
      fail(`Built extension is missing required file: ${file}`);
    }
  }
}

async function writeZipFromDirectory(sourceDir, zipPath) {
  const files = await listZipFiles(sourceDir);
  if (!files.some((file) => file.archivePath === "manifest.json")) {
    fail("ZIP would not contain manifest.json at the archive root.");
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const { dosDate, dosTime } = toDosDateTime(deterministicZipDate);

  for (const file of files) {
    const data = await readFile(file.absolutePath);
    const nameBuffer = Buffer.from(file.archivePath, "utf8");
    const crc = crc32(data);

    if (data.byteLength > 0xffffffff || offset > 0xffffffff) {
      fail("ZIP64 is not supported by this local packager.");
    }

    const entry = {
      crc,
      data,
      dosDate,
      dosTime,
      nameBuffer,
      offset,
      size: data.byteLength
    };

    const localHeader = createLocalHeader(entry);
    localParts.push(localHeader, data);
    centralParts.push(createCentralDirectoryHeader(entry));
    offset += localHeader.byteLength + data.byteLength;
  }

  const centralDirectoryStart = offset;
  const centralDirectorySize = centralParts.reduce((size, part) => size + part.byteLength, 0);
  const end = createEndOfCentralDirectory({
    centralDirectorySize,
    centralDirectoryStart,
    entryCount: files.length
  });

  await writeFile(zipPath, Buffer.concat([...localParts, ...centralParts, end]));
}

async function listZipFiles(sourceDir) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (shouldSkip(entry.name)) {
        continue;
      }

      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const archivePath = relative(sourceDir, absolutePath).split(sep).join("/");
      files.push({ absolutePath, archivePath });
    }
  }

  await visit(sourceDir);
  return files;
}

function shouldSkip(name) {
  return (
    name === ".DS_Store" ||
    name === "__MACOSX" ||
    name.endsWith(".map") ||
    name.endsWith(".pem") ||
    name.endsWith(".crx") ||
    name.endsWith(".zip")
  );
}

function createLocalHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(entry.dosTime, 10);
  header.writeUInt16LE(entry.dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBuffer.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.nameBuffer]);
}

function createCentralDirectoryHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBuffer.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.nameBuffer]);
}

function createEndOfCentralDirectory({ centralDirectorySize, centralDirectoryStart, entryCount }) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryStart, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

function toDosDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function packCrx({ artifactBaseName, chromePath, distDir, keyPath, releaseDir }) {
  const chrome = findChromeExecutable(chromePath);
  const outputCrx = resolve(dirname(distDir), `${basename(distDir)}.crx`);
  const outputPem = resolve(dirname(distDir), `${basename(distDir)}.pem`);

  await rm(outputCrx, { force: true });
  if (!keyPath) {
    await rm(outputPem, { force: true });
  }

  const chromeArgs = [`--pack-extension=${distDir}`];
  if (keyPath) {
    const resolvedKeyPath = resolve(projectRoot, keyPath);
    if (!existsSync(resolvedKeyPath)) {
      fail(`CRX key not found: ${resolvedKeyPath}`);
    }
    chromeArgs.push(`--pack-extension-key=${resolvedKeyPath}`);
  }

  const result = spawnSync(chrome, chromeArgs, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error) {
    fail(`Chrome failed to pack CRX: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Chrome CRX pack exited with ${result.status}.`);
  }

  if (!existsSync(outputCrx)) {
    fail(`Chrome did not create expected CRX: ${outputCrx}`);
  }

  const crxPath = resolve(releaseDir, `${artifactBaseName}.crx`);
  await rm(crxPath, { force: true });
  await rename(outputCrx, crxPath);

  if (existsSync(outputPem)) {
    const pemPath = resolve(releaseDir, `${artifactBaseName}.pem`);
    await rm(pemPath, { force: true });
    await rename(outputPem, pemPath);
    console.warn(
      `Generated CRX key: ${pemPath}. Keep it private and reuse it for future CRX builds.`
    );
  }

  return crxPath;
}

function findChromeExecutable(explicitPath) {
  if (explicitPath) {
    if (!explicitPath.includes("/") && !explicitPath.includes("\\")) {
      const found = findOnPath(explicitPath);
      if (found) {
        return found;
      }
    }

    const resolved = resolve(projectRoot, explicitPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    if (existsSync(explicitPath)) {
      return explicitPath;
    }
    fail(`Chrome executable not found at CHROME_PATH/--chrome-path: ${explicitPath}`);
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome"
  ];

  for (const candidate of candidates) {
    if (candidate.includes("/")) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }

    const found = findOnPath(candidate);
    if (found) {
      return found;
    }
  }

  fail("Chrome executable not found. Set CHROME_PATH or package ZIP only.");
}

function findOnPath(command) {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }

  return result.stdout.split(/\r?\n/).find(Boolean) ?? null;
}

function printHelp() {
  console.log(`Usage: node scripts/package-extension.mjs [options]

Options:
  --format zip|crx|both     Artifact format to create. Defaults to zip.
  --out-dir <path>          Output directory. Defaults to release.
  --dist <path>             Built extension directory. Defaults to dist.
  --skip-tests              Do not run npm test before packaging.
  --skip-build              Package the existing dist directory.
  --chrome-path <path>      Chrome executable for CRX packing. Env: CHROME_PATH.
  --crx-key <path>          Existing CRX private key. Env: CRX_KEY_PATH.
  --help                    Show this help.

Examples:
  npm run release:package
  npm run release:package -- --skip-tests
  npm run release:package:all -- --crx-key private/lightstreamer-event-workbench.pem
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
