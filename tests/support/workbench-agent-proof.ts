import assert from "node:assert/strict";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startPortableBroker } from "../../src/agent/companion/portable-broker";
import { DEFAULT_COMPANION_PORT, PAIRING_ENV } from "../../src/agent/pairing";
import { type CdpRequestClient, evaluateRequestByValue as evaluateByValue, waitForCondition } from "./chrome-extension-cdp";
import { FIREFOX_EXTENSION_ID } from "../../src/agent/browser-identity";

function assertMcpReplyBudget(name: string, args: Record<string, unknown>, reply: unknown) {
  // A continuation's chosen budget belongs to its panel-owned cursor. Every
  // other reply, including discovery, status, mutations and failures, is small
  // by default after text/structured serialization.
  const budget = args.cursor ? 65536 : Number(args.maxBytes ?? 8192);
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= budget, `${name} respects its serialized MCP budget`);
}

/** Opt-in real Chrome proof. The same loopback runtime runs on every platform. */
export async function proveAgentFixture(root: string, panel: CdpRequestClient, page: CdpRequestClient, options: { browser?: "chrome" | "firefox"; env?: Record<string, string>; fixtureItem?: string; serverInjection?: boolean } = {}) {
  const cli = (process.env.LSEW_AGENT_TEST_CLI ?? join(root, "agent/dist/cli.mjs"));
  const client = new Client({ name: "workbench-browser-proof", version: "1" });
  try {
    const origin = await evaluateByValue<string>(panel, "location.origin");
    const firefox = options.browser === "firefox";
    const extensionId = firefox ? "kfpgbhfphbhkebglopimjhfnnmbifocf" : origin.slice("chrome-extension://".length);
    await headerState(panel, "Waiting");
    // The MCP client, not a manually started broker, owns normal startup.
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--extension-id", extensionId], env: { [PAIRING_ENV]: "", ...options.env }, stderr: "inherit" }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({ name, arguments: args });
      assertMcpReplyBudget(name, args, reply);
      const text = (reply.content as Array<{ type: string; text: string }>).filter(part => part.type === "text").map(part => part.text).join("\n");
      assert.ok(!reply.isError, `${name}: ${text}`);
      assert.ok(reply.structuredContent, `${name} provides structured MCP output`);
      return JSON.parse(text);
    };
    const sessions = await settle(() => call("list_panel_sessions"), sessions => sessions.length === 1);
    await headerState(panel, "On");
    assert.equal(sessions.length, 1);
    const panelSessionId = sessions[0].panelSessionId;
    const status = await call("get_status", { panelSessionId });
    assert.equal(status.history.lastCoherentQuery, undefined, "Status never exposes the panel's cached Evidence query.");
    const pageUrl = await evaluateByValue<string>(page, "location.origin + location.pathname");
    assert.equal(status.inspectedPage.urlWithoutQuery, pageUrl);
    assert.equal(status.permission, "local", "A normal connection grants inspection and Local Injection without settings.");
    assert.ok(status.capabilities.includes("search_evidence") && status.capabilities.includes("search_scope"));
    assert.ok(status.capabilities.includes("query_command_state") && status.capabilities.includes("wait_for_operation"));
    assert.equal(status.companion.extensionId, extensionId);
    if (firefox) {
      assert.equal(status.companion.firefoxExtensionId, FIREFOX_EXTENSION_ID);
      assert.equal(status.inspectedPage.browser, "firefox");
      assert.equal(typeof status.inspectedPage.browserTabId, "number");
      assert.equal(status.inspectedPage.chromeTabId, undefined);
    }
    assert.equal(status.companion.readContractVersion, 2);
    const fixtureItem = options.fixtureItem ?? "scenario.mutate-reinject";
    const scopeSearch = await call("search_scope", { panelSessionId, text: fixtureItem.toUpperCase(), limit: 100 });
    assert.ok(scopeSearch.scopes.some((entry: any) => entry.kind === "item" && entry.label === `${fixtureItem} · #1`), `MCP Scope search finds the exact named, positional item regardless of tree expansion: ${JSON.stringify(scopeSearch)}`);
    const evidenceSearch = await call("search_evidence", { panelSessionId, within: "page", text: fixtureItem.toUpperCase(), limit: 1, includePayload: true, maxBytes: 65536 });
    assert.ok(evidenceSearch.total > 0 && evidenceSearch.evidence.length === 1, "MCP Evidence search uses case-insensitive canonical matching.");
    if (evidenceSearch.nextCursor) {
      const next = await call("search_evidence", { panelSessionId, cursor: evidenceSearch.nextCursor });
      assert.deepEqual(next.readPoint, evidenceSearch.readPoint);
      assert.notEqual(next.evidence[0].identity.eventId, evidenceSearch.evidence[0].identity.eventId);
    }
    const liveItem = scopeSearch.scopes.find((entry: any) => entry.kind === "item" && entry.label === `${fixtureItem} · #1` && !entry.retired && entry.lifecycle === "active");
    assert.ok(liveItem, "Scope discovery identifies the exact active, positional item.");
    const liveScope = await call("get_scope", { panelSessionId, scopeId: liveItem.scopeId });
    assert.equal(liveScope.node.retired, false);
    const anchor = liveScope.localInjection.anchor;
    assert.equal(anchor.itemName, fixtureItem);
    assert.equal(anchor.itemPosition, 1);
    assert.equal(anchor.captureSource, "listener");
    const serverListenerFilter = { criteria: [
      { facet: "kind", polarity: "include", type: "enum", value: "ITEM-UPDATE" },
      { facet: "provenance", polarity: "include", type: "enum", value: "SERVER" },
      { facet: "observationPath", polarity: "include", type: "enum", value: "LISTENER" }
    ] };
    const boundary = await call("query_evidence", { panelSessionId, scopeId: liveItem.scopeId, filter: serverListenerFilter, limit: 100, order: "NEWEST_FIRST" });
    const profileArgs = { panelSessionId, scopeId: liveItem.scopeId, filter: serverListenerFilter, at: boundary.readPoint, limit: 100, order: "NEWEST_FIRST" };
    const profileReply = await client.callTool({ name: "describe_stream", arguments: profileArgs });
    assertMcpReplyBudget("describe_stream", profileArgs, profileReply);
    let profile: any;
    if (profileReply.isError) {
      assert.equal((profileReply.structuredContent as any)?.error?.code, "RESULT_BUDGET_EXCEEDED");
      // A single wide profile can exceed the default. Deliberately request a
      // larger bounded result at the same read point; do not raise every read.
      profile = await call("describe_stream", { ...profileArgs, maxBytes: 65536 });
    } else profile = profileReply.structuredContent;
    assert.ok(profile.streams.length > 0, "Stream description profiles the exact live item at a stable read point.");
    let source: any = null;
    for (const example of profile.streams.flatMap((stream: any) => stream.examples)) {
      const hydrated = await call("get_evidence", { panelSessionId, evidence: example.identity, includePayload: true, maxBytes: 65536 });
      assert.equal(hydrated.lookup.state, "RETAINED");
      const candidate = hydrated.lookup.evidence;
      if (candidate.payload?.kind === "item-update"
        && candidate.payload?.source === "server"
        && candidate.payload?.captureSource === "listener"
        && candidate.payload?.listener?.id === anchor.listenerId
        && candidate.payload?.item?.name === anchor.itemName
        && candidate.payload?.item?.position === anchor.itemPosition) {
        source = candidate;
        break;
      }
    }
    assert.ok(source, "A profiled example hydrates to the current listener-based server update for the exact item and position.");
    const document = (command: string, messageText: string) => JSON.stringify({ command, key: "agent-browser.TICKER", isSnapshot: false, fields: { command, key: "agent-browser.TICKER", modelId: "MESSENGER", modelValues: { messageId: "agent-browser", messageText, messageType: "TICKER" } } });
    const baselineCount = await evaluateByValue<number>(page, "Number(document.querySelector('#update-count').textContent)");
    const validation = await call("validate_agent_candidate", { panelSessionId, pageEpoch: status.pageEpoch, draft: { evidence: source.identity, document: document("ADD", "Agent MCP Local Injection") } });
    assert.equal(validation.valid, true, JSON.stringify(validation));
    const draft = await call("prepare_local_injection", { panelSessionId, evidence: source.identity, pageEpoch: status.pageEpoch, document: document("ADD", "Agent MCP Local Injection") });
    assert.ok(draft.local.draft.ready, JSON.stringify(draft));
    const request = { panelSessionId, token: draft.token, requestId: "browser-local-1" };
    const before = await call("query_evidence", { panelSessionId, scopeId: liveItem.scopeId, limit: 1 });
    const observation = call("wait_for_evidence", { panelSessionId, pageEpoch: status.pageEpoch, after: before.readPoint, timeoutMs: 10000, filter: { criteria: [
      { facet: "provenance", polarity: "include", type: "enum", value: "LOCAL" },
      { facet: "key", polarity: "include", type: "string", value: "agent-browser.TICKER" }
    ] } });
    await call("execute_local_injection", request); await call("execute_local_injection", request);
    const receipt = call("wait_for_operation", { panelSessionId, requestId: request.requestId, timeoutMs: 10000 });
    assert.equal((await observation).status, "MATCHED", "Observation sees the correlated Local Evidence without blocking execution.");
    await waitForCondition(page, `document.querySelector('#message-text').textContent === 'Agent MCP Local Injection' && Number(document.querySelector('#update-count').textContent) === ${baselineCount + 1}`, "one MCP injection reaches the official-client app exactly once");
    assert.deepEqual(await receipt, {
      status: "COMPLETE", requestId: request.requestId, completionBoundary: "LOCAL_INJECTION_RECEIPT",
      operation: await call("get_operation", { panelSessionId, requestId: request.requestId })
    });
    const localState = await call("query_command_state", {
      panelSessionId, scopeId: liveItem.scopeId, pageEpoch: status.pageEpoch,
      projection: "local-effective", item: { name: anchor.itemName, position: anchor.itemPosition },
      key: "agent-browser.TICKER", fields: ["modelValues"]
    });
    assert.equal(localState.status, "ok", JSON.stringify(localState));
    assert.equal(localState.presence.state, "present");
    assert.equal(localState.fields[0].state, "concrete");
    assert.equal(localState.fields[0].certainty, "projected");
    assert.ok(JSON.stringify(localState.fields[0].value).includes("Agent MCP Local Injection"));
    assert.equal(localState.fields[0].provenance.evidenceRetained, true);
    const stateBasis = await call("get_evidence", { panelSessionId, evidence: localState.fields[0].provenance.evidence, fields: ["modelValues"] });
    assert.deepEqual(stateBasis.lookup.evidence.fields.modelValues.value, localState.fields[0].value);
    const stateEvidence = await call("query_evidence", { panelSessionId, scopeId: liveItem.scopeId, at: localState.readPoint, where: { key: ["agent-browser.TICKER"], provenance: ["LOCAL"] }, limit: 1 });
    assert.equal(stateEvidence.totals.matching, 1, "The COMMAND read point is reusable through installed stdio MCP.");
    await call("finish_agent_document", { panelSessionId, token: draft.token });
    const members = [
      { kind: "step", id: "first-update", evidence: source.identity, document: document("UPDATE", "Agent Scenario first") },
      { kind: "step", id: "second-update", evidence: source.identity, document: document("UPDATE", "Agent Scenario second") },
      { kind: "checkpoint", id: "evidence-check", name: "Both updates committed", assertions: [
        { id: "first-committed", kind: "correlated-local-evidence-exists", stepId: "first-update" },
        { id: "second-committed", kind: "correlated-local-evidence-exists", stepId: "second-update" }
      ] }
    ];
    assert.equal((await call("validate_agent_candidate", { panelSessionId, pageEpoch: status.pageEpoch, members })).valid, true);
    const scenario = await call("prepare_scenario", { panelSessionId, pageEpoch: status.pageEpoch, members });
    assert.equal(scenario.scenario.phase, "review", JSON.stringify(scenario));
    await waitForCondition(panel, `document.querySelectorAll('[aria-label="Ordered Scenario Steps"] ol li').length === 3 && document.querySelector('[aria-label="Step 1 reviewed JSON"]')?.textContent.includes('Agent Scenario first')`, "agent-prepared Scenario projects the explicit queue and one focused reviewed document");
    assert.equal(await evaluateByValue(panel, `document.querySelectorAll('[aria-label="Focused Scenario member"] article').length`), 1, "Only one focused Step document is mounted for a multi-member MCP Scenario.");
    assert.ok(await evaluateByValue(panel, `document.querySelector('[aria-label="Focused Scenario member"]').textContent.includes(${JSON.stringify(source.identity.eventId)})`), "Focused Step retains the captured Source identity separately from its amended Draft.");
    // Human focus is presentation state, so opening the second Step must retain
    // the reviewed execution plan/token and must not alter the next Run ordinal.
    const queueToggleVisible = await evaluateByValue<boolean>(panel, `[...document.querySelectorAll("button")].some(button => button.textContent.trim() === "Scenario queue" && button.getBoundingClientRect().width > 0)`);
    if (queueToggleVisible) await click(panel, "button", "Scenario queue");
    const secondStepLabel = await evaluateByValue<string>(panel, `document.querySelector('[aria-label="Ordered Scenario Steps"] ol li:nth-child(2) button').textContent.trim()`);
    await click(panel, '[aria-label="Ordered Scenario Steps"] ol li:nth-child(2) button', secondStepLabel);
    await waitForCondition(panel, `document.querySelector('[aria-label="Step 2 reviewed JSON"]')?.textContent.includes('Agent Scenario second')`, "human opens the second agent-prepared reviewed Step");
    const projection = () => evaluateByValue<string>(panel, `JSON.stringify({
      focused: document.querySelector('[aria-label="Ordered Scenario Steps"] button[aria-pressed="true"]')?.textContent,
      document: document.querySelector('[aria-label="Step 2 reviewed JSON"]')?.textContent,
      captureSearch: document.querySelector('[aria-label="Search captured updates"]')?.value,
      captureOperation: document.querySelector('[aria-label="Captured operation"]')?.value,
      captureSelection: [...document.querySelectorAll('[aria-label="Scenario captured updates"] input[type="checkbox"]')].map(input => [input.getAttribute('aria-label'), input.checked]),
      queueScroll: document.querySelector('[aria-label="Ordered Scenario Steps"] ol')?.scrollTop
    })`);
    const projectionBefore = await projection();
    await call("get_scenario_trace", { panelSessionId, limit: 1 });
    const independentRead = await call("query_evidence", { panelSessionId, scopeId: liveItem.scopeId, limit: 1 });
    if (independentRead.nextCursor) await call("query_evidence", { panelSessionId, cursor: independentRead.nextCursor });
    await call("search_evidence", { panelSessionId, scopeId: liveItem.scopeId, text: "scenario", limit: 1 });
    assert.equal(await projection(), projectionBefore, "Real stdio MCP reads preserve human capture controls, focused queue member and reviewed Draft.");
    for (const [ordinal, message] of [[1, "Agent Scenario first"], [2, "Agent Scenario second"]] as const) {
      const command = { panelSessionId, runId: scenario.scenario.run.id, requestId: `browser-step-${ordinal}`, action: "step" };
      await call("control_scenario", command); await call("control_scenario", command);
      await settle(() => call("get_scenario_trace", { panelSessionId }), result => result.phase === "paused");
      await waitForCondition(page, `document.querySelector('#message-text').textContent === ${JSON.stringify(message)} && Number(document.querySelector('#update-count').textContent) === ${baselineCount + 1 + ordinal}`, "Scenario Step changes the inspected app exactly once");
    }
    await call("control_scenario", { panelSessionId, runId: scenario.scenario.run.id, requestId: "browser-checkpoint", action: "step" });
    let trace = await settle(() => call("get_scenario_trace", { panelSessionId }), result => result.phase === "complete");
    let checkpointFound = trace.run.trace.some((entry: any) => entry.kind === "checkpoint" && entry.checkpointId === "evidence-check");
    while (!checkpointFound && trace.nextOffset !== null) {
      trace = await call("get_scenario_trace", { panelSessionId, offset: trace.nextOffset });
      checkpointFound = trace.run.trace.some((entry: any) => entry.kind === "checkpoint" && entry.checkpointId === "evidence-check");
    }
    assert.ok(checkpointFound, "The paged trace retains the final Checkpoint.");
    await call("finish_agent_document", { panelSessionId, token: scenario.token });
    const after = await call("query_evidence", { panelSessionId, scopeId: liveItem.scopeId, where: { provenance: ["LOCAL"] }, limit: 10, includePayload: true, maxBytes: 65536 });
    assert.ok(after.evidence.some((row: any) => row.payload?.synthetic), "Agent can read marked Local Evidence after commit.");
    if (options.serverInjection) {
      // This is a disposable fixture's approval UI, never a production panel.
      const message = "Firefox reviewed MCP Client Message";
      const requestId = "firefox-server-proof";
      const beforeSend = await evaluateByValue<number>(page,"Number(document.querySelector('#update-count').textContent)");
      const prepared = await call("prepare_server_injection",{panelSessionId,pageEpoch:status.pageEpoch,clientId:anchor.clientId,sessionId:anchor.sessionId,message,sequence:"firefox_release_proof",delayTimeout:null,enqueueWhileDisconnected:false,requestId});
      assert.equal(prepared.approvalRequired,true);
      const args = {panelSessionId,token:prepared.token,requestId};
      const denied = await client.callTool({name:"execute_server_injection",arguments:args});
      assert.equal((denied.structuredContent as any)?.error?.code,"HUMAN_APPROVAL_REQUIRED");
      assert.equal(await evaluateByValue(page,"Number(document.querySelector('#update-count').textContent)"),beforeSend);
      await click(panel,"button","Review Client Message");
      await waitForCondition(panel,`document.querySelector('[aria-label="Reviewed Server Injection"] pre')?.textContent === ${JSON.stringify(message)}`,"exact reviewed Server message");
      await click(panel,"button","Approve exact Client Message for agent send");
      assert.equal(await evaluateByValue(page,"Number(document.querySelector('#update-count').textContent)"),beforeSend,"Approval itself does not send.");
      const sent = await call("execute_server_injection",args);
      assert.equal(sent.state,"complete"); assert.equal(sent.outcome.status,"processed");
      assert.deepEqual(await call("execute_server_injection",args),sent);
      await waitForCondition(page,`document.querySelector('#message-text').textContent === ${JSON.stringify(message)} && Number(document.querySelector('#update-count').textContent) === ${beforeSend+1}`,"one reviewed Client Message reaches the fixture through Lightstreamer Server");
      const recovered = await call("recover_server_injection",{panelSessionId,requestId});
      assert.deepEqual(recovered.outcome,sent.outcome);
      await click(panel,"button","Finish");
      console.log("Reviewed Firefox Server Injection passed: blocked before approval, one send, retained receipt and independently observed fixture update.");
    }
    await setAgentAccess(panel, false);
    await settle(() => call("list_panel_sessions"), result => result.length === 0);
    console.log(`Agent browser proof passed (npm companion, no installation): real MCP stdio → ${firefox ? "Firefox" : "Chrome"} panel → official Lightstreamer listener → verified app DOM, duplicate suppression, ordered Scenario and revocation.`);
  } finally {
    await client.close();
  }
}

/** Real extension proof without Docker/Lightstreamer Server; runs on Windows CI too. */
export async function provePortableInspection(root: string, panel: CdpRequestClient, expectedUrl: string, options: { browser?: "chrome" | "firefox"; env?: Record<string, string>; firefoxOrigins?: () => Promise<ReadonlySet<string>> } = {}) {
  const origin = await evaluateByValue<string>(panel, "location.origin");
  const firefox = options.browser === "firefox";
  const extensionId = firefox ? "kfpgbhfphbhkebglopimjhfnnmbifocf" : origin.slice("chrome-extension://".length);
  await headerState(panel, "Waiting");
  let broker = await startPortableBroker({ auth: "off", port: DEFAULT_COMPANION_PORT }, extensionId, options.firefoxOrigins);
  let client = new Client({ name: "portable-chrome-proof", version: "1" });
  const transport = () => new StdioClientTransport({ command: process.execPath, args: [(process.env.LSEW_AGENT_TEST_CLI ?? join(root, "agent/dist/cli.mjs")), "mcp", "--extension-id", extensionId], env: { [PAIRING_ENV]: "", ...options.env }, stderr: "inherit" });
  try {
    await client.connect(transport());
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assertMcpReplyBudget(name, args, result);
      assert.ok(!result.isError); return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    };
    const sessions = await settle(() => call("list_panel_sessions"), sessions => sessions.length === 1);
    await headerState(panel, "On");
    const panelSessionId = sessions[0].panelSessionId;
    const status = await call("get_status", { panelSessionId });
    assert.equal(status.history.lastCoherentQuery, undefined, "Status never exposes the panel's cached Evidence query.");
    assert.equal(status.inspectedPage.urlWithoutQuery, expectedUrl);
    assert.equal(status.permission, "local", "Inspection plus Local Injection requires no permission selection.");
    assert.equal(status.readContract.version, 2);
    assert.equal(status.companion.extensionId, extensionId);
    assert.equal(status.companion.protocolVersion, 1);
    assert.ok(status.capabilities.includes("query_command_state") && status.capabilities.includes("wait_for_operation"));
    const query = await call("query_evidence", { panelSessionId, within: "page", text: "cdp-same-tab-four", limit: 10, includePayload: true, maxBytes: 65536 });
    assert.ok(query.evidence.some((entry: any) => entry.payload?.item?.name === "cdp-same-tab-four"));
    const statusAfterPayloadRead = await call("get_status", { panelSessionId });
    assert.equal(statusAfterPayloadRead.history.lastCoherentQuery, undefined, "Even a hydrated IndexedDB query cannot expand later status output.");
    assert.ok(!JSON.stringify(statusAfterPayloadRead).includes("cdp-live-four"), "Status omits captured field values.");
    const summary = await call("summarize_evidence", { panelSessionId, within: "page", text: "cdp-same-tab-four", where: { kind: ["ITEM-UPDATE"], mode: ["MERGE"] }, facet: "kind" });
    assert.equal(summary.totals.matching, query.totals.matching);
    assert.equal(summary.distinctTotal, 1);
    assert.equal(summary.values[0].value.value, "ITEM-UPDATE");
    assert.equal(summary.evidence, undefined, "Indexed summaries do not send source events.");
    const projected = await call("query_evidence", { panelSessionId, within: "page", text: "cdp-same-tab-four", where: { kind: ["ITEM-UPDATE"], mode: ["MERGE"] }, at: summary.readPoint, fields: ["value"], limit: 1 });
    assert.deepEqual(projected.evidence[0].fields, { value: { state: "concrete", value: "cdp-live-four" } });
    assert.equal(projected.evidence[0].payload, undefined);
    const exact = await call("get_evidence", { panelSessionId, evidence: projected.evidence[0].identity, fields: ["value"] });
    assert.deepEqual(exact.lookup.evidence.fields, projected.evidence[0].fields);
    assert.ok(status.capabilities.includes("search_evidence") && status.capabilities.includes("search_scope"));
    const scopes = await call("search_scope", { panelSessionId, text: "CDP-SAME-TAB-CLIENT", limit: 100 });
    assert.ok(scopes.scopes.some((entry: any) => entry.kind === "client" && entry.label === "cdp-same-tab-client"), JSON.stringify(scopes));
    const found = await call("search_evidence", { panelSessionId, within: "page", text: "CDP-SAME-TAB", limit: 1, includePayload: true, maxBytes: 65536 });
    assert.ok(found.total > 1 && found.nextCursor, "The installed companion can paginate retained Evidence search.");
    const continued = await call("search_evidence", { panelSessionId, cursor: found.nextCursor });
    assert.deepEqual(continued.readPoint, found.readPoint);
    assert.ok(continued.evidence[0].identity.sequence > found.evidence[0].identity.sequence);
    assert.equal(continued.search.within, "page");
    const current = await call("search_evidence", { panelSessionId, text: "CDP-SAME-TAB", within: "current-investigation", limit: 1 });
    assert.equal(current.search.within, "current-investigation");
    const profile = await call("describe_stream", { panelSessionId, limit: 100 });
    assert.ok(profile.sampled > 0 && profile.streams.length > 0, "Packaged MCP exposes bounded stream discovery.");
    const kinds = await call("query_evidence", { panelSessionId, within: "page", limit: 1, discover: [{ facet: "kind", limit: 10 }] });
    assert.equal(kinds.discoveries.kind.state, "AVAILABLE");
    const observation = await call("wait_for_evidence", { panelSessionId, pageEpoch: status.pageEpoch, after: kinds.readPoint, timeoutMs: 0, filter: { criteria: [{ facet: "key", polarity: "include", type: "string", value: "unobserved-agent-proof-key" }] } });
    assert.equal(observation.status, "TIMED_OUT", JSON.stringify(observation));
    await client.close(); broker.close();
    await headerState(panel, "Waiting");
    broker = await startPortableBroker({ auth: "off", port: DEFAULT_COMPANION_PORT }, extensionId, options.firefoxOrigins);
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
    console.log(`Portable ${firefox ? "Firefox" : "Chrome"} proof passed: Waiting → On → Waiting → On → Off; exact page, retained Evidence, full local grant, no settings, restart and revocation.`);
  } finally { await client.close(); broker.close(); }
}

async function headerState(panel: CdpRequestClient, state: "Waiting" | "On" | "Off") {
  await waitForCondition(panel, `document.querySelector('.workbench-react__agent-access')?.textContent.trim() === ${JSON.stringify("Agent access " + state)}`, `Agent access ${state}`, 20000);
}

async function setAgentAccess(panel: CdpRequestClient, enabled: boolean) {
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
export async function click(cdp: CdpRequestClient, selector: string, text: string) {
  await waitForCondition(cdp, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)} && !element.disabled && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
    return Boolean(element && !element.disabled && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
  })()`, `available control: ${text}`);
  const point = await evaluateByValue<{ x: number; y: number }>(cdp, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)} && !element.disabled && element.getBoundingClientRect().width && element.getBoundingClientRect().height);
    if (!element) throw new Error('Missing control: ' + ${JSON.stringify(text)});
    element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Control is hidden');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.request("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await cdp.request("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
