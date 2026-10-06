import { expect, test } from "vitest";
import { runInNewContext } from "node:vm";
import { installChromeAnalyticsGuard } from "./browser-analytics-guard";

test("configured browser verification saves analytics Off behind the worker network boundary", async () => {
  const stored: Record<string, unknown> = { "lsew.usage.enabled.v1": true };
  let blockedURLs: string[] = [];
  const listeners = new Map<string, (params: unknown) => void>();
  const cdp = {
    async request(method: string, params: Record<string, unknown> = {}) {
      if (method === "Network.setBlockedURLs") blockedURLs = params.urls as string[];
      if (method === "Runtime.evaluate") {
        expect(blockedURLs).toContain("*://*.google-analytics.com/*");
        const value = await runInNewContext(String(params.expression), { chrome: { storage: { local: {
          async set(values: Record<string, unknown>) { Object.assign(stored, values); },
          async get(key: string) { return { [key]: stored[key] }; }
        } } } });
        return { result: { value } };
      }
      return {};
    },
    on(method: string, listener: (params: unknown) => void) {
      listeners.set(method, listener);
      return () => { listeners.delete(method); };
    }
  };
  const guard = await installChromeAnalyticsGuard(cdp);
  expect(stored["lsew.usage.enabled.v1"]).toBe(false);
  listeners.get("Network.requestWillBeSent")?.({ request: { url: "http://localhost:8080/fixture" } });
  expect(() => guard.assertQuiet()).not.toThrow();
  listeners.get("Network.requestWillBeSent")?.({ request: { url: "https://www.google-analytics.com/mp/collect?api_secret=never-log-this" } });
  expect(() => guard.assertQuiet()).toThrow(/analytics request/i);
  try { guard.assertQuiet(); } catch (error) { expect(String(error)).not.toContain("never-log-this"); }
  guard.dispose();
});
