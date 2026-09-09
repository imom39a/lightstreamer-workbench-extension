import { useSyncExternalStore } from "react";
import { UNAVAILABLE_ANALYTICS, type AnalyticsClient } from "../../analytics/client";

export function UsageAnalytics({ client = UNAVAILABLE_ANALYTICS }: { client?: AnalyticsClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return <details className="workbench-react__usage-analytics">
    <summary>Usage analytics · {state.enabled ? "On" : "Off"}</summary>
    <p>Share feature use, engagement time, and error categories with Google Analytics. Captured data, inspected URLs, and typed text stay local.</p>
    <label><input type="checkbox" aria-label="Share usage analytics" checked={state.enabled} disabled={!state.ready || !state.configured} aria-disabled={state.saving || undefined} onChange={event => { if (!state.saving) void client.setEnabled(event.currentTarget.checked); }} /> Share usage analytics</label>
    {state.error ? <p role="status">Could not save or read your preference. Analytics is paused. Reopen Workbench to try again.</p>
      : !state.ready ? <p role="status">Reading analytics preference…</p>
        : !state.configured ? <p>Analytics is unavailable in this build.</p>
          : state.saving ? <p role="status">Saving preference…</p>
            : <p>{state.enabled ? "On by default. Turn off at any time." : "Off. The saved analytics identifier is removed."}</p>}
  </details>;
}
