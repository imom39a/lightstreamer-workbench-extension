import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { releaseGates } from "./release-gates.mjs";

const channels = ["chrome", "firefox", "npm"];
const artifactFields = { chrome: "extension", firefox: "firefox", firefoxSource: "firefoxSource", npm: "mcp" };
const chromeId = "kfpgbhfphbhkebglopimjhfnnmbifocf";
const firefoxId = "lightstreamer-workbench@imom39a";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const validSha = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const validDigest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function submitReleaseChannel({ channel, release, context, verification, receiptPath, request = fetch, runNpm = executeNpm, env = process.env, visibilityAttempts = 31, delay = waitForRegistry }) {
  if (release?.manifest?.publicationIntent?.[channel] !== true) {
    throw new Error("Publication requires explicit frozen channel intent.");
  }
  validateRelease(channel, release, context, env);
  if (context.eventName !== "workflow_dispatch" || context.ref !== "refs/heads/main"
    || context.expectedSource !== release.manifest.source.commit
    || release.manifest.build?.analytics !== "production"
    || (env.GITHUB_EVENT_NAME !== undefined && env.GITHUB_EVENT_NAME !== context.eventName)
    || (env.GITHUB_REF !== undefined && env.GITHUB_REF !== context.ref)
    || (env.GITHUB_RUN_ID !== undefined && env.GITHUB_RUN_ID !== context.runId)) {
    throw new Error("Publication requires a main dispatch for the expected production release source.");
  }
  if (verification?.format !== "lightstreamer-workbench-release-verification-v1"
    || verification.scope !== "release" || verification.passed !== true
    || verification.sourceCommit !== release.manifest.source.commit
    || verification.manifestSha256 !== release.manifestSha256 || verification.runId !== context.runId
    || releaseGates.some(gate => verification.jobs?.[gate] !== "success")) {
    throw new Error("Publication requires all full release verification gates for this source, manifest, and run.");
  }
  const receipt = await loadReceipt(channel, release, context, receiptPath);
  try {
    if (channel === "chrome") return await submitChrome({ release, receipt, receiptPath, request, env });
    if (channel === "npm") return await submitNpm({ release, receipt, receiptPath, request, runNpm, env, visibilityAttempts, delay });
    if (channel === "firefox") return await submitFirefox({ release, receipt, receiptPath, request, env });
  } catch (error) {
    await recordAttention(receiptPath, receipt, error);
    throw safeError(error);
  }
}

export async function reconcileReleaseChannel({ channel, release, context, receiptPath, request = fetch, env = process.env }) {
  validateRelease(channel, release, context, env);
  const receipt = await loadReceipt(channel, release, context, receiptPath);
  try {
    if (channel === "chrome") return await submitChrome({ release, receipt, receiptPath, request, env, readOnly: true });
    if (channel === "npm") return await submitNpm({ release, receipt, receiptPath, request, readOnly: true });
    if (channel === "firefox") return await submitFirefox({ release, receipt, receiptPath, request, env, readOnly: true });
  } catch (error) {
    await recordAttention(receiptPath, receipt, error);
    throw safeError(error);
  }
}

function validateRelease(channel, release, context, env) {
  const manifest = release?.manifest;
  if (!channels.includes(channel) || manifest?.format !== "lightstreamer-workbench-mcp-release-v2"
    || manifest.state !== "prepared-unpublished" || !validDigest(release.manifestSha256)) {
    throw new Error("Invalid frozen release identity.");
  }
  if (typeof context?.runId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(context.runId)
    || !Number.isSafeInteger(context.runAttempt) || context.runAttempt < 1) throw new Error("Release context requires a run identity and positive attempt.");
  if (!validSha(manifest.source?.commit) || manifest.source.workingTree !== "clean"
    || !Array.isArray(manifest.source.dirtyPaths) || manifest.source.dirtyPaths.length > 0
    || context?.sourceSha !== manifest.source.commit
    || (env.GITHUB_SHA && env.GITHUB_SHA !== manifest.source.commit)) {
    throw new Error("Frozen release source must match the clean checkout and actual provenance.");
  }
  if (manifest.extension?.id !== chromeId || manifest.firefox?.id !== firefoxId
    || manifest.mcp?.name !== "lightstreamer-workbench-agent") throw new Error("Invalid release browser or npm identity.");
  if (!/^\d+(?:\.\d+){2,3}$/.test(manifest.extension.version)
    || manifest.extension.version !== manifest.firefox.version
    || manifest.firefoxSource?.version !== manifest.firefox.version
    || !/^\d+\.\d+\.\d+$/.test(manifest.mcp.version)) throw new Error("Release browser versions must match the paired source version.");
  for (const [key, field] of Object.entries(artifactFields)) {
    const entry = manifest[field];
    const artifact = release.artifacts?.[key];
    if (!artifact || !isAbsolute(artifact.path ?? "") || !Buffer.isBuffer(artifact.bytes)
      || !validDigest(entry?.sha256) || !safeFilename(entry.file) || entry.size < 1 || !Number.isSafeInteger(entry.size)
      || artifact.bytes.length !== entry.size || digest(artifact.bytes) !== entry.sha256
      || artifact.sha256 !== entry.sha256 || artifact.size !== entry.size || artifact.file !== entry.file
      || artifact.version !== entry.version) throw new Error(`Frozen release artifact ${key} does not match the manifest.`);
  }
  const metadata = manifest.firefoxMetadata;
  const notes = release.firefoxMetadata?.version;
  if (!validDigest(metadata?.sha256) || !safeFilename(metadata.file) || !Number.isSafeInteger(metadata.size) || metadata.size < 1
    || !notes || typeof notes !== "object" || Array.isArray(notes) || typeof notes.approval_notes !== "string" || !notes.approval_notes.trim()
    || !notes.release_notes || typeof notes.release_notes !== "object" || Array.isArray(notes.release_notes)
    || Object.entries(notes.release_notes).length === 0 || Object.entries(notes.release_notes).some(([language, note]) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) || typeof note !== "string" || !note.trim())
    || Object.keys(notes).some(key => !["release_notes", "approval_notes", "license"].includes(key))
    || (notes.license !== undefined && (typeof notes.license !== "string" || !/^[A-Za-z0-9_.-]+$/.test(notes.license)))) {
    throw new Error("Frozen Firefox release metadata is missing, unsafe, or invalid.");
  }
}
function safeFilename(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && value.split("/").every(part => part && part !== "." && part !== "..");
}

function publicError(code, message) { return Object.assign(new Error(message), { code }); }
function safeError(error) {
  return error?.code?.startsWith?.("RELEASE_") ? error : publicError("RELEASE_OPERATION_FAILED", "Release operation failed; inspect the saved receipt before retrying.");
}
async function saveReceipt(path, receipt) {
  receipt.updatedAt = new Date().toISOString();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return receipt;
}
function hashes(release) {
  return Object.fromEntries([...Object.entries(artifactFields).map(([key, field]) => [key, release.manifest[field].sha256]), ["firefoxMetadata", release.manifest.firefoxMetadata.sha256]]);
}
async function loadReceipt(channel, release, context, path) {
  if (!isAbsolute(path ?? "")) throw publicError("RELEASE_RECEIPT_PATH", "Release receipt requires an absolute local path.");
  const expected = { format: "lightstreamer-workbench-release-receipt-v1", channel, sourceCommit: release.manifest.source.commit,
    manifestSha256: release.manifestSha256, artifactHashes: hashes(release), runId: context.runId,
    version: release.manifest[artifactFields[channel]].version };
  let receipt;
  try { receipt = JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw publicError("RELEASE_RECEIPT_INVALID", "Release receipt is unreadable; recover a trusted receipt before retrying.");
    receipt = { ...expected, runAttempt: context.runAttempt, state: "prepared", stage: "prepared", operations: {}, remote: {} };
  }
  if (Object.entries(expected).some(([key, value]) => key === "artifactHashes"
    ? Object.entries(value).some(([artifact, hash]) => receipt.artifactHashes?.[artifact] !== hash)
    : receipt[key] !== value) || !receipt.operations || !receipt.remote) {
    throw publicError("RELEASE_RECEIPT_MISMATCH", "Release receipt does not match the frozen source, artifacts, channel, and run.");
  }
  validateReceiptProof(receipt, context);
  receipt.runAttempt = context.runAttempt;
  await saveReceipt(path, receipt);
  return receipt;
}
async function recordAttention(path, receipt, error) {
  const safe = safeError(error);
  receipt.state = "attention-required";
  receipt.attention = { code: safe.code, message: safe.message };
  await saveReceipt(path, receipt);
}
async function intent(path, receipt, operation) {
  receipt.stage = operation;
  receipt.operations[operation] = { outcome: "intent" };
  delete receipt.attention;
  await saveReceipt(path, receipt);
}
async function accepted(path, receipt, operation, state) {
  receipt.operations[operation] = { outcome: "accepted" };
  receipt.stage = operation.replace(/-intent$/, "-accepted");
  receipt.state = state;
  delete receipt.attention;
  await saveReceipt(path, receipt);
}
async function jsonRequest(request, url, { method = "GET", headers = {}, body, allowMissing = false } = {}) {
  let response;
  try { response = await request(url, { method, headers, body, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw publicError("RELEASE_NETWORK_UNCERTAIN", "Release request could not be confirmed; inspect the operation intent before retrying."); }
  if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null; }
  if (!response.ok) {
    await response.body?.cancel();
    throw publicError("RELEASE_HTTP_FAILED", `Release request returned HTTP ${Number.isInteger(response.status) ? response.status : "unknown"}; inspect the saved operation before retrying.`);
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw publicError("RELEASE_RESPONSE_INVALID", "Release response was not valid JSON; inspect the saved operation before retrying."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw publicError("RELEASE_RESPONSE_INVALID", "Release response has an invalid object shape; it is not proof of version absence.");
  return payload;
}
function chromeIdentity(value, resource) {
  if (value?.name !== resource || value.itemId !== chromeId) throw publicError("RELEASE_REMOTE_IDENTITY", "Chrome response does not match the frozen extension identity.");
}
async function submitChrome({ release, receipt, receiptPath, request, env, readOnly = false }) {
  const resource = env.CWS_RESOURCE;
  if (!new RegExp(`^publishers/[A-Za-z0-9_-]+/items/${chromeId}$`).test(resource ?? "")) {
    throw publicError("RELEASE_CHROME_CONFIG", "Chrome requires env-only CWS_RESOURCE matching the frozen extension.");
  }
  const headers = { Authorization: `Bearer ${await chromeToken(env, request)}` };
  const base = "https://chromewebstore.googleapis.com";
  const status = await jsonRequest(request, `${base}/v2/${resource}:fetchStatus`, { headers });
  chromeIdentity(status, resource);
  if (status.takenDown === true || status.warned === true) throw publicError("RELEASE_CHROME_POLICY", "Chrome policy status needs dashboard attention before publication.");
  const observed = chromeObservation(status, receipt.version);
  receipt.remote.observation = observed;
  for (const operation of ["chrome-upload-intent", "chrome-publish-intent"]) {
    if (receipt.operations[operation] && receipt.operations[operation].outcome !== "accepted") {
      throw publicError("RELEASE_CHROME_MUTATION_UNCERTAIN", "Chrome mutation intent has no accepted response; inspect the receipt and dashboard before retrying.");
    }
  }
  if (receipt.operations["chrome-publish-intent"]?.outcome === "accepted") {
    if (!observed) throw publicError("RELEASE_CHROME_STATUS_UNCERTAIN", "Known Chrome submission is absent from remote status; inspect the dashboard before retrying.");
    receipt.state = observed.state;
    receipt.stage = "chrome-status";
    delete receipt.attention;
    return saveReceipt(receiptPath, receipt);
  }
  if (observed) throw publicError("RELEASE_CHROME_PROOF_MISSING", "Chrome already has this version without an accepted submission receipt; inspect the dashboard before retrying.");
  if (status.submittedItemRevisionStatus) throw publicError("RELEASE_CHROME_PENDING_CONFLICT", "Chrome has another pending revision; do not replace it automatically.");
  if (status.lastAsyncUploadState && status.lastAsyncUploadState !== "NOT_FOUND") throw publicError("RELEASE_CHROME_UPLOAD_UNCERTAIN", "Chrome has unlinked async upload activity; inspect the dashboard before retrying.");
  if (readOnly) return saveReceipt(receiptPath, receipt);
  if (!receipt.remote.upload) {
    await intent(receiptPath, receipt, "chrome-upload-intent");
    const upload = await jsonRequest(request, `${base}/upload/v2/${resource}:upload?uploadType=media`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/zip" }, body: release.artifacts.chrome.bytes
    });
    chromeIdentity(upload, resource);
    if (upload.uploadState !== "SUCCEEDED" || upload.crxVersion !== receipt.version) {
      throw publicError("RELEASE_CHROME_UPLOAD_UNCERTAIN", "Chrome upload has no confirmed matching version; inspect the receipt and dashboard before retrying.");
    }
    receipt.remote.upload = { resource, itemId: upload.itemId, version: upload.crxVersion, state: upload.uploadState };
    await accepted(receiptPath, receipt, "chrome-upload-intent", "uploaded");
  }
  await intent(receiptPath, receipt, "chrome-publish-intent");
  const published = await jsonRequest(request, `${base}/v2/${resource}:publish`, {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "DEFAULT_PUBLISH", blockOnWarnings: true })
  });
  chromeIdentity(published, resource);
  const publishState = chromeStates.includes(published.state) ? published.state : "UNKNOWN";
  receipt.remote.publish = { resource, itemId: published.itemId, state: publishState };
  if (publishState === "UNKNOWN") throw publicError("RELEASE_CHROME_STATE_UNKNOWN", "Chrome publication returned an unknown state; inspect the saved intent and dashboard before retrying.");
  await accepted(receiptPath, receipt, "chrome-publish-intent", publishState === "PENDING_REVIEW" ? "under-review" : ["STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"].includes(publishState) ? "approved" : "submitted");
  if (["REJECTED", "CANCELLED"].includes(publishState)) throw publicError("RELEASE_CHROME_REVIEW_ATTENTION", "Chrome publication was rejected or cancelled; inspect the dashboard before retrying.");
  return receipt;
}

const chromeStates = ["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS", "REJECTED", "CANCELLED"];
function chromeObservation(status, version) {
  const targets = [];
  for (const [kind, revision] of [["published", status.publishedItemRevisionStatus], ["submitted", status.submittedItemRevisionStatus]]) {
    if (!revision) continue;
    if (!chromeStates.includes(revision.state) || !Array.isArray(revision.distributionChannels) || revision.distributionChannels.length === 0
      || revision.distributionChannels.some(channel => !/^\d+(?:\.\d+){2,3}$/.test(channel.crxVersion ?? "")
        || (channel.deployPercentage !== undefined && (!Number.isInteger(channel.deployPercentage) || channel.deployPercentage < 0 || channel.deployPercentage > 100)))) {
      throw publicError("RELEASE_CHROME_STATE_UNKNOWN", "Chrome revision state or deployment is unknown; inspect the dashboard before publication.");
    }
    if (["REJECTED", "CANCELLED"].includes(revision.state)) throw publicError("RELEASE_CHROME_REVIEW_ATTENTION", "Chrome revision was rejected or cancelled; inspect the dashboard before publication.");
    if (revision.distributionChannels.some(channel => channel.crxVersion === version)) targets.push({ kind, revision });
  }
  if (targets.length > 1 && targets[0].revision.state !== targets[1].revision.state) throw publicError("RELEASE_CHROME_STATUS_CONTRADICTION", "Chrome target revisions have contradictory states; inspect the dashboard before publication.");
  const target = targets[0];
  if (!target) return null;
  const { kind, revision } = target;
  const publicAvailable = kind === "published" && revision.state === "PUBLISHED"
    && revision.distributionChannels.some(channel => channel.crxVersion === version && channel.deployPercentage > 0)
    && status.takenDown !== true;
  const state = publicAvailable ? "publicly-available" : revision.state === "PENDING_REVIEW" ? "under-review"
    : ["STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS"].includes(revision.state) ? "approved" : "submitted";
  return { kind, version, remoteState: revision.state, state, audience: revision.state === "PUBLISHED_TO_TESTERS" ? "testers" : "public" };
}

async function submitNpm({ release, receipt, receiptPath, request, runNpm, env, readOnly = false, visibilityAttempts = 31, delay = waitForRegistry }) {
  if (!Number.isInteger(visibilityAttempts) || visibilityAttempts < 1 || visibilityAttempts > 31) throw publicError("RELEASE_NPM_RETRY_BUDGET", "npm visibility needs 1–31 bounded attempts.");
  const entry = release.manifest.mcp;
  const url = `https://registry.npmjs.org/${encodeURIComponent(entry.name)}/${encodeURIComponent(entry.version)}`;
  let metadata = await jsonRequest(request, url, { allowMissing: true });
  if (!metadata) {
    if (readOnly) return saveReceipt(receiptPath, receipt);
    if (receipt.operations["npm-publish-intent"]) throw publicError("RELEASE_NPM_OUTCOME_UNCERTAIN", "npm publication intent is not visible; reconcile this exact version before retrying.");
    if (digest(await readFile(release.artifacts.npm.path)) !== entry.sha256) throw publicError("RELEASE_NPM_INPUT_CHANGED", "Frozen npm tarball changed on disk before publication.");
    if (runNpm === executeNpm) await validateNpmPrerequisites(env);
    await intent(receiptPath, receipt, "npm-publish-intent");
    let code = null;
    try {
      const result = await runNpm({ file: "npm", args: ["publish", release.artifacts.npm.path, "--access", "public", "--provenance", "--ignore-scripts", "--registry", "https://registry.npmjs.org"], env });
      code = typeof result === "number" ? result : result?.code;
    } catch { /* A lost process response can still have published. Verify the registry only. */ }
    receipt.remote.npmProcess = { successfulExit: code === 0 };
    if (code === 0) await accepted(receiptPath, receipt, "npm-publish-intent", "submitted");
    else await saveReceipt(receiptPath, receipt);
    for (let attempt = 1; attempt <= visibilityAttempts; attempt += 1) {
      metadata = await jsonRequest(request, url, { allowMissing: true });
      if (metadata) break;
      if (attempt < visibilityAttempts) await delay();
    }
    if (!metadata) throw publicError("RELEASE_NPM_VISIBILITY_PENDING", "npm publication has no registry proof after bounded visibility checks; reconcile this exact version before retrying.");
  }
  const integrity = `sha512-${createHash("sha512").update(release.artifacts.npm.bytes).digest("base64")}`;
  if (metadata?.name !== entry.name || metadata.version !== entry.version
    || (metadata.gitHead !== undefined && metadata.gitHead !== receipt.sourceCommit)
    || (metadata.dist?.integrity !== undefined && metadata.dist.integrity !== integrity)) {
    throw publicError("RELEASE_NPM_ARTIFACT_MISMATCH", "npm registry version does not match the exact frozen artifact and source; do not allocate another version on retry.");
  }
  let proof = "registry-integrity";
  if (metadata.dist?.integrity === undefined) {
    const tarball = allowedUrl(metadata.dist?.tarball, ["https://registry.npmjs.org"], "npm tarball");
    const bytes = await byteRequest(request, tarball, { size: entry.size });
    if (digest(bytes) !== entry.sha256) throw publicError("RELEASE_NPM_ARTIFACT_MISMATCH", "npm public tarball differs from the frozen bytes; do not allocate another version on retry.");
    proof = "tarball-sha256";
  }
  if (receipt.operations["npm-publish-intent"]) receipt.operations["npm-publish-intent"] = { outcome: "accepted", proof };
  receipt.remote.npm = { name: entry.name, version: entry.version, integrity, proof, gitHead: metadata.gitHead ?? null };
  receipt.state = "publicly-available";
  receipt.stage = "npm-status";
  delete receipt.attention;
  return saveReceipt(receiptPath, receipt);
}

async function validateNpmPrerequisites(env) {
  if (!env.GITHUB_SHA || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || !env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw publicError("RELEASE_NPM_OIDC_REQUIRED", "npm publication requires the pinned GitHub trusted-publishing environment.");
  }
  const node = process.versions.node.split(".").map(Number);
  if (node[0] < 22 || (node[0] === 22 && node[1] < 14)) throw publicError("RELEASE_NPM_NODE_REQUIRED", "Node 22.14.0 or newer is required for trusted publication.");
  const run = promisify(execFile);
  const childEnv = npmChildEnvironment(env);
  let version;
  try { version = (await run("npm", ["--version"], { env: childEnv, maxBuffer: 64 * 1024 })).stdout.trim(); }
  catch { throw publicError("RELEASE_NPM_VERSION_REQUIRED", "npm 11.5.1 or newer is required for trusted publication."); }
  const numbers = version.split(".").map(Number);
  if (numbers.length !== 3 || !numbers.every(Number.isInteger) || numbers[0] < 11
    || (numbers[0] === 11 && (numbers[1] < 5 || (numbers[1] === 5 && numbers[2] < 1)))) {
    throw publicError("RELEASE_NPM_VERSION_REQUIRED", "npm 11.5.1 or newer is required for trusted publication.");
  }
}
function npmChildEnvironment(env) { return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("CWS_") && !key.startsWith("AMO_"))); }
async function executeNpm({ file, args, env }) {
  const run = promisify(execFile), childEnv = npmChildEnvironment(env);
  try { await run(file, args, { env: childEnv, maxBuffer: 256 * 1024, timeout: 10 * 60_000 }); return { code: 0 }; }
  catch { return { code: 1 }; }
}

function waitForRegistry() { return new Promise(resolve => setTimeout(resolve, 30_000)); }

function allowedUrl(value, origins, purpose) {
  let url;
  try { url = new URL(value); } catch { throw publicError("RELEASE_REMOTE_URL", `Invalid official ${purpose} URL.`); }
  if (!origins.includes(url.origin) || url.username || url.password || url.search || url.hash) throw publicError("RELEASE_REMOTE_URL", `Untrusted ${purpose} URL; no credentials or requests were forwarded.`);
  return url.href;
}
async function byteRequest(request, url, { headers = {}, size }) {
  let response;
  try { response = await request(url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw publicError("RELEASE_REMOTE_BYTES", "Remote artifact bytes could not be verified."); }
  if (!response.ok) { await response.body?.cancel(); throw publicError("RELEASE_REMOTE_BYTES", "Remote artifact bytes were unavailable for exact verification."); }
  const reader = response.body?.getReader();
  if (!reader) throw publicError("RELEASE_REMOTE_BYTES", "Remote artifact has no readable bytes.");
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > size) { await reader.cancel(); throw publicError("RELEASE_REMOTE_BYTES", "Remote artifact exceeded the expected frozen byte size."); }
      chunks.push(Buffer.from(value));
    }
  } catch (error) { throw safeError(error); }
  finally { reader.releaseLock(); }
  if (length !== size) throw publicError("RELEASE_REMOTE_BYTES", "Remote artifact byte size differs from the frozen input.");
  return Buffer.concat(chunks, length);
}

const amoBase = "https://addons.mozilla.org/api/v5/";
function amoHeaders(env) {
  if (typeof env.AMO_API_KEY !== "string" || !env.AMO_API_KEY || typeof env.AMO_API_SECRET !== "string" || !env.AMO_API_SECRET) {
    throw publicError("RELEASE_AMO_CONFIG", "Firefox requires env-only AMO_API_KEY and AMO_API_SECRET.");
  }
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: env.AMO_API_KEY, jti: randomUUID(), iat, exp: iat + 120 })).toString("base64url");
  const signature = createHmac("sha256", env.AMO_API_SECRET).update(`${header}.${body}`).digest("base64url");
  return { Authorization: `JWT ${header}.${body}.${signature}` };
}
function versionObservation(value, expectedVersion) {
  if (!value || value.version !== expectedVersion || value.channel !== "listed" || !Number.isSafeInteger(value.id) || value.id < 1
    || !Number.isSafeInteger(value.file?.id) || value.file.id < 1 || !Number.isSafeInteger(value.file.size) || value.file.size < 1
    || !/^sha256:[a-f0-9]{64}$/.test(value.file.hash ?? "")) {
    throw publicError("RELEASE_AMO_VERSION_IDENTITY", "AMO version response does not match the frozen listed version and immutable IDs.");
  }
  return { id: value.id, version: value.version, channel: value.channel, fileId: value.file.id,
    sourceUrl: allowedUrl(value.source, ["https://addons.mozilla.org"], "AMO source"), fileHash: value.file.hash,
    fileSize: value.file.size, fileUrl: allowedUrl(value.file.url, ["https://addons.mozilla.org"], "AMO file"),
    status: ["unreviewed", "public", "disabled"].includes(value.file.status) ? value.file.status : "UNKNOWN" };
}
async function submitFirefox({ release, receipt, receiptPath, request, env, readOnly = false }) {
  const addonUrl = `${amoBase}addons/addon/${encodeURIComponent(firefoxId)}/`;
  const addon = await jsonRequest(request, addonUrl, { headers: amoHeaders(env) });
  if (addon?.guid !== firefoxId || !Number.isSafeInteger(addon.id) || addon.id < 1 || addon.is_disabled !== false) {
    throw publicError("RELEASE_AMO_ADDON_IDENTITY", "AMO add-on identity or disabled state needs publisher attention before writing.");
  }
  if (receipt.remote.addonId && receipt.remote.addonId !== addon.id) throw publicError("RELEASE_AMO_ADDON_IDENTITY", "Known AMO add-on ID changed; stop before any mutation.");
  receipt.remote.addonId = addon.id;
  const existing = await jsonRequest(request, `${addonUrl}versions/${encodeURIComponent(receipt.version)}/`, { headers: amoHeaders(env), allowMissing: true });
  if (existing) {
    if (receipt.operations["amo-version-intent"]?.outcome !== "accepted" || receipt.operations["amo-upload-intent"]?.outcome !== "accepted"
      || !receipt.remote.version || receipt.remote.version.uploadUuid !== receipt.remote.upload?.uuid) {
      throw publicError("RELEASE_AMO_PROOF_MISSING", "AMO already has this version without an accepted version receipt; inspect the upload chain before retrying.");
    }
    const observed = versionObservation(existing, receipt.version);
    if (observed.id !== receipt.remote.version.id || observed.fileId !== receipt.remote.version.fileId) {
      throw publicError("RELEASE_AMO_VERSION_IDENTITY", "AMO immutable version or file ID changed; stop before any mutation.");
    }
    receipt.remote.version = { ...observed, uploadUuid: receipt.remote.upload.uuid };
    return finishFirefox({ release, receipt, receiptPath, request, env, addonUrl, version: existing, readOnly });
  }
  if (receipt.operations["amo-version-intent"]) throw publicError("RELEASE_AMO_VERSION_UNCERTAIN", "AMO version intent is absent remotely or has no accepted version proof; inspect the receipt before retrying.");
  if (receipt.operations["amo-upload-intent"] && (receipt.operations["amo-upload-intent"].outcome !== "accepted" || !receipt.remote.upload?.uuid)) {
    throw publicError("RELEASE_AMO_UPLOAD_UNCERTAIN", "AMO upload intent has no accepted UUID receipt; do not upload again automatically.");
  }
  if (readOnly) { receipt.stage = "amo-status"; return saveReceipt(receiptPath, receipt); }
  let upload;
  if (receipt.remote.upload) {
    upload = await jsonRequest(request, `${amoBase}addons/upload/${receipt.remote.upload.uuid}/`, { headers: amoHeaders(env) });
  } else {
    await intent(receiptPath, receipt, "amo-upload-intent");
    const uploadBody = new FormData();
    uploadBody.set("channel", "listed");
    uploadBody.set("upload", new Blob([release.artifacts.firefox.bytes], { type: "application/zip" }), "firefox.zip");
    upload = await jsonRequest(request, `${amoBase}addons/upload/`, { method: "POST", headers: amoHeaders(env), body: uploadBody });
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(upload?.uuid ?? "") || upload.channel !== "listed") {
      throw publicError("RELEASE_AMO_UPLOAD_IDENTITY", "AMO upload response has no confirmed listed upload UUID; inspect the saved intent before retrying.");
    }
    receipt.remote.upload = { uuid: upload.uuid, channel: upload.channel };
    await accepted(receiptPath, receipt, "amo-upload-intent", "uploaded");
  }
  for (let attempt = 1; upload.processed !== true && attempt <= 12; attempt += 1) {
    if (attempt > 1) await new Promise(resolve => setTimeout(resolve, 5_000));
    upload = await jsonRequest(request, `${amoBase}addons/upload/${receipt.remote.upload.uuid}/`, { headers: amoHeaders(env) });
  }
  if (upload.uuid !== receipt.remote.upload.uuid || upload.channel !== "listed" || upload.version !== receipt.version
    || upload.processed !== true || upload.valid !== true || upload.submitted !== false) {
    throw publicError("RELEASE_AMO_VALIDATION", "AMO upload is unconfirmed, invalid, pending, or already consumed; inspect its UUID before retrying.");
  }
  receipt.remote.upload = { ...receipt.remote.upload, version: upload.version, processed: true, valid: true, submitted: false };
  await saveReceipt(receiptPath, receipt);
  await intent(receiptPath, receipt, "amo-version-intent");
  const versionBody = new FormData();
  versionBody.set("upload", upload.uuid);
  versionBody.set("source", new Blob([release.artifacts.firefoxSource.bytes], { type: "application/zip" }), "firefox-source.zip");
  versionBody.set("approval_notes", release.firefoxMetadata.version.approval_notes);
  if (release.firefoxMetadata.version.license !== undefined) versionBody.set("license", release.firefoxMetadata.version.license);
  const version = await jsonRequest(request, `${addonUrl}versions/`, { method: "POST", headers: amoHeaders(env), body: versionBody });
  receipt.remote.version = { ...versionObservation(version, receipt.version), uploadUuid: upload.uuid };
  await accepted(receiptPath, receipt, "amo-version-intent", "submitted");
  return finishFirefox({ release, receipt, receiptPath, request, env, addonUrl, version });
}
async function finishFirefox({ release, receipt, receiptPath, request, env, addonUrl, version, readOnly = false }) {
  requireFirefoxState(version);
  const sourceBytes = await byteRequest(request, receipt.remote.version.sourceUrl, { headers: amoHeaders(env), size: release.manifest.firefoxSource.size });
  if (digest(sourceBytes) !== release.manifest.firefoxSource.sha256) throw publicError("RELEASE_AMO_SOURCE_MISMATCH", "AMO reviewer source differs from the exact paired frozen source.");
  receipt.remote.sourceSha256 = digest(sourceBytes);
  await saveReceipt(receiptPath, receipt);
  if (metadataMatches(version, release.firefoxMetadata.version)) {
    receipt.operations["amo-metadata-intent"] = { outcome: "accepted", proof: "version-metadata" };
    receipt.stage = "amo-status";
    delete receipt.attention;
    return observeFirefox({ receipt, receiptPath, request, addonUrl, version });
  }
  if (readOnly) throw publicError("RELEASE_AMO_METADATA_PENDING", "AMO frozen metadata is missing; status is read-only, so retry the metadata submission stage.");
  await intent(receiptPath, receipt, "amo-metadata-intent");
  const patched = await jsonRequest(request, `${addonUrl}versions/${version.id}/`, { method: "PATCH",
    headers: { ...amoHeaders(env), "Content-Type": "application/json" }, body: JSON.stringify(release.firefoxMetadata.version) });
  const observation = versionObservation(patched, receipt.version);
  if (observation.id !== receipt.remote.version.id || observation.fileId !== receipt.remote.version.fileId || observation.sourceUrl !== receipt.remote.version.sourceUrl) {
    throw publicError("RELEASE_AMO_METADATA_IDENTITY", "AMO metadata response changed the immutable version, file, or paired source identity; inspect the accepted version receipt.");
  }
  requireFirefoxState(patched);
  if (!metadataMatches(patched, release.firefoxMetadata.version)) {
    throw publicError("RELEASE_AMO_METADATA_MISMATCH", "AMO did not confirm the frozen reviewer notes, release notes, and license; retry metadata only after version/source reconciliation.");
  }
  receipt.remote.version = { ...observation, uploadUuid: receipt.remote.upload.uuid };
  await accepted(receiptPath, receipt, "amo-metadata-intent", patched.file.status === "unreviewed" ? "under-review" : patched.file.status === "public" ? "approved" : "submitted");
  return observeFirefox({ receipt, receiptPath, request, addonUrl, version: patched });
}

function metadataMatches(version, metadata) {
  return version.approval_notes === metadata.approval_notes
    && Object.entries(metadata.release_notes).every(([language, note]) => version.release_notes?.[language] === note)
    && (metadata.license === undefined || version.license?.slug === metadata.license);
}

function requireFirefoxState(version) {
  if (version.is_disabled !== false || !["unreviewed", "public"].includes(version.file.status)) {
    throw publicError("RELEASE_AMO_STATE_ATTENTION", "AMO file is disabled or has an unknown review state; inspect the publisher dashboard.");
  }
}
async function observeFirefox({ receipt, receiptPath, request, addonUrl, version }) {
  requireFirefoxState(version);
  receipt.state = version.file.status === "unreviewed" ? "under-review" : "approved";
  receipt.remote.publicVisible = false;
  if (version.file.status === "public") {
    const publicAddon = await jsonRequest(request, addonUrl, { allowMissing: true });
    if (publicAddon?.guid === firefoxId && publicAddon.id === receipt.remote.addonId && publicAddon.is_disabled === false
      && publicAddon.current_version?.version === receipt.version && publicAddon.current_version.id === version.id
      && publicAddon.current_version.file?.id === version.file.id && publicAddon.current_version.file.status === "public") {
      receipt.state = "publicly-available";
      receipt.remote.publicVisible = true;
    }
  }
  delete receipt.attention;
  return saveReceipt(receiptPath, receipt);
}

async function chromeToken(env, request) {
  if (typeof env.CWS_ACCESS_TOKEN === "string" && /^[!-~]+$/.test(env.CWS_ACCESS_TOKEN)) return env.CWS_ACCESS_TOKEN;
  if (![env.CWS_CLIENT_ID, env.CWS_CLIENT_SECRET, env.CWS_REFRESH_TOKEN].every(value => typeof value === "string" && value.length > 0)) {
    throw publicError("RELEASE_CHROME_CONFIG", "Chrome requires env-only CWS_ACCESS_TOKEN or CWS_CLIENT_ID, CWS_CLIENT_SECRET, and CWS_REFRESH_TOKEN.");
  }
  const token = await jsonRequest(request, "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET, refresh_token: env.CWS_REFRESH_TOKEN, grant_type: "refresh_token" })
  });
  if (typeof token.access_token !== "string" || !/^[!-~]+$/.test(token.access_token) || token.token_type?.toLowerCase() !== "bearer") {
    throw publicError("RELEASE_CHROME_AUTH_RESPONSE", "Chrome OAuth did not return a confirmed Bearer token; no publisher mutation was attempted.");
  }
  return token.access_token;
}

function validateReceiptProof(receipt, context) {
  const done = operation => receipt.operations[operation]?.outcome === "accepted";
  const invalid = () => { throw publicError("RELEASE_RECEIPT_PROOF_INVALID", "Release receipt proof or run attempt is incomplete; recover a trusted accepted receipt before any request."); };
  if (!Number.isSafeInteger(receipt.runAttempt) || receipt.runAttempt < 1 || receipt.runAttempt > context.runAttempt
    || !["prepared", "uploaded", "submitted", "under-review", "approved", "publicly-available", "attention-required"].includes(receipt.state)) invalid();
  const allowedOperations = receipt.channel === "chrome" ? ["chrome-upload-intent", "chrome-publish-intent"]
    : receipt.channel === "firefox" ? ["amo-upload-intent", "amo-version-intent", "amo-metadata-intent"] : ["npm-publish-intent"];
  if (Object.entries(receipt.operations).some(([name, operation]) => !allowedOperations.includes(name) || !["intent", "accepted"].includes(operation?.outcome))) invalid();
  if (receipt.channel === "chrome") {
    const upload = receipt.remote.upload, publish = receipt.remote.publish;
    if (done("chrome-upload-intent") && (!upload || upload.itemId !== chromeId || upload.version !== receipt.version || upload.state !== "SUCCEEDED"
      || !new RegExp(`^publishers/[A-Za-z0-9_-]+/items/${chromeId}$`).test(upload.resource))) invalid();
    if (done("chrome-publish-intent") && (!done("chrome-upload-intent") || !publish || publish.itemId !== chromeId
      || publish.resource !== upload.resource || !chromeStates.includes(publish.state))) invalid();
  }
  if (receipt.channel === "firefox") {
    const upload = receipt.remote.upload, version = receipt.remote.version;
    if (done("amo-upload-intent") && (!upload || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(upload.uuid ?? "") || upload.channel !== "listed")) invalid();
    if (done("amo-version-intent") && (!done("amo-upload-intent") || !version || version.uploadUuid !== upload.uuid
      || version.version !== receipt.version || version.channel !== "listed" || !Number.isSafeInteger(version.id) || version.id < 1
      || !Number.isSafeInteger(version.fileId) || version.fileId < 1 || !Number.isSafeInteger(receipt.remote.addonId) || receipt.remote.addonId < 1
      || upload.version !== receipt.version || upload.processed !== true || upload.valid !== true)) invalid();
    if (done("amo-metadata-intent") && (!done("amo-version-intent") || receipt.remote.sourceSha256 !== receipt.artifactHashes.firefoxSource)) invalid();
    if (receipt.remote.sourceSha256 && receipt.remote.sourceSha256 !== receipt.artifactHashes.firefoxSource) invalid();
  }
}
