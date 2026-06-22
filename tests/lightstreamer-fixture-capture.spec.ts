import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.LSEW_FIXTURE_URL ?? "http://localhost:8080/";

type FixtureExpectedEvent = {
  item: string;
  marker: string;
  command: string;
  key: string;
};

type Issue16Subscription = {
  items?: string[];
  itemGroup?: string;
  positions?: Array<{ item: string; expectedEvents: number }>;
  expectedEvents: number;
};

type Issue16Group = {
  subscriptionIndex: number;
  itemGroup?: string;
  item: string;
  itemPosition?: number;
  expectedEvents: number;
};

async function readText(path: string): Promise<string> {
  const response = await fetch(new URL(path, baseUrl));
  assert.equal(response.ok, true, `${path} should be served by the fixture`);
  return response.text();
}

async function readLocalText(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const html = await readText("/");
const clientScript = await readText("/fixture-client.js");
const dataAdapter = await readLocalText(
  "../fixtures/lightstreamer/adapter/src/main/java/dev/lightstreamer/workbench/FixtureDataAdapter.java"
);
const metadataAdapter = await readLocalText(
  "../fixtures/lightstreamer/adapter/src/main/java/dev/lightstreamer/workbench/FixtureMetadataAdapter.java"
);

assert.match(html, /Lightstreamer Event Workbench Fixture/);
assert.match(clientScript, /scenario\.snapshot-basic/);
assert.match(clientScript, /scenario\.add-update-delete/);
assert.match(clientScript, /issue-16/);
assert.match(clientScript, /orderDetails\.STORE_NYC_001/);
assert.match(clientScript, /storeAlerts\.STORE_NYC_001/);
assert.match(clientScript, /"command", "key", "name", "qty", "status", "version"/);
assert.match(dataAdapter, /ISSUE_16_EVENT_COUNTS/);
assert.match(dataAdapter, /orderDetails\.STORE_NYC_001/);
assert.match(dataAdapter, /storeAlerts\.STORE_NYC_001/);
assert.match(dataAdapter, /STORE_NYC_001\.INVOICE/);
assert.match(dataAdapter, /STORE_NYC_001\.EXPENSE/);
assert.match(metadataAdapter, /salesActivity\.STORE_NYC_001/);
assert.match(metadataAdapter, /STORE_NYC_001\.INVOICE/);
assert.match(metadataAdapter, /STORE_NYC_001\.EXPENSE/);

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

const issue16SubscriptionMatch = clientScript.match(/const ISSUE_16_SUBSCRIPTIONS = (\[[\s\S]*?\]);/);
assert.ok(issue16SubscriptionMatch, "fixture-client.js should expose issue-16 subscriptions");

const issue16GroupMatch = clientScript.match(/const ISSUE_16_GROUPS = (\[[\s\S]*?\]);/);
assert.ok(issue16GroupMatch, "fixture-client.js should expose issue-16 group expectations");

const issue16Subscriptions = Function(
  `"use strict"; return (${issue16SubscriptionMatch[1]});`
)() as Issue16Subscription[];
const issue16Groups = Function(`"use strict"; return (${issue16GroupMatch[1]});`)() as Issue16Group[];
const issue16TotalEvents = issue16Groups.reduce((total, group) => total + group.expectedEvents, 0);

assert.equal(issue16Subscriptions.length, 15);
assert.equal(issue16Groups.length, 17);
assert.equal(issue16TotalEvents, 1692);
assert.deepEqual(issue16Subscriptions[1], {
  items: ["orderDetails.STORE_NYC_001", "healthCheck.SYS_MONITOR"],
  expectedEvents: 856
});
assert.deepEqual(issue16Subscriptions[5], {
  itemGroup: "salesActivity.STORE_NYC_001",
  positions: [
    { item: "STORE_NYC_001.INVOICE", expectedEvents: 30 },
    { item: "STORE_NYC_001.EXPENSE", expectedEvents: 20 }
  ],
  expectedEvents: 50
});
assert.deepEqual(
  issue16Groups
    .filter((group) => group.subscriptionIndex === 2)
    .map((group) => `${group.item}:${group.expectedEvents}`),
  ["orderDetails.STORE_NYC_001:850", "healthCheck.SYS_MONITOR:6"]
);
assert.deepEqual(
  issue16Groups
    .filter((group) => group.subscriptionIndex === 6)
    .map((group) => `${group.itemGroup}:${group.item}:${group.itemPosition}:${group.expectedEvents}`),
  [
    "salesActivity.STORE_NYC_001:STORE_NYC_001.INVOICE:1:30",
    "salesActivity.STORE_NYC_001:STORE_NYC_001.EXPENSE:2:20"
  ]
);
assert.equal(issue16Groups.at(-1)?.item, "storeAlerts.STORE_NYC_001");

console.log("Lightstreamer fixture smoke assertions passed");
