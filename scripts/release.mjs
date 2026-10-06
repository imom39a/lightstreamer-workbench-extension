#!/usr/bin/env node
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { spawn } from "cross-spawn";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createReleaseBundle, extractReleaseBundle, extractFrozenBrowser, readFrozenRelease } from "./package-mcp-release.mjs";

const root=resolve(import.meta.dirname,"..");
const shaPattern=/^[a-f0-9]{40}$/;

export async function findRunRecovery({repository,runId,runAttempt,sourceSha,request=fetch,token}) {
  const api=runApi(repository,runId);
  if (!shaPattern.test(sourceSha) || !Number.isSafeInteger(runAttempt) || runAttempt<1) throw new Error("Invalid source/run attempt for release recovery.");
  const get=url=>githubJson(url,{request,token});
  const run=await get(api);
  if (String(run.id)!==String(runId) || run.head_sha!==sourceSha) throw new Error("Release recovery run source does not match GITHUB_SHA.");
  const artifacts=await pages(`${api}/artifacts`,"artifacts",get);
  const found=artifacts.filter(artifact=>artifact.name===`workbench-frozen-release-${runId}`);
  if (found.length!==1) {
    if (runAttempt===1 && found.length===0) return {mode:"prepare",artifactId:null};
    throw new Error("Retry cannot recover one original frozen candidate. Do not rebuild or allocate a new version; investigate the missing/duplicate artifact.");
  }
  const artifact=found[0];
  if (artifact.expired || String(artifact.workflow_run?.id)!==String(runId) || artifact.workflow_run?.head_sha!==sourceSha || !Number.isSafeInteger(artifact.id)) throw new Error("Frozen artifact is expired or has mismatched run/source provenance.");
  if (runAttempt===1) throw new Error("First attempt already has a frozen candidate; refusing to overwrite it.");
  return {mode:"recover",artifactId:artifact.id};
}

export async function findReceiptRecovery({repository,runId,runAttempt,sourceSha,channel,request=fetch,token}) {
  const names={chrome:"Submit Chrome Web Store",firefox:"Submit Firefox AMO",npm:"Publish the verified npm artifact"};
  if (!names[channel] || !shaPattern.test(sourceSha) || !Number.isSafeInteger(runAttempt) || runAttempt<1) throw new Error("Invalid channel/source/run attempt for receipt recovery.");
  if (runAttempt===1) return {mode:"new",artifactId:null};
  const api=runApi(repository,runId),get=url=>githubJson(url,{request,token});
  const run=await get(api);
  if (String(run.id)!==String(runId) || run.head_sha!==sourceSha) throw new Error("Receipt recovery run source does not match GITHUB_SHA.");
  const artifacts=await pages(`${api}/artifacts`,"artifacts",get);
  let latest=null;
  for (let attempt=1;attempt<runAttempt;attempt++) {
    const found=artifacts.filter(artifact=>artifact.name===`workbench-release-receipt-${channel}-${attempt}`);
    const jobs=await pages(`${api}/attempts/${attempt}/jobs`,"jobs",get);
    const previous=jobs.filter(job=>job.name===names[channel]);
    if (previous.length>1 || previous.some(job=>job.status!=="completed")) throw new Error("Previous publishing attempt has ambiguous or unfinished job state.");
    const started=previous.some(job=>job.conclusion!=="skipped");
    if (!found.length && started) throw new Error(`Publishing attempt ${attempt} has no saved ${channel} receipt. Its outcome is ambiguous; inspect remote state before any further mutation.`);
    if (!found.length) continue;
    const receipt=found[0];
    if (found.length!==1 || receipt.expired || String(receipt.workflow_run?.id)!==String(runId) || receipt.workflow_run?.head_sha!==sourceSha || !Number.isSafeInteger(receipt.id)) throw new Error("Saved receipt artifact is ambiguous, expired or has mismatched source/run identity.");
    latest=receipt.id;
  }
  return latest===null?{mode:"new",artifactId:null}:{mode:"recover",artifactId:latest};
}

function runApi(repository,runId) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??"") || !/^\d+$/.test(String(runId??""))) throw new Error("Expected repository and numeric workflow run ID.");
  return `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
}
async function githubJson(url,{request,token}) {
  const response=await request(url,{headers:{Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",...(token?{Authorization:`Bearer ${token}`}:{})},signal:AbortSignal.timeout(30000),redirect:"error"});
  if (!response.ok) throw new Error(`GitHub release recovery lookup failed: HTTP ${response.status}.`);
  return response.json();
}
async function pages(url,key,get) {
  const items=[];
  for (let page=1;page<=100;page++) {
    const response=await get(`${url}?per_page=100&page=${page}`);
    if (!Array.isArray(response[key])) throw new Error(`GitHub release recovery returned an invalid ${key} inventory.`);
    items.push(...response[key]);
    if (response[key].length<100) return items;
  }
  throw new Error("Release recovery inventory exceeded its pagination bound; refusing an incomplete lookup.");
}

function checkedSource(expected) {
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  if (!shaPattern.test(expected??"") || expected!==head || (process.env.GITHUB_SHA && process.env.GITHUB_SHA!==head)) throw new Error("Expected source commit does not match checked-out HEAD and GITHUB_SHA.");
  return head;
}
function intent() {
  const result={};
  for (const channel of ["chrome","firefox","npm"]) {
    const value=process.env[`RELEASE_PUBLISH_${channel.toUpperCase()}`]??"false";
    if (!["true","false"].includes(value)) throw new Error(`RELEASE_PUBLISH_${channel.toUpperCase()} must be true or false.`);
    result[channel]=value==="true";
  }
  return result;
}
function requireManualMain(sourceSha,publicationIntent) {
  if (!Object.values(publicationIntent).some(Boolean)) return;
  if (process.env.GITHUB_EVENT_NAME!=="workflow_dispatch" || process.env.GITHUB_REF!=="refs/heads/main" || process.env.GITHUB_SHA!==sourceSha) throw new Error("Publication intent requires manual main dispatch with the exact approved GITHUB_SHA.");
}
async function run(command,args,env) {
  await new Promise((done,reject)=>{
    const child=spawn(command,args,{cwd:root,env,stdio:"inherit",shell:false});
    child.once("error",reject);
    child.once("exit",code=>code===0?done():reject(new Error(`Release preparation command ${command} exited ${code}.`)));
  });
}

async function prepare(options) {
  const sourceSha=checkedSource(options["expected-source"]),publicationIntent=intent();
  requireManualMain(sourceSha,publicationIntent);
  const dirty=execFileSync("git",["status","--porcelain=v1","--untracked-files=no"],{cwd:root,encoding:"utf8"}).trim();
  if (dirty) throw new Error("Commit the reviewed source before preparing a frozen release.");
  const metadataPath=resolve(root,options.metadata??"store-listing/firefox-submission.json");
  const metadataBytes=await readFile(metadataPath);
  const notes=JSON.parse(metadataBytes.toString("utf8"));
  if (!notes.version?.release_notes?.["en-US"]?.trim() || !notes.version?.approval_notes?.trim()) throw new Error("Provide explicit Firefox release/reviewer metadata before preparing the candidate.");
  const directory=join(root,"release");
  await mkdir(directory,{recursive:true});
  const publishing=Object.values(publicationIntent).some(Boolean);
  const analytics=publishing?"production":"verification";
  const environment={...process.env,GITHUB_SHA:sourceSha,LSEW_ANALYTICS_DISABLED:"0",...(publishing?{}:{VITE_LSEW_GA_MEASUREMENT_ID:"G-VERIFY0000",VITE_LSEW_GA_API_SECRET:"verification-only-not-a-secret",VITE_LSEW_GA_DEBUG:"false"})};
  // Validate real store configuration through the existing Google validation
  // endpoint (not ingestion). Offline candidates carry explicit synthetic config.
  if (publishing) await run(process.execPath,["scripts/validate-analytics.mjs"],environment);
  await run(process.execPath,["scripts/build-extension.mjs"],environment);
  await run(process.execPath,["scripts/build-extension.mjs","--browser","firefox"],environment);
  for (const browser of ["chrome","firefox"]) await run(process.execPath,["scripts/package-extension.mjs","--browser",browser,"--skip-typecheck","--skip-tests","--skip-build","--out-dir",directory],environment);
  // The reviewer source is captured before npm's generated version/gitHead
  // changes; both browser archives therefore refer to the committed source.
  await run(process.execPath,["scripts/package-firefox-source.mjs"],environment);
  await writeFile(join(directory,"firefox-submission.json"),metadataBytes);
  const agentMetadataPath=join(root,"agent/package.json"),originalAgent=await readFile(agentMetadataPath);
  try {
    await run(process.execPath,["scripts/prepare-agent-release.mjs",...(publicationIntent.npm?["--release"]:[])],environment);
    await run("npm",["run","agent:pack"],environment);
  } finally { await writeFile(agentMetadataPath,originalAgent); }
  const result=await createReleaseBundle({releaseDir:directory,sourceSha,publicationIntent,analytics});
  const frozenDirectory=resolve(root,options["out-dir"]??"release/frozen-input");
  await mkdir(frozenDirectory,{recursive:true});
  await copyFile(result.output,join(frozenDirectory,"release-bundle.zip"),1);
  await output({bundle:join(frozenDirectory,"release-bundle.zip"),version:result.manifest.mcp.version,filename:result.manifest.mcp.file,chrome:String(publicationIntent.chrome),firefox:String(publicationIntent.firefox),npm:String(publicationIntent.npm)},options);
  console.log(`Frozen unpublished candidate: ${sourceSha}, browsers ${result.manifest.extension.version}, companion ${result.manifest.mcp.version}.`);
}

function parse(raw) {
  const options={};
  for (let index=0;index<raw.length;index+=2) {
    const name=raw[index],value=raw[index+1];
    if (!name.startsWith("--") || !value || value.startsWith("--") || Object.hasOwn(options,name.slice(2))) throw new Error("Release options require unique --name value pairs.");
    options[name.slice(2)]=value;
  }
  const allowed=["expected-source","metadata","out-dir","github-output","bundle","manifest","channel","browser","verification","receipt"];
  if (Object.keys(options).some(key=>!allowed.includes(key))) throw new Error("Unknown release option.");
  return options;
}
async function output(values,options) {
  if (options["github-output"]) await appendFile(options["github-output"],Object.entries(values).map(([key,value])=>`${key}=${value}\n`).join(""));
}
async function main() {
  const [command,...raw]=process.argv.slice(2),options=parse(raw);
  if (command==="prepare") return prepare(options);
  throw new Error("Usage: release.mjs <prepare|restore|inspect|browser-input|recovery|receipt-recovery|verify|submit|reconcile> --expected-source SHA [--name value]");
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message);process.exitCode=1; }
}
