import { useSyncExternalStore, type Ref } from "react";
import { UNAVAILABLE_AGENT_CONNECTION, type AgentConnection } from "../agent-connection";

export function AgentAccessStatus({ connection = UNAVAILABLE_AGENT_CONNECTION, disabled, expanded, onOpen }: {
  connection?: AgentConnection;
  disabled?: boolean;
  expanded?: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const ready = state.enabled && state.status === "connected" && state.permission !== "off";
  const label = !state.enabled ? "Off" : ready ? "On" : "Waiting";
  const unavailable = connection === UNAVAILABLE_AGENT_CONNECTION;
  return <button className="workbench-react__agent-access" type="button" aria-expanded={expanded}
    aria-controls={!disabled && !unavailable ? "workbench-context" : undefined} disabled={disabled || unavailable}
    title={`${!state.enabled ? "Agent access is disabled." : ready ? "Companion connected. Agent access is ready." : "Agent access is enabled but the companion connection is not ready."} ${unavailable ? "Agent connection is unavailable in this view." : disabled ? "Close the current document to open Agent access controls under More actions." : "Open Agent access controls and setup instructions under More actions."}`}
    onClick={event => onOpen(event.currentTarget)}>
    Agent access {label}
  </button>;
}

/** More owns access changes; the operating header only reports readiness and navigates here. */
export function AgentAccess({ connection = UNAVAILABLE_AGENT_CONNECTION, detailsRef, controlRef }: {
  connection?: AgentConnection;
  detailsRef?: Ref<HTMLDetailsElement>;
  controlRef?: Ref<HTMLButtonElement>;
}) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  return <details id="workbench-agent-access" ref={detailsRef} className="workbench-react__usage-analytics">
    <summary>Agent access and setup</summary>
    <p><button ref={controlRef} type="button" disabled={connection === UNAVAILABLE_AGENT_CONNECTION}
      onClick={() => state.enabled ? connection.disconnect() : connection.connect()}>
      {state.enabled ? "Turn agent access off" : "Turn agent access on"}
    </button></p>
    <p>Use MCP to inspect captured Evidence, find event examples and build Local Injection Scenarios. Configure Workbench in your agent app once; it launches the npm companion automatically. No separate terminal, background service or native installer is needed after setup.</p>
    <ol className="workbench-react__agent-setup">
      <li>Install Node.js 22.12 or later and npm on the same computer as Chrome. On Windows, use Windows Node, not WSL.</li>
      <li>Use the matching extension and companion release bundle from the <a href="https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/" target="_blank" rel="noopener noreferrer">MCP setup guide (including Windows)</a>. Follow its local tarball instructions for unpublished builds. For a published npm release, run <code>npx --yes lightstreamer-workbench-agent@0.1.0 setup</code>. For an unpacked extension, append <code>--extension-id YOUR_EXTENSION_ID</code> using its ID from <code>chrome://extensions</code>.</li>
      <li>Copy the printed <code>mcpServers</code> entry into your agent app's MCP settings. Start or reconnect that MCP server. If Windows cannot find <code>npx</code>, use the guide's <code>npx.cmd</code> or local Node instructions.</li>
      <li>Open Workbench on the intended tab. Ask the agent to call <code>list_panel_sessions</code>, then <code>get_status</code> to confirm the page and available tools. This panel connects automatically at <code>127.0.0.1:24817</code>.</li>
    </ol>
    <p>Agent access Waiting means access is enabled but the companion connection is not ready; On means connected and ready; Off means disabled. Waiting connections retry automatically. Use the control above to turn access on or off. The header status opens this section without changing access. On does not mean an agent is actively using Workbench. Closing this panel ends access; a new panel enables it again.</p>
    <p>Connected agents can inspect Evidence and use Local Injection. Authentication is off. Any local process can inspect or inject while connected. Requested Evidence is shared with your agent and its model provider. Local Injection invokes application listeners, which may cause other effects; it does not contact Lightstreamer Server. Keep this panel visible while running Scenarios.</p>
    <p role="status">{state.detail}</p>
  </details>;
}
