import { ANALYTICS_MESSAGE, isRecord } from "./events";
import { createAnalyticsService, type AnalyticsConfig } from "./service";
import { isFirefoxExtension, firefoxDataPermissions } from "../firefox-data-consent";
import { createFirefoxConsentWindow } from "../firefox-consent-window";

function configuredAnalytics(): AnalyticsConfig | null {
  const measurementId = import.meta.env.VITE_LSEW_GA_MEASUREMENT_ID?.trim();
  const apiSecret = import.meta.env.VITE_LSEW_GA_API_SECRET?.trim();
  // Local development never silently contributes to production engagement.
  if (!import.meta.env.PROD || !measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret) return null;
  return { measurementId, apiSecret, debug: import.meta.env.VITE_LSEW_GA_DEBUG === "true" };
}

export function registerAnalyticsService(): void {
  if (!chrome.storage?.local || !chrome.storage.session) return;
  const firefox = isFirefoxExtension();
  const permissions = firefoxDataPermissions();
  const requestConsent = firefox ? createFirefoxConsentWindow() : null;
  const service = createAnalyticsService({
    config: configuredAnalytics(),
    local: chrome.storage.local,
    session: chrome.storage.session,
    version: chrome.runtime.getManifest().version,
    ...(firefox ? { nativeConsent: false } : {})
  });
  let revision = 0;
  let observedNativeConsent = false;
  const updateNativeConsent = async (allowed: boolean) => {
    const changed = observedNativeConsent !== allowed;
    observedNativeConsent = allowed;
    await service.setNativeConsent(allowed);
    if (changed) void chrome.runtime.sendMessage({ type: ANALYTICS_MESSAGE, action: "native-changed" }).catch(() => undefined);
  };
  const refreshNativeConsent = async () => {
    if (!firefox) return;
    const current = ++revision;
    let allowed = false;
    try { allowed = (await permissions?.getAll())?.data_collection?.includes("technicalAndInteraction") === true; } catch { /* Fail closed. */ }
    if (current === revision) await updateNativeConsent(allowed);
  };
  if (firefox) {
    permissions?.onAdded.addListener(() => { void refreshNativeConsent().catch(() => undefined); });
    permissions?.onRemoved.addListener(() => {
      // Invalidate old permission reads and active/queued sends before asynchronous work.
      revision++;
      void updateNativeConsent(false).catch(() => undefined);
      void refreshNativeConsent().catch(() => undefined);
    });
    void refreshNativeConsent().catch(() => undefined);
  }
  // The page-facing content script has no reason to read an analytics identifier.
  void chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => undefined);
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!isRecord(message) || message.type !== ANALYTICS_MESSAGE) return false;
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("extension/panel/index.html")) return false;
    const operation = message.action === "consent" && requestConsent
      ? requestConsent().then(async allowed => {
          await refreshNativeConsent();
          // A declined or closed request is a durable Workbench Off choice,
          // including when its originating panel closes before the response.
          if (!allowed) await service.setEnabled(false);
          return allowed;
        })
      : message.action === "state"
      ? refreshNativeConsent().then(() => service.getState())
      : message.action === "preference" && typeof message.enabled === "boolean"
        ? refreshNativeConsent().then(() => service.setEnabled(message.enabled as boolean))
        : message.action === "event"
          ? service.track(message.event)
          : null;
    if (!operation) return false;
    void operation.then(value => respond({ ok: true, value }), () => respond({ ok: false }));
    return true;
  });
}
