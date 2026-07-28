import { describe, expect, it, vi } from "vitest";

import {
  createGoogleAnalytics,
  eventCountBucket,
  type AnalyticsStorage,
  type WorkbenchAnalyticsEvent
} from "../src/extension/analytics";

function createMemoryStorage(
  initial: Record<string, string> = {}
): AnalyticsStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
}

describe("opt-in Google Analytics", () => {
  it("does not create an identifier or make a request before consent", async () => {
    const storage = createMemoryStorage();
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }) as Response
    );
    const analytics = createGoogleAnalytics({
      measurementId: "G-TEST123456",
      apiSecret: "test-secret",
      extensionVersion: "0.1.4",
      storage,
      fetcher,
      generateClientId: () => "client-test"
    });

    await analytics.track({ name: "panel_view" });

    expect(analytics.available).toBe(true);
    expect(analytics.getConsent()).toBe("unknown");
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.values.has("lsew.analytics.client-id.v1")).toBe(false);
  });

  it("does not persist consent when the release analytics configuration is incomplete", async () => {
    const storage = createMemoryStorage();
    const analytics = createGoogleAnalytics({
      measurementId: "",
      apiSecret: "",
      extensionVersion: "0.1.4",
      storage
    });

    await expect(analytics.setConsent("granted")).resolves.toBe(false);

    expect(analytics.available).toBe(false);
    expect(analytics.getConsent()).toBe("unknown");
    expect(storage.values.has("lsew.analytics.consent.v1")).toBe(false);
  });

  it("sends only allowlisted coarse parameters with advertising consent denied", async () => {
    const storage = createMemoryStorage();
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }) as Response
    );
    const analytics = createGoogleAnalytics({
      measurementId: "G-TEST123456",
      apiSecret: "test-secret",
      extensionVersion: "0.1.4",
      storage,
      fetcher,
      now: () => 1_700_000_000_000,
      generateClientId: () => "123456789.1700000000"
    });
    const event = {
      name: "replay_result",
      surface: "command_state",
      target: "listener",
      edited: true,
      outcome: "success",
      inspectedUrl: "https://private.example/account",
      searchText: "customer-secret",
      payload: { key: "private-key" },
      error: "private stack"
    } as WorkbenchAnalyticsEvent;

    await expect(analytics.setConsent("granted")).resolves.toBe(true);
    await analytics.track(event);

    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      "https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123456"
    );
    expect(String(url)).toContain("api_secret=test-secret");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer"
    });

    const body = JSON.parse(String(init?.body)) as {
      client_id: string;
      non_personalized_ads: boolean;
      consent: Record<string, string>;
      events: Array<{ name: string; params: Record<string, string | number> }>;
    };
    expect(body).toEqual({
      client_id: "123456789.1700000000",
      non_personalized_ads: true,
      consent: {
        ad_user_data: "DENIED",
        ad_personalization: "DENIED"
      },
      validation_behavior: "ENFORCE_RECOMMENDATIONS",
      events: [
        {
          name: "replay_result",
          params: {
            replay_surface: "command_state",
            replay_target: "listener",
            replay_edited: 1,
            replay_outcome: "success",
            session_id: 1_700_000_000,
            engagement_time_msec: 1,
            extension_version: "0.1.4"
          }
        }
      ]
    });
    expect(String(init?.body)).not.toMatch(
      /private\.example|customer-secret|private-key|private stack/
    );
  });

  it("removes its identifier and blocks future transport on opt-out", async () => {
    const storage = createMemoryStorage({
      "lsew.analytics.consent.v1": "granted",
      "lsew.analytics.client-id.v1": "existing-client"
    });
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }) as Response
    );
    const analytics = createGoogleAnalytics({
      measurementId: "G-TEST123456",
      apiSecret: "test-secret",
      extensionVersion: "0.1.4",
      storage,
      fetcher
    });

    await expect(analytics.setConsent("denied")).resolves.toBe(true);
    await analytics.track({ name: "panel_view" });

    expect(analytics.getConsent()).toBe("denied");
    expect(storage.values.get("lsew.analytics.consent.v1")).toBe("denied");
    expect(storage.values.has("lsew.analytics.client-id.v1")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("swallows transport failures so analytics cannot break the workbench", async () => {
    const analytics = createGoogleAnalytics({
      measurementId: "G-TEST123456",
      apiSecret: "test-secret",
      extensionVersion: "0.1.4",
      storage: createMemoryStorage(),
      fetcher: vi.fn(async () => {
        throw new Error("offline");
      })
    });

    await analytics.setConsent("granted");

    await expect(analytics.track({ name: "panel_view" })).resolves.toBeUndefined();
  });

  it("buckets event totals without exposing exact high-volume counts", () => {
    expect([0, 1, 10, 11, 100, 101, 1_000, 1_001].map(eventCountBucket)).toEqual([
      "0",
      "1_10",
      "1_10",
      "11_100",
      "11_100",
      "101_1000",
      "101_1000",
      "1001_plus"
    ]);
  });
});
