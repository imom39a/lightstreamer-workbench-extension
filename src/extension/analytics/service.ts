import { ANALYTICS_CLIENT_KEY, ANALYTICS_PREFERENCE_KEY, ANALYTICS_SESSION_KEY, isRecord, sanitizeAnalyticsEvent } from "./events";

export type AnalyticsConfig = Readonly<{ measurementId: string; apiSecret: string; debug: boolean }>;
export type AnalyticsState = Readonly<{ enabled: boolean; configured: boolean }>;
export type AnalyticsStorage = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;
export type AnalyticsServiceOptions = Readonly<{
  config: AnalyticsConfig | null;
  local: AnalyticsStorage;
  session: AnalyticsStorage;
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  createClientId?: () => string;
}>;

const SESSION_TIMEOUT_MS = 30 * 60_000;
const MAX_PENDING = 64;
const MAX_EVENTS_PER_MINUTE = 120;
const ENDPOINT = "https://www.google-analytics.com/mp/collect";

/** One service-worker owner serializes identity, preferences, and analytics sessions. */
export function createAnalyticsService(options: AnalyticsServiceOptions) {
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  let work: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let epoch = 0;
  let blocked = false;
  let activeRequest: AbortController | null = null;
  let rateWindow = 0;
  let rateCount = 0;

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = work.then(operation);
    work = result.catch(() => undefined);
    return result;
  }

  async function getState(): Promise<AnalyticsState> {
    const stored = await options.local.get(ANALYTICS_PREFERENCE_KEY);
    return { enabled: stored[ANALYTICS_PREFERENCE_KEY] !== false, configured: options.config !== null };
  }

  function setEnabled(enabled: boolean): Promise<AnalyticsState> {
    // Revoke before waiting for storage or an in-flight network request.
    epoch += 1;
    blocked = true;
    activeRequest?.abort();
    return enqueue(async () => {
      await options.local.set({ [ANALYTICS_PREFERENCE_KEY]: enabled });
      if (!enabled) {
        await options.local.remove(ANALYTICS_CLIENT_KEY);
        await options.session.remove(ANALYTICS_SESSION_KEY);
      }
      blocked = !enabled;
      return { enabled, configured: options.config !== null };
    });
  }

  function track(input: unknown): Promise<boolean> {
    const event = sanitizeAnalyticsEvent(input);
    const config = options.config;
    if (!event || !config || blocked || pending >= MAX_PENDING) return Promise.resolve(false);
    const acceptedEpoch = epoch;
    const occurredAt = now();
    if (occurredAt - rateWindow >= 60_000) { rateWindow = occurredAt; rateCount = 0; }
    if (++rateCount > MAX_EVENTS_PER_MINUTE) return Promise.resolve(false);
    pending += 1;
    const allowed = () => !blocked && acceptedEpoch === epoch;
    return enqueue(async () => {
      if (!allowed()) return false;
      const stored = await options.local.get([ANALYTICS_PREFERENCE_KEY, ANALYTICS_CLIENT_KEY]);
      if (!allowed() || stored[ANALYTICS_PREFERENCE_KEY] === false) return false;
      let clientId = stored[ANALYTICS_CLIENT_KEY];
      if (typeof clientId !== "string" || clientId.length > 100 || !/^\d+\.\d+$/.test(clientId)) {
        clientId = (options.createClientId ?? (() => `${crypto.getRandomValues(new Uint32Array(1))[0]}.${Math.floor(now() / 1000)}`))();
        await options.local.set({ [ANALYTICS_CLIENT_KEY]: clientId });
      }
      if (!allowed()) return false;
      const sessions = await options.session.get(ANALYTICS_SESSION_KEY);
      if (!allowed()) return false;
      const previous = sessions[ANALYTICS_SESSION_KEY];
      const valid = isRecord(previous) && typeof previous.id === "number" && Number.isSafeInteger(previous.id) && previous.id > 0 && typeof previous.lastActive === "number" && occurredAt >= previous.lastActive && occurredAt - previous.lastActive < SESSION_TIMEOUT_MS;
      const sessionId = valid ? previous.id : Math.max(1, Math.floor(occurredAt / 1000));
      await options.session.set({ [ANALYTICS_SESSION_KEY]: { id: sessionId, lastActive: occurredAt } });
      if (!allowed()) return false;

      const params: Record<string, string | number> = {
        ...event.params,
        session_id: sessionId as number,
        engagement_time_msec: event.engagement_time_msec ?? 0,
        extension_version: options.version,
        analytics_schema: "1",
        app_surface: "extension"
      };
      if (event.name === "page_view") {
        // Synthetic extension screens, never document.location or inspectedWindow URLs.
        params.page_title = `Workbench · ${event.params.screen}`;
        params.page_location = `https://lightstreamer-workbench.invalid/${event.params.screen}`;
      }
      if (config.debug) params.debug_mode = 1;
      const abort = new AbortController();
      activeRequest = abort;
      const timer = setTimeout(() => abort.abort(), 5_000);
      try {
        const response = await request(`${ENDPOINT}?${new URLSearchParams({ measurement_id: config.measurementId, api_secret: config.apiSecret })}`, {
          method: "POST",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          cache: "no-store",
          signal: abort.signal,
          body: JSON.stringify({
            client_id: clientId,
            timestamp_micros: occurredAt * 1000,
            consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
            events: [{ name: event.name, params }]
          })
        });
        return response.ok;
      } finally {
        clearTimeout(timer);
        if (activeRequest === abort) activeRequest = null;
      }
    }).catch(() => false).finally(() => { pending -= 1; });
  }

  return { getState: () => enqueue(getState), setEnabled, track };
}
