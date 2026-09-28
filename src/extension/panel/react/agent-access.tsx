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
    <p>Configure Workbench as an MCP server in your agent app once. When the app starts that MCP server, it launches the npm companion automatically. No separate terminal, background service or native installer is needed. Open this panel to connect automatically at 127.0.0.1:24817 for inspection and Local Injection.</p>
    <p>Agent access Waiting means access is enabled but the companion connection is not ready; On means connected and ready; Off means disabled. Waiting connections retry automatically. Use the control above to turn access on or off. The header status opens this section without changing access. On does not mean an agent is actively using Workbench. Closing this panel ends access; a new panel enables it again.</p>
    <p>Connected agents can inspect Evidence and use Local Injection. Authentication is off. Any local process can inspect or inject while connected. Requested Evidence is shared with your agent and its model provider. Local Injection invokes application listeners, which may cause other effects; it does not contact Lightstreamer Server. Keep this panel visible while running Scenarios.</p>
    <p><a href="https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/agent/README.md" target="_blank" rel="noopener noreferrer">MCP companion setup guide</a></p>
    <p role="status">{state.detail}</p>
  </details>;
}
