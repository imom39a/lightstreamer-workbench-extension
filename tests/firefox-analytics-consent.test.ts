import { afterEach, expect, it, vi } from "vitest";
import { createAnalyticsService, type AnalyticsStorage } from "../src/extension/analytics/service";
import { createAnalyticsClient } from "../src/extension/analytics/client";
import { ANALYTICS_CLIENT_KEY, ANALYTICS_SESSION_KEY, ANALYTICS_MESSAGE } from "../src/extension/analytics/events";
import { requestFirefoxAnalyticsConsent } from "../src/extension/firefox-data-consent";

function storage() {
  const data: Record<string, unknown> = {};
  return { data, get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]))), set: vi.fn(async (v: object) => { Object.assign(data, v); }), remove: vi.fn(async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const event = { name: "panel_opened", params: {} } as const;
it("requires both Firefox native consent and Workbench preference, and purges on native revocation", async () => {
  const local = storage(), session = storage(), request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const service = createAnalyticsService({ nativeConsent: false, config: { measurementId: "G-TEST", apiSecret: "test", debug: false }, local: local as unknown as AnalyticsStorage, session: session as unknown as AnalyticsStorage, version: "2.0.9", fetch: request });
  expect(await service.getState()).toMatchObject({ enabled: false, nativeConsent: false });
  expect(await service.setEnabled(true)).toMatchObject({ enabled: false });
  expect(await service.track(event)).toBe(false);
  expect(request).not.toHaveBeenCalled();
  await service.setNativeConsent(true);
  expect(await service.track(event)).toBe(true);
  expect(local.data[ANALYTICS_CLIENT_KEY]).toBeDefined();
  let started!: () => void;
  const active = new Promise<void>(r => { started = r; });
  request.mockImplementationOnce(async (_url, init) => new Promise((_r, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))); started(); }));
  const first = service.track(event), queued = service.track(event);
  await active;
  const revoked = service.setNativeConsent(false);
  expect(await first).toBe(false);
  expect(await queued).toBe(false);
  await revoked;
  expect(local.data[ANALYTICS_CLIENT_KEY]).toBeUndefined();
  expect(session.data[ANALYTICS_SESSION_KEY]).toBeUndefined();
  await service.setEnabled(false);
  await service.setNativeConsent(true);
  expect(await service.track(event)).toBe(false);
});
it("requests native consent synchronously from the checkbox gesture and respects refusal", async () => {
  let resolve!: (allowed: boolean) => void;
  const requestNativeConsent = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  const send = vi.fn(async (_message: unknown) => ({ ok: true, value: { enabled: false, configured: true, nativeConsent: false } }));
  const client = createAnalyticsClient({ send, requestNativeConsent });
  await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
  const pending = client.setEnabled(true);
  expect(requestNativeConsent).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot()).toMatchObject({ enabled: false, saving: true });
  expect(send).toHaveBeenCalledTimes(1);
  resolve(false);
  await pending;
  expect(client.getSnapshot()).toMatchObject({ enabled: false, nativeConsent: false, error: false });
  expect(send.mock.calls.some(([value]) => (value as { action: string }).action === "preference")).toBe(false);
  client.dispose();
});

it("routes a Firefox DevTools consent click through the canonical analytics message", async () => {
  vi.stubGlobal("browser", {});
  const sendMessage = vi.fn((_message: unknown, callback: (value: unknown) => void) => callback({ok:true,value:false}));
  vi.stubGlobal("chrome", {runtime: {getURL: () => "moz-extension://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/", sendMessage}});
  expect(await requestFirefoxAnalyticsConsent()).toBe(false);
  expect(sendMessage).toHaveBeenCalledWith({type:ANALYTICS_MESSAGE,action:"consent"}, expect.any(Function));
});

it("saves the explicit On choice after its native grant notification, including a previously saved Off preference", async () => {
  let notify!: (reason?: "native") => void;
  let native = false, enabled = false;
  const send = vi.fn(async (message: any) => {
    if (message.action === "preference") enabled = message.enabled;
    return {ok:true,value:{enabled:native && enabled,configured:true,nativeConsent:native}};
  });
  const client = createAnalyticsClient({send,onPreferenceChange:listener => {notify=listener; return () => undefined;},requestNativeConsent:async () => {native=true;notify("native");return true;}});
  await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
  await client.setEnabled(true);
  expect(send).toHaveBeenCalledWith({type:ANALYTICS_MESSAGE,action:"preference",enabled:true});
  expect(client.getSnapshot()).toMatchObject({enabled:true,nativeConsent:true,saving:false});
  client.dispose();
});
