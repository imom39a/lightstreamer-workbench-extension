import { afterEach, expect, it, vi } from "vitest";
import { registerAnalyticsService } from "../src/extension/analytics/background";
import { ANALYTICS_CLIENT_KEY, ANALYTICS_MESSAGE, ANALYTICS_PREFERENCE_KEY } from "../src/extension/analytics/events";

const panelUrl = "chrome-extension://workbench/extension/panel/index.html";
const panelSender = { id: "workbench", url: panelUrl };

function storage() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }),
    setAccessLevel: vi.fn(async () => undefined)
  };
}

function setup() {
  const local = storage();
  const session = storage();
  const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  let listener!: (message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => boolean;
  vi.stubGlobal("chrome", {
    runtime: {
      id: "workbench", getURL: (path: string) => `chrome-extension://workbench/${path}`,
      getManifest: () => ({ version: "2.0.2" }),
      onMessage: { addListener: (value: typeof listener) => { listener = value; } }
    },
    storage: { local, session }
  });
  vi.stubGlobal("fetch", request);
  vi.stubEnv("PROD", true);
  vi.stubEnv("VITE_LSEW_GA_MEASUREMENT_ID", "G-TEST123");
  vi.stubEnv("VITE_LSEW_GA_API_SECRET", "test-key");
  registerAnalyticsService();
  function send(message: object): Promise<unknown> {
    return new Promise(resolve => {
      expect(listener({ type: ANALYTICS_MESSAGE, ...message }, panelSender, resolve)).toBe(true);
    });
  }
  return { local, session, request, listener, send };
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("rejects analytics and preference messages from inspected pages and other extension contexts", () => {
  const fixture = setup();
  const respond = vi.fn();
  for (const sender of [
    { id: "another-extension", url: panelUrl },
    { id: "workbench", url: "https://inspected.example/private", tab: { id: 7 } },
    { id: "workbench", url: "chrome-extension://workbench/extension/devtools/index.html" },
    { id: "workbench", url: `${panelUrl}?spoof=1` },
    { id: "workbench" }
  ]) {
    for (const action of ["state", "preference", "event"]) {
      expect(fixture.listener({ type: ANALYTICS_MESSAGE, action, enabled: true, event: { name: "panel_opened", params: {} } }, sender as chrome.runtime.MessageSender, respond)).toBe(false);
    }
  }
  expect(fixture.local.get).not.toHaveBeenCalled();
  expect(fixture.local.set).not.toHaveBeenCalled();
  expect(fixture.request).not.toHaveBeenCalled();
  expect(respond).not.toHaveBeenCalled();
  expect(fixture.local.setAccessLevel).toHaveBeenCalledWith({ accessLevel: "TRUSTED_CONTEXTS" });
});

it("accepts the actual panel sender, validates events, and acknowledges persisted opt-out", async () => {
  const fixture = setup();
  expect(await fixture.send({ action: "state" })).toEqual({ ok: true, value: { enabled: true, configured: true } });
  expect(await fixture.send({ action: "event", event: { name: "panel_opened", params: { payload: "private" } } })).toEqual({ ok: true, value: false });
  expect(fixture.request).not.toHaveBeenCalled();
  expect(await fixture.send({ action: "event", event: { name: "panel_opened", params: {} } })).toEqual({ ok: true, value: true });
  expect(fixture.local.data[ANALYTICS_CLIENT_KEY]).toMatch(/^\d+\.\d+$/);
  expect(await fixture.send({ action: "preference", enabled: false })).toEqual({ ok: true, value: { enabled: false, configured: true } });
  expect(fixture.local.data).toEqual({ [ANALYTICS_PREFERENCE_KEY]: false });
  expect(fixture.session.data).toEqual({});
  expect(await fixture.send({ action: "event", event: { name: "panel_opened", params: {} } })).toEqual({ ok: true, value: false });
  expect(fixture.request).toHaveBeenCalledTimes(1);
});
