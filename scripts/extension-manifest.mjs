export const firefoxExtensionId = "lightstreamer-workbench@imom39a";
export const firefoxRequiredData = ["websiteContent", "browsingActivity", "personallyIdentifyingInfo", "healthInfo", "financialAndPaymentInfo", "authenticationInfo", "personalCommunications", "locationInfo"];
export function extensionManifest(source, browser) {
  if (!['chrome', 'firefox'].includes(browser)) throw new Error(`Unsupported browser: ${browser}`);
  const manifest = structuredClone(source);
  if (browser === 'chrome') return manifest;
  manifest.description = source.description.replace('Chrome DevTools', 'Firefox Developer Tools');
  manifest.background = { scripts: [source.background.service_worker], type: 'module' };
  manifest.incognito = 'not_allowed';
  // Firefox MV3 otherwise upgrades local ws to wss. Keep code packaged and
  // network access limited to loopback companion ports and optional analytics.
  // Alternate ports preserve the companion's existing optional-auth setup.
  manifest.content_security_policy = { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://www.google-analytics.com" };
  manifest.browser_specific_settings = { gecko: { id: firefoxExtensionId, strict_min_version: '140.0', data_collection_permissions: { required: firefoxRequiredData, optional: ['technicalAndInteraction'] } } };
  return manifest;
}
