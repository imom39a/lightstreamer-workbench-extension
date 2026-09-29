import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compare(a, b) {
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

// Registry history is the version authority. The source version is a minimum
// for deliberate minor/major changes; ordinary main changes get the next patch.
export function planRelease(metadata, registry, sha) {
  if (!stable.test(metadata.version)) throw new Error("Agent releases require a stable major.minor.patch version.");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Expected the full source commit SHA.");
  const liveVersions = registry?.versions;
  const unpublishedVersions = registry?.time?.unpublished?.versions;
  if (registry && (registry.name !== metadata.name
    || (liveVersions === undefined && unpublishedVersions === undefined)
    || (liveVersions !== undefined && (!liveVersions || typeof liveVersions !== "object" || Array.isArray(liveVersions)))
    || (unpublishedVersions !== undefined && (!Array.isArray(unpublishedVersions) || !unpublishedVersions.every(version => typeof version === "string"))))) {
    throw new Error("Unexpected npm registry package response.");
  }
  const versions = liveVersions ?? {};
  const previous = Object.values(versions).find(entry => entry.gitHead === sha && stable.test(entry.version));
  if (previous) return { name: metadata.name, version: previous.version, sha, publish: false };
  const newest = [...Object.keys(versions), ...(unpublishedVersions ?? [])]
    .filter(version => stable.test(version)).sort(compare).at(-1);
  const version = !newest || compare(metadata.version, newest) > 0
    ? metadata.version
    : newest.replace(/\d+$/, patch => String(Number(patch) + 1));
  return { name: metadata.name, version, sha, publish: true };
}

export async function readRegistry(name, request = fetch) {
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}. Refusing to allocate a version.`);
  return response.json();
}

async function main() {
  const metadata = JSON.parse(await readFile("agent/package.json", "utf8"));
  const sha = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const release = process.argv.includes("--release");
  const plan = release ? planRelease(metadata, await readRegistry(metadata.name), sha)
    : { name: metadata.name, version: metadata.version, sha, publish: false };
  plan.filename = `${plan.name.replace(/^@/, "").replaceAll("/", "-")}-${plan.version}.tgz`;
  await writeFile("agent/package.json", JSON.stringify({ ...metadata, version: plan.version, gitHead: sha }, null, 2) + "\n");
  await mkdir("release", { recursive: true });
  await writeFile("release/agent-release.json", JSON.stringify(plan, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
    `version=${plan.version}\nfilename=${plan.filename}\npublish=${plan.publish}\n`);
  console.log(`${plan.name}@${plan.version}: ${plan.publish ? "publish after checks" : "verification only / already published"} (${sha})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
