import { ANALYTICS_MESSAGE, isRecord } from "./events";
import { createAnalyticsService, type AnalyticsConfig } from "./service";

function configuredAnalytics(): AnalyticsConfig | null {
  const measurementId = import.meta.env.VITE_LSEW_GA_MEASUREMENT_ID?.trim();
  const apiSecret = import.meta.env.VITE_LSEW_GA_API_SECRET?.trim();
  // Local development never silently contributes to production engagement.
  if (!import.meta.env.PROD || !measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret) return null;
  return { measurementId, apiSecret, debug: import.meta.env.VITE_LSEW_GA_DEBUG === "true" };
}

export function registerAnalyticsService(): void {
  if (!chrome.storage?.local || !chrome.storage.session) return;
  const service = createAnalyticsService({
    config: configuredAnalytics(),
    local: chrome.storage.local,
    session: chrome.storage.session,
    version: chrome.runtime.getManifest().version
  });
  // The page-facing content script has no reason to read an analytics identifier.
  void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== ANALYTICS_MESSAGE) return false;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("extension/panel/index.html")) return false;
    const operation = message.action === "state"
      ? service.getState()
      : message.action === "preference" && typeof message.enabled === "boolean"
        ? service.setEnabled(message.enabled)
        : message.action === "event"
          ? service.track(message.event)
          : null;
    if (!operation) return false;
    void operation.then(value => respond({ ok: true, value }), () => respond({ ok: false }));
    return true;
  });
}
