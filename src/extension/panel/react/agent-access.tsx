import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { UNAVAILABLE_AGENT_CONNECTION, type AgentConnection } from "../agent-connection";
import { DEFAULT_COMPANION_PORT } from "../../../agent/pairing";

export function AgentAccessToggle({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  return <button className="workbench-react__agent-access" type="button" aria-pressed={state.enabled}
    disabled={connection === UNAVAILABLE_AGENT_CONNECTION}
    title={state.enabled ? "Agent access is enabled for this Panel Session. Click to turn it off." : "Enable agent access for this Panel Session."}
    onClick={() => state.enabled ? connection.disconnect() : connection.connect()}>
    Agent access {state.enabled ? "On" : "Off"}
  </button>;
}

/** Setup and exceptional configuration only; the normal journey needs no controls here. */
export function AgentAccess({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const [permission, setPermission] = useState<"read" | "local">(state.requestedPermission ?? "local");
  const [transport, setTransport] = useState<"portable" | "native">(state.transport ?? "portable");
  const [port, setPort] = useState(state.port ?? DEFAULT_COMPANION_PORT);
  const [requireAuth, setRequireAuth] = useState(state.auth === "required");
  const primaryAction = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const action = primaryAction.current;
    if (action && action === document.activeElement) action.scrollIntoView({ block: "nearest" });
  }, [state.status]);
  const pairing = state.status === "pairing" || state.status === "awaiting-agent";
  return <details className="workbench-react__usage-analytics">
    <summary>Agent setup instructions</summary>
    <p>Configure the standalone Workbench companion as an MCP server once, then open this panel. Agent access is on by default for inspection and Local Injection. It connects automatically at 127.0.0.1:24817 and retries when the companion starts later.</p>
    <p>The header’s On/Off switch controls access for this Panel Session, not whether an agent is currently connected. Closing this panel ends access. A new panel uses the defaults.</p>
    <p>Authentication is off by default. Any local process can inspect or inject while connected. Requested Evidence is shared with your agent and its model provider. Local Injection invokes application listeners, which may cause other effects; it does not contact Lightstreamer Server. Keep this panel visible while running Scenarios.</p>
    <p><a href="https://github.com/imom39a/lightstreamer-workbench-extension/blob/codex/automatic-agent-access/agent/WINDOWS.md" target="_blank" rel="noopener noreferrer">Windows and standalone setup guide</a></p>
    <p role="status">{state.detail}</p>
    <details>
      <summary>Advanced connection settings</summary>
      <label>Transport <select aria-label="Agent transport" value={transport} disabled={pairing} onChange={event => setTransport(event.currentTarget.value as "portable" | "native")}>
        <option value="portable">Standalone companion (no installation)</option>
        <option value="native">Installed native host (macOS/Linux)</option>
      </select></label>
      {transport === "portable" && <>
        <label>Companion port <input aria-label="Companion port" type="number" min={1024} max={65535} value={port} disabled={pairing} onChange={event => setPort(Number(event.currentTarget.value))} /></label>
        <label><input type="checkbox" checked={requireAuth} disabled={pairing} onChange={event => setRequireAuth(event.currentTarget.checked)} /> Require authentication</label>
        <p>Optional: use companion setup with --auth required and enable this option. Both sides must use the same mode. Compare and approve each authenticated connection.</p>
      </>}
      <label>Agent permissions <select aria-label="Agent permissions" value={permission} disabled={pairing} onChange={event => setPermission(event.currentTarget.value as "read" | "local")}>
        <option value="local">Inspect and inject locally</option>
        <option value="read">Inspect Evidence</option>
      </select></label>
      {state.pairing && <p>Comparison code: <strong aria-label="Connection comparison code">{state.pairing.code}</strong><br />Approve only if your agent shows the same code. This request expires after two minutes.</p>}
      <div className="workbench-react__context-actions">
        <button ref={primaryAction} type="button" aria-disabled={state.status === "awaiting-agent" || undefined} onClick={() => {
          if (state.status === "awaiting-agent") return;
          if (state.status === "pairing") connection.approvePairing();
          else connection.connect(permission, transport === "portable" ? { transport, port, auth: requireAuth ? "required" : "off" } : { transport });
        }}>{state.status === "pairing" ? "Approve connection" : state.status === "awaiting-agent" ? "Waiting for agent" : "Apply connection settings"}</button>
        {pairing && <button type="button" onClick={() => connection.disconnect()}>Cancel connection</button>}
      </div>
    </details>
  </details>;
}
