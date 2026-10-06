import { ANALYTICS_MESSAGE } from "./analytics/events";
import { firefoxDataPermissions } from "./firefox-data-consent";

const page = "extension/analytics-consent/index.html";

/** One transient extension window owns Firefox's direct native user gesture. */
export function createFirefoxConsentWindow() {
  let pending: { id?: number; resolve(allowed: boolean): void; promise: Promise<boolean> } | null = null;
  function finish(allowed: boolean) {
    const current = pending;
    pending = null;
    current?.resolve(allowed);
  }
  chrome.windows.onRemoved.addListener(id => { if (pending?.id === id) finish(false); });
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (!message || typeof message !== "object") return false;
    const value = message as { type?: string; action?: string; allowed?: boolean };
    if (value.type !== ANALYTICS_MESSAGE || value.action !== "consent-result") return false;
    if (!pending || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL(page) || sender.tab?.windowId !== pending.id) return false;
    const current = pending;
    void (async () => {
      let allowed = false;
      try { allowed = value.allowed === true && (await firefoxDataPermissions()?.getAll())?.data_collection?.includes("technicalAndInteraction") === true; } catch { /* Fail closed. */ }
      if (pending === current) finish(allowed);
      respond({ ok: true });
    })();
    return true;
  });
  return () => {
    if (pending) return pending.promise;
    let resolve!: (allowed: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    const current = { promise, resolve, id: undefined as number | undefined };
    pending = current;
    // A normal browser window retains Firefox's keyboard route to the native
    // permission notification; toolbar-less popup windows lack that route.
    void chrome.windows.create({ url: chrome.runtime.getURL(page), type: "normal", width: 620, height: 520 }).then(window => {
      if (pending === current) {
        if (window.id === undefined) finish(false);
        else current.id = window.id;
      }
    }).catch(() => { if (pending === current) finish(false); });
    return promise;
  };
}
