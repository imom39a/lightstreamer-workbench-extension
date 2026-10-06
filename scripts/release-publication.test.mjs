import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { submitReleaseChannel, reconcileReleaseChannel } from "./release-publication.mjs";

const source = "a".repeat(40);
const chromeId = "kfpgbhfphbhkebglopimjhfnnmbifocf";
const firefoxId = "lightstreamer-workbench@imom39a";
const resource = `publishers/test-publisher/items/${chromeId}`;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sha512 = bytes => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const success = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const missing = () => new Response("", { status: 404 });

async function prepared(t) {
  const dir = await mkdtemp(resolve(tmpdir(), "workbench-publication-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const inputs = {
    chrome: Buffer.from("frozen Chrome ZIP"),
    firefox: Buffer.from("frozen Firefox ZIP"),
    firefoxSource: Buffer.from("frozen reviewer source ZIP"),
    npm: Buffer.from("frozen npm tarball")
  };
  const metadata = { version: { release_notes: { "en-US": "Reviewed maintenance release." }, approval_notes: "Build using the paired locked source." } };
  const artifacts = {};
  for (const [key, bytes] of Object.entries(inputs)) {
    const file = key === "npm" ? "agent/agent.tgz" : `extension/${key}.zip`;
    const path = resolve(dir, `${key}.${key === "npm" ? "tgz" : "zip"}`);
    await writeFile(path, bytes);
    artifacts[key] = { path, bytes, file, size: bytes.length, sha256: sha256(bytes), version: key === "npm" ? "0.1.9" : "2.0.10" };
  }
  artifacts.chrome.id = chromeId;
  artifacts.firefox.id = firefoxId;
  artifacts.npm.name = "lightstreamer-workbench-agent";
  const manifest = {
    format: "lightstreamer-workbench-mcp-release-v2", state: "prepared-unpublished",
    source: { commit: source, workingTree: "clean", dirtyPaths: [] },
    publicationIntent: { chrome: false, firefox: false, npm: false },
    build: { analytics: "production" },
    extension: { ...artifacts.chrome }, firefox: { ...artifacts.firefox },
    firefoxSource: { ...artifacts.firefoxSource }, mcp: { ...artifacts.npm },
    firefoxMetadata: { file: "metadata/firefox-submission.json", size: Buffer.byteLength(JSON.stringify(metadata)), sha256: sha256(JSON.stringify(metadata)) }
  };
  for (const entry of [manifest.extension, manifest.firefox, manifest.firefoxSource, manifest.mcp]) { delete entry.path; delete entry.bytes; }
  const release = { manifest, manifestSha256: "b".repeat(64), artifacts, firefoxMetadata: metadata };
  const context = { eventName: "workflow_dispatch", ref: "refs/heads/main", expectedSource: source, sourceSha: source, runId: "12345", runAttempt: 1 };
  const verification = {
    format: "lightstreamer-workbench-release-verification-v1", sourceCommit: source, manifestSha256: release.manifestSha256,
    scope: "release", runId: context.runId, passed: true,
    jobs: Object.fromEntries(["plan", "package", "checks", "portable", "firefox", "fixture", "panel", "site", "release-bundle"].map(key => [key, "success"]))
  };
  const env = { CWS_RESOURCE: resource, CWS_ACCESS_TOKEN: "test-chrome-secret", AMO_API_KEY: "test-amo-key", AMO_API_SECRET: "test-amo-secret", GITHUB_SHA: source };
  return { release, context, verification, env, receiptPath: resolve(dir, "receipt.json") };
}

test("verify-only intent refuses publication before any external request", async t => {
  const fixture = await prepared(t);
  await assert.rejects(submitReleaseChannel({ ...fixture, channel: "chrome", request: async () => assert.fail("Verify-only must not contact a publisher") }), /intent/);
});

test("every publisher rejects failed, skipped, cancelled or missing bundle evidence before contacting external services", async t => {
  for (const channel of ["chrome","firefox","npm"]) {
    for (const state of ["failure","skipped","cancelled",undefined]) {
      const f=await prepared(t);
      f.release.manifest.publicationIntent[channel]=true;
      if (state===undefined) delete f.verification.jobs["release-bundle"];
      else f.verification.jobs["release-bundle"]=state;
      let requests=0,publications=0;
      await assert.rejects(submitReleaseChannel({...f,channel,
        request:async()=>{requests+=1;throw new Error("Unexpected external request");},
        runNpm:async()=>{publications+=1;return {code:0};}
      }),/all full release verification gates/);
      assert.equal(requests,0);
      assert.equal(publications,0);
    }
  }
});

test("publication refuses unapproved source, incomplete release gates, and altered frozen bytes", async t => {
  const changes = [
    f => { f.context.eventName = "push"; },
    f => { f.context.ref = "refs/heads/topic"; },
    f => { f.context.expectedSource = "c".repeat(40); },
    f => { f.context.sourceSha = "c".repeat(40); },
    f => { f.env.GITHUB_SHA = "c".repeat(40); },
    f => { f.release.manifest.source.workingTree = "dirty"; },
    f => { f.release.manifest.source.dirtyPaths = ["src/index.ts"]; },
    f => { f.release.manifest.build.analytics = "verification"; },
    f => { f.release.manifest.firefox.version = "2.0.9"; },
    f => { f.verification.passed = false; },
    f => { f.verification.scope = "site"; },
    f => { f.verification.sourceCommit = "c".repeat(40); },
    f => { f.verification.manifestSha256 = "c".repeat(64); },
    f => { f.verification.runId = "999"; },
    f => { delete f.verification.jobs.panel; },
    f => { f.verification.jobs.firefox = "skipped"; },
    f => { f.verification.jobs.site = "cancelled"; },
    f => { f.verification.jobs.portable = "failure"; },
    f => { f.release.artifacts.chrome.bytes = Buffer.from("different ZIP"); },
    f => { f.release.manifest.mcp.sha256 = "0".repeat(64); },
    f => { f.release.manifest.extension.id = "other-item"; },
    f => { f.release.manifest.firefox.id = "other-addon@example.com"; }
  ];
  for (const change of changes) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.chrome = true;
    change(f);
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request: async () => assert.fail("Rejected input must make zero external requests") }), /release|source|verification|artifact|identity|version|dispatch/i);
  }
});

const chromeStatus = (published = "2.0.9", submitted = null) => ({
  name: resource, itemId: chromeId, takenDown: false,
  publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: published, deployPercentage: 100 }] },
  ...(submitted ? { submittedItemRevisionStatus: { state: "PENDING_REVIEW", distributionChannels: [{ crxVersion: submitted, deployPercentage: 100 }] } } : {})
});

test("Chrome submits the exact frozen ZIP for review and persists acceptance separately from public availability", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.chrome = true;
  const requests = [];
  const receipt = await submitReleaseChannel({ ...f, channel: "chrome", request: async (url, options) => {
    requests.push({ url, method: options.method });
    assert.equal(options.headers.Authorization, "Bearer test-chrome-secret");
    assert.equal(options.redirect, "error");
    if (options.method === "GET") return success(chromeStatus());
    const saved = JSON.parse(await readFile(f.receiptPath, "utf8"));
    if (url.includes(":upload?")) {
      assert.equal(saved.stage, "chrome-upload-intent");
      assert.deepEqual(options.body, f.release.artifacts.chrome.bytes);
      assert.equal(options.headers["Content-Type"], "application/zip");
      return success({ name: resource, itemId: chromeId, crxVersion: "2.0.10", uploadState: "SUCCEEDED" });
    }
    assert.equal(saved.stage, "chrome-publish-intent");
    assert.equal(saved.remote.upload.version, "2.0.10");
    assert.deepEqual(JSON.parse(options.body), { publishType: "DEFAULT_PUBLISH", blockOnWarnings: true });
    return success({ name: resource, itemId: chromeId, state: "PENDING_REVIEW" });
  } });
  assert.deepEqual(requests, [
    { url: `https://chromewebstore.googleapis.com/v2/${resource}:fetchStatus`, method: "GET" },
    { url: `https://chromewebstore.googleapis.com/upload/v2/${resource}:upload?uploadType=media`, method: "POST" },
    { url: `https://chromewebstore.googleapis.com/v2/${resource}:publish`, method: "POST" }
  ]);
  assert.equal(receipt.state, "under-review");
  assert.equal(receipt.format, "lightstreamer-workbench-release-receipt-v1");
  assert.equal(receipt.sourceCommit, source);
  assert.equal(receipt.artifactHashes.chrome, f.release.manifest.extension.sha256);
  assert.equal(receipt.manifestSha256, f.release.manifestSha256);
  assert.deepEqual(JSON.parse(await readFile(f.receiptPath, "utf8")), receipt);
  assert(!JSON.stringify(receipt).includes("test-chrome-secret"));
});

async function acceptChrome(f) {
  f.release.manifest.publicationIntent.chrome = true;
  const responses = [chromeStatus(), { name: resource, itemId: chromeId, crxVersion: "2.0.10", uploadState: "SUCCEEDED" }, { name: resource, itemId: chromeId, state: "PENDING_REVIEW" }];
  return submitReleaseChannel({ ...f, channel: "chrome", request: async () => success(responses.shift()) });
}

test("known Chrome acceptance reconciles review, approval, and actual target publication without resubmitting", async t => {
  const f = await prepared(t);
  await acceptChrome(f);
  for (const [state, expected] of [["PENDING_REVIEW", "under-review"], ["STAGED", "approved"], ["PUBLISHED_TO_TESTERS", "approved"], ["PUBLISHED", "publicly-available"]]) {
    const status = state === "PUBLISHED" ? chromeStatus("2.0.10") : chromeStatus("2.0.9", "2.0.10");
    if (state !== "PUBLISHED") status.submittedItemRevisionStatus.state = state;
    const receipt = await reconcileReleaseChannel({ ...f, channel: "chrome", request: async (url, options) => {
      assert.equal(options.method, "GET", "Status must not publish");
      return success(status);
    } });
    assert.equal(receipt.state, expected);
  }
  const receipt = await submitReleaseChannel({ ...f, channel: "chrome", request: async (_url, options) => {
    assert.equal(options.method, "GET", "Accepted retry must not upload/publish");
    return success(chromeStatus("2.0.9", "2.0.10"));
  } });
  assert.equal(receipt.state, "under-review", "Older public version is not the pending release");
});

test("Chrome stops before replacing an existing target or another pending submission without accepted proof", async t => {
  for (const status of [chromeStatus("2.0.10"), chromeStatus("2.0.9", "2.0.10"), chromeStatus("2.0.9", "2.0.11"), { ...chromeStatus(), lastAsyncUploadState: "IN_PROGRESS" }, { ...chromeStatus(), takenDown: true }]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.chrome = true;
    let mutations = 0;
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request: async (_url, options) => {
      if (options.method !== "GET") mutations += 1;
      return success(status);
    } }), /Chrome|receipt|pending|upload|policy/);
    assert.equal(mutations, 0);
    assert.equal(JSON.parse(await readFile(f.receiptPath, "utf8")).state, "attention-required");
  }
});

test("lost or unverifiable Chrome mutation outcomes preserve partial receipts and cannot be automatically retried", async t => {
  for (const failure of ["upload-network", "upload-async", "upload-version", "publish-network"]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.chrome = true;
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request: async (url, options) => {
      if (options.method === "GET") return success(chromeStatus());
      if (url.includes(":upload?")) {
        if (failure === "upload-network") throw new Error(`Failed Authorization: Bearer ${f.env.CWS_ACCESS_TOKEN}`);
        return success({ name: resource, itemId: chromeId, crxVersion: failure === "upload-version" ? "2.0.11" : "2.0.10", uploadState: failure === "upload-async" ? "IN_PROGRESS" : "SUCCEEDED" });
      }
      throw new Error(`Failed Authorization: Bearer ${f.env.CWS_ACCESS_TOKEN}`);
    } }), /Chrome|confirmed/);
    const before = await readFile(f.receiptPath, "utf8");
    assert(!before.includes("test-chrome-secret"));
    assert.equal(JSON.parse(before).state, "attention-required");
    if (failure === "publish-network") assert.equal(JSON.parse(before).remote.upload.version, "2.0.10");
    let mutations = 0;
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request: async (_url, options) => {
      if (options.method !== "GET") mutations += 1;
      return success(chromeStatus());
    } }), /uncertain|intent|confirm|receipt/);
    assert.equal(mutations, 0);
  }
});

test("an exact already-published npm tarball reconciles independently without publishing again", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.npm = true;
  let publishes = 0;
  const receipt = await submitReleaseChannel({ ...f, channel: "npm", runNpm: async () => { publishes += 1; }, request: async (url, options) => {
    assert.equal(url, "https://registry.npmjs.org/lightstreamer-workbench-agent/0.1.9");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, undefined);
    return success({ name: "lightstreamer-workbench-agent", version: "0.1.9", gitHead: source, dist: { integrity: sha512(f.release.artifacts.npm.bytes) } });
  } });
  assert.equal(publishes, 0);
  assert.equal(receipt.state, "publicly-available");
  assert.equal(receipt.remote.npm.version, "0.1.9");
});

test("new npm publication uses the exact tarball and checks registry integrity after the process", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.npm = true;
  let published = false;
  const receipt = await submitReleaseChannel({ ...f, channel: "npm", runNpm: async ({ file, args, env }) => {
    const saved = JSON.parse(await readFile(f.receiptPath, "utf8"));
    assert.equal(saved.stage, "npm-publish-intent");
    assert.equal(file, "npm");
    assert.deepEqual(args, ["publish", f.release.artifacts.npm.path, "--access", "public", "--provenance", "--ignore-scripts", "--registry", "https://registry.npmjs.org"]);
    assert.equal(env.GITHUB_SHA, source);
    assert.deepEqual(await readFile(args[1]), f.release.artifacts.npm.bytes);
    published = true;
    return { code: 0 };
  }, request: async () => published ? success({ name: "lightstreamer-workbench-agent", version: "0.1.9", gitHead: source, dist: { integrity: sha512(f.release.artifacts.npm.bytes) } }) : missing() });
  assert(published);
  assert.equal(receipt.state, "publicly-available");
  assert.equal(receipt.operations["npm-publish-intent"].outcome, "accepted");
});

test("npm reconciles a failed process and bounded propagation through registry proof without a second publish", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.npm = true;
  let publishes = 0, reads = 0, delays = 0;
  const receipt = await submitReleaseChannel({ ...f, channel: "npm", visibilityAttempts: 3, delay: async () => { delays += 1; },
    runNpm: async () => { publishes += 1; throw new Error("private npm token must not escape"); },
    request: async () => ++reads < 4 ? missing() : success({ name: "lightstreamer-workbench-agent", version: "0.1.9", dist: { integrity: sha512(f.release.artifacts.npm.bytes) } })
  });
  assert.equal(publishes, 1);
  assert.equal(delays, 2);
  assert.equal(receipt.state, "publicly-available");
  assert(!JSON.stringify(receipt).includes("private npm token"));
  const retried = await submitReleaseChannel({ ...f, channel: "npm", runNpm: async () => { publishes += 1; }, request: async () => success({ name: "lightstreamer-workbench-agent", version: "0.1.9", dist: { integrity: sha512(f.release.artifacts.npm.bytes) } }) });
  assert.equal(publishes, 1);
  assert.equal(retried.state, "publicly-available");
});

test("npm accepts registry tarball bytes when integrity is omitted, without forwarding credentials", async t => {
  const f = await prepared(t);
  const tarballUrl = "https://registry.npmjs.org/lightstreamer-workbench-agent/-/lightstreamer-workbench-agent-0.1.9.tgz";
  let reads = 0;
  const receipt = await reconcileReleaseChannel({ ...f, channel: "npm", request: async (url, options) => {
    reads += 1;
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, "error");
    return url === tarballUrl ? new Response(f.release.artifacts.npm.bytes) : success({ name: "lightstreamer-workbench-agent", version: "0.1.9", gitHead: source, dist: { tarball: tarballUrl } });
  } });
  assert.equal(reads, 2);
  assert.equal(receipt.state, "publicly-available");
  assert.equal(receipt.remote.npm.proof, "tarball-sha256");
});

const amoBase = "https://addons.mozilla.org/api/v5/";
const amoAddon = `${amoBase}addons/addon/${encodeURIComponent(firefoxId)}/`;
const uploadUuid = "12345678123456781234567812345678";
const sourceUrl = "https://addons.mozilla.org/firefox/downloads/source/900";
const addon = { id: 100, guid: firefoxId, is_disabled: false, current_version: { version: "2.0.9" } };
const amoVersion = (notes = {}, status = "unreviewed", hash = `sha256:${"d".repeat(64)}`) => ({
  id: 900, version: "2.0.10", channel: "listed", source: sourceUrl, is_disabled: false,
  file: { id: 901, hash, size: 75, status, url: "https://addons.mozilla.org/firefox/downloads/file/901/workbench.xpi" }, ...notes
});

test("Firefox submits exact extension/source bytes and saves translated notes as a separate mutation", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  let uploads = 0, versions = 0, patches = 0;
  const jwtIds = new Set();
  const receipt = await submitReleaseChannel({ ...f, channel: "firefox", request: async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.match(options.headers.Authorization, /^JWT [\w.-]+$/);
    const jwt = options.headers.Authorization.slice(4).split(".");
    const claims = JSON.parse(Buffer.from(jwt[1], "base64url").toString());
    assert.equal(claims.iss, "test-amo-key");
    assert(claims.exp > claims.iat && claims.exp - claims.iat <= 300);
    assert(!jwtIds.has(claims.jti));
    jwtIds.add(claims.jti);
    if (url === amoAddon) return success(addon);
    if (url === `${amoAddon}versions/2.0.10/`) return missing();
    if (url.startsWith(`${amoAddon}versions/?`)) return success({ results: [], next: null, count: 0 });
    if (url === sourceUrl) return new Response(f.release.artifacts.firefoxSource.bytes);
    if (url === `${amoBase}addons/upload/${uploadUuid}/`) return success({ uuid: uploadUuid, channel: "listed", version: "2.0.10", processed: true, valid: true, submitted: false });
    const saved = JSON.parse(await readFile(f.receiptPath, "utf8"));
    if (url === `${amoBase}addons/upload/`) {
      uploads += 1;
      assert.equal(saved.stage, "amo-upload-intent");
      assert(options.body instanceof FormData);
      assert.equal(options.body.get("channel"), "listed");
      assert.deepEqual(Buffer.from(await options.body.get("upload").arrayBuffer()), f.release.artifacts.firefox.bytes);
      return success({ uuid: uploadUuid, channel: "listed", version: "2.0.10", processed: false, valid: false, submitted: false });
    }
    if (url === `${amoAddon}versions/`) {
      versions += 1;
      assert.equal(saved.stage, "amo-version-intent");
      assert.equal(saved.remote.upload.uuid, uploadUuid);
      assert.equal(options.body.get("upload"), uploadUuid);
      assert.deepEqual(Buffer.from(await options.body.get("source").arrayBuffer()), f.release.artifacts.firefoxSource.bytes);
      assert.equal(options.body.get("approval_notes"), f.release.firefoxMetadata.version.approval_notes);
      return success(amoVersion());
    }
    assert.equal(url, `${amoAddon}versions/900/`);
    assert.equal(options.method, "PATCH");
    patches += 1;
    assert.equal(saved.stage, "amo-metadata-intent");
    assert.equal(saved.remote.version.id, 900);
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), f.release.firefoxMetadata.version);
    return success(amoVersion(f.release.firefoxMetadata.version));
  } });
  assert.equal(uploads, 1);
  assert.equal(versions, 1);
  assert.equal(patches, 1);
  assert.equal(receipt.state, "under-review");
  assert.equal(receipt.remote.version.id, 900);
  assert.equal(receipt.remote.version.fileId, 901);
  assert.equal(receipt.remote.version.fileHash, `sha256:${"d".repeat(64)}`, "Repacked AMO hash stays separate from input hash");
  assert.equal(receipt.artifactHashes.firefox, f.release.manifest.firefox.sha256);
  assert.equal(receipt.remote.sourceSha256, f.release.manifest.firefoxSource.sha256);
  const saved = await readFile(f.receiptPath, "utf8");
  assert(!saved.includes("test-amo-secret") && !saved.includes("test-amo-key") && !saved.includes("JWT "));
});

test("Firefox refuses an existing same version without accepted upload/version proof", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  let mutations = 0;
  await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request: async (url, options) => {
    if (options.method !== "GET") mutations += 1;
    return success(url === amoAddon ? addon : amoVersion(f.release.firefoxMetadata.version));
  } }), /AMO|accepted|proof|receipt/);
  assert.equal(mutations, 0);
});

function amoService(f, { failMetadata = false, loseCreate = false, loseUpload = false, loseMetadata = false } = {}) {
  const service = {
    created: false, notes: {}, sourceBytes: f.release.artifacts.firefoxSource.bytes,
    status: "unreviewed", hash: `sha256:${"d".repeat(64)}`, publicAvailable: false,
    mutations: { upload: 0, create: 0, metadata: 0 },
    request: async (url, options) => {
      if (options.method === "GET") {
        if (url === amoAddon) return success(service.publicAvailable && !options.headers.Authorization
          ? { ...addon, current_version: amoVersion(service.notes, service.status, service.hash) } : addon);
        if (url === sourceUrl) return new Response(service.sourceBytes);
        if (url === `${amoAddon}versions/2.0.10/` || url === `${amoAddon}versions/900/`) return service.created ? success(amoVersion(service.notes, service.status, service.hash)) : missing();
        if (url.startsWith(`${amoAddon}versions/?`)) return success({ results: [], next: null, count: 0 });
        if (url === `${amoBase}addons/upload/${uploadUuid}/`) return success({ uuid: uploadUuid, channel: "listed", version: "2.0.10", processed: true, valid: true, submitted: service.created });
      }
      if (url === `${amoBase}addons/upload/`) {
        service.mutations.upload += 1;
        if (loseUpload) throw new Error("secret upload response lost");
        return success({ uuid: uploadUuid, channel: "listed", version: "2.0.10", processed: true, valid: true, submitted: false });
      }
      if (url === `${amoAddon}versions/` && options.method === "POST") {
        service.mutations.create += 1;
        service.created = true;
        if (loseCreate) throw new Error("secret create response lost");
        return success(amoVersion());
      }
      if (options.method === "PATCH") {
        service.mutations.metadata += 1;
        if (failMetadata) { failMetadata = false; return new Response("private backend detail", { status: 500 }); }
        service.notes = JSON.parse(options.body);
        if (loseMetadata) { loseMetadata = false; return new Response("private backend detail", { status: 500 }); }
        return success(amoVersion(service.notes, service.status, service.hash));
      }
      assert.fail(`Unexpected public API request ${options.method} ${url}`);
    }
  };
  return service;
}

test("accepted Firefox version and source recover a failed notes PATCH without another extension upload", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  const service = amoService(f, { failMetadata: true });
  await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request: service.request }), /HTTP 500/);
  const failed = JSON.parse(await readFile(f.receiptPath, "utf8"));
  assert.equal(failed.remote.version.id, 900);
  assert.equal(failed.operations["amo-version-intent"].outcome, "accepted");
  assert.equal(failed.stage, "amo-metadata-intent");
  assert.equal(failed.state, "attention-required");
  const receipt = await submitReleaseChannel({ ...f, channel: "firefox", request: service.request });
  assert.deepEqual(service.mutations, { upload: 1, create: 1, metadata: 2 });
  assert.equal(receipt.state, "under-review");
  assert.equal(receipt.operations["amo-metadata-intent"].outcome, "accepted");
});

test("Firefox status distinguishes review and approval from unauthenticated public availability after signing", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  const service = amoService(f);
  await submitReleaseChannel({ ...f, channel: "firefox", request: service.request });
  const initialMutations = { ...service.mutations };
  const pending = await reconcileReleaseChannel({ ...f, channel: "firefox", request: service.request });
  assert.equal(pending.state, "under-review");
  service.status = "public";
  service.hash = `sha256:${"e".repeat(64)}`;
  const approved = await reconcileReleaseChannel({ ...f, channel: "firefox", request: service.request });
  assert.equal(approved.state, "approved");
  assert.equal(approved.remote.version.fileHash, `sha256:${"e".repeat(64)}`);
  service.publicAvailable = true;
  const available = await reconcileReleaseChannel({ ...f, channel: "firefox", request: service.request });
  assert.equal(available.state, "publicly-available");
  assert.deepEqual(service.mutations, initialMutations);
});

test("read-only status on prepared verification bundles never uploads or publishes any channel", async t => {
  for (const channel of ["chrome", "firefox", "npm"]) {
    const f = await prepared(t);
    f.release.manifest.build.analytics = "verification";
    let mutations = 0;
    const receipt = await reconcileReleaseChannel({ ...f, channel, request: async (url, options) => {
      if (options.method !== "GET") mutations += 1;
      if (channel === "chrome") return success(chromeStatus());
      if (channel === "npm") return missing();
      return url === amoAddon ? success(addon) : missing();
    } });
    assert.equal(mutations, 0);
    assert.equal(receipt.state, "prepared");
  }
});

test("unconfirmed Firefox uploads or version creation stop, while a completed lost notes response reconciles safely", async t => {
  for (const failure of ["upload", "create", "metadata"]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.firefox = true;
    const service = amoService(f, { loseUpload: failure === "upload", loseCreate: failure === "create", loseMetadata: failure === "metadata" });
    await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request: service.request }));
    const failed = await readFile(f.receiptPath, "utf8");
    assert(!failed.includes("secret ") && !failed.includes("private backend"));
    const before = { ...service.mutations };
    if (failure === "metadata") {
      const receipt = await submitReleaseChannel({ ...f, channel: "firefox", request: service.request });
      assert.equal(receipt.state, "under-review");
    } else {
      await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request: service.request }), /intent|accepted|proof|uncertain|receipt/);
    }
    assert.deepEqual(service.mutations, before);
  }
});

test("accepted Firefox upload UUID resumes validation and version creation without uploading twice", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  const service = amoService(f);
  let validationDown = true;
  const request = async (url, options) => {
    if (url === `${amoBase}addons/upload/` && options.method === "POST") {
      const response = await service.request(url, options);
      return success({ ...await response.json(), processed: false });
    }
    if (url === `${amoBase}addons/upload/${uploadUuid}/` && validationDown) return new Response("private service details", { status: 503 });
    return service.request(url, options);
  };
  await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request }), /HTTP 503/);
  const partial = JSON.parse(await readFile(f.receiptPath, "utf8"));
  assert.equal(partial.remote.upload.uuid, uploadUuid);
  assert.equal(partial.operations["amo-upload-intent"].outcome, "accepted");
  validationDown = false;
  const receipt = await submitReleaseChannel({ ...f, channel: "firefox", request });
  assert.equal(receipt.state, "under-review");
  assert.deepEqual(service.mutations, { upload: 1, create: 1, metadata: 1 });
});

test("Chrome rejected, cancelled, unknown, or contradictory status needs attention without mutating or claiming public availability", async t => {
  for (const state of ["REJECTED", "CANCELLED", "ITEM_STATE_UNSPECIFIED", "UNRECOGNISED"]) {
    const f = await prepared(t);
    await acceptChrome(f);
    const status = chromeStatus("2.0.9", "2.0.10");
    status.submittedItemRevisionStatus.state = state;
    let mutations = 0;
    await assert.rejects(reconcileReleaseChannel({ ...f, channel: "chrome", request: async (_url, options) => {
      if (options.method !== "GET") mutations += 1;
      return success(status);
    } }), /Chrome|state|review|attention/);
    assert.equal(mutations, 0);
    assert.equal(JSON.parse(await readFile(f.receiptPath, "utf8")).state, "attention-required");
  }
  const f = await prepared(t);
  await acceptChrome(f);
  const status = chromeStatus("2.0.10", "2.0.10");
  status.submittedItemRevisionStatus.state = "REJECTED";
  await assert.rejects(reconcileReleaseChannel({ ...f, channel: "chrome", request: async () => success(status) }), /Chrome|contradict|state/);
});

test("npm malformed, mismatched, and failed registry reads are never absence or permission to publish", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.npm = true;
  const valid = { name: "lightstreamer-workbench-agent", version: "0.1.9", gitHead: source, dist: { integrity: sha512(f.release.artifacts.npm.bytes) } };
  for (const response of [
    () => success(null), () => success([]), () => new Response("not-json"),
    () => new Response("Bearer private credential", { status: 503 }),
    () => success({ ...valid, name: "other-agent" }), () => success({ ...valid, version: "0.2.0" }),
    () => success({ ...valid, gitHead: "" }), () => success({ ...valid, gitHead: "c".repeat(40) }),
    () => success({ ...valid, dist: { integrity: "sha512-different-bytes" } }),
    () => success({ ...valid, dist: { tarball: "https://example.test/agent.tgz" } })
  ]) {
    await rm(f.receiptPath, { force: true });
    let publishes = 0;
    await assert.rejects(submitReleaseChannel({ ...f, channel: "npm", visibilityAttempts: 1, runNpm: async () => { publishes += 1; return { code: 1 }; }, request: async () => response() }));
    assert.equal(publishes, 0);
    assert(!String(await readFile(f.receiptPath)).includes("private credential"));
  }
});

test("a Firefox metadata response for different immutable IDs preserves its partial receipt and successful other channels", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent = { chrome: true, firefox: true, npm: true };
  const chromePath = f.receiptPath.replace("receipt.json", "chrome.json");
  const npmPath = f.receiptPath.replace("receipt.json", "npm.json");
  await acceptChrome({ ...f, receiptPath: chromePath });
  const chromeBefore = await readFile(chromePath, "utf8");
  const service = amoService(f);
  const request = async (url, options) => options.method === "PATCH"
    ? success({ ...amoVersion(f.release.firefoxMetadata.version), id: 999, file: { ...amoVersion().file, id: 998 } })
    : service.request(url, options);
  await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request }), /AMO|identity|ID/);
  const partial = JSON.parse(await readFile(f.receiptPath, "utf8"));
  assert.equal(partial.remote.version.id, 900);
  assert.equal(partial.remote.version.fileId, 901);
  assert.equal(partial.state, "attention-required");
  const npm = await submitReleaseChannel({ ...f, channel: "npm", receiptPath: npmPath, request: async () => success({ name: "lightstreamer-workbench-agent", version: "0.1.9", gitHead: source, dist: { integrity: sha512(f.release.artifacts.npm.bytes) } }) });
  assert.equal(npm.state, "publicly-available");
  assert.equal(await readFile(chromePath, "utf8"), chromeBefore);
});

test("missing run identity, contradictory Actions context, and incomplete frozen metadata block every request", async t => {
  for (const change of [
    f => { delete f.context.runId; delete f.verification.runId; },
    f => { f.context.runAttempt = 0; },
    f => { f.env.GITHUB_EVENT_NAME = "push"; },
    f => { f.env.GITHUB_REF = "refs/heads/topic"; },
    f => { f.env.GITHUB_RUN_ID = "54321"; },
    f => { delete f.release.firefoxMetadata; },
    f => { f.release.firefoxMetadata.version.release_notes = null; },
    f => { f.release.manifest.firefoxMetadata.sha256 = "not-a-digest"; },
    f => { f.release.manifest.extension.file = "../chrome.zip"; f.release.artifacts.chrome.file = "../chrome.zip"; }
  ]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.chrome = true;
    change(f);
    let requests = 0;
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request: async () => { requests += 1; return success(chromeStatus()); } }));
    assert.equal(requests, 0);
  }
});

test("Chrome exchanges env-only refresh credentials in memory before exact-artifact submission", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.chrome = true;
  delete f.env.CWS_ACCESS_TOKEN;
  Object.assign(f.env, { CWS_CLIENT_ID: "oauth-client", CWS_CLIENT_SECRET: "oauth-private&secret", CWS_REFRESH_TOKEN: "refresh-private+token" });
  let exchanges = 0;
  const receipt = await submitReleaseChannel({ ...f, channel: "chrome", request: async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      exchanges += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert(options.body instanceof URLSearchParams);
      assert.equal(options.body.get("client_secret"), "oauth-private&secret");
      assert.equal(options.body.get("refresh_token"), "refresh-private+token");
      assert.equal(options.body.get("grant_type"), "refresh_token");
      return success({ access_token: "new-private-access-token", token_type: "Bearer", expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, "Bearer new-private-access-token");
    if (options.method === "GET") return success(chromeStatus());
    return success(url.includes(":upload?")
      ? { name: resource, itemId: chromeId, crxVersion: "2.0.10", uploadState: "SUCCEEDED" }
      : { name: resource, itemId: chromeId, state: "PENDING_REVIEW" });
  } });
  assert.equal(exchanges, 1);
  assert.equal(receipt.state, "under-review");
  assert.equal(f.env.CWS_ACCESS_TOKEN, undefined);
  for (const secret of ["oauth-private&secret", "refresh-private+token", "new-private-access-token"]) assert(!JSON.stringify(receipt).includes(secret));
});

test("missing npm trusted-publishing prerequisites stop before recording a publication attempt", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.npm = true;
  let reads = 0;
  await assert.rejects(submitReleaseChannel({ ...f, channel: "npm", visibilityAttempts: 1, request: async () => { reads += 1; return missing(); } }), /trusted-publishing environment/);
  assert.equal(reads, 1);
  const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
  assert.equal(receipt.stage, "prepared");
  assert.equal(receipt.state, "attention-required");
  assert.equal(receipt.operations["npm-publish-intent"], undefined);
});

test("damaged accepted receipts or a future attempt cannot authorize even a status observation", async t => {
  for (const change of [
    receipt => { delete receipt.remote.upload; },
    receipt => { receipt.remote.upload.version = "2.0.11"; },
    receipt => { delete receipt.operations["chrome-upload-intent"]; },
    receipt => { receipt.remote.publish.resource = "publishers/another/items/other"; },
    receipt => { receipt.runAttempt = 2; },
    receipt => { receipt.artifactHashes.firefoxSource = "0".repeat(64); }
  ]) {
    const f = await prepared(t);
    await acceptChrome(f);
    const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
    change(receipt);
    await writeFile(f.receiptPath, JSON.stringify(receipt));
    let requests = 0;
    await assert.rejects(reconcileReleaseChannel({ ...f, channel: "chrome", request: async () => { requests += 1; return success(chromeStatus("2.0.9", "2.0.10")); } }), /receipt|proof|attempt/);
    assert.equal(requests, 0);
  }
});

test("Firefox sends and confirms the explicitly frozen license at both version and metadata stages", async t => {
  const f = await prepared(t);
  f.release.manifest.publicationIntent.firefox = true;
  f.release.firefoxMetadata.version.license = "apache-2.0";
  const service = amoService(f);
  let versionLicense;
  const request = async (url, options) => {
    if (options.method === "POST" && url === `${amoAddon}versions/`) versionLicense = options.body.get("license");
    const response = await service.request(url, options);
    if (options.method === "PATCH") return success({ ...await response.json(), license: { slug: "apache-2.0" } });
    return response;
  };
  const receipt = await submitReleaseChannel({ ...f, channel: "firefox", request });
  assert.equal(versionLicense, "apache-2.0");
  assert.equal(receipt.state, "under-review");
  const wrong = await prepared(t);
  wrong.release.manifest.publicationIntent.firefox = true;
  wrong.release.firefoxMetadata.version.license = "apache-2.0";
  const wrongService = amoService(wrong);
  await assert.rejects(submitReleaseChannel({ ...wrong, channel: "firefox", request: async (url, options) => options.method === "PATCH"
    ? success({ ...amoVersion(wrong.release.firefoxMetadata.version), license: { slug: "mit" } }) : wrongService.request(url, options) }), /metadata|license|notes/i);
  assert.equal(JSON.parse(await readFile(wrong.receiptPath, "utf8")).state, "attention-required");
});

test("fresh rejected or unknown Chrome publication responses preserve attention and prevent resubmission", async t => {
  for (const state of ["REJECTED", "CANCELLED", "Bearer private unexpected state"]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.chrome = true;
    let publishes = 0;
    const request = async (url, options) => {
      if (options.method === "GET") return success(chromeStatus());
      if (url.includes(":upload?")) return success({ name: resource, itemId: chromeId, crxVersion: "2.0.10", uploadState: "SUCCEEDED" });
      publishes += 1;
      return success({ name: resource, itemId: chromeId, state });
    };
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request }), /Chrome|state|rejected|cancelled/);
    const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
    assert.equal(receipt.state, "attention-required");
    assert.equal(receipt.remote.upload.version, "2.0.10");
    assert.equal(receipt.remote.publish.state, state.startsWith("Bearer") ? "UNKNOWN" : state);
    assert(!JSON.stringify(receipt).includes("private unexpected"));
    await assert.rejects(submitReleaseChannel({ ...f, channel: "chrome", request }), /Chrome|uncertain|intent|absent/);
    assert.equal(publishes, 1);
  }
});

test("a disabled or unknown Firefox version response stops before metadata mutation and preserves accepted IDs", async t => {
  for (const change of [
    version => { version.is_disabled = true; },
    version => { version.file.status = "disabled"; },
    version => { version.file.status = "JWT private unexpected state"; }
  ]) {
    const f = await prepared(t);
    f.release.manifest.publicationIntent.firefox = true;
    const service = amoService(f);
    const request = async (url, options) => {
      const response = await service.request(url, options);
      if (url === `${amoAddon}versions/` && options.method === "POST") {
        const version = await response.json();
        change(version);
        return success(version);
      }
      return response;
    };
    await assert.rejects(submitReleaseChannel({ ...f, channel: "firefox", request }), /AMO|disabled|state/);
    const receipt = JSON.parse(await readFile(f.receiptPath, "utf8"));
    assert.equal(service.mutations.metadata, 0);
    assert.equal(receipt.state, "attention-required");
    assert.equal(receipt.remote.version.id, 900);
    assert.equal(receipt.operations["amo-version-intent"].outcome, "accepted");
    assert(!JSON.stringify(receipt).includes("private unexpected"));
  }
});
