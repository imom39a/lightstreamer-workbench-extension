/** Store identity is permanent; a Firefox runtime UUID is specific to a profile. */
export const FIREFOX_EXTENSION_ID = "lightstreamer-workbench@imom39a";
export const FIREFOX_UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function isFirefoxOrigin(origin: string): boolean {
  return origin.startsWith("moz-extension://") && FIREFOX_UUID_PATTERN.test(origin.slice("moz-extension://".length));
}
export function isExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id) || id === FIREFOX_EXTENSION_ID;
}
export function extensionIdForOrigin(origin: string): string {
  if (isFirefoxOrigin(origin)) return FIREFOX_EXTENSION_ID;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin.slice("chrome-extension://".length);
  throw new Error("Invalid Workbench extension Origin.");
}
