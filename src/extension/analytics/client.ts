import { ANALYTICS_MESSAGE, ANALYTICS_PREFERENCE_KEY, isRecord, sanitizeAnalyticsEvent, type AnalyticsEvent } from "./events";
import { firefoxDataPermissions, isFirefoxExtension, requestFirefoxAnalyticsConsent } from "../firefox-data-consent";

export type AnalyticsPreference = Readonly<{ enabled: boolean; configured: boolean; ready: boolean; saving: boolean; error: boolean; nativeConsent?: boolean }>;
export type AnalyticsClient = Readonly<{
  getSnapshot(): AnalyticsPreference;
  subscribe(listener: () => void): () => void;
  setEnabled(enabled: boolean): Promise<void>;
  track(event: AnalyticsEvent): void;
  dispose(): void;
}>;
export type AnalyticsClientOptions = Readonly<{
  send?: (message: unknown) => Promise<unknown>;
  onPreferenceChange?: (listener: (reason?: "native") => void) => () => void;
  requestNativeConsent?: () => Promise<boolean>;
}>;

export const UNAVAILABLE_ANALYTICS: AnalyticsClient = {
  getSnapshot: () => unavailable,
  subscribe: () => () => undefined,
  setEnabled: async () => undefined,
  track: () => undefined,
  dispose: () => undefined
};
const unavailable: AnalyticsPreference = Object.freeze({ enabled: true, configured: false, ready: true, saving: false, error: false });

/** Panel sees preferences and a typed event sink, never the installation ID or GA key. */
export function createAnalyticsClient(options: AnalyticsClientOptions = {}): AnalyticsClient {
  const send = options.send ?? sendToWorker;
  const listeners = new Set<() => void>();
  let state: AnalyticsPreference = { ...unavailable, ready: false };
  let disposed = false;
  let revision = 0;
  let requestingNativeConsent = false;
  const publish = (next: AnalyticsPreference) => {
    if (disposed) return;
    state = Object.freeze(next);
    listeners.forEach(listener => listener());
  };
  const refresh = async () => {
    const current = ++revision;
    try {
      const result = await send({ type: ANALYTICS_MESSAGE, action: "state" });
      if (disposed || current !== revision) return;
      publish(preferenceFrom(result));
    } catch {
      if (current === revision) publish({ ...state, ready: true, configured: false, saving: false, error: true });
    }
  };
  const unsubscribe = (options.onPreferenceChange ?? onChromePreferenceChange)(reason => {
    // The response to our own consent request will refresh this state. A native
    // addition must not cancel the explicit preference write that follows it.
    if (reason === "native" && requestingNativeConsent) return;
    void refresh();
  });
  void refresh();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async setEnabled(enabled) {
      const current = ++revision;
      publish({ ...state, enabled: enabled && state.nativeConsent !== false, saving: true, error: false });
      try {
        if (enabled && state.nativeConsent === false) {
          requestingNativeConsent = true;
          let granted: boolean;
          try { granted = await (options.requestNativeConsent ?? requestFirefoxAnalyticsConsent)(); }
          finally { requestingNativeConsent = false; }
          if (current !== revision || disposed) return;
          if (!granted) { await refresh(); return; }
        }
        const result = await send({ type: ANALYTICS_MESSAGE, action: "preference", enabled });
        if (current === revision) publish(preferenceFrom(result));
      } catch {
        if (current === revision) publish({ ...state, enabled: false, saving: false, error: true });
      }
    },
    track(event) {
      if (disposed || !state.ready || !state.configured || !state.enabled || state.saving || state.error) return;
      const safe = sanitizeAnalyticsEvent(event);
      if (safe) void send({ type: ANALYTICS_MESSAGE, action: "event", event: safe }).catch(() => undefined);
    },
    dispose() { disposed = true; revision += 1; unsubscribe(); listeners.clear(); }
  };
}

function preferenceFrom(response: unknown): AnalyticsPreference {
  if (!isRecord(response) || response.ok !== true || !isRecord(response.value) || typeof response.value.enabled !== "boolean" || typeof response.value.configured !== "boolean") throw new Error("Analytics preference unavailable");
  return { enabled: response.value.enabled, configured: response.value.configured, ready: true, saving: false, error: false,
    ...(typeof response.value.nativeConsent === "boolean" ? { nativeConsent: response.value.nativeConsent } : {}) };
}

function sendToWorker(message: unknown): Promise<unknown> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return Promise.resolve({ ok: true, value: { enabled: true, configured: false } });
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error("Analytics service unavailable"));
      else resolve(response);
    });
  });
}

function onChromePreferenceChange(listener: (reason?: "native") => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => undefined;
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && Object.hasOwn(changes, ANALYTICS_PREFERENCE_KEY)) listener();
  };
  chrome.storage.onChanged.addListener(changed);
  const permissions = firefoxDataPermissions();
  const nativePermissionChanged = () => listener("native");
  permissions?.onAdded.addListener(nativePermissionChanged);
  permissions?.onRemoved.addListener(nativePermissionChanged);
  const nativeChanged = (message: unknown, sender: chrome.runtime.MessageSender) => {
    if (isRecord(message) && message.type === ANALYTICS_MESSAGE && message.action === "native-changed"
      && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL("_generated_background_page.html")) listener("native");
    return false;
  };
  if (isFirefoxExtension()) chrome.runtime.onMessage.addListener(nativeChanged);
  return () => { chrome.storage.onChanged.removeListener(changed); permissions?.onAdded.removeListener(nativePermissionChanged); permissions?.onRemoved.removeListener(nativePermissionChanged);
    if (isFirefoxExtension()) chrome.runtime.onMessage.removeListener(nativeChanged);
  };
}
