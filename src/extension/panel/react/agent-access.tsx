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
    <p role="status">{state.detail}</p>
    <p>When connected, local processes can read Evidence and inject locally without authentication. Requested data may reach your model provider. Local Injection can trigger app actions.</p>
    <p><a href="https://imom39a.github.io/lightstreamer-workbench-extension/docs/agent-access/" target="_blank" rel="noopener noreferrer">MCP setup guide</a></p>
  </details>;
}
