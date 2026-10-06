import { useSyncExternalStore } from "react";
import { UNAVAILABLE_ANALYTICS, type AnalyticsClient } from "../../analytics/client";

export function UsageAnalytics({ client = UNAVAILABLE_ANALYTICS }: { client?: AnalyticsClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return <details className="workbench-react__usage-analytics">
    <summary>Usage analytics · {state.enabled ? "On" : "Off"}</summary>
    <p>Share feature use, engagement time, and error categories with Google Analytics. Captured data, inspected URLs, and typed text stay local.</p>
    <label><input type="checkbox" aria-label="Share usage analytics" data-firefox-consent={state.nativeConsent !== undefined || undefined} checked={state.enabled} disabled={!state.ready || !state.configured} aria-disabled={state.saving || undefined} onChange={event => {
      if (state.saving) return;
      const input = event.currentTarget;
      const restoreFocus = state.nativeConsent === false;
      void client.setEnabled(input.checked).finally(() => { if (restoreFocus && input.isConnected) input.focus(); });
    }} /> Share usage analytics</label>
    {state.error ? <p role="status">Could not save or read your preference. Analytics is paused. Reopen Workbench to try again.</p>
      : !state.ready ? <p role="status">Reading analytics preference…</p>
        : !state.configured ? <p>Analytics is unavailable in this build.</p>
          : state.saving ? <p role="status">{state.nativeConsent === false ? "Waiting for Firefox permission…" : "Saving preference…"}</p>
            : <p>{state.nativeConsent === false ? "Off. Turn on to open the Firefox permission window for usage analytics." : state.enabled ? state.nativeConsent === true ? "On with Firefox permission. Turn off at any time." : "On by default. Turn off at any time." : "Off. The saved analytics identifier is removed."}</p>}
  </details>;
}
