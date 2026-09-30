import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Publication can succeed before every registry edge exposes the new version.
// Retry visibility only; a visible artifact must match the tested source/digest.
export async function verifyPublishedAgent(expected, {
  request = fetch,
  delay = () => new Promise(resolveDelay => setTimeout(resolveDelay, 15_000)),
  attempts = 9,
  onPending = () => {}
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 9) {
    throw new Error("Publication verification requires 1–9 bounded attempts.");
  }
  const url = `https://registry.npmjs.org/${encodeURIComponent(expected.name)}/${encodeURIComponent(expected.version)}`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await request(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) {
      await response.body?.cancel();
      if (attempt === attempts) throw new Error(`Published ${expected.name}@${expected.version} is not visible after ${attempts} attempts.`);
      onPending(attempt);
      await delay();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`npm publication verification failed: HTTP ${response.status}.`);
    }
    const metadata = await response.json();
    if (metadata.name !== expected.name || metadata.version !== expected.version
      || metadata.gitHead !== expected.sha || metadata.dist?.integrity !== expected.integrity) {
      throw new Error("Published npm artifact does not match the tested name, version, source commit, and integrity.");
    }
    return metadata;
  }
}

async function main() {
  const plan = JSON.parse(await readFile("release/agent-release.json", "utf8"));
  const filename = `${plan.name.replace(/^@/, "").replaceAll("/", "-")}-${plan.version}.tgz`;
  if (plan.filename !== filename || !/^[a-f0-9]{40}$/.test(plan.sha)
    || !/^\d+\.\d+\.\d+$/.test(plan.version)) {
    throw new Error("Invalid npm publication plan.");
  }
  const tarball = await readFile(resolve("release", filename));
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  await verifyPublishedAgent({ name: plan.name, version: plan.version, sha: plan.sha, integrity }, {
    onPending: attempt => console.log(`npm registry visibility pending (${attempt}/9); retrying in 15 seconds.`)
  });
  console.log(`Published npm artifact verified: ${plan.name}@${plan.version}, source ${plan.sha}, ${integrity}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
