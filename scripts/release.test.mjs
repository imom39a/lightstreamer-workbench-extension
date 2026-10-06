import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createReleaseBundle, extractReleaseBundle, readFrozenRelease, writeDeterministicZip } from "./package-mcp-release.mjs";
import { findReceiptRecovery, findRunRecovery } from "./release.mjs";

const sourceSha = "c".repeat(40);
const source = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const agent = JSON.parse(await readFile(new URL("../agent/package.json", import.meta.url), "utf8"));

test("one candidate bundle freezes matching Chrome, Firefox, reviewer source and exact npm bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-frozen-release-"));
  try {
    const names = await inputs(directory);
    const result = await createReleaseBundle({ releaseDir: directory, sourceSha,
      publicationIntent: {chrome:false,firefox:false,npm:false}, analytics: "verification" });
    assert.equal(result.manifest.format, "lightstreamer-workbench-mcp-release-v2");
    assert.equal(result.manifest.extension.version, source.version);
    assert.equal(result.manifest.firefox.version, source.version);
    assert.equal(result.manifest.firefox.id, "lightstreamer-workbench@imom39a");
    assert.equal(result.manifest.firefoxSource.file, `extension/${names.firefoxSource}`);
    assert.equal(result.manifest.mcp.version, agent.version);
    assert.deepEqual(result.manifest.publicationIntent, {chrome:false,firefox:false,npm:false});
    for (const [key, filename] of [["extension",names.chrome],["firefox",names.firefox],["firefoxSource",names.firefoxSource],["mcp",names.npm]]) {
      const bytes = await readFile(join(directory, filename));
      assert.equal(result.manifest[key].size, bytes.length);
      assert.equal(result.manifest[key].sha256, digest(bytes));
    }
    assert.deepEqual(JSON.parse(await readFile(join(directory,"release-manifest.json"),"utf8")), result.manifest);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test("the release CLI refuses a different approved source before building anything", () => {
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const expected=head==="d".repeat(40)?"e".repeat(40):"d".repeat(40);
  const result=spawnSync(process.execPath,["scripts/release.mjs","prepare","--expected-source",expected],{encoding:"utf8",env:{...process.env,GITHUB_SHA:head}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/expected.*source|source.*match/i);
});

test("a channel retry recovers the latest saved receipt and stops after an unrecorded publishing attempt", async () => {
  const context={repository:"owner/repository",runId:"42",runAttempt:3,sourceSha,channel:"chrome"};
  const inventory=[1,2].map(attempt=>({id:10+attempt,name:`workbench-release-receipt-chrome-${attempt}`,expired:false,workflow_run:{id:42,head_sha:sourceSha}}));
  const request=async url=>Response.json(String(url).includes("/artifacts?")?{artifacts:inventory}:String(url).includes("/jobs?")?{jobs:[{name:"Submit Chrome Web Store",status:"completed",conclusion:"failure"}]}:{id:42,head_sha:sourceSha});
  assert.deepEqual(await findReceiptRecovery({...context,request}),{mode:"recover",artifactId:12});
  await assert.rejects(findReceiptRecovery({...context,request:async url=>Response.json(String(url).includes("/artifacts?")?{artifacts:inventory.slice(0,1)}:String(url).includes("/jobs?")?{jobs:[{name:"Submit Chrome Web Store",status:"completed",conclusion:"failure"}]}:{id:42,head_sha:sourceSha})}),/receipt|ambiguous/i);
});

test("a whole-run retry restores the original candidate or stops when it cannot recover it", async () => {
  const calls=[];
  const context={repository:"owner/repository",runId:"42",runAttempt:2,sourceSha};
  const request=async url => {
    calls.push(String(url));
    return Response.json(String(url).includes("/artifacts?") ? {artifacts:[{id:9,name:"workbench-frozen-release-42",expired:false,workflow_run:{id:42,head_sha:sourceSha}}]} : {id:42,head_sha:sourceSha});
  };
  assert.deepEqual(await findRunRecovery({...context,request}),{mode:"recover",artifactId:9});
  assert(calls.every(url=>url.startsWith("https://api.github.com/repos/owner/repository/actions/runs/42")));
  await assert.rejects(findRunRecovery({...context,request:async url=>Response.json(String(url).includes("/artifacts?")?{artifacts:[]}:{id:42,head_sha:sourceSha})}),/cannot recover|missing/i);
  await assert.rejects(findRunRecovery({...context,request:async()=>Response.json({id:42,head_sha:"d".repeat(40)})}),/source/);
});

test("restoring a frozen candidate retains exact inputs and refuses modified bytes or a different source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workbench-restored-release-"));
  try {
    const names = await inputs(directory);
    const bundle = await createReleaseBundle({ releaseDir: directory, sourceSha });
    const manifestPath = join(directory,"restored/release-manifest.json");
    await extractReleaseBundle({bundlePath:bundle.output,directory:join(directory,"restored"),expectedSource:sourceSha});
    const restored = await readFrozenRelease({manifestPath,expectedSource:sourceSha});
    assert.deepEqual(restored.artifacts.firefox.bytes, await readFile(join(directory,names.firefox)));
    assert.deepEqual(restored.artifacts.firefoxSource.bytes, await readFile(join(directory,names.firefoxSource)));
    assert.deepEqual(restored.artifacts.npm.bytes, await readFile(join(directory,names.npm)));
    assert.equal(restored.manifestSha256,digest(await readFile(manifestPath)));
    assert.equal(restored.firefoxMetadata.version.approval_notes,"Synthetic reviewer notes");
    await assert.rejects(readFrozenRelease({manifestPath,expectedSource:"d".repeat(40)}),/source/);
    await writeFile(restored.artifacts.chrome.path,"changed after verification");
    await assert.rejects(readFrozenRelease({manifestPath,expectedSource:sourceSha}),/hash|size/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

async function inputs(directory) {
  const names = {
    chrome: `${source.name}-v${source.version}.zip`,
    firefox: `${source.name}-firefox-v${source.version}.zip`,
    firefoxSource: `${source.name}-firefox-source-v${source.version}.zip`,
    npm: `${agent.name}-${agent.version}.tgz`
  };
  await writeDeterministicZip([{name:"manifest.json",bytes:Buffer.from(JSON.stringify({manifest_version:3,version:source.version}))}],join(directory,names.chrome));
  await writeDeterministicZip([{name:"manifest.json",bytes:Buffer.from(JSON.stringify({manifest_version:3,version:source.version,browser_specific_settings:{gecko:{id:"lightstreamer-workbench@imom39a"}},incognito:"not_allowed",background:{scripts:["extension/background.js"]}}))}],join(directory,names.firefox));
  await writeDeterministicZip([
    {name:"README.md",bytes:Buffer.from(`Source commit: ${sourceSha}\n`)},
    {name:"package.json",bytes:Buffer.from(JSON.stringify(source))},
    {name:"public/manifest.json",bytes:Buffer.from(JSON.stringify({manifest_version:3,version:source.version}))}
  ],join(directory,names.firefoxSource));
  await writeFile(join(directory,names.npm),tgz({name:agent.name,version:agent.version,gitHead:sourceSha}));
  await writeFile(join(directory,"agent-release.json"),JSON.stringify({name:agent.name,version:agent.version,filename:names.npm,sha:sourceSha,publish:false}));
  await writeFile(join(directory,"firefox-submission.json"),JSON.stringify({version:{release_notes:{"en-US":"Synthetic release"},approval_notes:"Synthetic reviewer notes"}}));
  return names;
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function tgz(metadata) {
  const bytes=Buffer.from(JSON.stringify(metadata)),header=Buffer.alloc(512),padded=Buffer.alloc(Math.ceil(bytes.length/512)*512);
  header.write("package/package.json");header.write(`${bytes.length.toString(8).padStart(11,"0")}\0`,124,"ascii");bytes.copy(padded);
  return gzipSync(Buffer.concat([header,padded,Buffer.alloc(1024)]));
}
