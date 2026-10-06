type DataPermissions = { data_collection?: string[] };
type PermissionEvent = { addListener(listener: (value: DataPermissions) => void): void; removeListener(listener: (value: DataPermissions) => void): void };
export type FirefoxDataPermissions = {
  getAll(): Promise<DataPermissions>;
  request(value: { data_collection: string[] }): Promise<boolean>;
  onAdded: PermissionEvent;
  onRemoved: PermissionEvent;
};
export function isFirefoxExtension(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.getURL?.("").startsWith("moz-extension://"));
}
export function firefoxDataPermissions(): FirefoxDataPermissions | undefined {
  if (!isFirefoxExtension()) return undefined;
  return (globalThis as unknown as { browser?: { permissions?: FirefoxDataPermissions } }).browser?.permissions;
}
/** Must be called directly in the checkbox's user gesture, before awaiting other work. */
export function requestFirefoxAnalyticsConsent(): Promise<boolean> {
  const permissions = firefoxDataPermissions();
  if (permissions) return permissions.request({ data_collection: ["technicalAndInteraction"] });
  // Firefox DevTools cannot request permissions, and messages do not transfer
  // the gesture. The owning background opens a transient consent window.
  return new Promise(resolve => {
    if (!isFirefoxExtension()) { resolve(false); return; }
    chrome.runtime.sendMessage({ type: ANALYTICS_MESSAGE, action: "consent" }, response => {
      resolve(!chrome.runtime.lastError && response?.ok === true && response.value === true);
    });
  });
}
import { ANALYTICS_MESSAGE } from "./analytics/events";
