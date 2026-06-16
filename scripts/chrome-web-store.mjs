#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiBase = "https://chromewebstore.googleapis.com";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...rawArgs] = process.argv.slice(2);
const args = parseArgs(rawArgs);

if (!command || command === "help" || args.help) {
  printHelp();
  process.exit(command ? 0 : 1);
}

try {
  switch (command) {
    case "upload":
      await uploadPackage(args);
      break;
    case "publish":
      await publishItem(args);
      break;
    case "status":
      await fetchStatus(args);
      break;
    case "rollout":
      await setRollout(args);
      break;
    case "cancel":
      await cancelSubmission(args);
      break;
    default:
      fail(`Unknown command "${command}". Use "help" for usage.`);
  }
} catch (error) {
  fail(error.message);
}

async function uploadPackage(options) {
  const resourceName = getResourceName(options);
  const accessToken = getAccessToken(options);
  const zipPath = await resolveZipPath(options);
  const zipBuffer = await readFile(zipPath);
  const uploadType = String(options.uploadType ?? process.env.CWS_UPLOAD_TYPE ?? "media");

  let body = zipBuffer;
  let contentType = "application/zip";

  if (uploadType === "multipart") {
    const multipart = createMultipartBody(zipBuffer);
    body = multipart.body;
    contentType = multipart.contentType;
  } else if (uploadType !== "media") {
    throw new Error(`Unsupported upload type "${uploadType}". Use media or multipart.`);
  }

  const response = await apiRequest({
    accessToken,
    body,
    contentType,
    method: "POST",
    url: `${apiBase}/upload/v2/${resourceName}:upload?uploadType=${uploadType}`
  });

  console.log(`Uploaded: ${zipPath}`);
  printJson(response);
}

async function publishItem(options) {
  const deployPercentage = parseDeployPercentage(options.deployPercent);
  const requestBody = {
    blockOnWarnings: !options.allowWarnings,
    publishType: options.defaultPublish ? "DEFAULT_PUBLISH" : "STAGED_PUBLISH"
  };

  if (options.skipReview) {
    requestBody.skipReview = true;
  }

  if (deployPercentage !== null) {
    requestBody.deployInfos = [{ deployPercentage }];
  }

  const response = await apiRequest({
    accessToken: getAccessToken(options),
    body: JSON.stringify(requestBody),
    contentType: "application/json",
    method: "POST",
    url: `${apiBase}/v2/${getResourceName(options)}:publish`
  });

  printJson(response);
}

async function fetchStatus(options) {
  const response = await apiRequest({
    accessToken: getAccessToken(options),
    method: "GET",
    url: `${apiBase}/v2/${getResourceName(options)}:fetchStatus`
  });

  printJson(response);
}

async function setRollout(options) {
  const deployPercentage = parseDeployPercentage(options.deployPercent);
  if (deployPercentage === null) {
    throw new Error("rollout requires --deploy-percent <0-100>.");
  }

  await apiRequest({
    accessToken: getAccessToken(options),
    body: JSON.stringify({ deployPercentage }),
    contentType: "application/json",
    method: "POST",
    url: `${apiBase}/v2/${getResourceName(options)}:setPublishedDeployPercentage`
  });

  console.log(`Deploy percentage set to ${deployPercentage}.`);
}

async function cancelSubmission(options) {
  await apiRequest({
    accessToken: getAccessToken(options),
    method: "POST",
    url: `${apiBase}/v2/${getResourceName(options)}:cancelSubmission`
  });

  console.log("Active submission canceled.");
}

async function apiRequest({ accessToken, body, contentType, method, url }) {
  const headers = {
    Authorization: `Bearer ${accessToken}`
  };

  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  const response = await fetch(url, {
    body,
    headers,
    method
  });

  const text = await response.text();
  const payload = parseJsonResponse(text);

  if (!response.ok) {
    const detail = payload ? JSON.stringify(payload, null, 2) : text;
    throw new Error(`${method} ${url} failed with ${response.status}:\n${detail}`);
  }

  return payload ?? {};
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith("--")) {
      fail(`Unexpected argument "${arg}". Use "help" for usage.`);
    }

    const separatorIndex = arg.indexOf("=");
    const rawKey = arg.slice(2, separatorIndex === -1 ? undefined : separatorIndex);
    const key = toCamelCase(rawKey);

    if (["allowWarnings", "defaultPublish", "help", "skipReview"].includes(key)) {
      parsed[key] = true;
      continue;
    }

    if (separatorIndex !== -1) {
      parsed[key] = arg.slice(separatorIndex + 1);
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

function getResourceName(options) {
  const explicit = options.resource ?? process.env.CWS_RESOURCE;
  if (explicit) {
    assertResourceName(explicit);
    return explicit;
  }

  const publisherId = options.publisherId ?? process.env.CWS_PUBLISHER_ID;
  const itemId = options.itemId ?? process.env.CWS_EXTENSION_ID ?? process.env.CWS_ITEM_ID;

  if (!publisherId || !itemId) {
    throw new Error(
      "Missing Chrome Web Store item identity. Set CWS_PUBLISHER_ID and CWS_EXTENSION_ID, or pass --resource publishers/<publisherId>/items/<itemId>."
    );
  }

  const resource = `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;
  assertResourceName(resource);
  return resource;
}

function assertResourceName(resourceName) {
  if (!/^publishers\/[^/]+\/items\/[^/]+$/.test(resourceName)) {
    throw new Error(
      `Invalid resource "${resourceName}". Expected publishers/<publisherId>/items/<itemId>.`
    );
  }
}

function getAccessToken(options) {
  const accessToken = options.accessToken ?? process.env.CWS_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "Missing CWS_ACCESS_TOKEN. Generate one with gcloud auth print-access-token using the https://www.googleapis.com/auth/chromewebstore scope."
    );
  }
  return accessToken;
}

async function resolveZipPath(options) {
  const selectedPath = options.zip ?? process.env.CWS_ZIP;
  if (selectedPath) {
    const resolved = resolve(projectRoot, selectedPath);
    if (!existsSync(resolved)) {
      throw new Error(`ZIP file not found: ${resolved}`);
    }
    return resolved;
  }

  const inferred = await findLatestReleaseZip();
  if (!inferred) {
    throw new Error("No release ZIP found. Run npm run release:package or pass --zip <path>.");
  }

  return inferred;
}

async function findLatestReleaseZip() {
  const releaseDir = resolve(projectRoot, "release");
  if (!existsSync(releaseDir)) {
    return null;
  }

  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const entries = await readdir(releaseDir);
  const zipEntries = [];

  for (const entry of entries) {
    if (!entry.endsWith(".zip")) {
      continue;
    }

    const absolutePath = resolve(releaseDir, entry);
    const entryStat = await stat(absolutePath);
    const versionMatch = entry.includes(`-v${packageJson.version}`);
    zipEntries.push({ absolutePath, mtimeMs: entryStat.mtimeMs, versionMatch });
  }

  zipEntries.sort((left, right) => {
    if (left.versionMatch !== right.versionMatch) {
      return left.versionMatch ? -1 : 1;
    }
    return right.mtimeMs - left.mtimeMs;
  });

  return zipEntries[0]?.absolutePath ?? null;
}

function createMultipartBody(zipBuffer) {
  const boundary = `cws-${randomBytes(12).toString("hex")}`;
  const prefix = Buffer.from(
    [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      "{}",
      `--${boundary}`,
      "Content-Type: application/zip",
      "",
      ""
    ].join("\r\n"),
    "utf8"
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  return {
    body: Buffer.concat([prefix, zipBuffer, suffix]),
    contentType: `multipart/related; boundary=${boundary}`
  };
}

function parseDeployPercentage(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid deploy percentage "${value}". Use an integer from 0 to 100.`);
  }

  return parsed;
}

function parseJsonResponse(text) {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/chrome-web-store.mjs <command> [options]

Commands:
  upload                  Upload a ZIP package to an existing Chrome Web Store item.
  publish                 Submit the uploaded package for review. Defaults to staged publish.
  status                  Fetch item, submission, upload, and deployment status.
  rollout                 Increase published deploy percentage.
  cancel                  Cancel the active pending submission, if present.

Common options:
  --resource <name>        publishers/<publisherId>/items/<itemId>. Env: CWS_RESOURCE.
  --publisher-id <id>      Publisher ID. Env: CWS_PUBLISHER_ID.
  --item-id <id>           Extension item ID. Env: CWS_EXTENSION_ID or CWS_ITEM_ID.
  --access-token <token>   OAuth access token. Env: CWS_ACCESS_TOKEN.

Upload options:
  --zip <path>             ZIP to upload. Defaults to latest release/*.zip. Env: CWS_ZIP.
  --upload-type <type>     media or multipart. Defaults to media. Env: CWS_UPLOAD_TYPE.

Publish options:
  --default-publish        Publish automatically after review instead of staging.
  --deploy-percent <0-100> Initial deployment percentage.
  --skip-review            Ask Chrome Web Store to skip review when eligible.
  --allow-warnings         Do not fail the publish request on validation warnings.

Examples:
  npm run release:upload -- --zip release/lightstreamer-event-workbench-v<version>.zip
  npm run release:publish -- --deploy-percent 5
  npm run release:publish -- --default-publish
  npm run release:status
  npm run release:rollout -- --deploy-percent 100
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
