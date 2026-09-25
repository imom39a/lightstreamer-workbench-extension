import { useState, useSyncExternalStore } from "react";
import { UNAVAILABLE_AGENT_CONNECTION, type AgentConnection } from "../agent-connection";

export function AgentAccess({ connection = UNAVAILABLE_AGENT_CONNECTION }: { connection?: AgentConnection }) {
  const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
  const [permission, setPermission] = useState<"read" | "local">("read");
  return <details className="workbench-react__usage-analytics">
    <summary>Agent access · {state.status === "connected" ? "Connected" : state.status === "connecting" ? "Connecting" : "Off"}</summary>
    <p>Connect local agents running as your OS user to this Panel Session after installing the Workbench companion. Requested Evidence is shared with your agent and its model provider.</p>
    <label>Agent permissions <select aria-label="Agent permissions" value={permission} disabled={state.permission !== "off"} onChange={event => setPermission(event.currentTarget.value as "read" | "local")}>
      <option value="read">Inspect Evidence</option>
      <option value="local">Inspect and inject locally</option>
    </select></label>
    <p>Local Injection delivers Item Updates to this page’s Subscription listeners; Workbench does not contact Lightstreamer Server. Application listeners may cause other effects. Keep this panel visible while running Scenarios.</p>
    <p role="status">{state.detail}</p>
    {state.permission === "off" ? <button type="button" onClick={() => connection.connect(permission)}>Connect agent</button> : <button type="button" onClick={() => connection.disconnect()}>Disconnect agent</button>}
  </details>;
}
