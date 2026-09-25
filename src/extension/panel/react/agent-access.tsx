import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { UNAVAILABLE_AGENT_CONNECTION, type AgentConnection } from "../agent-connection";
import { DEFAULT_COMPANION_PORT } from "../../../agent/pairing";

export function AgentAccess({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const [permission, setPermission] = useState<"read" | "local">("read");
  const [transport, setTransport] = useState<"portable" | "native">("portable");
  const [port, setPort] = useState(DEFAULT_COMPANION_PORT);
  const primaryAction = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // Revealing the comparison code changes height without moving keyboard focus.
    const action = primaryAction.current;
    if (action && action === document.activeElement) action.scrollIntoView({ block: "nearest" });
  }, [state.status]);
  const busy = state.status !== "off" && state.status !== "error";
  const selectedTransport = busy ? state.transport ?? transport : transport;
  const selectedPermission = busy ? state.requestedPermission ?? (state.permission === "off" ? permission : state.permission) : permission;
  return <details className="workbench-react__usage-analytics">
    <summary>Agent access · {state.status === "connected" ? "Connected" : busy ? "Connecting" : "Off"}</summary>
    <p>Connect local agents to this Panel Session with the Workbench companion. Requested Evidence is shared with your agent and its model provider.</p>
    <label>Agent connection <select aria-label="Agent connection" value={selectedTransport} disabled={busy} onChange={event => setTransport(event.currentTarget.value as "portable" | "native")}>
      <option value="portable">Standalone companion (no installation)</option>
      <option value="native">Installed native host (macOS/Linux)</option>
    </select></label>
    {selectedTransport === "portable" && <>
      <p>Start the companion in your agent, then connect. Compare the code shown here with your agent and approve—nothing to type or paste.</p>
      <details><summary>Connection options</summary><label>Companion port <input aria-label="Companion port" type="number" min={1024} max={65535} value={port} disabled={busy} onChange={event => setPort(Number(event.currentTarget.value))} /></label></details>
    </>}
    <label>Agent permissions <select aria-label="Agent permissions" value={selectedPermission} disabled={busy} onChange={event => setPermission(event.currentTarget.value as "read" | "local")}>
      <option value="read">Inspect Evidence</option>
      <option value="local">Inspect and inject locally</option>
    </select></label>
    <p>Local Injection delivers Item Updates to this page’s Subscription listeners; Workbench does not contact Lightstreamer Server. Application listeners may cause other effects. Keep this panel visible while running Scenarios.</p>
    <p role="status">{state.detail}</p>
    {state.pairing && <p>Comparison code: <strong aria-label="Connection comparison code">{state.pairing.code}</strong><br />Approve only if your agent shows the same code. This request expires after two minutes.</p>}
    <div className="workbench-react__context-actions">
      <button ref={primaryAction} type="button" aria-disabled={state.status === "connecting" || state.status === "awaiting-agent" || undefined} onClick={() => {
        if (state.status === "connecting" || state.status === "awaiting-agent") return;
        if (state.status === "pairing") connection.approvePairing();
        else if (state.status === "connected") connection.disconnect();
        else connection.connect(permission, transport === "portable" ? { transport, port } : { transport });
      }}>{state.status === "pairing" ? "Approve connection" : state.status === "awaiting-agent" ? "Waiting for agent" : state.status === "connecting" ? "Connecting…" : state.status === "connected" ? "Disconnect agent" : "Connect agent"}</button>
      {busy && state.status !== "connected" && <button type="button" onClick={() => connection.disconnect()}>Cancel connection</button>}
    </div>
  </details>;
}
