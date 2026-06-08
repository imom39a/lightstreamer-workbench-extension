import assert from "node:assert/strict";

const baseUrl = process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/";

type FixtureExpectedEvent = {
  item: string;
  marker: string;
  command: string;
  key: string;
};

async function readText(path: string): Promise<string> {
  const response = await fetch(new URL(path, baseUrl));
  assert.equal(response.ok, true, `${path} should be served by the fixture`);
  return response.text();
}

const html = await readText("/");
const clientScript = await readText("/fixture-client.js");

assert.match(html, /Lightstreamer Event Workbench Fixture/);
assert.match(clientScript, /scenario\.snapshot-basic/);
assert.match(clientScript, /scenario\.add-update-delete/);
assert.match(clientScript, /"command", "key", "name", "qty", "status", "version"/);

const expectedMatch = clientScript.match(/const EXPECTED_EVENTS = (\[[\s\S]*?\]);/);
assert.ok(expectedMatch, "fixture-client.js should expose deterministic expected events");

const expectedEvents = Function(`"use strict"; return (${expectedMatch[1]});`)() as FixtureExpectedEvent[];
assert.deepEqual(
  expectedEvents.map((event) => event.item),
  [
    "scenario.snapshot-basic",
    "scenario.snapshot-basic",
    "scenario.add-update-delete",
    "scenario.add-update-delete",
    "scenario.add-update-delete",
    "scenario.add-update-delete"
  ]
);
assert.deepEqual(
  expectedEvents.map((event) => `${event.marker}:${event.command}:${event.key}`),
  [
    "snapshot:ADD:alpha",
    "snapshot:ADD:beta",
    "snapshot:ADD:alpha",
    "live:ADD:gamma",
    "live:UPDATE:gamma",
    "live:DELETE:gamma"
  ]
);

console.log("Lightstreamer fixture smoke assertions passed");
