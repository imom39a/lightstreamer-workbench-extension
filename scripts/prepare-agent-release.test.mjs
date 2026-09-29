import { test } from "node:test";
import assert from "node:assert/strict";
import { planRelease, readRegistry } from "./prepare-agent-release.mjs";

const metadata = { name: "@example/agent", version: "0.1.0" };
const sha = "a".repeat(40);
const registry = versions => ({ name: metadata.name, versions });
test("first publication starts at the source version", () => {
  assert.deepEqual(planRelease(metadata, null, sha), { ...metadata, sha, publish: true });
});
test("main changes increment the highest stable patch without reusing old versions", () => {
  const history = registry({ "0.1.9": {}, "0.1.10": {}, "0.2.0-beta.1": {} });
  assert.equal(planRelease(metadata, history, sha).version, "0.1.11");
});
test("a deliberate source minor version takes precedence", () => {
  assert.equal(planRelease({ ...metadata, version: "0.2.0" }, registry({ "0.1.9": {} }), sha).version, "0.2.0");
});
test("rerunning an already published source commit never publishes another patch", () => {
  assert.deepEqual(planRelease(metadata, registry({ "0.1.3": { version: "0.1.3", gitHead: sha } }), sha),
    { name: metadata.name, version: "0.1.3", sha, publish: false });
});
test("a fully unpublished package still reserves its former versions", () => {
  const tombstone = { name: metadata.name, time: { unpublished: { versions: ["0.1.0", "0.1.1"] } } };
  assert.equal(planRelease(metadata, tombstone, sha).version, "0.1.2");
  assert.equal(planRelease({ ...metadata, version: "0.1.2" }, tombstone, sha).version, "0.1.2");
});
test("invalid versions, commit identities and mismatched registry data fail closed", () => {
  assert.throws(() => planRelease({ ...metadata, version: "0.1" }, null, sha));
  assert.throws(() => planRelease(metadata, null, "main"));
  assert.throws(() => planRelease(metadata, { name: "other", versions: {} }, sha));
  assert.throws(() => planRelease(metadata, { name: metadata.name, time: { unpublished: { versions: null } } }, sha));
});
test("only an actual registry 404 means unpublished; auth/server/network failures abort", async () => {
  assert.equal(await readRegistry(metadata.name, async () => ({ status: 404 })), null);
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(readRegistry(metadata.name, async () => ({ status, ok: false })), /Refusing to allocate/);
  }
  await assert.rejects(readRegistry(metadata.name, async () => { throw new Error("network down"); }), /network down/);
});
