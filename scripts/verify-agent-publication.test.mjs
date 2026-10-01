import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPublishedAgent } from "./verify-agent-publication.mjs";

const expected = { name: "@example/agent", version: "0.1.5", sha: "a".repeat(40), integrity: "sha512-tested-artifact" };
const published = { name: expected.name, version: expected.version, gitHead: expected.sha, dist: { integrity: expected.integrity } };
const visible = metadata => ({ ok: true, status: 200, json: async () => metadata });

test("a successful publish tolerates delayed visibility and verifies the exact artifact", async () => {
  let calls = 0, delays = 0, cancelled = 0;
  const pending = [];
  const metadata = await verifyPublishedAgent(expected, {
    request: async (url, options) => {
      assert.equal(url, "https://registry.npmjs.org/%40example%2Fagent/0.1.5");
      assert(options.signal instanceof AbortSignal);
      calls += 1;
      return calls < 3 ? { status: 404, body: { cancel: async () => { cancelled += 1; } } } : visible(published);
    },
    delay: async () => { delays += 1; },
    onPending: attempt => pending.push(attempt)
  });
  assert.deepEqual(metadata, published);
  assert.equal(calls, 3);
  assert.equal(delays, 2);
  assert.equal(cancelled, 2);
  assert.deepEqual(pending, [1, 2]);
});

test("permanent absence exhausts the fixed retry budget", async () => {
  let calls = 0, delays = 0;
  await assert.rejects(verifyPublishedAgent(expected, {
    attempts: 3,
    request: async () => { calls += 1; return { status: 404 }; },
    delay: async () => { delays += 1; }
  }), /not visible after 3 attempts/);
  assert.equal(calls, 3);
  assert.equal(delays, 2);
});

test("publication pending beyond the old retry window can still become visible", async () => {
  let calls = 0;
  const metadata = await verifyPublishedAgent(expected, {
    request: async () => ++calls < 12 ? { status: 404 } : visible(published),
    delay: async () => {}
  });
  assert.deepEqual(metadata, published);
  assert.equal(calls, 12);
});

test("wrong visible name, version, source, or digest fails immediately", async () => {
  for (const changed of [{ name: "other" }, { version: "0.1.4" }, { gitHead: "b".repeat(40) }, { dist: { integrity: "sha512-other-artifact" } }, { dist: undefined }]) {
    let calls = 0;
    await assert.rejects(verifyPublishedAgent(expected, {
      request: async () => { calls += 1; return visible({ ...published, ...changed }); },
      delay: async () => assert.fail("Mismatched artifacts must not retry")
    }), /does not match the tested/);
    assert.equal(calls, 1);
  }
});

test("authentication, server, and network errors do not masquerade as propagation", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(verifyPublishedAgent(expected, {
      request: async () => ({ status, ok: false }),
      delay: async () => assert.fail("Only visibility errors retry")
    }), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(verifyPublishedAgent(expected, { request: async () => { throw new Error("network down"); } }), /network down/);
});

test("invalid retry budgets cannot create an unbounded verification loop", async () => {
  for (const attempts of [0, 32, 1.5, Infinity]) {
    await assert.rejects(verifyPublishedAgent(expected, { attempts, request: async () => assert.fail("Invalid budgets must fail before fetching") }), /bounded attempts/);
  }
});
