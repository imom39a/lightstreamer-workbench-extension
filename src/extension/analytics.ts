const CONSENT_STORAGE_KEY = "lsew.analytics.consent.v1";
const CLIENT_ID_STORAGE_KEY = "lsew.analytics.client-id.v1";
const DEFAULT_COLLECTION_ENDPOINT = "https://www.google-analytics.com/mp/collect";

export type AnalyticsConsent = "unknown" | "granted" | "denied";
export type AnalyticsLocalInjectionSurface = "selected_evidence" | "command_scope";
export type AnalyticsLocalInjectionTarget = "listener" | "wire";
export type AnalyticsLocalInjectionOutcome =
  | "success"
  | "stale_target"
  | "listener_error"
  | "wire_error"
  | "bridge_error"
  | "acknowledgement_unknown"
  | "partial";
export type AnalyticsEventCountBucket =
  | "0"
  | "1_10"
  | "11_100"
  | "101_1000"
  | "1001_plus";

export type WorkbenchAnalyticsEvent =
  | { name: "analytics_enabled" }
  | { name: "panel_view" }
  | { name: "lightstreamer_detected" }
  | { name: "search_used" }
  | {
      name: "local_injection_attempt";
      surface: AnalyticsLocalInjectionSurface;
      target: AnalyticsLocalInjectionTarget;
      edited: boolean;
    }
  | {
      name: "local_injection_result";
      surface: AnalyticsLocalInjectionSurface;
      target: AnalyticsLocalInjectionTarget;
      edited: boolean;
      outcome: AnalyticsLocalInjectionOutcome;
    }
  | {
      name: "session_summary";
      eventCountBucket: AnalyticsEventCountBucket;
      searchUsed: boolean;
      localInjectionUsed: boolean;
    };

export type AnalyticsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WorkbenchAnalytics = {
  readonly available: boolean;
  getConsent(): AnalyticsConsent;
  setConsent(consent: Exclude<AnalyticsConsent, "unknown">): Promise<boolean>;
  track(event: WorkbenchAnalyticsEvent): Promise<void>;
};

export type GoogleAnalyticsOptions = {
  measurementId: string;
  apiSecret: string;
  extensionVersion: string;
  storage: AnalyticsStorage;
  fetcher?: typeof fetch;
  collectionEndpoint?: string;
  now?: () => number;
  generateClientId?: () => string;
};

type GoogleAnalyticsEvent = {
  name: string;
  params: Record<string, string | number>;
};

const localInjectionSurfaces = new Set<AnalyticsLocalInjectionSurface>([
  "selected_evidence",
  "command_scope"
]);
const localInjectionTargets = new Set<AnalyticsLocalInjectionTarget>(["listener", "wire"]);
const localInjectionOutcomes = new Set<AnalyticsLocalInjectionOutcome>([
  "success",
  "stale_target",
  "listener_error",
  "wire_error",
  "bridge_error",
  "acknowledgement_unknown",
  "partial"
]);
const eventCountBuckets = new Set<AnalyticsEventCountBucket>([
  "0",
  "1_10",
  "11_100",
  "101_1000",
  "1001_plus"
]);

export function createGoogleAnalytics(options: GoogleAnalyticsOptions): WorkbenchAnalytics {
  const measurementId = options.measurementId.trim();
  const apiSecret = options.apiSecret.trim();
  const extensionVersion = sanitizeVersion(options.extensionVersion);
  const available = /^G-[A-Z0-9]+$/i.test(measurementId) && apiSecret.length > 0;
  const now = options.now ?? Date.now;
  const generateClientId = options.generateClientId ?? defaultClientId;
  const fetcher = options.fetcher ?? fetch;
  const endpoint = buildCollectionEndpoint(
    options.collectionEndpoint ?? DEFAULT_COLLECTION_ENDPOINT,
    measurementId,
    apiSecret
  );
  const sessionId = Math.max(1, Math.floor(now() / 1_000));
  let consent = readConsent(options.storage);
  let clientId: string | null = null;
  let lastEventAt = now();

  return {
    available,

    getConsent() {
      return consent;
    },

    async setConsent(nextConsent) {
      if (nextConsent === "denied") {
        consent = "denied";
        clientId = null;
        safeSet(options.storage, CONSENT_STORAGE_KEY, consent);
        safeRemove(options.storage, CLIENT_ID_STORAGE_KEY);
        return true;
      }

      if (!available) {
        return false;
      }

      consent = "granted";
      safeSet(options.storage, CONSENT_STORAGE_KEY, consent);
      return true;
    },

    async track(event) {
      if (!available || consent !== "granted") {
        return;
      }

      const serializedEvent = serializeEvent(event);
      if (!serializedEvent) {
        return;
      }

      clientId ??= readOrCreateClientId(options.storage, generateClientId);
      const eventAt = now();
      const engagementTime = Math.max(1, Math.min(60_000, eventAt - lastEventAt));
      lastEventAt = eventAt;

      serializedEvent.params = {
        ...serializedEvent.params,
        session_id: sessionId,
        engagement_time_msec: engagementTime,
        extension_version: extensionVersion
      };

      try {
        await fetcher(endpoint, {
          method: "POST",
          headers: {
            // A simple CORS content type avoids adding a Chrome host permission.
            // GA4 Measurement Protocol still parses the JSON request body.
            "Content-Type": "text/plain;charset=UTF-8"
          },
          body: JSON.stringify({
            client_id: clientId,
            non_personalized_ads: true,
            consent: {
              ad_user_data: "DENIED",
              ad_personalization: "DENIED"
            },
            validation_behavior: "ENFORCE_RECOMMENDATIONS",
            events: [serializedEvent]
          }),
          cache: "no-store",
          credentials: "omit",
          keepalive: true,
          referrerPolicy: "no-referrer"
        });
      } catch {
        // Analytics must never affect capture, inspection, or reinjection.
      }
    }
  };
}

export function createDisabledAnalytics(): WorkbenchAnalytics {
  return {
    available: false,
    getConsent: () => "unknown",
    setConsent: async () => false,
    track: async () => undefined
  };
}

export function eventCountBucket(count: number): AnalyticsEventCountBucket {
  if (count <= 0) {
    return "0";
  }
  if (count <= 10) {
    return "1_10";
  }
  if (count <= 100) {
    return "11_100";
  }
  if (count <= 1_000) {
    return "101_1000";
  }
  return "1001_plus";
}

function serializeEvent(event: WorkbenchAnalyticsEvent): GoogleAnalyticsEvent | null {
  switch (event.name) {
    case "analytics_enabled":
    case "panel_view":
    case "lightstreamer_detected":
      return { name: event.name, params: {} };
    case "search_used":
      return { name: event.name, params: {} };
    case "local_injection_attempt":
      if (!isValidLocalInjectionContext(event.surface, event.target)) {
        return null;
      }
      return {
        name: event.name,
        params: {
          local_injection_surface: event.surface,
          local_injection_target: event.target,
          local_injection_edited: Number(event.edited)
        }
      };
    case "local_injection_result":
      if (
        !isValidLocalInjectionContext(event.surface, event.target) ||
        !localInjectionOutcomes.has(event.outcome)
      ) {
        return null;
      }
      return {
        name: event.name,
        params: {
          local_injection_surface: event.surface,
          local_injection_target: event.target,
          local_injection_edited: Number(event.edited),
          local_injection_outcome: event.outcome
        }
      };
    case "session_summary":
      if (!eventCountBuckets.has(event.eventCountBucket)) {
        return null;
      }
      return {
        name: event.name,
        params: {
          event_count_bucket: event.eventCountBucket,
          search_used: Number(event.searchUsed),
          local_injection_used: Number(event.localInjectionUsed)
        }
      };
  }
}

function isValidLocalInjectionContext(
  surface: AnalyticsLocalInjectionSurface,
  target: AnalyticsLocalInjectionTarget
): boolean {
  return localInjectionSurfaces.has(surface) && localInjectionTargets.has(target);
}

function readConsent(storage: AnalyticsStorage): AnalyticsConsent {
  try {
    const value = storage.getItem(CONSENT_STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function readOrCreateClientId(
  storage: AnalyticsStorage,
  generateClientId: () => string
): string {
  try {
    const existing = storage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && isValidClientId(existing)) {
      return existing;
    }
  } catch {
    // Use an in-memory identifier if local storage is unavailable.
  }

  const candidate = generateClientId();
  const generated = isValidClientId(candidate) ? candidate : defaultClientId();
  safeSet(storage, CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

function safeSet(storage: AnalyticsStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage failure must not affect the workbench.
  }
}

function safeRemove(storage: AnalyticsStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage failure must not affect the workbench.
  }
}

function defaultClientId(): string {
  const parts = crypto.getRandomValues(new Uint32Array(2));
  return `${Math.max(1, parts[0] ?? 1)}.${Math.max(1, parts[1] ?? 1)}`;
}

function isValidClientId(value: string): boolean {
  return /^\d{1,20}\.\d{1,20}$/.test(value);
}

function sanitizeVersion(version: string): string {
  const value = version.trim();
  return /^[0-9A-Za-z._+-]{1,40}$/.test(value) ? value : "unknown";
}

function buildCollectionEndpoint(
  endpoint: string,
  measurementId: string,
  apiSecret: string
): string {
  const url = new URL(endpoint);
  url.searchParams.set("measurement_id", measurementId);
  url.searchParams.set("api_secret", apiSecret);
  return url.toString();
}
