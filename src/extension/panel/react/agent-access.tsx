import { useSyncExternalStore } from "react";
import { UNAVAILABLE_AGENT_CONNECTION, type AgentConnection } from "../agent-connection";

export function AgentAccessToggle({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const ready = state.enabled && state.status === "connected" && state.permission !== "off";
  const label = !state.enabled ? "Off" : ready ? "On" : "Waiting";
  return <button className="workbench-react__agent-access" type="button" aria-pressed={state.enabled}
    disabled={connection === UNAVAILABLE_AGENT_CONNECTION}
    title={!state.enabled ? "Enable agent access for this Panel Session." : ready
      ? "Companion connected. Agent access is ready for this Panel Session. Click to turn it off."
      : "Agent access is enabled but not ready. See Agent setup instructions under More actions. Click to turn it off."}
    onClick={() => state.enabled ? connection.disconnect() : connection.connect()}>
    Agent access {label}
  </button>;
}

/** Instructions only. The header owns access; connections allow inspection and Local Injection. */
export function AgentAccess({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  return <details className="workbench-react__usage-analytics">
    <summary>Agent setup instructions</summary>
    <p>Configure Workbench as an MCP server in your agent app once. When the app starts that MCP server, it launches the npm companion automatically. No separate terminal, background service or native installer is needed. Open this panel to connect automatically at 127.0.0.1:24817 for inspection and Local Injection.</p>
    <p>Agent access Waiting means access is enabled but the companion connection is not ready; On means connected and ready; Off means disabled. Waiting connections retry automatically. Click Waiting or On to turn access off. On does not mean an agent is actively using Workbench. Closing this panel ends access; a new panel enables it again.</p>
    <p>Connected agents can inspect Evidence and use Local Injection. Authentication is off. Any local process can inspect or inject while connected. Requested Evidence is shared with your agent and its model provider. Local Injection invokes application listeners, which may cause other effects; it does not contact Lightstreamer Server. Keep this panel visible while running Scenarios.</p>
    <p><a href="https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/README.md" target="_blank" rel="noopener noreferrer">MCP companion setup guide</a></p>
    <p role="status">{state.detail}</p>
  </details>;
}
