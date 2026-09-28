import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startPortableBroker } from "../../src/agent/companion/portable-broker";
import { DEFAULT_COMPANION_PORT, PAIRING_ENV } from "../../src/agent/pairing";
import { CdpClient, evaluateByValue, waitForCondition } from "./chrome-extension-cdp";

/** Opt-in real Chrome proof. The same loopback runtime runs on every platform. */
export async function proveAgentFixture(root: string, panel: CdpClient, page: CdpClient) {
  const cli = (process.env.LSEW_AGENT_TEST_CLI ?? join(root, "agent/dist/cli.mjs"));
  const client = new Client({ name: "workbench-browser-proof", version: "1" });
  try {
    const origin = await evaluateByValue<string>(panel, "location.origin");
    await headerState(panel, "Waiting");
    // The MCP client, not a manually started broker, owns normal startup.
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--extension-id", origin.slice("chrome-extension://".length)], env: { [PAIRING_ENV]: "" }, stderr: "inherit" }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({ name, arguments: args });
      const text = (reply.content as Array<{ type: string; text: string }>).filter(part => part.type === "text").map(part => part.text).join("\n");
      assert.ok(!reply.isError, `${name}: ${text}`); return JSON.parse(text);
    };
    const sessions = await settle(() => call("list_panel_sessions"), sessions => sessions.length === 1);
    await headerState(panel, "On");
    assert.equal(sessions.length, 1);
    const panelSessionId = sessions[0].panelSessionId;
    const status = await call("get_status", { panelSessionId });
    const pageUrl = await evaluateByValue<string>(page, "location.origin + location.pathname");
    assert.equal(status.inspectedPage.urlWithoutQuery, pageUrl);
    assert.equal(status.permission, "local", "A normal connection grants inspection and Local Injection without settings.");
    assert.ok(status.capabilities.includes("search_evidence") && status.capabilities.includes("search_scope"));
    const scopeSearch = await call("search_scope", { panelSessionId, text: "SCENARIO.MUTATE-REINJECT", limit: 100 });
    assert.ok(scopeSearch.scopes.some((entry: any) => entry.kind === "item" && entry.label === "scenario.mutate-reinject"), "MCP Scope search finds structural objects regardless of tree expansion.");
    const evidenceSearch = await call("search_evidence", { panelSessionId, text: "SCENARIO.MUTATE-REINJECT", limit: 1, includePayload: true });
    assert.ok(evidenceSearch.total > 0 && evidenceSearch.evidence.length === 1, "MCP Evidence search uses case-insensitive canonical matching.");
    if (evidenceSearch.nextCursor) {
      const next = await call("search_evidence", { panelSessionId, cursor: evidenceSearch.nextCursor });
      assert.deepEqual(next.readPoint, evidenceSearch.readPoint);
      assert.notEqual(next.evidence[0].identity.eventId, evidenceSearch.evidence[0].identity.eventId);
    }
    const query = await call("query_evidence", { panelSessionId, limit: 100, includePayload: true });
    const source = query.evidence.findLast((row: any) => row.payload?.kind === "item-update" && row.payload?.source === "server" && row.payload?.listener?.id && row.payload?.item?.name === "scenario.mutate-reinject");
    assert.ok(source, "Agent can query current listener-based official-client Evidence.");
    const document = (command: string, messageText: string) => JSON.stringify({ command, key: "agent-browser.TICKER", isSnapshot: false, fields: { command, key: "agent-browser.TICKER", modelId: "MESSENGER", modelValues: { messageId: "agent-browser", messageText, messageType: "TICKER" } } });
    const baselineCount = await evaluateByValue<number>(page, "Number(document.querySelector('#update-count').textContent)");
    const draft = await call("prepare_local_injection", { panelSessionId, evidence: source.identity, pageEpoch: status.pageEpoch, document: document("ADD", "Agent MCP Local Injection") });
    assert.ok(draft.local.draft.ready, JSON.stringify(draft));
    const request = { panelSessionId, token: draft.token, requestId: "browser-local-1" };
    await call("execute_local_injection", request); await call("execute_local_injection", request);
    await waitForCondition(page, `document.querySelector('#message-text').textContent === 'Agent MCP Local Injection' && Number(document.querySelector('#update-count').textContent) === ${baselineCount + 1}`, "one MCP injection reaches the official-client app exactly once");
    await settle(() => call("get_operation", { panelSessionId, requestId: request.requestId }), result => result.state === "complete");
    await call("finish_agent_document", { panelSessionId, token: draft.token });
    const scenario = await call("prepare_scenario", { panelSessionId, pageEpoch: status.pageEpoch, steps: [{ evidence: source.identity, document: document("UPDATE", "Agent Scenario first") }, { evidence: source.identity, document: document("UPDATE", "Agent Scenario second") }] });
    assert.equal(scenario.scenario.phase, "review", JSON.stringify(scenario));
    for (const [ordinal, message] of [[1, "Agent Scenario first"], [2, "Agent Scenario second"]] as const) {
      const command = { panelSessionId, runId: scenario.scenario.run.id, requestId: `browser-step-${ordinal}`, action: "step" };
      await call("control_scenario", command); await call("control_scenario", command);
      await settle(() => call("get_scenario_trace", { panelSessionId }), result => result.phase === (ordinal === 1 ? "paused" : "complete"));
      await waitForCondition(page, `document.querySelector('#message-text').textContent === ${JSON.stringify(message)} && Number(document.querySelector('#update-count').textContent) === ${baselineCount + 1 + ordinal}`, "Scenario Step changes the inspected app exactly once");
    }
    await call("finish_agent_document", { panelSessionId, token: scenario.token });
    const after = await call("query_evidence", { panelSessionId, limit: 100, includePayload: true });
    assert.ok(after.evidence.some((row: any) => row.payload?.synthetic), "Agent can read marked Local Evidence after commit.");
    await setAgentAccess(panel, false);
    await settle(() => call("list_panel_sessions"), result => result.length === 0);
    console.log(`Agent browser proof passed (npm companion, no installation): real MCP stdio → Chrome panel → official Lightstreamer listener → verified app DOM, duplicate suppression, ordered Scenario and revocation.`);
  } finally {
    await client.close();
  }
}

/** Real extension proof without Docker/Lightstreamer Server; runs on Windows CI too. */
export async function provePortableInspection(root: string, panel: CdpClient, expectedUrl: string) {
  const origin = await evaluateByValue<string>(panel, "location.origin");
  const extensionId = origin.slice("chrome-extension://".length);
  await headerState(panel, "Waiting");
  let broker = await startPortableBroker({ auth: "off", port: DEFAULT_COMPANION_PORT }, extensionId);
  let client = new Client({ name: "portable-chrome-proof", version: "1" });
  const transport = () => new StdioClientTransport({ command: process.execPath, args: [(process.env.LSEW_AGENT_TEST_CLI ?? join(root, "agent/dist/cli.mjs")), "mcp", "--extension-id", extensionId], env: { [PAIRING_ENV]: "" }, stderr: "inherit" });
  try {
    await client.connect(transport());
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError); return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    };
    const sessions = await settle(() => call("list_panel_sessions"), sessions => sessions.length === 1);
    await headerState(panel, "On");
    const panelSessionId = sessions[0].panelSessionId;
    const status = await call("get_status", { panelSessionId });
    assert.equal(status.inspectedPage.urlWithoutQuery, expectedUrl);
    assert.equal(status.permission, "local", "Inspection plus Local Injection requires no permission selection.");
    const query = await call("query_evidence", { panelSessionId, limit: 100, includePayload: true });
    assert.ok(query.evidence.some((entry: any) => entry.payload?.item?.name === "cdp-same-tab-four"));
    assert.ok(status.capabilities.includes("search_evidence") && status.capabilities.includes("search_scope"));
    const scopes = await call("search_scope", { panelSessionId, text: "CDP-SAME-TAB-CLIENT", limit: 100 });
    assert.ok(scopes.scopes.some((entry: any) => entry.kind === "client" && entry.label === "cdp-same-tab-client"), JSON.stringify(scopes));
    const found = await call("search_evidence", { panelSessionId, text: "CDP-SAME-TAB", limit: 1, includePayload: true });
    assert.ok(found.total > 1 && found.nextCursor, "The installed companion can paginate retained Evidence search.");
    const continued = await call("search_evidence", { panelSessionId, cursor: found.nextCursor });
    assert.deepEqual(continued.readPoint, found.readPoint);
    assert.ok(continued.evidence[0].identity.sequence > found.evidence[0].identity.sequence);
    assert.equal(continued.search.within, "page");
    const current = await call("search_evidence", { panelSessionId, text: "CDP-SAME-TAB", within: "current-investigation", limit: 1 });
    assert.equal(current.search.within, "current-investigation");
    await client.close(); broker.close();
    await headerState(panel, "Waiting");
    broker = await startPortableBroker({ auth: "off", port: DEFAULT_COMPANION_PORT }, extensionId);
    client = new Client({ name: "portable-chrome-proof-restarted", version: "1" });
    await client.connect(transport());
    const restored = await settle(() => call("list_panel_sessions"), sessions => sessions.length === 1);
    assert.equal(restored[0].panelSessionId, panelSessionId, "A companion restart reconnects the same panel without UI interaction.");
    await headerState(panel, "On");
    assert.equal((await call("get_status", { panelSessionId })).permission, "local");
    await setAgentAccess(panel, false);
    await headerState(panel, "Off");
    await settle(() => call("list_panel_sessions"), result => result.length === 0);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.deepEqual(await call("list_panel_sessions"), [], "Explicit Off stays off beyond the reconnect interval.");
    await setAgentAccess(panel, true);
    await settle(() => call("list_panel_sessions"), result => result.length === 1);
    await headerState(panel, "On");
    assert.equal((await call("get_status", { panelSessionId })).permission, "local");
    await click(panel, "button", "More actions"); await click(panel, "summary", "Agent access and setup");
    assert.equal(await evaluateByValue(panel, "Boolean(document.querySelector('[aria-label=\"Companion port\"], [aria-label=\"Agent permissions\"]'))"), false);
    await click(panel, "button", "Back to prior investigation");
    await setAgentAccess(panel, false);
    await headerState(panel, "Off");
    console.log("Portable Chrome proof passed: Waiting → On → Waiting → On → Off; exact page, retained Evidence, full local grant, no settings, restart and revocation.");
  } finally { await client.close(); broker.close(); }
}

async function headerState(panel: CdpClient, state: "Waiting" | "On" | "Off") {
  await waitForCondition(panel, `document.querySelector('.workbench-react__agent-access')?.textContent.trim() === ${JSON.stringify("Agent access " + state)}`, `Agent access ${state}`, 20000);
}

async function setAgentAccess(panel: CdpClient, enabled: boolean) {
  const before = await evaluateByValue<string>(panel, "document.querySelector('.workbench-react__agent-access').textContent.trim()");
  await click(panel, "button", before);
  assert.equal(await evaluateByValue(panel, "document.querySelector('.workbench-react__agent-access').textContent.trim()"), before, "The header opens More without changing access.");
  await click(panel, "button", `Turn agent access ${enabled ? "on" : "off"}`);
  await click(panel, "button", "Back to prior investigation");
}

async function settle(read: () => Promise<any>, done: (value: any) => boolean) {
  for (let attempt = 0; attempt < 400; attempt++) { const result = await read(); if (done(result)) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error("Agent operation did not settle.");
}
async function click(cdp: CdpClient, selector: string, text: string) {
  const point = await evaluateByValue<{ x: number; y: number }>(cdp, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)});
    if (!element) throw new Error('Missing control: ' + ${JSON.stringify(text)});
    element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Control is hidden');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.request("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await cdp.request("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
