import {
  createDisabledAnalytics,
  createGoogleAnalytics,
  type GoogleAnalyticsOptions,
  type WorkbenchAnalytics
} from "../analytics";

/** Constructs the shared panel analytics boundary and isolates configuration failures. */
export function createPanelAnalytics(options: GoogleAnalyticsOptions): WorkbenchAnalytics {
  try {
    return createGoogleAnalytics(options);
  } catch {
    return createDisabledAnalytics();
  }
}

/** Resolves extension-owned analytics configuration without exposing it to either renderer. */
export function createBrowserPanelAnalytics(): WorkbenchAnalytics {
  try {
    return createPanelAnalytics({
      measurementId: import.meta.env.VITE_LSEW_GA_MEASUREMENT_ID ?? "",
      apiSecret: import.meta.env.VITE_LSEW_GA_API_SECRET ?? "",
      extensionVersion: chrome.runtime.getManifest().version,
      storage: window.localStorage,
      fetcher: globalThis.fetch.bind(globalThis)
    });
  } catch {
    return createDisabledAnalytics();
  }
}
