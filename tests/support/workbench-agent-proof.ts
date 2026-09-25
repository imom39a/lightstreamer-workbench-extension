import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, unlink, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startBroker } from "../../src/agent/companion/broker";
import { NATIVE_HOST_NAME } from "../../src/agent/protocol";
import { CdpClient, evaluateByValue, waitForCondition } from "./chrome-extension-cdp";

/** Opt-in real Chrome proof. Registration lives only in the isolated test profile. */
export async function proveAgentFixture(root: string, profileDir: string, panel: CdpClient, page: CdpClient) {
  const directory = await mkdtemp(join(tmpdir(), "lsew-agent-browser-"));
  const manifest = join(profileDir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
  const launcher = join(directory, "native-host");
  const cli = join(root, "agent/dist/cli.mjs");
  const broker = await startBroker(directory);
  const client = new Client({ name: "workbench-browser-proof", version: "1" });
  let registered = false;
  try {
    const origin = await evaluateByValue<string>(panel, "location.origin");
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} host "$@" --directory ${quote(directory)}\n`, { mode: 0o700 });
    await mkdir(dirname(manifest), { recursive: true });
    // Exclusive write deliberately refuses to replace a configured companion.
    await writeFile(manifest, JSON.stringify({ name: NATIVE_HOST_NAME, description: "Temporary Workbench agent browser proof", path: launcher, type: "stdio", allowed_origins: [origin + "/"] }), { flag: "wx", mode: 0o600 });
    registered = true;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--directory", directory], stderr: "inherit" }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({ name, arguments: args });
      const text = (reply.content as Array<{ type: string; text: string }>).filter(part => part.type === "text").map(part => part.text).join("\n");
      assert.ok(!reply.isError, `${name}: ${text}`); return JSON.parse(text);
    };
    assert.deepEqual(await call("list_panel_sessions"), []);
    await click(panel, "button", "More actions");
    await click(panel, "summary", "Agent access · Off");
    await click(panel, "button", "Connect agent");
    await waitForCondition(panel, "document.body.innerText.includes('Connected · inspection only.')", "real native host connection");
    const sessions = await call("list_panel_sessions");
    assert.equal(sessions.length, 1);
    const panelSessionId = sessions[0].panelSessionId;
    const status = await call("get_status", { panelSessionId });
    const pageUrl = await evaluateByValue<string>(page, "location.origin + location.pathname");
    assert.equal(status.inspectedPage.urlWithoutQuery, pageUrl);
    assert.equal(status.permission, "read");
    const query = await call("query_evidence", { panelSessionId, limit: 100, includePayload: true });
    const source = query.evidence.findLast((row: any) => row.payload?.kind === "item-update" && row.payload?.source === "server" && row.payload?.listener?.id && row.payload?.item?.name === "scenario.mutate-reinject");
    assert.ok(source, "Agent can query current listener-based official-client Evidence.");
    const rejected = await client.callTool({ name: "prepare_local_injection", arguments: { panelSessionId, evidence: source.identity, pageEpoch: status.pageEpoch } });
    assert.equal(rejected.isError, true, "Read-only grant refuses mutation.");
    await click(panel, "button", "Disconnect agent");
    await evaluateByValue(panel, `(() => { const select = document.querySelector('[aria-label="Agent permissions"]'); select.value = 'local'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click(panel, "button", "Connect agent");
    await waitForCondition(panel, "document.body.innerText.includes('Connected · inspection and Local Injection allowed.')", "local grant reconnect");
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
    await click(panel, "button", "More actions");
    await click(panel, "summary", "Agent access · Connected");
    await click(panel, "button", "Disconnect agent");
    await settle(() => call("list_panel_sessions"), result => result.length === 0);
    console.log("Agent browser proof passed: real MCP stdio → native Chrome panel → official Lightstreamer listener → verified app DOM, duplicate suppression, ordered Scenario and revocation.");
  } finally {
    await client.close(); broker.close();
    if (registered) await unlink(manifest);
    await rm(directory, { recursive: true, force: true });
  }
}

async function settle(read: () => Promise<any>, done: (value: any) => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) { const result = await read(); if (done(result)) return result; await new Promise(resolve => setTimeout(resolve, 50)); }
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
