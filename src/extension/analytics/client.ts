import { ANALYTICS_MESSAGE, ANALYTICS_PREFERENCE_KEY, isRecord, sanitizeAnalyticsEvent, type AnalyticsEvent } from "./events";

export type AnalyticsPreference = Readonly<{ enabled: boolean; configured: boolean; ready: boolean; saving: boolean; error: boolean }>;
export type AnalyticsClient = Readonly<{
  getSnapshot(): AnalyticsPreference;
  subscribe(listener: () => void): () => void;
  setEnabled(enabled: boolean): Promise<void>;
  track(event: AnalyticsEvent): void;
  dispose(): void;
}>;
export type AnalyticsClientOptions = Readonly<{
  send?: (message: unknown) => Promise<unknown>;
  onPreferenceChange?: (listener: () => void) => () => void;
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
  const unsubscribe = (options.onPreferenceChange ?? onChromePreferenceChange)(() => { void refresh(); });
  void refresh();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async setEnabled(enabled) {
      const current = ++revision;
      publish({ ...state, enabled, saving: true, error: false });
      try {
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
  return { enabled: response.value.enabled, configured: response.value.configured, ready: true, saving: false, error: false };
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

function onChromePreferenceChange(listener: () => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => undefined;
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && Object.hasOwn(changes, ANALYTICS_PREFERENCE_KEY)) listener();
  };
  chrome.storage.onChanged.addListener(changed);
  return () => chrome.storage.onChanged.removeListener(changed);
}
