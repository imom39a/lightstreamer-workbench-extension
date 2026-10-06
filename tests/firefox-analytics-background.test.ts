import { afterEach, expect, it, vi } from "vitest";
import { registerAnalyticsService } from "../src/extension/analytics/background";
import { ANALYTICS_CLIENT_KEY, ANALYTICS_MESSAGE, ANALYTICS_SESSION_KEY, ANALYTICS_PREFERENCE_KEY } from "../src/extension/analytics/events";

function fixture() {
  function storage() {
    const data: Record<string, unknown> = {};
    return { data, get: async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]])),
      set: async (values: object) => { Object.assign(data, values); },
      remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
  }
  const local = storage(), session = storage();
  const url = "moz-extension://aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/";
  let allowed = false, removed!: () => void, added!: () => void;
  let windowRemoved!: (id: number) => void;
  let listener!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (result: any) => void) => boolean;
  const listeners: typeof listener[] = [];
  const getAll = vi.fn(async () => ({ data_collection: allowed ? ["technicalAndInteraction"] : [] }));
  const request = vi.fn(async (_value: unknown) => allowed);
  const broadcast = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => ({ id: 99 }));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("browser", { permissions: { getAll, request,
    onAdded: { addListener: (value: typeof added) => { added = value; } },
    onRemoved: { addListener: (value: typeof removed) => { removed = value; } } } });
  vi.stubGlobal("chrome", { runtime: { id: "workbench", getURL: (path: string) => url + path,
    getManifest: () => ({ version: "2.0.9" }), sendMessage: broadcast,
    onMessage: { addListener: (value: typeof listener) => { listeners.push(value); } } }, storage: { local, session },
    windows: { create: openWindow, onRemoved: { addListener: (value: typeof windowRemoved) => { windowRemoved = value; } } } });
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("PROD", true); vi.stubEnv("VITE_LSEW_GA_MEASUREMENT_ID", "G-TEST123"); vi.stubEnv("VITE_LSEW_GA_API_SECRET", "test");
  registerAnalyticsService();
  listener = (message, sender, respond) => listeners.map(value => value(message, sender, respond)).some(Boolean);
  const sender = { id: "workbench", url: url + "extension/panel/index.html" };
  const send = (action: string, values: object = {}) => new Promise<any>(resolve => {
    expect(listener({ type: ANALYTICS_MESSAGE, action, ...values }, sender, resolve)).toBe(true);
  });
  return { local, session, request, fetch, getAll, broadcast, listener, sender, send, openWindow,
    closeConsent() { windowRemoved(99); },
    add() { allowed = true; added(); }, remove() { allowed = false; removed(); } };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("opens a consent window only for the actual panel and leaves collection off on cancellation", async () => {
  const f = fixture(), respond = vi.fn();
  for (const sender of [{ ...f.sender, id: "other" }, { ...f.sender, url: "https://inspected.example" }, { ...f.sender, url: f.sender.url + "?fake" }]) {
    expect(f.listener({ type: ANALYTICS_MESSAGE, action: "consent" }, sender, respond)).toBe(false);
  }
  expect(f.request).not.toHaveBeenCalled();
  const pending = f.send("consent");
  expect(f.openWindow).toHaveBeenCalledWith(expect.objectContaining({type: "normal", url: expect.stringContaining("extension/analytics-consent/index.html")}));
  await Promise.resolve(); f.closeConsent();
  expect(f.request).not.toHaveBeenCalled();
  expect(await pending).toEqual({ ok: true, value: false });
  expect(await f.send("state")).toEqual({ ok: true, value: { enabled: false, configured: true, nativeConsent: false } });
  expect(await f.send("event", { event: { name: "panel_opened", params: {} } })).toEqual({ ok: true, value: false });
  expect(f.fetch).not.toHaveBeenCalled();
  expect(f.local.data[ANALYTICS_CLIENT_KEY]).toBeUndefined();
  expect(f.local.data[ANALYTICS_PREFERENCE_KEY]).toBe(false);
  // A later native grant cannot override the saved Workbench Off choice, and
  // reading the state on reopen never opens another permission window.
  f.add();
  expect(await f.send("state")).toMatchObject({value:{enabled:false,nativeConsent:true}});
  expect(await f.send("state")).toMatchObject({value:{enabled:false,nativeConsent:true}});
  expect(f.openWindow).toHaveBeenCalledTimes(1);
});

it("broadcasts native changes, aborts a send on removal, and purges both identifiers", async () => {
  const f = fixture();
  await f.send("state"); f.add();
  await vi.waitFor(() => expect(f.broadcast).toHaveBeenCalledWith({ type: ANALYTICS_MESSAGE, action: "native-changed" }));
  expect(await f.send("event", { event: { name: "panel_opened", params: {} } })).toEqual({ ok: true, value: true });
  expect(f.local.data[ANALYTICS_CLIENT_KEY]).toBeDefined();
  expect(f.session.data[ANALYTICS_SESSION_KEY]).toBeDefined();
  let active!: () => void;
  const started = new Promise<void>(resolve => { active = resolve; });
  let signal: AbortSignal | undefined;
  f.fetch.mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => {
    signal = options?.signal ?? undefined;
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
    active();
  }));
  const event = f.send("event", { event: { name: "panel_opened", params: {} } });
  await started; f.remove();
  expect(signal?.aborted).toBe(true);
  expect(await event).toEqual({ ok: true, value: false });
  await vi.waitFor(() => expect(f.local.data[ANALYTICS_CLIENT_KEY]).toBeUndefined());
  expect(f.session.data[ANALYTICS_SESSION_KEY]).toBeUndefined();
  expect(await f.send("state")).toMatchObject({ value: { enabled: false, nativeConsent: false } });
});
