import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CLIENT_KEY, ANALYTICS_PREFERENCE_KEY, ANALYTICS_SESSION_KEY, sanitizeAnalyticsEvent } from "../src/extension/analytics/events";
import { createAnalyticsService, type AnalyticsStorage } from "../src/extension/analytics/service";
import { createAnalyticsClient } from "../src/extension/analytics/client";
import { createEngagementClock } from "../src/extension/analytics/engagement";

const CLIENT_ID = "1234567890.1780000000";
const config = { measurementId: "G-TEST123", apiSecret: "test-key", debug: false };
const event = { name: "panel_opened", params: {} } as const;
function storage(seed: Record<string, unknown> = {}) {
  const data = { ...seed };
  return {
    data,
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; })
  };
}
function setup() {
  const local = storage();
  const session = storage();
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  let time = 1_780_000_000_000;
  const options = { config, local: local as unknown as AnalyticsStorage, session: session as unknown as AnalyticsStorage, version: "2.0.2", fetch: request, now: () => time, createClientId: () => CLIENT_ID };
  return { local, session, request, options, service: createAnalyticsService(options), advance: (ms: number) => { time += ms; } };
}
function bodies(request: ReturnType<typeof setup>["request"]) { return request.mock.calls.map(([, init]) => JSON.parse(String(init?.body))); }

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("analytics data boundary", () => {
  it("accepts only the closed event vocabulary and bounded engagement", () => {
    expect(sanitizeAnalyticsEvent(event)).toEqual(event);
    for (const unsafe of [
      { ...event, payload: "private" },
      { ...event, params: { url: "https://private.example" } },
      { name: "feature_used", params: { feature: "private payload", action: "open" } },
      { name: "extension_problem", params: { problem: "TypeError: token=secret" } },
      { name: "__proto__", params: {} },
      { name: "page_view", params: { screen: "https://customer.example" } },
      { ...event, engagement_time_msec: Infinity },
      { ...event, engagement_time_msec: -1 },
      { ...event, engagement_time_msec: 60_001 }
    ]) expect(sanitizeAnalyticsEvent(unsafe)).toBeNull();
  });

  it("defaults on, serializes concurrent identity creation, and sends no application context", async () => {
    const { service, request, local } = setup();
    expect(await service.getState()).toEqual({ enabled: true, configured: true });
    expect(local.data[ANALYTICS_CLIENT_KEY]).toBeUndefined();
    await Promise.all([service.track(event), service.track({ name: "page_view", params: { screen: "local_injection" }, engagement_time_msec: 1234 })]);
    expect(local.set).toHaveBeenCalledTimes(1);
    const sent = bodies(request);
    expect(sent[0].client_id).toBe(CLIENT_ID);
    expect(sent[1].client_id).toBe(CLIENT_ID);
    expect(sent[0].events[0].params.session_id).toBe(sent[1].events[0].params.session_id);
    expect(sent[1].events[0]).toMatchObject({ name: "page_view", params: { page_location: "https://lightstreamer-workbench.invalid/local_injection", engagement_time_msec: 1234, extension_version: "2.0.2" } });
    expect(sent[0].consent).toEqual({ ad_user_data: "DENIED", ad_personalization: "DENIED" });
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    expect(Object.keys(sent[0]).sort()).toEqual(["client_id", "consent", "events", "timestamp_micros"]);
  });

  it("survives a worker restart and expires sessions after thirty minutes without activity", async () => {
    const fixture = setup();
    await fixture.service.track(event);
    fixture.advance(10_000);
    const restarted = createAnalyticsService(fixture.options);
    await restarted.track(event);
    fixture.advance(30 * 60_000);
    await restarted.track(event);
    const sent = bodies(fixture.request);
    expect(sent[1].events[0].params.session_id).toBe(sent[0].events[0].params.session_id);
    expect(sent[2].events[0].params.session_id).not.toBe(sent[0].events[0].params.session_id);
    expect(new Set(sent.map(body => body.client_id)).size).toBe(1);
  });

  it("honors saved opt-out before creating an identifier or making a request", async () => {
    const { service, local, session, request } = setup();
    local.data[ANALYTICS_PREFERENCE_KEY] = false;
    expect(await service.track(event)).toBe(false);
    expect(local.set).not.toHaveBeenCalled();
    expect(session.set).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it("revokes an in-flight request, drops queued work, and clears identifiers before acknowledging opt-out", async () => {
    const fixture = setup();
    let started!: () => void;
    const active = new Promise<void>(resolve => { started = resolve; });
    fixture.request.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      started();
    }));
    const first = fixture.service.track(event);
    const queued = fixture.service.track(event);
    await active;
    await expect(fixture.service.setEnabled(false)).resolves.toEqual({ enabled: false, configured: true });
    expect(await first).toBe(false);
    expect(await queued).toBe(false);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.local.data).toEqual({ [ANALYTICS_PREFERENCE_KEY]: false });
    expect(fixture.session.data).toEqual({});
    expect(await fixture.service.track(event)).toBe(false);
  });

  it("does not resurrect events accepted before opt-out when analytics is re-enabled", async () => {
    const { service, request, local } = setup();
    const queued = service.track(event);
    await service.setEnabled(false);
    await service.setEnabled(true);
    expect(await queued).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(local.data[ANALYTICS_CLIENT_KEY]).toBeUndefined();
    await service.track(event);
    expect(request).toHaveBeenCalledOnce();
  });

  it("does not transmit when configuration or storage is unavailable", async () => {
    const fixture = setup();
    await createAnalyticsService({ ...fixture.options, config: null }).track(event);
    fixture.local.get.mockRejectedValue(new Error("storage denied"));
    expect(await fixture.service.track(event)).toBe(false);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("drops network failures without retries or persistent event storage", async () => {
    const { service, request, session } = setup();
    request.mockRejectedValueOnce(new Error("offline"));
    expect(await service.track(event)).toBe(false);
    expect(await service.track(event)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(Object.keys(session.data)).toEqual([ANALYTICS_SESSION_KEY]);
  });

  it("bounds bursts and times out a stalled request", async () => {
    vi.useFakeTimers();
    const { service, request } = setup();
    request.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const first = service.track(event);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await first).toBe(false);
    request.mockImplementation(async () => new Response(null, { status: 204 }));
    const results = await Promise.all(Array.from({ length: 1000 }, () => service.track(event)));
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(64);
  });
});

describe("panel analytics preferences", () => {
  it("waits for preference initialization and never sends while saving an opt-out", async () => {
    let resolveState!: (value: unknown) => void;
    const initial = new Promise(resolve => { resolveState = resolve; });
    const send = vi.fn(async () => initial);
    const client = createAnalyticsClient({ send });
    client.track(event);
    expect(send).toHaveBeenCalledOnce();
    resolveState({ ok: true, value: { enabled: true, configured: true } });
    await initial;
    await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
    client.track(event);
    expect(send).toHaveBeenCalledTimes(2);
    const saving = client.setEnabled(false);
    client.track(event);
    expect(send).toHaveBeenCalledTimes(3);
    await saving;
    client.dispose();
  });

  it("synchronizes a changed preference from another panel and pauses on storage failure", async () => {
    let refresh!: () => void;
    let enabled = true;
    const send = vi.fn(async () => ({ ok: true, value: { enabled, configured: true } }));
    const unsubscribe = vi.fn();
    const client = createAnalyticsClient({ send, onPreferenceChange(listener) { refresh = listener; return unsubscribe; } });
    await Promise.resolve();
    enabled = false;
    refresh();
    await Promise.resolve();
    expect(client.getSnapshot().enabled).toBe(false);
    send.mockRejectedValueOnce(new Error("storage unavailable"));
    await client.setEnabled(true);
    expect(client.getSnapshot()).toMatchObject({ enabled: false, error: true });
    const calls = send.mock.calls.length;
    client.track(event);
    expect(send).toHaveBeenCalledTimes(calls);
    client.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe("foreground engagement", () => {
  it("excludes hidden, unfocused, and idle time and never counts elapsed time twice", () => {
    let time = 100_000;
    const clock = createEngagementClock(() => time);
    clock.setVisible(true);
    clock.setFocused(true);
    time += 5000;
    expect(clock.take()).toBe(5000);
    expect(clock.take()).toBe(0);
    clock.setVisible(false);
    time += 300_000;
    expect(clock.take()).toBe(0);
    clock.setVisible(true);
    time += 2000;
    clock.setFocused(false);
    time += 300_000;
    expect(clock.take()).toBe(2000);
    clock.setFocused(true);
    time += 300_000;
    expect(clock.take()).toBe(60_000);
    time += 300_000;
    expect(clock.take()).toBe(0);
    clock.interact();
    time += 2500;
    expect(clock.take()).toBe(2500);
  });
});
